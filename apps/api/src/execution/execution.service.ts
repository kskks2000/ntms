import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  buildCascade,
  type CascadeStopInput,
  type ControlBoard,
  type ExceptionCreateInput,
  type ExceptionPage,
  type ExceptionRow,
  type ExceptionUpdateInput,
  type ExecutionCard,
  type ExecutionLookupPage,
  type ExecutionTrack,
  type MissingPodRow,
  type PodConfirmInput,
  type PodPage,
  type PodRow,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NaverService } from '../naver/naver.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/**
 * 운송실행 — 관제 · 예외 · 인수증.
 *
 * 계획(plan)이 "이렇게 보내겠다" 라면 여기는 "실제로 이렇게 가고 있다" 다.
 * 세 화면이 한 서비스에 있는 이유는 셋이 같은 실행 건을 다른 각도에서 보기
 * 때문이다 — 지금 어디쯤인가(관제), 무엇이 어긋났나(예외), 받았다는 증거가
 * 있나(인수증). 파일을 나누면 같은 조인을 세 번 쓰게 된다.
 */
@Injectable()
export class ExecutionService {
  /**
   * 도로 경로는 트립마다 한 번만 받는다.
   *
   * 정차가 안 바뀌면 경로도 안 바뀌는데, 관제 화면은 몇십 초마다 다시
   * 부른다. 캐시가 없으면 화면을 열어 둔 것만으로 지도 API 요금이 계속
   * 나간다. 프로세스 안에만 두는 이유는, 틀려도 그저 한 번 더 부르는
   * 것뿐이라 굳이 공유 저장소까지 갈 일이 아니어서다.
   */
  private readonly routeCache = new Map<string, [number, number][]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly naver: NaverService,
  ) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // 관제 보드
  // ===================================================================

  /**
   * 오늘 도로 위에 있는 것 전부.
   *
   * 목록의 정렬이 이 화면의 주장이다. **마감을 놓칠 건이 맨 위**, 그다음이
   * 지연이 큰 건, 그다음이 정상. 차량번호순이나 출발순으로 두면 손이 필요한
   * 건을 스크롤로 찾아야 하고, 바쁜 날에는 못 찾는다.
   */
  async board(principal: AuthPrincipal, date: string): Promise<ControlBoard> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const day = dateOnly(date);

      const rows = await tx.transport_execution.findMany({
        where: { tenant_id, execution_date: day },
        include: {
          dispatch: {
            select: {
              vehicle_no: true,
              driver_name: true,
              driver_mobile: true,
              trip: { select: { trip_no: true, total_order_count: true } },
            },
          },
        },
        orderBy: { execution_id: 'asc' },
      });

      if (rows.length === 0) {
        return {
          date,
          summary: {
            running: 0,
            delayed: 0,
            breaching: 0,
            onTimeRate: null,
            openExceptions: 0,
            missingPods: 0,
          },
          executions: [],
        };
      }

      const ids = rows.map((r) => r.execution_id);
      const [stopRows, carriers, exceptionCounts] = await Promise.all([
        this.stopsOf(tx, tenant_id, ids),
        tx.business_partner.findMany({
          where: { tenant_id, partner_id: { in: rows.map((r) => r.carrier_id) } },
          select: { partner_id: true, partner_name: true },
        }),
        tx.transport_exception.groupBy({
          by: ['execution_id'],
          where: {
            tenant_id,
            execution_id: { in: ids },
            status: { in: ['REPORTED', 'INVESTIGATING', 'ACTION_TAKEN'] },
          },
          _count: { _all: true },
        }),
      ]);

      const carrierName = new Map(carriers.map((c) => [String(c.partner_id), c.partner_name]));
      const openExc = new Map(
        exceptionCounts.map((e) => [String(e.execution_id), e._count._all]),
      );

      const executions: ExecutionCard[] = rows.map((r) => {
        const key = String(r.execution_id);
        const cascade = buildCascade(stopRows.get(key) ?? [], r.delay_minutes);
        const next = cascade.rows.find((s) => s.basis !== 'actual');

        return {
          executionId: key,
          tripNo: r.dispatch.trip?.trip_no ?? '',
          executionDate: isoDate(r.execution_date),
          status: r.status,
          carrierName: carrierName.get(String(r.carrier_id)) ?? '—',
          vehicleNo: r.dispatch.vehicle_no ?? '—',
          driverName: r.dispatch.driver_name,
          driverMobile: r.dispatch.driver_mobile,
          orderCount: r.dispatch.trip?.total_order_count ?? 0,
          completedStopCount: r.completed_stop_count,
          totalStopCount: r.total_stop_count,
          progressRate: num(r.progress_rate) ?? 0,
          delayMinutes: r.delay_minutes,
          breachCount: cascade.breachCount,
          headroomMinutes: cascade.headroomMinutes,
          openExceptionCount: openExc.get(key) ?? 0,
          lastLatitude: num(r.last_latitude),
          lastLongitude: num(r.last_longitude),
          lastLocationAt: iso(r.last_location_at),
          lastSpeedKmh: num(r.last_speed_kmh),
          nextStopName: next?.locationName ?? null,
          nextStopEtaAt: next?.expectedArrivalAt ?? null,
          nextStopWindowTo: next?.windowTo ?? null,
        };
      });

      /*
        정렬 = 이 화면의 주장.

        **아직 손쓸 수 있는 건이 먼저다.** 끝난 건이 마감을 넘겼다는 사실은
        중요하지만 지금 할 수 있는 일이 없고, 운행 중인 건은 전화 한 통으로
        결과가 달라진다. 그래서 운행 여부를 첫 기준으로 둔다 — 마감 위험을
        맨 앞에 두면 되돌릴 수 없는 어제 일이 오늘 할 일 위에 앉는다.

        그 안에서는 마감을 놓칠 건 > 지연이 큰 건 > 진행이 덜 된 건 순이다.
      */
      executions.sort(
        (a, b) =>
          Number(isRunning(b.status)) - Number(isRunning(a.status)) ||
          b.breachCount - a.breachCount ||
          b.delayMinutes - a.delayMinutes ||
          a.progressRate - b.progressRate,
      );

      const running = executions.filter((e) => isRunning(e.status));
      const finished = executions.filter((e) => e.status === 'COMPLETED');
      const onTime = finished.filter((e) => e.delayMinutes <= 10).length;

      const missingPods = await this.countMissingPods(tx, tenant_id, day);

      return {
        date,
        summary: {
          running: running.length,
          delayed: executions.filter((e) => e.delayMinutes > 0).length,
          breaching: executions.filter((e) => e.breachCount > 0).length,
          onTimeRate:
            finished.length === 0 ? null : Math.round((onTime / finished.length) * 1000) / 10,
          openExceptions: executions.reduce((s, e) => s + e.openExceptionCount, 0),
          missingPods,
        },
        executions,
      };
    });
  }

  /**
   * 한 건을 펼친다 — 정차 실적 · 자취 · 도로 경로 · 예외.
   *
   * 지도 키가 없으면 route 가 빈 배열로 나가고 화면은 정차를 직선으로 잇는다.
   * 경로를 못 받았다고 트래킹 전체가 안 뜨면 안 된다.
   */
  async track(principal: AuthPrincipal, executionId: string): Promise<ExecutionTrack> {
    const base = await this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const id = toBigInt(executionId, 'EXECUTION_NOT_FOUND');

      const row = await tx.transport_execution.findFirst({
        where: { tenant_id, execution_id: id },
        include: {
          dispatch: {
            select: {
              vehicle_no: true,
              driver_name: true,
              driver_mobile: true,
              trip: {
                select: {
                  trip_id: true,
                  trip_no: true,
                  planned_distance_km: true,
                  trip_order: {
                    select: {
                      order_id: true,
                      transport_order: {
                        select: {
                          order_no: true,
                          to_location_name: true,
                          business_partner_transport_order_shipper_idTobusiness_partner: {
                            select: { partner_name: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!row) throw AppError.notFound('EXECUTION_NOT_FOUND', '운송건을 찾을 수 없습니다.');

      const [stopRows, tripStops, trailRows, carrier, exceptions] = await Promise.all([
        this.stopsOf(tx, tenant_id, [id]),
        tx.trip_stop.findMany({
          where: { tenant_id, trip_id: row.trip_id },
          select: {
            stop_seq: true,
            stop_type: true,
            location_name: true,
            latitude: true,
            longitude: true,
          },
          orderBy: { stop_seq: 'asc' },
        }),
        tx.gps_log.findMany({
          where: { tenant_id, execution_id: id },
          select: { latitude: true, longitude: true },
          orderBy: { collected_at: 'asc' },
          take: 500,
        }),
        tx.business_partner.findFirst({
          where: { tenant_id, partner_id: row.carrier_id },
          select: { partner_name: true },
        }),
        this.exceptionRows(tx, tenant_id, { execution_id: id }, 50),
      ]);

      const cascade = buildCascade(stopRows.get(String(id)) ?? [], row.delay_minutes);

      return {
        tripId: row.trip_id,
        track: {
          executionId: String(row.execution_id),
          tripNo: row.dispatch.trip?.trip_no ?? '',
          status: row.status,
          executionDate: isoDate(row.execution_date),
          vehicleNo: row.dispatch.vehicle_no ?? '—',
          driverName: row.dispatch.driver_name,
          driverMobile: row.dispatch.driver_mobile,
          carrierName: carrier?.partner_name ?? '—',
          delayMinutes: row.delay_minutes,
          progressRate: num(row.progress_rate) ?? 0,
          lastLatitude: num(row.last_latitude),
          lastLongitude: num(row.last_longitude),
          lastLocationAt: iso(row.last_location_at),
          lastSpeedKmh: num(row.last_speed_kmh),
          actualDistanceKm: num(row.actual_distance_km),
          plannedDistanceKm: num(row.dispatch.trip?.planned_distance_km ?? null),
          stops: tripStops.map((s) => ({
            stopSeq: s.stop_seq,
            stopType: s.stop_type,
            locationName: s.location_name,
            latitude: num(s.latitude),
            longitude: num(s.longitude),
          })),
          cascade,
          trail: trailRows
            .map((g) => [num(g.longitude)!, num(g.latitude)!] as [number, number])
            .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)),
          route: [] as [number, number][],
          routeSource: 'none' as const,
          orders: (row.dispatch.trip?.trip_order ?? []).map((o) => ({
            orderId: String(o.order_id),
            orderNo: o.transport_order?.order_no ?? '',
            shipperName:
              o.transport_order?.business_partner_transport_order_shipper_idTobusiness_partner
                ?.partner_name ?? '',
            toLocationName: o.transport_order?.to_location_name ?? '',
          })),
          exceptions,
        } satisfies ExecutionTrack,
      };
    });

    // 도로 경로는 트랜잭션 밖에서 받는다. 외부 호출이 DB 커넥션을 붙잡고
    // 있으면 지도 API 가 느린 날 커넥션 풀이 먼저 마른다.
    const route = await this.routeOf(String(base.tripId), base.track.stops);
    return { ...base.track, route, routeSource: route.length > 0 ? 'naver' : 'none' };
  }

  private async routeOf(
    tripId: string,
    stops: { latitude: number | null; longitude: number | null }[],
  ): Promise<[number, number][]> {
    const cached = this.routeCache.get(tripId);
    if (cached) return cached;
    if (!this.naver.config().serverReady) return [];

    const pts = stops
      .filter((s) => s.latitude !== null && s.longitude !== null)
      .map((s) => ({ latitude: s.latitude!, longitude: s.longitude! }));
    if (pts.length < 2) return [];

    try {
      const res = await this.naver.directions({
        start: pts[0]!,
        goal: pts[pts.length - 1]!,
        waypoints: pts.slice(1, -1),
      });
      this.routeCache.set(tripId, res.path);
      return res.path;
    } catch {
      // 경로를 못 받아도 트래킹은 떠야 한다. 화면은 정차를 직선으로 잇는다.
      return [];
    }
  }

  /**
   * 실행별 정차 실적을 지연 계산이 먹을 모양으로.
   *
   * 시간창은 execution_stop 이 아니라 trip_stop 이 들고 있다 — 계획이 정한
   * 약속이지 실적이 정하는 것이 아니기 때문이다. 그래서 조인해 끌어온다.
   */
  private async stopsOf(
    tx: TxClient,
    tenant_id: bigint,
    executionIds: bigint[],
  ): Promise<Map<string, CascadeStopInput[]>> {
    const rows = await tx.execution_stop.findMany({
      where: { tenant_id, execution_id: { in: executionIds } },
      include: {
        trip_stop: { select: { time_window_from: true, time_window_to: true } },
      },
      orderBy: [{ execution_id: 'asc' }, { stop_seq: 'asc' }],
    });

    const out = new Map<string, CascadeStopInput[]>();
    for (const r of rows) {
      const key = String(r.execution_id);
      (out.get(key) ?? out.set(key, []).get(key)!).push({
        stopSeq: r.stop_seq,
        stopType: r.stop_type,
        locationName: r.location_name,
        plannedArrivalAt: iso(r.planned_arrival_at),
        plannedDepartureAt: iso(r.planned_departure_at),
        windowFrom: iso(r.trip_stop?.time_window_from ?? null),
        windowTo: iso(r.trip_stop?.time_window_to ?? null),
        actualArrivalAt: iso(r.actual_arrival_at),
        actualDepartureAt: iso(r.actual_departure_at),
        status: r.status,
      });
    }
    return out;
  }

  /**
   * 오더번호 · 트립번호 · 차량번호로 찾는다.
   *
   * 화주가 전화로 부르는 것은 오더번호이고, 기사에게서 오는 연락은 차량
   * 번호로 시작한다. 어느 쪽으로 들어오든 같은 창구가 받아야 담당자가
   * "그건 어느 화면에서 찾죠" 를 묻지 않는다.
   *
   * 날짜를 안 받는다. 화주는 자기 물건이 며칠 자 오더인지 모르고, 물어보는
   * 쪽이 날짜를 알아야 답을 얻는 검색은 검색이 아니다.
   */
  async lookup(principal: AuthPrincipal, q: string): Promise<ExecutionLookupPage> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const term = q.trim();
      if (term.length < 2) return { query: term, rows: [] };

      const matchedOrders = await tx.transport_order.findMany({
        where: { tenant_id, deleted_at: null, order_no: { contains: term, mode: 'insensitive' } },
        select: { order_id: true, order_no: true },
        take: 50,
      });
      const orderIds = matchedOrders.map((o) => o.order_id);

      const rows = await tx.transport_execution.findMany({
        where: {
          tenant_id,
          OR: [
            { dispatch: { trip: { trip_no: { contains: term, mode: 'insensitive' } } } },
            { dispatch: { vehicle_no: { contains: term, mode: 'insensitive' } } },
            ...(orderIds.length > 0
              ? [{ dispatch: { trip: { trip_order: { some: { order_id: { in: orderIds } } } } } }]
              : []),
          ],
        },
        include: {
          dispatch: {
            select: {
              vehicle_no: true,
              driver_name: true,
              trip: {
                select: {
                  trip_no: true,
                  trip_order: {
                    select: {
                      order_id: true,
                      transport_order: { select: { order_no: true } },
                    },
                  },
                },
              },
            },
          },
        },
        // 최근 것이 먼저다. 화주가 묻는 것은 대개 오늘 · 어제 건이다.
        orderBy: [{ execution_date: 'desc' }, { execution_id: 'desc' }],
        take: 20,
      });

      const carriers = await tx.business_partner.findMany({
        where: { tenant_id, partner_id: { in: [...new Set(rows.map((r) => r.carrier_id))] } },
        select: { partner_id: true, partner_name: true },
      });
      const carrierName = new Map(carriers.map((c) => [String(c.partner_id), c.partner_name]));
      const matchedNo = new Map(matchedOrders.map((o) => [String(o.order_id), o.order_no]));

      return {
        query: term,
        rows: rows.map((r) => {
          const orders = r.dispatch.trip?.trip_order ?? [];
          return {
            executionId: String(r.execution_id),
            tripNo: r.dispatch.trip?.trip_no ?? '',
            executionDate: isoDate(r.execution_date),
            status: r.status,
            vehicleNo: r.dispatch.vehicle_no ?? '—',
            driverName: r.dispatch.driver_name,
            carrierName: carrierName.get(String(r.carrier_id)) ?? '—',
            delayMinutes: r.delay_minutes,
            progressRate: num(r.progress_rate) ?? 0,
            matchedOrderNo:
              orders.map((o) => matchedNo.get(String(o.order_id))).find(Boolean) ?? null,
            orderNos: orders.map((o) => o.transport_order?.order_no ?? '').filter(Boolean),
          };
        }),
      };
    });
  }

  // ===================================================================
  // 예외
  // ===================================================================

  async exceptions(
    principal: AuthPrincipal,
    query: { from: string; to: string; status: string | null; severity: string | null },
  ): Promise<ExceptionPage> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const where = {
        tenant_id,
        occurred_at: { gte: dateOnly(query.from), lt: nextDay(query.to) },
        ...(query.status === 'OPEN'
          ? { status: { in: ['REPORTED', 'INVESTIGATING', 'ACTION_TAKEN'] as const } }
          : query.status
            ? { status: query.status as never }
            : {}),
        ...(query.severity ? { severity: query.severity as never } : {}),
      };

      const rows = await this.exceptionRows(tx, tenant_id, where, 300);
      const open = rows.filter((r) =>
        ['REPORTED', 'INVESTIGATING', 'ACTION_TAKEN'].includes(r.status),
      );

      /*
        유형별 집계는 건수가 아니라 **까먹은 시간**으로도 낸다.

        "차량고장 1건 · 교통정체 6건" 만 보면 정체가 문제 같지만, 고장 한
        건이 4시간을 먹고 정체 여섯 건이 합쳐 40분이면 손댈 곳은 반대다.
      */
      const byType = [...new Set(open.map((r) => r.exceptionType))]
        .map((type) => {
          const hits = open.filter((r) => r.exceptionType === type);
          return {
            type,
            open: hits.length,
            impactMinutes: hits.reduce((s, r) => s + (r.impactMinutes ?? 0), 0),
          };
        })
        .sort((a, b) => b.impactMinutes - a.impactMinutes || b.open - a.open);

      return {
        rows,
        total: rows.length,
        openCount: open.length,
        openImpactMinutes: open.reduce((s, r) => s + (r.impactMinutes ?? 0), 0),
        byType,
      };
    });
  }

  private async exceptionRows(
    tx: TxClient,
    tenant_id: bigint,
    where: Record<string, unknown>,
    take: number,
  ): Promise<ExceptionRow[]> {
    const rows = await tx.transport_exception.findMany({
      where: { tenant_id, ...where },
      include: {
        dispatch: {
          select: {
            vehicle_no: true,
            driver_name: true,
            trip: { select: { trip_no: true } },
          },
        },
      },
      orderBy: [{ occurred_at: 'desc' }],
      take,
    });

    const carrierIds = [...new Set(rows.map((r) => r.carrier_id).filter((c) => c !== null))];
    const carriers =
      carrierIds.length === 0
        ? []
        : await tx.business_partner.findMany({
            where: { tenant_id, partner_id: { in: carrierIds as bigint[] } },
            select: { partner_id: true, partner_name: true },
          });
    const carrierName = new Map(carriers.map((c) => [String(c.partner_id), c.partner_name]));

    return rows.map((r) => ({
      exceptionId: String(r.exception_id),
      exceptionNo: r.exception_no,
      executionId: r.execution_id === null ? null : String(r.execution_id),
      tripNo: r.dispatch?.trip?.trip_no ?? null,
      exceptionType: r.exception_type,
      severity: r.severity,
      status: r.status,
      occurredAt: iso(r.occurred_at)!,
      reportedAt: iso(r.reported_at)!,
      description: r.description,
      actionTaken: r.action_taken,
      impactMinutes: r.impact_minutes,
      vehicleNo: r.dispatch?.vehicle_no ?? null,
      driverName: r.dispatch?.driver_name ?? null,
      carrierName: r.carrier_id === null ? null : (carrierName.get(String(r.carrier_id)) ?? null),
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      resolvedAt: iso(r.resolved_at),
    }));
  }

  async createException(
    principal: AuthPrincipal,
    dto: ExceptionCreateInput,
  ): Promise<{ exceptionId: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const id = toBigInt(dto.executionId, 'EXECUTION_NOT_FOUND');

      const exec = await tx.transport_execution.findFirst({
        where: { tenant_id, execution_id: id },
        select: {
          execution_id: true,
          dispatch_id: true,
          vehicle_id: true,
          driver_id: true,
          carrier_id: true,
          last_latitude: true,
          last_longitude: true,
          exception_count: true,
        },
      });
      if (!exec) throw AppError.notFound('EXECUTION_NOT_FOUND', '운송건을 찾을 수 없습니다.');

      const created = await tx.transport_exception.create({
        data: {
          tenant_id,
          execution_id: exec.execution_id,
          dispatch_id: exec.dispatch_id,
          vehicle_id: exec.vehicle_id,
          driver_id: exec.driver_id,
          carrier_id: exec.carrier_id,
          exception_type: dto.exceptionType,
          severity: dto.severity,
          occurred_at: new Date(),
          // 예외가 난 곳은 마지막으로 받은 위치다. 나중에 지도에서 어디서
          // 터졌는지 되짚을 때 이 좌표가 유일한 단서가 된다.
          latitude: exec.last_latitude,
          longitude: exec.last_longitude,
          description: dto.description,
          impact_minutes: dto.impactMinutes,
          status: 'REPORTED',
          reported_by: principal.userId,
          created_by: principal.userId,
          updated_by: principal.userId,
        },
        select: { exception_id: true },
      });

      await tx.transport_execution.update({
        where: { execution_id: exec.execution_id },
        data: { exception_count: exec.exception_count + 1, updated_by: principal.userId },
      });

      return { exceptionId: String(created.exception_id) };
    });
  }

  async updateException(
    principal: AuthPrincipal,
    exceptionId: string,
    dto: ExceptionUpdateInput,
  ): Promise<{ exceptionId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const id = toBigInt(exceptionId, 'EXCEPTION_NOT_FOUND');

      const row = await tx.transport_exception.findFirst({
        where: { tenant_id, exception_id: id },
        select: { exception_id: true, status: true },
      });
      if (!row) throw AppError.notFound('EXCEPTION_NOT_FOUND', '예외를 찾을 수 없습니다.');
      if (row.status === 'CLOSED') {
        throw AppError.conflict('EXCEPTION_CLOSED', '종결된 예외는 고칠 수 없습니다.');
      }
      // 조치 내용 없이 해결로 넘기면 나중에 아무도 무슨 일이 있었는지 모른다
      if (
        ['ACTION_TAKEN', 'RESOLVED', 'CLOSED'].includes(dto.status) &&
        !dto.actionTaken?.trim()
      ) {
        throw AppError.badRequest(
          'ACTION_REQUIRED',
          '어떻게 조치했는지 적어야 이 상태로 넘길 수 있습니다.',
        );
      }

      const now = new Date();
      await tx.transport_exception.update({
        where: { exception_id: row.exception_id },
        data: {
          status: dto.status,
          action_taken: dto.actionTaken,
          ...(dto.severity ? { severity: dto.severity } : {}),
          resolved_at: dto.status === 'RESOLVED' || dto.status === 'CLOSED' ? now : null,
          resolved_by:
            dto.status === 'RESOLVED' || dto.status === 'CLOSED' ? principal.userId : null,
          closed_at: dto.status === 'CLOSED' ? now : null,
          updated_by: principal.userId,
        },
      });

      return { exceptionId: String(row.exception_id), status: dto.status };
    });
  }

  // ===================================================================
  // 인수증
  // ===================================================================

  /**
   * 인수증 한 장.
   *
   * 목록보다 **빠진 것**이 먼저다. 인수증이 없으면 청구를 못 닫으므로,
   * 끝난 지 오래인데 아직 없는 건이 곧 돈이 묶인 건이다.
   */
  async pods(
    principal: AuthPrincipal,
    query: { from: string; to: string; result: string | null; confirmed: string | null },
  ): Promise<PodPage> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const gte = dateOnly(query.from);
      const lt = nextDay(query.to);

      const podRows = await tx.pod.findMany({
        where: {
          tenant_id,
          delivered_at: { gte, lt },
          ...(query.result ? { pod_result: query.result as never } : {}),
          ...(query.confirmed === 'Y'
            ? { is_confirmed: true }
            : query.confirmed === 'N'
              ? { is_confirmed: false }
              : {}),
        },
        orderBy: { delivered_at: 'desc' },
        take: 300,
      });

      const orderIds = [...new Set(podRows.map((p) => p.order_id))];
      const execIds = [...new Set(podRows.map((p) => p.execution_id))];
      const [orders, execs] = await Promise.all([
        orderIds.length === 0
          ? []
          : tx.transport_order.findMany({
              where: { tenant_id, order_id: { in: orderIds } },
              select: {
                order_id: true,
                order_no: true,
                to_location_name: true,
                business_partner_transport_order_shipper_idTobusiness_partner: {
                  select: { partner_name: true },
                },
              },
            }),
        execIds.length === 0
          ? []
          : tx.transport_execution.findMany({
              where: { tenant_id, execution_id: { in: execIds } },
              select: {
                execution_id: true,
                dispatch: {
                  select: {
                    vehicle_no: true,
                    driver_name: true,
                    trip: { select: { trip_no: true } },
                  },
                },
              },
            }),
      ]);
      const orderById = new Map(orders.map((o) => [String(o.order_id), o]));
      const execById = new Map(execs.map((e) => [String(e.execution_id), e]));

      const rows: PodRow[] = podRows.map((p) => {
        const o = orderById.get(String(p.order_id));
        const e = execById.get(String(p.execution_id));
        return {
          podId: String(p.pod_id),
          podNo: p.pod_no,
          executionId: String(p.execution_id),
          tripNo: e?.dispatch.trip?.trip_no ?? null,
          orderId: String(p.order_id),
          orderNo: o?.order_no ?? '',
          shipperName:
            o?.business_partner_transport_order_shipper_idTobusiness_partner.partner_name ?? '',
          toLocationName: o?.to_location_name ?? '',
          podType: p.pod_type,
          podResult: p.pod_result,
          receiverName: p.receiver_name,
          deliveredAt: iso(p.delivered_at)!,
          isGeofenceVerified: p.is_geofence_verified,
          isConfirmed: p.is_confirmed,
          confirmedAt: iso(p.confirmed_at),
          vehicleNo: e?.dispatch.vehicle_no ?? null,
          driverName: e?.dispatch.driver_name ?? null,
          abnormalReason: p.abnormal_reason,
        };
      });

      const missing = await this.missingPods(tx, tenant_id, gte, lt);
      const collected = rows.length;
      const total = collected + missing.length;

      return {
        rows,
        total: collected,
        missing,
        summary: {
          collected,
          confirmed: rows.filter((r) => r.isConfirmed).length,
          abnormal: rows.filter((r) => r.podResult !== 'NORMAL').length,
          missing: missing.length,
          collectionRate: total === 0 ? null : Math.round((collected / total) * 1000) / 10,
        },
      };
    });
  }

  /**
   * 끝났는데 인수증이 없는 오더.
   *
   * 실행 단위가 아니라 **오더 단위**로 본다. 트립 하나에 오더가 셋이면
   * 인수증도 셋이어야 하고, 하나만 들어왔을 때 "그 트립은 인수증 있음"
   * 으로 세면 나머지 둘이 조용히 묻힌다.
   */
  private async missingPods(
    tx: TxClient,
    tenant_id: bigint,
    gte: Date,
    lt: Date,
  ): Promise<MissingPodRow[]> {
    const done = await tx.transport_execution.findMany({
      where: {
        tenant_id,
        status: 'COMPLETED',
        execution_date: { gte, lt },
      },
      select: {
        execution_id: true,
        carrier_id: true,
        completed_at: true,
        actual_end_at: true,
        dispatch: {
          select: {
            vehicle_no: true,
            driver_name: true,
            trip: {
              select: {
                trip_no: true,
                trip_order: {
                  select: {
                    order_id: true,
                    transport_order: {
                      select: {
                        order_no: true,
                        to_location_name: true,
                        business_partner_transport_order_shipper_idTobusiness_partner: {
                          select: { partner_name: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (done.length === 0) return [];

    const have = await tx.pod.findMany({
      where: { tenant_id, execution_id: { in: done.map((d) => d.execution_id) } },
      select: { execution_id: true, order_id: true },
    });
    const covered = new Set(have.map((h) => `${h.execution_id}:${h.order_id}`));

    const carriers = await tx.business_partner.findMany({
      where: { tenant_id, partner_id: { in: [...new Set(done.map((d) => d.carrier_id))] } },
      select: { partner_id: true, partner_name: true },
    });
    const carrierName = new Map(carriers.map((c) => [String(c.partner_id), c.partner_name]));

    const now = Date.now();
    const out: MissingPodRow[] = [];
    for (const d of done) {
      const finishedAt = d.completed_at ?? d.actual_end_at;
      for (const o of d.dispatch.trip?.trip_order ?? []) {
        if (covered.has(`${d.execution_id}:${o.order_id}`)) continue;
        out.push({
          executionId: String(d.execution_id),
          tripNo: d.dispatch.trip?.trip_no ?? '',
          orderId: String(o.order_id),
          orderNo: o.transport_order?.order_no ?? '',
          shipperName:
              o.transport_order?.business_partner_transport_order_shipper_idTobusiness_partner
                ?.partner_name ?? '',
          toLocationName: o.transport_order?.to_location_name ?? '',
          completedAt: iso(finishedAt),
          agingHours:
            finishedAt === null
              ? null
              : Math.max(0, Math.round((now - finishedAt.getTime()) / 3_600_000)),
          vehicleNo: d.dispatch.vehicle_no,
          driverName: d.dispatch.driver_name,
          carrierName: carrierName.get(String(d.carrier_id)) ?? '—',
        });
      }
    }
    // 오래 묵은 것이 위로. 어제 끝난 건보다 나흘 전 건이 급하다.
    out.sort((a, b) => (b.agingHours ?? 0) - (a.agingHours ?? 0));
    return out;
  }

  private async countMissingPods(tx: TxClient, tenant_id: bigint, day: Date): Promise<number> {
    const rows = await this.missingPods(tx, tenant_id, day, nextDayOf(day));
    return rows.length;
  }

  async confirmPod(
    principal: AuthPrincipal,
    podId: string,
    dto: PodConfirmInput,
  ): Promise<{ podId: string; isConfirmed: boolean }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const id = toBigInt(podId, 'POD_NOT_FOUND');

      const row = await tx.pod.findFirst({
        where: { tenant_id, pod_id: id },
        select: { pod_id: true, is_confirmed: true },
      });
      if (!row) throw AppError.notFound('POD_NOT_FOUND', '인수증을 찾을 수 없습니다.');
      // 되돌릴 때는 왜 되돌리는지 남긴다. 확인을 취소한 흔적이 없으면
      // 정산에서 금액이 틀어졌을 때 되짚을 데가 없다.
      if (!dto.confirm && !dto.disputeReason?.trim()) {
        throw AppError.badRequest('DISPUTE_REASON_REQUIRED', '되돌리는 사유를 적어주세요.');
      }

      await tx.pod.update({
        where: { pod_id: row.pod_id },
        data: {
          is_confirmed: dto.confirm,
          confirmed_at: dto.confirm ? new Date() : null,
          confirmed_by: dto.confirm ? principal.userId : null,
          dispute_reason: dto.confirm ? null : dto.disputeReason,
          updated_by: principal.userId,
        },
      });

      return { podId: String(row.pod_id), isConfirmed: dto.confirm };
    });
  }
}

// ---------------------------------------------------------------------

function isRunning(status: string): boolean {
  return ['READY', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING'].includes(status);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 'YYYY-MM-DD' → 그날 자정(UTC).
 *
 * new Date('2026-08-20') 은 UTC 자정이지만 new Date(2026, 7, 20) 은 로컬
 * 자정이다. date 칸은 시간대가 없으므로 UTC 로 맞춰야 하루가 안 밀린다.
 */
function dateOnly(input: string): Date {
  return new Date(`${input}T00:00:00Z`);
}

function nextDay(input: string): Date {
  return nextDayOf(dateOnly(input));
}

function nextDayOf(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

function toBigInt(v: string, code: string): bigint {
  try {
    return BigInt(v);
  } catch {
    throw AppError.notFound(code, '대상을 찾을 수 없습니다.');
  }
}
