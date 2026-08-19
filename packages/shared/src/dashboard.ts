/**
 * 관제 현황 화면이 읽는 것.
 *
 * TMS 의 하루는 한 줄로 흐른다 —
 *   오더 접수 → 편성(상차조합) → 운송사 배정 → 배차 → 운송실행 → 실적 → 정산
 *
 * 배차 담당자가 아침에 알아야 하는 것은 "몇 건 처리했나" 가 아니라
 * **"지금 어디에 얼마나 쌓여 있나"** 다. 그래서 단계마다 두 숫자를 함께 낸다.
 *
 *   passed   그 단계를 통과해 다음으로 넘어간 오더 수 → 흐름
 *   backlog  그 단계에 머물러 있는 오더 수           → 정체
 *
 * 화면은 이것을 축 위/아래로 그린다. 위로 흐르고 아래로 쌓인다.
 */

export const PIPELINE_STAGES = [
  'RECEIPT',
  'CONSOLIDATION',
  'ALLOCATION',
  'DISPATCH',
  'TRANSIT',
  'ACTUAL',
  'SETTLEMENT',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineNode {
  stage: PipelineStage;
  /** 단계 이름 (접수 · 편성 · 배정 …) */
  label: string;
  /** 이 단계를 통과한 오더 수 */
  passed: number;
  /** 이 단계에 머물러 있는 오더 수 */
  backlog: number;
  /** 머물러 있는 것을 뭐라고 부르는가 (미편성 · 수락대기 …) */
  backlogLabel: string;
  /** 손을 대야 할 정도로 쌓였는가 */
  isBottleneck: boolean;
  /** 눌렀을 때 갈 화면 */
  href: string;
}

/** 지금 손대야 할 일 한 건 */
export interface AttentionItem {
  id: string;
  /** 어떤 종류의 일인가 */
  kind: 'DELAY' | 'PENDING_ACCEPT' | 'UNDISPATCHED' | 'ON_HOLD' | 'POD_PENDING';
  severity: 'critical' | 'warning' | 'info';
  /** 오더번호 · 트립번호 등 업무 식별자 */
  ref: string;
  title: string;
  detail: string;
  /** 기준 시각 (ISO). 화면이 "n분 전 / n분 뒤" 로 바꾼다 */
  at: string | null;
  href: string;
}

/** 오늘 하루의 숫자 */
export interface TodayFigures {
  orderCount: number;
  tripCount: number;
  dispatchCount: number;
  runningCount: number;
  /** 총 중량 (톤) */
  weightTon: number;
  /** 계획 주행거리 합 (km) */
  plannedDistanceKm: number;
  /** 정시 도착률 (%). 완료된 운행이 없으면 null */
  onTimeRate: number | null;
  delayedCount: number;
  /** 평균 적재율 (%) — 중량 기준 */
  loadingRate: number | null;
}

/** 지금 도로 위에 있는 차 */
export interface RunningTrip {
  tripId: string;
  tripNo: string;
  carrierName: string;
  vehicleNo: string;
  driverName: string;
  fromName: string;
  toName: string;
  /** 0-100 */
  progressRate: number;
  delayMinutes: number;
  status: string;
  plannedEndAt: string | null;
  lastLocationAt: string | null;
}

export interface DashboardOverview {
  /** 기준일 (YYYY-MM-DD) */
  date: string;
  /** 서버가 집계를 만든 시각 */
  generatedAt: string;
  pipeline: PipelineNode[];
  attention: AttentionItem[];
  today: TodayFigures;
  running: RunningTrip[];
}

// ---------------------------------------------------------------------
// 상태 → 표시 규칙
//
// 오더 상태는 15가지다. 색을 15개 만들면 아무 뜻도 전달되지 않는다.
// 상태를 **국면(phase)** 으로 접어서 네 가지 톤으로만 말한다.
//
//   planned  계획 단계 — 아직 움직이지 않았다        (중립)
//   active   실행 단계 — 지금 움직이고 있다          (옥색: 살아 있는 것)
//   done     끝난 것                                (조용한 성공)
//   problem  손을 대야 하는 것                       (호박 · 적색)
// ---------------------------------------------------------------------

export type StatusPhase = 'planned' | 'active' | 'done' | 'problem';

export const ORDER_STATUS_PHASE: Record<string, StatusPhase> = {
  DRAFT: 'planned',
  RECEIVED: 'planned',
  CONFIRMED: 'planned',
  PLANNED: 'planned',
  ALLOCATED: 'planned',
  DISPATCHED: 'planned',
  PICKED_UP: 'active',
  IN_TRANSIT: 'active',
  DELIVERED: 'done',
  CONFIRMED_POD: 'done',
  SETTLED: 'done',
  CANCELLED: 'problem',
  ON_HOLD: 'problem',
  RETURNED: 'problem',
  FAILED: 'problem',
};

export const TRIP_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성중',
  CONFIRMED: '편성확정',
  ALLOCATING: '배정중',
  ALLOCATED: '배정완료',
  DISPATCHED: '배차완료',
  EXECUTING: '운행중',
  COMPLETED: '운행완료',
  CLOSED: '마감',
  CANCELLED: '취소',
};

export const TRIP_STATUS_PHASE: Record<string, StatusPhase> = {
  DRAFT: 'planned',
  CONFIRMED: 'planned',
  ALLOCATING: 'planned',
  ALLOCATED: 'planned',
  DISPATCHED: 'planned',
  EXECUTING: 'active',
  COMPLETED: 'done',
  CLOSED: 'done',
  CANCELLED: 'problem',
};

export const EXECUTION_STATUS_LABEL: Record<string, string> = {
  READY: '출발대기',
  DEPARTED: '출발',
  IN_TRANSIT: '이동중',
  ARRIVED: '도착',
  UNLOADING: '하차중',
  COMPLETED: '완료',
  SUSPENDED: '중단',
  CANCELLED: '취소',
};

export const DISPATCH_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: '배차지정',
  NOTIFIED: '통보',
  ACCEPTED: '수락',
  REJECTED: '거절',
  CONFIRMED: '확정',
  STARTED: '운행시작',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

export const ALLOCATION_STATUS_LABEL: Record<string, string> = {
  REQUESTED: '수락대기',
  ACCEPTED: '수락',
  REJECTED: '거절',
  EXPIRED: '기한초과',
  CANCELLED: '취소',
  REASSIGNED: '재배정',
};
