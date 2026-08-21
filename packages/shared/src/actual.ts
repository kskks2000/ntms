/**
 * 실적 — 계획과 실제가 갈라진 자리.
 *
 * ## 시간이 끝난 뒤의 화면이다
 *
 * 여기까지 오는 동안 모든 화면의 축은 시간이었다. 배차판은 계획 막대 위에
 * 실적을 겹쳤고, 관제는 계획선에서 오른쪽으로 얼마나 벗어났는지를 봤다.
 * 그 축들은 전부 "지금 어디까지 왔나" 를 묻는다.
 *
 * 실적 화면이 열릴 때 그 질문은 이미 끝나 있다. 차는 돌아왔고 물건은
 * 내렸다. 남은 질문은 하나다 — **계획과 실제가 어디서 갈라졌고, 그 차이를
 * 누가 무는가.**
 *
 * 그래서 축을 돌린다. 시간이 왼쪽에서 오른쪽으로 흐르는 대신, **계획이
 * 가운데 0선**에 서고 실제가 좌우로 벌어진다. 오른쪽으로 벌어진 만큼이
 * 더 쓴 것이고, 그중 일부는 청구가 되고 일부는 운송사가 문다.
 *
 * ## 확정은 되돌릴 수 없다
 *
 * 확정된 실적은 정산이 물고 간다. 세금계산서가 나가고 나면 숫자를 고치는
 * 길은 조정(adjustment) 전표뿐이다. 그래서 이 도메인의 설계 중심은 계산이
 * 아니라 **경계**다 — 무엇을 확인해야 그 선을 넘게 해 줄 것인가.
 *
 * `evaluateConfirmGate()` 가 그 경계다. 화면이 잠그는 규칙과 서버가 거절하는
 * 규칙이 다르면 "확정 버튼은 눌렸는데 서버가 막는다" 가 되므로, 판정은 여기
 * 한 벌만 두고 양쪽이 부른다.
 */
import { z } from 'zod';
import type { StatusPhase } from './dashboard.js';

// ---------------------------------------------------------------------
// 라벨
// ---------------------------------------------------------------------

export const ACTUAL_CONFIRM_STATUS = [
  'DRAFT',
  'REVIEWING',
  'CONFIRMED',
  'CLOSED',
  'REOPENED',
] as const;
export type ActualConfirmStatus = (typeof ACTUAL_CONFIRM_STATUS)[number];

export const ACTUAL_CONFIRM_STATUS_LABEL: Record<string, string> = {
  DRAFT: '미확정',
  REVIEWING: '검수중',
  CONFIRMED: '확정',
  CLOSED: '마감',
  REOPENED: '확정해제',
};

/**
 * 상태 다섯 가지를 국면 넷으로 접는다.
 *
 * 확정과 마감은 둘 다 "끝났다" 다. 색을 갈라 주면 목록에서 마감 건이 확정
 * 건보다 더 중요해 보이는데, 검수자에게는 둘 다 손댈 일이 없는 줄이다.
 * 손이 필요한 것은 미확정 · 검수중 · 확정해제뿐이다.
 */
export const ACTUAL_CONFIRM_PHASE: Record<string, StatusPhase> = {
  DRAFT: 'planned',
  REVIEWING: 'active',
  CONFIRMED: 'done',
  CLOSED: 'done',
  REOPENED: 'problem',
};

/** 아직 확정되지 않아 검수자의 손이 필요한 상태 */
export const ACTUAL_OPEN_STATUSES = ['DRAFT', 'REVIEWING', 'REOPENED'] as const;

export const LIABILITY_PARTY_LABEL: Record<string, string> = {
  CARRIER: '운송사',
  SHIPPER: '화주',
  DRIVER: '기사',
  CONSIGNEE: '수하인',
  THIRD_PARTY: '제3자',
  UNKNOWN: '미정',
};

// ---------------------------------------------------------------------
// 편차 축
// ---------------------------------------------------------------------

/** 편차 축의 한 줄. 계획을 0으로 두고 실제가 얼마나 벗어났는지 */
export type VarianceKey = 'distance' | 'duration' | 'waiting' | 'delay' | 'loading';

