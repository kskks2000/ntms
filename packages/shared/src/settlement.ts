/**
 * 정산 — 돈이 어디서 멈춰 있나.
 *
 * ## 축을 다시 돌린다
 *
 * 실적 화면의 축은 편차였다 — 계획이 0선에 서고 실제가 좌우로 벌어진다.
 * 그 질문은 확정으로 끝난다. 확정된 실적은 청구할 수 있는 사실이고, 그
 * 다음부터 관리자가 묻는 것은 하나다.
 *
 *   **청구할 수 있는 돈 중에 얼마가 아직 안 들어왔고, 어디서 멈춰 있나.**
 *
 * `settlement_status` 가 열 단계인 것이 곧 관문의 연속이다. 그래서 가로축을
 * 금액으로 두고 관문을 세로로 쌓는다. 각 단에서 **줄어든 폭이 그 관문에
 * 걸린 돈**이다. 건수가 아니라 금액이므로, 백 건이 걸린 관문보다 한 건이
 * 걸린 관문이 더 급할 수 있다는 사실이 그림에 그대로 나온다.
 *
 * 매출과 매입이 **같은 구조**(같은 표 · 같은 상태 · 같은 관문)라, 두 사다리를
 * 같은 0선에서 그으면 **두 막대의 오른쪽 끝 차이가 그 관문의 마진**이 된다.
 * 마진을 따로 계산해 옆에 적는 대신 그림이 직접 보여 준다.
 *
 * ## 금액은 재현 가능해야 한다
 *
 * 운임표는 개정된다. 6월 청구서를 9월에 다시 열었을 때 그때 금액이 다시
 * 나와야 하고, 그러려면 "그때 어느 표의 몇 번째 줄로 어떻게 계산했는지" 가
 * 남아 있어야 한다. `settlement_detail.calculation_detail` JSONB 가 그
 * 자리이고, `calculateRate()` 는 금액과 함께 **그 근거를 같은 모양으로**
 * 만들어 돌려준다. 화면의 산출 계단(RateBreakdown)은 그 근거를 그대로 편다.
 *
 * ## 되돌릴 수 없는 선이 두 개다
 *
 *   확정(CONFIRMED)  — 여기서부터 금액은 조정 전표로만 바뀐다
 *   발행(INVOICED)   — 계산서가 나가면 수정계산서 말고는 길이 없다
 *
 * 그래서 이 도메인의 설계 중심도 계산이 아니라 **관문**이다.
 * `evaluateSettlementGate()` 한 벌을 화면과 서버가 같이 부른다.
 */
import { z } from 'zod';
import type { StatusPhase } from './dashboard.js';
import type { GateCheck } from './actual.js';

// =====================================================================
// 1. 라벨 · 국면
// =====================================================================

export const SETTLEMENT_STATUS = [
  'DRAFT',
  'CALCULATED',
  'REVIEWING',
  'CONFIRMED',
  'APPROVED',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
  'CLOSED',
  'CANCELLED',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUS)[number];

export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성',
  CALCULATED: '산출완료',
  REVIEWING: '검수중',
  CONFIRMED: '확정',
  APPROVED: '승인',
  INVOICED: '계산서 발행',
  PARTIALLY_PAID: '부분수납',
  PAID: '완납',
  CLOSED: '마감',
  CANCELLED: '취소',
};

/**
 * 열 단계를 국면 넷으로 접는다.
 *
 * 색을 열 가지 쓰면 색이 뜻을 잃는다. 정산 담당자가 목록에서 가르는 것은
 * 넷뿐이다 — 아직 손을 안 댄 것, 지금 흘러가는 것, 끝난 것, 틀어진 것.
 * `PARTIALLY_PAID` 를 문제로 두지 않는 이유는, 부분수납은 사고가 아니라
 * 정상적인 경과이기 때문이다. 문제는 **기한을 넘긴 미수**이고 그것은
 * 상태가 아니라 날짜가 말한다.
 */
export const SETTLEMENT_STATUS_PHASE: Record<string, StatusPhase> = {
  DRAFT: 'planned',
  CALCULATED: 'planned',
  REVIEWING: 'active',
  CONFIRMED: 'active',
  APPROVED: 'active',
  INVOICED: 'active',
  PARTIALLY_PAID: 'active',
  PAID: 'done',
  CLOSED: 'done',
  CANCELLED: 'problem',
};

/** 아직 담당자의 손이 필요한 상태 */
export const SETTLEMENT_OPEN_STATUSES = [
  'DRAFT',
  'CALCULATED',
  'REVIEWING',
  'CONFIRMED',
  'APPROVED',
] as const;

/** 계산서가 나갔고 돈이 아직 다 안 들어온 상태 — 미수 판정의 모집단 */
export const SETTLEMENT_RECEIVABLE_STATUSES = ['INVOICED', 'PARTIALLY_PAID'] as const;

/**
 * 상태 전이표.
 *
 * 실적과 달리 정산은 한 칸씩 넘어가지 않는다 — 검수를 건너뛰고 바로 확정하는
 * 운영이 흔하고, 완납이 부분수납을 거치지 않는 경우도 흔하다. 그래서 DB 에
 * 전이 규칙표를 두지 않고 여기서 판정한다. **여기 없는 전이는 서버가 거절한다.**
 */
export const SETTLEMENT_FLOW: Record<string, SettlementStatus[]> = {
  DRAFT: ['CALCULATED', 'CANCELLED'],
  CALCULATED: ['REVIEWING', 'CONFIRMED', 'DRAFT', 'CANCELLED'],
  REVIEWING: ['CONFIRMED', 'CALCULATED', 'CANCELLED'],
  CONFIRMED: ['APPROVED', 'REVIEWING', 'CANCELLED'],
  APPROVED: ['INVOICED', 'CONFIRMED', 'CANCELLED'],
  INVOICED: ['PARTIALLY_PAID', 'PAID'],
  PARTIALLY_PAID: ['PAID'],
  PAID: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export const TAX_INVOICE_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성',
  ISSUED: '발행',
  SENT: '국세청 전송',
  ACCEPTED: '국세청 승인',
  REJECTED: '국세청 반려',
  CANCELLED: '취소',
};

export const TAX_INVOICE_STATUS_PHASE: Record<string, StatusPhase> = {
  DRAFT: 'planned',
  ISSUED: 'active',
  SENT: 'active',
  ACCEPTED: 'done',
  REJECTED: 'problem',
  CANCELLED: 'problem',
};

export const TAX_INVOICE_TYPE_LABEL: Record<string, string> = {
  TAX: '세금계산서',
  EXEMPT: '계산서(면세)',
  MODIFIED: '수정 세금계산서',
};

export const ADJUSTMENT_TYPE_LABEL: Record<string, string> = {
  ADD: '추가 청구',
  DEDUCT: '차감',
  DISCOUNT: '할인',
  PENALTY: '지체상금',
  CLAIM: '손해배상 구상',
  CORRECTION: '오류 정정',
};

/** 금액을 깎는 조정. 부호를 화면이 아니라 여기서 정한다 */
export const ADJUSTMENT_NEGATIVE_TYPES = ['DEDUCT', 'DISCOUNT', 'PENALTY', 'CLAIM'] as const;

export const CHARGE_METHOD_LABEL: Record<string, string> = {
  FIXED: '정액',
  PER_UNIT: '단위당',
  PER_HOUR: '시간당',
  PER_MINUTE: '분당',
  PERCENT: '기본운임 비율',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: '계좌이체',
  CARD: '카드',
  CHECK: '어음·수표',
  CASH: '현금',
  OFFSET: '상계',
  ETC: '기타',
};

export const CLOSE_STATUS_LABEL: Record<string, string> = {
  OPEN: '열림',
  CLOSED: '마감',
  REOPENED: '마감해제',
};

export const CLOSE_STATUS_PHASE: Record<string, StatusPhase> = {
  OPEN: 'planned',
  CLOSED: 'done',
  REOPENED: 'problem',
};

/**
 * 매출과 매입은 같은 표를 쓰지만 **사람이 쓰는 말이 다르다.**
 *
 * 매출에서 "수금" 인 것이 매입에서는 "지급" 이고, 상대는 화주와 운송사다.
 * 화면 하나를 `type` 만 바꿔 두 번 쓰므로, 바뀌어야 하는 말을 여기 모아 둔다.
 * 화면 코드에 `type === 'BILLING' ? '수금' : '지급'` 을 흩뿌리면 어느 화면
 * 하나가 반드시 빠진다.
 */
export interface SettlementVoice {
  /** 화면 제목 */
  title: string;
  /** 라틴 eyebrow */
  eyebrow: string;
  /** 상대처를 뭐라 부르나 */
  partyLabel: string;
  /** 돈이 움직이는 동작 */
  payLabel: string;
  payVerb: string;
  /** 아직 안 움직인 돈 */
  unpaidLabel: string;
  /** 명세서 이름 */
  statementLabel: string;
  /** 사다리 맨 위 칸이 뜻하는 것 */
  topLabel: string;
  direction: 'RECEIPT' | 'DISBURSEMENT';
}

