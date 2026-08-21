import type { TxClient } from '@ntms/db';
import {
  calculateRate,
  type FuelSurchargeSpec,
  type RateCalculation,
  type RateContext,
  type RateLineSpec,
  type RateTableSpec,
} from '@ntms/shared';

/**
 * 운임표를 DB 에서 꺼내 계산기에 먹인다.
 *
 * ## 계산은 여기서 하지 않는다
 *
 * 금액을 만드는 규칙은 `@ntms/shared` 의 `calculateRate()` 한 벌뿐이고,
 * 여기가 하는 일은 **그 함수가 먹을 재료를 모으는 것**이다. 규칙을 서버에
 * 두면 화면의 미리보기가 서버와 다른 금액을 내고, 그 순간 담당자는 둘 중
 * 어느 것도 안 믿게 된다.
 *
 * ## 표를 고르는 순서
 *
 * 1. `rate_target` 으로 매출/매입을 가른다
 * 2. 운송일이 `apply_start_date` ~ `apply_end_date` 안에 드는 승인된 표
 * 3. 거래처 전용 표가 공통 표(`partner_id IS NULL`)를 이긴다
 * 4. 같은 조건이면 `apply_start_date` 가 늦은 표 — 개정판이 이긴다
 *
 * 3번이 이 규칙의 핵심이다. 대기업 TMS 에서 화주는 대부분 개별 계약 요율을
 * 갖고, 계약이 없는 스팟 건만 공통 표로 떨어진다. 반대로 두면 계약 요율이
 * 있는데도 공통 표로 청구하는 사고가 조용히 난다 — 금액이 나오긴 하므로
 * 아무도 오류를 못 본다.
 */

/** 한 번 꺼내 두고 여러 건에 돌려 쓰는 요율 꾸러미 */
export interface RateBook {
  /** partnerId → 그 거래처 **전용표**. 같은 거래처에 여러 장이면 개정판이 이긴다 */
  tables: Map<string, RateTableSpec>;
  /**
   * 거래처를 안 가리는 표(`partner_id IS NULL`).
   *
   * **여러 장일 수 있어 배열로 든다.** 예전에는 'COMMON' 키 하나에 밀어 넣어
   * 나중 것이 앞 것을 덮었다. 승인된 운임표가 조용히 사라지는데 오류도
   * 경고도 없고, 금액은 나오므로 아무도 못 본다 — 매입 기본 거리요율이
   * 스팟 요율에 가려 운송의 4분의 1이 적자로 찍힌 적이 있다.
   */
  common: RateTableSpec[];
  /** rate_table_id → 표. 계약이 지정한 표를 집을 때 쓴다 */
  byId: Map<string, RateTableSpec>;
  fuel: FuelSurchargeSpec | null;
  /**
   * 이 건에 시도할 표를 **순서대로** 준다.
   *
   *   1. 계약이 지정한 표 (`partner_contract.rate_table_id`)
   *   2. 거래처 전용표
   *   3. 공통표들 — 시작일이 늦은 것부터
   *
   * 계약이 맨 앞인 이유: 계약서에 어느 표로 정산한다고 적혀 있으면 그것이
   * 합의된 값이다. 표의 `partner_id` 는 "이 표는 누구 것인가" 이지 "이
   * 거래처는 어느 표를 쓰는가" 가 아니다 — 스팟 요율표 한 장을 여러
   * 운송사가 함께 쓰는 것이 실무다.
   *
   * 앞 표에서 줄을 못 찾으면 다음으로 떨어진다. 권역요율표에 없는 새 구간이
   * 그렇게 처리된다.
   */
  tablesFor(partnerId: string | null, contractTableId?: string | null): RateTableSpec[];
}

/**
 * 대상 기간에 유효한 운임표를 모두 읽어 둔다.
 *
 * 건마다 표를 조회하면 한 달치 정산에 수백 번의 왕복이 생긴다. 월 단위
 * 정산에서 표가 바뀌는 일은 드물고(바뀌면 그것은 개정이고 개정은 기간이
 * 갈린다), 그래서 기간 시작일 기준으로 한 번만 읽는다.
 */