export interface VarianceRow {
  key: VarianceKey;
  label: string;
  unit: string;
  planned: number | null;
  actual: number | null;
  /** 실제 − 계획. 양수면 더 썼다 */
  delta: number | null;
  /** 계획 대비 %. 계획이 0이거나 없으면 null */
  deltaRate: number | null;
  /**
   * 0선에서 얼마나 벌어졌나. −1 … +1.
   *
   * 축의 절반 폭이 1이다. 줄마다 눈금이 다르므로(거리는 %, 대기는 분)
   * 정규화를 여기서 끝내고 화면은 폭만 그린다 — 화면이 스케일을 다시
   * 정하기 시작하면 같은 축이 화면마다 다른 뜻이 된다.
   */
  offset: number;
  /** 이 줄의 절반 폭이 뜻하는 값. 범례에 적는다 */
  scale: number;
  tone: 'neutral' | 'caution' | 'over';
  /** 정산에서 이 편차가 돈이 되는가. 안 되면 null */
  billingNote: string | null;
}

export interface VarianceSpine {
  rows: VarianceRow[];
  /** 눈에 띄게 벌어진 줄 수 */
  overCount: number;
}

export interface VarianceInput {
  plannedDistanceKm: number | null;
  actualDistanceKm: number | null;
  plannedDurationMin: number | null;
  actualDurationMin: number | null;
  waitingMinutes: number;
  delayMinutes: number;
  /** 적재율(%). 계획은 편성이 잡은 값, 실제는 인도 실적 기준 */
  plannedLoadingRate: number | null;
  loadingRate: number | null;
}

/**
 * 편차 축을 만든다.
 *
 * 줄마다 눈금이 다른 이유는 값의 성격이 달라서다. 거리와 시간은 **계획
 * 대비 비율**이 뜻을 가지지만(100km 중 20km 와 500km 중 20km 는 다른 일이다),
 * 대기와 지연은 계획이 0이라 비율이 성립하지 않는다 — 분 단위 절대값으로
 * 본다. 한 눈금으로 통일하면 읽기는 쉬워지지만 뜻이 틀려진다.
 */
export function buildVariance(input: VarianceInput): VarianceSpine {
  const rows: VarianceRow[] = [
    ratioRow({
      key: 'distance',
      label: '주행거리',
      unit: 'km',
      planned: input.plannedDistanceKm,
      actual: input.actualDistanceKm,
      // 계획 대비 ±30% 가 축의 끝. 그보다 벌어지면 운임을 다시 계산할 일이다
      scale: 30,
      cautionRate: 10,
      overRate: 15,
      billingNote: (rate) =>
        rate !== null && rate >= 15 ? '거리 15% 초과 — 운임 재산정 대상' : null,
    }),
    ratioRow({
      key: 'duration',
      label: '소요시간',
      unit: '분',
      planned: input.plannedDurationMin,
      actual: input.actualDurationMin,
      scale: 40,
      cautionRate: 15,
      overRate: 25,
      billingNote: () => null,
    }),
    absoluteRow({
      key: 'waiting',
      label: '대기시간',
      unit: '분',
      // 계획에 대기는 없다. 서 있던 시간은 전부 편차다.
      planned: 0,
      actual: input.waitingMinutes,
      scale: 120,
      cautionAt: 30,
      overAt: 60,
      // 대기료는 대개 30분 또는 1시간을 넘긴 시점부터 붙는다
      billingNote: (v) => (v >= 30 ? `대기 ${v}분 — 대기료 청구 근거` : null),
    }),
    absoluteRow({
      key: 'delay',
      label: '도착 지연',
      unit: '분',
      planned: 0,
      actual: input.delayMinutes,
      scale: 120,
      cautionAt: 15,
      overAt: 30,
      billingNote: (v) => (v >= 30 ? '정시 미달 — 화주 계약의 지연 조항 확인' : null),
    }),
    pointRow({
      key: 'loading',
      label: '적재율',
      unit: '%',
      planned: input.plannedLoadingRate,
      actual: input.loadingRate,
      // 적재율은 %p 로 본다. 계획 82% 가 실제 61% 면 −21%p 다.
      scale: 30,
    }),
  ];

  return { rows, overCount: rows.filter((r) => r.tone === 'over').length };
}