export const SETTLEMENT_VOICE: Record<string, SettlementVoice> = {
  BILLING: {
    title: '매출 정산',
    eyebrow: 'Billing',
    partyLabel: '화주',
    payLabel: '수금',
    payVerb: '수금하기',
    unpaidLabel: '미수금',
    statementLabel: '매출 명세서',
    topLabel: '청구 가능액',
    direction: 'RECEIPT',
  },
  PAYMENT: {
    title: '매입 정산',
    eyebrow: 'Payables',
    partyLabel: '운송사',
    payLabel: '지급',
    payVerb: '지급하기',
    unpaidLabel: '미지급금',
    statementLabel: '매입 명세서',
    topLabel: '지급 예정액',
    direction: 'DISBURSEMENT',
  },
};

export function voiceOf(type: string): SettlementVoice {
  return SETTLEMENT_VOICE[type] ?? SETTLEMENT_VOICE.BILLING!;
}

// =====================================================================
// 2. 운임 계산 — calculateRate()
// =====================================================================

/**
 * 계산에 쓰는 사실들.
 *
 * 전부 **실적에서 온 값**이다. 계획값을 쓰면 청구가 실제와 갈라진다 —
 * 계획 320km 를 달릴 예정이었는데 우회로 380km 를 달렸으면, 청구 근거는
 * 380km 이고 그 차이는 편차 축이 이미 짚어 두었다.
 */
export interface RateContext {
  vehicleTypeId: string | null;
  fromZoneId: string | null;
  toZoneId: string | null;
  distanceKm: number | null;
  weightKg: number | null;
  volumeCbm: number | null;
  qty: number | null;
  palletQty: number | null;
  stopCount: number;
  /** 계획된 작업시간을 넘겨 서 있던 분 — 대기료의 근거 */
  waitingMinutes: number;
  /** 실비. 운임에 포함되지 않는 표라면 부대비로 얹는다 */
  tollFee: number | null;
}

export interface RateLineSpec {
  rateDetailId: string;
  lineNo: number;
  priority: number;
  fromZoneId: string | null;
  toZoneId: string | null;
  vehicleTypeId: string | null;
  distanceFrom: number | null;
  distanceTo: number | null;
  weightFrom: number | null;
  weightTo: number | null;
  volumeFrom: number | null;
  volumeTo: number | null;
  qtyFrom: number | null;
  qtyTo: number | null;
  stopCountFrom: number | null;
  stopCountTo: number | null;
  baseAmount: number;
  unitRate: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  extraStopAmount: number | null;
  waitingFreeMin: number | null;
  waitingRateHour: number | null;
  returnRatePct: number | null;
}

export interface RateTableSpec {
  rateTableId: string;
  rateTableCode: string;
  rateTableName: string;
  rateTarget: string;
  rateMethod: string;
  partnerId: string | null;
  applyStartDate: string;
  applyEndDate: string | null;
  minChargeAmount: number | null;
  roundUnit: number;
  roundMethod: string;
  includeToll: boolean;
  applyFuelSurcharge: boolean;
  isTaxable: boolean;
  lines: RateLineSpec[];
}

/** 유류할증 기준 한 줄. 없으면 할증을 얹지 않는다 */
export interface FuelSurchargeSpec {
  fuelSurchargeId: string;
  applyYearMonth: string;
  baseFuelPrice: number;
  actualFuelPrice: number;
  surchargeRatePct: number | null;
  surchargeAmount: number | null;
  surchargePerKm: number | null;
}

/**
 * 산출 계단의 한 칸.
 *
 * 상세 화면이 "이 금액이 **어떻게** 나왔나" 에 답하는 재료다. 화면이 자기
 * 식으로 다시 계산해 그리면 표시와 실제가 갈라지므로, 계산기가 계산하면서
 * 그때그때 남긴다.
 */
export interface RateStep {
  key: string;
  label: string;
  /** 사람이 읽는 식. "320km × 900원" */
  expression: string | null;
  /** 이 칸이 더한(또는 뺀) 금액 */
  amount: number;
  /** 여기까지의 누계 */
  running: number;
  kind: 'base' | 'unit' | 'floor' | 'cap' | 'round' | 'surcharge' | 'fuel' | 'supply' | 'tax' | 'total';
}

/** 계산기가 스스로 만들어 낸 부대비 (대기료 · 경유료 · 통행료) */
export interface DerivedCharge {
  chargeCode: string;
  chargeName: string;
  chargeMethod: string;
  baseValue: number | null;
  baseUnit: string | null;
  unitRate: number | null;
  qty: number;
  amount: number;
  isTaxable: boolean;
  note: string;
}

export interface RateCalculation {
  matched: boolean;
  /** 못 맞췄으면 왜. 화면은 이 문장을 그대로 보여 준다 */
  unmatchedReason: string | null;

  rateTableId: string | null;
  rateTableCode: string | null;
  rateTableName: string | null;
  rateMethod: string | null;
  rateDetailId: string | null;
  lineNo: number | null;
  unitRate: number | null;

  baseAmount: number;
  surchargeAmount: number;
  fuelSurchargeAmount: number;
  discountAmount: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  isTaxable: boolean;

  charges: DerivedCharge[];
  steps: RateStep[];
  /** settlement_detail.calculation_detail 로 그대로 들어간다 */
  detail: CalculationDetail;
}

/**
 * 저장되는 산출 근거.
 *
 * 운임표가 개정돼도 과거 정산을 재현할 수 있어야 한다. 그래서 표의 **id 만**
 * 남기지 않는다 — id 로 다시 읽으면 개정된 값이 나온다. 그때 쓴 단가와
 * 규칙을 값째로 박아 둔다.
 */
export interface CalculationDetail {
  engine: string;
  calculatedAt: string;
  method: string | null;
  table: {
    id: string | null;
    code: string | null;
    name: string | null;
    lineNo: number | null;
    applyStartDate: string | null;
  } | null;
  inputs: Record<string, number | string | null>;
  rules: Record<string, number | string | boolean | null>;
  steps: RateStep[];
  charges: DerivedCharge[];
}

const VAT_RATE = 0.1;
const ENGINE_VERSION = 'ntms-rate/1';

/**
 * 운임을 계산한다.
 *
 * ## 매칭 규칙
 *
 * `priority` 가 낮은 줄이 먼저고, 같으면 `line_no` 순이다. 조건 칸이 NULL 인
 * 것은 "제한 없음" 이므로 아무 값에나 걸린다 — 그래서 **가장 좁은 줄이 먼저
 * 걸리도록 priority 로 순서를 준다.** 거리요율표에서 300km 이상 줄에
 * priority 90 을 준 것이 그 예다. 100 인 구간 줄들보다 먼저 검사된다.
 *
 * ## 한 번 걸리면 거기서 끝낸다
 *
 * 여러 줄이 걸려도 첫 줄만 쓴다. 합산하면 구간표를 짤 수 없다 —
 * 0~50km 줄과 50~150km 줄이 둘 다 걸릴 수 있게 만드는 순간, 60km 운송이
 * 두 줄의 합으로 청구된다.
 */
