import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import type {
  DriverDayRow,
  KpiBoard,
  KpiDimensionRow,
  KpiDirection,
  KpiMetric,
  KpiSeriesPoint,
  OperationDaily,
  VehicleDayRow,
} from '@ntms/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { rebuildAggregates } from './actual-aggregate.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/**
 * 운행일보 · KPI — 실적을 두 방향으로 접는다.
 *
 * ## 왜 집계 테이블을 따로 두는가
 *
 * 운행일보와 KPI 를 매번 `transport_actual` 에서 계산해도 숫자는 맞다.
 * 그런데 두 화면이 답하는 질문이 "지금 이 순간" 이 아니라 **"그날 무슨 일이
 * 있었나"** 다. 한 달 뒤에 3월 15일 운행일보를 열었을 때, 그 사이에 실적을
 * 되돌렸다 다시 확정한 흔적 때문에 숫자가 달라지면 아무도 그 화면을 근거로
 * 쓰지 않는다.
 *
 * 그래서 집계는 **찍어 둔 값**이고, 언제 찍었는지(`calculated_at`)를 화면에
 * 같이 보여 준다. 실적이 바뀌면 그 날짜만 다시 찍는다.
 *
 * ## KPI 는 확정된 실적만 센다
 *
 * 미확정 실적은 아직 흔들리는 숫자다. 그것까지 세면 아침에 본 정시율과
 * 오후에 본 정시율이 달라지고, 지표가 지표 노릇을 못 한다.
 */
