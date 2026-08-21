import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  ACTUAL_OPEN_STATUSES,
  buildVariance,
  evaluateConfirmGate,
  reopenBlockReason,
  toPageResult,
  type ActualDetail,
  type ActualExceptionRow,
  type ActualHistoryEntry,
  type ActualListItem,
  type ActualListSummary,
  type ActualOrderRow,
  type ActualReviewInput,
  type ActualStopRow,
  type BulkResult,
  type PageResult,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ActualReportService } from './actual-report.service.js';
import {
  EXECUTION_FOR_ACTUAL,
  buildActualFromExecution,
  stopWaitMinutes,
} from './actual-build.js';

export interface ActualListQuery {
  from: string;
  to: string;
  status: string | null;
  carrierId: string | null;
  keyword: string;
  /** 확정을 막고 있는 것만 */
  blockedOnly: boolean;
  page: number;
  size: number;
  sort: string;
}

/**
 * 실적 — 생성 · 검수 · 확정.
 *
 * ## 실적은 실행에서 자란다
 *
 * `transport_actual.execution_id` 는 1:1 유니크다. 운송이 끝나면 실적 한 행이
 * 생기고, 그 뒤로는 실행 기록을 다시 읽지 않는다. 실적은 **그 시점의 사실을
 * 얼려 둔 스냅샷**이기 때문이다 — 운송사명 · 차량번호까지 칸으로 들고 있는
 * 이유가 그것이다. 나중에 운송사 이름이 바뀌어도 지난달 청구서의 이름은
 * 그대로여야 한다.
 *
 * ## 확정이 경계다
 *
 * 확정 전에는 다시 만들 수 있고, 확정 후에는 조정 전표로만 바꾼다. 그
 * 경계를 지키는 판정은 `@ntms/shared` 의 `evaluateConfirmGate()` 한 벌이고
 * 화면과 서버가 같이 부른다. 여기서 서버가 한 번 더 부르는 것은 화면을
 * 믿지 않기 때문이 아니라, 화면이 판정한 뒤 실제로 확정을 누르기까지 사이에
 * 인수증이 취소될 수 있기 때문이다.
 */