export function calculateRate(
  ctx: RateContext,
  tables: RateTableSpec | RateTableSpec[] | null,
  fuel?: FuelSurchargeSpec | null,
  options?: { calculatedAt?: string },
): RateCalculation {
  const at = options?.calculatedAt ?? new Date().toISOString();

  /*
    표를 여러 장 받아 **순서대로** 시도한다.

    거래처 전용표가 먼저고 공통표가 나중이다. 권역요율표는 실제로 오가는
    구간만 담고 있어서, 새 구간이 생기면 그 표에서는 아무 줄도 안 걸린다 —
    그때 공통 거리요율로 떨어지는 것이 실무다. 한 장만 보게 만들면 그런
    운송이 전부 0원이 되고, 담당자는 "요율표가 있는데 왜 0원이냐" 를 묻는다.
  */
  const chain = (Array.isArray(tables) ? tables : tables ? [tables] : []).filter(
    (t): t is RateTableSpec => Boolean(t),
  );

  if (chain.length === 0) {
    return unmatched(
      '적용할 운임표가 없습니다. 이 거래처·기간에 승인된 운임표가 있는지 확인하세요.',
      at,
    );
  }

  let table: RateTableSpec | null = null;
  let line: RateLineSpec | null = null;
  for (const candidate of chain) {
    const hit = matchLine(candidate, ctx);
    if (hit) {
      table = candidate;
      line = hit;
      break;
    }
  }

  if (!table || !line) {
    const tried = chain.map((t) => t.rateTableName).join(' · ');
    return unmatched(
      `${tried} 에서 이 운송에 맞는 줄을 찾지 못했습니다. 차종·구간·거리 조건을 확인하세요.`,
      at,
      chain[0],
    );
  }

  const steps: RateStep[] = [];
  let running = 0;

  // --- 기본료 --------------------------------------------------------
  running += line.baseAmount;
  steps.push({
    key: 'base',
    label: '기본 운임',
    expression: `${table.rateTableName} ${line.lineNo}번 줄`,
    amount: line.baseAmount,
    running,
    kind: 'base',
  });

  // --- 단위 × 단가 ---------------------------------------------------
  const unit = unitOf(table.rateMethod, ctx);
  if (line.unitRate !== null && line.unitRate > 0 && unit.value !== null) {
    const amount = Math.round(unit.value * line.unitRate);
    running += amount;
    steps.push({
      key: 'unit',
      label: '거리·물량 단가',
      expression: `${fmt(unit.value)}${unit.unit} × ${fmt(line.unitRate)}원`,
      amount,
      running,
      kind: 'unit',
    });
  }

  // --- 줄 하한 · 상한 -------------------------------------------------
  if (line.minAmount !== null && running < line.minAmount) {
    const lift = line.minAmount - running;
    running = line.minAmount;
    steps.push({
      key: 'lineMin',
      label: '요율 최저액 보정',
      expression: `이 줄의 최저 ${fmt(line.minAmount)}원`,
      amount: lift,
      running,
      kind: 'floor',
    });
  }
  if (line.maxAmount !== null && running > line.maxAmount) {
    const cut = line.maxAmount - running;
    running = line.maxAmount;
    steps.push({
      key: 'lineMax',
      label: '요율 상한 적용',
      expression: `이 줄의 상한 ${fmt(line.maxAmount)}원`,
      amount: cut,
      running,
      kind: 'cap',
    });
  }

  // --- 표 최저 청구액 -------------------------------------------------
  if (table.minChargeAmount !== null && running < table.minChargeAmount) {
    const lift = table.minChargeAmount - running;
    running = table.minChargeAmount;
    steps.push({
      key: 'minCharge',
      label: '최저 청구액 적용',
      expression: `${table.rateTableName} 최저 ${fmt(table.minChargeAmount)}원`,
      amount: lift,
      running,
      kind: 'floor',
    });
  }

  // --- 절사 ----------------------------------------------------------
  if (table.roundUnit > 1) {
    const rounded = roundTo(running, table.roundUnit, table.roundMethod);
    if (rounded !== running) {
      const diff = rounded - running;
      running = rounded;
      steps.push({
        key: 'round',
        label: '단위 절사',
        expression: `${table.roundUnit}원 단위 ${roundLabel(table.roundMethod)}`,
        amount: diff,
        running,
        kind: 'round',
      });
    }
  }

  const baseAmount = running;

  // --- 부대비 (계산기가 스스로 아는 것만) ------------------------------
  const charges = deriveCharges(ctx, table, line);
  let surchargeAmount = 0;
  for (const c of charges) {
    surchargeAmount += c.amount;
    running += c.amount;
    steps.push({
      key: `charge:${c.chargeCode}`,
      label: c.chargeName,
      expression: c.note,
      amount: c.amount,
      running,
      kind: 'surcharge',
    });
  }

  // --- 유류할증 ------------------------------------------------------
  let fuelSurchargeAmount = 0;
  if (table.applyFuelSurcharge && fuel) {
    fuelSurchargeAmount = fuelAmount(fuel, baseAmount, ctx.distanceKm);
    if (fuelSurchargeAmount !== 0) {
      running += fuelSurchargeAmount;
      steps.push({
        key: 'fuel',
        label: '유류할증',
        expression: fuelExpression(fuel, ctx.distanceKm),
        amount: fuelSurchargeAmount,
        running,
        kind: 'fuel',
      });
    }
  }

  /*
    공급가액을 먼저 세우고 부가세를 그 위에서 만든다.

    ck_settlement_amount 가 `total = supply + tax` 를 강제한다. 합계를 먼저
    정하고 공급가를 역산하면 반올림으로 1원이 어긋나 INSERT 자체가 죽는다.
    이 순서는 바꾸지 말 것.
  */
  const supplyAmount = Math.round(running);
  const taxAmount = table.isTaxable ? Math.round(supplyAmount * VAT_RATE) : 0;
  const totalAmount = supplyAmount + taxAmount;

  steps.push({
    key: 'supply',
    label: '공급가액',
    expression: null,
    amount: supplyAmount,
    running: supplyAmount,
    kind: 'supply',
  });
  steps.push({
    key: 'tax',
    label: table.isTaxable ? '부가세 10%' : '면세',
    expression: table.isTaxable ? `${fmt(supplyAmount)}원 × 10%` : '과세 대상이 아닙니다',
    amount: taxAmount,
    running: totalAmount,
    kind: 'tax',
  });
  steps.push({
    key: 'total',
    label: '합계',
    expression: null,
    amount: totalAmount,
    running: totalAmount,
    kind: 'total',
  });

  return {
    matched: true,
    unmatchedReason: null,
    rateTableId: table.rateTableId,
    rateTableCode: table.rateTableCode,
    rateTableName: table.rateTableName,
    rateMethod: table.rateMethod,
    rateDetailId: line.rateDetailId,
    lineNo: line.lineNo,
    unitRate: line.unitRate,
    baseAmount,
    surchargeAmount,
    fuelSurchargeAmount,
    discountAmount: 0,
    supplyAmount,
    taxAmount,
    totalAmount,
    isTaxable: table.isTaxable,
    charges,
    steps,
    detail: {
      engine: ENGINE_VERSION,
      calculatedAt: at,
      method: table.rateMethod,
      table: {
        id: table.rateTableId,
        code: table.rateTableCode,
        name: table.rateTableName,
        lineNo: line.lineNo,
        applyStartDate: table.applyStartDate,
      },
      inputs: {
        distanceKm: ctx.distanceKm,
        weightKg: ctx.weightKg,
        volumeCbm: ctx.volumeCbm,
        palletQty: ctx.palletQty,
        stopCount: ctx.stopCount,
        waitingMinutes: ctx.waitingMinutes,
        tollFee: ctx.tollFee,
        vehicleTypeId: ctx.vehicleTypeId,
        fromZoneId: ctx.fromZoneId,
        toZoneId: ctx.toZoneId,
      },
      rules: {
        baseAmount: line.baseAmount,
        unitRate: line.unitRate,
        lineMinAmount: line.minAmount,
        lineMaxAmount: line.maxAmount,
        minChargeAmount: table.minChargeAmount,
        roundUnit: table.roundUnit,
        roundMethod: table.roundMethod,
        includeToll: table.includeToll,
        applyFuelSurcharge: table.applyFuelSurcharge,
        isTaxable: table.isTaxable,
        waitingFreeMin: line.waitingFreeMin,
        waitingRateHour: line.waitingRateHour,
        extraStopAmount: line.extraStopAmount,
        fuelYearMonth: fuel?.applyYearMonth ?? null,
      },
      steps,
      charges,
    },
  };
}

function unmatched(reason: string, at: string, table?: RateTableSpec): RateCalculation {
  return {
    matched: false,
    unmatchedReason: reason,
    rateTableId: table?.rateTableId ?? null,
    rateTableCode: table?.rateTableCode ?? null,
    rateTableName: table?.rateTableName ?? null,
    rateMethod: table?.rateMethod ?? null,
    rateDetailId: null,
    lineNo: null,
    unitRate: null,
    baseAmount: 0,
    surchargeAmount: 0,
    fuelSurchargeAmount: 0,
    discountAmount: 0,
    supplyAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
    isTaxable: table?.isTaxable ?? true,
    charges: [],
    steps: [],
    detail: {
      engine: ENGINE_VERSION,
      calculatedAt: at,
      method: table?.rateMethod ?? null,
      table: null,
      inputs: {},
      rules: { unmatched: reason },
      steps: [],
      charges: [],
    },
  };
}

/** 조건이 좁은 줄부터 검사한다 — priority 오름차순, 같으면 line_no */
function matchLine(table: RateTableSpec, ctx: RateContext): RateLineSpec | null {
  const ordered = [...table.lines].sort(
    (a, b) => a.priority - b.priority || a.lineNo - b.lineNo,
  );

  for (const line of ordered) {
    if (!matches(line, ctx)) continue;
    return line;
  }
  return null;
}

function matches(line: RateLineSpec, ctx: RateContext): boolean {
  // 조건 칸이 NULL 이면 제한 없음. 값이 있는데 컨텍스트가 비었으면 못 맞춘다.
  if (line.vehicleTypeId !== null && line.vehicleTypeId !== ctx.vehicleTypeId) return false;
  if (line.fromZoneId !== null && line.fromZoneId !== ctx.fromZoneId) return false;
  if (line.toZoneId !== null && line.toZoneId !== ctx.toZoneId) return false;

  if (!inRange(ctx.distanceKm, line.distanceFrom, line.distanceTo)) return false;
  if (!inRange(ctx.weightKg, line.weightFrom, line.weightTo)) return false;
  if (!inRange(ctx.volumeCbm, line.volumeFrom, line.volumeTo)) return false;
  if (!inRange(ctx.qty, line.qtyFrom, line.qtyTo)) return false;
  if (!inRange(ctx.stopCount, line.stopCountFrom, line.stopCountTo)) return false;

  return true;
}

