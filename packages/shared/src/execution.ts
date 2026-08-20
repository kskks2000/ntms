/**
 * 운송실행 · 트래킹.
 *
 * ## 지도는 답이 아니다
 *
 * 트래킹 화면은 대개 지도부터 그린다. 그런데 관제 담당자가 지도를 보고
 * 알아내는 것은 "차가 저기 있구나" 하나뿐이다. 정작 손이 필요한 순간은
 * 그다음이다 —
 *
 *   2번 정차에서 40분 늦었다.
 *   → 3·4·5번이 다 밀린다.
 *   → 그중 4번은 18:40 에 도크가 닫힌다.
 *   → **지금 화주에게 전화해야 한다.**
 *
 * 지도는 이 사슬의 첫 칸만 보여주고 멈춘다. 나머지를 사람이 머릿속으로
 * 이어붙이고 있으면, 바쁜 날에는 반드시 놓친다.
 *
 * 그래서 이 파일은 **지연이 뒤로 어떻게 번지는지**를 계산한다. 화면의
 * 주인공은 그 축이고, 지도는 위치를 확인하는 창으로 옆에 둔다.
 *
 * ## 지연은 그냥 밀리지만은 않는다
 *
 * 계획에 이미 기다림이 들어 있으면 지연이 거기서 흡수된다. 3번 정차에
 * 14:00 도착 예정인데 도크가 15:00 에 열린다면, 계획도 한 시간을 서 있다
 * — 40분 늦어도 출발 시각은 그대로다. 이걸 계산에 넣지 않으면 화면이
 * "5개 정차 전부 40분 지연" 이라고 겁을 주고, 담당자는 곧 화면을 안 믿게
 * 된다. 한 번 안 믿기 시작한 경보는 진짜일 때도 안 본다.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 라벨
// ---------------------------------------------------------------------

// 실행 상태 라벨(EXECUTION_STATUS_LABEL)은 dashboard.ts 에 이미 있다.
// 두 벌을 두면 한쪽만 고쳐져 화면마다 다른 말이 나온다.

export const STOP_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  ARRIVED: '도착',
  SERVICING: '작업중',
  COMPLETED: '완료',
  SKIPPED: '건너뜀',
  FAILED: '실패',
};

export const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  DELAY: '지연',
  TRAFFIC: '교통정체',
  WEATHER: '기상',
  ACCIDENT: '사고',
  BREAKDOWN: '차량고장',
  CARGO_DAMAGE: '화물파손',
  CARGO_LOSS: '화물분실',
  CUSTOMER_ABSENT: '수하인 부재',
  ADDRESS_ERROR: '주소오류',
  LOADING_DELAY: '상하차 지연',
  DOCUMENT: '서류',
  ETC: '기타',
};

export const EXCEPTION_SEVERITY_LABEL: Record<string, string> = {
  LOW: '낮음',
  MEDIUM: '보통',
  HIGH: '높음',
  CRITICAL: '심각',
};

export const EXCEPTION_STATUS_LABEL: Record<string, string> = {
  REPORTED: '접수',
  INVESTIGATING: '확인중',
  ACTION_TAKEN: '조치완료',
  RESOLVED: '해결',
  CLOSED: '종결',
};

export const POD_TYPE_LABEL: Record<string, string> = {
  SIGNATURE: '서명',
  PHOTO: '사진',
  STAMP: '날인',
  EDI: 'EDI',
  PAPER: '종이',
  PIN_CODE: '인증번호',
};

export const POD_RESULT_LABEL: Record<string, string> = {
  NORMAL: '정상',
  PARTIAL: '부분인수',
  DAMAGED: '파손',
  SHORTAGE: '수량부족',
  REFUSED: '인수거부',
  ABSENT: '부재',
  MISDELIVERY: '오배송',
};

/** 이 상태들이 아직 손이 필요한 예외다 */
export const EXCEPTION_OPEN_STATUSES = ['REPORTED', 'INVESTIGATING', 'ACTION_TAKEN'] as const;