/** 계획 대비 비율로 보는 줄 (거리 · 시간) */
function ratioRow(spec: {
  key: VarianceKey;
  label: string;
  unit: string;
  planned: number | null;
  actual: number | null;
  scale: number;
  cautionRate: number;
  overRate: number;
  billingNote: (rate: number | null) => string | null;
}): VarianceRow {
  const { planned, actual } = spec;
  const delta = planned === null || actual === null ? null : round(actual - planned, 1);
  const rate =
    planned === null || actual === null || planned === 0
      ? null
      : round(((actual - planned) / planned) * 100, 1);

  const abs = Math.abs(rate ?? 0);
  const tone: VarianceRow['tone'] =
    rate === null
      ? 'neutral'
      : abs >= spec.overRate
        ? 'over'
        : abs >= spec.cautionRate
          ? 'caution'
          : 'neutral';

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    planned,
    actual,
    delta,
    deltaRate: rate,
    offset: clamp((rate ?? 0) / spec.scale),
    scale: spec.scale,
    tone,
    billingNote: spec.billingNote(rate),
  };
}

/** 계획이 0이라 절대값으로 보는 줄 (대기 · 지연) */
function absoluteRow(spec: {
  key: VarianceKey;
  label: string;
  unit: string;
  planned: number;
  actual: number;
  scale: number;
  cautionAt: number;
  overAt: number;
  billingNote: (value: number) => string | null;
}): VarianceRow {
  const v = spec.actual;
  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    planned: spec.planned,
    actual: v,
    delta: v - spec.planned,
    deltaRate: null,
    offset: clamp(v / spec.scale),
    scale: spec.scale,
    tone: v >= spec.overAt ? 'over' : v >= spec.cautionAt ? 'caution' : 'neutral',
    billingNote: spec.billingNote(v),
  };
}

/**
 * 퍼센트포인트로 보는 줄 (적재율).
 *
 * 적재율은 **낮은 쪽이 손해**다 — 빈 자리를 싣고 달렸다는 뜻이므로 왼쪽으로
 * 벌어진 것도 그냥 넘길 일이 아니다. 그래서 방향이 아니라 크기로만 톤을
 * 정한다. 거리 · 시간과 반대다.
 */
function pointRow(spec: {
  key: VarianceKey;
  label: string;
  unit: string;
  planned: number | null;
  actual: number | null;
  scale: number;
}): VarianceRow {
  const { planned, actual } = spec;
  const delta = planned === null || actual === null ? null : round(actual - planned, 1);
  const abs = Math.abs(delta ?? 0);

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    planned,
    actual,
    delta,
    deltaRate: null,
    offset: clamp((delta ?? 0) / spec.scale),
    scale: spec.scale,
    tone: abs >= 20 ? 'over' : abs >= 10 ? 'caution' : 'neutral',
    billingNote: delta !== null && delta <= -20 ? '적재율 20%p 미달 — 편성 기준 재검토' : null,
  };
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------
// 확정 관문
// ---------------------------------------------------------------------

/**
 * `blocker` 는 확정을 막고, `caution` 은 짚기만 한다.
 *
 * 두 단으로 나눈 이유는 하나다 — 전부 막으면 아무것도 확정이 안 되고,
 * 전부 통과시키면 관문이 장식이 된다. 막는 것은 **없으면 돈을 못 받는 것**
 * 뿐이다.
 */
export type GateLevel = 'blocker' | 'caution';

export interface GateCheck {
  key: string;
  level: GateLevel;
  passed: boolean;
  title: string;
  /** 왜 걸렸는지와 다음에 할 일. 통과했으면 무엇을 확인했는지 */
  detail: string;
}

export interface ConfirmGate {
  checks: GateCheck[];
  blockerCount: number;
  cautionCount: number;
  canConfirm: boolean;
  /** 확정을 막고 있는 첫 번째 이유. 버튼 옆에 그대로 적는다 */
  blockedReason: string | null;
}