@Injectable()
export class ActualReportService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // 다시 찍기
  // ===================================================================

  /**
   * 날짜별로 운행일보 · 기사 근무 · KPI 를 다시 만든다.
   *
   * 실제 계산은 `actual-aggregate.ts` 가 한다. 시드도 같은 함수를 부르므로,
   * 데모 데이터의 숫자와 「다시 집계」를 누른 뒤의 숫자가 어긋나지 않는다.
   */
  async rebuild(principal: AuthPrincipal, dates: string[]): Promise<{ dates: string[] }> {
    const unique = [...new Set(dates)].sort();
    if (unique.length === 0) return { dates: [] };

    await this.run(principal, async (tx) => {
      for (const date of unique) {
        await rebuildAggregates(
          tx,
          { tenantId: principal.tenantId, userId: principal.userId },
          dateOnly(date),
        );
      }
    });
    return { dates: unique };
  }

  // ===================================================================
  // 운행일보 읽기
  // ===================================================================

  async daily(principal: AuthPrincipal, date: string): Promise<OperationDaily> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const day = dateOnly(date);

      const [vehicleRows, driverRows] = await Promise.all([
        tx.vehicle_operation_daily.findMany({
          where: { tenant_id, operation_date: day },
          include: {
            vehicle: {
              select: { vehicle_no: true, vehicle_type: { select: { vehicle_type_name: true } } },
            },
            driver: { select: { driver_name: true } },
            business_partner: { select: { partner_name: true } },
          },
        }),
        tx.driver_work_log.findMany({
          where: { tenant_id, work_date: day },
          include: {
            driver: { select: { driver_name: true } },
            vehicle: { select: { vehicle_no: true } },
            business_partner: { select: { partner_name: true } },
          },
        }),
      ]);

      const violators = new Set(
        driverRows
          .filter((d) => d.is_continuous_violation || d.is_rest_violation)
          .map((d) => String(d.driver_id)),
      );

      const vehicles: VehicleDayRow[] = vehicleRows
        .map((v) => ({
          vehicleId: String(v.vehicle_id),
          vehicleNo: v.vehicle.vehicle_no,
          vehicleTypeName: v.vehicle.vehicle_type?.vehicle_type_name ?? null,
          carrierName: v.business_partner?.partner_name ?? null,
          driverName: v.driver?.driver_name ?? null,
          isOperated: v.is_operated,
          nonOperationReason: v.non_operation_reason,
          tripCount: v.trip_count,
          orderCount: v.order_count,
          stopCount: v.stop_count,
          totalDistanceKm: num(v.total_distance_km) ?? 0,
          loadedDistanceKm: num(v.loaded_distance_km),
          emptyDistanceKm: num(v.empty_distance_km),
          emptyRate: num(v.empty_rate),
          firstStartAt: iso(v.first_start_at),
          lastEndAt: iso(v.last_end_at),
          operatingMinutes: v.operating_minutes,
          drivingMinutes: v.driving_minutes,
          waitingMinutes: v.waiting_minutes,
          idleMinutes: v.idle_minutes,
          restMinutes: v.rest_minutes,
          totalWeightKg: num(v.total_weight_kg) ?? 0,
          avgLoadingRate: num(v.avg_loading_rate),
          fuelLiter: num(v.fuel_liter),
          fuelEfficiency: num(v.fuel_efficiency),
          tollFee: num(v.toll_fee),
          revenueAmount: num(v.revenue_amount),
          costAmount: num(v.cost_amount),
          profitAmount: num(v.profit_amount),
          hasWorkViolation: v.driver_id !== null && violators.has(String(v.driver_id)),
        }))
        // 굴린 차가 위, 그중에서도 많이 달린 차가 위. 휴차는 아래로 모은다.
        .sort((a, b) => {
          if (a.isOperated !== b.isOperated) return a.isOperated ? -1 : 1;
          return b.totalDistanceKm - a.totalDistanceKm;
        });

      const drivers: DriverDayRow[] = driverRows
        .map((d) => ({
          driverId: String(d.driver_id),
          driverName: d.driver.driver_name,
          vehicleNo: d.vehicle?.vehicle_no ?? null,
          carrierName: d.business_partner?.partner_name ?? null,
          workStartAt: iso(d.work_start_at),
          workEndAt: iso(d.work_end_at),
          totalWorkMinutes: d.total_work_minutes,
          drivingMinutes: d.driving_minutes,
          restMinutes: d.rest_minutes,
          nightWorkMinutes: d.night_work_minutes,
          overtimeMinutes: d.overtime_minutes,
          maxContinuousDrivingMin: d.max_continuous_driving_min,
          isContinuousViolation: d.is_continuous_violation,
          isRestViolation: d.is_rest_violation,
          tripCount: d.trip_count,
          distanceKm: num(d.distance_km) ?? 0,
        }))
        // 위반이 맨 위. 법규 화면에서 스크롤로 위반을 찾게 하지 않는다.
        .sort((a, b) => {
          const av = Number(a.isContinuousViolation || a.isRestViolation);
          const bv = Number(b.isContinuousViolation || b.isRestViolation);
          return bv - av || b.totalWorkMinutes - a.totalWorkMinutes;
        });

      const operated = vehicles.filter((v) => v.isOperated);
      const totalDistance = sum(vehicles.map((v) => v.totalDistanceKm));
      const loadedDistance = sum(vehicles.map((v) => v.loadedDistanceKm ?? 0));
      const rates = operated
        .map((v) => v.avgLoadingRate)
        .filter((r): r is number => r !== null);

      return {
        date,
        builtAt: iso(vehicleRows[0]?.updated_at ?? null),
        vehicles,
        drivers,
        summary: {
          vehicleTotal: vehicles.length,
          vehicleOperated: operated.length,
          utilizationRate:
            vehicles.length === 0 ? null : round((operated.length / vehicles.length) * 100, 1),
          totalDistanceKm: round(totalDistance, 1),
          loadedDistanceKm: round(loadedDistance, 1),
          emptyRate:
            totalDistance === 0
              ? null
              : round(((totalDistance - loadedDistance) / totalDistance) * 100, 1),
          avgOperatingMinutes:
            operated.length === 0
              ? null
              : Math.round(avg(operated.map((v) => v.operatingMinutes))),
          avgLoadingRate: rates.length === 0 ? null : round(avg(rates), 1),
          violationCount: drivers.filter((d) => d.isContinuousViolation || d.isRestViolation).length,
        },
      };
    });
  }

  // ===================================================================
  // KPI 읽기
  // ===================================================================

  async kpi(principal: AuthPrincipal, from: string, to: string): Promise<KpiBoard> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const gte = dateOnly(from);
      const lte = dateOnly(to);
      const days = Math.max(1, Math.round((lte.getTime() - gte.getTime()) / 86_400_000) + 1);
      // 앞 기간은 같은 길이로 잡는다. 7일을 30일과 비교하면 늘 나빠 보인다.
      const prevGte = new Date(gte.getTime() - days * 86_400_000);
      const prevLte = new Date(gte.getTime() - 86_400_000);

      const [totals, prevTotals, carrierRows, shipperRows, latestConfirm] = await Promise.all([
        tx.kpi_daily.findMany({
          where: { tenant_id, aggregate_level: 'TOTAL', kpi_date: { gte, lte } },
          orderBy: { kpi_date: 'asc' },
        }),
        tx.kpi_daily.findMany({
          where: { tenant_id, aggregate_level: 'TOTAL', kpi_date: { gte: prevGte, lte: prevLte } },
        }),
        tx.kpi_daily.findMany({
          where: { tenant_id, aggregate_level: 'CARRIER', kpi_date: { gte, lte } },
          include: {
            business_partner_kpi_daily_carrier_idTobusiness_partner: {
              select: { partner_name: true },
            },
          },
        }),
        tx.kpi_daily.findMany({
          where: { tenant_id, aggregate_level: 'SHIPPER', kpi_date: { gte, lte } },
          include: {
            business_partner_kpi_daily_shipper_idTobusiness_partner: {
              select: { partner_name: true },
            },
          },
        }),
        tx.transport_actual.findFirst({
          where: { tenant_id, actual_date: { gte, lte }, confirm_status: 'CONFIRMED' },
          orderBy: { confirmed_at: 'desc' },
          select: { confirmed_at: true },
        }),
      ]);

      const calculatedAt =
        totals.length === 0
          ? null
          : new Date(Math.max(...totals.map((t) => t.calculated_at.getTime())));

      const dateKeys = eachDate(gte, lte);
      const byDate = new Map(totals.map((t) => [isoDate(t.kpi_date), t]));
      const series = (pick: (row: KpiRow) => number | null): KpiSeriesPoint[] =>
        dateKeys.map((d) => {
          const row = byDate.get(d);
          return { date: d, value: row ? pick(row) : null };
        });

      const metrics: KpiMetric[] = [
        metric('onTime', '납품 정시율', '%', 'up-good', totals, prevTotals, onTimeRate, series((r) => onTimeRate([r])), '납품 정차가 시간창 안에 들어온 비율'),
        metric('pod', '인수증 완료율', '%', 'up-good', totals, prevTotals, podRate, series((r) => podRate([r])), '인수증이 붙은 오더 비율. 청구를 닫을 수 있는 비율이다'),
        metric('loading', '평균 적재율', '%', 'up-good', totals, prevTotals, loadingRate, series((r) => num(r.avg_loading_rate)), '차의 최대 적재중량 대비 실제로 실은 무게'),
        metric('empty', '공차율', '%', 'down-good', totals, prevTotals, emptyRate, series((r) => num(r.empty_rate)), '계기판 주행 중 실차 노선 밖으로 달린 비율'),
        metric('utilization', '차량 가동률', '%', 'up-good', totals, prevTotals, utilization, series((r) => num(r.vehicle_utilization_rate)), '보유 차량 중 그날 한 건이라도 운행한 비율'),
        metric('delay', '평균 지연', '분', 'down-good', totals, prevTotals, avgDelay, series((r) => num(r.avg_delay_minutes)), '계획 도착 대비 늦은 시간의 평균'),
        metric('margin', '마진율', '%', 'up-good', totals, prevTotals, marginRate, series((r) => num(r.margin_rate)), '(매출 − 매입) / 매출. 정산 확정 전에는 예상 운임 기준'),
        metric('costPerKm', 'km당 원가', '원', 'down-good', totals, prevTotals, costPerKm, series((r) => num(r.cost_per_km)), '매입 금액을 주행거리로 나눈 값'),
      ];

      const totalOnTime = onTimeRate(totals);
      const totalMargin = marginRate(totals);

      return {
        from,
        to,
        calculatedAt: iso(calculatedAt),
        // 마지막 확정이 마지막 집계보다 나중이면 숫자가 낡았다
        stale:
          latestConfirm?.confirmed_at != null &&
          calculatedAt != null &&
          latestConfirm.confirmed_at.getTime() > calculatedAt.getTime(),
        metrics,
        carriers: dimension(
          carrierRows,
          (r) => String(r.carrier_id),
          (r) => r.business_partner_kpi_daily_carrier_idTobusiness_partner?.partner_name ?? '—',
          totalOnTime,
          totalMargin,
        ),
        shippers: dimension(
          shipperRows,
          (r) => String(r.shipper_id),
          (r) => r.business_partner_kpi_daily_shipper_idTobusiness_partner?.partner_name ?? '—',
          totalOnTime,
          totalMargin,
        ),
        totals: {
          actualCount: sum(totals.map((t) => t.trip_count)),
          orderCount: sum(totals.map((t) => t.order_count)),
          distanceKm: round(sum(totals.map((t) => num(t.total_distance_km) ?? 0)), 1),
          weightKg: round(sum(totals.map((t) => num(t.total_weight_kg) ?? 0)), 0),
          billingAmount: sum(totals.map((t) => num(t.billing_amount) ?? 0)),
          paymentAmount: sum(totals.map((t) => num(t.payment_amount) ?? 0)),
          marginAmount: sum(totals.map((t) => num(t.margin_amount) ?? 0)),
        },
      };
    });
  }
}