// ---------------------------------------------------------------------
// 지연 전파 축
// ---------------------------------------------------------------------

export interface CascadeStopInput {
  stopSeq: number;
  stopType: string;
  locationName: string;
  /** 계획 도착 · 출발 (ISO) */
  plannedArrivalAt: string | null;
  plannedDepartureAt: string | null;
  /** 도크가 열리고 닫히는 시각 (ISO) */
  windowFrom: string | null;
  windowTo: string | null;
  /** 실적 — 있으면 이 정차는 지났다 */
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  status: string;
}

export interface CascadeRow {
  stopSeq: number;
  stopType: string;
  locationName: string;
  status: string;
  /** 실적인가 예측인가. 계획 시각이 없으면 unknown */
  basis: 'actual' | 'forecast' | 'unknown';
  plannedArrivalAt: string | null;
  /** 지난 정차면 실적, 남은 정차면 지금 지연을 얹은 예상 */
  expectedArrivalAt: string | null;
  /** 계획 대비 분. 음수면 이르다 */
  deltaMinutes: number;
  /** 이 정차의 계획된 대기가 삼킨 지연 */
  absorbedMinutes: number;
  /** 이 정차를 지나 뒤로 넘어가는 지연 */
  carriedMinutes: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** 예상 도착이 마감을 넘는가 */
  isBreach: boolean;
  breachMinutes: number;
}

export interface DelayCascade {
  rows: CascadeRow[];
  /** 지금 물고 있는 지연 — 마지막으로 지난 정차 기준 */
  currentDelayMinutes: number;
  /** 마감을 놓칠 첫 정차. 없으면 null */
  firstBreachSeq: number | null;
  breachCount: number;
  /**
   * 앞으로 몇 분을 더 까먹어도 아무 마감도 안 넘기나.
   *
   * 관제가 실제로 원하는 숫자는 "지금 40분 늦었다" 가 아니라 "앞으로
   * 12분까지만 버틴다" 다. 앞의 것은 지난 일이고 뒤의 것은 지금 할 일을
   * 정한다. 이미 넘겼으면 null.
   */
  headroomMinutes: number | null;
}

const MIN = 60_000;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * 지연이 뒤로 어떻게 번지는지.
 *
 * 지난 정차는 실적을 그대로 쓰고, 남은 정차는 **마지막으로 지난 정차에서
 * 물고 있는 지연**을 계획 위에 얹는다. 그 지연은 계획된 대기가 있는 곳에서
 * 줄어든다.
 *
 *   흡수량 = min(물고 있는 지연, max(0, 도크 여는 시각 − 계획 도착))
 *
 * 계획이 이미 기다리기로 한 만큼은 늦게 와도 출발이 같기 때문이다.
 */
export function buildCascade(
  stops: CascadeStopInput[],
  /** 실행 헤더가 들고 있는 지연. 실적이 아직 없을 때 쓴다 */
  seedDelayMinutes?: number,
): DelayCascade {
  const ordered = [...stops].sort((a, b) => a.stopSeq - b.stopSeq);
  const seed = seedDelayMinutes ?? null;
  const rows = simulate(ordered, seed, 0);
  const breaches = rows.filter((r) => r.isBreach);
  // 남은 정차가 없으면 "몇 분까지 버티나" 라는 질문 자체가 성립하지 않는다.
  // 끝난 건에 상한값(600)이 붙어 나가면 화면이 "여유 10시간" 이라고 말한다.
  const remaining = rows.some((r) => r.basis !== 'actual');

  return {
    rows,
    currentDelayMinutes: lastActualDelay(ordered, seed),
    firstBreachSeq: breaches[0]?.stopSeq ?? null,
    breachCount: breaches.length,
    headroomMinutes: !remaining || breaches.length > 0 ? null : headroom(ordered, seed),
  };
}

