import type { TxClient } from '@ntms/db';

/**
 * 집계를 찍는다 — 운행일보 · 기사 근무 · KPI.
 *
 * ## 왜 서비스 밖에 있나
 *
 * 이 함수를 부르는 곳이 둘이다. 하나는 실적을 확정할 때 도는 `ActualReportService`,
 * 다른 하나는 데모 데이터를 밀어 넣는 시드다. 시드가 자기 몫의 집계를 따로
 * 계산하기 시작하면 두 벌이 갈라지고, **화면에 뜬 숫자와 다시 집계를 누른 뒤의
 * 숫자가 달라진다.** 그건 지표를 통째로 못 믿게 만드는 종류의 어긋남이다.
 *
 * `packages/shared` 에 판정 함수를 한 벌만 두는 것과 같은 이유다. 여기는
 * DB 를 만지므로 서버 안에 있을 뿐이다.
 *
 * ## 집계는 찍어 둔 값이다
 *
 * 매번 `transport_actual` 에서 계산해도 숫자는 맞는다. 그런데 운행일보와 KPI 가
 * 답하는 질문은 "지금 이 순간" 이 아니라 **"그날 무슨 일이 있었나"** 다. 한 달
 * 뒤에 3월 15일 운행일보를 열었는데 그 사이 실적을 되돌렸다 다시 확정한 흔적
 * 때문에 숫자가 달라지면, 아무도 그 화면을 근거로 쓰지 않는다.
 */
export interface AggregateActor {
  tenantId: bigint;
  userId: bigint | null;
}

export async function rebuildAggregates(
  tx: TxClient,
  actor: AggregateActor,
  day: Date,
): Promise<void> {
  const actuals = (await tx.transport_actual.findMany({
    where: { tenant_id: actor.tenantId, actual_date: day },
    include: {
      transport_execution: {
        select: {
          start_odometer: true,
          end_odometer: true,
          driving_minutes: true,
          rest_minutes: true,
        },
      },
    },
  })) as unknown as ActualWithExecution[];

  await rebuildVehicles(tx, actor, day, actuals);
  await rebuildDrivers(tx, actor, day, actuals);
  await rebuildKpi(tx, actor.tenantId, day, actuals);
}

// ---------------------------------------------------------------------
// 운행일보
// ---------------------------------------------------------------------