/** 하한 이상 ~ 상한 미만. DDL 주석이 그렇게 정의해 두었다 */
function inRange(value: number | null, from: number | null, to: number | null): boolean {
  if (from === null && to === null) return true;
  if (value === null) return false;
  if (from !== null && value < from) return false;
  if (to !== null && value >= to) return false;
  return true;
}

/** 산정방식이 무엇을 곱하는가 */
function unitOf(method: string, ctx: RateContext): { value: number | null; unit: string } {
  switch (method) {
    case 'DISTANCE':
      return { value: ctx.distanceKm, unit: 'km' };
    case 'WEIGHT':
      return { value: ctx.weightKg, unit: 'kg' };
    case 'VOLUME':
      return { value: ctx.volumeCbm, unit: 'CBM' };
    case 'PALLET':
      return { value: ctx.palletQty, unit: 'PLT' };
    case 'QTY':
      return { value: ctx.qty, unit: '개' };
    case 'PER_STOP':
      return { value: ctx.stopCount, unit: '개소' };
    case 'TON_KM':
      return {
        value:
          ctx.weightKg !== null && ctx.distanceKm !== null
            ? Math.round(((ctx.weightKg / 1000) * ctx.distanceKm + Number.EPSILON) * 100) / 100
            : null,
        unit: '톤·km',
      };
    // ZONE · PER_TRIP · FIXED 는 곱할 것이 없다. 기본료가 전부다.
    default:
      return { value: null, unit: '' };
  }
}

/**
 * 계산기가 스스로 아는 부대비만 만든다.
 *
 * 하역비·도서산간처럼 **사람이 판단해야 하는 것**은 여기서 만들지 않는다.
 * 자동으로 붙였다가 나중에 근거를 못 대면, 다음 달 청구서 전체가 의심을
 * 받는다. 여기서 만드는 셋은 모두 실적에 숫자로 남아 있는 것들이다.
 */
function deriveCharges(
  ctx: RateContext,
  table: RateTableSpec,
  line: RateLineSpec,
): DerivedCharge[] {
  const out: DerivedCharge[] = [];

  // 대기료 — 무료 시간을 넘긴 만큼, 시간 단위 올림
  if (line.waitingRateHour !== null && line.waitingRateHour > 0) {
    const free = line.waitingFreeMin ?? 0;
    const over = ctx.waitingMinutes - free;
    if (over > 0) {
      const hours = Math.ceil(over / 60);
      const amount = Math.round(hours * line.waitingRateHour);
      out.push({
        chargeCode: 'WAITING',
        chargeName: '대기료',
        chargeMethod: 'PER_HOUR',
        baseValue: over,
        baseUnit: 'MIN',
        unitRate: line.waitingRateHour,
        qty: hours,
        amount,
        isTaxable: table.isTaxable,
        note: `무료 ${free}분 초과 ${over}분 → ${hours}시간 × ${fmt(line.waitingRateHour)}원`,
      });
    }
  }

  // 경유료 — 상·하차 두 곳을 넘는 정차마다
  if (line.extraStopAmount !== null && line.extraStopAmount > 0 && ctx.stopCount > 2) {
    const extra = ctx.stopCount - 2;
    const amount = Math.round(extra * line.extraStopAmount);
    out.push({
      chargeCode: 'EXTRA_STOP',
      chargeName: '경유료',
      chargeMethod: 'PER_UNIT',
      baseValue: ctx.stopCount,
      baseUnit: 'EA',
      unitRate: line.extraStopAmount,
      qty: extra,
      amount,
      isTaxable: table.isTaxable,
      note: `정차 ${ctx.stopCount}곳 중 경유 ${extra}곳 × ${fmt(line.extraStopAmount)}원`,
    });
  }

  // 통행료 — 운임에 포함하지 않는 표에서만 실비로 얹는다
  if (!table.includeToll && ctx.tollFee !== null && ctx.tollFee > 0) {
    out.push({
      chargeCode: 'TOLL',
      chargeName: '통행료',
      chargeMethod: 'FIXED',
      baseValue: null,
      baseUnit: null,
      unitRate: null,
      qty: 1,
      amount: Math.round(ctx.tollFee),
      isTaxable: table.isTaxable,
      note: '운임 미포함 표 — 실비 청구',
    });
  }

  return out;
}

function fuelAmount(fuel: FuelSurchargeSpec, base: number, distanceKm: number | null): number {
  if (fuel.surchargePerKm !== null && distanceKm !== null) {
    return Math.round(distanceKm * fuel.surchargePerKm);
  }
  if (fuel.surchargeRatePct !== null) {
    return Math.round((base * fuel.surchargeRatePct) / 100);
  }
  return Math.round(fuel.surchargeAmount ?? 0);
}

function fuelExpression(fuel: FuelSurchargeSpec, distanceKm: number | null): string {
  const gap = fuel.actualFuelPrice - fuel.baseFuelPrice;
  const head = `기준 ${fmt(fuel.baseFuelPrice)}원/L → 당월 ${fmt(fuel.actualFuelPrice)}원/L (${gap >= 0 ? '+' : '−'}${fmt(Math.abs(gap))})`;
  if (fuel.surchargePerKm !== null && distanceKm !== null) {
    return `${head} · ${fmt(distanceKm)}km × ${fmt(fuel.surchargePerKm)}원`;
  }
  if (fuel.surchargeRatePct !== null) return `${head} · 기본운임의 ${fuel.surchargeRatePct}%`;
  return head;
}

function roundTo(value: number, unit: number, method: string): number {
  const q = value / unit;
  const n = method === 'FLOOR' ? Math.floor(q) : method === 'CEIL' ? Math.ceil(q) : Math.round(q);
  return n * unit;
}

function roundLabel(method: string): string {
  return method === 'FLOOR' ? '절사' : method === 'CEIL' ? '올림' : '반올림';
}

