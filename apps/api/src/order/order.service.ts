import { Injectable } from '@nestjs/common';
import {
  toPageResult,
  type OrderListItem,
  type OrderListQuery,
  type OrderListSummary,
  type OrderStatus,
  type PageResult,
} from '@ntms/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/** 정렬 가능한 컬럼. 임의의 문자열을 그대로 orderBy 에 넘기지 않는다 */
const SORTABLE = {
  orderNo: 'order_no',
  orderDate: 'order_date',
  status: 'status',
  pickupDate: 'pickup_date',
  weightKg: 'total_weight_kg',
  amount: 'estimated_amount',
  distanceKm: 'distance_km',
} as const;

type SortKey = keyof typeof SORTABLE;

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    principal: AuthPrincipal,
    query: OrderListQuery,
  ): Promise<PageResult<OrderListItem> & { summary: OrderListSummary }> {
    const { tenantId, userId } = principal;

    return this.prisma.run({ tenantId, userId }, async (tx) => {
      const where = {
        tenant_id: tenantId,
        deleted_at: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.shipperId ? { shipper_id: BigInt(query.shipperId) } : {}),
        ...(query.pickupDateFrom || query.pickupDateTo
          ? {
              pickup_date: {
                ...(query.pickupDateFrom ? { gte: new Date(query.pickupDateFrom) } : {}),
                ...(query.pickupDateTo ? { lte: new Date(query.pickupDateTo) } : {}),
              },
            }
          : {}),
        // 검색어 하나로 오더번호 · 상하차지 · 화주를 함께 훑는다.
        // 배차 담당자는 "어디 걸 어디로" 로 기억하지 오더번호로 기억하지 않는다.
        ...(query.keyword
          ? {
              OR: [
                { order_no: { contains: query.keyword, mode: 'insensitive' as const } },
                {
                  from_location_name: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  to_location_name: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      };

      const [sortKey, sortDir] = parseSort(query.sort);

      const [rows, total, sums] = await Promise.all([
        tx.transport_order.findMany({
          where,
          include: {
            business_partner_transport_order_shipper_idTobusiness_partner: {
              select: { partner_name: true },
            },
            trip_order: { include: { trip: { select: { trip_no: true } } }, take: 1 },
          },
          orderBy: { [SORTABLE[sortKey]]: sortDir },
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.transport_order.count({ where }),
        tx.transport_order.aggregate({
          where,
          _sum: { total_weight_kg: true, estimated_amount: true },
        }),
      ]);

      const items: OrderListItem[] = rows.map((o) => ({
        orderId: o.order_id.toString(),
        orderNo: o.order_no,
        orderDate: toDateString(o.order_date),
        status: o.status as OrderStatus,
        priority: o.priority,
        shipperName:
          o.business_partner_transport_order_shipper_idTobusiness_partner.partner_name,
        fromName: o.from_location_name,
        toName: o.to_location_name,
        pickupFrom: toClock(o.pickup_time_from),
        pickupTo: toClock(o.pickup_time_to),
        deliveryFrom: toClock(o.delivery_time_from),
        weightKg: Number(o.total_weight_kg),
        volumeCbm: Number(o.total_volume_cbm),
        distanceKm: o.distance_km === null ? null : Number(o.distance_km),
        estimatedAmount:
          o.estimated_amount === null ? null : Number(o.estimated_amount),
        temperatureZone: o.temperature_zone,
        isTimeCritical: o.is_time_critical,
        tripNo: o.trip_order[0]?.trip.trip_no ?? null,
      }));

      return {
        ...toPageResult(items, total, query.page, query.size),
        summary: {
          totalCount: total,
          totalWeightKg: Number(sums._sum.total_weight_kg ?? 0),
          totalAmount: Number(sums._sum.estimated_amount ?? 0),
        },
      };
    });
  }
}

/** "orderDate:desc" → ['orderDate', 'desc']. 모르는 컬럼이면 기본값으로 떨어뜨린다 */
function parseSort(sort: string): [SortKey, 'asc' | 'desc'] {
  const [rawKey, rawDir] = sort.split(':');
  const key = (rawKey && rawKey in SORTABLE ? rawKey : 'orderDate') as SortKey;
  const dir = rawDir === 'asc' ? 'asc' : 'desc';
  return [key, dir];
}

function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `time without time zone` 는 Prisma 가 1970-01-01 기준 UTC Date 로 준다.
 * 벽시계 값 그대로 읽으려면 UTC 로 꺼내야 한다.
 */
function toClock(d: Date | null): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