export interface ConfirmGateInput {
  confirmStatus: string;
  orderCount: number;
  /** 인수증이 붙은 오더 수 */
  podCollectedCount: number;
  /** 그중 검수자가 확인까지 누른 수 */
  podConfirmedCount: number;
  /** 정산에 영향을 주는데 아직 안 끝난 예외 */
  openSettlementExceptionCount: number;
  /** 건너뛰거나 실패한 정차 */
  incompleteStopCount: number;
  stopCount: number;
  plannedDistanceKm: number | null;
  actualDistanceKm: number | null;
  /** 이 실적의 귀속일이 마감된 기간에 들어 있는가 */
  periodClosed: boolean;
}

export function evaluateConfirmGate(input: ConfirmGateInput): ConfirmGate {
  const checks: GateCheck[] = [];

  // --- 막는 것 -------------------------------------------------------

  // 기간 마감은 DB 트리거(fn_guard_settlement_close)도 막는다. 화면에서 먼저
  // 말해 주는 것은, 버튼을 눌러 놓고 42501 을 받는 것보다 낫기 때문이다.
  checks.push({
    key: 'period',
    level: 'blocker',
    passed: !input.periodClosed,
    title: '정산 기간',
    detail: input.periodClosed
      ? '이 날짜는 이미 마감된 정산 기간입니다. 마감을 풀어야 실적을 건드릴 수 있습니다.'
      : '열려 있는 기간입니다.',
  });

  const podMissing = Math.max(0, input.orderCount - input.podCollectedCount);
  checks.push({
    key: 'pod',
    level: 'blocker',
    passed: podMissing === 0,
    title: '인수증',
    detail:
      podMissing === 0
        ? `오더 ${input.orderCount}건 모두 인수증이 붙었습니다.`
        : `오더 ${input.orderCount}건 중 ${podMissing}건에 인수증이 없습니다. 인수증 없이 확정하면 청구 근거가 빈 채로 정산에 넘어갑니다.`,
  });

  checks.push({
    key: 'exception',
    level: 'blocker',
    passed: input.openSettlementExceptionCount === 0,
    title: '정산 영향 예외',
    detail:
      input.openSettlementExceptionCount === 0
        ? '정산에 영향을 주는 미해결 예외가 없습니다.'
        : `손해액이 걸린 예외 ${input.openSettlementExceptionCount}건이 아직 안 끝났습니다. 누가 무는지 정해야 금액이 갈립니다.`,
  });

  // --- 짚는 것 -------------------------------------------------------

  const podUnconfirmed = Math.max(0, input.podCollectedCount - input.podConfirmedCount);
  checks.push({
    key: 'podConfirm',
    level: 'caution',
    passed: podUnconfirmed === 0,
    title: '인수증 확인',
    detail:
      podUnconfirmed === 0
        ? '받은 인수증을 모두 확인했습니다.'
        : `인수증 ${podUnconfirmed}건이 아직 확인 전입니다. 이상 인수가 섞여 있으면 확정한 뒤에 알게 됩니다.`,
  });

  checks.push({
    key: 'stop',
    level: 'caution',
    passed: input.incompleteStopCount === 0,
    title: '정차 완료',
    detail:
      input.incompleteStopCount === 0
        ? `정차 ${input.stopCount}곳을 모두 마쳤습니다.`
        : `정차 ${input.incompleteStopCount}곳이 건너뜀 또는 실패로 끝났습니다. 그 구간의 운임을 청구할 근거가 있는지 확인하세요.`,
  });

  const rate =
    input.plannedDistanceKm && input.actualDistanceKm && input.plannedDistanceKm > 0
      ? Math.abs(
          ((input.actualDistanceKm - input.plannedDistanceKm) / input.plannedDistanceKm) * 100,
        )
      : 0;
  checks.push({
    key: 'distance',
    level: 'caution',
    passed: rate < 15,
    title: '주행거리 편차',
    detail:
      rate < 15
        ? '계획 대비 거리가 정상 범위입니다.'
        : `계획 대비 ${rate.toFixed(1)}% 벌어졌습니다. 우회 사유가 없으면 운임을 다시 계산해야 합니다.`,
  });

  const blockers = checks.filter((c) => c.level === 'blocker' && !c.passed);
  const cautions = checks.filter((c) => c.level === 'caution' && !c.passed);

  // 이미 확정 · 마감된 것은 다시 확정할 수 없다. 관문이 전부 통과여도 그렇다.
  const already = input.confirmStatus === 'CONFIRMED' || input.confirmStatus === 'CLOSED';

  return {
    checks,
    blockerCount: blockers.length,
    cautionCount: cautions.length,
    canConfirm: blockers.length === 0 && !already,
    blockedReason: already
      ? input.confirmStatus === 'CLOSED'
        ? '마감된 실적입니다.'
        : '이미 확정된 실적입니다.'
      : (blockers[0]?.detail ?? null),
  };
}

