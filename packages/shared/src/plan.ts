/**
 * 운송계획 — 편성 · 배정 · 배차.
 *
 * ## 이 파일이 하는 일
 *
 * 오더 여러 건을 한 대에 묶으면 그 차는 정차지를 돌며 **싣고 내린다**.
 * 적재량은 상차에서 오르고 하차에서 내린다. 그 곡선이 차종 한계를 넘으면
 * 그 조합은 성립하지 않는다.
 *
 * 여기서 중요한 것은 "총 중량이 한계보다 큰가" 가 아니다. 오더 두 건이
 * 각각 6톤이어도, 하나를 내린 뒤에 다른 하나를 실으면 11톤차로 된다.
 * **순서가 답을 바꾼다.** 그래서 총합이 아니라 곡선을 봐야 한다.
 *
 * DB 의 trip_stop 에 cumulative_weight_kg 가 있는 것은 우연이 아니다 —
 * 스키마가 이미 이 곡선을 전제로 설계돼 있었다. 화면으로 보인 적이 없었을
 * 뿐이다.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 라벨
// ---------------------------------------------------------------------

export const TRIP_TYPE_LABEL: Record<string, string> = {
  SINGLE: '단건',
  CONSOLIDATED: '혼적',
  MILKRUN: '순회',
  SHUTTLE: '셔틀',
  RELAY: '릴레이',
};

export const STOP_TYPE_LABEL: Record<string, string> = {
  PICKUP: '상차',
  DELIVERY: '하차',
  WAYPOINT: '경유',
  REST: '휴게',
  FUEL: '주유',
  CROSSDOCK: '크로스독',
};

export const ALLOCATION_TYPE_LABEL: Record<string, string> = {
  DIRECT: '지명',
  ROTATION: '순번',
  BIDDING: '입찰',
  AUTO: '자동',
  SPOT: '스팟',
};

export const DISPATCH_TYPE_LABEL: Record<string, string> = {
  OWN: '자차',
  CONSIGNED: '지입',
  CONTRACTED: '계약',
  SPOT: '스팟',
};

// ---------------------------------------------------------------------
// 적재 곡선
// ---------------------------------------------------------------------

/** 곡선을 그리는 데 필요한 정차 한 곳 */
export interface StopLoad {
  stopSeq: number;
  stopType: string;
  locationName: string;
  /** 이 정차에서 싣는 양 (하차면 0) */
  loadWeightKg: number;
  loadVolumeCbm: number;
  loadPalletQty: number;
  /** 이 정차에서 내리는 양 (상차면 0) */
  unloadWeightKg: number;
  unloadVolumeCbm: number;
  unloadPalletQty: number;
}

export interface LoadPoint extends StopLoad {
  /** 이 정차를 마친 뒤 차에 남아 있는 양 */
  cumulativeWeightKg: number;
  cumulativeVolumeCbm: number;
  cumulativePalletQty: number;
  /** 한계 대비 사용률. 1을 넘으면 이 정차에서 넘친 것이다 */
  weightRate: number;
  volumeRate: number;
  palletRate: number;
  /** 셋 중 가장 빡빡한 값 — 막대 높이가 된다 */
  peakRate: number;
  over: boolean;
}

export interface Capacity {
  maxWeightKg: number | null;
  maxVolumeCbm: number | null;
  maxPalletQty: number | null;
}

export interface LoadProfile {
  points: LoadPoint[];
  /** 곡선 전체에서 가장 높이 올라간 값 */
  peakWeightKg: number;
  peakVolumeCbm: number;
  peakPalletQty: number;
  peakRate: number;
  /** 한계를 넘은 첫 정차. 없으면 null */
  firstOverSeq: number | null;
  /** 무엇 때문에 넘쳤나 */
  overBy: ('weight' | 'volume' | 'pallet')[];
}

/**
 * 정차 순서를 따라가며 적재량을 쌓는다.
 *
 * 각 정차에서 **내리고 나서 싣는다**. 실제 작업 순서가 그렇고, 그래야
 * 같은 곳에서 하차와 상차가 함께 일어날 때 순간 적재량이 부풀지 않는다.
 */
