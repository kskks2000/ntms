import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  buildLoadProfile,
  checkPrecedence,
  deriveStops,
  stopKeyOf,
  type AllocateInput,
  type AllocationTripView,
  type Capacity,
  type CarrierCandidate,
  type ConsolidationPage,
  type DerivedStop,
  type DispatchAssignInput,
  type OrderForTrip,
  type PoolOrder,
  type TripCreateInput,
  type TripUpdateInput,
  type TripView,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/**
 * 운송계획 — 편성 · 배정 · 배차 지시.
 *
 * 세 단계는 한 줄기다. 오더가 트립으로 묶이고(편성), 트립이 운송사에
 * 붙고(배정), 그 운송사의 차와 기사가 정해진다(배차). 앞 단계가 끝나야
 * 다음이 시작되므로 상태를 함께 움직인다.
 *
 *   오더  RECEIVED → PLANNED → ALLOCATED → DISPATCHED
 *   트립           DRAFT → CONFIRMED → ALLOCATING → ALLOCATED → DISPATCHED
 *
 * 오더 상태를 트립이 끌고 가는 이유는, 오더 하나가 어디까지 왔는지를
 * 오더 화면에서 답할 수 있어야 하기 때문이다. 트립을 열어 봐야 아는
 * 구조면 화주 전화에 바로 답할 수 없다.
 */
