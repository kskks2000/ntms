import type { Prisma, TxClient } from '@ntms/db';
import { AppError } from '../common/api-error.js';

/**
 * 실행 한 건을 실적 한 건으로 옮긴다.
 *
 * ## 왜 서비스 밖에 있나
 *
 * 부르는 곳이 둘이다 — 화면의 「실적 만들기」와 데모 시드. 시드가 자기 몫의
 * 실적을 따로 만들기 시작하면 두 벌이 갈라지고, **시드가 넣은 실적과 앱이
 * 만든 실적의 계산이 달라진다.** 그러면 데모에서 멀쩡하던 화면이 실제 운영
 * 데이터에서 틀리고, 그 차이는 정산까지 가서야 드러난다.
 *
 * ## 실적은 스냅샷이다
 *
 * `transport_actual.execution_id` 는 1:1 유니크다. 운송이 끝나면 실적 한 행이
 * 생기고, 그 뒤로는 실행 기록을 다시 읽지 않는다. 운송사명 · 차량번호까지
 * 칸으로 들고 있는 이유가 그것이다 — 나중에 운송사 이름이 바뀌어도 지난달
 * 청구서의 이름은 그대로여야 한다.
 */
export interface ActualActor {
  tenantId: bigint;
  userId: bigint | null;
}

/**
 * 실적을 만드는 데 필요한 실행 한 건.
 *
 * include 를 상수로 뽑아 두고 타입을 거기서 뽑는다. 손으로 쓴 타입과 실제
 * 질의가 어긋나면 컴파일은 지나가고 런타임에서 undefined 가 된다.
 */
export const EXECUTION_FOR_ACTUAL = {
  dispatch: {
    select: {
      dispatch_id: true,
      carrier_name: true,
      vehicle_no: true,
      vehicle_type_id: true,
      vehicle_type_name: true,
      driver_name: true,
    },
  },
  trip: {
    select: {
      trip_no: true,
      planned_distance_km: true,
      planned_duration_min: true,
      planned_toll_fee: true,
      total_weight_kg: true,
      total_volume_cbm: true,
      total_pallet_qty: true,
      total_order_count: true,
      weight_loading_rate: true,
      start_location_id: true,
      end_location_id: true,
      start_zone_id: true,
      end_zone_id: true,
      estimated_billing_amount: true,
      estimated_payment_amount: true,
    },
  },
} as const satisfies Prisma.transport_executionInclude;

export type ExecutionForActual = Prisma.transport_executionGetPayload<{
  include: typeof EXECUTION_FOR_ACTUAL;
}>;