export function buildLoadProfile(stops: StopLoad[], cap: Capacity): LoadProfile {
  let w = 0;
  let v = 0;
  let p = 0;
  let firstOverSeq: number | null = null;
  const overBy = new Set<'weight' | 'volume' | 'pallet'>();

  const rate = (value: number, limit: number | null) =>
    limit === null || limit <= 0 ? 0 : value / limit;

  const points: LoadPoint[] = stops.map((s) => {
    // 내리고 나서 싣는다
    w = Math.max(0, w - s.unloadWeightKg) + s.loadWeightKg;
    v = Math.max(0, v - s.unloadVolumeCbm) + s.loadVolumeCbm;
    p = Math.max(0, p - s.unloadPalletQty) + s.loadPalletQty;

    const wr = rate(w, cap.maxWeightKg);
    const vr = rate(v, cap.maxVolumeCbm);
    const pr = rate(p, cap.maxPalletQty);
    const peak = Math.max(wr, vr, pr);
    const over = peak > 1.0000001;

    if (over) {
      if (firstOverSeq === null) firstOverSeq = s.stopSeq;
      if (wr > 1) overBy.add('weight');
      if (vr > 1) overBy.add('volume');
      if (pr > 1) overBy.add('pallet');
    }

    return {
      ...s,
      cumulativeWeightKg: round3(w),
      cumulativeVolumeCbm: round3(v),
      cumulativePalletQty: round3(p),
      weightRate: wr,
      volumeRate: vr,
      palletRate: pr,
      peakRate: peak,
      over,
    };
  });

  return {
    points,
    peakWeightKg: Math.max(0, ...points.map((x) => x.cumulativeWeightKg)),
    peakVolumeCbm: Math.max(0, ...points.map((x) => x.cumulativeVolumeCbm)),
    peakPalletQty: Math.max(0, ...points.map((x) => x.cumulativePalletQty)),
    peakRate: Math.max(0, ...points.map((x) => x.peakRate)),
    firstOverSeq,
    overBy: [...overBy],
  };
}

const OVER_LABEL: Record<string, string> = {
  weight: '중량',
  volume: '부피',
  pallet: '파렛트',
};

export function overByLabel(overBy: string[]): string {
  return overBy.map((k) => OVER_LABEL[k] ?? k).join(' · ');
}

// ---------------------------------------------------------------------
// 정차 순서 만들기
// ---------------------------------------------------------------------

/** 트립에 넣을 오더 한 건이 정차 순서에 기여하는 것 */
export interface OrderForTrip {
  orderId: string;
  orderNo: string;
  fromLocationId: string | null;
  fromLocationName: string;
  fromAddress1: string;
  toLocationId: string | null;
  toLocationName: string;
  toAddress1: string;
  pickupDate: string | null;
  pickupTimeFrom: string | null;
  pickupTimeTo: string | null;
  deliveryDate: string | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  weightKg: number;
  volumeCbm: number;
  palletQty: number;
}

export interface DerivedStop extends StopLoad {
  locationId: string | null;
  address1: string;
  /** 이 정차에서 다루는 오더들 */
  orders: { orderId: string; orderNo: string; action: 'LOAD' | 'UNLOAD' }[];
  timeWindowFrom: string | null;
  timeWindowTo: string | null;
}

/**
 * 오더 묶음에서 정차 순서를 뽑는다.
 *
 * 규칙은 단순하다 — **다 싣고 나서 다 내린다**. 상차는 상차 시간창이 이른
 * 순, 하차는 하차 시간창이 이른 순이다.
 *
 * 더 똑똑한 방식(내리면서 실어 적재량을 낮추기)도 있지만, 그건 최적화
 * 엔진의 일이고 여기서는 **사람이 순서를 바꿀 수 있게** 하는 것이 목적이다.
 * 기본값은 예측 가능해야 손으로 고치기 쉽다.
 *
 * 같은 거점에서 여러 오더를 싣거나 내리면 한 정차로 합친다. 차는 한 번만
 * 서기 때문이다.
 */