async function rebuildVehicles(
  tx: TxClient,
  actor: AggregateActor,
  day: Date,
  actuals: ActualWithExecution[],
): Promise<void> {
  const tenant_id = actor.tenantId;

  /*
    운행한 차만 넣으면 가동률을 셀 수 없다.

    가동률은 "굴린 차 / 가진 차" 인데 굴린 차만 표에 있으면 분모가 늘 분자와
    같아져 100% 가 나온다. 휴차도 한 줄로 남긴다 — 왜 안 굴렸는지가
    운행일보에서 가장 먼저 보여야 하는 정보다.
  */
  const vehicles = await tx.vehicle.findMany({
    where: { tenant_id, deleted_at: null, is_active: true },
    select: { vehicle_id: true, carrier_id: true, default_driver_id: true, status: true },
  });

  const byVehicle = groupBy(
    actuals.filter((a) => a.vehicle_id !== null),
    (a) => String(a.vehicle_id),
  );

  await tx.vehicle_operation_daily.deleteMany({ where: { tenant_id, operation_date: day } });

  for (const v of vehicles) {
    const mine = byVehicle.get(String(v.vehicle_id)) ?? [];
    const operated = mine.length > 0;

    const loaded = sum(mine.map((a) => num(a.actual_distance_km) ?? 0));
    /*
      총 주행은 계기판이 답한다.

      계기판이 없는 건은 실차거리로 대신하되, 그러면 공차가 0 이 되므로
      공차율은 null 로 둔다. 0% 로 채우면 "공차 없음" 이라는 거짓말이 지표에
      남고, 그 지표를 보고 배차를 고치게 된다.
    */
    const odometer = mine.map((a) => {
      const s = num(a.transport_execution?.start_odometer ?? null);
      const e = num(a.transport_execution?.end_odometer ?? null);
      return s !== null && e !== null && e >= s ? e - s : null;
    });
    const hasOdometer = odometer.length > 0 && odometer.every((o) => o !== null);
    const total = hasOdometer ? sum(odometer as number[]) : loaded;
    const empty = hasOdometer ? Math.max(0, total - loaded) : null;

    const starts = mine.map((a) => a.actual_start_at).filter((d): d is Date => d !== null);
    const ends = mine.map((a) => a.actual_end_at).filter((d): d is Date => d !== null);
    const first = starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const last = ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
    const operating =
      first && last ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 60_000)) : 0;

    const driving = sum(mine.map(drivingOf));
    const waiting = sum(mine.map((a) => a.waiting_minutes));
    const rest = sum(mine.map((a) => a.transport_execution?.rest_minutes ?? 0));
    /*
      공회전은 실측이 아니라 **잔여시간**이다.

      가동시간에서 주행 · 대기 · 휴게를 뺀 나머지. DTG 를 연동하면 실측으로
      바뀔 자리라, 화면 범례에도 그렇게 적어 둔다. 남는 시간을 아예 안 그리면
      띠에 설명되지 않는 빈칸이 생기고, 보는 사람은 데이터가 빠진 것인지
      정말 0 인지 알 수 없다.
    */
    const idle = Math.max(0, operating - driving - waiting - rest);

    const loadingRates = mine
      .map((a) => num(a.loading_rate))
      .filter((r): r is number => r !== null);
    const fuel = sumOrNull(mine.map((a) => num(a.fuel_consumed_liter)));
    const revenue = sumOrNull(mine.map((a) => num(a.billing_amount)));
    const cost =
      sumOrNull(mine.map((a) => num(a.payment_amount))) === null
        ? null
        : sum(
            mine.map(
              (a) =>
                (num(a.payment_amount) ?? 0) + (num(a.fuel_cost) ?? 0) + (num(a.other_cost) ?? 0),
            ),
          );

    await tx.vehicle_operation_daily.create({
      data: {
        tenant_id,
        operation_date: day,
        vehicle_id: v.vehicle_id,
        driver_id: mine[0]?.driver_id ?? v.default_driver_id,
        carrier_id: mine[0]?.carrier_id ?? v.carrier_id,
        start_odometer: hasOdometer
          ? num(mine[0]?.transport_execution?.start_odometer ?? null)
          : null,
        end_odometer: hasOdometer
          ? num(mine[mine.length - 1]?.transport_execution?.end_odometer ?? null)
          : null,
        total_distance_km: round(total, 1),
        loaded_distance_km: round(loaded, 1),
        empty_distance_km: empty === null ? null : round(empty, 1),
        empty_rate: empty === null || total === 0 ? null : round((empty / total) * 100, 2),
        first_start_at: first,
        last_end_at: last,
        operating_minutes: operating,
        driving_minutes: driving,
        waiting_minutes: waiting,
        idle_minutes: idle,
        rest_minutes: rest,
        trip_count: mine.length,
        order_count: sum(mine.map((a) => a.order_count)),
        stop_count: sum(mine.map((a) => a.stop_count)),
        total_weight_kg: round(sum(mine.map((a) => num(a.actual_weight_kg) ?? 0)), 1),
        avg_loading_rate: loadingRates.length === 0 ? null : round(avg(loadingRates), 2),
        fuel_liter: fuel,
        fuel_cost: sumOrNull(mine.map((a) => num(a.fuel_cost))),
        fuel_efficiency: fuel && fuel > 0 ? round(total / fuel, 2) : null,
        toll_fee: sumOrNull(mine.map((a) => num(a.toll_fee))),
        other_cost: sumOrNull(mine.map((a) => num(a.other_cost))),
        revenue_amount: revenue,
        cost_amount: cost,
        profit_amount: revenue !== null && cost !== null ? revenue - cost : null,
        is_operated: operated,
        /*
          휴차 사유를 '배차 없음' 하나로 뭉뚱그리지 않는다. 정비로 못 굴린
          차와 일이 없어 못 굴린 차는 관리자가 할 일이 다르다 — 앞의 것은
          정비 일정을 당기는 일이고, 뒤의 것은 영업이 할 일이다.
        */
        non_operation_reason: operated
          ? null
          : v.status === 'MAINTENANCE'
            ? '정비중'
            : v.status === 'IDLE'
              ? '휴차'
              : '배차 없음',
        created_by: actor.userId,
        updated_by: actor.userId,
      },
    });
  }
}

// ---------------------------------------------------------------------
// 기사 근무
// ---------------------------------------------------------------------

/**
 * 화물자동차 운수사업법의 연속운전 제한을 판정한다.
 *
 * 4시간을 연속으로 운전했으면 30분 이상 쉬어야 한다. 이 판정을 화면이 아니라
 * 집계에 두는 이유는, 위반 여부가 **그날의 사실**이라 나중에 규칙이 바뀌어도
 * 지난 기록의 판정은 그대로여야 하기 때문이다.
 */
