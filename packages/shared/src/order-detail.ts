/**
 * 오더 등록 · 상세.
 *
 * 목록(order.ts)이 "어떤 오더들이 있나" 를 답한다면, 여기는 **한 건이
 * 성립하는가** 를 다룬다. 그 차이가 화면 설계를 가른다.
 *
 * ## 오더는 칸의 모음이 아니라 하나의 물리적 약속이다
 *
 * 상차 마감 14:00 · 하차 시작 15:00 · 구간 5시간 20분 — 이 세 값은 따로
 * 보면 전부 정상이지만 함께 놓으면 성립하지 않는다. 칸을 하나씩 검사하는
 * 방식으로는 절대 잡히지 않고, 편성 엔진이 튕겨낼 때에야 드러난다.
 *
 * 그래서 이 파일은 값의 형식뿐 아니라 **값들 사이의 관계**를 계산하는
 * 함수를 함께 둔다. 화면과 서버가 같은 판정을 쓰게 하려는 것이다.
 */
import { z } from 'zod';
import type { OrderStatus, TemperatureZone } from './enums.js';

// ---------------------------------------------------------------------
// 라벨
// ---------------------------------------------------------------------

export const ORDER_TYPE_FORM_LABEL: Record<string, string> = {
  DELIVERY: '배송',
  PICKUP: '집화',
  RETURN: '반품',
  TRANSFER: '이고',
  MILKRUN: '순회집화',
  CROSSDOCK: '크로스독',
};

export const TEMPERATURE_ZONE_LABEL: Record<string, string> = {
  AMBIENT: '상온',
  CHILLED: '냉장',
  FROZEN: '냉동',
  DEEP_FROZEN: '초저온',
};

export const FREIGHT_TERMS_LABEL: Record<string, string> = {
  PREPAID: '선불',
  COLLECT: '착불',
  CREDIT: '외상(월정산)',
  THIRD_PARTY: '제3자 부담',
};

export const ORDER_PRIORITY_LABEL: Record<string, string> = {
  LOW: '낮음',
  NORMAL: '보통',
  HIGH: '높음',
  URGENT: '긴급',
};

export const BODY_TYPE_LABEL: Record<string, string> = {
  CARGO: '카고',
  WING: '윙바디',
  REEFER: '냉동·냉장',
  TRAILER: '트레일러',
  TANK: '탱크',
  DUMP: '덤프',
  CONTAINER: '컨테이너',
  TOP: '탑차',
  ETC: '기타',
};

/** 상태가 바뀐 경위. 사람이 한 것과 시스템이 한 것을 갈라 둔다 */
export const CHANGE_SOURCE_LABEL: Record<string, string> = {
  MANUAL: '수기',
  SYSTEM: '시스템',
  INTERFACE: '연계',
  BATCH: '배치',
};

// ---------------------------------------------------------------------
// 시간 축 — 이 화면의 핵심 계산
// ---------------------------------------------------------------------