@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // 편성
  // ===================================================================

  /**
   * 편성 화면 한 장.
   *
   * 왼쪽에 놓을 **아직 안 묶인 오더**와 오른쪽에 놓을 **작성중 트립**을
   * 한 번에 내린다. 두 번 부르면 그 사이에 다른 사람이 오더를 가져가
   * 화면이 어긋난다.
   */
  async consolidation(
    principal: AuthPrincipal,
    planDate: string,
  ): Promise<ConsolidationPage> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;

      const [poolRows, tripRows] = await Promise.all([
        tx.transport_order.findMany({
          where: {
            tenant_id,
            deleted_at: null,
            status: { in: ['RECEIVED', 'CONFIRMED'] },
            trip_order: { none: {} },
          },
          include: {
            business_partner_transport_order_shipper_idTobusiness_partner: {
              select: { partner_name: true },
            },
            vehicle_type: { select: { vehicle_type_name: true } },
          },
          orderBy: [{ pickup_date: 'asc' }, { pickup_time_from: 'asc' }],
          take: 200,
        }),
        tx.trip.findMany({
          where: { tenant_id, deleted_at: null, plan_date: dateOnly(planDate), status: 'DRAFT' },
          orderBy: { trip_no: 'asc' },
          select: { trip_id: true },
        }),
      ]);

      const trips = await Promise.all(
        tripRows.map((t) => this.loadTripView(tx, principal, t.trip_id)),
      );

      return {
        pool: poolRows.map((o): PoolOrder => ({
          ...toOrderForTrip(o),
          status: o.status,
          shipperName:
            o.business_partner_transport_order_shipper_idTobusiness_partner?.partner_name ?? '',
          temperatureZone: o.temperature_zone,
          requiredVehicleTypeId: idOrNull(o.required_vehicle_type_id),
          requiredVehicleTypeName: o.vehicle_type?.vehicle_type_name ?? null,
          isExclusive: o.is_exclusive,
          isHazardous: o.is_hazardous,
          distanceKm: num(o.distance_km),
        })),
        trips,
      };
    });
  }

  async tripView(principal: AuthPrincipal, tripId: string): Promise<TripView> {
    return this.run(principal, (tx) => this.loadTripView(tx, principal, toId(tripId)));
  }

  async createTrip(principal: AuthPrincipal, input: TripCreateInput) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const orders = await this.takeOrders(tx, principal, input.orderIds);

      const rows = await tx.$queryRaw<Array<{ no: string }>>`
        SELECT ntms.fn_next_no(${tenant_id}::BIGINT, 'TRIP'::VARCHAR) AS no
      `;
      const trip_no = rows[0]?.no;
      if (!trip_no) throw AppError.badRequest('TRIP_NO_FAILED', '트립번호를 만들지 못했습니다.');

      const trip = await tx.trip.create({
        data: {
          tenant_id,
          trip_no,
          plan_date: dateOnly(input.planDate),
          trip_type: orders.length > 1 ? 'CONSOLIDATED' : 'SINGLE',
          status: 'DRAFT',
          required_vehicle_type_id: input.requiredVehicleTypeId
            ? BigInt(input.requiredVehicleTypeId)
            : null,
          remark: input.remark,
        },
      });

      await this.rebuild(tx, principal, trip.trip_id, orders, null);
      return { id: String(trip.trip_id), tripNo: trip_no };
    });
  }

  async updateTrip(principal: AuthPrincipal, tripId: string, input: TripUpdateInput) {
    return this.run(principal, async (tx) => {
      const trip_id = await this.ownedTrip(tx, principal, tripId, ['DRAFT']);

      if (input.planDate || input.requiredVehicleTypeId !== undefined || input.remark !== undefined) {
        await tx.trip.update({
          where: { trip_id },
          data: {
            ...(input.planDate ? { plan_date: dateOnly(input.planDate) } : {}),
            ...(input.requiredVehicleTypeId !== undefined
              ? {
                  required_vehicle_type_id: input.requiredVehicleTypeId
                    ? BigInt(input.requiredVehicleTypeId)
                    : null,
                }
              : {}),
            ...(input.remark !== undefined ? { remark: input.remark } : {}),
          },
        });
      }

      // 오더 구성이 바뀌면 정차를 다시 뽑는다. 손으로 정한 순서는 그때
      // 무의미해지므로 함께 버린다 — 없던 거점의 순서를 지킬 수는 없다.
      const orderIds =
        input.orderIds ??
        (
          await tx.trip_order.findMany({
            where: { tenant_id: principal.tenantId, trip_id },
            select: { order_id: true },
          })
        ).map((r) => String(r.order_id));

      const orders = await this.takeOrders(tx, principal, orderIds, trip_id);
      await this.rebuild(tx, principal, trip_id, orders, input.orderIds ? null : input.stopOrder ?? null);
      return { id: String(trip_id) };
    });
  }

  /**
   * 편성 확정.
   *
   * 여기서부터 오더는 "계획됨" 이 되고 다른 트립에 못 들어간다. 그래서
   * 확정 전에 **적재가 성립하는지 마지막으로 본다** — 화면이 이미 보여
   * 주고 있지만, 화면을 안 보고 API 를 직접 부를 수도 있다.
   */
  async confirmTrip(principal: AuthPrincipal, tripId: string) {
    return this.run(principal, async (tx) => {
      const trip_id = await this.ownedTrip(tx, principal, tripId, ['DRAFT']);
      const view = await this.loadTripView(tx, principal, trip_id);

      if (view.profile.firstOverSeq !== null) {
        throw AppError.conflict(
          'TRIP_OVERLOADED',
          `${view.profile.firstOverSeq}번째 정차에서 적재 한계를 넘습니다. 오더를 덜어내거나 차종을 올리세요.`,
          { firstOverSeq: view.profile.firstOverSeq, overBy: view.profile.overBy },
        );
      }
      if (view.orderCount === 0) {
        throw AppError.conflict('TRIP_EMPTY', '오더가 없는 트립은 확정할 수 없습니다.');
      }
      if (view.precedence.length > 0) {
        const first = view.precedence[0]!;
        throw AppError.conflict(
          'TRIP_PRECEDENCE',
          `${first.orderNo} 를 싣기 전에 내리는 순서입니다. 상차를 하차보다 앞으로 옮기세요.`,
          { violations: view.precedence },
        );
      }

      await tx.trip.update({
        where: { trip_id },
        data: { status: 'CONFIRMED', confirmed_at: new Date(), confirmed_by: principal.userId },
      });
      await advanceOrders(
        tx,
        principal.tenantId,
        view.orders.map((o) => BigInt(o.orderId)),
        'PLANNED',
      );

      return { id: String(trip_id), status: 'CONFIRMED' };
    });
  }

  /** 편성 해제 — 트립을 지우고 오더를 풀로 돌려보낸다 */
  async deleteTrip(principal: AuthPrincipal, tripId: string) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const trip_id = await this.ownedTrip(tx, principal, tripId, ['DRAFT', 'CONFIRMED']);

      const bound = await tx.trip_order.findMany({
        where: { tenant_id, trip_id },
        select: { order_id: true },
      });

      await tx.trip_stop_order.deleteMany({ where: { tenant_id, trip_id } });
      await tx.trip_stop.deleteMany({ where: { tenant_id, trip_id } });
      await tx.trip_order.deleteMany({ where: { tenant_id, trip_id } });
      await tx.trip.update({
        where: { trip_id },
        data: { deleted_at: new Date(), deleted_by: principal.userId, status: 'CANCELLED' },
      });

      // 오더를 풀로 돌려보낸다.
      //
      // PLANNED 인 것만 CONFIRMED 로 내린다. 아직 확정 전(RECEIVED)인 트립의
      // 오더는 상태가 그대로이므로 건드릴 필요가 없고, 건드리면 같은 값으로
      // UPDATE 해도 상태 전이 트리거가 걸린다.
      if (bound.length > 0) {
        await tx.transport_order.updateMany({
          where: {
            tenant_id,
            order_id: { in: bound.map((b) => b.order_id) },
            status: 'PLANNED',
          },
          data: { status: 'CONFIRMED' },
        });
      }
      return { id: String(trip_id), released: bound.length };
    });
  }

  // ===================================================================
  // 배정
  // ===================================================================

  async allocationPage(
    principal: AuthPrincipal,
    planDate: string,
  ): Promise<AllocationTripView[]> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const trips = await tx.trip.findMany({
        where: {
          tenant_id,
          deleted_at: null,
          plan_date: dateOnly(planDate),
          status: { in: ['CONFIRMED', 'ALLOCATING', 'ALLOCATED'] },
        },
        include: {
          vehicle_type: { select: { vehicle_type_name: true } },
          trip_stop: { orderBy: { stop_seq: 'asc' }, select: { location_name: true } },
          allocation: {
            where: { status: { in: ['REQUESTED', 'ACCEPTED'] } },
            orderBy: { allocation_seq: 'desc' },
            take: 1,
            include: { business_partner: { select: { partner_name: true } } },
          },
        },
        orderBy: { trip_no: 'asc' },
      });

      return trips.map((t): AllocationTripView => {
        const a = t.allocation[0];
        return {
          tripId: String(t.trip_id),
          tripNo: t.trip_no,
          planDate: dateStr(t.plan_date) ?? '',
          status: t.status,
          fromName: t.trip_stop[0]?.location_name ?? '—',
          toName: t.trip_stop[t.trip_stop.length - 1]?.location_name ?? '—',
          stopCount: t.trip_stop.length,
          orderCount: t.total_order_count ?? 0,
          totalWeightKg: num(t.total_weight_kg) ?? 0,
          requiredVehicleTypeName: t.vehicle_type?.vehicle_type_name ?? null,
          plannedStartAt: t.planned_start_at?.toISOString() ?? null,
          plannedDistanceKm: num(t.planned_distance_km),
          estimatedBillingAmount: num(t.estimated_billing_amount),
          allocation: a
            ? {
                allocationId: String(a.allocation_id),
                carrierId: String(a.carrier_id),
                carrierName: a.business_partner?.partner_name ?? '',
                status: a.status,
                totalAmount: num(a.total_amount),
                requestedAt: a.requested_at?.toISOString() ?? null,
                respondDeadlineAt: a.respond_deadline_at?.toISOString() ?? null,
              }
            : null,
        };
      });
    });
  }

  /**
   * 이 트립을 맡길 수 있는 운송사 후보.
   *
   * 값싼 순으로 줄 세우지 않는다. 가장 싼 운송사가 늘 안 받아 주면 그건
   * 후보가 아니다 — 배차실이 실제로 보는 것은 **금액 · 수락률 · 가용
   * 차량** 셋의 조합이다. 그래서 셋을 다 내리고 정렬만 거들어 준다.
   */
  async candidates(principal: AuthPrincipal, tripId: string): Promise<CarrierCandidate[]> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const trip_id = toId(tripId);
      const trip = await tx.trip.findFirst({
        where: { tenant_id, trip_id, deleted_at: null },
        select: {
          required_vehicle_type_id: true,
          plan_date: true,
          planned_distance_km: true,
          total_weight_kg: true,
        },
      });
      if (!trip) throw AppError.notFound('TRIP_NOT_FOUND', '트립을 찾을 수 없습니다.');

      const carriers = await tx.business_partner.findMany({
        where: { tenant_id, deleted_at: null, is_active: true, is_carrier: true },
        orderBy: { partner_code: 'asc' },
      });
      if (carriers.length === 0) return [];

      const ids = carriers.map((c) => c.partner_id);

      const [vehicles, allocStats, drivers, todayTrips, rateTables] = await Promise.all([
        tx.vehicle.groupBy({
          by: ['carrier_id'],
          where: {
            tenant_id,
            deleted_at: null,
            is_active: true,
            carrier_id: { in: ids },
            ...(trip.required_vehicle_type_id
              ? { vehicle_type_id: trip.required_vehicle_type_id }
              : {}),
          },
          _count: { _all: true },
        }),
        tx.allocation.groupBy({
          by: ['carrier_id', 'status'],
          where: { tenant_id, carrier_id: { in: ids } },
          _count: { _all: true },
        }),
        tx.driver.findMany({
          where: { tenant_id, deleted_at: null, is_active: true, carrier_id: { in: ids } },
          select: { carrier_id: true, on_time_rate: true },
        }),
        tx.dispatch.groupBy({
          by: ['carrier_id'],
          where: { tenant_id, deleted_at: null, dispatch_date: trip.plan_date, carrier_id: { in: ids } },
          _count: { _all: true },
        }),
        tx.rate_table.findMany({
          where: {
            tenant_id,
            deleted_at: null,
            is_active: true,
            rate_target: 'PAYMENT',
            status: 'APPROVED',
            OR: [{ partner_id: { in: ids } }, { partner_id: null }],
          },
          include: { rate_table_detail: { orderBy: { priority: 'asc' } } },
        }),
      ]);

      const vehicleCount = new Map(vehicles.map((v) => [String(v.carrier_id), v._count._all]));
      const todayCount = new Map(todayTrips.map((d) => [String(d.carrier_id), d._count._all]));

      const accept = new Map<string, { done: number; total: number }>();
      for (const a of allocStats) {
        const key = String(a.carrier_id);
        const cur = accept.get(key) ?? { done: 0, total: 0 };
        cur.total += a._count._all;
        if (a.status === 'ACCEPTED') cur.done += a._count._all;
        accept.set(key, cur);
      }

      const onTime = new Map<string, { sum: number; n: number }>();
      for (const d of drivers) {
        if (d.carrier_id === null || d.on_time_rate === null) continue;
        const key = String(d.carrier_id);
        const cur = onTime.get(key) ?? { sum: 0, n: 0 };
        cur.sum += Number(d.on_time_rate);
        cur.n += 1;
        onTime.set(key, cur);
      }

      const distance = num(trip.planned_distance_km) ?? 0;

      const out = carriers.map((c): CarrierCandidate => {
        const key = String(c.partner_id);
        const acc = accept.get(key);
        const ot = onTime.get(key);
        const priced = pickRate(rateTables, c.partner_id, trip.required_vehicle_type_id, distance);

        return {
          carrierId: key,
          carrierCode: c.partner_code,
          carrierName: c.partner_name,
          grade: c.grade ?? null,
          contractAmount: priced?.amount ?? null,
          rateTableId: priced ? String(priced.rateTableId) : null,
          rateTableName: priced?.rateTableName ?? null,
          acceptRate: acc && acc.total > 0 ? Math.round((acc.done / acc.total) * 100) : null,
          onTimeRate: ot && ot.n > 0 ? Math.round((ot.sum / ot.n) * 10) / 10 : null,
          vehicleCount: vehicleCount.get(key) ?? 0,
          assignedToday: todayCount.get(key) ?? 0,
          note: null,
        };
      });

      // 정렬 — 댈 차가 있고, 잘 받아 주고, 싼 순.
      out.sort((a, b) => {
        const ca = a.vehicleCount > 0 ? 0 : 1;
        const cb = b.vehicleCount > 0 ? 0 : 1;
        if (ca !== cb) return ca - cb;
        const ra = a.acceptRate ?? 0;
        const rb = b.acceptRate ?? 0;
        if (rb !== ra) return rb - ra;
        return (a.contractAmount ?? Infinity) - (b.contractAmount ?? Infinity);
      });

      // 왜 위에 놓았는지 한 줄로 — 순서만 바꾸고 이유를 안 적으면
      // 사용자는 그 순서를 믿지 못한다.
      for (const c of out) {
        if (c.vehicleCount === 0) {
          c.note = '이 차종 보유 차량 없음';
        } else if (c.acceptRate !== null && c.acceptRate < 70) {
          c.note = '최근 수락률이 낮음';
        } else if (c === out[0]) {
          c.note = '차량 보유 · 수락률 · 금액을 함께 본 첫 후보';
        }
      }

      return out;
    });
  }

  /** 운송사에 배정을 요청한다 */
  async allocate(principal: AuthPrincipal, tripId: string, input: AllocateInput) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const trip_id = await this.ownedTrip(tx, principal, tripId, ['CONFIRMED', 'ALLOCATING']);

      const carrier = await tx.business_partner.findFirst({
        where: { tenant_id, partner_id: toId(input.carrierId), deleted_at: null, is_carrier: true },
        select: { partner_id: true },
      });
      if (!carrier) throw AppError.badRequest('CARRIER_NOT_FOUND', '고른 운송사를 찾을 수 없습니다.');

      // 아직 답을 기다리는 요청이 있으면 그것부터 정리해야 한다. 두 곳에
      // 동시에 요청하면 둘 다 수락했을 때 어느 쪽이 진짜인지 알 수 없다.
      const pending = await tx.allocation.findFirst({
        where: { tenant_id, trip_id, status: 'REQUESTED' },
        select: { allocation_id: true },
      });
      if (pending) {
        throw AppError.conflict(
          'ALLOCATION_PENDING',
          '아직 답을 기다리는 배정이 있습니다. 취소한 뒤 다시 요청하세요.',
        );
      }

      const last = await tx.allocation.findFirst({
        where: { tenant_id, trip_id },
        orderBy: { allocation_seq: 'desc' },
        select: { allocation_seq: true },
      });

      const row = await tx.allocation.create({
        data: {
          tenant_id,
          trip_id,
          carrier_id: carrier.partner_id,
          allocation_seq: (last?.allocation_seq ?? 0) + 1,
          allocation_type: input.allocationType,
          rate_table_id: input.rateTableId ? BigInt(input.rateTableId) : null,
          allocated_amount: input.allocatedAmount,
          total_amount: input.allocatedAmount,
          currency_code: 'KRW',
          status: 'REQUESTED',
          requested_at: new Date(),
          requested_by: principal.userId,
          // 답을 무한정 기다릴 수는 없다. 하루를 주고 넘기면 다른 곳을 찾는다.
          respond_deadline_at: new Date(Date.now() + 24 * 3600_000),
          remark: input.remark,
        },
      });

      await tx.trip.update({ where: { trip_id }, data: { status: 'ALLOCATING' } });
      return { id: String(row.allocation_id) };
    });
  }

  /** 운송사가 답했다 */
  async respondAllocation(
    principal: AuthPrincipal,
    allocationId: string,
    accept: boolean,
    reason: string | null,
  ) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const allocation_id = toId(allocationId);
      const a = await tx.allocation.findFirst({
        where: { tenant_id, allocation_id },
        select: { allocation_id: true, trip_id: true, status: true, carrier_id: true },
      });
      if (!a) throw AppError.notFound('ALLOCATION_NOT_FOUND', '배정을 찾을 수 없습니다.');
      if (a.status !== 'REQUESTED') {
        throw AppError.conflict('ALLOCATION_SETTLED', '이미 답이 끝난 배정입니다.');
      }

      await tx.allocation.update({
        where: { allocation_id },
        data: {
          status: accept ? 'ACCEPTED' : 'REJECTED',
          responded_at: new Date(),
          responded_by: principal.userId,
          reject_reason: accept ? null : reason,
        },
      });

      await tx.trip.update({
        where: { trip_id: a.trip_id },
        data: { status: accept ? 'ALLOCATED' : 'CONFIRMED' },
      });

      if (accept) {
        const bound = await tx.trip_order.findMany({
          where: { tenant_id, trip_id: a.trip_id },
          select: { order_id: true },
        });
        await advanceOrders(tx, tenant_id, bound.map((b) => b.order_id), 'ALLOCATED');
      }

      return { id: String(allocation_id), status: accept ? 'ACCEPTED' : 'REJECTED' };
    });
  }

  /** 배정을 거둬들인다 (답을 기다리는 중에만) */
  async cancelAllocation(principal: AuthPrincipal, allocationId: string, reason: string) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const allocation_id = toId(allocationId);
      const a = await tx.allocation.findFirst({
        where: { tenant_id, allocation_id },
        select: { trip_id: true, status: true },
      });
      if (!a) throw AppError.notFound('ALLOCATION_NOT_FOUND', '배정을 찾을 수 없습니다.');
      if (a.status !== 'REQUESTED') {
        throw AppError.conflict('ALLOCATION_SETTLED', '이미 답이 끝난 배정은 거둘 수 없습니다.');
      }
      await tx.allocation.update({
        where: { allocation_id },
        data: {
          status: 'CANCELLED',
          cancel_reason: reason,
          cancelled_at: new Date(),
          cancelled_by: principal.userId,
        },
      });
      await tx.trip.update({ where: { trip_id: a.trip_id }, data: { status: 'CONFIRMED' } });
      return { id: String(allocation_id) };
    });
  }

  // ===================================================================
  // 배차 지시
  // ===================================================================

  /** 배차 후보 — 이 트립을 맡은 운송사의 차와 기사 */
  async dispatchCandidates(principal: AuthPrincipal, tripId: string) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const trip_id = toId(tripId);
      const trip = await tx.trip.findFirst({
        where: { tenant_id, trip_id, deleted_at: null },
        select: {
          required_vehicle_type_id: true,
          plan_date: true,
          allocation: {
            where: { status: 'ACCEPTED' },
            orderBy: { allocation_seq: 'desc' },
            take: 1,
            select: { carrier_id: true },
          },
        },
      });
      if (!trip) throw AppError.notFound('TRIP_NOT_FOUND', '트립을 찾을 수 없습니다.');
      const carrier_id = trip.allocation[0]?.carrier_id ?? null;

      const [vehicles, drivers, busy] = await Promise.all([
        tx.vehicle.findMany({
          where: {
            tenant_id,
            deleted_at: null,
            is_active: true,
            ...(carrier_id ? { carrier_id } : {}),
            ...(trip.required_vehicle_type_id
              ? { vehicle_type_id: trip.required_vehicle_type_id }
              : {}),
          },
          include: {
            vehicle_type: { select: { vehicle_type_name: true } },
            driver_vehicle_default_driver_idTodriver: {
              select: { driver_id: true, driver_name: true },
            },
          },
          orderBy: { vehicle_no: 'asc' },
        }),
        tx.driver.findMany({
          where: {
            tenant_id,
            deleted_at: null,
            is_active: true,
            status: 'ACTIVE',
            ...(carrier_id ? { carrier_id } : {}),
          },
          select: { driver_id: true, driver_code: true, driver_name: true, on_time_rate: true },
          orderBy: { driver_code: 'asc' },
        }),
        // 같은 날 이미 배차된 차·기사는 겹쳐 잡으면 안 된다
        tx.dispatch.findMany({
          where: {
            tenant_id,
            deleted_at: null,
            dispatch_date: trip.plan_date,
            status: { notIn: ['CANCELLED', 'REJECTED'] },
          },
          select: { vehicle_id: true, driver_id: true, trip_id: true },
        }),
      ]);

      const busyVehicles = new Set(
        busy.filter((b) => b.trip_id !== trip_id).map((b) => String(b.vehicle_id)),
      );
      const busyDrivers = new Set(
        busy.filter((b) => b.trip_id !== trip_id).map((b) => String(b.driver_id)),
      );

      return {
        carrierId: carrier_id ? String(carrier_id) : null,
        vehicles: vehicles.map((v) => ({
          vehicleId: String(v.vehicle_id),
          vehicleNo: v.vehicle_no,
          vehicleTypeName: v.vehicle_type?.vehicle_type_name ?? '',
          defaultDriverId: idOrNull(v.driver_vehicle_default_driver_idTodriver?.driver_id ?? null),
          defaultDriverName: v.driver_vehicle_default_driver_idTodriver?.driver_name ?? null,
          busy: busyVehicles.has(String(v.vehicle_id)),
        })),
        drivers: drivers.map((d) => ({
          driverId: String(d.driver_id),
          driverCode: d.driver_code,
          driverName: d.driver_name,
          onTimeRate: d.on_time_rate === null ? null : Number(d.on_time_rate),
          busy: busyDrivers.has(String(d.driver_id)),
        })),
      };
    });
  }

  async assignDispatch(
    principal: AuthPrincipal,
    tripId: string,
    input: DispatchAssignInput,
  ) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const trip_id = await this.ownedTrip(tx, principal, tripId, ['ALLOCATED', 'DISPATCHED']);

      const trip = await tx.trip.findFirstOrThrow({
        where: { trip_id },
        select: {
          plan_date: true,
          planned_start_at: true,
          planned_end_at: true,
          allocation: {
            where: { status: 'ACCEPTED' },
            orderBy: { allocation_seq: 'desc' },
            take: 1,
            include: { business_partner: { select: { partner_id: true, partner_name: true } } },
          },
        },
      });
      const alloc = trip.allocation[0];
      if (!alloc) {
        throw AppError.conflict(
          'TRIP_NOT_ALLOCATED',
          '운송사가 수락한 배정이 없습니다. 배정을 먼저 마치세요.',
        );
      }

      const [vehicle, driver] = await Promise.all([
        tx.vehicle.findFirst({
          where: { tenant_id, vehicle_id: toId(input.vehicleId), deleted_at: null },
          include: { vehicle_type: { select: { vehicle_type_id: true, vehicle_type_name: true } } },
        }),
        tx.driver.findFirst({
          where: { tenant_id, driver_id: toId(input.driverId), deleted_at: null },
          select: { driver_id: true, driver_name: true, mobile: true },
        }),
      ]);
      if (!vehicle) throw AppError.badRequest('VEHICLE_NOT_FOUND', '고른 차량을 찾을 수 없습니다.');
      if (!driver) throw AppError.badRequest('DRIVER_NOT_FOUND', '고른 기사를 찾을 수 없습니다.');

      // 같은 날 다른 트립에 이미 물려 있으면 막는다. 사람이 화면에서
      // 놓치더라도 여기서 걸려야 겹치기 배차가 실제로 나가지 않는다.
      const clash = await tx.dispatch.findFirst({
        where: {
          tenant_id,
          deleted_at: null,
          dispatch_date: trip.plan_date,
          status: { notIn: ['CANCELLED', 'REJECTED'] },
          trip_id: { not: trip_id },
          OR: [{ vehicle_id: vehicle.vehicle_id }, { driver_id: driver.driver_id }],
        },
        select: { dispatch_no: true, vehicle_id: true, driver_id: true },
      });
      if (clash) {
        const what = clash.vehicle_id === vehicle.vehicle_id ? '차량' : '기사';
        throw AppError.conflict(
          'DISPATCH_CLASH',
          `이 ${what}은 같은 날 ${clash.dispatch_no} 에 이미 배차돼 있습니다.`,
        );
      }

      const existing = await tx.dispatch.findFirst({
        where: { tenant_id, trip_id, deleted_at: null, status: { notIn: ['CANCELLED'] } },
        select: { dispatch_id: true },
      });

      const data = {
        allocation_id: alloc.allocation_id,
        carrier_id: alloc.business_partner!.partner_id,
        carrier_name: alloc.business_partner!.partner_name,
        vehicle_id: vehicle.vehicle_id,
        vehicle_no: vehicle.vehicle_no,
        vehicle_type_id: vehicle.vehicle_type?.vehicle_type_id ?? null,
        vehicle_type_name: vehicle.vehicle_type?.vehicle_type_name ?? null,
        driver_id: driver.driver_id,
        driver_name: driver.driver_name,
        driver_mobile: driver.mobile,
        sub_driver_id: input.subDriverId ? BigInt(input.subDriverId) : null,
        planned_start_at: trip.planned_start_at,
        planned_end_at: trip.planned_end_at,
        status: 'ASSIGNED' as const,
        dispatched_at: new Date(),
        remark: input.remark,
      };

      let dispatch_id: bigint;
      if (existing) {
        const row = await tx.dispatch.update({
          where: { dispatch_id: existing.dispatch_id },
          data,
        });
        dispatch_id = row.dispatch_id;
      } else {
        const rows = await tx.$queryRaw<Array<{ no: string }>>`
          SELECT ntms.fn_next_no(${tenant_id}::BIGINT, 'DISPATCH'::VARCHAR) AS no
        `;
        const dispatch_no = rows[0]?.no;
        if (!dispatch_no) {
          throw AppError.badRequest('DISPATCH_NO_FAILED', '배차번호를 만들지 못했습니다.');
        }
        const row = await tx.dispatch.create({
          data: { tenant_id, dispatch_no, trip_id, dispatch_date: trip.plan_date, ...data },
        });
        dispatch_id = row.dispatch_id;
      }

      await tx.trip.update({ where: { trip_id }, data: { status: 'DISPATCHED' } });
      const bound = await tx.trip_order.findMany({
        where: { tenant_id, trip_id },
        select: { order_id: true },
      });
      await advanceOrders(tx, tenant_id, bound.map((b) => b.order_id), 'DISPATCHED');

      return { id: String(dispatch_id) };
    });
  }

  // ===================================================================
  // 내부
  // ===================================================================

  /**
   * 오더를 트립에 넣을 수 있는지 확인하고 가져온다.
   *
   * 이미 다른 트립에 묶인 오더는 거절한다 — 두 트립이 같은 오더를 실으면
   * 화물은 하나인데 차가 둘이 간다.
   */
  private async takeOrders(
    tx: TxClient,
    principal: AuthPrincipal,
    orderIds: string[],
    selfTripId?: bigint,
  ): Promise<OrderForTrip[]> {
    const tenant_id = principal.tenantId;
    const ids = orderIds.map(toId);

    const rows = await tx.transport_order.findMany({
      where: { tenant_id, order_id: { in: ids }, deleted_at: null },
      include: { trip_order: { select: { trip_id: true } } },
    });
    if (rows.length !== ids.length) {
      throw AppError.badRequest('ORDER_NOT_FOUND', '고른 오더 중 찾을 수 없는 것이 있습니다.');
    }

    for (const o of rows) {
      const other = o.trip_order.find((t) => t.trip_id !== selfTripId);
      if (other) {
        throw AppError.conflict(
          'ORDER_ALREADY_PLANNED',
          `${o.order_no} 는 이미 다른 트립에 묶여 있습니다.`,
        );
      }
    }
    return rows.map(toOrderForTrip);
  }

  /**
   * 정차와 합계를 다시 만든다.
   *
   * 오더 구성이나 순서가 바뀔 때마다 전부 지우고 다시 넣는다. 차이만
   * 골라 고치는 방식은 정차가 합쳐지고 갈라지는 경우에 금방 틀어진다 —
   * 같은 거점의 두 오더 중 하나만 빼면 그 정차는 사라지지 않고 줄어든다.
   */
  private async rebuild(
    tx: TxClient,
    principal: AuthPrincipal,
    trip_id: bigint,
    orders: OrderForTrip[],
    stopOrder: string[] | null,
  ) {
    const tenant_id = principal.tenantId;

    await tx.trip_stop_order.deleteMany({ where: { tenant_id, trip_id } });
    await tx.trip_stop.deleteMany({ where: { tenant_id, trip_id } });
    await tx.trip_order.deleteMany({ where: { tenant_id, trip_id } });

    const byOrderId = new Map(orders.map((o) => [o.orderId, o]));
    let stops = deriveStops(orders);
    if (stopOrder && stopOrder.length === stops.length) {
      // 사람이 정한 순서가 있으면 그대로 쓴다. 기본 순서는 예측 가능한
      // 출발점일 뿐이고, 실제 동선은 배차 담당자가 안다.
      const byKey = new Map(stops.map((s) => [stopKeyOf(s), s]));
      const reordered = stopOrder.map((k) => byKey.get(k)).filter(Boolean) as DerivedStop[];
      if (reordered.length === stops.length) {
        stops = reordered.map((s, i) => ({ ...s, stopSeq: i + 1 }));
      }
    }

    await tx.trip_order.createMany({
      data: orders.map((o, i) => ({
        tenant_id,
        trip_id,
        order_id: BigInt(o.orderId),
        seq_no: i + 1,
        assigned_weight_kg: o.weightKg,
        assigned_volume_cbm: o.volumeCbm,
        assigned_pallet_qty: o.palletQty,
      })),
    });

    for (const s of stops) {
      const stop = await tx.trip_stop.create({
        data: {
          tenant_id,
          trip_id,
          stop_seq: s.stopSeq,
          stop_type: s.stopType as 'PICKUP' | 'DELIVERY',
          location_id: s.locationId ? BigInt(s.locationId) : null,
          location_name: s.locationName,
          address1: s.address1,
          time_window_from: toClock(s.timeWindowFrom),
          time_window_to: toClock(s.timeWindowTo),
          load_weight_kg: s.loadWeightKg,
          unload_weight_kg: s.unloadWeightKg,
        },
      });
      // qty 는 0 이 될 수 없다(ck_trip_stop_order_qty). 오더의 실제 물량을
      // 넣는다 — 이 값이 나중에 부분 하차·분할 배송의 근거가 된다.
      await tx.trip_stop_order.createMany({
        data: s.orders.map((so) => {
          const o = byOrderId.get(so.orderId);
          return {
            tenant_id,
            trip_stop_id: stop.trip_stop_id,
            trip_id,
            order_id: BigInt(so.orderId),
            action_type: so.action,
            qty: Math.max(0.001, o?.weightKg ?? 0.001),
            weight_kg: o?.weightKg ?? 0,
            volume_cbm: o?.volumeCbm ?? 0,
            pallet_qty: o?.palletQty ?? null,
          };
        }),
      });
    }

    // 누적값은 곡선 계산 결과를 그대로 저장한다. 화면과 DB 가 같은
    // 숫자를 말해야 나중에 실적과 견줄 수 있다.
    const cap = await this.capacityOf(tx, principal, trip_id);
    const profile = buildLoadProfile(stops, cap);

    // 구간 거리 · 소요시간 · 작업시간을 모아 계획 시각을 세운다
    const legs = await this.legsOf(tx, tenant_id, stops);
    const schedule = buildSchedule(stops, legs, plannedStart(orders));

    for (const p of profile.points) {
      const leg = legs[p.stopSeq - 1]!;
      const sch = schedule.points[p.stopSeq - 1]!;
      await tx.trip_stop.updateMany({
        where: { tenant_id, trip_id, stop_seq: p.stopSeq },
        data: {
          cumulative_weight_kg: p.cumulativeWeightKg,
          cumulative_volume_cbm: p.cumulativeVolumeCbm,
          distance_from_prev_km: leg.distanceKm,
          duration_from_prev_min: leg.durationMin,
          planned_service_min: leg.serviceMin,
          planned_arrival_at: sch.arrival,
          planned_departure_at: sch.departure,
        },
      });
    }

    const totals = orders.reduce(
      (a, o) => ({
        w: a.w + o.weightKg,
        v: a.v + o.volumeCbm,
        p: a.p + o.palletQty,
      }),
      { w: 0, v: 0, p: 0 },
    );

    await tx.trip.update({
      where: { trip_id },
      data: {
        trip_type: orders.length > 1 ? 'CONSOLIDATED' : 'SINGLE',
        total_stop_count: stops.length,
        pickup_stop_count: stops.filter((s) => s.stopType === 'PICKUP').length,
        delivery_stop_count: stops.filter((s) => s.stopType === 'DELIVERY').length,
        total_order_count: orders.length,
        total_weight_kg: totals.w,
        total_volume_cbm: totals.v,
        total_pallet_qty: totals.p,
        weight_loading_rate:
          cap.maxWeightKg && cap.maxWeightKg > 0
            ? Math.round((profile.peakWeightKg / cap.maxWeightKg) * 1000) / 10
            : null,
        start_location_id: stops[0]?.locationId ? BigInt(stops[0].locationId) : null,
        end_location_id: stops[stops.length - 1]?.locationId
          ? BigInt(stops[stops.length - 1]!.locationId!)
          : null,
        // 거리도 같은 이유로 다 알 때만 낸다
        planned_distance_km: legs.every((l) => l.known)
          ? legs.reduce((a, l) => a + (l.distanceKm ?? 0), 0) || null
          : null,
        planned_duration_min: schedule.totalMinutes,
        planned_toll_fee: legs.reduce((a, l) => a + (l.tollFee ?? 0), 0) || null,
        planned_start_at: schedule.start,
        planned_end_at: schedule.end,
      },
    });
  }

  /**
   * 정차 사이의 구간 정보를 모은다.
   *
   * 거리·소요시간은 라우트 마스터(distance_master)가 안다. 없으면 null 로
   * 두고 **추정하지 않는다** — 직선거리로 어림잡으면 그럴듯한 숫자가 나와
   * 사람이 그것을 사실로 믿는다. 모르는 것은 모른다고 두는 편이 낫다.
   *
   * 작업시간은 거점 마스터의 표준 상·하차 시간을 쓴다. 항만은 70분,
   * 점포는 25분처럼 곳마다 다르고, 그 차이가 하루 동선을 가른다.
   */
  private async legsOf(
    tx: TxClient,
    tenant_id: bigint,
    stops: DerivedStop[],
  ): Promise<Leg[]> {
    const locationIds = [
      ...new Set(stops.map((s) => s.locationId).filter((v): v is string => v !== null)),
    ].map(BigInt);

    const [routes, locations] = await Promise.all([
      locationIds.length > 0
        ? tx.distance_master.findMany({
            where: {
              tenant_id,
              is_active: true,
              from_location_id: { in: locationIds },
              to_location_id: { in: locationIds },
            },
            select: {
              from_location_id: true,
              to_location_id: true,
              distance_km: true,
              duration_minutes: true,
              toll_fee: true,
            },
          })
        : Promise.resolve([]),
      locationIds.length > 0
        ? tx.location.findMany({
            where: { tenant_id, location_id: { in: locationIds } },
            select: {
              location_id: true,
              standard_load_min: true,
              standard_unload_min: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const routeBy = new Map(
      routes.map((r) => [`${r.from_location_id}>${r.to_location_id}`, r]),
    );
    const locBy = new Map(locations.map((l) => [String(l.location_id), l]));

    return stops.map((s, i) => {
      const prev = i > 0 ? stops[i - 1]! : null;
      const r =
        prev && prev.locationId && s.locationId
          ? routeBy.get(`${prev.locationId}>${s.locationId}`)
          : undefined;
      const loc = s.locationId ? locBy.get(s.locationId) : undefined;

      return {
        distanceKm: r ? num(r.distance_km) : null,
        durationMin: r?.duration_minutes ?? null,
        tollFee: r ? num(r.toll_fee) : null,
        serviceMin:
          s.stopType === 'PICKUP'
            ? (loc?.standard_load_min ?? DEFAULT_SERVICE_MIN)
            : (loc?.standard_unload_min ?? DEFAULT_SERVICE_MIN),
        // 첫 정차는 앞 구간이 없다. 구간을 모르는 것과 구별한다.
        known: i === 0 ? true : Boolean(r),
      };
    });
  }

  private async capacityOf(
    tx: TxClient,
    principal: AuthPrincipal,
    trip_id: bigint,
  ): Promise<Capacity> {
    const t = await tx.trip.findFirst({
      where: { tenant_id: principal.tenantId, trip_id },
      select: { vehicle_type: true },
    });
    const vt = t?.vehicle_type;
    return {
      maxWeightKg: num(vt?.max_weight_kg),
      maxVolumeCbm: num(vt?.max_volume_cbm),
      maxPalletQty: vt?.max_pallet_qty ?? null,
    };
  }

  private async loadTripView(
    tx: TxClient,
    principal: AuthPrincipal,
    trip_id: bigint,
  ): Promise<TripView> {
    const tenant_id = principal.tenantId;
    const t = await tx.trip.findFirst({
      where: { tenant_id, trip_id, deleted_at: null },
      include: {
        vehicle_type: true,
        trip_stop: {
          orderBy: { stop_seq: 'asc' },
          include: {
            // 좌표는 거점 마스터가 갖고 있다. 지도에 찍으려면 함께 내려야 한다.
            location: { select: { latitude: true, longitude: true } },
            trip_stop_order: { include: { transport_order: { select: { order_no: true } } } },
          },
        },
        trip_order: {
          orderBy: { seq_no: 'asc' },
          include: {
            transport_order: {
              select: {
                order_no: true,
                total_weight_kg: true,
                business_partner_transport_order_shipper_idTobusiness_partner: {
                  select: { partner_name: true },
                },
              },
            },
          },
        },
      },
    });
    if (!t) throw AppError.notFound('TRIP_NOT_FOUND', '트립을 찾을 수 없습니다.');

    const cap: Capacity = {
      maxWeightKg: num(t.vehicle_type?.max_weight_kg),
      maxVolumeCbm: num(t.vehicle_type?.max_volume_cbm),
      maxPalletQty: t.vehicle_type?.max_pallet_qty ?? null,
    };

    const stops = t.trip_stop.map((s) => ({
      stopSeq: s.stop_seq,
      stopType: s.stop_type,
      locationName: s.location_name,
      loadWeightKg: num(s.load_weight_kg) ?? 0,
      loadVolumeCbm: 0,
      loadPalletQty: 0,
      unloadWeightKg: num(s.unload_weight_kg) ?? 0,
      unloadVolumeCbm: 0,
      unloadPalletQty: 0,
    }));
    const profile = buildLoadProfile(stops, cap);

    return {
      tripId: String(t.trip_id),
      tripNo: t.trip_no,
      planDate: dateStr(t.plan_date) ?? '',
      status: t.status,
      tripType: t.trip_type,
      requiredVehicleTypeId: idOrNull(t.required_vehicle_type_id),
      requiredVehicleTypeName: t.vehicle_type?.vehicle_type_name ?? null,
      capacity: cap,
      orderCount: t.trip_order.length,
      totalWeightKg: num(t.total_weight_kg) ?? 0,
      totalVolumeCbm: num(t.total_volume_cbm) ?? 0,
      totalPalletQty: num(t.total_pallet_qty) ?? 0,
      weightLoadingRate: num(t.weight_loading_rate),
      plannedDistanceKm: num(t.planned_distance_km),
      plannedDurationMin: t.planned_duration_min,
      plannedStartAt: t.planned_start_at?.toISOString() ?? null,
      plannedEndAt: t.planned_end_at?.toISOString() ?? null,
      lateStopCount: t.trip_stop.filter(
        (s) => lateness(s.planned_arrival_at, s.time_window_to, t.plan_date) !== null,
      ).length,
      // 첫 정차는 앞 구간이 없으므로 세지 않는다
      missingRouteCount: t.trip_stop.filter(
        (s, i) => i > 0 && s.distance_from_prev_km === null,
      ).length,
      stops: t.trip_stop.map((s, i) => {
        const arrival = s.planned_arrival_at;
        const late = lateness(arrival, s.time_window_to, t.plan_date);
        const wait = waiting(arrival, s.time_window_from, t.plan_date);
        return {
          ...profile.points[i]!,
          locationId: idOrNull(s.location_id),
          address1: s.address1,
          latitude: num(s.latitude) ?? num(s.location?.latitude),
          longitude: num(s.longitude) ?? num(s.location?.longitude),
          orders: s.trip_stop_order.map((so) => ({
            orderId: String(so.order_id),
            orderNo: so.transport_order?.order_no ?? '',
            action: so.action_type as 'LOAD' | 'UNLOAD',
          })),
          timeWindowFrom: clockStr(s.time_window_from),
          timeWindowTo: clockStr(s.time_window_to),
          distanceFromPrevKm: num(s.distance_from_prev_km),
          durationFromPrevMin: s.duration_from_prev_min,
          serviceMin: s.planned_service_min,
          plannedArrivalAt: arrival?.toISOString() ?? null,
          plannedDepartureAt: s.planned_departure_at?.toISOString() ?? null,
          lateMinutes: late,
          waitMinutes: wait,
        };
      }),
      orders: t.trip_order.map((o) => ({
        orderId: String(o.order_id),
        orderNo: o.transport_order?.order_no ?? '',
        shipperName:
          o.transport_order
            ?.business_partner_transport_order_shipper_idTobusiness_partner?.partner_name ?? '',
        weightKg: num(o.assigned_weight_kg) ?? 0,
      })),
      profile: {
        peakWeightKg: profile.peakWeightKg,
        peakRate: profile.peakRate,
        firstOverSeq: profile.firstOverSeq,
        overBy: profile.overBy,
      },
      precedence: checkPrecedence(
        t.trip_stop.map((s) => ({
          stopSeq: s.stop_seq,
          orders: s.trip_stop_order.map((so) => ({
            orderId: String(so.order_id),
            orderNo: so.transport_order?.order_no ?? '',
            action: so.action_type as 'LOAD' | 'UNLOAD',
          })),
        })),
      ),
      remark: t.remark,
    };
  }

  private async ownedTrip(
    tx: TxClient,
    principal: AuthPrincipal,
    tripId: string,
    allowed: string[],
  ): Promise<bigint> {
    const trip_id = toId(tripId);
    const t = await tx.trip.findFirst({
      where: { tenant_id: principal.tenantId, trip_id, deleted_at: null },
      select: { trip_id: true, status: true },
    });
    if (!t) throw AppError.notFound('TRIP_NOT_FOUND', '트립을 찾을 수 없습니다.');
    if (!allowed.includes(t.status)) {
      throw AppError.conflict(
        'TRIP_STATUS_LOCKED',
        `지금 상태(${t.status})에서는 할 수 없는 작업입니다.`,
        { status: t.status },
      );
    }
    return trip_id;
  }
}

// ---------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------

/**
 * 오더를 목표 상태까지 **규칙이 허용하는 길로** 옮긴다.
 *
 * ntms.order_status_rule 이 전이를 통제하고 트리거가 그것을 강제한다.
 * 예를 들어 RECEIVED 에서 PLANNED 로 한 번에 갈 수 없다 — 사이에 CONFIRMED
 * 라는 관문이 있다. 접수된 오더를 담당자가 검토·확정한 뒤에야 계획에
 * 넣는다는 뜻이다.
 *
 * 규칙을 우회하지 않고 **두 걸음을 밟는다.** 그래야 "이 오더가 언제
 * 확정됐나" 도 이력에 남는다. 편성 화면에서 확정 버튼을 한 번 더 누르게
 * 하는 대신, 편성을 확정하는 행위 자체가 오더 확정을 겸한다.
 *
 * 이미 목표 상태이거나 그보다 앞서 있으면 아무것도 하지 않는다.
 */
const ORDER_FLOW = ['RECEIVED', 'CONFIRMED', 'PLANNED', 'ALLOCATED', 'DISPATCHED'] as const;
type FlowStatus = (typeof ORDER_FLOW)[number];

async function advanceOrders(
  tx: TxClient,
  tenant_id: bigint,
  orderIds: bigint[],
  target: FlowStatus,
): Promise<void> {
  if (orderIds.length === 0) return;
  const targetAt = ORDER_FLOW.indexOf(target);

  const rows = await tx.transport_order.findMany({
    where: { tenant_id, order_id: { in: orderIds } },
    select: { order_id: true, status: true },
  });

  for (const row of rows) {
    let at = ORDER_FLOW.indexOf(row.status as FlowStatus);
    // 흐름 밖의 상태(보류 · 취소 등)는 계획이 함부로 끌고 가지 않는다
    if (at === -1) continue;
    while (at < targetAt) {
      at += 1;
      await tx.transport_order.update({
        where: { order_id: row.order_id },
        data: { status: ORDER_FLOW[at]! },
      });
    }
  }
}

/** 거점 마스터에 표준 작업시간이 없을 때 쓰는 값 */
const DEFAULT_SERVICE_MIN = 30;

interface Leg {
  distanceKm: number | null;
  durationMin: number | null;
  tollFee: number | null;
  serviceMin: number;
  known: boolean;
}

/**
 * 정차 순서를 따라가며 도착 · 출발 시각을 세운다.
 *
 * 규칙은 기사가 실제로 하는 대로다.
 *
 *   도착 = 앞 정차 출발 + 이동시간
 *   창이 아직 안 열렸으면 열릴 때까지 기다린다
 *   출발 = max(도착, 창 열림) + 작업시간
 *
 * 구간 소요시간을 모르면 그 뒤로는 시각을 세우지 않는다. 하나를 추정해
 * 이어 붙이면 뒤쪽 시각이 전부 그럴듯하게 틀린다 — 틀린 걸 모르는 계획이
 * 계획이 없는 것보다 나쁘다.
 */
function buildSchedule(
  stops: DerivedStop[],
  legs: Leg[],
  start: Date | null,
): {
  points: { arrival: Date | null; departure: Date | null }[];
  start: Date | null;
  end: Date | null;
  totalMinutes: number | null;
} {
  if (!start || stops.length === 0) {
    return {
      points: stops.map(() => ({ arrival: null, departure: null })),
      start: null,
      end: null,
      totalMinutes: null,
    };
  }

  const points: { arrival: Date | null; departure: Date | null }[] = [];
  let cursor: Date | null = start;

  for (const [i, stop] of stops.entries()) {
    const leg = legs[i]!;

    if (cursor === null || (i > 0 && !leg.known)) {
      // 여기서부터는 모른다
      points.push({ arrival: null, departure: null });
      cursor = null;
      continue;
    }

    /*
      타입을 명시해 두는 이유 — cursor 는 루프 안에서 departure 로 다시
      대입되고 departure 는 cursor 에서 나온다. 제어 흐름이 한 바퀴 돌아
      추론이 순환하므로(TS7022) 고리를 여기서 끊는다. 지우면 오류가
      되살아난다.
    */
    const from: Date = cursor;
    const arrival: Date =
      i === 0 ? from : new Date(from.getTime() + (leg.durationMin ?? 0) * 60_000);

    // 창이 열리기 전에 도착하면 기다린다
    const openAt = clockOn(arrival, stop.timeWindowFrom);
    const serviceFrom: Date = openAt && openAt > arrival ? openAt : arrival;
    const departure: Date = new Date(serviceFrom.getTime() + leg.serviceMin * 60_000);

    points.push({ arrival, departure });
    cursor = departure;
  }

  /*
    구간을 하나라도 모르면 총 소요시간을 내지 않는다.

    아는 데까지만 더하면 "362km / 70분" 같은 값이 나오는데, 그건 첫 정차의
    작업시간일 뿐인데도 화면에서는 완결된 계획으로 읽힌다. **반쪽 계산을
    완전한 것처럼 보이게 하는 것이 계산을 안 하는 것보다 나쁘다.**
  */
  const complete = points.every((p) => p.departure !== null);
  const end = complete ? (points[points.length - 1]?.departure ?? null) : null;

  return {
    points,
    start,
    end,
    totalMinutes: end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null,
  };
}

/** 어떤 날의 `HH:MM` 을 그 날짜 위의 시각으로 (KST 기준) */
function clockOn(base: Date, hhmm: string | null): Date | null {
  if (!hhmm) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = base.getFullYear();
  const m = pad(base.getMonth() + 1);
  const d = pad(base.getDate());
  return new Date(`${y}-${m}-${d}T${hhmm}:00+09:00`);
}

/** 시간창 마감을 몇 분 넘겼나. 안 넘겼으면 null */
function lateness(
  arrival: Date | null,
  windowTo: Date | null,
  planDate: Date | null,
): number | null {
  if (!arrival || !windowTo || !planDate) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const close = new Date(
    `${arrival.getFullYear()}-${pad(arrival.getMonth() + 1)}-${pad(arrival.getDate())}T${pad(windowTo.getUTCHours())}:${pad(windowTo.getUTCMinutes())}:00+09:00`,
  );
  const diff = Math.round((arrival.getTime() - close.getTime()) / 60_000);
  return diff > 0 ? diff : null;
}

/** 창이 열릴 때까지 몇 분 기다리나 */
function waiting(
  arrival: Date | null,
  windowFrom: Date | null,
  planDate: Date | null,
): number | null {
  if (!arrival || !windowFrom || !planDate) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const open = new Date(
    `${arrival.getFullYear()}-${pad(arrival.getMonth() + 1)}-${pad(arrival.getDate())}T${pad(windowFrom.getUTCHours())}:${pad(windowFrom.getUTCMinutes())}:00+09:00`,
  );
  const diff = Math.round((open.getTime() - arrival.getTime()) / 60_000);
  return diff > 0 ? diff : null;
}

function toOrderForTrip(o: Record<string, unknown>): OrderForTrip {
  return {
    orderId: String(o.order_id),
    orderNo: o.order_no as string,
    fromLocationId: idOrNull(o.from_location_id as bigint | null),
    fromLocationName: o.from_location_name as string,
    fromAddress1: o.from_address1 as string,
    toLocationId: idOrNull(o.to_location_id as bigint | null),
    toLocationName: o.to_location_name as string,
    toAddress1: o.to_address1 as string,
    pickupDate: dateStr(o.pickup_date as Date | null),
    pickupTimeFrom: clockStr(o.pickup_time_from as Date | null),
    pickupTimeTo: clockStr(o.pickup_time_to as Date | null),
    deliveryDate: dateStr(o.delivery_date as Date | null),
    deliveryTimeFrom: clockStr(o.delivery_time_from as Date | null),
    deliveryTimeTo: clockStr(o.delivery_time_to as Date | null),
    weightKg: num(o.total_weight_kg) ?? 0,
    volumeCbm: num(o.total_volume_cbm) ?? 0,
    palletQty: num(o.total_pallet_qty) ?? 0,
  };
}

/** 가장 이른 상차 시각을 트립 출발 예정으로 삼는다 */
function plannedStart(orders: OrderForTrip[]): Date | null {
  const candidates = orders
    .filter((o) => o.pickupDate && o.pickupTimeFrom)
    .map((o) => new Date(`${o.pickupDate}T${o.pickupTimeFrom}:00+09:00`));
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/**
 * 이 트립에 붙일 수 있는 매입 운임표에서 금액을 뽑는다.
 *
 * 운송사 전용 표가 있으면 그것을, 없으면 전체 공통 표를 쓴다. 거리요율은
 * 기본료 + 거리 × 단가로, 나머지 방식은 기본료만 본다 — 정확한 계산은
 * 정산의 일이고 여기서는 **후보를 견주는 눈금**이면 된다.
 */
function pickRate(
  tables: Array<{
    rate_table_id: bigint;
    rate_table_name: string;
    partner_id: bigint | null;
    rate_method: string;
    min_charge_amount: unknown;
    rate_table_detail: Array<{
      vehicle_type_id: bigint | null;
      distance_from: unknown;
      distance_to: unknown;
      base_amount: unknown;
      unit_rate: unknown;
      min_amount: unknown;
    }>;
  }>,
  carrierId: bigint,
  vehicleTypeId: bigint | null,
  distanceKm: number,
): { amount: number; rateTableId: bigint; rateTableName: string } | null {
  const mine = tables.filter((t) => t.partner_id === carrierId);
  const table = mine[0] ?? tables.find((t) => t.partner_id === null);
  if (!table) return null;

  const lines = table.rate_table_detail.filter((d) => {
    if (vehicleTypeId && d.vehicle_type_id && d.vehicle_type_id !== vehicleTypeId) return false;
    const from = num(d.distance_from);
    const to = num(d.distance_to);
    if (from !== null && distanceKm < from) return false;
    if (to !== null && distanceKm > to) return false;
    return true;
  });
  const line = lines[0];
  if (!line) return null;

  const base = num(line.base_amount) ?? 0;
  const unit = num(line.unit_rate) ?? 0;
  const raw = table.rate_method === 'DISTANCE' ? base + unit * distanceKm : base;
  const min = num(line.min_amount) ?? num(table.min_charge_amount) ?? 0;

  return {
    amount: Math.round(Math.max(raw, min)),
    rateTableId: table.rate_table_id,
    rateTableName: table.rate_table_name,
  };
}

function toId(value: string): bigint {
  if (!/^\d+$/.test(value)) throw AppError.notFound('NOT_FOUND', '찾을 수 없습니다.');
  return BigInt(value);
}

function idOrNull(v: bigint | null | undefined): string | null {
  return v === null || v === undefined ? null : String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function dateStr(v: Date | null): string | null {
  return v ? v.toISOString().slice(0, 10) : null;
}

function dateOnly(v: string): Date {
  return new Date(`${v}T00:00:00Z`);
}

function clockStr(v: Date | null): string | null {
  if (!v) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
}

function toClock(v: string | null): Date | null {
  return v === null ? null : new Date(`1970-01-01T${v}:00Z`);
}