async function rebuildDrivers(
  tx: TxClient,
  actor: AggregateActor,
  day: Date,
  actuals: ActualWithExecution[],
): Promise<void> {
  const tenant_id = actor.tenantId;
  await tx.driver_work_log.deleteMany({ where: { tenant_id, work_date: day } });

  const byDriver = groupBy(
    actuals.filter((a) => a.driver_id !== null),
    (a) => String(a.driver_id),
  );

  for (const [driverId, mine] of byDriver) {
    const starts = mine.map((a) => a.actual_start_at).filter((d): d is Date => d !== null);
    const ends = mine.map((a) => a.actual_end_at).filter((d): d is Date => d !== null);
    const first = starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const last = ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
    const work =
      first && last ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 60_000)) : 0;

    const driving = sum(mine.map(drivingOf));
    const rest = sum(mine.map((a) => a.transport_execution?.rest_minutes ?? 0));
    // 한 운행 안에서는 쉬지 않고 달렸다고 본다 — 정차 사이 휴게는 별도 기록이
    // 없으므로, 가장 긴 운행의 주행시간이 최장 연속운전의 하한이다. 실제보다
    // 짧게 잡히는 쪽이라 위반을 없는 것으로 만들지는 않는다.
    const longest = Math.max(0, ...mine.map(drivingOf));

    await tx.driver_work_log.create({
      data: {
        tenant_id,
        work_date: day,
        driver_id: BigInt(driverId),
        vehicle_id: mine[0]?.vehicle_id ?? null,
        carrier_id: mine[0]?.carrier_id ?? null,
        work_start_at: first,
        work_end_at: last,
        total_work_minutes: work,
        driving_minutes: driving,
        rest_minutes: rest,
        night_work_minutes: first && last ? nightMinutes(first, last) : 0,
        overtime_minutes: Math.max(0, work - 480),
        max_continuous_driving_min: longest,
        is_continuous_violation: longest > 240,
        is_rest_violation: driving >= 240 && rest < 30,
        trip_count: mine.length,
        order_count: sum(mine.map((a) => a.order_count)),
        distance_km: round(sum(mine.map((a) => num(a.actual_distance_km) ?? 0)), 1),
        is_worked: true,
        created_by: actor.userId,
        updated_by: actor.userId,
      },
    });
  }
}

// ---------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------

async function rebuildKpi(
  tx: TxClient,
  tenant_id: bigint,
  day: Date,
  actuals: ActualWithExecution[],
): Promise<void> {
  /*
    확정된 것만 센다.

    미확정 실적은 아직 흔들리는 숫자다. 그것까지 세면 아침에 본 정시율과
    오후에 본 정시율이 달라지고, 지표가 지표 노릇을 못 한다.
  */
  const settled = actuals.filter(
    (a) => a.confirm_status === 'CONFIRMED' || a.confirm_status === 'CLOSED',
  );

  await tx.kpi_daily.deleteMany({ where: { tenant_id, kpi_date: day } });
  if (settled.length === 0) return;

  const [vehicleTotal, operating, orderRows] = await Promise.all([
    tx.vehicle.count({ where: { tenant_id, deleted_at: null, is_active: true } }),
    tx.vehicle_operation_daily.count({
      where: { tenant_id, operation_date: day, is_operated: true },
    }),
    tx.actual_order.findMany({
      // 분모가 둘이다 — 대부분의 지표는 확정 건만, 인수증 완료율만 그날 전체.
      where: { tenant_id, actual_id: { in: actuals.map((a) => a.actual_id) } },
      select: {
        shipper_id: true,
        actual_id: true,
        delivered_weight_kg: true,
        on_time_delivery: true,
        billing_amount: true,
        payment_amount: true,
        pod_id: true,
        delivery_result: true,
      },
    }),
  ]);

  /*
    인수증 완료율만 미확정 실적까지 센다.

    확정 관문이 인수증 없는 실적을 막는다. 그래서 확정된 것만 세면 이 지표는
    **구조적으로 늘 100%** 가 된다 — 지표가 자기 꼬리를 문다. 시드를 어떻게
    바꿔도 100 만 나온다.

    운영자가 묻는 것은 "확정한 것 중 인수증이 붙은 비율"(정의상 100)이 아니라
    "어제 나간 운송 중 인수증이 아직 안 들어온 게 몇이냐" 다. 그래서 이 한
    지표만 분모를 그날 전체로 둔다. 나머지 지표는 위의 이유대로 확정분만 센다.
  */
  const settledIds = new Set(settled.map((a) => String(a.actual_id)));
  const settledOrders = orderRows.filter((o) => settledIds.has(String(o.actual_id)));
  const carrierOf = new Map(actuals.map((a) => [String(a.actual_id), String(a.carrier_id)]));

  await tx.kpi_daily.create({
    data: kpiRow(tenant_id, day, 'TOTAL', {}, settled, settledOrders, orderRows, vehicleTotal, operating),
  });

  for (const [carrierId, rows] of groupBy(settled, (a) => String(a.carrier_id))) {
    const ids = new Set(rows.map((r) => String(r.actual_id)));
    await tx.kpi_daily.create({
      data: kpiRow(
        tenant_id,
        day,
        'CARRIER',
        { carrier_id: BigInt(carrierId) },
        rows,
        settledOrders.filter((o) => ids.has(String(o.actual_id))),
        orderRows.filter((o) => carrierOf.get(String(o.actual_id)) === carrierId),
        0,
        0,
      ),
    });
  }

  /*
    화주별은 오더에서 나온다.

    트립 하나에 화주가 둘이면 그 트립의 거리 · 금액을 양쪽에 통째로 더할 수
    없다. 오더의 안분 금액과 인도 무게로 나눈다. `aggregate_level` 을 나눠 둔
    것이 바로 이 중복 합산을 막기 위해서다.
  */
  for (const [shipperId, rows] of groupBy(settledOrders, (o) => String(o.shipper_id))) {
    const ids = new Set(rows.map((r) => String(r.actual_id)));
    await tx.kpi_daily.create({
      data: kpiRow(
        tenant_id,
        day,
        'SHIPPER',
        { shipper_id: BigInt(shipperId) },
        settled.filter((a) => ids.has(String(a.actual_id))),
        rows,
        orderRows.filter((o) => String(o.shipper_id) === shipperId),
        0,
        0,
      ),
    });
  }
}