/**
 * 확정을 되돌릴 수 있는가.
 *
 * 정산이 이미 이 실적을 물고 갔으면 되돌릴 수 없다. 청구서가 나간 뒤에
 * 실적 숫자가 조용히 바뀌면 명세서와 원장이 어긋나고, 그 차이는 몇 달 뒤
 * 대사에서야 드러난다. 그때는 조정 전표로만 고친다.
 */
export function reopenBlockReason(input: {
  confirmStatus: string;
  billingSettled: boolean;
  paymentSettled: boolean;
  periodClosed: boolean;
}): string | null {
  if (input.confirmStatus === 'CLOSED') {
    return '마감된 실적입니다. 기간 마감을 먼저 풀어야 합니다.';
  }
  if (input.confirmStatus !== 'CONFIRMED') {
    return '확정된 실적만 되돌릴 수 있습니다.';
  }
  if (input.periodClosed) {
    return '이 날짜는 마감된 정산 기간입니다.';
  }
  if (input.billingSettled || input.paymentSettled) {
    const which = [input.billingSettled ? '매출' : null, input.paymentSettled ? '매입' : null]
      .filter(Boolean)
      .join('·');
    return `${which} 정산이 이미 이 실적을 물고 갔습니다. 금액은 조정 전표로만 바꿀 수 있습니다.`;
  }
  return null;
}

// ---------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------

export interface ActualListItem {
  actualId: string;
  actualNo: string;
  actualDate: string;
  confirmStatus: string;
  tripNo: string;
  executionId: string;
  carrierName: string;
  vehicleNo: string | null;
  driverName: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;
  orderCount: number;
  stopCount: number;
  actualWeightKg: number;
  plannedDistanceKm: number | null;
  actualDistanceKm: number | null;
  distanceVarianceKm: number | null;
  /** 계획 대비 거리 편차 %. 목록의 편차 막대가 쓰는 값 */
  distanceVarianceRate: number | null;
  waitingMinutes: number;
  delayMinutes: number;
  loadingRate: number | null;
  onTimeDelivery: boolean | null;
  podCompleted: boolean;
  exceptionCount: number;
  damageCount: number;
  billingAmount: number | null;
  paymentAmount: number | null;
  marginAmount: number | null;
  marginRate: number | null;
  billingSettled: boolean;
  paymentSettled: boolean;
  confirmedAt: string | null;
  /** 관문 요약. 목록에서 확정 가능 여부를 미리 보여 준다 */
  blockerCount: number;
  cautionCount: number;
  canConfirm: boolean;
  /** 확정을 막는 첫 이유. 체크박스가 잠긴 까닭을 그 자리에서 말한다 */
  blockedReason: string | null;
}

export interface ActualListSummary {
  /** 조건에 걸린 전체 (페이지가 아니라) */
  count: number;
  openCount: number;
  confirmedCount: number;
  totalDistanceKm: number;
  totalWeightKg: number;
  billingAmount: number;
  paymentAmount: number;
  marginAmount: number;
  marginRate: number | null;
  onTimeRate: number | null;
  /** 확정을 막고 있는 실적 수 */
  blockedCount: number;
  /** 아직 실적이 만들어지지 않은 완료 운송 건수 */
  pendingGeneration: number;
}

// ---------------------------------------------------------------------
// 상세
// ---------------------------------------------------------------------