export async function loadRateBook(
  tx: TxClient,
  tenantId: bigint,
  target: 'BILLING' | 'PAYMENT',
  onDate: Date,
  yearMonth: string,
): Promise<RateBook> {
  const [tables, fuelRows] = await Promise.all([
    tx.rate_table.findMany({
      where: {
        tenant_id: tenantId,
        rate_target: target,
        status: 'APPROVED',
        is_active: true,
        deleted_at: null,
        apply_start_date: { lte: onDate },
        OR: [{ apply_end_date: null }, { apply_end_date: { gte: onDate } }],
      },
      include: {
        rate_table_detail: { where: { is_active: true } },
      },
      orderBy: { apply_start_date: 'asc' },
    }),
    tx.fuel_surcharge.findMany({
      where: {
        tenant_id: tenantId,
        rate_target: target,
        status: 'APPROVED',
        is_active: true,
        apply_year_month: yearMonth,
      },
      orderBy: { apply_start_date: 'desc' },
      take: 1,
    }),
  ]);

  const byPartner = new Map<string, RateTableSpec>();
  const byId = new Map<string, RateTableSpec>();
  const common: RateTableSpec[] = [];
  for (const t of tables) {
    const spec = toTableSpec(t);
    byId.set(spec.rateTableId, spec);
    if (t.partner_id === null) {
      // 공통표는 덮지 않고 쌓는다. 덮으면 승인된 표가 조용히 사라진다.
      common.push(spec);
      continue;
    }
    const key = String(t.partner_id);
    const prev = byPartner.get(key);
    // 같은 거래처에 여러 표가 걸리면 시작일이 늦은 것 — 개정판이 이긴다
    if (!prev || spec.applyStartDate >= prev.applyStartDate) byPartner.set(key, spec);
  }

  const fuelRow = fuelRows[0];
  const fuel: FuelSurchargeSpec | null = fuelRow
    ? {
        fuelSurchargeId: String(fuelRow.fuel_surcharge_id),
        applyYearMonth: fuelRow.apply_year_month,
        baseFuelPrice: Number(fuelRow.base_fuel_price),
        actualFuelPrice: Number(fuelRow.actual_fuel_price),
        surchargeRatePct: nullableNumber(fuelRow.surcharge_rate_pct),
        surchargeAmount: nullableNumber(fuelRow.surcharge_amount),
        surchargePerKm: nullableNumber(fuelRow.surcharge_per_km),
      }
    : null;

  /*
    공통표는 시작일이 늦은 것부터 시도한다. 같은 날 시작한 표가 둘이면
    코드 순으로 고정한다 — 순서가 실행마다 달라지면 같은 운송의 금액이
    어제와 오늘이 다르고, 그건 아무도 재현하지 못하는 버그가 된다.
  */
  common.sort((a, b) =>
    a.applyStartDate === b.applyStartDate
      ? a.rateTableCode.localeCompare(b.rateTableCode)
      : b.applyStartDate.localeCompare(a.applyStartDate),
  );

  return {
    tables: byPartner,
    common,
    byId,
    fuel,
    tablesFor(partnerId, contractTableId) {
      const chain: RateTableSpec[] = [];
      const push = (t: RateTableSpec | undefined): void => {
        if (t && !chain.some((c) => c.rateTableId === t.rateTableId)) chain.push(t);
      };
      push(contractTableId ? byId.get(contractTableId) : undefined);
      push(partnerId === null ? undefined : byPartner.get(partnerId));
      for (const t of common) push(t);
      return chain;
    },
  };
}

function toTableSpec(t: {
  rate_table_id: bigint;
  rate_table_code: string;
  rate_table_name: string;
  rate_target: string;
  rate_method: string;
  partner_id: bigint | null;
  apply_start_date: Date;
  apply_end_date: Date | null;
  min_charge_amount: unknown;
  round_unit: number;
  round_method: string;
  include_toll: boolean;
  apply_fuel_surcharge: boolean;
  is_taxable: boolean;
  rate_table_detail: RateDetailRow[];
}): RateTableSpec {
  return {
    rateTableId: String(t.rate_table_id),
    rateTableCode: t.rate_table_code,
    rateTableName: t.rate_table_name,
    rateTarget: t.rate_target,
    rateMethod: t.rate_method,
    partnerId: t.partner_id === null ? null : String(t.partner_id),
    applyStartDate: isoDate(t.apply_start_date),
    applyEndDate: t.apply_end_date ? isoDate(t.apply_end_date) : null,
    minChargeAmount: nullableNumber(t.min_charge_amount),
    roundUnit: t.round_unit,
    roundMethod: t.round_method,
    includeToll: t.include_toll,
    applyFuelSurcharge: t.apply_fuel_surcharge,
    isTaxable: t.is_taxable,
    lines: t.rate_table_detail.map(toLineSpec),
  };
}

