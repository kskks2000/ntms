import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import type {
  BoardBar,
  BoardStop,
  BoardVehicle,
  DispatchBoard,
  UnassignedTrip,
} from '@ntms/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/** 데이터가 없을 때 보여줄 기본 시간축 */
const DEFAULT_WINDOW = { fromHour: 6, toHour: 20 };

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  async board(principal: AuthPrincipal, dateInput?: string): Promise<DispatchBoard> {
    const date = parseDate(dateInput);

    return this.prisma.run(
      { tenantId: principal.tenantId, userId: principal.userId },
      async (tx) => {
        const [vehicles, unassigned] = await Promise.all([
          this.vehicleRows(tx, principal.tenantId, date),
          this.unassignedTrips(tx, principal.tenantId, date),
        ]);

        const conflictCount = vehicles.reduce(
          (sum, v) => sum + v.bars.filter((b) => b.hasConflict).length,
          0,
        );
        const dispatchCount = vehicles.reduce((sum, v) => sum + v.bars.length, 0);
        const usedVehicleCount = vehicles.filter((v) => v.bars.length > 0).length;

        const { windowFrom, windowTo } = timeWindow(date, vehicles, unassigned);

        return {
          date: toDateString(date),
          now: new Date().toISOString(),
          windowFrom: windowFrom.toISOString(),
          windowTo: windowTo.toISOString(),
          vehicles,
          unassigned,
          summary: {
            vehicleCount: vehicles.length,
            usedVehicleCount,
            dispatchCount,
            unassignedCount: unassigned.length,
            conflictCount,
            utilizationRate:
              vehicles.length === 0
                ? 0
                : Number(((usedVehicleCount / vehicles.length) * 100).toFixed(1)),
          },
        };
      },
    );
  }

  // -------------------------------------------------------------------

  private async vehicleRows(
    tx: TxClient,
    tenantId: bigint,
    date: Date,
  ): Promise<BoardVehicle[]> {
    const [vehicles, dispatches] = await Promise.all([
      tx.vehicle.findMany({
        where: { tenant_id: tenantId, deleted_at: null, is_active: true },
        include: {
          vehicle_type: { select: { vehicle_type_name: true, ton_class: true } },
          business_partner: { select: { partner_name: true } },
        },
        orderBy: [{ vehicle_type_id: 'desc' }, { vehicle_no: 'asc' }],
      }),
      tx.dispatch.findMany({
        where: { tenant_id: tenantId, dispatch_date: date, deleted_at: null },
        include: {
          trip: {
            include: { trip_stop: { orderBy: { stop_seq: 'asc' } } },
          },
          transport_execution: true,
        },
        orderBy: { planned_start_at: 'asc' },
      }),
    ]);

    const byVehicle = new Map<string, typeof dispatches>();
    for (const d of dispatches) {
      if (d.vehicle_id === null) continue;
      const key = d.vehicle_id.toString();
      const list = byVehicle.get(key) ?? [];
      list.push(d);
      byVehicle.set(key, list);
    }

    return vehicles.map((v) => {
      const rows = byVehicle.get(v.vehicle_id.toString()) ?? [];

      const bars: BoardBar[] = rows.map((d) => {
        // dispatch : transport_execution 은 1:1 이다 (배차 한 건에 실행 한 건)
        const execution = d.transport_execution;
        const stops: BoardStop[] = d.trip.trip_stop.map((s) => ({
          stopType: s.stop_type,
          locationName: s.location_name,
          plannedArrivalAt: s.planned_arrival_at?.toISOString() ?? null,
          latitude: s.latitude === null ? null : Number(s.latitude),
        }));

        return {
          dispatchId: d.dispatch_id.toString(),
          dispatchNo: d.dispatch_no,
          tripId: d.trip_id.toString(),
          tripNo: d.trip.trip_no,
          driverName: d.driver_name ?? '-',
          carrierName: d.carrier_name,
          fromName: stops[0]?.locationName ?? '-',
          toName: stops[stops.length - 1]?.locationName ?? '-',
          plannedStartAt: (d.planned_start_at ?? d.trip.planned_start_at ?? date).toISOString(),
          plannedEndAt: (d.planned_end_at ?? d.trip.planned_end_at ?? date).toISOString(),
          actualStartAt: execution?.actual_start_at?.toISOString() ?? null,
          status: d.status,
          executionStatus: execution?.status ?? null,
          progressRate: Number(execution?.progress_rate ?? 0),
          delayMinutes: execution?.delay_minutes ?? 0,
          orderCount: d.trip.total_order_count,
          weightKg: Number(d.trip.total_weight_kg),
          hasConflict: false,
          stops,
        };
      });

      markConflicts(bars);

      return {
        vehicleId: v.vehicle_id.toString(),
        vehicleNo: v.vehicle_no,
        vehicleTypeName: v.vehicle_type.vehicle_type_name,
        tonClass: v.vehicle_type.ton_class === null ? null : Number(v.vehicle_type.ton_class),
        carrierName: v.business_partner?.partner_name ?? '자차',
        status: v.status,
        bars,
      };
    });
  }

  /**
   * 아직 차가 붙지 않은 트립.
   *
   * 배차 담당자의 일감이다. 출발이 임박한 것부터 위로 올린다 —
   * 목록 순서 자체가 "먼저 손대야 할 것" 을 말해야 한다.
   */
  private async unassignedTrips(
    tx: TxClient,
    tenantId: bigint,
    date: Date,
  ): Promise<UnassignedTrip[]> {
    const trips = await tx.trip.findMany({
      where: {
        tenant_id: tenantId,
        plan_date: date,
        status: { in: ['DRAFT', 'CONFIRMED', 'ALLOCATING', 'ALLOCATED'] },
        // 배차가 하나도 없거나 전부 취소된 트립만
        dispatch: { none: { deleted_at: null, status: { not: 'CANCELLED' } } },
      },
      include: {
        trip_stop: { orderBy: { stop_seq: 'asc' } },
        vehicle_type: { select: { vehicle_type_name: true } },
        allocation: {
          where: { status: { in: ['REQUESTED', 'ACCEPTED'] } },
          include: { business_partner: { select: { partner_name: true } } },
          orderBy: { allocation_seq: 'desc' },
          take: 1,
        },
      },
      orderBy: { planned_start_at: 'asc' },
    });

    const now = Date.now();

    return trips.map((t) => {
      const stops: BoardStop[] = t.trip_stop.map((s) => ({
        stopType: s.stop_type,
        locationName: s.location_name,
        plannedArrivalAt: s.planned_arrival_at?.toISOString() ?? null,
        latitude: s.latitude === null ? null : Number(s.latitude),
      }));

      return {
        tripId: t.trip_id.toString(),
        tripNo: t.trip_no,
        status: t.status,
        fromName: stops[0]?.locationName ?? '-',
        toName: stops[stops.length - 1]?.locationName ?? '-',
        plannedStartAt: t.planned_start_at?.toISOString() ?? null,
        plannedEndAt: t.planned_end_at?.toISOString() ?? null,
        orderCount: t.total_order_count,
        weightKg: Number(t.total_weight_kg),
        requiredVehicleTypeName: t.vehicle_type?.vehicle_type_name ?? null,
        requiredTon: t.required_ton === null ? null : Number(t.required_ton),
        carrierName: t.allocation[0]?.business_partner.partner_name ?? null,
        minutesToStart:
          t.planned_start_at === null
            ? null
            : Math.round((t.planned_start_at.getTime() - now) / 60_000),
        stops,
      };
    });
  }
}

