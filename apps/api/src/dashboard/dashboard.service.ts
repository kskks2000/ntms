import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  type AttentionItem,
  type DashboardOverview,
  type PipelineNode,
  type RunningTrip,
  type TodayFigures,
} from '@ntms/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/**
 * 오더 상태의 진행 순서.
 *
 * "이 단계를 통과했다" 를 판정하려면 상태에 순서가 있어야 한다.
 * 예외 상태(보류·취소·실패)는 흐름 밖이라 여기에 넣지 않는다.
 */
const ORDER_RANK: Record<string, number> = {
  DRAFT: 0,
  RECEIVED: 1,
  CONFIRMED: 2,
  PLANNED: 3,
  ALLOCATED: 4,
  DISPATCHED: 5,
  PICKED_UP: 6,
  IN_TRANSIT: 7,
  DELIVERED: 8,
  CONFIRMED_POD: 9,
  SETTLED: 10,
};

/** 흐름 밖으로 빠진 상태 */
const EXCEPTION_STATUSES = new Set(['CANCELLED', 'ON_HOLD', 'RETURNED', 'FAILED']);

interface StageSpec {
  stage: PipelineNode['stage'];
  label: string;
  /** 이 단계를 지났다고 볼 최소 순위 */
  passedFrom: number;
  /** 이 단계에 머물러 있는 상태들 */
  backlogStatuses: string[];
  backlogLabel: string;
  /** 이 수를 넘으면 병목으로 본다 */
  bottleneckAt: number;
  href: string;
}

