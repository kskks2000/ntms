/**
 * 운송오더 DTO 스키마.
 *
 * Nest.js 는 ValidationPipe 로, Next.js 는 react-hook-form resolver 로
 * 같은 스키마를 쓴다. 필드가 20개 넘는 오더 폼에서 양쪽 타입이 어긋나는
 * 사고를 막는 것이 이 패키지의 존재 이유다.
 */
import { z } from 'zod';
import type { OrderStatus } from './enums.js';
import {
  freightTermsSchema,
  orderPrioritySchema,
  orderStatusSchema,
  orderTypeSchema,
  temperatureZoneSchema,
} from './enums.js';

/** BIGINT PK 는 JSON 왕복에서 정밀도가 깨지므로 문자열로 주고받는다. */
export const idSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/, 'ID 형식이 올바르지 않습니다');

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm 형식이어야 합니다');

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');

export const orderItemInputSchema = z.object({
  lineNo: z.number().int().positive(),
  itemId: idSchema.optional(),
  itemCode: z.string().max(50).optional(),
  itemName: z.string().min(1).max(300),
  qty: z.number().positive(),
  uomCode: z.string().max(20).default('EA'),
  weightKg: z.number().nonnegative().default(0),
  volumeCbm: z.number().nonnegative().default(0),
  packagingTypeId: idSchema.optional(),
  palletQty: z.number().nonnegative().optional(),
  lotNo: z.string().max(50).optional(),
  expiryDate: dateSchema.optional(),
  unitPrice: z.number().nonnegative().optional(),
  remark: z.string().max(500).optional(),
});

// refine 을 걸기 전의 순수 오브젝트. update 스키마가 partial/omit 을 하려면
// ZodObject 여야 하므로 따로 둔다. (ZodEffects 에는 partial 이 없다)
const orderBaseSchema = z.object({
  orderType: orderTypeSchema.default('DELIVERY'),
  orderDate: dateSchema,
  externalOrderNo: z.string().max(50).optional(),

  shipperId: idSchema,
  contractId: idSchema.optional(),
  consigneeId: idSchema.optional(),

  // 상차지
  fromLocationId: idSchema.optional(),
  fromLocationName: z.string().min(1).max(200),
  fromZipCode: z.string().max(10).optional(),
  fromAddress1: z.string().min(1).max(300),
  fromAddress2: z.string().max(300).optional(),
  fromContactName: z.string().max(100).optional(),
  fromContactTel: z.string().max(30).optional(),

  // 하차지
  toLocationId: idSchema.optional(),
  toLocationName: z.string().min(1).max(200),
  toZipCode: z.string().max(10).optional(),
  toAddress1: z.string().min(1).max(300),
  toAddress2: z.string().max(300).optional(),
  toContactName: z.string().max(100).optional(),
  toContactTel: z.string().max(30).optional(),

  // 일정
  pickupDate: dateSchema.optional(),
  pickupTimeFrom: timeSchema.optional(),
  pickupTimeTo: timeSchema.optional(),
  deliveryDate: dateSchema.optional(),
  deliveryTimeFrom: timeSchema.optional(),
  deliveryTimeTo: timeSchema.optional(),
  isTimeCritical: z.boolean().default(false),

  // 요구 조건
  requiredVehicleTypeId: idSchema.optional(),
  requiredTon: z.number().positive().optional(),
  temperatureZone: temperatureZoneSchema.default('AMBIENT'),
  isHazardous: z.boolean().default(false),
  isExclusive: z.boolean().default(false),

  freightTerms: freightTermsSchema.default('CREDIT'),
  priority: orderPrioritySchema.default('NORMAL'),

  referenceNo1: z.string().max(50).optional(),
  specialInstruction: z.string().max(1000).optional(),
  remark: z.string().max(1000).optional(),

  items: z.array(orderItemInputSchema).min(1, '품목을 1건 이상 입력하세요'),
});

export const createOrderSchema = orderBaseSchema
  .refine(
    (v) =>
      !v.pickupDate ||
      !v.deliveryDate ||
      v.deliveryDate >= v.pickupDate,
    { message: '납품일은 상차일 이후여야 합니다', path: ['deliveryDate'] },
  )
  .refine(
    (v) =>
      !v.pickupTimeFrom ||
      !v.pickupTimeTo ||
      v.pickupTimeTo >= v.pickupTimeFrom,
    { message: '상차 종료시각이 시작시각보다 빠릅니다', path: ['pickupTimeTo'] },
  );

export const updateOrderSchema = orderBaseSchema.omit({ items: true }).partial();

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
  status: orderStatusSchema.optional(),
  shipperId: idSchema.optional(),
  pickupDateFrom: dateSchema.optional(),
  pickupDateTo: dateSchema.optional(),
  keyword: z.string().max(100).optional(),
  sort: z.string().max(50).default('orderDate:desc'),
});

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

// ---------------------------------------------------------------------
// 목록 응답
//
// 목록 화면은 상세를 다 내려받지 않는다. 오더 하나에 컬럼이 90개인데
// 그것을 100건씩 실어 보내면 표를 그리기도 전에 네트워크가 먼저 막힌다.
// 화면에 실제로 그려지는 것만 담는다.
// ---------------------------------------------------------------------

export interface OrderListItem {
  orderId: string;
  orderNo: string;
  orderDate: string;
  status: OrderStatus;
  priority: string;
  shipperName: string;
  fromName: string;
  toName: string;
  /** HH:mm — 상차 시간창 시작 */
  pickupFrom: string | null;
  pickupTo: string | null;
  deliveryFrom: string | null;
  weightKg: number;
  volumeCbm: number;
  distanceKm: number | null;
  estimatedAmount: number | null;
  temperatureZone: string;
  isTimeCritical: boolean;
  /** 편성된 트립. 아직 편성 전이면 null */
  tripNo: string | null;
}

export interface OrderListSummary {
  /** 조회 조건에 걸린 전체 건수 · 중량 · 금액 */
  totalCount: number;
  totalWeightKg: number;
  totalAmount: number;
}