/** `HH:MM` → 자정부터의 분 */
export function clockToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/** 자정부터의 분 → `HH:MM` */
export function minutesToClock(min: number): string {
  const d = Math.floor(min / 1440);
  const rest = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}${d > 0 ? ` +${d}` : ''}`;
}

/** `YYYY-MM-DD` 두 개 사이의 일수 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface TimeSpineInput {
  pickupDate: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  deliveryDate: string | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
  /** 라우트 마스터가 아는 구간 소요시간(분). 없으면 판정하지 않는다 */
  transitMinutes: number | null;
}

export type SpineVerdict =
  /** 아직 판정할 값이 모자람 */
  | { kind: 'incomplete'; message: string }
  /** 구간 소요시간을 몰라 판정 불가 */
  | { kind: 'unknown'; message: string }
  /** 상차창 어디에서 출발해도 하차창 안에 도착한다 */
  | {
      kind: 'fits';
      slackMinutes: number;
      earliestArrival: number;
      latestArrival: number;
      /** 하차창이 열리기 전에 도착하면 그만큼 기다린다 */
      waitMinutes: number;
      message: string;
    }
  /** 되기는 하는데, 늦게 상차하면 못 맞춘다 */
  | {
      kind: 'tight';
      /** 이 시각까지는 상차해야 한다 (자정부터의 분) */
      latestPickup: number;
      earliestArrival: number;
      latestArrival: number;
      waitMinutes: number;
      message: string;
    }
  /** 어떤 조합으로도 불가능하다 */
  | {
      kind: 'short';
      shortMinutes: number;
      earliestArrival: number;
      latestArrival: number;
      message: string;
    };

/**
 * 이 오더가 시간상 성립하는가.
 *
 * ## 무엇과 무엇을 비교하는가
 *
 * 상차창 [08:50~10:50] 과 하차창 [12:24~15:24] 이 있고 구간이 3시간 34분이라
 * 하자. 흔히 저지르는 실수는 **상차 마감(10:50)과 하차 시작(12:24)** 을
 * 비교하는 것이다. 그러면 "하차창이 열리기 전에 도착하라" 는 말이 되어,
 * 멀쩡히 성립하는 오더가 불가능으로 찍힌다.
 *
 * 실제로 필요한 것은 **하차 마감 전에 도착할 수 있는가** 다.
 *
 *   가장 이른 도착 = 상차창 시작 + 소요시간
 *   가장 늦은 도착 = 상차창 마감 + 소요시간
 *
 * 이 둘을 하차 마감과 견주면 세 가지 답이 나온다.
 *
 *   가장 늦게 상차해도 하차 마감 전  →  창 전체에서 된다 (fits)
 *   일찍 상차하면 되지만 늦으면 못 맞춤 →  상차 마감을 당겨야 한다 (tight)
 *   가장 일찍 상차해도 못 맞춤        →  오더 자체가 성립하지 않는다 (short)
 *
 * 가운데(tight)를 따로 두는 이유는, 그게 배차 담당자에게 가장 쓸모 있는
 * 답이기 때문이다 — "안 됩니다" 가 아니라 "11시 50분까지는 상차하세요".
 */
export function evaluateSpine(v: TimeSpineInput): SpineVerdict {
  const pickFrom = clockToMinutes(v.pickupFrom) ?? clockToMinutes(v.pickupTo);
  const pickTo = clockToMinutes(v.pickupTo) ?? pickFrom;
  const dropFrom = clockToMinutes(v.deliveryFrom) ?? clockToMinutes(v.deliveryTo);
  const dropToRaw = clockToMinutes(v.deliveryTo) ?? dropFrom;

  if (!v.pickupDate || pickFrom === null || pickTo === null) {
    return { kind: 'incomplete', message: '상차 일시를 넣으면 가능 여부를 계산합니다' };
  }
  if (!v.deliveryDate || dropFrom === null || dropToRaw === null) {
    return { kind: 'incomplete', message: '하차 일시를 넣으면 가능 여부를 계산합니다' };
  }
  if (v.transitMinutes === null) {
    return {
      kind: 'unknown',
      message: '이 구간의 소요시간이 라우트에 없어 계산할 수 없습니다',
    };
  }

  // 날짜가 다르면 하차 시각에 그 일수를 더해 한 축 위에 올린다
  const dayGap = daysBetween(v.pickupDate, v.deliveryDate) * 1440;
  const dropOpen = dayGap + dropFrom;
  const dropClose = dayGap + dropToRaw;

  const earliestArrival = pickFrom + v.transitMinutes;
  const latestArrival = pickTo + v.transitMinutes;

  // 하차창이 열리기 전에 도착하면 기다린다. 오류는 아니지만 알아야 할 값이다.
  const waitMinutes = Math.max(0, dropOpen - earliestArrival);

  if (earliestArrival > dropClose) {
    return {
      kind: 'short',
      shortMinutes: earliestArrival - dropClose,
      earliestArrival,
      latestArrival,
      message: `${formatDuration(earliestArrival - dropClose)} 모자랍니다`,
    };
  }

  if (latestArrival > dropClose) {
    const latestPickup = dropClose - v.transitMinutes;
    return {
      kind: 'tight',
      latestPickup,
      earliestArrival,
      latestArrival,
      waitMinutes,
      message: `${minutesToClock(latestPickup)}까지 상차해야 합니다`,
    };
  }

  const slack = dropClose - latestArrival;
  return {
    kind: 'fits',
    slackMinutes: slack,
    earliestArrival,
    latestArrival,
    waitMinutes,
    message: slack === 0 ? '딱 맞습니다' : `${formatDuration(slack)} 여유`,
  };
}

export function formatDuration(min: number): string {
  const abs = Math.abs(Math.round(min));
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}일`);
  if (h > 0) parts.push(`${h}시간`);
  if (m > 0 || parts.length === 0) parts.push(`${m}분`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------
// 적재 판정
// ---------------------------------------------------------------------

/** 차종이 실을 수 있는 한계. 적재 판정이 이 값으로 답한다 */
export interface VehicleCapacity {
  id: string;
  code: string;
  name: string;
  bodyType: string;
  tonClass: number | null;
  maxWeightKg: number | null;
  maxVolumeCbm: number | null;
  maxPalletQty: number | null;
  temperatureZone: string | null;
}

export interface LoadInput {
  weightKg: number;
  volumeCbm: number;
  palletQty: number;
  temperatureZone: string;
}

export type LoadFitReason = 'weight' | 'volume' | 'pallet' | 'temperature';

export interface LoadFit {
  type: VehicleCapacity;
  fits: boolean;
  /** 못 싣는 이유. 여러 개일 수 있다 */
  reasons: LoadFitReason[];
  /** 가장 빡빡한 항목의 사용률(0~1+). 막대 길이가 된다 */
  utilization: number;
}

const REASON_LABEL: Record<LoadFitReason, string> = {
  weight: '중량',
  volume: '부피',
  pallet: '파렛트',
  temperature: '온도대',
};

export function loadFitLabel(reasons: LoadFitReason[]): string {
  return reasons.map((r) => REASON_LABEL[r]).join(' · ') + ' 초과';
}

/** 온도대는 위계가 있다. 냉동차는 상온 화물을 실을 수 있지만 그 반대는 안 된다 */
const TEMP_RANK: Record<string, number> = {
  AMBIENT: 0,
  CHILLED: 1,
  FROZEN: 2,
  DEEP_FROZEN: 3,
};

/**
 * 이 짐을 어느 차종이 실을 수 있나.
 *
 * 화면에서 이걸 보여주는 이유는 **요구 차종을 잘못 고르는 사고**를 막기
 * 위해서다. 12톤을 실으면서 요구 차종을 5톤으로 걸어 두면 편성이 후보를
 * 못 찾고, 그 사실은 며칠 뒤 배차가 안 될 때에야 드러난다.
 */
export function fitLoad(load: LoadInput, types: VehicleCapacity[]): LoadFit[] {
  return types
    .map((type) => {
      const reasons: LoadFitReason[] = [];
      const ratios: number[] = [];

      if (type.maxWeightKg !== null && type.maxWeightKg > 0) {
        ratios.push(load.weightKg / type.maxWeightKg);
        if (load.weightKg > type.maxWeightKg) reasons.push('weight');
      }
      if (type.maxVolumeCbm !== null && type.maxVolumeCbm > 0 && load.volumeCbm > 0) {
        ratios.push(load.volumeCbm / type.maxVolumeCbm);
        if (load.volumeCbm > type.maxVolumeCbm) reasons.push('volume');
      }
      if (type.maxPalletQty !== null && type.maxPalletQty > 0 && load.palletQty > 0) {
        ratios.push(load.palletQty / type.maxPalletQty);
        if (load.palletQty > type.maxPalletQty) reasons.push('pallet');
      }

      // 상온차에 냉동 화물을 실을 수는 없다
      const need = TEMP_RANK[load.temperatureZone] ?? 0;
      const can = TEMP_RANK[type.temperatureZone ?? 'AMBIENT'] ?? 0;
      if (need > can) reasons.push('temperature');

      return {
        type,
        fits: reasons.length === 0,
        reasons,
        utilization: ratios.length > 0 ? Math.max(...ratios) : 0,
      };
    })
    // 실을 수 있는 것 중에서는 가장 알뜰한(사용률 높은) 차가 위로 온다 —
    // 25톤에 1톤을 싣는 것은 되지만 좋은 답이 아니다.
    .sort((a, b) => {
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      return a.fits ? b.utilization - a.utilization : a.utilization - b.utilization;
    });
}

// ---------------------------------------------------------------------
// 상세 응답
// ---------------------------------------------------------------------

export interface OrderItemRow {
  lineNo: number;
  itemName: string;
  itemCode: string | null;
  qty: number;
  uomCode: string | null;
  weightKg: number;
  volumeCbm: number;
  palletQty: number | null;
  remark: string | null;
}

export interface OrderStatusEvent {
  seqNo: number;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  changeSource: string | null;
  reason: string | null;
}

export interface OrderTripLink {
  tripId: string;
  tripNo: string;
  status: string;
  plannedStart: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  carrierName: string | null;
}

/** 오더 상세 — 등록 폼이 되읽는 값과 화면이 읽는 값을 함께 담는다 */
export interface OrderDetail {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  orderType: string;
  orderDate: string;
  externalOrderNo: string | null;

  shipperId: string;
  shipperName: string;
  consigneeId: string | null;
  consigneeName: string | null;

  fromLocationId: string | null;
  fromLocationName: string;
  fromAddress1: string;
  fromAddress2: string | null;
  fromContactName: string | null;
  fromContactTel: string | null;

  toLocationId: string | null;
  toLocationName: string;
  toAddress1: string;
  toAddress2: string | null;
  toContactName: string | null;
  toContactTel: string | null;

  pickupDate: string | null;
  pickupTimeFrom: string | null;
  pickupTimeTo: string | null;
  deliveryDate: string | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  isTimeCritical: boolean;

  totalWeightKg: number;
  totalVolumeCbm: number;
  totalPalletQty: number;
  totalQty: number;

  requiredVehicleTypeId: string | null;
  requiredVehicleTypeName: string | null;
  temperatureZone: TemperatureZone;
  isHazardous: boolean;
  isExclusive: boolean;

  freightTerms: string;
  priority: string;
  distanceKm: number | null;
  estimatedAmount: number | null;
  /** 라우트 마스터가 아는 구간 소요시간(분) */
  transitMinutes: number | null;

  referenceNo1: string | null;
  specialInstruction: string | null;
  remark: string | null;

  items: OrderItemRow[];
  history: OrderStatusEvent[];
  trips: OrderTripLink[];

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------
// 폼 스키마
//
// order.ts 의 createOrderSchema 는 API 가 이미 쓰고 있는 계약이다. 그런데
// 그 스키마는 숫자를 number 로 받는다 — HTML 폼은 전부 문자열을 보내므로
// 화면에서 그대로 쓸 수 없다. 그래서 화면용 스키마를 따로 두고, 서버가
// 받는 모양으로 바꾸는 변환을 여기서 한 번만 정의한다.
// ---------------------------------------------------------------------

const num = (opts: { min?: number; required?: string } = {}) =>
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
    .refine(
      (v) => v === null || opts.min === undefined || v >= opts.min,
      `${opts.min} 이상이어야 합니다`,
    )
    .refine((v) => !opts.required || v !== null, opts.required ?? '')
    .default(null);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력하세요`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

const required = (max: number, label: string) =>
  z.string().trim().min(1, `${label}을(를) 입력하세요`).max(max, `${max}자 이하로 입력하세요`);

const ref = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim()))
  .default(null);

const dateStr = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다');

const optDate = z
  .union([dateStr, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v === '' || v === undefined ? null : v))
  .default(null);

const optClock = z
  .union([
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각 형식이 올바르지 않습니다'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (v === '' || v === undefined ? null : v))
  .default(null);

export const orderItemFormSchema = z.object({
  itemName: required(300, '품명'),
  itemCode: text(50),
  qty: num({ min: 0, required: '수량을 입력하세요' }),
  uomCode: text(20),
  weightKg: num({ min: 0 }),
  volumeCbm: num({ min: 0 }),
  palletQty: num({ min: 0 }),
  remark: text(500),
});

export const orderFormSchema = z
  .object({
    // ntms.order_type 실제 값과 맞춘다. 여기 없는 값을 넣으면 저장에서 터진다.
    orderType: z
      .enum(['DELIVERY', 'PICKUP', 'RETURN', 'TRANSFER', 'MILKRUN', 'CROSSDOCK'])
      .default('DELIVERY'),
    orderDate: dateStr,
    externalOrderNo: text(50),

    shipperId: ref.refine((v): v is string => v !== null, '화주를 고르세요'),
    consigneeId: ref,

    fromLocationId: ref,
    fromLocationName: required(200, '상차지명'),
    fromAddress1: required(300, '상차지 주소'),
    fromAddress2: text(300),
    fromContactName: text(100),
    fromContactTel: text(30),

    toLocationId: ref,
    toLocationName: required(200, '하차지명'),
    toAddress1: required(300, '하차지 주소'),
    toAddress2: text(300),
    toContactName: text(100),
    toContactTel: text(30),

    pickupDate: optDate,
    pickupTimeFrom: optClock,
    pickupTimeTo: optClock,
    deliveryDate: optDate,
    deliveryTimeFrom: optClock,
    deliveryTimeTo: optClock,
    isTimeCritical: z.coerce.boolean().default(false),

    requiredVehicleTypeId: ref,
    temperatureZone: z.enum(['AMBIENT', 'CHILLED', 'FROZEN', 'DEEP_FROZEN']).default('AMBIENT'),
    isHazardous: z.coerce.boolean().default(false),
    isExclusive: z.coerce.boolean().default(false),

    freightTerms: z.enum(['PREPAID', 'COLLECT', 'CREDIT', 'THIRD_PARTY']).default('CREDIT'),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),

    referenceNo1: text(50),
    specialInstruction: text(1000),
    remark: text(1000),

    items: z.array(orderItemFormSchema).min(1, '품목을 한 줄 이상 넣으세요'),
  })
  .refine((v) => v.fromLocationId === null || v.fromLocationId !== v.toLocationId, {
    message: '상차지와 하차지가 같습니다',
    path: ['toLocationId'],
  })
  .refine(
    (v) => !v.pickupTimeFrom || !v.pickupTimeTo || v.pickupTimeTo >= v.pickupTimeFrom,
    { message: '상차 종료가 시작보다 앞섭니다', path: ['pickupTimeTo'] },
  )
  .refine(
    (v) => !v.deliveryTimeFrom || !v.deliveryTimeTo || v.deliveryTimeTo >= v.deliveryTimeFrom,
    { message: '하차 종료가 시작보다 앞섭니다', path: ['deliveryTimeTo'] },
  )
  .refine(
    (v) => !v.pickupDate || !v.deliveryDate || v.deliveryDate >= v.pickupDate,
    { message: '하차일이 상차일보다 앞섭니다', path: ['deliveryDate'] },
  );

export type OrderItemFormInput = z.input<typeof orderItemFormSchema>;
export type OrderFormInput = z.input<typeof orderFormSchema>;
export type OrderFormValues = z.output<typeof orderFormSchema>;