// ---------------------------------------------------------------------
// KPI 계산
// ---------------------------------------------------------------------

type KpiRow = {
  kpi_date: Date;
  order_count: number;
  completed_count: number;
  trip_count: number;
  total_weight_kg: unknown;
  total_distance_km: unknown;
  on_time_delivery_count: number;
  on_time_rate: unknown;
  avg_delay_minutes: unknown;
  pod_completion_rate: unknown;
  avg_loading_rate: unknown;
  empty_rate: unknown;
  vehicle_operating_count: number;
  vehicle_total_count: number;
  vehicle_utilization_rate: unknown;
  exception_count: number;
  damage_count: number;
  billing_amount: unknown;
  payment_amount: unknown;
  margin_amount: unknown;
  margin_rate: unknown;
  cost_per_km: unknown;
  calculated_at: Date;
};

/*
  기간 값은 **비율의 평균이 아니라 구성요소의 합**에서 낸다.

  하루 1건 중 1건 정시(100%)와 하루 100건 중 60건 정시(60%)를 단순 평균하면
  80% 가 나오는데, 실제로는 101건 중 61건 — 60.4% 다. 지표가 한산한 날에
  끌려 올라가면 아무도 안 믿는다.
*/
function onTimeRate(rows: KpiRow[]): number | null {
  const done = sum(rows.map((r) => r.completed_count));
  if (done === 0) return null;
  return round((sum(rows.map((r) => r.on_time_delivery_count)) / done) * 100, 1);
}