function kpiRow(
  tenant_id: bigint,
  day: Date,
  level: string,
  dims: { carrier_id?: bigint; shipper_id?: bigint },
  actuals: ActualWithExecution[],
  orders: OrderAggRow[],
  /** 인수증 완료율 전용 분모 — 미확정까지 포함한 그날 전체 오더 */
  podOrders: OrderAggRow[],
  vehicleTotal: number,
  vehicleOperating: number,
) {
  const distance = sum(actuals.map((a) => num(a.actual_distance_km) ?? 0));
  const empty = sum(actuals.map((a) => num(a.empty_distance_km) ?? 0));
  const hasEmpty = actuals.some((a) => a.empty_distance_km !== null);

  // 화주별은 트립 금액을 통째로 더하면 안 된다. 오더 안분 금액을 쓴다.
  const billing =
    level === 'SHIPPER'
      ? sum(orders.map((o) => num(o.billing_amount) ?? 0))
      : sum(actuals.map((a) => num(a.billing_amount) ?? 0));
  const payment =
    level === 'SHIPPER'
      ? sum(orders.map((o) => num(o.payment_amount) ?? 0))
      : sum(actuals.map((a) => num(a.payment_amount) ?? 0));

  const delivered = orders.filter((o) => o.on_time_delivery !== null);
  const onTime = delivered.filter((o) => o.on_time_delivery === true).length;
  const loadingRates = actuals.map((a) => num(a.loading_rate)).filter((r): r is number => r !== null);
  const delays = actuals.map((a) => a.delay_minutes);

  return {
    tenant_id,
    kpi_date: day,
    aggregate_level: level,
    carrier_id: dims.carrier_id ?? null,
    shipper_id: dims.shipper_id ?? null,
    order_count: orders.length,
    completed_count: delivered.length,
    // 취소·실패는 오더 상태에서 오는 값이라 실적에는 안 잡힌다. 실적 기준
    // 집계라는 것을 분명히 하기 위해 0 으로 둔다.
    cancelled_count: 0,
    failed_count: orders.filter(
      (o) => o.delivery_result === 'REFUSED' || o.delivery_result === 'MISDELIVERY',
    ).length,
    trip_count: actuals.length,
    total_weight_kg: round(
      level === 'SHIPPER'
        ? sum(orders.map((o) => num(o.delivered_weight_kg) ?? 0))
        : sum(actuals.map((a) => num(a.actual_weight_kg) ?? 0)),
      1,
    ),
    total_volume_cbm: round(sum(actuals.map((a) => num(a.actual_volume_cbm) ?? 0)), 3),
    total_distance_km: round(distance, 1),
    on_time_pickup_count: actuals.filter((a) => a.on_time_pickup === true).length,
    on_time_delivery_count: onTime,
    on_time_rate: delivered.length === 0 ? null : round((onTime / delivered.length) * 100, 2),
    avg_delay_minutes: delays.length === 0 ? null : round(avg(delays), 2),
    exception_count: sum(actuals.map((a) => a.exception_count)),
    accident_count: 0,
    damage_count: sum(actuals.map((a) => a.damage_count)),
    pod_completion_rate:
      podOrders.length === 0
        ? null
        : round((podOrders.filter((o) => o.pod_id !== null).length / podOrders.length) * 100, 2),
    avg_loading_rate: loadingRates.length === 0 ? null : round(avg(loadingRates), 2),
    // 공차율의 분모는 계기판 총 주행이다. 실차거리로 나누면 100% 를 넘는다.
    empty_rate: !hasEmpty || distance + empty === 0 ? null : round((empty / (distance + empty)) * 100, 2),
    vehicle_operating_count: vehicleOperating,
    vehicle_total_count: vehicleTotal,
    vehicle_utilization_rate:
      vehicleTotal === 0 ? null : round((vehicleOperating / vehicleTotal) * 100, 2),
    avg_stop_per_trip:
      actuals.length === 0 ? null : round(sum(actuals.map((a) => a.stop_count)) / actuals.length, 2),
    billing_amount: billing,
    payment_amount: payment,
    margin_amount: billing - payment,
    margin_rate: billing === 0 ? null : round(((billing - payment) / billing) * 100, 2),
    cost_per_km: distance === 0 ? null : round(payment / distance, 2),
    revenue_per_trip: actuals.length === 0 ? null : round(billing / actuals.length, 2),
    calculated_at: new Date(),
  };
}