export interface ActualOrderRow {
  actualOrderId: string;
  orderId: string;
  orderNo: string;
  shipperName: string;
  toLocationName: string | null;
  deliveredQty: number;
  deliveredWeightKg: number;
  damagedQty: number;
  shortageQty: number;
  returnedQty: number;
  deliveryResult: string;
  deliveredAt: string | null;
  allocationBasis: string | null;
  allocationRatio: number | null;
  billingAmount: number | null;
  paymentAmount: number | null;
  onTimeDelivery: boolean | null;
  podId: string | null;
  podNo: string | null;
  podConfirmed: boolean;
}

export interface ActualStopRow {
  stopSeq: number;
  stopType: string;
  locationName: string;
  status: string;
  plannedArrivalAt: string | null;
  actualArrivalAt: string | null;
  plannedDepartureAt: string | null;
  actualDepartureAt: string | null;
  plannedServiceMin: number | null;
  actualServiceMin: number | null;
  /** 계획된 작업시간을 넘겨 서 있던 시간 — 대기료의 근거 */
  waitMinutes: number;
  delayMinutes: number;
  isOnTime: boolean | null;
}

export interface ActualExceptionRow {
  exceptionId: string;
  exceptionNo: string | null;
  exceptionType: string;
  severity: string;
  status: string;
  occurredAt: string;
  description: string;
  actionTaken: string | null;
  impactMinutes: number | null;
  damageAmount: number | null;
  liabilityParty: string | null;
  settlementImpact: boolean;
}

export interface ActualHistoryEntry {
  at: string;
  label: string;
  detail: string | null;
}

export interface ActualDetail {
  actualId: string;
  actualNo: string;
  actualDate: string;
  confirmStatus: string;
  executionId: string;
  tripId: string;
  tripNo: string;
  carrierId: string;
  carrierName: string;
  vehicleNo: string | null;
  vehicleTypeName: string | null;
  driverName: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;

  orderCount: number;
  stopCount: number;
  completedStopCount: number;
  actualQty: number;
  actualWeightKg: number;
  actualVolumeCbm: number;
  actualPalletQty: number;

  plannedDistanceKm: number | null;
  actualDistanceKm: number | null;
  distanceVarianceKm: number | null;
  emptyDistanceKm: number | null;
  plannedDurationMin: number | null;
  actualDurationMin: number | null;
  plannedLoadingRate: number | null;
  loadingRate: number | null;

  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  waitingMinutes: number;
  delayMinutes: number;

  onTimePickup: boolean | null;
  onTimeDelivery: boolean | null;
  podCompleted: boolean;
  exceptionCount: number;
  damageCount: number;

  fuelConsumedLiter: number | null;
  fuelCost: number | null;
  tollFee: number | null;
  otherCost: number | null;

  billingAmount: number | null;
  paymentAmount: number | null;
  marginAmount: number | null;
  marginRate: number | null;
  billingSettled: boolean;
  paymentSettled: boolean;

  confirmedAt: string | null;
  confirmedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  remark: string | null;

  variance: VarianceSpine;
  gate: ConfirmGate;
  reopenBlockedReason: string | null;
  orders: ActualOrderRow[];
  stops: ActualStopRow[];
  exceptions: ActualExceptionRow[];
  history: ActualHistoryEntry[];
}

// ---------------------------------------------------------------------
// 운행일보
// ---------------------------------------------------------------------

/**
 * 차량 하루의 구성.
 *
 * 운행일보를 "총 주행 몇 km" 로 만들면 표가 되고, 표는 아무것도 안 알려
 * 준다. 관리자가 알아야 하는 것은 **하루 중 얼마가 돈을 벌었나** 다 —
 * 실차로 달린 시간과 서 있던 시간의 비율. 그래서 하루를 한 줄로 펴고
 * 구간으로 채운다.
 */
export interface VehicleDayRow {
  vehicleId: string;
  vehicleNo: string;
  vehicleTypeName: string | null;
  carrierName: string | null;
  driverName: string | null;
  isOperated: boolean;
  nonOperationReason: string | null;

  tripCount: number;
  orderCount: number;
  stopCount: number;