interface RateDetailRow {
  rate_detail_id: bigint;
  line_no: number;
  priority: number;
  from_zone_id: bigint | null;
  to_zone_id: bigint | null;
  vehicle_type_id: bigint | null;
  distance_from: unknown;
  distance_to: unknown;
  weight_from: unknown;
  weight_to: unknown;
  volume_from: unknown;
  volume_to: unknown;
  qty_from: unknown;
  qty_to: unknown;
  stop_count_from: number | null;
  stop_count_to: number | null;
  base_amount: unknown;
  unit_rate: unknown;
  min_amount: unknown;
  max_amount: unknown;
  extra_stop_amount: unknown;
  waiting_free_min: number | null;
  waiting_rate_hour: unknown;
  return_rate_pct: unknown;
}

function toLineSpec(d: RateDetailRow): RateLineSpec {
  return {
    rateDetailId: String(d.rate_detail_id),
    lineNo: d.line_no,
    priority: d.priority,
    fromZoneId: d.from_zone_id === null ? null : String(d.from_zone_id),
    toZoneId: d.to_zone_id === null ? null : String(d.to_zone_id),
    vehicleTypeId: d.vehicle_type_id === null ? null : String(d.vehicle_type_id),
    distanceFrom: nullableNumber(d.distance_from),
    distanceTo: nullableNumber(d.distance_to),
    weightFrom: nullableNumber(d.weight_from),
    weightTo: nullableNumber(d.weight_to),
    volumeFrom: nullableNumber(d.volume_from),
    volumeTo: nullableNumber(d.volume_to),
    qtyFrom: nullableNumber(d.qty_from),
    qtyTo: nullableNumber(d.qty_to),
    stopCountFrom: d.stop_count_from,
    stopCountTo: d.stop_count_to,
    baseAmount: Number(d.base_amount ?? 0),
    unitRate: nullableNumber(d.unit_rate),
    minAmount: nullableNumber(d.min_amount),
    maxAmount: nullableNumber(d.max_amount),
    extraStopAmount: nullableNumber(d.extra_stop_amount),
    waitingFreeMin: d.waiting_free_min,
    waitingRateHour: nullableNumber(d.waiting_rate_hour),
    returnRatePct: nullableNumber(d.return_rate_pct),
  };
}

// ---------------------------------------------------------------------
// 계산 컨텍스트
// ---------------------------------------------------------------------

/**
 * 매입(운송사 지급)의 단위는 **트립 한 건**이다.
 *
 * 운송사는 차 한 대를 굴린 값을 받는다. 그 차에 화주가 몇이었는지는
 * 운송사와 상관없다. 그래서 매입 명세의 한 줄은 실적 한 건이고, 계산에는
 * 실적의 실제 주행거리·정차 수·대기 시간이 그대로 들어간다.
 */
export function paymentContext(actual: {
  vehicle_type_id: bigint | null;
  from_zone_id: bigint | null;
  to_zone_id: bigint | null;
  actual_distance_km: unknown;
  actual_weight_kg: unknown;
  actual_volume_cbm: unknown;
  actual_qty: unknown;
  actual_pallet_qty: unknown;
  stop_count: number;
  waiting_minutes: number;
  toll_fee: unknown;
}): RateContext {
  return {
    vehicleTypeId: actual.vehicle_type_id === null ? null : String(actual.vehicle_type_id),
    fromZoneId: actual.from_zone_id === null ? null : String(actual.from_zone_id),
    toZoneId: actual.to_zone_id === null ? null : String(actual.to_zone_id),
    distanceKm: nullableNumber(actual.actual_distance_km),
    weightKg: nullableNumber(actual.actual_weight_kg),
    volumeCbm: nullableNumber(actual.actual_volume_cbm),
    qty: nullableNumber(actual.actual_qty),
    palletQty: nullableNumber(actual.actual_pallet_qty),
    stopCount: actual.stop_count,
    waitingMinutes: actual.waiting_minutes,
    tollFee: nullableNumber(actual.toll_fee),
  };
}