@Injectable()
export class ActualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly report: ActualReportService,
  ) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // 목록
  // ===================================================================

  async list(
    principal: AuthPrincipal,
    query: ActualListQuery,
  ): Promise<PageResult<ActualListItem> & { summary: ActualListSummary }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const gte = dateOnly(query.from);
      const lte = dateOnly(query.to);

      const where = {
        tenant_id,
        actual_date: { gte, lte },
        ...(query.status === 'OPEN'
          ? { confirm_status: { in: [...ACTUAL_OPEN_STATUSES] as never } }
          : query.status
            ? { confirm_status: query.status as never }
            : {}),
        ...(query.carrierId ? { carrier_id: BigInt(query.carrierId) } : {}),
        ...(query.keyword
          ? {
              OR: [
                { actual_no: { contains: query.keyword, mode: 'insensitive' as const } },
                { vehicle_no: { contains: query.keyword, mode: 'insensitive' as const } },
                { carrier_name: { contains: query.keyword, mode: 'insensitive' as const } },
                { driver_name: { contains: query.keyword, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      /*
        조건에 걸린 **전부**를 한 번 훑는다.

        합계와 "확정을 막는 건수" 는 페이지가 아니라 조건 전체를 더한 값이어야
        한다(디자인 시스템 10-4). 그런데 관문 판정에는 인수증 확인 수와 정산
        영향 예외처럼 헤더에 없는 값이 필요하다. 그래서 가벼운 칸만 골라
        전량을 읽고, 거기서 나온 실행 ID 로 두 번의 groupBy 를 돈다.

        기간이 한 달이어도 수백 행이다. 페이지마다 서브쿼리를 도는 것보다
        이쪽이 빠르고, 무엇보다 합계가 맞는다.
      */
      const all = await tx.transport_actual.findMany({
        where,
        select: {
          actual_id: true,
          execution_id: true,
          actual_date: true,
          confirm_status: true,
          order_count: true,
          stop_count: true,
          completed_stop_count: true,
          pod_completed: true,
          actual_weight_kg: true,
          actual_distance_km: true,
          planned_distance_km: true,
          billing_amount: true,
          payment_amount: true,
          margin_amount: true,
          on_time_delivery: true,
        },
      });

      const gate = await this.gateInputs(
        tx,
        tenant_id,
        all.map((a) => a.execution_id),
        [gte, lte],
      );

      const verdicts = new Map(
        all.map((a) => [
          String(a.actual_id),
          evaluateConfirmGate({
            confirmStatus: a.confirm_status,
            orderCount: a.order_count,
            podCollectedCount: gate.podCollected.get(String(a.execution_id)) ?? 0,
            podConfirmedCount: gate.podConfirmed.get(String(a.execution_id)) ?? 0,
            openSettlementExceptionCount: gate.openExceptions.get(String(a.execution_id)) ?? 0,
            incompleteStopCount: Math.max(0, a.stop_count - a.completed_stop_count),
            stopCount: a.stop_count,
            plannedDistanceKm: num(a.planned_distance_km),
            actualDistanceKm: num(a.actual_distance_km),
            periodClosed: gate.isClosed(a.actual_date),
          }),
        ]),
      );

      const blockedIds = new Set(
        all
          .filter((a) => {
            const v = verdicts.get(String(a.actual_id))!;
            return v.blockerCount > 0 && isOpen(a.confirm_status);
          })
          .map((a) => String(a.actual_id)),
      );

      // 조건 전체 합계 — 페이지가 아니다
      const billing = sum(all.map((a) => num(a.billing_amount) ?? 0));
      const payment = sum(all.map((a) => num(a.payment_amount) ?? 0));
      const onTimeKnown = all.filter((a) => a.on_time_delivery !== null);

      const summary: ActualListSummary = {
        count: all.length,
        openCount: all.filter((a) => isOpen(a.confirm_status)).length,
        confirmedCount: all.filter(
          (a) => a.confirm_status === 'CONFIRMED' || a.confirm_status === 'CLOSED',
        ).length,
        totalDistanceKm: round(sum(all.map((a) => num(a.actual_distance_km) ?? 0)), 1),
        totalWeightKg: round(sum(all.map((a) => num(a.actual_weight_kg) ?? 0)), 0),
        billingAmount: billing,
        paymentAmount: payment,
        marginAmount: sum(all.map((a) => num(a.margin_amount) ?? 0)),
        marginRate: billing === 0 ? null : round(((billing - payment) / billing) * 100, 1),
        onTimeRate:
          onTimeKnown.length === 0
            ? null
            : round(
                (onTimeKnown.filter((a) => a.on_time_delivery).length / onTimeKnown.length) * 100,
                1,
              ),
        blockedCount: blockedIds.size,
        pendingGeneration: await this.countPending(tx, tenant_id, gte, lte),
      };

      // 걸러낸 뒤에 쪽을 나눈다. 막힌 건만 보기는 조건이지 정렬이 아니다.
      const filtered = query.blockedOnly
        ? all.filter((a) => blockedIds.has(String(a.actual_id)))
        : all;

      const ids = sortIds(filtered, query.sort).slice(
        (query.page - 1) * query.size,
        query.page * query.size,
      );

      const rows =
        ids.length === 0
          ? []
          : await tx.transport_actual.findMany({
              where: { tenant_id, actual_id: { in: ids.map((i) => BigInt(i)) } },
              include: { trip: { select: { trip_no: true } } },
            });

      // findMany 는 in 절의 순서를 지키지 않는다. 정렬한 순서를 되살린다.
      const byId = new Map(rows.map((r) => [String(r.actual_id), r]));
      const items: ActualListItem[] = ids.flatMap((id) => {
        const r = byId.get(id);
        if (!r) return [];
        const v = verdicts.get(id)!;
        const planned = num(r.planned_distance_km);
        const actual = num(r.actual_distance_km);

        return [
          {
            actualId: id,
            actualNo: r.actual_no,
            actualDate: isoDate(r.actual_date),
            confirmStatus: r.confirm_status,
            tripNo: r.trip?.trip_no ?? '',
            executionId: String(r.execution_id),
            carrierName: r.carrier_name,
            vehicleNo: r.vehicle_no,
            driverName: r.driver_name,
            fromLocationName: r.from_location_name,
            toLocationName: r.to_location_name,
            orderCount: r.order_count,
            stopCount: r.stop_count,
            actualWeightKg: num(r.actual_weight_kg) ?? 0,
            plannedDistanceKm: planned,
            actualDistanceKm: actual,
            distanceVarianceKm: num(r.distance_variance_km),
            distanceVarianceRate:
              planned && actual && planned > 0 ? round(((actual - planned) / planned) * 100, 1) : null,
            waitingMinutes: r.waiting_minutes,
            delayMinutes: r.delay_minutes,
            loadingRate: num(r.loading_rate),
            onTimeDelivery: r.on_time_delivery,
            podCompleted: r.pod_completed,
            exceptionCount: r.exception_count,
            damageCount: r.damage_count,
            billingAmount: num(r.billing_amount),
            paymentAmount: num(r.payment_amount),
            marginAmount: num(r.margin_amount),
            marginRate: num(r.margin_rate),
            billingSettled: r.billing_settled,
            paymentSettled: r.payment_settled,
            confirmedAt: iso(r.confirmed_at),
            blockerCount: v.blockerCount,
            cautionCount: v.cautionCount,
            canConfirm: v.canConfirm,
            blockedReason: v.blockedReason,
          },
        ];
      });

      return { ...toPageResult(items, filtered.length, query.page, query.size), summary };
    });
  }

  // ===================================================================
  // 상세
  // ===================================================================

  async detail(principal: AuthPrincipal, actualId: string): Promise<ActualDetail> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const id = toBigInt(actualId);

      const row = await tx.transport_actual.findFirst({
        where: { tenant_id, actual_id: id },
        include: {
          trip: {
            select: {
              trip_no: true,
              planned_start_at: true,
              planned_end_at: true,
              weight_loading_rate: true,
            },
          },
          dispatch: { select: { vehicle_type_name: true } },
        },
      });
      if (!row) throw AppError.notFound('ACTUAL_NOT_FOUND', '실적을 찾을 수 없습니다.');

      const [orderRows, stopRows, exceptionRows, closed, confirmer] = await Promise.all([
        tx.actual_order.findMany({
          where: { tenant_id, actual_id: id },
          include: {
            transport_order: { select: { order_no: true, to_location_name: true } },
            business_partner: { select: { partner_name: true } },
            pod: { select: { pod_no: true, is_confirmed: true } },
          },
          orderBy: { actual_order_id: 'asc' },
        }),
        tx.execution_stop.findMany({
          where: { tenant_id, execution_id: row.execution_id },
          // 계획 작업시간은 편성이 잡은 값이라 trip_stop 에 있다. 실행 정차로
          // 복사해 두지 않은 것은, 편성이 바뀌면 계획도 같이 바뀌어야 해서다.
          include: { trip_stop: { select: { planned_service_min: true } } },
          orderBy: { stop_seq: 'asc' },
        }),
        tx.transport_exception.findMany({
          where: { tenant_id, execution_id: row.execution_id },
          orderBy: { occurred_at: 'asc' },
        }),
        this.closedPeriods(tx, tenant_id, [row.actual_date, row.actual_date]),
        row.confirmed_by === null
          ? null
          : tx.user_account.findFirst({
              where: { tenant_id, user_id: row.confirmed_by },
              select: { user_name: true },
            }),
      ]);

      const orders: ActualOrderRow[] = orderRows.map((o) => ({
        actualOrderId: String(o.actual_order_id),
        orderId: String(o.order_id),
        orderNo: o.transport_order.order_no,
        shipperName: o.business_partner.partner_name,
        toLocationName: o.transport_order.to_location_name,
        deliveredQty: num(o.delivered_qty) ?? 0,
        deliveredWeightKg: num(o.delivered_weight_kg) ?? 0,
        damagedQty: num(o.damaged_qty) ?? 0,
        shortageQty: num(o.shortage_qty) ?? 0,
        returnedQty: num(o.returned_qty) ?? 0,
        deliveryResult: o.delivery_result,
        deliveredAt: iso(o.delivered_at),
        allocationBasis: o.allocation_basis,
        allocationRatio: num(o.allocation_ratio),
        billingAmount: num(o.billing_amount),
        paymentAmount: num(o.payment_amount),
        onTimeDelivery: o.on_time_delivery,
        podId: o.pod_id === null ? null : String(o.pod_id),
        podNo: o.pod?.pod_no ?? null,
        podConfirmed: o.pod?.is_confirmed ?? false,
      }));

      const stops: ActualStopRow[] = stopRows.map((s) => ({
        stopSeq: s.stop_seq,
        stopType: s.stop_type,
        locationName: s.location_name ?? '—',
        status: s.status,
        plannedArrivalAt: iso(s.planned_arrival_at),
        actualArrivalAt: iso(s.actual_arrival_at),
        plannedDepartureAt: iso(s.planned_departure_at),
        actualDepartureAt: iso(s.actual_departure_at),
        plannedServiceMin: s.trip_stop?.planned_service_min ?? null,
        actualServiceMin: s.actual_service_min,
        waitMinutes: stopWaitMinutes(s),
        delayMinutes: s.delay_minutes,
        isOnTime: s.is_on_time,
      }));

      const exceptions: ActualExceptionRow[] = exceptionRows.map((e) => ({
        exceptionId: String(e.exception_id),
        exceptionNo: e.exception_no,
        exceptionType: e.exception_type,
        severity: e.severity,
        status: e.status,
        occurredAt: iso(e.occurred_at)!,
        description: e.description,
        actionTaken: e.action_taken,
        impactMinutes: e.impact_minutes,
        damageAmount: num(e.damage_amount),
        liabilityParty: e.liability_party,
        settlementImpact: e.settlement_impact,
      }));

      const periodClosed = closed.isClosed(row.actual_date);
      const gate = evaluateConfirmGate({
        confirmStatus: row.confirm_status,
        orderCount: row.order_count,
        podCollectedCount: orders.filter((o) => o.podId !== null).length,
        podConfirmedCount: orders.filter((o) => o.podConfirmed).length,
        openSettlementExceptionCount: exceptions.filter(
          (e) => e.settlementImpact && !['RESOLVED', 'CLOSED'].includes(e.status),
        ).length,
        incompleteStopCount: Math.max(0, row.stop_count - row.completed_stop_count),
        stopCount: row.stop_count,
        plannedDistanceKm: num(row.planned_distance_km),
        actualDistanceKm: num(row.actual_distance_km),
        periodClosed,
      });

      const plannedLoadingRate = num(row.trip?.weight_loading_rate ?? null);

      const history: ActualHistoryEntry[] = [
        { at: iso(row.created_at)!, label: '실적 생성', detail: `실행 기록에서 만들었습니다` },
      ];
      if (row.confirmed_at) {
        history.push({
          at: iso(row.confirmed_at)!,
          label: '확정',
          detail: confirmer?.user_name ? `${confirmer.user_name}` : null,
        });
      }
      if (row.reopened_at) {
        history.push({ at: iso(row.reopened_at)!, label: '확정 해제', detail: row.reopen_reason });
      }
      if (row.closed_at) {
        history.push({ at: iso(row.closed_at)!, label: '마감', detail: '정산 기간이 닫혔습니다' });
      }
      history.sort((a, b) => a.at.localeCompare(b.at));

      return {
        actualId,
        actualNo: row.actual_no,
        actualDate: isoDate(row.actual_date),
        confirmStatus: row.confirm_status,
        executionId: String(row.execution_id),
        tripId: String(row.trip_id),
        tripNo: row.trip?.trip_no ?? '',
        carrierId: String(row.carrier_id),
        carrierName: row.carrier_name,
        vehicleNo: row.vehicle_no,
        vehicleTypeName: row.dispatch?.vehicle_type_name ?? null,
        driverName: row.driver_name,
        fromLocationName: row.from_location_name,
        toLocationName: row.to_location_name,

        orderCount: row.order_count,
        stopCount: row.stop_count,
        completedStopCount: row.completed_stop_count,
        actualQty: num(row.actual_qty) ?? 0,
        actualWeightKg: num(row.actual_weight_kg) ?? 0,
        actualVolumeCbm: num(row.actual_volume_cbm) ?? 0,
        actualPalletQty: num(row.actual_pallet_qty) ?? 0,

        plannedDistanceKm: num(row.planned_distance_km),
        actualDistanceKm: num(row.actual_distance_km),
        distanceVarianceKm: num(row.distance_variance_km),
        emptyDistanceKm: num(row.empty_distance_km),
        plannedDurationMin: row.planned_duration_min,
        actualDurationMin: row.actual_duration_min,
        plannedLoadingRate,
        loadingRate: num(row.loading_rate),

        plannedStartAt: iso(row.trip?.planned_start_at ?? null),
        plannedEndAt: iso(row.trip?.planned_end_at ?? null),
        actualStartAt: iso(row.actual_start_at),
        actualEndAt: iso(row.actual_end_at),
        waitingMinutes: row.waiting_minutes,
        delayMinutes: row.delay_minutes,

        onTimePickup: row.on_time_pickup,
        onTimeDelivery: row.on_time_delivery,
        podCompleted: row.pod_completed,
        exceptionCount: row.exception_count,
        damageCount: row.damage_count,

        fuelConsumedLiter: num(row.fuel_consumed_liter),
        fuelCost: num(row.fuel_cost),
        tollFee: num(row.toll_fee),
        otherCost: num(row.other_cost),

        billingAmount: num(row.billing_amount),
        paymentAmount: num(row.payment_amount),
        marginAmount: num(row.margin_amount),
        marginRate: num(row.margin_rate),
        billingSettled: row.billing_settled,
        paymentSettled: row.payment_settled,

        confirmedAt: iso(row.confirmed_at),
        confirmedByName: confirmer?.user_name ?? null,
        reopenedAt: iso(row.reopened_at),
        reopenReason: row.reopen_reason,
        remark: row.remark,

        variance: buildVariance({
          plannedDistanceKm: num(row.planned_distance_km),
          actualDistanceKm: num(row.actual_distance_km),
          plannedDurationMin: row.planned_duration_min,
          actualDurationMin: row.actual_duration_min,
          waitingMinutes: row.waiting_minutes,
          delayMinutes: row.delay_minutes,
          plannedLoadingRate,
          loadingRate: num(row.loading_rate),
        }),
        gate,
        reopenBlockedReason: reopenBlockReason({
          confirmStatus: row.confirm_status,
          billingSettled: row.billing_settled,
          paymentSettled: row.payment_settled,
          periodClosed,
        }),
        orders,
        stops,
        exceptions,
        history,
      };
    });
  }

  // ===================================================================
  // 생성
  // ===================================================================

  /**
   * 완료된 운송에서 실적을 만든다.
   *
   * 이미 실적이 있는 실행은 건드리지 않는다 — 확정된 숫자를 조용히 덮어쓰는
   * 것이 이 도메인에서 가장 나쁜 일이다. 다시 만들어야 하면 확정을 먼저
   * 되돌리고 실적을 지운 뒤에 부른다.
   */
  async generate(principal: AuthPrincipal, from: string, to: string): Promise<BulkResult> {
    const dates = await this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const gte = dateOnly(from);
      const lte = dateOnly(to);

      const targets = await tx.transport_execution.findMany({
        where: {
          tenant_id,
          status: 'COMPLETED',
          execution_date: { gte, lte },
          transport_actual: { is: null },
        },
        include: EXECUTION_FOR_ACTUAL,
        orderBy: { execution_date: 'asc' },
      });

      const result: BulkResult = { requested: targets.length, succeeded: 0, failures: [] };
      const touched = new Set<string>();

      for (const exec of targets) {
        const label = exec.dispatch?.vehicle_no ?? String(exec.execution_id);
        try {
          await buildActualFromExecution(
            tx,
            { tenantId: principal.tenantId, userId: principal.userId },
            exec,
          );
          result.succeeded += 1;
          touched.add(isoDate(exec.execution_date));
        } catch (error) {
          // 한 건이 막혀도 나머지는 만든다. 마감된 기간이 섞여 있을 때
          // 전부 되돌리면 열려 있는 날까지 못 만든다.
          result.failures.push({
            id: String(exec.execution_id),
            label: `${exec.trip?.trip_no ?? ''} ${label}`.trim(),
            reason: reasonOf(error),
          });
        }
      }

      return { result, dates: [...touched] };
    });

    // 실적이 생겼으면 운행일보와 집계도 그 날짜만큼 다시 만든다.
    // 화면마다 "다시 집계" 를 누르게 하면 숫자가 어긋난 채로 남는다.
    await this.report.rebuild(principal, dates.dates);
    return dates.result;
  }

  // ===================================================================
  // 검수 · 확정
  // ===================================================================

  /**
   * 검수 입력.
   *
   * 실비를 손대면 상태가 `REVIEWING` 으로 간다. 누가 이미 들여다본 건이라는
   * 표시가 있어야, 여럿이 나눠 검수할 때 같은 건을 두 번 열지 않는다.
   */
  async review(
    principal: AuthPrincipal,
    actualId: string,
    dto: ActualReviewInput,
  ): Promise<{ actualId: string; confirmStatus: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const row = await tx.transport_actual.findFirst({
        where: { tenant_id, actual_id: toBigInt(actualId) },
        select: { actual_id: true, confirm_status: true, actual_date: true },
      });
      if (!row) throw AppError.notFound('ACTUAL_NOT_FOUND', '실적을 찾을 수 없습니다.');
      if (!isOpen(row.confirm_status)) {
        throw AppError.conflict(
          'ACTUAL_NOT_EDITABLE',
          '확정된 실적은 고칠 수 없습니다. 먼저 확정을 되돌리세요.',
        );
      }

      const next = row.confirm_status === 'DRAFT' ? 'REVIEWING' : row.confirm_status;
      await tx.transport_actual.update({
        where: { actual_id: row.actual_id },
        data: {
          waiting_minutes: dto.waitingMinutes ?? undefined,
          fuel_consumed_liter: dto.fuelConsumedLiter,
          fuel_cost: dto.fuelCost,
          toll_fee: dto.tollFee,
          other_cost: dto.otherCost,
          remark: dto.remark,
          confirm_status: next as never,
          updated_by: principal.userId,
        },
      });

      return { actualId, confirmStatus: next };
    });
  }

  /** 검수 보류 — 내가 못 닫는 건이라는 표시를 남기고 넘긴다 */
  async hold(
    principal: AuthPrincipal,
    actualId: string,
    reason: string,
  ): Promise<{ actualId: string; confirmStatus: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const row = await tx.transport_actual.findFirst({
        where: { tenant_id, actual_id: toBigInt(actualId) },
        select: { actual_id: true, confirm_status: true },
      });
      if (!row) throw AppError.notFound('ACTUAL_NOT_FOUND', '실적을 찾을 수 없습니다.');
      if (!isOpen(row.confirm_status)) {
        throw AppError.conflict(
          'ACTUAL_NOT_EDITABLE',
          '확정된 실적은 보류할 수 없습니다. 먼저 확정을 되돌리세요.',
        );
      }

      await tx.transport_actual.update({
        where: { actual_id: row.actual_id },
        data: { confirm_status: 'REVIEWING', remark: reason, updated_by: principal.userId },
      });
      return { actualId, confirmStatus: 'REVIEWING' };
    });
  }

  /**
   * 확정 — 여러 건을 한 번에.
   *
   * 한 건이 막혀도 나머지는 확정한다. 대신 **왜 막혔는지를 건마다 돌려준다** —
   * "3건 실패" 만 알려 주면 사용자는 목록으로 돌아가 하나씩 열어 봐야 한다.
   */
  async confirm(principal: AuthPrincipal, actualIds: string[]): Promise<BulkResult> {
    const outcome = await this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const ids = actualIds.map((v) => toBigInt(v));

      const rows = await tx.transport_actual.findMany({
        where: { tenant_id, actual_id: { in: ids } },
        select: {
          actual_id: true,
          actual_no: true,
          actual_date: true,
          execution_id: true,
          confirm_status: true,
          order_count: true,
          stop_count: true,
          completed_stop_count: true,
          planned_distance_km: true,
          actual_distance_km: true,
        },
      });

      const dates = rows.map((r) => r.actual_date);
      const [gate, closed] = await Promise.all([
        this.gateInputs(
          tx,
          tenant_id,
          rows.map((r) => r.execution_id),
          null,
        ),
        this.closedPeriods(tx, tenant_id, [minDate(dates), maxDate(dates)]),
      ]);

      const result: BulkResult = { requested: actualIds.length, succeeded: 0, failures: [] };
      const touched = new Set<string>();
      const now = new Date();

      for (const id of actualIds) {
        const row = rows.find((r) => String(r.actual_id) === id);
        if (!row) {
          result.failures.push({ id, label: id, reason: '실적을 찾을 수 없습니다.' });
          continue;
        }

        const verdict = evaluateConfirmGate({
          confirmStatus: row.confirm_status,
          orderCount: row.order_count,
          podCollectedCount: gate.podCollected.get(String(row.execution_id)) ?? 0,
          podConfirmedCount: gate.podConfirmed.get(String(row.execution_id)) ?? 0,
          openSettlementExceptionCount: gate.openExceptions.get(String(row.execution_id)) ?? 0,
          incompleteStopCount: Math.max(0, row.stop_count - row.completed_stop_count),
          stopCount: row.stop_count,
          plannedDistanceKm: num(row.planned_distance_km),
          actualDistanceKm: num(row.actual_distance_km),
          periodClosed: closed.isClosed(row.actual_date),
        });

        if (!verdict.canConfirm) {
          result.failures.push({
            id,
            label: row.actual_no,
            reason: verdict.blockedReason ?? '확정할 수 없는 상태입니다.',
          });
          continue;
        }

        await tx.transport_actual.update({
          where: { actual_id: row.actual_id },
          data: {
            confirm_status: 'CONFIRMED',
            confirmed_at: now,
            confirmed_by: principal.userId,
            // 되돌렸다가 다시 확정한 건이면 해제 흔적을 지운다. 남겨 두면
            // 이력에 "해제됨" 이 계속 떠서 지금 상태를 잘못 읽게 된다.
            reopened_at: null,
            reopen_reason: null,
            updated_by: principal.userId,
          },
        });
        result.succeeded += 1;
        touched.add(isoDate(row.actual_date));
      }

      return { result, dates: [...touched] };
    });

    // 확정이 KPI 를 바꾼다 — KPI 는 확정된 실적만 세기 때문이다
    await this.report.rebuild(principal, outcome.dates);
    return outcome.result;
  }

  /** 확정 해제 — 사유 없이는 못 되돌린다 */
  async reopen(
    principal: AuthPrincipal,
    actualId: string,
    reason: string,
  ): Promise<{ actualId: string; confirmStatus: string }> {
    const outcome = await this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const row = await tx.transport_actual.findFirst({
        where: { tenant_id, actual_id: toBigInt(actualId) },
        select: {
          actual_id: true,
          actual_date: true,
          confirm_status: true,
          billing_settled: true,
          payment_settled: true,
        },
      });
      if (!row) throw AppError.notFound('ACTUAL_NOT_FOUND', '실적을 찾을 수 없습니다.');

      const closed = await this.closedPeriods(tx, tenant_id, [row.actual_date, row.actual_date]);
      const blocked = reopenBlockReason({
        confirmStatus: row.confirm_status,
        billingSettled: row.billing_settled,
        paymentSettled: row.payment_settled,
        periodClosed: closed.isClosed(row.actual_date),
      });
      if (blocked) throw AppError.conflict('ACTUAL_REOPEN_BLOCKED', blocked);

      await tx.transport_actual.update({
        where: { actual_id: row.actual_id },
        data: {
          confirm_status: 'REOPENED',
          reopened_at: new Date(),
          reopen_reason: reason,
          updated_by: principal.userId,
        },
      });
      return isoDate(row.actual_date);
    });

    await this.report.rebuild(principal, [outcome]);
    return { actualId, confirmStatus: 'REOPENED' };
  }

  // ===================================================================
  // 관문에 필요한 값
  // ===================================================================

  /**
   * 헤더에 없는 관문 재료를 한 번에 모은다.
   *
   * 인수증 확인 수와 정산 영향 예외는 실적 헤더가 안 들고 있다. 일부러
   * 그렇게 뒀다 — 인수증은 실적 확정 뒤에도 확인 상태가 바뀔 수 있어서,
   * 헤더에 복사해 두면 두 값이 갈라진다.
   */
  private async gateInputs(
    tx: TxClient,
    tenant_id: bigint,
    executionIds: bigint[],
    range: [Date, Date] | null,
  ): Promise<{
    podCollected: Map<string, number>;
    podConfirmed: Map<string, number>;
    openExceptions: Map<string, number>;
    isClosed: (d: Date) => boolean;
  }> {
    const ids = [...new Set(executionIds)];
    if (ids.length === 0) {
      const closed = range ? await this.closedPeriods(tx, tenant_id, range) : { isClosed: () => false };
      return {
        podCollected: new Map(),
        podConfirmed: new Map(),
        openExceptions: new Map(),
        isClosed: closed.isClosed,
      };
    }

    const [pods, exceptions, closed] = await Promise.all([
      tx.pod.findMany({
        where: { tenant_id, execution_id: { in: ids } },
        select: { execution_id: true, is_confirmed: true },
      }),
      tx.transport_exception.groupBy({
        by: ['execution_id'],
        where: {
          tenant_id,
          execution_id: { in: ids },
          settlement_impact: true,
          status: { notIn: ['RESOLVED', 'CLOSED'] },
        },
        _count: { _all: true },
      }),
      this.closedPeriods(tx, tenant_id, range),
    ]);

    const podCollected = new Map<string, number>();
    const podConfirmed = new Map<string, number>();
    for (const p of pods) {
      const key = String(p.execution_id);
      podCollected.set(key, (podCollected.get(key) ?? 0) + 1);
      if (p.is_confirmed) podConfirmed.set(key, (podConfirmed.get(key) ?? 0) + 1);
    }

    return {
      podCollected,
      podConfirmed,
      openExceptions: new Map(exceptions.map((e) => [String(e.execution_id), e._count._all])),
      isClosed: closed.isClosed,
    };
  }

  /**
   * 마감된 정산 기간.
   *
   * DB 트리거가 어차피 막지만, 화면이 먼저 말해 줘야 사용자가 헛수고를
   * 안 한다. 매출·매입 중 한쪽만 마감돼도 실적은 못 건드린다 — 트리거가
   * settlement_type 을 안 가리기 때문이고, 그게 맞다.
   */
  private async closedPeriods(
    tx: TxClient,
    tenant_id: bigint,
    range: [Date, Date] | null,
  ): Promise<{ isClosed: (d: Date) => boolean }> {
    const rows = await tx.settlement_close.findMany({
      where: {
        tenant_id,
        status: 'CLOSED',
        ...(range ? { period_from: { lte: range[1] }, period_to: { gte: range[0] } } : {}),
      },
      select: { period_from: true, period_to: true },
    });
    if (rows.length === 0) return { isClosed: () => false };

    const spans = rows.map((r) => [r.period_from.getTime(), r.period_to.getTime()] as const);
    return {
      isClosed: (d: Date) => {
        const t = d.getTime();
        return spans.some(([a, b]) => t >= a && t <= b);
      },
    };
  }

  /** 아직 실적이 안 만들어진 완료 운송 */
  private countPending(tx: TxClient, tenant_id: bigint, gte: Date, lte: Date): Promise<number> {
    return tx.transport_execution.count({
      where: {
        tenant_id,
        status: 'COMPLETED',
        execution_date: { gte, lte },
        transport_actual: { is: null },
      },
    });
  }
}