/** 마지막으로 지난 정차에서 계획 대비 몇 분 늦게 떠났나 */
function lastActualDelay(stops: CascadeStopInput[], seed: number | null): number {
  for (let i = stops.length - 1; i >= 0; i -= 1) {
    const s = stops[i]!;
    const actual = ms(s.actualDepartureAt) ?? ms(s.actualArrivalAt);
    const planned = ms(s.plannedDepartureAt) ?? ms(s.plannedArrivalAt);
    if (actual !== null && planned !== null) return Math.round((actual - planned) / MIN);
  }
  return seed ?? 0;
}

function simulate(
  stops: CascadeStopInput[],
  seed: number | null,
  extraMinutes: number,
): CascadeRow[] {
  // null 이면 아직 지나온 정차가 없다는 뜻 — 그때는 헤더의 지연을 쓴다
  let carried: number | null = null;
  /*
    가정 지연은 **한 번만** 얹는다.

    남은 정차마다 더하면 지연이 정차 수만큼 불어난다. 여유 계산이
    정차가 많은 트립일수록 짜게 나오고, 담당자는 아직 시간이 있는데도
    붉은 줄을 보게 된다.
  */
  let extraApplied = false;
  const out: CascadeRow[] = [];

  for (const s of stops) {
    const plannedArr = ms(s.plannedArrivalAt);
    const plannedDep = ms(s.plannedDepartureAt) ?? plannedArr;
    const open = ms(s.windowFrom);
    const close = ms(s.windowTo);
    const actualArr = ms(s.actualArrivalAt);
    const actualDep = ms(s.actualDepartureAt);

    // 지난 정차 — 있었던 일을 그대로 쓴다
    if (actualArr !== null) {
      const delta = plannedArr === null ? 0 : Math.round((actualArr - plannedArr) / MIN);
      const departed = actualDep ?? actualArr;
      carried = plannedDep === null ? delta : Math.round((departed - plannedDep) / MIN);
      const over = close !== null && actualArr > close;
      out.push({
        stopSeq: s.stopSeq,
        stopType: s.stopType,
        locationName: s.locationName,
        status: s.status,
        basis: 'actual',
        plannedArrivalAt: s.plannedArrivalAt,
        expectedArrivalAt: s.actualArrivalAt,
        deltaMinutes: delta,
        absorbedMinutes: 0,
        carriedMinutes: carried,
        windowFrom: s.windowFrom,
        windowTo: s.windowTo,
        isBreach: over,
        breachMinutes: over ? Math.round((actualArr - close!) / MIN) : 0,
      });
      continue;
    }

    // 남은 정차 — 물고 있는 지연을 계획 위에 얹는다
    // 타입을 적어 두지 않으면 carried 를 거쳐 자기 자신을 참조해 TS7022 가 난다
    const carry: number = (carried ?? seed ?? 0) + (extraApplied ? 0 : extraMinutes);
    extraApplied = true;

    if (plannedArr === null) {
      out.push({
        stopSeq: s.stopSeq,
        stopType: s.stopType,
        locationName: s.locationName,
        status: s.status,
        basis: 'unknown',
        plannedArrivalAt: null,
        expectedArrivalAt: null,
        deltaMinutes: 0,
        absorbedMinutes: 0,
        carriedMinutes: carry,
        windowFrom: s.windowFrom,
        windowTo: s.windowTo,
        isBreach: false,
        breachMinutes: 0,
      });
      carried = carry;
      continue;
    }

    const expected = plannedArr + carry * MIN;
    // 계획이 이미 기다리기로 한 만큼은 늦게 와도 출발이 같다
    const plannedWait = open === null ? 0 : Math.max(0, Math.round((open - plannedArr) / MIN));
    const absorbed = Math.max(0, Math.min(carry, plannedWait));
    carried = carry - absorbed;

    const over = close !== null && expected > close;
    out.push({
      stopSeq: s.stopSeq,
      stopType: s.stopType,
      locationName: s.locationName,
      status: s.status,
      basis: 'forecast',
      plannedArrivalAt: s.plannedArrivalAt,
      expectedArrivalAt: new Date(expected).toISOString(),
      deltaMinutes: carry,
      absorbedMinutes: absorbed,
      carriedMinutes: carried,
      windowFrom: s.windowFrom,
      windowTo: s.windowTo,
      isBreach: over,
      breachMinutes: over ? Math.round((expected - close!) / MIN) : 0,
    });
  }

  return out;
}