function podRate(rows: KpiRow[]): number | null {
  return weighted(rows, (r) => num(r.pod_completion_rate), (r) => r.order_count);
}

function loadingRate(rows: KpiRow[]): number | null {
  return weighted(rows, (r) => num(r.avg_loading_rate), (r) => r.trip_count);
}

function emptyRate(rows: KpiRow[]): number | null {
  return weighted(rows, (r) => num(r.empty_rate), (r) => num(r.total_distance_km) ?? 0);
}

function utilization(rows: KpiRow[]): number | null {
  const total = sum(rows.map((r) => r.vehicle_total_count));
  if (total === 0) return null;
  return round((sum(rows.map((r) => r.vehicle_operating_count)) / total) * 100, 1);
}

function avgDelay(rows: KpiRow[]): number | null {
  return weighted(rows, (r) => num(r.avg_delay_minutes), (r) => r.completed_count);
}

function marginRate(rows: KpiRow[]): number | null {
  const billing = sum(rows.map((r) => num(r.billing_amount) ?? 0));
  if (billing === 0) return null;
  const payment = sum(rows.map((r) => num(r.payment_amount) ?? 0));
  return round(((billing - payment) / billing) * 100, 1);
}

function costPerKm(rows: KpiRow[]): number | null {
  const km = sum(rows.map((r) => num(r.total_distance_km) ?? 0));
  if (km === 0) return null;
  return Math.round(sum(rows.map((r) => num(r.payment_amount) ?? 0)) / km);
}

