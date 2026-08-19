/**
 * 배차판.
 *
 * 배차 담당자가 이 화면에서 실제로 하는 일은 네 가지다.
 *
 *   1. 오늘 편성된 트립이 어느 차에 붙어 있나 본다
 *   2. 아직 차가 없는 트립을 찾는다
 *   3. 차가 언제 비는지 본다
 *   4. 같은 차가 겹쳐 잡히지 않았는지 확인한다
 *
 * 네 가지 모두 **"차량 × 시간"** 축에서 답이 나온다. 그래서 배차판의 기본
 * 축은 차량이다. (거점 × 시간 축은 같은 데이터를 다른 축으로 본 것으로,
 * 환적·연계 지점을 찾을 때 쓴다)
 *
 * 막대 하나에 계획과 실행을 겹쳐 그린다 — 이 제품이 하겠다고 한 일이
 * "계획과 실행의 차이를 남기는 것" 이기 때문이다.
 *
 *   막대 전체 = 계획 구간 (planned_start ~ planned_end)
 *   채워진 부분 = 실제 진행분 (progress_rate)
 *   계획 끝을 넘어간 꼬리 = 지연 (delay_minutes)
 */

/** 트립이 들르는 곳 */
export interface BoardStop {
  stopType: string;
  locationName: string;
  plannedArrivalAt: string | null;
  /**
   * 위도. 거점축 다이어그램에서 세로 순서를 정하는 데 쓴다.
   * 거점을 등장 순서대로 늘어놓으면 선이 아무 뜻 없이 엇갈리기만 한다 —
   * 북에서 남으로 세워야 경부축의 흐름이 눈에 보인다.
   */
  latitude: number | null;
}

/** 배차 막대 하나 */
export interface BoardBar {
  dispatchId: string;
  dispatchNo: string;
  tripId: string;
  tripNo: string;
  driverName: string;
  carrierName: string;
  fromName: string;
  toName: string;
  plannedStartAt: string;
  plannedEndAt: string;
  actualStartAt: string | null;
  /** dispatch.status */
  status: string;
  /** transport_execution.status — 아직 출발 전이면 null */
  executionStatus: string | null;
  /** 0-100 */
  progressRate: number;
  delayMinutes: number;
  orderCount: number;
  weightKg: number;
  /** 같은 차량의 다른 배차와 시간이 겹친다 */
  hasConflict: boolean;
  stops: BoardStop[];
}

/** 배차판의 한 줄 = 차량 한 대 */
export interface BoardVehicle {
  vehicleId: string;
  vehicleNo: string;
  vehicleTypeName: string;
  tonClass: number | null;
  carrierName: string;
  /** vehicle.status */
  status: string;
  bars: BoardBar[];
}

/** 아직 차가 붙지 않은 트립 — 배차 담당자의 일감 */
export interface UnassignedTrip {
  tripId: string;
  tripNo: string;
  status: string;
  fromName: string;
  toName: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  orderCount: number;
  weightKg: number;
  requiredVehicleTypeName: string | null;
  requiredTon: number | null;
  /** 운송사 배정까지는 끝났는가. 아직이면 null */
  carrierName: string | null;
  /** 출발까지 남은 분. 음수면 이미 지났다 */
  minutesToStart: number | null;
  stops: BoardStop[];
}

export interface BoardSummary {
  vehicleCount: number;
  /** 오늘 한 번이라도 배차가 잡힌 차량 수 */
  usedVehicleCount: number;
  dispatchCount: number;
  unassignedCount: number;
  conflictCount: number;
  /** 차량 가동률 (%) — 배차가 잡힌 차량 / 전체 차량 */
  utilizationRate: number;
}

export interface DispatchBoard {
  date: string;
  /** 서버가 응답을 만든 시각. 화면의 "지금" 선이 여기에 맞춰진다 */
  now: string;
  /** 시간축 범위 */
  windowFrom: string;
  windowTo: string;
  vehicles: BoardVehicle[];
  unassigned: UnassignedTrip[];
  summary: BoardSummary;
}

/**
 * 막대 색이 말하는 것.
 *
 * 상태를 그대로 색으로 옮기지 않는다. 배차판에서 눈에 먼저 들어와야 하는
 * 것은 "이 차가 지금 어떤 상태인가" 가 아니라 **"손을 대야 하나"** 다.
 */
export type BarTone = 'planned' | 'running' | 'late' | 'done' | 'conflict';

export function barTone(bar: {
  hasConflict: boolean;
  delayMinutes: number;
  executionStatus: string | null;
  status: string;
}): BarTone {
  if (bar.hasConflict) return 'conflict';
  if (bar.delayMinutes > 0 && bar.executionStatus !== 'COMPLETED') return 'late';
  if (bar.executionStatus === 'COMPLETED' || bar.status === 'COMPLETED') return 'done';
  if (bar.executionStatus !== null) return 'running';
  return 'planned';
}
