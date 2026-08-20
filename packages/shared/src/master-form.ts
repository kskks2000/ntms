/**
 * 기준정보 등록 · 수정 스키마.
 *
 * 목록(master.ts)이 "지금 쓸 수 있는 상태인가" 를 답한다면, 여기는 그 상태를
 * **바꾸는** 쪽이다. API 의 ZodValidationPipe 와 화면의 zodResolver 가 이
 * 한 벌을 같이 쓴다 — 규칙이 두 곳에서 따로 굴러가면 화면은 통과시키고
 * 서버는 거절하는 상태가 만들어진다.
 *
 * 두 가지 원칙으로 썼다.
 *
 * 1. **빈 칸은 빈 문자열이 아니라 미입력이다.** HTML 폼은 지우면 `''` 을
 *    보내는데, 그대로 저장하면 "값이 없음" 과 "빈 값" 이 DB 에서 갈라진다.
 *    선택 항목은 모두 `optionalText` 를 거쳐 null 로 접는다.
 *
 * 2. **수정은 부분 수정이 아니라 전체 교체다.** 폼이 늘 모든 칸을 들고
 *    있으므로 PATCH 에도 같은 스키마를 쓴다. 필드마다 optional 을 붙인
 *    별도 스키마를 두면, 화면에서 지운 값이 서버에서는 "안 보낸 값" 과
 *    구별되지 않아 조용히 남는다.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 원시 필드
// ---------------------------------------------------------------------

/** 기준정보 코드. 사람이 외워서 부르는 값이라 공백과 소문자를 막는다 */
export const masterCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, '코드는 2자 이상입니다')
  .max(30, '코드는 30자 이하입니다')
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, '영문 대문자 · 숫자 · - _ 만 쓸 수 있습니다');

/** 이름 칸. 화면 표에 그대로 실리므로 길이를 막아 둔다 */
const nameSchema = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label}을(를) 입력하세요`)
    .max(max, `${label}은(는) ${max}자 이하입니다`);

/**
 * 비워 둘 수 있는 글자 칸.
 *
 * `''` 과 공백만 있는 값을 null 로 접는다. 화면에서 지운 것과 처음부터
 * 넣지 않은 것이 DB 에서 같은 상태가 되어야 한다.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력하세요`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

/** 비워 둘 수 있는 숫자 칸. 빈 문자열은 null 로 접는다 */
const optionalNumber = (opts: { min?: number; max?: number; int?: boolean } = {}) =>
  z
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
    .refine((v) => v === null || !opts.int || Number.isInteger(v), '정수를 입력하세요')
    // 양쪽 한계가 다 있으면 범위로 말한다. "31 이하여야 합니다" 만 보여
    // 주면 1 도 되는지 0 도 되는지 다시 시험해 봐야 한다.
    .refine(
      (v) => v === null || opts.min === undefined || v >= opts.min,
      opts.max === undefined
        ? `${opts.min} 이상이어야 합니다`
        : `${opts.min}~${opts.max} 사이여야 합니다`,
    )
    .refine(
      (v) => v === null || opts.max === undefined || v <= opts.max,
      opts.min === undefined
        ? `${opts.max} 이하여야 합니다`
        : `${opts.min}~${opts.max} 사이여야 합니다`,
    )
    .default(null);

/** 반드시 있어야 하는 숫자 칸 */
const requiredNumber = (label: string, opts: { min?: number; max?: number } = {}) =>
  optionalNumber(opts).refine((v): v is number => v !== null, `${label}을(를) 입력하세요`);

/** `YYYY-MM-DD`. `<input type="date">` 가 내는 형식 그대로다 */
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');

const optionalDate = z
  .union([dateSchema, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v === '' || v === undefined ? null : v))
  .default(null);

/** `HH:MM`. `<input type="time">` 가 내는 형식 그대로다 */
const optionalClock = z
  .union([
    z.string().regex(/^\d{2}:\d{2}$/, '시각 형식이 올바르지 않습니다'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (v === '' || v === undefined ? null : v))
  .default(null);

/** 참조 키. 화면은 문자열로 다루고 서버에서 BigInt 로 바꾼다 */
const optionalRef = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim()))
  .default(null);

const requiredRef = (label: string) =>
  optionalRef.refine((v): v is string => v !== null, `${label}을(를) 고르세요`);

