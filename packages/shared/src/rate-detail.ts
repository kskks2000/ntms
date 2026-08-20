/**
 * 요율 상세 — 금액이 실제로 만들어지는 곳.
 *
 * 운임표(rate_table)는 머리다. 한 건의 운송에 얼마를 매길지는 여기 있는
 * 줄 하나가 정한다. 그래서 상세가 0줄인 운임표는 승인 상태가 무엇이든
 * 아무 금액도 만들어 내지 못한다.
 *
 * ## 조건 축이 산정방식마다 다르다
 *
 * 이 표를 한 벌의 컬럼으로 그릴 수 없는 이유다.
 *
 *   거리요율   차종 × 거리구간   →  기본료 + km당 단가
 *   권역요율   출발권역 × 도착권역 →  구간 정액
 *   트립당     차종             →  한 번 돌 때 정액
 *   중량       중량구간          →  기본료 + kg당 단가
 *
 * DB 는 이 모두를 한 테이블에 담고 안 쓰는 칸은 NULL 로 둔다(조건 컬럼
 * NULL = 제한없음). 화면도 같은 규칙을 따르되, **쓰지 않는 칸은 아예
 * 보여주지 않는다.** 거리요율을 짜는 사람에게 권역 칸을 보이면 넣어도
 * 되는 값인 줄 안다.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 조건 축
// ---------------------------------------------------------------------

/** 요율 한 줄이 가질 수 있는 조건 칸 */
export type RateAxis =
  | 'vehicleType'
  | 'zonePair'
  | 'locationPair'
  | 'distance'
  | 'weight'
  | 'qty'
  | 'stopCount';

/**
 * 산정방식이 쓰는 조건 축.
 *
 * 여기 없는 축은 화면에서 감추고 저장할 때 null 로 보낸다. 방식을 바꾸면
 * 이전 방식의 조건이 남아 조용히 매칭에 끼어드는 것을 막는다.
 */
export const RATE_METHOD_AXES: Record<string, RateAxis[]> = {
  DISTANCE: ['vehicleType', 'distance'],
  ZONE: ['zonePair', 'vehicleType'],
  PER_TRIP: ['vehicleType'],
  PER_STOP: ['vehicleType', 'stopCount'],
  WEIGHT: ['vehicleType', 'weight'],
  VOLUME: ['vehicleType', 'qty'],
  PALLET: ['vehicleType', 'qty'],
  QTY: ['vehicleType', 'qty'],
  TON_KM: ['vehicleType', 'distance', 'weight'],
  PERCENT: ['vehicleType'],
  FIXED: ['vehicleType'],
};

/** 단가 칸이 무엇의 단가인지. 방식마다 단위가 달라 라벨을 함께 준다 */
export const RATE_UNIT_LABEL: Record<string, string | null> = {
  DISTANCE: 'km당',
  TON_KM: '톤·km당',
  WEIGHT: 'kg당',
  VOLUME: 'CBM당',
  PALLET: 'PLT당',
  QTY: '개당',
  PER_STOP: '정차당',
  PERCENT: '%',
  ZONE: null,
  PER_TRIP: null,
  FIXED: null,
};

export function axesOf(method: string): RateAxis[] {
  return RATE_METHOD_AXES[method] ?? ['vehicleType'];
}

// ---------------------------------------------------------------------
// 스키마
// ---------------------------------------------------------------------

const money = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      const t = v.trim().replace(/,/g, '');
      if (t === '') return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    }
    return v;
  })
  .refine((v) => v === null || !Number.isNaN(v), '숫자를 입력하세요')
  .refine((v) => v === null || v >= 0, '0 이상이어야 합니다')
  .default(null);

const ref = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim()))
  .default(null);

export const rateDetailSchema = z
  .object({
    // 조건
    vehicleTypeId: ref,
    fromZoneId: ref,
    toZoneId: ref,
    distanceFrom: money,
    distanceTo: money,
    weightFrom: money,
    weightTo: money,
    qtyFrom: money,
    qtyTo: money,
    stopCountFrom: money,
    stopCountTo: money,
    // 금액
    baseAmount: money.refine((v): v is number => v !== null, '기본료를 입력하세요'),
    unitRate: money,
    minAmount: money,
    maxAmount: money,
    extraStopAmount: money,
    waitingFreeMin: money,
    waitingRateHour: money,
    // 여러 줄이 동시에 걸리면 이 값이 작은 줄이 이긴다
    priority: money,
    remark: z
      .string()
      .trim()
      .max(500, '500자 이하로 입력하세요')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
  })
  // ck_rate_detail_distance / weight / volume — 구간의 끝이 시작보다 앞설 수 없다
  .refine((v) => v.distanceTo === null || v.distanceFrom === null || v.distanceTo >= v.distanceFrom, {
    message: '거리 구간이 뒤집혔습니다',
    path: ['distanceTo'],
  })
  .refine((v) => v.weightTo === null || v.weightFrom === null || v.weightTo >= v.weightFrom, {
    message: '중량 구간이 뒤집혔습니다',
    path: ['weightTo'],
  })
  .refine((v) => v.qtyTo === null || v.qtyFrom === null || v.qtyTo >= v.qtyFrom, {
    message: '수량 구간이 뒤집혔습니다',
    path: ['qtyTo'],
  })
  .refine((v) => v.maxAmount === null || v.minAmount === null || v.maxAmount >= v.minAmount, {
    message: '상한이 하한보다 작습니다',
    path: ['maxAmount'],
  });

export type RateDetailInput = z.input<typeof rateDetailSchema>;
export type RateDetailValues = z.output<typeof rateDetailSchema>;

/**
 * 저장은 줄 단위가 아니라 **표 전체를 한 번에** 바꾼다.
 *
 * 요율표를 고치는 일은 한 줄만 건드리는 경우가 드물다 — 구간을 새로 나누고
 * 단가를 다시 배분한다. 줄마다 따로 저장하면 그 중간중간이 전부 "말이 안
 * 되는 운임표" 상태로 저장되고, 그때 계산되는 오더가 있으면 틀린 금액이
 * 나간다.
 */
export const rateDetailBulkSchema = z.object({
  rows: z.array(rateDetailSchema).max(500, '한 운임표에 500줄까지 넣을 수 있습니다'),
});

export type RateDetailBulkInput = z.input<typeof rateDetailBulkSchema>;
export type RateDetailBulkValues = z.output<typeof rateDetailBulkSchema>;

// ---------------------------------------------------------------------
// 조회 응답
// ---------------------------------------------------------------------

/** 요율 상세 화면이 받는 것 — 머리 요약과 줄 목록 */
export interface RateDetailPage {
  tariff: {
    id: string;
    rateTableCode: string;
    rateTableName: string;
    rateTarget: string;
    rateMethod: string;
    partnerName: string | null;
    applyStartDate: string;
    applyEndDate: string | null;
    minChargeAmount: number | null;
    status: string;
    isActive: boolean;
  };
  rows: (RateDetailValues & { lineNo: number })[];
  /**
   * 정산이 이미 참조한 줄이 있으면 표를 갈아 끼울 수 없다.
   * 그 사실을 화면에 미리 알려 저장 단추를 잠근다.
   */
  lockedBySettlement: number;
}