  totalDistanceKm: number;
  loadedDistanceKm: number | null;
  emptyDistanceKm: number | null;
  emptyRate: number | null;

  firstStartAt: string | null;
  lastEndAt: string | null;
  operatingMinutes: number;
  drivingMinutes: number;
  waitingMinutes: number;
  idleMinutes: number;
  restMinutes: number;

  totalWeightKg: number;
  avgLoadingRate: number | null;
  fuelLiter: number | null;
  fuelEfficiency: number | null;
  tollFee: number | null;
  revenueAmount: number | null;
  costAmount: number | null;
  profitAmount: number | null;

  /** 연속운전 · 휴게 위반이 걸린 기사 근무가 있는가 */
  hasWorkViolation: boolean;
}

export interface DriverDayRow {
  driverId: string;
  driverName: string;
  vehicleNo: string | null;
  carrierName: string | null;
  workStartAt: string | null;
  workEndAt: string | null;
  totalWorkMinutes: number;
  drivingMinutes: number;
  restMinutes: number;
  nightWorkMinutes: number;
  overtimeMinutes: number;
  maxContinuousDrivingMin: number | null;
  isContinuousViolation: boolean;
  isRestViolation: boolean;
  tripCount: number;
  distanceKm: number;
}

export interface OperationDaily {
  date: string;
  /** 운행일보가 마지막으로 만들어진 시각. 없으면 아직 안 돌렸다 */
  builtAt: string | null;
  vehicles: VehicleDayRow[];
  drivers: DriverDayRow[];
  summary: {
    vehicleTotal: number;
    vehicleOperated: number;
    utilizationRate: number | null;
    totalDistanceKm: number;
    loadedDistanceKm: number;
    emptyRate: number | null;
    avgOperatingMinutes: number | null;
    avgLoadingRate: number | null;
    violationCount: number;
  };
}

/**
 * 하루 띠의 한 칸.
 *
 * 화면이 색과 폭을 직접 정하기 시작하면 운행일보와 KPI 가 서로 다른
 * 뜻으로 같은 색을 쓰게 된다. 구성은 여기서 끝낸다.
 */
export interface DayBandSegment {
  key: 'driving' | 'waiting' | 'idle' | 'rest' | 'off';
  label: string;
  minutes: number;
  /** 하루 24시간에서 차지하는 비율(%) */
  percent: number;
}

const DAY_MINUTES = 24 * 60;

export function buildDayBand(row: {
  drivingMinutes: number;
  waitingMinutes: number;
  idleMinutes: number;
  restMinutes: number;
}): DayBandSegment[] {
  const known = row.drivingMinutes + row.waitingMinutes + row.idleMinutes + row.restMinutes;
  // 하루를 넘겨 잡히면(자정을 넘긴 운행이 겹치면) 24시간으로 눌러 맞춘다.
  // 안 그러면 띠가 칸 밖으로 삐져나가 다른 줄과 길이를 비교할 수 없다.
  const scale = known > DAY_MINUTES ? DAY_MINUTES / known : 1;
  const off = Math.max(0, DAY_MINUTES - known * scale);

  const segments: DayBandSegment[] = [
    { key: 'driving', label: '주행', minutes: row.drivingMinutes },
    { key: 'waiting', label: '대기', minutes: row.waitingMinutes },
    { key: 'idle', label: '공회전', minutes: row.idleMinutes },
    { key: 'rest', label: '휴게', minutes: row.restMinutes },
    { key: 'off', label: '미가동', minutes: Math.round(off) },
  ].map((s) => ({
    ...s,
    key: s.key as DayBandSegment['key'],
    percent: Math.round(((s.minutes * (s.key === 'off' ? 1 : scale)) / DAY_MINUTES) * 1000) / 10,
  }));

  return segments.filter((s) => s.minutes > 0);
}

// ---------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------

/**
 * KPI 는 값이 아니라 방향이다.
 *
 * 정시율 94% 는 그 자체로 좋은지 나쁜지 알 수 없다. 지난주가 97% 였다면
 * 나쁜 숫자고, 88% 였다면 좋은 숫자다. 그래서 큰 숫자 하나가 아니라
 * **기간 평균선 위의 자리**로 보여 준다.
 */