const boolField = z.coerce.boolean().default(false);

/** 사업자등록번호. 하이픈을 떼고 10자리만 남긴다 */
const businessNoSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const d = v.replace(/\D/g, '');
    return d === '' ? null : d;
  })
  .refine((v) => v === null || v.length === 10, '사업자등록번호는 10자리입니다')
  .default(null);

// ---------------------------------------------------------------------
// 거래처 (화주 · 운송사 · 수하처 · 매입처)
// ---------------------------------------------------------------------

export const PARTNER_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
export const SETTLEMENT_CYCLES = ['MONTHLY', 'SEMIMONTHLY', 'WEEKLY'] as const;

export const SETTLEMENT_CYCLE_LABEL: Record<string, string> = {
  MONTHLY: '월정산',
  SEMIMONTHLY: '반월정산',
  WEEKLY: '주정산',
};

export const partnerFormSchema = z
  .object({
    partnerCode: masterCodeSchema,
    // 오류 문구에 이름을 박지 않는다 — 이 칸의 라벨은 화면마다 다르다
    // (화주명 · 운송사명 · 거래처명). 라벨 바로 아래 붙는 글이라 되풀이할
    // 이유도 없다.
    partnerName: nameSchema(200, '이름'),
    // 한 회사가 화주이면서 수하처일 수 있다. 그래서 단일 선택이 아니다.
    isShipper: boolField,
    isCarrier: boolField,
    isConsignee: boolField,
    isVendor: boolField,
    businessNo: businessNoSchema,
    ceoName: optionalText(60),
    grade: z.enum(PARTNER_GRADES).nullable().default(null),
    tel: optionalText(30),
    email: optionalText(200),
    address1: optionalText(300),
    managerName: optionalText(60),
    managerTel: optionalText(30),
    settlementCycle: z.enum(SETTLEMENT_CYCLES).default('MONTHLY'),
    closingDay: optionalNumber({ min: 1, max: 31, int: true }),
    paymentTermsDays: optionalNumber({ min: 0, max: 365, int: true }),
    creditLimit: optionalNumber({ min: 0 }),
    remark: optionalText(500),
    isActive: z.coerce.boolean().default(true),
  })
  // ck_partner_role — 역할이 하나도 없는 거래처는 어느 목록에도 뜨지 않는다
  .refine((v) => v.isShipper || v.isCarrier || v.isConsignee || v.isVendor, {
    message: '역할을 하나 이상 고르세요',
    path: ['isShipper'],
  });

export type PartnerFormInput = z.input<typeof partnerFormSchema>;
export type PartnerFormValues = z.output<typeof partnerFormSchema>;

// ---------------------------------------------------------------------
// 차량
// ---------------------------------------------------------------------

export const VEHICLE_STATUSES = [
  'AVAILABLE',
  'IN_USE',
  'MAINTENANCE',
  'IDLE',
  'DISPOSED',
] as const;
export const OWNERSHIP_TYPES = ['OWNED', 'CONSIGNED', 'CONTRACTED', 'SPOT'] as const;

export const vehicleFormSchema = z.object({
  // 차량번호는 사람이 읽고 부르는 값이라 공백만 정리하고 형식은 막지 않는다.
  // 영업용 · 자가용 · 임시번호가 섞이고 지역명 표기도 제각각이다.
  vehicleNo: nameSchema(20, '차량번호'),
  vehicleTypeId: requiredRef('차종'),
  ownershipType: z.enum(OWNERSHIP_TYPES).default('OWNED'),
  carrierId: optionalRef,
  defaultDriverId: optionalRef,
  baseLocationId: optionalRef,
  status: z.enum(VEHICLE_STATUSES).default('AVAILABLE'),
  insuranceCompany: optionalText(100),
  insurancePolicyNo: optionalText(60),
  insuranceExpireDate: optionalDate,
  inspectionDate: optionalDate,
  nextInspectionDate: optionalDate,
  odometerKm: optionalNumber({ min: 0 }),
  remark: optionalText(500),
  isActive: z.coerce.boolean().default(true),
});

export type VehicleFormInput = z.input<typeof vehicleFormSchema>;
export type VehicleFormValues = z.output<typeof vehicleFormSchema>;