const STAGES: StageSpec[] = [
  {
    stage: 'RECEIPT',
    label: '접수',
    passedFrom: 1,
    backlogStatuses: ['RECEIVED', 'CONFIRMED'],
    backlogLabel: '미편성',
    bottleneckAt: 15,
    href: '/plan/orders',
  },
  {
    stage: 'CONSOLIDATION',
    label: '편성',
    passedFrom: 3,
    backlogStatuses: ['PLANNED'],
    backlogLabel: '배정대기',
    bottleneckAt: 12,
    href: '/plan/consolidation',
  },
  {
    stage: 'ALLOCATION',
    label: '배정',
    passedFrom: 4,
    backlogStatuses: ['ALLOCATED'],
    backlogLabel: '배차대기',
    bottleneckAt: 10,
    href: '/plan/allocations',
  },
  {
    stage: 'DISPATCH',
    label: '배차',
    passedFrom: 5,
    backlogStatuses: ['DISPATCHED'],
    backlogLabel: '출발대기',
    bottleneckAt: 14,
    href: '/plan/dispatch',
  },
  {
    stage: 'TRANSIT',
    label: '운송',
    passedFrom: 6,
    backlogStatuses: ['PICKED_UP', 'IN_TRANSIT'],
    backlogLabel: '운행중',
    bottleneckAt: 999, // 도로 위에 있는 것은 정체가 아니다
    href: '/execution/control',
  },
  {
    stage: 'ACTUAL',
    label: '실적',
    passedFrom: 8,
    backlogStatuses: ['DELIVERED'],
    backlogLabel: '인수확인 대기',
    bottleneckAt: 8,
    href: '/actuals',
  },
  {
    stage: 'SETTLEMENT',
    label: '정산',
    passedFrom: 10,
    backlogStatuses: ['CONFIRMED_POD'],
    backlogLabel: '정산대기',
    bottleneckAt: 20,
    href: '/settlements/billing',
  },
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    principal: AuthPrincipal,
    dateInput?: string,
  ): Promise<DashboardOverview> {
    const date = parseDate(dateInput);
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return this.prisma.run(
      { tenantId: principal.tenantId, userId: principal.userId },
      async (tx) => {
        const [statusCounts, figures, running, attention] = await Promise.all([
          this.orderStatusCounts(tx, principal.tenantId, date),
          this.todayFigures(tx, principal.tenantId, date, dayStart, dayEnd),
          this.runningTrips(tx, principal.tenantId, date),
          this.attention(tx, principal.tenantId, date),
        ]);

        return {
          date: toDateString(date),
          generatedAt: new Date().toISOString(),
          pipeline: buildPipeline(statusCounts),
          attention,
          today: figures,
          running,
        };
      },
    );
  }

  // -------------------------------------------------------------------

  private async orderStatusCounts(
    tx: TxClient,
    tenantId: bigint,
    date: Date,
  ): Promise<Map<string, number>> {
    const rows = await tx.transport_order.groupBy({
      by: ['status'],
      where: { tenant_id: tenantId, order_date: date, deleted_at: null },
      _count: { _all: true },
    });

    return new Map(rows.map((r) => [r.status, r._count._all]));
  }

  private async todayFigures(
    tx: TxClient,
    tenantId: bigint,
    date: Date,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<TodayFigures> {
    const [orderAgg, tripAgg, dispatchCount, execAgg, completed, delayed] =
      await Promise.all([
        tx.transport_order.aggregate({
          where: { tenant_id: tenantId, order_date: date, deleted_at: null },
          _count: { _all: true },
          _sum: { total_weight_kg: true },
        }),
        tx.trip.aggregate({
          where: { tenant_id: tenantId, plan_date: date },
          _count: { _all: true },
          _sum: { planned_distance_km: true },
          _avg: { weight_loading_rate: true },
        }),
        tx.dispatch.count({
          where: { tenant_id: tenantId, dispatch_date: date, deleted_at: null },
        }),
        tx.transport_execution.count({
          where: {
            tenant_id: tenantId,
            execution_date: date,
            status: { in: ['DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING'] },
          },
        }),
        tx.transport_execution.count({
          where: { tenant_id: tenantId, execution_date: date, status: 'COMPLETED' },
        }),
        tx.transport_execution.count({
          where: { tenant_id: tenantId, execution_date: date, is_delayed: true },
        }),
      ]);

    // 완료된 운행 중 지연된 것만 센다. 달리는 중인 지연 차를 여기 섞으면
    // 분자(완료)와 분모(완료+진행중)의 모집단이 달라져 정시율이 무너진다.
    const completedDelayed = await tx.transport_execution.count({
      where: {
        tenant_id: tenantId,
        execution_date: date,
        status: 'COMPLETED',
        is_delayed: true,
      },
    });

    // 정시율은 끝난 운행만으로 계산한다. 아직 달리는 중인 차를
    // 분모에 넣으면 오전에는 늘 100%, 저녁에는 뚝 떨어지는 숫자가 된다.
    const onTimeRate =
      completed > 0
        ? Number((((completed - completedDelayed) / completed) * 100).toFixed(1))
        : null;

    return {
      orderCount: orderAgg._count._all,
      tripCount: tripAgg._count._all,
      dispatchCount,
      runningCount: execAgg,
      weightTon: Number(((Number(orderAgg._sum.total_weight_kg ?? 0) || 0) / 1000).toFixed(1)),
      plannedDistanceKm: Math.round(Number(tripAgg._sum.planned_distance_km ?? 0) || 0),
      onTimeRate,
      delayedCount: delayed,
      loadingRate:
        tripAgg._avg.weight_loading_rate === null
          ? null
          : Number(Number(tripAgg._avg.weight_loading_rate).toFixed(1)),
    };
  }

  private async runningTrips(
    tx: TxClient,
    tenantId: bigint,
    date: Date,
  ): Promise<RunningTrip[]> {
    const rows = await tx.transport_execution.findMany({
      where: {
        tenant_id: tenantId,
        execution_date: date,
        status: { in: ['READY', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING'] },
      },
      include: {
        trip: { include: { trip_stop: { orderBy: { stop_seq: 'asc' }, take: 2 } } },
        dispatch: true,
      },
      orderBy: [{ delay_minutes: 'desc' }, { progress_rate: 'desc' }],
      take: 12,
    });

    return rows.map((r) => ({
      tripId: r.trip_id.toString(),
      tripNo: r.trip.trip_no,
      carrierName: r.dispatch.carrier_name,
      vehicleNo: r.dispatch.vehicle_no ?? '-',
      driverName: r.dispatch.driver_name ?? '-',
      fromName: r.trip.trip_stop[0]?.location_name ?? '-',
      toName: r.trip.trip_stop[1]?.location_name ?? '-',
      progressRate: Number(r.progress_rate ?? 0),
      delayMinutes: r.delay_minutes ?? 0,
      status: r.status,
      plannedEndAt: r.trip.planned_end_at?.toISOString() ?? null,
      lastLocationAt: r.last_location_at?.toISOString() ?? null,
    }));
  }

  /**
   * 지금 손대야 할 일.
   *
   * 목록이 길면 아무것도 손대지 않게 된다. 심각도 순으로 잘라 10건만 낸다.
   */
  private async attention(
    tx: TxClient,
    tenantId: bigint,
    date: Date,
  ): Promise<AttentionItem[]> {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 3_600_000);

    const [delayed, pendingAccept, undispatched, held, podPending] = await Promise.all([
      tx.transport_execution.findMany({
        where: {
          tenant_id: tenantId,
          execution_date: date,
          is_delayed: true,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        include: { trip: true, dispatch: true },
        orderBy: { delay_minutes: 'desc' },
        take: 5,
      }),
      tx.allocation.findMany({
        where: { tenant_id: tenantId, status: 'REQUESTED', trip: { plan_date: date } },
        include: { trip: true, business_partner: true },
        orderBy: { respond_deadline_at: 'asc' },
        take: 5,
      }),
      tx.trip.findMany({
        where: {
          tenant_id: tenantId,
          plan_date: date,
          status: { in: ['CONFIRMED', 'ALLOCATED'] },
          planned_start_at: { lte: soon },
        },
        orderBy: { planned_start_at: 'asc' },
        take: 5,
      }),
      tx.transport_order.findMany({
        where: {
          tenant_id: tenantId,
          order_date: date,
          status: { in: ['ON_HOLD', 'FAILED'] },
          deleted_at: null,
        },
        orderBy: { updated_at: 'desc' },
        take: 5,
      }),
      tx.transport_order.count({
        where: {
          tenant_id: tenantId,
          order_date: date,
          status: 'DELIVERED',
          deleted_at: null,
        },
      }),
    ]);

    const items: AttentionItem[] = [];

    for (const e of delayed) {
      const min = e.delay_minutes ?? 0;
      items.push({
        id: `delay-${e.execution_id}`,
        kind: 'DELAY',
        severity: min >= 60 ? 'critical' : 'warning',
        ref: e.trip.trip_no,
        title: `${min}분 지연`,
        detail: `${e.dispatch.carrier_name} · ${e.dispatch.vehicle_no ?? '-'} · ${e.dispatch.driver_name ?? '-'}`,
        at: e.trip.planned_end_at?.toISOString() ?? null,
        href: '/execution/control',
      });
    }

    for (const a of pendingAccept) {
      const deadline = a.respond_deadline_at;
      const overdue = deadline !== null && deadline < now;
      items.push({
        id: `alloc-${a.allocation_id}`,
        kind: 'PENDING_ACCEPT',
        severity: overdue ? 'critical' : 'warning',
        ref: a.trip.trip_no,
        title: overdue ? '수락 기한 초과' : '운송사 수락 대기',
        detail: `${a.business_partner.partner_name} · 요청 ${formatClock(a.requested_at)}`,
        at: deadline?.toISOString() ?? null,
        href: '/plan/allocations',
      });
    }

    for (const t of undispatched) {
      items.push({
        id: `undispatched-${t.trip_id}`,
        kind: 'UNDISPATCHED',
        severity: 'warning',
        ref: t.trip_no,
        title: '출발 임박 · 배차 없음',
        detail: `${t.total_order_count}건 · ${Number(t.total_weight_kg).toLocaleString('ko-KR')}kg`,
        at: t.planned_start_at?.toISOString() ?? null,
        href: '/plan/dispatch',
      });
    }

    for (const o of held) {
      items.push({
        id: `hold-${o.order_id}`,
        kind: 'ON_HOLD',
        severity: o.status === 'FAILED' ? 'critical' : 'info',
        ref: o.order_no,
        title: o.status === 'FAILED' ? '배송 실패' : '보류',
        detail: o.hold_reason ?? o.cancel_reason ?? `${o.from_location_name} → ${o.to_location_name}`,
        at: o.updated_at.toISOString(),
        href: '/plan/orders',
      });
    }

    if (podPending > 0) {
      items.push({
        id: 'pod-pending',
        kind: 'POD_PENDING',
        severity: 'info',
        ref: `${podPending}건`,
        title: '인수확인 대기',
        detail: '하차는 끝났고 인수증 확인이 남았습니다',
        at: null,
        href: '/execution/pod',
      });
    }

    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 10);
  }
}

// ---------------------------------------------------------------------

function buildPipeline(counts: Map<string, number>): PipelineNode[] {
  const countAtOrAbove = (minRank: number) => {
    let total = 0;
    for (const [status, n] of counts) {
      if (EXCEPTION_STATUSES.has(status)) continue;
      if ((ORDER_RANK[status] ?? -1) >= minRank) total += n;
    }
    return total;
  };

  return STAGES.map((spec) => {
    const backlog = spec.backlogStatuses.reduce(
      (sum, s) => sum + (counts.get(s) ?? 0),
      0,
    );
    return {
      stage: spec.stage,
      label: spec.label,
      passed: countAtOrAbove(spec.passedFrom),
      backlog,
      backlogLabel: spec.backlogLabel,
      isBottleneck: backlog >= spec.bottleneckAt,
      href: spec.href,
    };
  });
}

/** YYYY-MM-DD → 그날 00:00 (로컬). 없거나 형식이 틀리면 오늘 */
function parseDate(input?: string): Date {
  const d = input && /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(input) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatClock(d: Date | null): string {
  if (!d) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