/**
 * 몇 분까지 버티나.
 *
 * 지연이 커질수록 예상 도착은 단조롭게 늦어지므로, 마감을 안 넘기는 가장
 * 큰 추가 지연을 이분탐색으로 찾는다. 흡수가 구간마다 꺾이는 함수라 닫힌
 * 식으로 풀면 경계에서 틀리기 쉽다 — 열 번 도는 편이 안전하다.
 */
function headroom(stops: CascadeStopInput[], seed: number | null): number {
  const clean = (x: number) => simulate(stops, seed, x).every((r) => !r.isBreach);
  if (!clean(0)) return 0;

  const ceiling = 600; // 10시간을 더 늦는다면 이미 다른 종류의 문제다
  if (clean(ceiling)) return ceiling;

  let lo = 0;
  let hi = ceiling;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (clean(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------
// 관제 보드
// ---------------------------------------------------------------------

export interface TrackedStop {
  stopSeq: number;
  stopType: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ExecutionCard {
  executionId: string;
  tripNo: string;
  executionDate: string;
  status: string;
  carrierName: string;
  vehicleNo: string;
  driverName: string | null;
  driverMobile: string | null;
  orderCount: number;
  completedStopCount: number;
  totalStopCount: number;
  progressRate: number;
  delayMinutes: number;
  /** 남은 정차 중 마감을 놓칠 곳 */
  breachCount: number;
  headroomMinutes: number | null;
  openExceptionCount: number;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationAt: string | null;
  lastSpeedKmh: number | null;
  /** 지금 향하는 곳 */
  nextStopName: string | null;
  nextStopEtaAt: string | null;
  nextStopWindowTo: string | null;
}

export interface ControlBoardSummary {
  running: number;
  delayed: number;
  breaching: number;
  onTimeRate: number | null;
  openExceptions: number;
  missingPods: number;
}

export interface ControlBoard {
  date: string;
  summary: ControlBoardSummary;
  executions: ExecutionCard[];
}

export interface ExecutionTrack {
  executionId: string;
  tripNo: string;
  status: string;
  executionDate: string;
  vehicleNo: string;
  driverName: string | null;
  driverMobile: string | null;
  carrierName: string;
  delayMinutes: number;
  progressRate: number;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationAt: string | null;
  lastSpeedKmh: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  stops: TrackedStop[];
  cascade: DelayCascade;
  /** 지나온 자취 — [경도, 위도] */
  trail: [number, number][];
  /** 도로 경로. 지도 키가 없으면 비어 있고 화면은 정차를 직선으로 잇는다 */
  route: [number, number][];
  routeSource: 'naver' | 'none';
  orders: { orderId: string; orderNo: string; shipperName: string; toLocationName: string }[];
  exceptions: ExceptionRow[];
}

/**
 * 한 건 찾기.
 *
 * 관제 화면이 "오늘 전체" 를 본다면 추적 화면은 **화주 전화 한 통**에
 * 답한다 — "우리 물건 어디쯤 왔나요". 그때 담당자 손에 있는 것은 오더
 * 번호나 차량번호 하나뿐이므로, 무엇으로 찾든 같은 창구가 받는다.
 */
export interface ExecutionLookupRow {
  executionId: string;
  tripNo: string;
  executionDate: string;
  status: string;
  vehicleNo: string;
  driverName: string | null;
  carrierName: string;
  delayMinutes: number;
  progressRate: number;
  /** 검색어가 걸린 오더. 화주가 물어본 바로 그 건이다 */
  matchedOrderNo: string | null;
  orderNos: string[];
}

export interface ExecutionLookupPage {
  query: string;
  rows: ExecutionLookupRow[];
}

// ---------------------------------------------------------------------
// 예외
// ---------------------------------------------------------------------

export interface ExceptionRow {
  exceptionId: string;
  exceptionNo: string | null;
  executionId: string | null;
  tripNo: string | null;
  exceptionType: string;
  severity: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
  description: string;
  actionTaken: string | null;
  impactMinutes: number | null;
  vehicleNo: string | null;
  driverName: string | null;
  carrierName: string | null;
  latitude: number | null;
  longitude: number | null;
  resolvedAt: string | null;
}

export interface ExceptionPage {
  rows: ExceptionRow[];
  total: number;
  /** 미해결 건이 까먹고 있는 시간 합 — 예외 목록의 무게 */
  openImpactMinutes: number;
  openCount: number;
  /** 유형별 미해결 건수. 어디서 반복해서 터지는지 */
  byType: { type: string; open: number; impactMinutes: number }[];
}

export const exceptionUpdateSchema = z.object({
  status: z.enum(['REPORTED', 'INVESTIGATING', 'ACTION_TAKEN', 'RESOLVED', 'CLOSED']),
  actionTaken: z.string().trim().max(2000).nullable().default(null),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});
export type ExceptionUpdateInput = z.infer<typeof exceptionUpdateSchema>;

export const exceptionCreateSchema = z.object({
  executionId: z.string().min(1, '운송건을 선택하세요'),
  exceptionType: z.enum([
    'DELAY',
    'TRAFFIC',
    'WEATHER',
    'ACCIDENT',
    'BREAKDOWN',
    'CARGO_DAMAGE',
    'CARGO_LOSS',
    'CUSTOMER_ABSENT',
    'ADDRESS_ERROR',
    'LOADING_DELAY',
    'DOCUMENT',
    'ETC',
  ]),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  description: z.string().trim().min(1, '무슨 일인지 적어주세요').max(2000),
  impactMinutes: z.coerce.number().int().min(0).max(2880).nullable().default(null),
});
export type ExceptionCreateInput = z.infer<typeof exceptionCreateSchema>;

// ---------------------------------------------------------------------
// 인수증
// ---------------------------------------------------------------------

export interface PodRow {
  podId: string;
  podNo: string | null;
  executionId: string;
  tripNo: string | null;
  orderId: string;
  orderNo: string;
  shipperName: string;
  toLocationName: string;
  podType: string;
  podResult: string;
  receiverName: string | null;
  deliveredAt: string;
  isGeofenceVerified: boolean;
  isConfirmed: boolean;
  confirmedAt: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  abnormalReason: string | null;
}

/**
 * 인수증이 아직 안 들어온 건.
 *
 * 인수증 화면의 본론은 쌓인 서류가 아니라 **빠진 서류**다. 인수증이 없으면
 * 청구를 못 닫으므로, 끝난 지 오래인데 아직 없는 건이 곧 돈이 묶인 건이다.
 * 그래서 목록보다 이 표가 위에 온다.
 */
export interface MissingPodRow {
  executionId: string;
  tripNo: string;
  orderId: string;
  orderNo: string;
  shipperName: string;
  toLocationName: string;
  completedAt: string | null;
  /** 끝난 지 몇 시간 지났나 */
  agingHours: number | null;
  vehicleNo: string | null;
  driverName: string | null;
  carrierName: string;
}

export interface PodPage {
  rows: PodRow[];
  total: number;
  missing: MissingPodRow[];
  summary: {
    collected: number;
    confirmed: number;
    abnormal: number;
    missing: number;
    /** 인수증이 붙은 비율 */
    collectionRate: number | null;
  };
}

export const podConfirmSchema = z.object({
  confirm: z.coerce.boolean(),
  disputeReason: z.string().trim().max(500).nullable().default(null),
});
export type PodConfirmInput = z.infer<typeof podConfirmSchema>;
