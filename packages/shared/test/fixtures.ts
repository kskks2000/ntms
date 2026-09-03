/**
 * 테스트가 쓰는 최소 형태들.
 *
 * `RateLineSpec` 은 조건 칸이 스물 몇 개고 대부분 NULL(제한 없음)이다. 매번
 * 다 적으면 **무엇을 시험하는 줄인지가 안 보인다** — 바꾼 칸 하나가 스무
 * 줄에 묻힌다. 그래서 기본값을 여기 모으고, 테스트는 다른 칸만 넘긴다.
 */
import type {
  FuelSurchargeSpec,
  RateContext,
  RateLineSpec,
  RateStep,
  RateTableSpec,
} from '../src/settlement.js';

/** 아무 조건도 안 거는 줄. 여기에 얹어서 원하는 조건만 켠다 */
export function line(over: Partial<RateLineSpec> = {}): RateLineSpec {
  return {
    rateDetailId: '1',
    lineNo: 1,
    priority: 100,
    fromZoneId: null,
    toZoneId: null,
    vehicleTypeId: null,
    distanceFrom: null,
    distanceTo: null,
    weightFrom: null,
    weightTo: null,
    volumeFrom: null,
    volumeTo: null,
    qtyFrom: null,
    qtyTo: null,
    stopCountFrom: null,
    stopCountTo: null,
    baseAmount: 0,
    unitRate: null,
    minAmount: null,
    maxAmount: null,
    extraStopAmount: null,
    waitingFreeMin: null,
    waitingRateHour: null,
    returnRatePct: null,
    ...over,
  };
}

/**
 * 절사 없는 과세 거리요율표.
 *
 * `roundUnit: 1` 로 둔다 — 1 이하면 절사 단계를 건너뛰므로, 반올림을 시험하는
 * 테스트 말고는 금액이 계산 그대로 나온다. 절사가 기본이면 모든 기대값에
 * 절사가 섞여 무엇 때문에 그 숫자인지 읽기 어려워진다.
 */
export function table(over: Partial<RateTableSpec> = {}): RateTableSpec {
  return {
    rateTableId: '1',
    rateTableCode: 'RT-TEST',
    rateTableName: '시험용 요율표',
    rateTarget: 'BILLING',
    rateMethod: 'DISTANCE',
    partnerId: null,
    applyStartDate: '2026-01-01',
    applyEndDate: null,
    minChargeAmount: null,
    roundUnit: 1,
    roundMethod: 'ROUND',
    includeToll: true,
    applyFuelSurcharge: false,
    isTaxable: true,
    lines: [line({ baseAmount: 100_000 })],
    ...over,
  };
}

/** 부대비가 하나도 안 붙는 운송. 정차 2곳, 대기 0분, 통행료 없음 */
export function ctx(over: Partial<RateContext> = {}): RateContext {
  return {
    vehicleTypeId: 'VT1',
    fromZoneId: 'Z1',
    toZoneId: 'Z2',
    distanceKm: 100,
    weightKg: 5_000,
    volumeCbm: 10,
    qty: 20,
    palletQty: 6,
    stopCount: 2,
    waitingMinutes: 0,
    tollFee: null,
    ...over,
  };
}

export function fuel(over: Partial<FuelSurchargeSpec> = {}): FuelSurchargeSpec {
  return {
    fuelSurchargeId: '1',
    applyYearMonth: '202607',
    baseFuelPrice: 1_550,
    actualFuelPrice: 1_741,
    surchargeRatePct: null,
    surchargeAmount: null,
    surchargePerKm: null,
    ...over,
  };
}

/**
 * 계단에서 한 칸을 이름으로 집는다.
 *
 * 인덱스로 집으면 계단 하나가 늘 때 관계없는 테스트가 전부 깨진다. 이름은
 * 순서가 바뀌어도 그대로다.
 */
export function step(steps: RateStep[], key: string): RateStep | undefined {
  return steps.find((s) => s.key === key);
}