function weighted(
  rows: KpiRow[],
  value: (r: KpiRow) => number | null,
  weight: (r: KpiRow) => number,
): number | null {
  let num_ = 0;
  let den = 0;
  for (const r of rows) {
    const v = value(r);
    const w = weight(r);
    if (v === null || w <= 0) continue;
    num_ += v * w;
    den += w;
  }
  return den === 0 ? null : round(num_ / den, 1);
}

function metric(
  key: string,
  label: string,
  unit: string,
  direction: KpiDirection,
  rows: KpiRow[],
  prev: KpiRow[],
  reduce: (rows: KpiRow[]) => number | null,
  series: KpiSeriesPoint[],
  hint: string,
): KpiMetric {
  const value = reduce(rows);
  const previous = reduce(prev);
  const points = series.map((p) => p.value).filter((v): v is number => v !== null);

  return {
    key,
    label,
    unit,
    value,
    previous,
    delta: value !== null && previous !== null ? round(value - previous, 1) : null,
    direction,
    series,
    average: points.length === 0 ? null : round(avg(points), 1),
    hint,
  };
}

/**
 * 차원별 비교.
 *
 * 순위표를 만들지 않는다 — 1등과 꼴등만 보이고 가운데가 안 읽힌다.
 * 대신 **전체 평균 0선에서 얼마나 벗어났는지**로 세운다. 실적 상세의 편차
 * 축과 같은 어휘라, 두 화면이 같은 방식으로 읽힌다.
 */
function dimension<T extends KpiRow>(
  rows: T[],
  idOf: (r: T) => string,
  nameOf: (r: T) => string,
  baselineOnTime: number | null,
  baselineMargin: number | null,
): KpiDimensionRow[] {
  const out: KpiDimensionRow[] = [];

  for (const [id, group] of groupBy(rows, idOf)) {
    const onTime = onTimeRate(group);
    const margin = marginRate(group);
    out.push({
      id,
      name: nameOf(group[0]!),
      count: sum(group.map((r) => r.trip_count)),
      onTimeRate: onTime,
      onTimeDelta:
        onTime !== null && baselineOnTime !== null ? round(onTime - baselineOnTime, 1) : null,
      avgDelayMinutes: avgDelay(group),
      exceptionCount: sum(group.map((r) => r.exception_count)),
      damageCount: sum(group.map((r) => r.damage_count)),
      distanceKm: round(sum(group.map((r) => num(r.total_distance_km) ?? 0)), 1),
      billingAmount: sum(group.map((r) => num(r.billing_amount) ?? 0)),
      paymentAmount: sum(group.map((r) => num(r.payment_amount) ?? 0)),
      marginRate: margin,
      marginDelta:
        margin !== null && baselineMargin !== null ? round(margin - baselineMargin, 1) : null,
    });
  }

  // 물량이 많은 쪽이 위. 평균에서 벗어난 정도는 막대가 알려 주므로 정렬까지
  // 그걸로 하면 한 건짜리 운송사가 맨 위에 온다.
  return out.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function eachDate(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** 하나라도 값이 있으면 합, 전부 없으면 null. 0 과 '모름' 을 안 섞는다 */
function sumOrNull(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : sum(known);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateOnly(input: string): Date {
  return new Date(`${input}T00:00:00Z`);
}