// ---------------------------------------------------------------------

/** 목록 정렬. 쿼리 문자열을 그대로 orderBy 에 넘기지 않기 위해 여기서 건다 */
function sortIds(
  rows: {
    actual_id: bigint;
    actual_date: Date;
    confirm_status: string;
    actual_distance_km: unknown;
    planned_distance_km: unknown;
    billing_amount: unknown;
  }[],
  sort: string,
): string[] {
  const [key, dir] = sort.split(':');
  const sign = dir === 'asc' ? 1 : -1;

  const value = (r: (typeof rows)[number]): number => {
    switch (key) {
      case 'variance': {
        const p = num(r.planned_distance_km);
        const a = num(r.actual_distance_km);
        return p && a && p > 0 ? Math.abs((a - p) / p) : 0;
      }
      case 'billing':
        return num(r.billing_amount) ?? 0;
      case 'distance':
        return num(r.actual_distance_km) ?? 0;
      default:
        return r.actual_date.getTime();
    }
  };

  return [...rows]
    .sort((a, b) => {
      const d = (value(a) - value(b)) * sign;
      // 같은 값이면 번호 역순. 정렬이 흔들리면 쪽을 넘길 때 같은 행이 두 번 나온다.
      return d !== 0 ? d : Number(b.actual_id - a.actual_id);
    })
    .map((r) => String(r.actual_id));
}

function isOpen(status: string): boolean {
  return (ACTUAL_OPEN_STATUSES as readonly string[]).includes(status);
}

function reasonOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  // Postgres 가 올려 준 마감 보호 예외를 사람 말로 바꾼다
  if (message.includes('마감된 정산 기간')) {
    return '마감된 정산 기간입니다. 마감을 풀어야 실적을 만들 수 있습니다.';
  }
  return '실적을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 그날 자정(UTC). 로컬 자정으로 만들면 KST 에서 하루 밀린다 */
function dateOnly(input: string): Date {
  return new Date(`${input}T00:00:00Z`);
}

function minDate(dates: Date[]): Date {
  return dates.length === 0 ? new Date(0) : new Date(Math.min(...dates.map((d) => d.getTime())));
}

function maxDate(dates: Date[]): Date {
  return dates.length === 0 ? new Date(0) : new Date(Math.max(...dates.map((d) => d.getTime())));
}

function toBigInt(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    throw AppError.notFound('ACTUAL_NOT_FOUND', '실적을 찾을 수 없습니다.');
  }
}