// ---------------------------------------------------------------------

/**
 * 같은 차량에 시간이 겹치는 배차를 표시한다.
 *
 * DB 에도 `ex_vehicle_availability` (GiST 배제제약) 가 있어 이중 배차를
 * 막지만, 그것은 vehicle_availability 를 거쳐 등록한 경우에만 걸린다.
 * 외부 연계나 수기 입력으로 들어온 것까지 화면에서 보이게 해 둔다 —
 * 배차판이 "겹쳤다" 를 말해 주지 않으면 아무도 모른 채 당일에 사고가 난다.
 */
function markConflicts(bars: BoardBar[]): void {
  const sorted = [...bars].sort(
    (a, b) => Date.parse(a.plannedStartAt) - Date.parse(b.plannedStartAt),
  );

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    // 앞 배차의 계획 종료가 다음 배차의 계획 시작보다 늦으면 겹친 것이다
    if (Date.parse(prev.plannedEndAt) > Date.parse(curr.plannedStartAt)) {
      prev.hasConflict = true;
      curr.hasConflict = true;
    }
  }
}

/**
 * 시간축 범위.
 *
 * 00~24 로 고정하면 실제 운행이 몰린 구간이 화면 가운데 좁게 눌린다.
 * 그날 데이터의 앞뒤로 한 시간씩만 여유를 두고 자른다.
 */
function timeWindow(
  date: Date,
  vehicles: BoardVehicle[],
  unassigned: UnassignedTrip[],
): { windowFrom: Date; windowTo: Date } {
  const stamps: number[] = [];
  for (const v of vehicles) {
    for (const b of v.bars) {
      stamps.push(Date.parse(b.plannedStartAt), Date.parse(b.plannedEndAt));
    }
  }
  for (const t of unassigned) {
    if (t.plannedStartAt) stamps.push(Date.parse(t.plannedStartAt));
    if (t.plannedEndAt) stamps.push(Date.parse(t.plannedEndAt));
  }

  if (stamps.length === 0) {
    const from = new Date(date);
    from.setHours(DEFAULT_WINDOW.fromHour, 0, 0, 0);
    const to = new Date(date);
    to.setHours(DEFAULT_WINDOW.toHour, 0, 0, 0);
    return { windowFrom: from, windowTo: to };
  }

  const from = new Date(Math.min(...stamps));
  from.setMinutes(0, 0, 0);
  from.setHours(from.getHours() - 1);

  const to = new Date(Math.max(...stamps));
  to.setMinutes(0, 0, 0);
  to.setHours(to.getHours() + 2);

  // 하루 경계로 자르지 않는다. 자정을 넘겨 달리는 간선이 실제로 있고,
  // 잘라 버리면 그 운행이 화면에서 반쪽만 보인다.
  return { windowFrom: from, windowTo: to };
}

/**
 * 기준일을 **UTC 자정**으로 만든다.
 *
 * `new Date('2026-08-20')` 는 이미 UTC 자정인데, 여기에 setHours(0,0,0,0) 을
 * 걸면 로컬 자정으로 되돌아간다 — KST 에서는 2026-08-19T15:00Z 가 되고,
 * Postgres 의 date 컬럼과 맞추면 하루 앞선 날을 조회한다.
 *
 * 증상이 고약한 이유는 **틀린 날의 데이터가 멀쩡히 나오기 때문**이다.
 * 빈 화면이면 금방 알아채지만, 어제 트립이 오늘 것처럼 보이면 모른 채
 * 배차한다.
 */
function parseDate(input?: string): Date {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00Z`);
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // 오늘이 며칠인지는 보는 사람 기준(로컬)이고, 담는 그릇은 UTC 자정이다
  return new Date(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00Z`,
  );
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