function fmt(v: number): string {
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

// =====================================================================
// 3. CashLadder — 이 화면의 축
// =====================================================================

export const LADDER_STAGES = ['ACTUAL', 'CREATED', 'CONFIRMED', 'INVOICED', 'PAID'] as const;
export type LadderStage = (typeof LADDER_STAGES)[number];

export interface LadderSide {
  /** 이 관문을 통과한 금액 */
  amount: number;
  count: number;
  /** 앞 단에서 여기로 오는 동안 걸린 금액 */
  stuckAmount: number;
  stuckCount: number;
  /** 사다리 맨 윗단 대비 폭. 0…1 — 막대 길이가 이것이다 */
  ratio: number;
}

export interface LadderRung {
  key: LadderStage;
  label: string;
  /** 이 관문이 묻는 것. 막대를 눌렀을 때 나오는 목록의 제목이기도 하다 */
  question: string;
  /** 여기 걸린 것을 풀려면 어느 상태를 봐야 하나 */
  statuses: string[];
  billing: LadderSide;
  payment: LadderSide;
  /** 두 막대의 오른쪽 끝 차이 */
  marginAmount: number;
  marginRate: number | null;
}

export interface CashLadder {
  yearMonth: string;
  rungs: LadderRung[];
  /** 축의 오른쪽 끝이 뜻하는 금액. 범례에 적는다 */
  scale: number;
  /** 기한을 넘긴 미수 · 미지급 */
  overdue: {
    billingAmount: number;
    billingCount: number;
    paymentAmount: number;
    paymentCount: number;
    oldestDays: number | null;
  };
  /** 가장 크게 걸린 관문. 화면 맨 위 한 문장이 이것을 말한다 */
  worst: { stage: LadderStage; label: string; amount: number; type: string } | null;
}

/**
 * 관문별 금액을 모아 사다리를 만든다.
 *
 * 입력은 이미 관문별로 접힌 금액이다. 상태를 어느 단에 넣을지는 서버가
 * 정하지만(`ladderStageOf`), **폭과 걸린 금액을 어떻게 계산할지는 여기서
 * 끝낸다.** 화면이 다시 계산하기 시작하면 매출 화면과 매입 화면이 같은
 * 사다리를 다르게 그리게 된다.
 */
export function buildCashLadder(input: {
  yearMonth: string;
  billing: Record<LadderStage, { amount: number; count: number }>;
  payment: Record<LadderStage, { amount: number; count: number }>;
  overdue: CashLadder['overdue'];
}): CashLadder {
  const meta: Record<LadderStage, { label: string; question: string; statuses: string[] }> = {
    ACTUAL: {
      label: '실적 확정',
      question: '청구할 수 있는 전액',
      statuses: [],
    },
    CREATED: {
      label: '정산 생성',
      question: '아직 정산에 안 묶인 실적',
      statuses: ['DRAFT', 'CALCULATED', 'REVIEWING', 'CONFIRMED', 'APPROVED', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'],
    },
    CONFIRMED: {
      label: '확정 · 승인',
      question: '결재를 기다리는 정산',
      statuses: ['CONFIRMED', 'APPROVED', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'],
    },
    INVOICED: {
      label: '계산서 발행',
      question: '승인됐는데 계산서가 안 나간 것',
      statuses: ['INVOICED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'],
    },
    PAID: {
      label: '수납 완료',
      question: '계산서는 나갔는데 돈이 안 들어온 것',
      statuses: ['PAID', 'CLOSED'],
    },
  };

  const top = Math.max(input.billing.ACTUAL.amount, input.payment.ACTUAL.amount, 1);

  const rungs: LadderRung[] = LADDER_STAGES.map((stage, i) => {
    const prev = i === 0 ? null : LADDER_STAGES[i - 1]!;
    const b = side(input.billing, stage, prev, top);
    const p = side(input.payment, stage, prev, top);
    const margin = b.amount - p.amount;

    return {
      key: stage,
      label: meta[stage].label,
      question: meta[stage].question,
      statuses: meta[stage].statuses,
      billing: b,
      payment: p,
      marginAmount: margin,
      marginRate: b.amount === 0 ? null : round((margin / b.amount) * 100, 1),
    };
  });

  // 가장 크게 걸린 관문 — 맨 위 칸(전액)은 걸린 것이 아니므로 뺀다
  let worst: CashLadder['worst'] = null;
  for (const r of rungs.slice(1)) {
    for (const [type, s] of [
      ['BILLING', r.billing],
      ['PAYMENT', r.payment],
    ] as const) {
      if (s.stuckAmount > (worst?.amount ?? 0)) {
        worst = { stage: r.key, label: r.label, amount: s.stuckAmount, type };
      }
    }
  }

  return { yearMonth: input.yearMonth, rungs, scale: top, overdue: input.overdue, worst };
}

function side(
  source: Record<LadderStage, { amount: number; count: number }>,
  stage: LadderStage,
  prev: LadderStage | null,
  top: number,
): LadderSide {
  const cur = source[stage];
  const before = prev ? source[prev] : null;
  return {
    amount: cur.amount,
    count: cur.count,
    stuckAmount: before ? Math.max(0, before.amount - cur.amount) : 0,
    stuckCount: before ? Math.max(0, before.count - cur.count) : 0,
    ratio: Math.max(0, Math.min(1, cur.amount / top)),
  };
}

/** 정산 상태가 사다리의 어느 단까지 올라왔나 */
export function ladderStageOf(status: string): LadderStage {
  switch (status) {
    case 'PAID':
    case 'CLOSED':
      return 'PAID';
    case 'INVOICED':
    case 'PARTIALLY_PAID':
      return 'INVOICED';
    case 'CONFIRMED':
    case 'APPROVED':
      return 'CONFIRMED';
    default:
      return 'CREATED';
  }
}

// =====================================================================
// 4. 관문 — evaluateSettlementGate()
// =====================================================================

export const SETTLEMENT_ACTIONS = [
  'CALCULATE',
  'CONFIRM',
  'APPROVE',
  'INVOICE',
  'PAY',
  'CANCEL',
] as const;
export type SettlementAction = (typeof SETTLEMENT_ACTIONS)[number];

export const SETTLEMENT_ACTION_LABEL: Record<SettlementAction, string> = {
  CALCULATE: '운임 산출',
  CONFIRM: '확정',
  APPROVE: '승인',
  INVOICE: '계산서 발행',
  PAY: '수납 기록',
  CANCEL: '취소',
};

export interface SettlementGate {
  /** 지금 상태에서 다음에 할 수 있는 일 */
  action: SettlementAction | null;
  actionLabel: string | null;
  /** 이 동작이 되돌릴 수 없는가. 버튼 문구와 확인 절차가 갈린다 */
  irreversible: boolean;
  checks: GateCheck[];
  blockerCount: number;
  cautionCount: number;
  canProceed: boolean;
  /** 막고 있는 첫 번째 이유. 버튼 옆에 그대로 적는다 */
  blockedReason: string | null;
}

export interface SettlementGateInput {
  status: string;
  detailCount: number;
  /** 운임을 못 맞춘 명세 줄 */
  uncalculatedCount: number;
  /** 수기로 넣은 명세 줄 */
  manualCount: number;
  /** 승인 안 난 부대비 · 조정 */
  pendingChargeCount: number;
  pendingAdjustmentCount: number;
  /** 상대처가 이의를 걸었는가 */
  hasDispute: boolean;
  /** 상대처 확인 여부 */
  partnerConfirmed: boolean;
  totalAmount: number;
  paidAmount: number;
  /** 이 정산 기간이 마감됐는가 */
  periodClosed: boolean;
  /** 계산서가 이미 있는가 */
  hasInvoice: boolean;
  /** 상세에 사업자등록번호가 채워져 있는가 — 계산서의 필수 칸 */
  hasBusinessNo: boolean;
}

/**
 * 지금 상태에서 넘을 수 있는 문과, 그 문을 막고 있는 것.
 *
 * 실적의 확정 관문과 같은 두 단 구조다 — `blocker` 는 막고 `caution` 은
 * 짚기만 한다. 막는 것은 **없으면 돈을 못 받거나 법을 어기는 것**뿐이다.
 * 부대비 결재가 안 끝난 정산을 확정하는 것은 흔한 운영이고(부대비는 나중에
 * 조정 전표로 붙는다), 그것까지 막으면 월말에 아무것도 안 넘어간다.
 */
export function evaluateSettlementGate(input: SettlementGateInput): SettlementGate {
  const action = nextAction(input.status);
  const checks: GateCheck[] = [];

  if (action === null) {
    return {
      action: null,
      actionLabel: null,
      irreversible: false,
      checks: [],
      blockerCount: 0,
      cautionCount: 0,
      canProceed: false,
      blockedReason:
        input.status === 'CANCELLED'
          ? '취소된 정산입니다.'
          : input.status === 'CLOSED'
            ? '마감된 정산입니다. 기간 마감을 먼저 풀어야 합니다.'
            : '더 진행할 단계가 없습니다.',
    };
  }

  // --- 모든 단계에 공통 -----------------------------------------------
  checks.push({
    key: 'period',
    level: 'blocker',
    passed: !input.periodClosed,
    title: '정산 기간',
    detail: input.periodClosed
      ? '이 기간은 이미 마감됐습니다. 마감을 풀어야 정산을 움직일 수 있습니다.'
      : '열려 있는 기간입니다.',
  });

  checks.push({
    key: 'detail',
    level: 'blocker',
    passed: input.detailCount > 0,
    title: '정산 명세',
    detail:
      input.detailCount > 0
        ? `실적 ${input.detailCount}건이 명세로 들어 있습니다.`
        : '명세가 비어 있습니다. 확정된 실적을 붙이거나 이 정산을 취소하세요.',
  });

  // --- 단계별 ---------------------------------------------------------
  if (action === 'CALCULATE') {
    checks.push({
      key: 'rate',
      level: 'caution',
      passed: input.uncalculatedCount === 0,
      title: '운임표 매칭',
      detail:
        input.uncalculatedCount === 0
          ? '모든 줄이 운임표에 걸립니다.'
          : `${input.uncalculatedCount}건이 아직 운임표에 안 걸립니다. 산출하면 그 줄만 0원으로 남습니다.`,
    });
  }

  if (action === 'CONFIRM') {
    checks.push({
      key: 'uncalculated',
      level: 'blocker',
      passed: input.uncalculatedCount === 0,
      title: '운임 산출',
      detail:
        input.uncalculatedCount === 0
          ? '모든 줄에 금액이 붙었습니다.'
          : `${input.uncalculatedCount}건이 0원입니다. 운임표에 안 걸린 채로 확정하면 그만큼 못 받습니다.`,
    });
    checks.push({
      key: 'dispute',
      level: 'blocker',
      passed: !input.hasDispute,
      title: '이의 제기',
      detail: input.hasDispute
        ? '상대처가 이의를 제기했습니다. 조정 전표로 정리한 뒤 확정하세요.'
        : '접수된 이의가 없습니다.',
    });
    checks.push({
      key: 'manual',
      level: 'caution',
      passed: input.manualCount === 0,
      title: '수기 입력',
      detail:
        input.manualCount === 0
          ? '수기로 고친 줄이 없습니다.'
          : `${input.manualCount}건이 수기 금액입니다. 사유가 명세서에 남습니다.`,
    });
    checks.push({
      key: 'partner',
      level: 'caution',
      passed: input.partnerConfirmed,
      title: '상대처 확인',
      detail: input.partnerConfirmed
        ? '상대처가 명세를 확인했습니다.'
        : '상대처 확인 전입니다. 확인 없이 확정하면 발행 뒤에 이의가 들어올 수 있습니다.',
    });
  }

  if (action === 'APPROVE') {
    checks.push({
      key: 'charge',
      level: 'caution',
      passed: input.pendingChargeCount + input.pendingAdjustmentCount === 0,
      title: '부대비 · 조정 결재',
      detail:
        input.pendingChargeCount + input.pendingAdjustmentCount === 0
          ? '결재를 기다리는 항목이 없습니다.'
          : `부대비 ${input.pendingChargeCount}건 · 조정 ${input.pendingAdjustmentCount}건이 결재 전입니다. 승인 뒤에 붙이면 조정 전표가 한 장 더 생깁니다.`,
    });
    checks.push({
      key: 'amount',
      level: 'blocker',
      passed: input.totalAmount > 0,
      title: '정산 금액',
      detail:
        input.totalAmount > 0
          ? `합계 ${input.totalAmount.toLocaleString('ko-KR')}원입니다.`
          : '합계가 0원입니다. 운임을 다시 산출하세요.',
    });
  }

  if (action === 'INVOICE') {
    checks.push({
      key: 'businessNo',
      level: 'blocker',
      passed: input.hasBusinessNo,
      title: '사업자등록번호',
      detail: input.hasBusinessNo
        ? '공급자·공급받는자 번호가 모두 있습니다.'
        : '상대처의 사업자등록번호가 비어 있습니다. 기준정보에서 채워야 계산서를 만들 수 있습니다.',
    });
    checks.push({
      key: 'duplicate',
      level: 'blocker',
      passed: !input.hasInvoice,
      title: '중복 발행',
      detail: input.hasInvoice
        ? '이미 계산서가 발행됐습니다. 금액을 고치려면 수정 세금계산서를 내야 합니다.'
        : '아직 계산서가 없습니다.',
    });
  }

  if (action === 'PAY') {
    const remain = input.totalAmount - input.paidAmount;
    checks.push({
      key: 'remain',
      level: 'blocker',
      passed: remain > 0,
      title: '남은 금액',
      detail:
        remain > 0
          ? `${remain.toLocaleString('ko-KR')}원이 남았습니다.`
          : '이미 전액이 들어왔습니다. 더 넣으면 과입금이라 저장되지 않습니다.',
    });
  }

  const blockers = checks.filter((c) => c.level === 'blocker' && !c.passed);
  const cautions = checks.filter((c) => c.level === 'caution' && !c.passed);

  return {
    action,
    actionLabel: SETTLEMENT_ACTION_LABEL[action],
    irreversible: action === 'CONFIRM' || action === 'INVOICE',
    checks,
    blockerCount: blockers.length,
    cautionCount: cautions.length,
    canProceed: blockers.length === 0,
    blockedReason: blockers[0]?.detail ?? null,
  };
}

/** 지금 상태에서 담당자가 다음에 누를 버튼 */
export function nextAction(status: string): SettlementAction | null {
  switch (status) {
    case 'DRAFT':
      return 'CALCULATE';
    case 'CALCULATED':
    case 'REVIEWING':
      return 'CONFIRM';
    case 'CONFIRMED':
      return 'APPROVE';
    case 'APPROVED':
      return 'INVOICE';
    case 'INVOICED':
    case 'PARTIALLY_PAID':
      return 'PAY';
    default:
      return null;
  }
}

/** 그 동작이 정산을 어느 상태로 옮기는가 */
export function statusAfter(action: SettlementAction): SettlementStatus | null {
  switch (action) {
    case 'CALCULATE':
      return 'CALCULATED';
    case 'CONFIRM':
      return 'CONFIRMED';
    case 'APPROVE':
      return 'APPROVED';
    case 'INVOICE':
      return 'INVOICED';
    case 'CANCEL':
      return 'CANCELLED';
    // 수납은 금액이 상태를 정한다 — 부분이면 PARTIALLY_PAID, 전액이면 PAID
    case 'PAY':
      return null;
  }
}

export function canTransition(from: string, to: string): boolean {
  return (SETTLEMENT_FLOW[from] ?? []).includes(to as SettlementStatus);
}

/**
 * 확정된 정산을 되돌릴 수 있는가.
 *
 * 계산서가 나갔으면 되돌릴 수 없다. 발행된 계산서와 정산 금액이 어긋나면
 * 그 차이는 몇 달 뒤 대사에서야 드러나고, 그때는 수정계산서 말고 길이 없다.
 */
export function settlementReopenBlockReason(input: {
  status: string;
  hasInvoice: boolean;
  paidAmount: number;
  periodClosed: boolean;
}): string | null {
  if (input.status === 'CLOSED') return '마감된 정산입니다. 기간 마감을 먼저 풀어야 합니다.';
  if (input.status === 'CANCELLED') return '취소된 정산입니다.';
  if (input.periodClosed) return '이 기간은 마감됐습니다.';
  if (input.hasInvoice) {
    return '세금계산서가 이미 나갔습니다. 금액은 수정 세금계산서와 조정 전표로만 바꿀 수 있습니다.';
  }
  if (input.paidAmount > 0) {
    return `이미 ${input.paidAmount.toLocaleString('ko-KR')}원이 들어왔습니다. 수납 기록을 먼저 지워야 합니다.`;
  }
  if (!['CALCULATED', 'REVIEWING', 'CONFIRMED', 'APPROVED'].includes(input.status)) {
    return '되돌릴 수 있는 단계가 아닙니다.';
  }
  return null;
}

// =====================================================================
// 5. 기간 마감 관문
// =====================================================================

export interface CloseGate {
  checks: GateCheck[];
  blockerCount: number;
  cautionCount: number;
  canClose: boolean;
  blockedReason: string | null;
}

export interface CloseGateInput {
  yearMonth: string;
  /** 그 달의 미확정 실적 */
  unconfirmedActualCount: number;
  /** 확정됐는데 아직 정산에 안 묶인 실적 */
  unsettledActualCount: number;
  unsettledAmount: number;
  /** 승인 전 정산 */
  openSettlementCount: number;
  /** 이의가 걸린 정산 */
  disputeCount: number;
  /** 발행 안 된 승인 정산 */
  uninvoicedCount: number;
  /** 아직 안 들어온 돈 */
  unpaidAmount: number;
  unpaidCount: number;
  /** 이미 마감됐는가 */
  alreadyClosed: boolean;
  /** 아직 오지 않은 달인가 */
  future: boolean;
}

/**
 * 마감 관문.
 *
 * 마감은 **그 달을 다시 안 건드리겠다는 선언**이다. 마감하면 DB 트리거가
 * 그 기간의 실적 변경을 42501 로 막는다(`trg_actual_close_guard`). 그래서
 * 마감 전에 "아직 손댈 것이 남았는가" 를 묻는다.
 *
 * 미수는 막지 않는다 — 수금은 원래 다음 달에 들어온다. 미수 때문에 마감을
 * 못 하면 아무 달도 못 닫는다.
 */
export function evaluateCloseGate(input: CloseGateInput): CloseGate {
  const checks: GateCheck[] = [];

  checks.push({
    key: 'future',
    level: 'blocker',
    passed: !input.future,
    title: '기간',
    detail: input.future
      ? '아직 오지 않은 달은 마감할 수 없습니다.'
      : `${input.yearMonth.slice(0, 4)}년 ${Number(input.yearMonth.slice(4))}월을 마감합니다.`,
  });

  checks.push({
    key: 'already',
    level: 'blocker',
    passed: !input.alreadyClosed,
    title: '마감 상태',
    detail: input.alreadyClosed
      ? '이미 마감된 달입니다.'
      : '아직 열려 있습니다.',
  });

  checks.push({
    key: 'actual',
    level: 'blocker',
    passed: input.unconfirmedActualCount === 0,
    title: '미확정 실적',
    detail:
      input.unconfirmedActualCount === 0
        ? '이 달의 실적이 모두 확정됐습니다.'
        : `${input.unconfirmedActualCount}건이 아직 확정 전입니다. 마감하면 이 실적들은 영영 정산에 못 들어갑니다.`,
  });

  checks.push({
    key: 'unsettled',
    level: 'blocker',
    passed: input.unsettledActualCount === 0,
    title: '미정산 실적',
    detail:
      input.unsettledActualCount === 0
        ? '확정된 실적이 모두 정산에 묶였습니다.'
        : `확정 실적 ${input.unsettledActualCount}건(${compactWon(input.unsettledAmount)})이 아직 정산에 안 묶였습니다. 「정산 만들기」를 먼저 돌리세요.`,
  });

  checks.push({
    key: 'dispute',
    level: 'blocker',
    passed: input.disputeCount === 0,
    title: '이의 제기',
    detail:
      input.disputeCount === 0
        ? '접수된 이의가 없습니다.'
        : `${input.disputeCount}건에 이의가 걸려 있습니다. 마감하면 조정 전표를 넣을 수 없습니다.`,
  });

  checks.push({
    key: 'open',
    level: 'caution',
    passed: input.openSettlementCount === 0,
    title: '승인 전 정산',
    detail:
      input.openSettlementCount === 0
        ? '모든 정산이 승인까지 끝났습니다.'
        : `${input.openSettlementCount}건이 아직 승인 전입니다. 마감해도 결재는 진행되지만, 금액은 더 못 바꿉니다.`,
  });

  checks.push({
    key: 'invoice',
    level: 'caution',
    passed: input.uninvoicedCount === 0,
    title: '미발행 계산서',
    detail:
      input.uninvoicedCount === 0
        ? '승인된 정산의 계산서가 모두 나갔습니다.'
        : `${input.uninvoicedCount}건이 승인됐는데 계산서가 안 나갔습니다. 발행 기한(다음 달 10일)을 확인하세요.`,
  });

  checks.push({
    key: 'unpaid',
    level: 'caution',
    passed: input.unpaidCount === 0,
    title: '미수 · 미지급',
    detail:
      input.unpaidCount === 0
        ? '이 달 정산의 돈이 모두 정리됐습니다.'
        : `${input.unpaidCount}건 ${compactWon(input.unpaidAmount)}이 남았습니다. 수납은 마감 뒤에도 기록할 수 있습니다.`,
  });

  const blockers = checks.filter((c) => c.level === 'blocker' && !c.passed);
  const cautions = checks.filter((c) => c.level === 'caution' && !c.passed);

  return {
    checks,
    blockerCount: blockers.length,
    cautionCount: cautions.length,
    canClose: blockers.length === 0,
    blockedReason: blockers[0]?.detail ?? null,
  };
}

// =====================================================================
// 6. 세금계산서 — 발행 기한
// =====================================================================

/**
 * 세금계산서 발행 기한.
 *
 * 부가가치세법상 공급일이 속한 달의 **다음 달 10일**까지다. 넘기면 가산세가
 * 붙으므로, 이 화면의 축은 "발행했나" 가 아니라 **"며칠 남았나"** 다.
 * 기준정보 화면의 유효기간 막대와 같은 장치를 쓴다 — 같은 질문이면 같은
 * 그림이어야 사람이 다시 배우지 않는다.
 */
export interface InvoiceDeadline {
  /** 법정 기한 (YYYY-MM-DD) */
  dueDate: string;
  /** 남은 날. 음수면 넘겼다 */
  daysLeft: number;
  /** 막대 길이 0…1. 한 달(31일)을 축의 전체로 본다 */
  ratio: number;
  tone: 'normal' | 'soon' | 'urgent' | 'over';
  label: string;
}

export function invoiceDeadline(
  yearMonth: string,
  /** 견줄 날. 발행 전이면 오늘, 발행 뒤면 **발행일** */
  reference: string,
  /**
   * 이미 발행된 계산서인가.
   *
   * 발행 전이면 축은 "며칠 남았나" 이고 기준은 오늘이다. 발행하고 나면 그
   * 질문은 끝났고 남는 것은 **"제때 냈나"** 하나뿐이므로, 기준을 발행일로
   * 바꾸고 문구도 과거형으로 낸다.
   *
   * 이것을 안 가르면 지난달 계산서가 영원히 "기한 N일 초과" 로 뜬다 —
   * 법정 기한에 딱 맞춰 낸 것까지 전부. 그러면 「기한 초과」 지표가 발행한
   * 장 수와 같아지고, 그 순간 그 숫자는 아무 뜻도 없어진다.
   */
  issued = false,
): InvoiceDeadline {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(4, 6));
  // 다음 달 10일. 12월이면 해가 넘어간다.
  const dueY = month === 12 ? year + 1 : year;
  const dueM = month === 12 ? 1 : month + 1;
  const dueDate = `${dueY}-${String(dueM).padStart(2, '0')}-10`;

  const days = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / 86_400_000,
  );

  const tone: InvoiceDeadline['tone'] = issued
    ? days < 0
      ? 'over'
      : 'normal'
    : days < 0
      ? 'over'
      : days <= 3
        ? 'urgent'
        : days <= 7
          ? 'soon'
          : 'normal';

  return {
    dueDate,
    daysLeft: days,
    // 발행이 끝난 줄은 막대가 카운트다운이 아니다. 꽉 채워 "끝났다" 로 둔다.
    ratio: issued ? 1 : Math.max(0, Math.min(1, days / 31)),
    tone,
    label: issued
      ? days < 0
        ? `기한 ${Math.abs(days)}일 넘겨 발행`
        : '기한 내 발행'
      : days < 0
        ? `기한 ${Math.abs(days)}일 초과`
        : days === 0
          ? '오늘이 기한'
          : `${days}일 남음`,
  };
}

// =====================================================================
// 7. 조회 응답 타입
// =====================================================================

export interface SettlementListItem {
  settlementId: string;
  settlementNo: string;
  settlementType: string;
  status: string;
  partnerId: string;
  partnerName: string;
  partnerBusinessNo: string | null;
  yearMonth: string;
  periodFrom: string;
  periodTo: string;
  issueDate: string | null;
  paymentDueDate: string | null;
  detailCount: number;
  baseAmount: number;
  surchargeAmount: number;
  adjustmentAmount: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  /** 매출·매입이 쌍으로 있으면 마진. 없으면 null */
  marginAmount: number | null;
  marginRate: number | null;
  hasInvoice: boolean;
  invoiceStatus: string | null;
  hasDispute: boolean;
  /** 결제 기한을 넘긴 날. 안 넘겼으면 null */
  overdueDays: number | null;
  /** 다음에 할 일과 그것을 막는 것 */
  nextAction: SettlementAction | null;
  nextActionLabel: string | null;
  blockerCount: number;
  cautionCount: number;
  canProceed: boolean;
  blockedReason: string | null;
  confirmedAt: string | null;
  approvedAt: string | null;
}

export interface SettlementListSummary {
  count: number;
  openCount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  overdueCount: number;
  overdueAmount: number;
  /** 아직 정산에 안 묶인 확정 실적 */
  pendingActualCount: number;
  pendingActualAmount: number;
  /** 이 기간이 마감됐는가 */
  periodClosed: boolean;
}

export interface SettlementDetailRow {
  settlementDetailId: string;
  lineNo: number;
  actualId: string | null;
  actualNo: string | null;
  orderId: string | null;
  orderNo: string | null;
  transportDate: string;
  fromLocationName: string | null;
  toLocationName: string | null;
  vehicleNo: string | null;
  vehicleTypeName: string | null;
  driverName: string | null;
  itemSummary: string | null;
  distanceKm: number | null;
  weightKg: number | null;
  stopCount: number | null;
  waitingMinutes: number | null;
  rateTableId: string | null;
  rateTableName: string | null;
  rateMethod: string | null;
  unitRate: number | null;
  baseAmount: number;
  surchargeAmount: number;
  fuelSurchargeAmount: number;
  discountAmount: number;
  adjustmentAmount: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  isManual: boolean;
  manualReason: string | null;
  calculationNote: string | null;
  /** 산출 계단. calculation_detail 에서 편 것 */
  steps: RateStep[];
}

export interface SettlementChargeRow {
  settlementChargeId: string;
  settlementDetailId: string | null;
  lineNo: number | null;
  chargeCode: string;
  chargeName: string;
  chargeMethod: string;
  baseValue: number | null;
  baseUnit: string | null;
  unitRate: number | null;
  qty: number;
  amount: number;
  isTaxable: boolean;
  approvalStatus: string;
  isAutoCalculated: boolean;
  requireEvidence: boolean;
  hasEvidence: boolean;
  exceptionId: string | null;
  remark: string | null;
}

export interface SettlementAdjustmentRow {
  settlementAdjustmentId: string;
  adjustmentNo: string | null;
  adjustmentType: string;
  reason: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  exceptionId: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
}

export interface SettlementPaymentRow {
  paymentRecordId: string;
  paymentDirection: string;
  paymentMethod: string;
  paymentDate: string;
  paymentAmount: number;
  bankName: string | null;
  accountNo: string | null;
  depositorName: string | null;
  transactionNo: string | null;
  isMatched: boolean;
  remark: string | null;
}

export interface SettlementInvoiceRow {
  taxInvoiceId: string;
  invoiceType: string;
  invoiceNo: string | null;
  ntsApprovalNo: string | null;
  issueDate: string;
  status: string;
  supplierName: string;
  supplierBusinessNo: string;
  buyerName: string;
  buyerBusinessNo: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  ntsResultMessage: string | null;
  /** 정산 쪽 정보 — 계산서 목록에서 쓴다 */
  settlementId: string | null;
  settlementNo: string | null;
  settlementType: string | null;
  yearMonth: string | null;
  deadline: InvoiceDeadline | null;
}

export interface SettlementHistoryEntry {
  at: string;
  label: string;
  detail: string | null;
  actor: string | null;
}

export interface SettlementDetailPage {
  settlementId: string;
  settlementNo: string;
  settlementType: string;
  status: string;
  partnerId: string;
  partnerName: string;
  partnerBusinessNo: string | null;
  contractNo: string | null;
  yearMonth: string;
  periodFrom: string;
  periodTo: string;
  closingDate: string | null;
  issueDate: string | null;
  paymentDueDate: string | null;

  detailCount: number;
  baseAmount: number;
  surchargeAmount: number;
  fuelSurchargeAmount: number;
  discountAmount: number;
  adjustmentAmount: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;

  partnerConfirmed: boolean;
  disputeReason: string | null;
  remark: string | null;
  calculatedAt: string | null;
  confirmedAt: string | null;
  approvedAt: string | null;

  gate: SettlementGate;
  reopenBlockedReason: string | null;
  periodClosed: boolean;

  details: SettlementDetailRow[];
  charges: SettlementChargeRow[];
  adjustments: SettlementAdjustmentRow[];
  payments: SettlementPaymentRow[];
  invoice: SettlementInvoiceRow | null;
  history: SettlementHistoryEntry[];
  /** 부대비를 붙일 때 고를 수 있는 유형 */
  surchargeTypes: SurchargeTypeOption[];
}

export interface SurchargeTypeOption {
  surchargeTypeId: string;
  surchargeCode: string;
  surchargeName: string;
  chargeMethod: string;
  defaultAmount: number | null;
  defaultUnitRate: number | null;
  defaultRatePct: number | null;
  isTaxable: boolean;
  requireEvidence: boolean;
  requireApproval: boolean;
}

export interface SettlementCloseRow {
  settlementCloseId: string | null;
  settlementType: string;
  yearMonth: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  /**
   * 이 달에 실적이나 정산이 하나라도 있었나.
   *
   * 아무 일도 없던 달은 마감 순서를 막지 않는다. 나중에 바뀔 것이 없으므로
   * 닫아 둘 이유도 없다. 이것을 안 가르면 6월에 운영을 시작한 회사가 6월을
   * 닫으려고 1월부터 다섯 달을 헛으로 닫아야 한다.
   */
  hasActivity: boolean;
  totalCount: number;
  totalAmount: number;
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  gate: CloseGate;
}

export interface SettlementCloseBoard {
  year: number;
  months: SettlementCloseRow[];
  /** 지금 열려 있는 가장 오래된 달. 마감 순서는 오래된 것부터다 */
  oldestOpen: string | null;
}

// =====================================================================
// 8. 쓰기 스키마
// =====================================================================

const yearMonth = z.string().regex(/^\d{6}$/, '연월 형식이 올바르지 않습니다 (YYYYMM)');
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');

/**
 * 정산 생성.
 *
 * 대상은 **그 기간의 확정된 미정산 실적**이고, 파트너별로 한 장씩 묶는다.
 * 파트너를 안 주면 전부 만든다 — 월말에 스무 화주를 한 번에 여는 일이 흔하다.
 */
export const settlementGenerateSchema = z.object({
  settlementType: z.enum(['BILLING', 'PAYMENT']),
  yearMonth,
  partnerId: z.string().regex(/^\d+$/).nullable().default(null),
  /** 이미 만든 정산에 새 실적만 덧붙일지, 건너뛸지 */
  appendToExisting: z.boolean().default(true),
});
export type SettlementGenerateInput = z.infer<typeof settlementGenerateSchema>;

export const settlementCalculateSchema = z.object({
  /** 수기로 고친 줄까지 다시 계산할지. 기본은 지킨다 */
  overwriteManual: z.boolean().default(false),
});
export type SettlementCalculateInput = z.infer<typeof settlementCalculateSchema>;

export const settlementTransitionSchema = z.object({
  action: z.enum(SETTLEMENT_ACTIONS),
  reason: z.string().trim().max(500).nullable().default(null),
});
export type SettlementTransitionInput = z.infer<typeof settlementTransitionSchema>;

export const settlementReopenSchema = z.object({
  reason: z.string().trim().min(1, '왜 되돌리는지 적어주세요').max(500),
});
export type SettlementReopenInput = z.infer<typeof settlementReopenSchema>;

export const settlementDisputeSchema = z.object({
  reason: z.string().trim().min(1, '무엇이 문제인지 적어주세요').max(1000),
});
export type SettlementDisputeInput = z.infer<typeof settlementDisputeSchema>;

const amount = z.coerce
  .number({ invalid_type_error: '숫자를 입력하세요' })
  .int('원 단위로 입력하세요')
  .min(0, '0 이상이어야 합니다')
  .max(9_999_999_999, '금액이 너무 큽니다');

export const settlementChargeSchema = z.object({
  surchargeTypeId: z.string().regex(/^\d+$/).nullable().default(null),
  settlementDetailId: z.string().regex(/^\d+$/).nullable().default(null),
  chargeCode: z.string().trim().min(1, '비용 유형을 고르세요').max(30),
  chargeName: z.string().trim().min(1, '비용 이름을 적어주세요').max(100),
  chargeMethod: z.enum(['FIXED', 'PER_UNIT', 'PER_HOUR', 'PER_MINUTE', 'PERCENT']),
  baseValue: z.coerce.number().min(0).nullable().default(null),
  baseUnit: z.string().trim().max(20).nullable().default(null),
  unitRate: z.coerce.number().min(0).nullable().default(null),
  qty: z.coerce.number().min(0.001, '수량은 0보다 커야 합니다').default(1),
  amount,
  isTaxable: z.boolean().default(true),
  remark: z.string().trim().max(500).nullable().default(null),
});
export type SettlementChargeInput = z.infer<typeof settlementChargeSchema>;

/**
 * 조정 전표.
 *
 * 확정된 정산의 금액을 바꾸는 **유일한 길**이다. 그래서 사유가 필수이고,
 * 공급가와 부가세를 따로 받는다 — `ck_adjustment_amount` 가
 * `total = supply + tax` 를 강제하므로 합계를 받아 역산하면 1원이 어긋난다.
 */
export const settlementAdjustmentSchema = z
  .object({
    adjustmentType: z.enum(['ADD', 'DEDUCT', 'DISCOUNT', 'PENALTY', 'CLAIM', 'CORRECTION']),
    settlementDetailId: z.string().regex(/^\d+$/).nullable().default(null),
    reason: z.string().trim().min(1, '조정 사유를 적어주세요 — 명세서에 그대로 남습니다').max(1000),
    supplyAmount: amount.refine((v) => v > 0, '조정할 공급가액을 입력하세요'),
    isTaxable: z.boolean().default(true),
    exceptionId: z.string().regex(/^\d+$/).nullable().default(null),
  })
  .transform((v) => ({ ...v, taxAmount: v.isTaxable ? Math.round(v.supplyAmount * VAT_RATE) : 0 }));
export type SettlementAdjustmentInput = z.infer<typeof settlementAdjustmentSchema>;

export const settlementApprovalSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).nullable().default(null),
});
export type SettlementApprovalInput = z.infer<typeof settlementApprovalSchema>;

