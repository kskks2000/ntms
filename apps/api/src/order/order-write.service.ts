import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import type {
  OrderDetail,
  OrderFormValues,
  OrderStatus,
  TemperatureZone,
  VehicleCapacity,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/**
 * 오더 등록 · 수정 · 상세.
 *
 * 오더는 기준정보와 성격이 다르다. 기준정보는 한 번 넣고 오래 쓰는 값이고,
 * 오더는 **하루에도 수십 건이 들어오고 상태가 계속 움직이는 거래 기록**이다.
 * 그래서 두 가지를 더 챙긴다.
 *
 * 1. **오더번호를 시스템이 만든다.** 사람이 짓게 하면 중복이 나고, 무엇보다
 *    바쁜 접수 화면에서 번호를 짓는 것은 일이 아니다.
 * 2. **상태 이력을 남긴다.** 오더가 지금 왜 이 상태인지는 나중에 반드시
 *    묻게 된다. 상태만 덮어쓰면 그 답이 사라진다.
 */
@Injectable()
export class OrderWriteService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // -------------------------------------------------------------------
  // 폼이 쓰는 참조 목록
  // -------------------------------------------------------------------

  /**
   * 차종을 **적재 한계까지** 함께 내린다.
   *
   * 기준정보의 /master/options 는 이름만 준다. 오더 화면은 "이 짐을 어느
   * 차가 실을 수 있나" 를 화면에서 바로 판정해야 하므로 중량·부피·파렛트
   * 한계가 필요하다. 판정을 서버로 왕복시키면 숫자를 칠 때마다 요청이 난다.
   */
  async vehicleCapacities(principal: AuthPrincipal): Promise<VehicleCapacity[]> {
    return this.run(principal, async (tx) => {
      const rows = await tx.vehicle_type.findMany({
        where: { tenant_id: principal.tenantId, is_active: true },
        orderBy: { sort_order: 'asc' },
      });
      return rows.map((v) => ({
        id: String(v.vehicle_type_id),
        code: v.vehicle_type_code,
        name: v.vehicle_type_name,
        bodyType: v.body_type,
        tonClass: num(v.ton_class),
        maxWeightKg: num(v.max_weight_kg),
        maxVolumeCbm: num(v.max_volume_cbm),
        maxPalletQty: v.max_pallet_qty,
        temperatureZone: v.temperature_zone,
      }));
    });
  }

  /**
   * 두 거점 사이의 거리·소요시간.
   *
   * 오더 폼의 시간 축이 이 값으로 판정한다. 거점을 고를 때마다 한 번만
   * 부르고 화면이 들고 있는다 — 시각을 칠 때마다 서버에 물으면 타이핑
   * 한 번에 요청 하나가 난다.
   */
  async route(principal: AuthPrincipal, from: string | null, to: string | null) {
    if (!from || !to) return { distanceKm: null, durationMinutes: null };
    return this.run(principal, async (tx) => {
      const row = await tx.distance_master.findFirst({
        where: {
          tenant_id: principal.tenantId,
          from_location_id: toId(from),
          to_location_id: toId(to),
          is_active: true,
        },
        select: { distance_km: true, duration_minutes: true },
      });
      return {
        distanceKm: num(row?.distance_km),
        durationMinutes: row?.duration_minutes ?? null,
      };
    });
  }

  // -------------------------------------------------------------------
  // 상세
  // -------------------------------------------------------------------

  async detail(principal: AuthPrincipal, id: string): Promise<OrderDetail> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const o = await tx.transport_order.findFirst({
        where: { tenant_id, order_id: toId(id), deleted_at: null },
        include: {
          business_partner_transport_order_shipper_idTobusiness_partner: {
            select: { partner_name: true },
          },
          business_partner_transport_order_consignee_idTobusiness_partner: {
            select: { partner_name: true },
          },
          vehicle_type: { select: { vehicle_type_name: true } },
          transport_order_item: { orderBy: { line_no: 'asc' } },
          order_status_history: { orderBy: { seq_no: 'asc' } },
          trip_order: {
            include: {
              trip: {
                include: {
                  dispatch: {
                    include: {
                      vehicle: { select: { vehicle_no: true } },
                      driver_dispatch_driver_idTodriver: { select: { driver_name: true } },
                      business_partner: { select: { partner_name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!o) throw AppError.notFound('ORDER_NOT_FOUND', '오더를 찾을 수 없습니다.');

      // 구간 소요시간은 라우트 마스터가 안다. 시간 축이 이 값으로 판정한다.
      const transit =
        o.from_location_id && o.to_location_id
          ? await tx.distance_master.findFirst({
              where: {
                tenant_id,
                from_location_id: o.from_location_id,
                to_location_id: o.to_location_id,
                is_active: true,
              },
              select: { duration_minutes: true, distance_km: true },
            })
          : null;

      return {
        orderId: String(o.order_id),
        orderNo: o.order_no,
        status: o.status as OrderStatus,
        orderType: o.order_type,
        orderDate: dateStr(o.order_date) ?? '',
        externalOrderNo: o.external_order_no,

        shipperId: String(o.shipper_id),
        shipperName:
          o.business_partner_transport_order_shipper_idTobusiness_partner?.partner_name ?? '',
        consigneeId: idOrNull(o.consignee_id),
        consigneeName:
          o.business_partner_transport_order_consignee_idTobusiness_partner?.partner_name ?? null,

        fromLocationId: idOrNull(o.from_location_id),
        fromLocationName: o.from_location_name,
        fromAddress1: o.from_address1,
        fromAddress2: o.from_address2,
        fromContactName: o.from_contact_name,
        fromContactTel: o.from_contact_tel,

        toLocationId: idOrNull(o.to_location_id),
        toLocationName: o.to_location_name,
        toAddress1: o.to_address1,
        toAddress2: o.to_address2,
        toContactName: o.to_contact_name,
        toContactTel: o.to_contact_tel,

        pickupDate: dateStr(o.pickup_date),
        pickupTimeFrom: clockStr(o.pickup_time_from),
        pickupTimeTo: clockStr(o.pickup_time_to),
        deliveryDate: dateStr(o.delivery_date),
        deliveryTimeFrom: clockStr(o.delivery_time_from),
        deliveryTimeTo: clockStr(o.delivery_time_to),
        isTimeCritical: o.is_time_critical,

        totalWeightKg: num(o.total_weight_kg) ?? 0,
        totalVolumeCbm: num(o.total_volume_cbm) ?? 0,
        totalPalletQty: num(o.total_pallet_qty) ?? 0,
        totalQty: num(o.total_qty) ?? 0,

        requiredVehicleTypeId: idOrNull(o.required_vehicle_type_id),
        requiredVehicleTypeName: o.vehicle_type?.vehicle_type_name ?? null,
        temperatureZone: o.temperature_zone as TemperatureZone,
        isHazardous: o.is_hazardous,
        isExclusive: o.is_exclusive,

        freightTerms: o.freight_terms,
        priority: o.priority,
        distanceKm: num(o.distance_km) ?? num(transit?.distance_km),
        estimatedAmount: num(o.estimated_amount),
        transitMinutes: transit?.duration_minutes ?? null,

        referenceNo1: o.reference_no1,
        specialInstruction: o.special_instruction,
        remark: o.remark,

        items: o.transport_order_item.map((i) => ({
          lineNo: i.line_no,
          itemName: i.item_name,
          itemCode: i.item_code,
          qty: num(i.qty) ?? 0,
          uomCode: i.uom_code,
          weightKg: num(i.weight_kg) ?? 0,
          volumeCbm: num(i.volume_cbm) ?? 0,
          palletQty: num(i.pallet_qty),
          remark: i.remark,
        })),

        history: o.order_status_history.map((h) => ({
          seqNo: h.seq_no,
          fromStatus: h.from_status,
          toStatus: h.to_status,
          changedAt: h.changed_at.toISOString(),
          changeSource: h.change_source,
          reason: h.reason,
        })),

        trips: o.trip_order.map((to) => {
          const d = to.trip.dispatch[0];
          return {
            tripId: String(to.trip_id),
            tripNo: to.trip.trip_no,
            status: to.trip.status,
            plannedStart: to.trip.planned_start_at?.toISOString() ?? null,
            vehicleNo: d?.vehicle?.vehicle_no ?? null,
            driverName: d?.driver_dispatch_driver_idTodriver?.driver_name ?? null,
            carrierName: d?.business_partner?.partner_name ?? null,
          };
        }),

        createdAt: o.created_at.toISOString(),
        updatedAt: o.updated_at.toISOString(),
      };
    });
  }

  // -------------------------------------------------------------------
  // 등록 · 수정
  // -------------------------------------------------------------------

  async save(principal: AuthPrincipal, id: string | null, v: OrderFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;

      // 품목 합계가 오더의 총량이다. 두 곳에 따로 적게 하면 반드시 어긋난다.
      const totals = v.items.reduce(
        (acc, it) => ({
          qty: acc.qty + (it.qty ?? 0),
          weight: acc.weight + (it.weightKg ?? 0),
          volume: acc.volume + (it.volumeCbm ?? 0),
          pallet: acc.pallet + (it.palletQty ?? 0),
        }),
        { qty: 0, weight: 0, volume: 0, pallet: 0 },
      );

      const from_location_id = await ownedLocation(tx, principal, v.fromLocationId);
      const to_location_id = await ownedLocation(tx, principal, v.toLocationId);

      // 거리는 라우트 마스터에서 가져온다. 사람이 칠 값이 아니고, 쳐 봐야
      // 라우트와 어긋나기만 한다.
      const route =
        from_location_id && to_location_id
          ? await tx.distance_master.findFirst({
              where: { tenant_id, from_location_id, to_location_id, is_active: true },
              select: { distance_km: true },
            })
          : null;

      const data = {
        order_type: v.orderType,
        order_date: toDate(v.orderDate)!,
        external_order_no: v.externalOrderNo,

        shipper_id: await ownedPartner(tx, principal, v.shipperId, '화주'),
        consignee_id: v.consigneeId
          ? await ownedPartner(tx, principal, v.consigneeId, '수하처')
          : null,

        from_location_id,
        from_location_name: v.fromLocationName,
        from_address1: v.fromAddress1,
        from_address2: v.fromAddress2,
        from_contact_name: v.fromContactName,
        from_contact_tel: v.fromContactTel,

        to_location_id,
        to_location_name: v.toLocationName,
        to_address1: v.toAddress1,
        to_address2: v.toAddress2,
        to_contact_name: v.toContactName,
        to_contact_tel: v.toContactTel,

        pickup_date: toDate(v.pickupDate),
        pickup_time_from: toClock(v.pickupTimeFrom),
        pickup_time_to: toClock(v.pickupTimeTo),
        delivery_date: toDate(v.deliveryDate),
        delivery_time_from: toClock(v.deliveryTimeFrom),
        delivery_time_to: toClock(v.deliveryTimeTo),
        is_time_critical: v.isTimeCritical,

        total_item_count: v.items.length,
        total_qty: totals.qty,
        total_weight_kg: totals.weight,
        total_volume_cbm: totals.volume,
        total_pallet_qty: totals.pallet,

        required_vehicle_type_id: v.requiredVehicleTypeId
          ? await ownedVehicleType(tx, principal, v.requiredVehicleTypeId)
          : null,
        temperature_zone: v.temperatureZone,
        is_hazardous: v.isHazardous,
        is_exclusive: v.isExclusive,

        freight_terms: v.freightTerms,
        priority: v.priority,
        distance_km: num(route?.distance_km),

        reference_no1: v.referenceNo1,
        special_instruction: v.specialInstruction,
        remark: v.remark,
      };

      if (id) {
        const order_id = await ownedOrder(tx, principal, id);
        const before = await tx.transport_order.findFirstOrThrow({
          where: { order_id },
          select: { status: true },
        });

        // 이미 편성된 오더는 구간·물량을 바꿀 수 없다. 트립이 그 값을 전제로
        // 짜여 있어서, 조용히 바꾸면 트립과 오더가 서로 다른 말을 하게 된다.
        if (LOCKED_STATUS.has(before.status)) {
          throw AppError.conflict(
            'ORDER_LOCKED',
            '이미 편성·배차된 오더입니다. 바꾸려면 편성을 먼저 푸세요.',
            { status: before.status },
          );
        }

        await tx.transport_order.update({ where: { order_id }, data });
        await tx.transport_order_item.deleteMany({ where: { tenant_id, order_id } });
        await tx.transport_order_item.createMany({
          data: itemRows(tenant_id, order_id, v),
        });
        return { id: String(order_id), orderNo: null as string | null };
      }

      const order_no = await nextOrderNo(tx, tenant_id, v.orderDate);
      const row = await tx.transport_order.create({
        data: { tenant_id, order_no, status: 'RECEIVED', ...data },
      });
      await tx.transport_order_item.createMany({
        data: itemRows(tenant_id, row.order_id, v),
      });

      // 상태 이력은 여기서 넣지 않는다.
      //
      // trg_transport_order_status_log 가 INSERT · status UPDATE 마다 자동으로
      // 한 줄을 쌓는다(fn_log_order_status). 애플리케이션에서 또 넣으면
      // uk_order_status_seq (order_id, seq_no) 에 걸린다.
      //
      // 이력을 DB 트리거에 맡긴 것은 의도된 설계다 — 어느 경로로 상태가
      // 바뀌든(화면 · 배치 · 연계 · 수기 SQL) 이력이 빠지지 않는다.

      return { id: String(row.order_id), orderNo: row.order_no };
    });
  }

  /** 오더 취소 — 지우지 않는다. 왜 취소됐는지가 남아야 한다 */
  async cancel(principal: AuthPrincipal, id: string, reason: string) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const order_id = await ownedOrder(tx, principal, id);
      const before = await tx.transport_order.findFirstOrThrow({
        where: { order_id },
        select: { status: true },
      });

      if (before.status === 'CANCELLED') {
        throw AppError.conflict('ORDER_ALREADY_CANCELLED', '이미 취소된 오더입니다.');
      }
      if (LOCKED_STATUS.has(before.status)) {
        throw AppError.conflict(
          'ORDER_LOCKED',
          '이미 편성·배차된 오더입니다. 편성을 먼저 푸세요.',
          { status: before.status },
        );
      }

      await tx.transport_order.update({
        where: { order_id },
        data: {
          status: 'CANCELLED',
          cancel_reason: reason,
          cancelled_at: new Date(),
          cancelled_by: principal.userId,
        },
      });

      // 이력 줄은 트리거가 이미 쌓았다. 다만 트리거는 **사유를 모른다** —
      // 상태만 보고 찍기 때문이다. 방금 쌓인 줄에 사유를 채워 넣는다.
      // 그래야 "이 건 왜 취소됐나" 에 이력만 보고 답할 수 있다.
      const logged = await tx.order_status_history.findFirst({
        where: { tenant_id, order_id, to_status: 'CANCELLED' },
        orderBy: { seq_no: 'desc' },
        select: { order_status_history_id: true },
      });
      if (logged) {
        await tx.order_status_history.update({
          where: { order_status_history_id: logged.order_status_history_id },
          data: { reason, change_source: 'MANUAL', changed_by: principal.userId },
        });
      }

      return { id: String(order_id) };
    });
  }
}

// ---------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------

/** 이 상태부터는 트립이 오더를 물고 있어 내용을 바꿀 수 없다 */
const LOCKED_STATUS = new Set([
  'PLANNED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CLOSED',
]);

function itemRows(tenant_id: bigint, order_id: bigint, v: OrderFormValues) {
  return v.items.map((it, i) => ({
    tenant_id,
    order_id,
    line_no: i + 1,
    item_name: it.itemName,
    item_code: it.itemCode,
    qty: it.qty ?? 0,
    uom_code: it.uomCode ?? 'EA',
    // 이 셋은 NOT NULL DEFAULT 0 이다. null 을 넣으면 저장에서 터진다.
    weight_kg: it.weightKg ?? 0,
    volume_cbm: it.volumeCbm ?? 0,
    pallet_qty: it.palletQty,
    remark: it.remark,
  }));
}

/**
 * 오더번호를 만든다 — `ORD-YYMMDD-0001`.
 *
 * 날짜를 넣는 이유는 사람이 번호만 보고 언제 것인지 알기 위해서다. 배차실
 * 전화 통화에서 "오늘 들어온 12번" 같은 말이 실제로 오간다.
 *
 * 같은 날의 마지막 번호에 1을 더한다. 동시에 두 건이 들어오면 유니크
 * 인덱스(ux_order_no)가 막고, 그때는 재시도한다.
 */
async function nextOrderNo(tx: TxClient, tenant_id: bigint, orderDate: string): Promise<string> {
  const yymmdd = orderDate.slice(2).replace(/-/g, '');
  const prefix = `ORD-${yymmdd}-`;
  const last = await tx.transport_order.findFirst({
    where: { tenant_id, order_no: { startsWith: prefix } },
    orderBy: { order_no: 'desc' },
    select: { order_no: true },
  });
  const seq = last ? Number(last.order_no.slice(prefix.length)) + 1 : 1;
  return prefix + String(seq).padStart(4, '0');
}

function toId(value: string): bigint {
  if (!/^\d+$/.test(value)) throw AppError.notFound('ORDER_NOT_FOUND', '오더를 찾을 수 없습니다.');
  return BigInt(value);
}

function idOrNull(v: bigint | null): string | null {
  return v === null ? null : String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function dateStr(v: Date | null): string | null {
  return v ? v.toISOString().slice(0, 10) : null;
}

function toDate(v: string | null): Date | null {
  return v === null ? null : new Date(`${v}T00:00:00Z`);
}

function clockStr(v: Date | null): string | null {
  if (!v) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
}

function toClock(v: string | null): Date | null {
  return v === null ? null : new Date(`1970-01-01T${v}:00Z`);
}

async function ownedOrder(tx: TxClient, p: AuthPrincipal, id: string): Promise<bigint> {
  const key = toId(id);
  const found = await tx.transport_order.findFirst({
    where: { tenant_id: p.tenantId, order_id: key, deleted_at: null },
    select: { order_id: true },
  });
  if (!found) throw AppError.notFound('ORDER_NOT_FOUND', '오더를 찾을 수 없습니다.');
  return key;
}

/**
 * 참조 키가 우리 테넌트 것인지 확인한다.
 *
 * FK 에는 tenant_id 가 없어서 남의 테넌트 id 를 넣어도 DB 는 받아준다.
 * RLS 는 읽기를 막지만 그때는 이미 저장된 뒤다.
 */
async function ownedPartner(
  tx: TxClient,
  p: AuthPrincipal,
  id: string,
  label: string,
): Promise<bigint> {
  const key = toId(id);
  const found = await tx.business_partner.findFirst({
    where: { tenant_id: p.tenantId, partner_id: key, deleted_at: null },
    select: { partner_id: true },
  });
  if (!found) throw AppError.badRequest('ORDER_REF_NOT_FOUND', `고른 ${label}를 찾을 수 없습니다.`);
  return key;
}

async function ownedLocation(
  tx: TxClient,
  p: AuthPrincipal,
  id: string | null,
): Promise<bigint | null> {
  if (id === null) return null;
  const key = toId(id);
  const found = await tx.location.findFirst({
    where: { tenant_id: p.tenantId, location_id: key, deleted_at: null },
    select: { location_id: true },
  });
  if (!found) throw AppError.badRequest('ORDER_REF_NOT_FOUND', '고른 거점을 찾을 수 없습니다.');
  return key;
}

async function ownedVehicleType(
  tx: TxClient,
  p: AuthPrincipal,
  id: string,
): Promise<bigint> {
  const key = toId(id);
  const found = await tx.vehicle_type.findFirst({
    where: { tenant_id: p.tenantId, vehicle_type_id: key },
    select: { vehicle_type_id: true },
  });
  if (!found) throw AppError.badRequest('ORDER_REF_NOT_FOUND', '고른 차종을 찾을 수 없습니다.');
  return key;
}
