/**
 * 기준정보.
 *
 * 기준정보 화면은 주소록이 아니다. 배차 담당자가 이 화면을 여는 이유는
 * "누가 있나" 가 아니라 **"지금 이걸 써도 되나"** 를 확인하기 위해서다.
 * 보험이 끝난 차, 면허가 만료된 기사, 적용기간이 지난 운임표를 모른 채
 * 쓰는 것이 기준정보에서 나는 가장 흔한 사고다.
 *
 * 그래서 목록마다 **유효기간**과 **연결된 것의 수**를 함께 낸다.
 *   유효기간  이 기록을 지금 써도 되는가
 *   연결 수   이 기록을 지우거나 바꾸면 무엇이 흔들리는가
 */

/** 만료가 있는 항목이 공통으로 쓰는 형태 */
export interface Validity {
  /** ISO date (YYYY-MM-DD). 없으면 만료 개념이 없는 항목 */
  until: string | null;
  /** 남은 일수. 음수면 이미 지났다 */
  daysLeft: number | null;
}

export type ValidityLevel = 'none' | 'ok' | 'soon' | 'expired';

/** 남은 기간을 네 단계로 접는다. 색과 문구를 여기 하나로 맞춘다 */
export function validityLevel(v: Validity | null | undefined): ValidityLevel {
  if (!v || v.daysLeft === null) return 'none';
  if (v.daysLeft < 0) return 'expired';
  if (v.daysLeft <= 60) return 'soon';
  return 'ok';
}

// ---------------------------------------------------------------------
// 거래처 — 화주 · 운송사 · 수하처가 모두 business_partner 한 테이블이다.
// 한 회사가 화주이면서 운송사일 수 있어 역할을 배열로 낸다.
// ---------------------------------------------------------------------

export type PartnerRole = 'SHIPPER' | 'CARRIER' | 'CONSIGNEE' | 'VENDOR';

export const PARTNER_ROLE_LABEL: Record<PartnerRole, string> = {
  SHIPPER: '화주',
  CARRIER: '운송사',
  CONSIGNEE: '수하처',
  VENDOR: '매입처',
};

export interface PartnerListItem {
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  roles: PartnerRole[];
  businessNo: string | null;
  grade: string | null;
  ceoName: string | null;
  tel: string | null;
  managerName: string | null;
  managerTel: string | null;
  /** 정산 주기 · 마감일 · 지급조건 — 화주/운송사 화면에서만 의미가 있다 */
  settlementCycle: string | null;
  closingDay: number | null;
  paymentTermsDays: number | null;
  creditLimit: number | null;
  isActive: boolean;

  /** 화주 화면 : 이번 달 오더 */
  orderCount?: number;
  orderWeightKg?: number;
  /** 운송사 화면 : 보유 자원과 응답 */
  vehicleCount?: number;
  driverCount?: number;
  /** 배정 요청 대비 수락 비율 (%). 요청 이력이 없으면 null */
  acceptRate?: number | null;
}

// ---------------------------------------------------------------------
// 차량
// ---------------------------------------------------------------------

export const VEHICLE_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '가용',
  IN_USE: '운행중',
  MAINTENANCE: '정비중',
  IDLE: '유휴',
  DISPOSED: '말소',
};

export const OWNERSHIP_LABEL: Record<string, string> = {
  OWNED: '자차',
  CONSIGNED: '지입',
  CONTRACTED: '계약',
  SPOT: '스팟',
};

export interface VehicleListItem {
  vehicleId: string;
  vehicleNo: string;
  vehicleTypeName: string;
  bodyType: string;
  tonClass: number | null;
  maxWeightKg: number | null;
  maxPalletQty: number | null;
  ownershipType: string;
  carrierName: string | null;
  defaultDriverName: string | null;
  baseLocationName: string | null;
  status: string;
  odometerKm: number | null;
  /** 배차를 막는 두 가지 */
  insurance: Validity;
  inspection: Validity;
  isActive: boolean;
}