export function deriveStops(orders: OrderForTrip[]): DerivedStop[] {
  const pickups = new Map<string, DerivedStop>();
  const deliveries = new Map<string, DerivedStop>();

  const keyOf = (locationId: string | null, name: string) => locationId ?? `name:${name}`;

  for (const o of orders) {
    const pk = keyOf(o.fromLocationId, o.fromLocationName);
    const existing = pickups.get(pk);
    if (existing) {
      existing.loadWeightKg += o.weightKg;
      existing.loadVolumeCbm += o.volumeCbm;
      existing.loadPalletQty += o.palletQty;
      existing.orders.push({ orderId: o.orderId, orderNo: o.orderNo, action: 'LOAD' });
      existing.timeWindowFrom = laterClock(existing.timeWindowFrom, o.pickupTimeFrom);
      existing.timeWindowTo = earlierClock(existing.timeWindowTo, o.pickupTimeTo);
    } else {
      pickups.set(pk, {
        stopSeq: 0,
        stopType: 'PICKUP',
        locationId: o.fromLocationId,
        locationName: o.fromLocationName,
        address1: o.fromAddress1,
        loadWeightKg: o.weightKg,
        loadVolumeCbm: o.volumeCbm,
        loadPalletQty: o.palletQty,
        unloadWeightKg: 0,
        unloadVolumeCbm: 0,
        unloadPalletQty: 0,
        orders: [{ orderId: o.orderId, orderNo: o.orderNo, action: 'LOAD' }],
        timeWindowFrom: o.pickupTimeFrom,
        timeWindowTo: o.pickupTimeTo,
      });
    }

    const dk = keyOf(o.toLocationId, o.toLocationName);
    const ex2 = deliveries.get(dk);
    if (ex2) {
      ex2.unloadWeightKg += o.weightKg;
      ex2.unloadVolumeCbm += o.volumeCbm;
      ex2.unloadPalletQty += o.palletQty;
      ex2.orders.push({ orderId: o.orderId, orderNo: o.orderNo, action: 'UNLOAD' });
      ex2.timeWindowFrom = laterClock(ex2.timeWindowFrom, o.deliveryTimeFrom);
      ex2.timeWindowTo = earlierClock(ex2.timeWindowTo, o.deliveryTimeTo);
    } else {
      deliveries.set(dk, {
        stopSeq: 0,
        stopType: 'DELIVERY',
        locationId: o.toLocationId,
        locationName: o.toLocationName,
        address1: o.toAddress1,
        loadWeightKg: 0,
        loadVolumeCbm: 0,
        loadPalletQty: 0,
        unloadWeightKg: o.weightKg,
        unloadVolumeCbm: o.volumeCbm,
        unloadPalletQty: o.palletQty,
        orders: [{ orderId: o.orderId, orderNo: o.orderNo, action: 'UNLOAD' }],
        timeWindowFrom: o.deliveryTimeFrom,
        timeWindowTo: o.deliveryTimeTo,
      });
    }
  }

  const byWindow = (a: DerivedStop, b: DerivedStop) =>
    (a.timeWindowFrom ?? '99:99').localeCompare(b.timeWindowFrom ?? '99:99');

  const ordered = [
    ...[...pickups.values()].sort(byWindow),
    ...[...deliveries.values()].sort(byWindow),
  ];
  return ordered.map((s, i) => ({ ...s, stopSeq: i + 1 }));
}

/**
 * 여러 오더가 한 정차에 모이면 시간창은 **겹치는 구간**만 남는다.
 * 8시부터 받는 곳과 10시부터 받는 곳이 같은 정차면 10시부터다.
 */