export async function buildActualFromExecution(
  tx: TxClient,
  actor: ActualActor,
  exec: ExecutionForActual,
): Promise<{ actualId: bigint; actualNo: string }> {
  const tenant_id = actor.tenantId;
  const trip = exec.trip;

  const [stops, tripOrders, pods, exceptions, locations] = await Promise.all([
    tx.execution_stop.findMany({
      where: { tenant_id, execution_id: exec.execution_id },
      include: { trip_stop: { select: { planned_service_min: true } } },
      orderBy: { stop_seq: 'asc' },
    }),
    tx.trip_order.findMany({
      where: { tenant_id, trip_id: exec.trip_id },
      include: {
        transport_order: {
          select: { order_id: true, shipper_id: true, to_location_name: true },
        },
      },
      orderBy: { seq_no: 'asc' },
    }),
    tx.pod.findMany({ where: { tenant_id, execution_id: exec.execution_id } }),
    tx.transport_exception.findMany({
      where: { tenant_id, execution_id: exec.execution_id },
      select: { exception_type: true, status: true },
    }),
    tx.location.findMany({
      where: {
        tenant_id,
        location_id: {
          in: [trip?.start_location_id, trip?.end_location_id].filter(
            (v): v is bigint => v !== null && v !== undefined,
          ),
        },
      },
      select: { location_id: true, location_name: true },
    }),
  ]);

  const locName = new Map(locations.map((l) => [String(l.location_id), l.location_name]));
  const podByOrder = new Map(pods.map((p) => [String(p.order_id), p]));

  // --- 물량 -------------------------------------------------------
  /*
    인도 실적이 있으면 그것을 쓰고, 없으면 편성이 배정한 무게를 쓴다.
    인수증이 안 들어온 오더의 무게를 0 으로 세면 적재율이 통째로 무너지고,
    그 실적은 "빈 차로 다녀왔다" 처럼 보인다.
  */
  const orderRows = tripOrders.map((to) => {
    const pod = podByOrder.get(String(to.order_id));
    const assigned = num(to.assigned_weight_kg) ?? 0;
    const delivered = pod ? (num(pod.delivered_qty) ?? assigned) : assigned;
    return { tripOrder: to, pod, assigned, delivered };
  });

  const actualWeight = sum(orderRows.map((o) => o.delivered));
  const capacity =
    trip?.weight_loading_rate && num(trip.weight_loading_rate)! > 0
      ? (num(trip.total_weight_kg) ?? 0) / (num(trip.weight_loading_rate)! / 100)
      : null;

  // --- 시간 -------------------------------------------------------
  const waiting = sum(stops.map(stopWaitMinutes));
  const actualDuration =
    exec.actual_duration_min ??
    (exec.actual_start_at && exec.actual_end_at
      ? Math.round((exec.actual_end_at.getTime() - exec.actual_start_at.getTime()) / 60_000)
      : null);

  const pickupStops = stops.filter((s) => s.stop_type === 'PICKUP');
  const deliveryStops = stops.filter((s) => s.stop_type === 'DELIVERY');

  // --- 거리 -------------------------------------------------------
  const plannedDistance = num(trip?.planned_distance_km ?? null);
  const actualDistance = num(exec.actual_distance_km);
  /*
    공차거리는 계기판이 답한다.

    주행계 차이에서 실차 노선 거리를 뺀 나머지가 노선 밖으로 달린 거리다.
    계기판이 없는 건은 null 로 남긴다 — 0 으로 채우면 "공차 없음" 이라는
    거짓말이 되고, 공차율 지표가 실제보다 좋게 나온다.
  */
  const odometerSpan =
    exec.start_odometer !== null && exec.end_odometer !== null
      ? (num(exec.end_odometer) ?? 0) - (num(exec.start_odometer) ?? 0)
      : null;
  const emptyDistance =
    odometerSpan !== null && actualDistance !== null
      ? Math.max(0, round(odometerSpan - actualDistance, 1))
      : null;

  // --- 금액 -------------------------------------------------------
  /*
    **예상 운임**이다.

    정산이 요율표로 산출한 결과가 나중에 이 칸을 덮는다(DDL 주석 참고).
    그때까지 비워 두면 실적 목록의 매출·마진 합계가 전부 0 이 되어 화면이
    쓸모없어지므로, 편성이 잡아 둔 예상값을 넣고 화면이 "예상" 이라고
    분명히 말한다. 없는 숫자를 지어내지 않으면서 빈 화면도 피하는 자리다.
  */
  const billing = num(trip?.estimated_billing_amount ?? null);
  const payment = num(trip?.estimated_payment_amount ?? null);
  const margin = billing !== null && payment !== null ? billing - payment : null;

  // 실적번호는 DB 의 채번 규칙(numbering_rule 의 ACTUAL)이 만든다. 앱에서
  // 세면 동시에 두 건을 만들 때 같은 번호가 나온다.
  const numbered = await tx.$queryRaw<{ no: string }[]>`
    SELECT ntms.fn_next_no(${tenant_id}::BIGINT, 'ACTUAL'::VARCHAR) AS no
  `;
  const actualNo = numbered[0]?.no;
  if (!actualNo) {
    throw AppError.badRequest(
      'NUMBERING_FAILED',
      '실적번호를 채번하지 못했습니다. 채번 규칙(ACTUAL)이 등록돼 있는지 확인하세요.',
    );
  }

  const created = await tx.transport_actual.create({
    data: {
      tenant_id,
      actual_no: actualNo,
      execution_id: exec.execution_id,
      dispatch_id: exec.dispatch_id,
      trip_id: exec.trip_id,
      // 실행일을 그대로 물려받는다. 여기서 새 Date 를 만들면 로컬 자정이
      // 되어 KST 에서 하루가 밀린다.
      actual_date: exec.execution_date,

      carrier_id: exec.carrier_id,
      carrier_name: exec.dispatch?.carrier_name ?? '—',
      vehicle_id: exec.vehicle_id,
      vehicle_no: exec.dispatch?.vehicle_no ?? null,
      vehicle_type_id: exec.dispatch?.vehicle_type_id ?? null,
      driver_id: exec.driver_id,
      driver_name: exec.dispatch?.driver_name ?? null,

      from_location_name:
        stops[0]?.location_name ?? locName.get(String(trip?.start_location_id)) ?? null,
      to_location_name:
        stops[stops.length - 1]?.location_name ??
        locName.get(String(trip?.end_location_id)) ??
        null,
      from_zone_id: trip?.start_zone_id ?? null,
      to_zone_id: trip?.end_zone_id ?? null,

      order_count: orderRows.length,
      stop_count: stops.length,
      completed_stop_count: stops.filter((s) => s.status === 'COMPLETED').length,
      actual_qty: actualWeight,
      actual_weight_kg: actualWeight,
      actual_volume_cbm: num(trip?.total_volume_cbm ?? null) ?? 0,
      actual_pallet_qty: num(trip?.total_pallet_qty ?? null) ?? 0,

      planned_distance_km: plannedDistance,
      actual_distance_km: actualDistance,
      distance_variance_km:
        plannedDistance !== null && actualDistance !== null
          ? round(actualDistance - plannedDistance, 1)
          : null,
      planned_duration_min: trip?.planned_duration_min ?? null,
      actual_duration_min: actualDuration,
      empty_distance_km: emptyDistance,
      loading_rate:
        capacity && capacity > 0 ? round(Math.min((actualWeight / capacity) * 100, 999), 2) : null,

      actual_start_at: exec.actual_start_at,
      actual_end_at: exec.actual_end_at,
      waiting_minutes: waiting,
      delay_minutes: exec.delay_minutes,

      // 정차가 없으면 '정시였다' 가 아니라 '모른다' 다. false 로 채우면
      // 정시율이 데이터 없는 만큼 나빠진다.
      on_time_pickup: pickupStops.length === 0 ? null : pickupStops.every((s) => s.is_on_time !== false),
      on_time_delivery:
        deliveryStops.length === 0 ? null : deliveryStops.every((s) => s.is_on_time !== false),
      pod_completed: orderRows.length > 0 && orderRows.every((o) => o.pod !== undefined),
      exception_count: exceptions.length,
      damage_count: exceptions.filter((e) => e.exception_type === 'CARGO_DAMAGE').length,

      fuel_consumed_liter: exec.fuel_consumed_liter,
      toll_fee: num(exec.toll_fee) ?? num(trip?.planned_toll_fee ?? null),

      billing_amount: billing,
      payment_amount: payment,
      margin_amount: margin,
      margin_rate: billing && billing > 0 && margin !== null ? round((margin / billing) * 100, 2) : null,

      confirm_status: 'DRAFT',
      created_by: actor.userId,
      updated_by: actor.userId,
    },
    select: { actual_id: true },
  });

  for (const o of orderRows) {
    const pod = o.pod;
    const ratio = actualWeight > 0 ? round((o.delivered / actualWeight) * 100, 2) : null;
    await tx.actual_order.create({
      data: {
        tenant_id,
        actual_id: created.actual_id,
        order_id: o.tripOrder.order_id,
        shipper_id: o.tripOrder.transport_order.shipper_id,
        delivered_qty: o.delivered,
        delivered_weight_kg: o.delivered,
        delivered_volume_cbm: num(o.tripOrder.assigned_volume_cbm) ?? 0,
        damaged_qty: pod ? (num(pod.damaged_qty) ?? 0) : 0,
        shortage_qty: pod ? (num(pod.shortage_qty) ?? 0) : 0,
        returned_qty: 0,
        delivery_result: pod?.pod_result ?? 'NORMAL',
        delivered_at: pod?.delivered_at ?? exec.actual_end_at,
        distance_km: plannedDistance,
        /*
          안분 기준은 편성이 정한 것을 그대로 쓴다. 여기서 다시 고르면
          트립의 적재 판정과 청구의 안분이 서로 다른 기준을 쓰게 된다.
        */
        allocation_basis: o.tripOrder.allocation_basis ?? 'WEIGHT',
        allocation_ratio: ratio,
        billing_amount:
          billing !== null && ratio !== null ? Math.round((billing * ratio) / 100) : null,
        payment_amount:
          payment !== null && ratio !== null ? Math.round((payment * ratio) / 100) : null,
        on_time_delivery: deliveryStops.length === 0 ? null : deliveryStops.every((s) => s.is_on_time !== false),
        pod_id: pod?.pod_id ?? null,
        created_by: actor.userId,
        updated_by: actor.userId,
      },
    });
  }

  return { actualId: created.actual_id, actualNo };
}