// ---------------------------------------------------------------------
// 기사
// ---------------------------------------------------------------------

export const DRIVER_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '재직',
  LEAVE: '휴직',
  SUSPENDED: '정지',
  RESIGNED: '퇴사',
};

export interface DriverListItem {
  driverId: string;
  driverCode: string;
  driverName: string;
  carrierName: string | null;
  mobile: string | null;
  licenseType: string | null;
  license: Validity;
  /** 화물운송 종사자격 */
  cargoQualification: Validity;
  hireDate: string | null;
  onTimeRate: number | null;
  evaluationScore: number | null;
  accidentCount: number;
  status: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------
// 상하차지 · 권역
// ---------------------------------------------------------------------

export const LOCATION_TYPE_LABEL: Record<string, string> = {
  WAREHOUSE: '창고',
  PLANT: '공장',
  DC: '물류센터',
  HUB: '허브',
  STORE: '점포',
  CUSTOMER: '고객처',
  PORT: '항만',
  AIRPORT: '공항',
  RAIL_TERMINAL: '철도역',
  PARKING: '차고지',
  ETC: '기타',
};

export interface LocationListItem {
  locationId: string;
  locationCode: string;
  locationName: string;
  locationType: string;
  zoneName: string | null;
  address: string;
  /** HH:mm */
  openTime: string | null;
  closeTime: string | null;
  dockCount: number | null;
  standardLoadMin: number | null;
  standardUnloadMin: number | null;
  hasForklift: boolean;
  requireReservation: boolean;
  geoVerified: boolean;
  /** 이 거점을 드나드는 오더 수 (상차 + 하차) */
  orderCount: number;
  isActive: boolean;
}

export interface ZoneSummary {
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  locationCount: number;
}

// ---------------------------------------------------------------------
// 라우트 (구간거리)
// ---------------------------------------------------------------------

export interface RouteListItem {
  distanceId: string;
  fromName: string;
  toName: string;
  routeType: string | null;
  distanceKm: number;
  durationMinutes: number | null;
  tollFee: number | null;
  /** 거리 ÷ 시간. 값이 튀면 데이터가 틀렸다는 신호다 */
  avgSpeedKmh: number | null;
  source: string | null;
  lastVerifiedAt: string | null;
  /** 반대 방향 구간이 등록돼 있는가 */
  hasReverse: boolean;
  isActive: boolean;
}

// ---------------------------------------------------------------------
// 단가 (운임표)
// ---------------------------------------------------------------------

export const RATE_TARGET_LABEL: Record<string, string> = {
  BILLING: '매출(청구)',
  PAYMENT: '매입(지급)',
};

export const RATE_METHOD_LABEL: Record<string, string> = {
  FIXED: '고정',
  DISTANCE: '거리',
  ZONE: '권역',
  WEIGHT: '중량',
  VOLUME: '부피',
  PALLET: '파렛트',
  QTY: '수량',
  TON_KM: '톤·km',
  PER_STOP: '정차당',
  PER_TRIP: '트립당',
  PERCENT: '비율',
};

export const APPROVAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성중',
  REQUESTED: '상신',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};

export interface TariffListItem {
  rateTableId: string;
  rateTableCode: string;
  rateTableName: string;
  rateTarget: string;
  rateMethod: string;
  partnerName: string | null;
  applyStartDate: string;
  /** 적용기간. 종료일이 없으면 무기한 */
  apply: Validity;
  minChargeAmount: number | null;
  applyFuelSurcharge: boolean;
  isTaxable: boolean;
  status: string;
  versionNo: number;
  /** 등록된 요율 상세 건수 */
  detailCount: number;
  isActive: boolean;
}

/** 목록 응답 공통 — 조건 전체를 더한 합계를 함께 낸다 */
export interface MasterListMeta {
  total: number;
  activeCount: number;
  /** 화면마다 뜻이 다른 보조 지표 (만료 임박 건수 등) */
  attentionCount: number;
  attentionLabel: string;
}