// ---------------------------------------------------------------------
// 기사
// ---------------------------------------------------------------------

export const DRIVER_STATUSES = ['ACTIVE', 'LEAVE', 'SUSPENDED', 'RESIGNED'] as const;

export const driverFormSchema = z.object({
  driverCode: masterCodeSchema,
  driverName: nameSchema(60, '성명'),
  carrierId: optionalRef,
  mobile: optionalText(30),
  licenseNo: optionalText(40),
  licenseType: optionalText(40),
  licenseExpireDate: optionalDate,
  cargoQualificationNo: optionalText(40),
  cargoQualificationExpireDate: optionalDate,
  hireDate: optionalDate,
  status: z.enum(DRIVER_STATUSES).default('ACTIVE'),
  remark: optionalText(500),
  isActive: z.coerce.boolean().default(true),
});

export type DriverFormInput = z.input<typeof driverFormSchema>;
export type DriverFormValues = z.output<typeof driverFormSchema>;

// ---------------------------------------------------------------------
// 상하차지
// ---------------------------------------------------------------------

export const LOCATION_TYPES = [
  'WAREHOUSE',
  'PLANT',
  'DC',
  'HUB',
  'STORE',
  'CUSTOMER',
  'PORT',
  'AIRPORT',
  'RAIL_TERMINAL',
  'PARKING',
  'ETC',
] as const;

export const locationFormSchema = z
  .object({
    locationCode: masterCodeSchema,
    locationName: nameSchema(200, '거점명'),
    locationType: z.enum(LOCATION_TYPES).default('WAREHOUSE'),
    zoneId: optionalRef,
    partnerId: optionalRef,
    address1: z.string().trim().min(1, '주소를 입력하세요').max(300, '주소는 300자 이하입니다'),
    address2: optionalText(300),
    latitude: optionalNumber({ min: -90, max: 90 }),
    longitude: optionalNumber({ min: -180, max: 180 }),
    geoVerified: boolField,
    tel: optionalText(30),
    managerName: optionalText(60),
    openTime: optionalClock,
    closeTime: optionalClock,
    standardLoadMin: optionalNumber({ min: 0, max: 1440, int: true }),
    standardUnloadMin: optionalNumber({ min: 0, max: 1440, int: true }),
    dockCount: optionalNumber({ min: 0, max: 999, int: true }),
    hasForklift: boolField,
    requireReservation: boolField,
    isPickupAvailable: z.coerce.boolean().default(true),
    isDeliveryAvailable: z.coerce.boolean().default(true),
    remark: optionalText(500),
    isActive: z.coerce.boolean().default(true),
  })
  // 좌표는 둘 다 있거나 둘 다 없어야 한다. 하나만 있으면 거리 계산이 조용히 틀어진다
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: '위도와 경도는 함께 입력하세요',
    path: ['longitude'],
  });

export type LocationFormInput = z.input<typeof locationFormSchema>;
export type LocationFormValues = z.output<typeof locationFormSchema>;

// ---------------------------------------------------------------------
// 권역
// ---------------------------------------------------------------------

export const zoneFormSchema = z.object({
  zoneCode: masterCodeSchema,
  zoneName: nameSchema(100, '권역명'),
  centerLatitude: optionalNumber({ min: -90, max: 90 }),
  centerLongitude: optionalNumber({ min: -180, max: 180 }),
  sortOrder: optionalNumber({ min: 0, max: 9999, int: true }),
  isActive: z.coerce.boolean().default(true),
});

export type ZoneFormInput = z.input<typeof zoneFormSchema>;
export type ZoneFormValues = z.output<typeof zoneFormSchema>;

// ---------------------------------------------------------------------
// 라우트 (구간거리)
// ---------------------------------------------------------------------

export const ROUTE_SOURCES = ['MANUAL', 'MAP_API', 'ACTUAL'] as const;

export const ROUTE_SOURCE_LABEL: Record<string, string> = {
  MANUAL: '수기 입력',
  MAP_API: '지도 API',
  ACTUAL: '실적 반영',
};