export const taxInvoiceIssueSchema = z.object({
  invoiceType: z.enum(['TAX', 'EXEMPT']).default('TAX'),
  issueDate: dayString,
  buyerEmail: z.string().trim().email('이메일 형식이 올바르지 않습니다').nullable().default(null),
  remarkText: z.string().trim().max(500).nullable().default(null),
});
export type TaxInvoiceIssueInput = z.infer<typeof taxInvoiceIssueSchema>;

export const taxInvoiceStatusSchema = z.object({
  status: z.enum(['SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED']),
  ntsApprovalNo: z.string().trim().max(50).nullable().default(null),
  ntsResultMessage: z.string().trim().max(500).nullable().default(null),
});
export type TaxInvoiceStatusInput = z.infer<typeof taxInvoiceStatusSchema>;

/**
 * 수납 · 지급 기록.
 *
 * `ck_settlement_paid` 가 과입금을 막는다(`paid <= total + 0.01`). 화면이
 * 먼저 남은 금액을 알려 주는 이유가 그것이다 — 넣고 나서 거절당하면 얼마를
 * 넣어야 했는지 다시 세야 한다.
 */
export const paymentRecordSchema = z.object({
  settlementId: z.string().regex(/^\d+$/),
  paymentMethod: z
    .enum(['BANK_TRANSFER', 'CARD', 'CHECK', 'CASH', 'OFFSET', 'ETC'])
    .default('BANK_TRANSFER'),
  paymentDate: dayString,
  paymentAmount: amount.refine((v) => v > 0, '금액을 입력하세요'),
  bankName: z.string().trim().max(50).nullable().default(null),
  accountNo: z.string().trim().max(50).nullable().default(null),
  depositorName: z.string().trim().max(100).nullable().default(null),
  transactionNo: z.string().trim().max(100).nullable().default(null),
  remark: z.string().trim().max(500).nullable().default(null),
});
export type PaymentRecordInput = z.infer<typeof paymentRecordSchema>;

export const settlementCloseSchema = z.object({
  settlementType: z.enum(['BILLING', 'PAYMENT']),
  yearMonth,
  remark: z.string().trim().max(500).nullable().default(null),
});
export type SettlementCloseInput = z.infer<typeof settlementCloseSchema>;

export const settlementReopenCloseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, '마감을 푸는 이유를 적어주세요 — 감사 대상입니다')
    .max(500),
});
export type SettlementReopenCloseInput = z.infer<typeof settlementReopenCloseSchema>;

// =====================================================================
// 9. 표시 도우미
// =====================================================================

/** 억·만 단위로 접는다. 표의 합계 칸처럼 자릿수를 세게 하면 안 되는 자리 */
export function compactWon(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`;
  return `${sign}${abs.toLocaleString('ko-KR')}`;
}

/** 원 단위 전체 표기. 명세서와 계산서처럼 한 원까지 맞아야 하는 자리 */
export function won(amount: number): string {
  return amount.toLocaleString('ko-KR');
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
