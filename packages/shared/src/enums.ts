/**
 * DB ENUM 타입의 TypeScript 미러.
 *
 * db/ddl/01_enum.sql 이 원본이다. ENUM 값을 추가하면 여기도 함께 고친다.
 * (Prisma 가 생성하는 타입도 있지만, 프론트엔드가 @prisma/client 를
 *  가져오지 않도록 별도로 둔다.)
 */
import { z } from 'zod';

export const ORDER_STATUS = [
  'DRAFT',
  'RECEIVED',
  'CONFIRMED',
  'PLANNED',
  'ALLOCATED',
  'DISPATCHED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CONFIRMED_POD',
  'SETTLED',
  'CANCELLED',
  'ON_HOLD',
  'RETURNED',
  'FAILED',
] as const;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: '임시저장',
  RECEIVED: '접수',
  CONFIRMED: '확정',
  PLANNED: '편성완료',
  ALLOCATED: '배정완료',
  DISPATCHED: '배차완료',
  PICKED_UP: '상차완료',
  IN_TRANSIT: '운송중',
  DELIVERED: '하차완료',
  CONFIRMED_POD: '인수확인',
  SETTLED: '정산완료',
  CANCELLED: '취소',
  ON_HOLD: '보류',
  RETURNED: '반송',
  FAILED: '배송실패',
};

export const ORDER_TYPE = [
  'DELIVERY',
  'PICKUP',
  'RETURN',
  'TRANSFER',
  'MILKRUN',
  'CROSSDOCK',
] as const;

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  DELIVERY: '출고배송',
  PICKUP: '집화',
  RETURN: '반품회수',
  TRANSFER: '지점간이고',
  MILKRUN: '순회집화',
  CROSSDOCK: '크로스도킹',
};

export const TRIP_STATUS = [
  'DRAFT',
  'CONFIRMED',
  'ALLOCATING',
  'ALLOCATED',
  'DISPATCHED',
  'EXECUTING',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
] as const;

export const DISPATCH_STATUS = [
  'ASSIGNED',
  'NOTIFIED',
  'ACCEPTED',
  'REJECTED',
  'CONFIRMED',
  'STARTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const SETTLEMENT_TYPE = ['BILLING', 'PAYMENT'] as const;

export const SETTLEMENT_TYPE_LABEL: Record<SettlementType, string> = {
  BILLING: '매출(청구)',
  PAYMENT: '매입(지급)',
};

export const TEMPERATURE_ZONE = ['AMBIENT', 'CHILLED', 'FROZEN', 'DEEP_FROZEN'] as const;

export const FREIGHT_TERMS = ['PREPAID', 'COLLECT', 'CREDIT', 'THIRD_PARTY'] as const;

export const ORDER_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

// --- Zod 스키마 ---------------------------------------------------------
export const orderStatusSchema = z.enum(ORDER_STATUS);
export const orderTypeSchema = z.enum(ORDER_TYPE);
export const tripStatusSchema = z.enum(TRIP_STATUS);
export const dispatchStatusSchema = z.enum(DISPATCH_STATUS);
export const settlementTypeSchema = z.enum(SETTLEMENT_TYPE);
export const temperatureZoneSchema = z.enum(TEMPERATURE_ZONE);
export const freightTermsSchema = z.enum(FREIGHT_TERMS);
export const orderPrioritySchema = z.enum(ORDER_PRIORITY);

// --- 타입 ---------------------------------------------------------------
export type OrderStatus = (typeof ORDER_STATUS)[number];
export type OrderType = (typeof ORDER_TYPE)[number];
export type TripStatus = (typeof TRIP_STATUS)[number];
export type DispatchStatus = (typeof DISPATCH_STATUS)[number];
export type SettlementType = (typeof SETTLEMENT_TYPE)[number];
export type TemperatureZone = (typeof TEMPERATURE_ZONE)[number];
export type FreightTerms = (typeof FREIGHT_TERMS)[number];
export type OrderPriority = (typeof ORDER_PRIORITY)[number];