/**
 * 매출(화주 청구)의 단위는 **오더 한 건**이다.
 *
 * 한 차에 두 화주의 짐이 실렸으면 청구서도 두 장으로 갈린다. 그래서 매출
 * 명세의 한 줄은 `actual_order` 이고, 계산 기준값도 그 오더 몫이다.
 *
 * ## 트립 단위 값을 어떻게 나누는가
 *
 * 거리는 오더별 실측(`actual_order.distance_km`)이 있으면 그것을 쓰고,
 * 없으면 트립 거리를 **적재 비율(`allocation_ratio`)로** 나눈다. 대기와
 * 정차도 같은 비율로 나눈다 — 한 차가 90분 서 있었으면 그 대기는 두 화주가
 * 나눠 무는 것이 맞고, 양쪽에 90분씩 청구하면 같은 대기를 두 번 받는다.
 *
 * 이 나눔 규칙은 명세서에 그대로 적힌다(`allocation_basis`). 적어 두지
 * 않으면 화주가 "왜 우리 거리가 이렇게 나왔냐" 고 물을 때 답할 수 없다.
 */
export function billingContext(
  actual: {
    vehicle_type_id: bigint | null;
    stop_count: number;
    waiting_minutes: number;
    toll_fee: unknown;
    actual_distance_km: unknown;
  },
  order: {
    distance_km: unknown;
    delivered_weight_kg: unknown;
    delivered_volume_cbm: unknown;
    delivered_qty: unknown;
    delivered_pallet_qty: unknown;
    allocation_ratio: unknown;
  },
  orderZones: { from_zone_id: bigint | null; to_zone_id: bigint | null },
): RateContext {
  const ratio = clampRatio(nullableNumber(order.allocation_ratio));
  const tripDistance = nullableNumber(actual.actual_distance_km);
  const own = nullableNumber(order.distance_km);

  return {
    vehicleTypeId: actual.vehicle_type_id === null ? null : String(actual.vehicle_type_id),
    fromZoneId: orderZones.from_zone_id === null ? null : String(orderZones.from_zone_id),
    toZoneId: orderZones.to_zone_id === null ? null : String(orderZones.to_zone_id),
    distanceKm: own ?? (tripDistance === null ? null : round(tripDistance * ratio, 1)),
    weightKg: nullableNumber(order.delivered_weight_kg),
    volumeCbm: nullableNumber(order.delivered_volume_cbm),
    qty: nullableNumber(order.delivered_qty),
    palletQty: nullableNumber(order.delivered_pallet_qty),
    // 정차 수는 최소 2다(상차·하차). 나눠서 1.4곳이 되면 경유료가 헛돈다.
    stopCount: Math.max(2, Math.round(actual.stop_count * ratio)),
    waitingMinutes: Math.round(actual.waiting_minutes * ratio),
    tollFee: (() => {
      const toll = nullableNumber(actual.toll_fee);
      return toll === null ? null : Math.round(toll * ratio);
    })(),
  };
}

/** 계산기를 한 번 부른다. 매칭 실패도 결과의 한 종류이지 예외가 아니다 */
export function runRate(
  ctx: RateContext,
  book: RateBook,
  partnerId: string | null,
  /** 계약이 지정한 표. 있으면 이것부터 시도한다 */
  contractTableId?: string | null,
  calculatedAt?: string,
): RateCalculation {
  return calculateRate(ctx, book.tablesFor(partnerId, contractTableId), book.fuel, {
    calculatedAt,
  });
}

// ---------------------------------------------------------------------

function clampRatio(v: number | null): number {
  // 비율이 없으면 트립 전체가 이 오더 몫이다 — 단독 오더 트립이 그렇다
  if (v === null || !Number.isFinite(v) || v <= 0) return 1;
  // DB 는 퍼센트로 든다(0~100)
  return Math.min(1, v / 100);
}

function nullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