export const routeFormSchema = z
  .object({
    fromLocationId: requiredRef('출발지'),
    toLocationId: requiredRef('도착지'),
    distanceKm: requiredNumber('거리', { min: 0, max: 100_000 }),
    durationMinutes: optionalNumber({ min: 0, max: 100_000, int: true }),
    tollFee: optionalNumber({ min: 0 }),
    source: z.enum(ROUTE_SOURCES).default('MANUAL'),
    isActive: z.coerce.boolean().default(true),
  })
  // ck_distance_not_same — 같은 거점끼리는 구간이 성립하지 않는다
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: '출발지와 도착지가 같습니다',
    path: ['toLocationId'],
  });

export type RouteFormInput = z.input<typeof routeFormSchema>;
export type RouteFormValues = z.output<typeof routeFormSchema>;

// ---------------------------------------------------------------------
// 단가 (운임표)
// ---------------------------------------------------------------------

export const RATE_TARGETS = ['BILLING', 'PAYMENT'] as const;
export const RATE_METHODS = [
  'DISTANCE',
  'ZONE',
  'PER_TRIP',
  'PER_STOP',
  'WEIGHT',
  'VOLUME',
  'PALLET',
  'QTY',
  'TON_KM',
  'PERCENT',
  'FIXED',
] as const;
export const APPROVAL_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export const tariffFormSchema = z
  .object({
    rateTableCode: masterCodeSchema,
    rateTableName: nameSchema(200, '운임표명'),
    rateTarget: z.enum(RATE_TARGETS).default('BILLING'),
    rateMethod: z.enum(RATE_METHODS).default('DISTANCE'),
    partnerId: optionalRef,
    applyStartDate: dateSchema,
    applyEndDate: optionalDate,
    minChargeAmount: optionalNumber({ min: 0 }),
    applyFuelSurcharge: boolField,
    isTaxable: z.coerce.boolean().default(true),
    status: z.enum(APPROVAL_STATUSES).default('DRAFT'),
    description: optionalText(500),
    isActive: z.coerce.boolean().default(true),
  })
  // ck_rate_period — 끝나는 날이 시작하는 날보다 앞설 수 없다
  .refine((v) => v.applyEndDate === null || v.applyEndDate >= v.applyStartDate, {
    message: '종료일이 시작일보다 앞섭니다',
    path: ['applyEndDate'],
  });

export type TariffFormInput = z.input<typeof tariffFormSchema>;
export type TariffFormValues = z.output<typeof tariffFormSchema>;

// ---------------------------------------------------------------------
// 상세 조회 응답
// ---------------------------------------------------------------------

/**
 * 수정 폼이 받는 값.
 *
 * 폼 스키마의 출력과 같은 모양이어야 `reset(detail)` 한 줄로 채워진다.
 * 목록 항목(PartnerListItem 등)을 재활용하지 않는 이유는, 목록에는 표에
 * 실을 것만 담겨 있어 비고 · 주소 같은 칸이 비기 때문이다.
 */
export type MasterDetail<T> = T & { id: string };

export type PartnerDetail = MasterDetail<PartnerFormValues>;
export type VehicleDetail = MasterDetail<VehicleFormValues>;
export type DriverDetail = MasterDetail<DriverFormValues>;
export type LocationDetail = MasterDetail<LocationFormValues>;
export type ZoneDetail = MasterDetail<ZoneFormValues>;
export type RouteDetail = MasterDetail<RouteFormValues>;
export type TariffDetail = MasterDetail<TariffFormValues>;

// ---------------------------------------------------------------------
// 선택 목록
// ---------------------------------------------------------------------

/** `<select>` 한 줄. 코드를 함께 보여야 같은 이름을 구별할 수 있다 */
export interface RefOption {
  id: string;
  code: string;
  name: string;
  /** 목록을 좁히는 데 쓰는 꼬리표 (거점의 권역, 기사의 운송사 …) */
  group?: string | null;
}

/**
 * 폼이 필요로 하는 참조 목록을 한 번에 받는다.
 *
 * 차량 폼 하나가 차종 · 운송사 · 기사 · 거점 네 목록을 쓴다. 목록마다
 * 따로 부르면 서랍을 열 때 요청이 네 번 나가고, 그 중 하나가 늦으면
 * 빈 선택 상자가 잠깐 보인다.
 */
export interface MasterOptions {
  vehicleTypes: RefOption[];
  carriers: RefOption[];
  shippers: RefOption[];
  partners: RefOption[];
  drivers: RefOption[];
  locations: RefOption[];
  zones: RefOption[];
}