/**
 * 계획된 작업시간을 넘겨 서 있던 시간.
 *
 * 대기료의 근거가 되는 숫자다. 단말이 대기시간을 직접 보내 줬으면 그것을
 * 쓰고, 없으면 실측 작업시간에서 계획 작업시간을 뺀다. 계획을 모르면 0 이다 —
 * 계획이 없는 정차의 작업시간을 통째로 대기로 세면 대기료가 부풀려지고,
 * 그런 청구는 운송사와 화주 사이에서 반드시 되돌아온다.
 */
export function stopWaitMinutes(stop: {
  waiting_minutes: number;
  actual_service_min: number | null;
  trip_stop: { planned_service_min: number | null } | null;
  actual_arrival_at: Date | null;
  actual_departure_at: Date | null;
}): number {
  if (stop.waiting_minutes > 0) return stop.waiting_minutes;

  const planned = stop.trip_stop?.planned_service_min ?? null;
  if (planned === null) return 0;

  const served =
    stop.actual_service_min ??
    (stop.actual_arrival_at && stop.actual_departure_at
      ? Math.round((stop.actual_departure_at.getTime() - stop.actual_arrival_at.getTime()) / 60_000)
      : null);
  if (served === null) return 0;
  return Math.max(0, served - planned);
}

// ---------------------------------------------------------------------

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