// ---------------------------------------------------------------------

export type ActualWithExecution = {
  actual_id: bigint;
  carrier_id: bigint;
  vehicle_id: bigint | null;
  driver_id: bigint | null;
  confirm_status: string;
  order_count: number;
  stop_count: number;
  actual_weight_kg: unknown;
  actual_volume_cbm: unknown;
  actual_distance_km: unknown;
  actual_duration_min: number | null;
  waiting_minutes: number;
  delay_minutes: number;
  loading_rate: unknown;
  empty_distance_km: unknown;
  on_time_pickup: boolean | null;
  exception_count: number;
  damage_count: number;
  fuel_consumed_liter: unknown;
  fuel_cost: unknown;
  toll_fee: unknown;
  other_cost: unknown;
  billing_amount: unknown;
  payment_amount: unknown;
  actual_start_at: Date | null;
  actual_end_at: Date | null;
  transport_execution: {
    start_odometer: unknown;
    end_odometer: unknown;
    driving_minutes: number | null;
    rest_minutes: number;
  } | null;
};

type OrderAggRow = {
  actual_id: bigint;
  shipper_id: bigint;
  delivered_weight_kg: unknown;
  on_time_delivery: boolean | null;
  billing_amount: unknown;
  payment_amount: unknown;
  pod_id: bigint | null;
  delivery_result: string;
};

/** 주행시간. 실행이 안 들고 있으면 소요시간에서 대기를 뺀 값으로 본다 */
function drivingOf(a: ActualWithExecution): number {
  return (
    a.transport_execution?.driving_minutes ??
    Math.max(0, (a.actual_duration_min ?? 0) - a.waiting_minutes)
  );
}

/**
 * 야간 근무 시간 (22시~06시).
 *
 * 이 시스템은 국내 육상 운송만 다루므로 KST(UTC+9) 로 고정한다. 서버가 어느
 * 시간대에 있든 야간 판정은 같아야 한다 — 도커 컨테이너의 TZ 설정에 따라
 * 법규 위반 여부가 달라지면 안 된다.
 */
function nightMinutes(start: Date, end: Date): number {
  const KST = 9 * 3600_000;
  let total = 0;
  // 분 단위로 훑는다. 근무가 자정을 걸쳐도 경계 계산이 어긋나지 않는다.
  // 하루치라 최대 1440회다.
  for (let t = start.getTime(); t < end.getTime(); t += 60_000) {
    const hour = Math.floor(((t + KST) % 86_400_000) / 3600_000);
    if (hour >= 22 || hour < 6) total += 1;
  }
  return total;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** 하나라도 값이 있으면 합, 전부 없으면 null. 0 과 '모름' 을 안 섞는다 */
function sumOrNull(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : sum(known);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