export interface KpiSeriesPoint {
  date: string;
  value: number | null;
}

export type KpiDirection = 'up-good' | 'down-good';

export interface KpiMetric {
  key: string;
  label: string;
  unit: string;
  /** 기간 전체의 값 */
  value: number | null;
  /** 앞 기간 같은 길이의 값. 없으면 null */
  previous: number | null;
  delta: number | null;
  direction: KpiDirection;
  series: KpiSeriesPoint[];
  /** 기간 평균. 스파크라인의 기준선 */
  average: number | null;
  hint: string;
}

/** 차원별 비교 — 전체 평균 0선에서 얼마나 벗어났나 */
export interface KpiDimensionRow {
  id: string;
  name: string;
  count: number;
  onTimeRate: number | null;
  /** 전체 평균 대비 %p. 편차 축이 그대로 쓰인다 */
  onTimeDelta: number | null;
  avgDelayMinutes: number | null;
  exceptionCount: number;
  damageCount: number;
  distanceKm: number;
  billingAmount: number;
  paymentAmount: number;
  marginRate: number | null;
  marginDelta: number | null;
}

export interface KpiBoard {
  from: string;
  to: string;
  /** 집계가 마지막으로 계산된 시각. 숫자가 언제 것인지 감추지 않는다 */
  calculatedAt: string | null;
  /** 집계 이후에 확정된 실적이 있으면 숫자가 낡았다 */
  stale: boolean;
  metrics: KpiMetric[];
  carriers: KpiDimensionRow[];
  shippers: KpiDimensionRow[];
  totals: {
    actualCount: number;
    orderCount: number;
    distanceKm: number;
    weightKg: number;
    billingAmount: number;
    paymentAmount: number;
    marginAmount: number;
  };
}

// ---------------------------------------------------------------------
// 쓰기 스키마
// ---------------------------------------------------------------------

/**
 * 검수 입력.
 *
 * 고칠 수 있는 것은 **실비와 메모**뿐이다. 주행거리나 도착 시각을 손으로
 * 고치게 하면 실행 기록과 실적이 갈라지고, 그다음부터 어느 쪽이 사실인지
 * 아무도 모른다. 실행 기록이 틀렸으면 실행을 고치고 실적을 다시 만든다.
 */
export const actualReviewSchema = z.object({
  waitingMinutes: z.coerce.number().int().min(0).max(2880).nullable().default(null),
  fuelConsumedLiter: z.coerce.number().min(0).max(2000).nullable().default(null),
  fuelCost: z.coerce.number().int().min(0).max(100_000_000).nullable().default(null),
  tollFee: z.coerce.number().int().min(0).max(100_000_000).nullable().default(null),
  otherCost: z.coerce.number().int().min(0).max(100_000_000).nullable().default(null),
  remark: z.string().trim().max(1000).nullable().default(null),
});
export type ActualReviewInput = z.infer<typeof actualReviewSchema>;

export const actualConfirmSchema = z.object({
  actualIds: z.array(z.string().min(1)).min(1, '확정할 실적을 고르세요').max(500),
});
export type ActualConfirmInput = z.infer<typeof actualConfirmSchema>;

export const actualReopenSchema = z.object({
  reason: z.string().trim().min(1, '왜 되돌리는지 적어주세요').max(500),
});
export type ActualReopenInput = z.infer<typeof actualReopenSchema>;

export const actualHoldSchema = z.object({
  reason: z.string().trim().min(1, '무엇을 확인해야 하는지 적어주세요').max(500),
});
export type ActualHoldInput = z.infer<typeof actualHoldSchema>;

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');

export const actualGenerateSchema = z.object({
  from: dayString,
  to: dayString,
});
export type ActualGenerateInput = z.infer<typeof actualGenerateSchema>;

/** 확정 · 생성처럼 여러 건을 한 번에 처리하는 동작의 결과 */
export interface BulkResult {
  requested: number;
  succeeded: number;
  /** 왜 안 됐는지. 건수만 알려 주면 다음에 할 일을 알 수 없다 */
  failures: { id: string; label: string; reason: string }[];
}