function laterClock(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function earlierClock(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------
// 편성 스키마
// ---------------------------------------------------------------------

const idStr = z.string().regex(/^[1-9][0-9]{0,18}$/, 'ID 형식이 올바르지 않습니다');

export const tripCreateSchema = z.object({
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다'),
  requiredVehicleTypeId: idStr.nullable().default(null),
  orderIds: z.array(idStr).min(1, '오더를 한 건 이상 고르세요'),
  remark: z.string().trim().max(500).nullable().default(null),
});

export const tripUpdateSchema = z.object({
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requiredVehicleTypeId: idStr.nullable().optional(),
  orderIds: z.array(idStr).min(1, '오더를 한 건 이상 고르세요').optional(),
  /** 정차 순서를 손으로 바꿨을 때. 거점 키를 순서대로 준다 */
  stopOrder: z.array(z.string()).optional(),
  remark: z.string().trim().max(500).nullable().optional(),
});

export const allocateSchema = z.object({
  carrierId: idStr,
  allocationType: z
    .enum(['DIRECT', 'ROTATION', 'BIDDING', 'AUTO', 'SPOT'])
    .default('DIRECT'),
  rateTableId: idStr.nullable().default(null),
  allocatedAmount: z
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
    .refine((v) => v === null || (!Number.isNaN(v) && v >= 0), '금액을 확인하세요')
    .default(null),
  remark: z.string().trim().max(500).nullable().default(null),
});

export const dispatchAssignSchema = z.object({
  vehicleId: idStr,
  driverId: idStr,
  subDriverId: idStr.nullable().default(null),
  remark: z.string().trim().max(500).nullable().default(null),
});

export type TripCreateInput = z.output<typeof tripCreateSchema>;
export type TripUpdateInput = z.output<typeof tripUpdateSchema>;
export type AllocateInput = z.output<typeof allocateSchema>;
export type DispatchAssignInput = z.output<typeof dispatchAssignSchema>;

// ---------------------------------------------------------------------
// 응답
// ---------------------------------------------------------------------

/** 편성 화면 왼쪽 — 아직 트립에 안 묶인 오더 */
export interface PoolOrder extends OrderForTrip {
  status: string;
  shipperName: string;
  temperatureZone: string;
  requiredVehicleTypeId: string | null;
  requiredVehicleTypeName: string | null;
  isExclusive: boolean;
  isHazardous: boolean;
  distanceKm: number | null;
}

export interface TripStopView extends LoadPoint {
  locationId: string | null;
  address1: string;
  orders: { orderId: string; orderNo: string; action: 'LOAD' | 'UNLOAD' }[];
  timeWindowFrom: string | null;
  timeWindowTo: string | null;
}

export interface TripView {
  tripId: string;
  tripNo: string;
  planDate: string;
  status: string;
  tripType: string;
  requiredVehicleTypeId: string | null;
  requiredVehicleTypeName: string | null;
  capacity: Capacity;
  orderCount: number;
  totalWeightKg: number;
  totalVolumeCbm: number;
  totalPalletQty: number;
  weightLoadingRate: number | null;
  plannedDistanceKm: number | null;
  stops: TripStopView[];
  orders: { orderId: string; orderNo: string; shipperName: string; weightKg: number }[];
  profile: {
    peakWeightKg: number;
    peakRate: number;
    firstOverSeq: number | null;
    overBy: string[];
  };
  remark: string | null;
}

export interface ConsolidationPage {
  pool: PoolOrder[];
  trips: TripView[];
}

/** 배정 화면 — 트립 한 건에 붙일 수 있는 운송사 후보 */
export interface CarrierCandidate {
  carrierId: string;
  carrierCode: string;
  carrierName: string;
  grade: string | null;
  /** 계약 운임표에서 뽑은 금액. 없으면 null */
  contractAmount: number | null;
  rateTableId: string | null;
  rateTableName: string | null;
  /** 최근 배정 요청에 응한 비율 */
  acceptRate: number | null;
  onTimeRate: number | null;
  /** 이 차종을 몇 대 갖고 있나 */
  vehicleCount: number;
  /** 지금 이 날짜에 이미 몇 건 배정돼 있나 */
  assignedToday: number;
  /** 왜 이 후보를 위에 놓았는지 */
  note: string | null;
}

export interface AllocationTripView {
  tripId: string;
  tripNo: string;
  planDate: string;
  status: string;
  fromName: string;
  toName: string;
  stopCount: number;
  orderCount: number;
  totalWeightKg: number;
  requiredVehicleTypeName: string | null;
  plannedStartAt: string | null;
  plannedDistanceKm: number | null;
  estimatedBillingAmount: number | null;
  /** 이미 요청한 배정. 없으면 아직 안 붙인 것 */
  allocation: {
    allocationId: string;
    carrierId: string;
    carrierName: string;
    status: string;
    totalAmount: number | null;
    requestedAt: string | null;
    respondDeadlineAt: string | null;
  } | null;
}
