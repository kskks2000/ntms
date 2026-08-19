import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  toPageResult,
  type DriverListItem,
  type LocationListItem,
  type MasterListMeta,
  type PageResult,
  type PartnerListItem,
  type PartnerRole,
  type RouteListItem,
  type TariffListItem,
  type Validity,
  type VehicleListItem,
  type ZoneSummary,
} from '@ntms/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

export interface MasterQuery {
  page: number;
  size: number;
  keyword?: string;
  /** 화면마다 뜻이 다른 단일 필터 (역할 · 상태 · 권역 · 매출/매입 …) */
  filter?: string;
}

export type MasterResult<T> = PageResult<T> & { meta2: MasterListMeta };

/** 만료 임박으로 보는 기준. 보험·면허·운임 모두 같은 잣대를 쓴다 */
const SOON_DAYS = 60;

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // -------------------------------------------------------------------
  // 거래처 — 화주 · 운송사 · 수하처가 한 테이블이다
  // -------------------------------------------------------------------

  async partners(
    principal: AuthPrincipal,
    query: MasterQuery,
  ): Promise<MasterResult<PartnerListItem>> {
    const role = (query.filter ?? '') as PartnerRole | '';

    return this.run(principal, async (tx) => {
      const where = {
        tenant_id: principal.tenantId,
        deleted_at: null,
        ...(role === 'SHIPPER' ? { is_shipper: true } : {}),
        ...(role === 'CARRIER' ? { is_carrier: true } : {}),
        ...(role === 'CONSIGNEE' ? { is_consignee: true } : {}),
        ...(role === 'VENDOR' ? { is_vendor: true } : {}),
        ...(query.keyword
          ? {
              OR: [
                { partner_code: { contains: query.keyword, mode: 'insensitive' as const } },
                { partner_name: { contains: query.keyword, mode: 'insensitive' as const } },
                { business_no: { contains: query.keyword } },
              ],
            }
          : {}),
      };

      const [rows, total, activeCount] = await Promise.all([
        tx.business_partner.findMany({
          where,
          orderBy: { partner_code: 'asc' },
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.business_partner.count({ where }),
        tx.business_partner.count({ where: { ...where, is_active: true } }),
      ]);

      const ids = rows.map((r) => r.partner_id);
      const items = await this.decoratePartners(tx, principal.tenantId, rows, ids, role);

      return {
        ...toPageResult(items, total, query.page, query.size),
        meta2: {
          total,
          activeCount,
          ...partnerAttention(role, items, total, activeCount),
        },
      };
    });
  }

  /**
   * 역할별로 붙이는 숫자가 다르다.
   *   화주    이번 달 얼마나 맡겼나
   *   운송사  차를 몇 대 대고, 배정 요청에 얼마나 응했나
   *
   * 목록마다 다른 질문에 답해야 하므로 한 벌의 컬럼으로 뭉뚱그리지 않는다.
   */
  private async decoratePartners(
    tx: TxClient,
    tenantId: bigint,
    rows: Array<Record<string, unknown>>,
    ids: bigint[],
    role: string,
  ): Promise<PartnerListItem[]> {
    const base = (r: Record<string, unknown>): PartnerListItem => {
      const roles: PartnerRole[] = [];
      if (r.is_shipper) roles.push('SHIPPER');
      if (r.is_carrier) roles.push('CARRIER');
      if (r.is_consignee) roles.push('CONSIGNEE');
      if (r.is_vendor) roles.push('VENDOR');

      return {
        partnerId: String(r.partner_id),
        partnerCode: r.partner_code as string,
        partnerName: r.partner_name as string,
        roles,
        businessNo: (r.business_no as string) ?? null,
        grade: (r.grade as string) ?? null,
        ceoName: (r.ceo_name as string) ?? null,
        tel: (r.tel as string) ?? null,
        managerName: (r.manager_name as string) ?? null,
        managerTel: (r.manager_tel as string) ?? null,
        settlementCycle: (r.settlement_cycle as string) ?? null,
        closingDay: (r.closing_day as number) ?? null,
        paymentTermsDays: (r.payment_terms_days as number) ?? null,
        creditLimit: r.credit_limit === null ? null : Number(r.credit_limit),
        isActive: Boolean(r.is_active),
      };
    };

    const items = rows.map(base);
    if (ids.length === 0) return items;

    if (role === 'SHIPPER') {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const agg = await tx.transport_order.groupBy({
        by: ['shipper_id'],
        where: {
          tenant_id: tenantId,
          deleted_at: null,
          shipper_id: { in: ids },
          order_date: { gte: monthStart },
        },
        _count: { _all: true },
        _sum: { total_weight_kg: true },
      });
      const map = new Map(
        agg.map((a) => [
          a.shipper_id.toString(),
          { count: a._count._all, weight: Number(a._sum.total_weight_kg ?? 0) },
        ]),
      );
      for (const it of items) {
        const v = map.get(it.partnerId);
        it.orderCount = v?.count ?? 0;
        it.orderWeightKg = v?.weight ?? 0;
      }
      return items;
    }

    if (role === 'CARRIER') {
      const [vehicles, drivers, allocations] = await Promise.all([
        tx.vehicle.groupBy({
          by: ['carrier_id'],
          where: { tenant_id: tenantId, deleted_at: null, carrier_id: { in: ids } },
          _count: { _all: true },
        }),
        tx.driver.groupBy({
          by: ['carrier_id'],
          where: { tenant_id: tenantId, deleted_at: null, carrier_id: { in: ids } },
          _count: { _all: true },
        }),
        tx.allocation.groupBy({
          by: ['carrier_id', 'status'],
          where: { tenant_id: tenantId, carrier_id: { in: ids } },
          _count: { _all: true },
        }),
      ]);

      const vMap = new Map(vehicles.map((v) => [String(v.carrier_id), v._count._all]));
      const dMap = new Map(drivers.map((d) => [String(d.carrier_id), d._count._all]));

      const accepted = new Map<string, number>();
      const requested = new Map<string, number>();
      for (const a of allocations) {
        const key = a.carrier_id.toString();
        requested.set(key, (requested.get(key) ?? 0) + a._count._all);
        if (a.status === 'ACCEPTED') {
          accepted.set(key, (accepted.get(key) ?? 0) + a._count._all);
        }
      }

      for (const it of items) {
        it.vehicleCount = vMap.get(it.partnerId) ?? 0;
        it.driverCount = dMap.get(it.partnerId) ?? 0;
        const req = requested.get(it.partnerId) ?? 0;
        it.acceptRate =
          req === 0
            ? null
            : Number((((accepted.get(it.partnerId) ?? 0) / req) * 100).toFixed(1));
      }
      return items;
    }

    return items;
  }

  // -------------------------------------------------------------------
  // 차량 — 배차를 막는 것은 스펙이 아니라 만료다
  // -------------------------------------------------------------------

  async vehicles(
    principal: AuthPrincipal,
    query: MasterQuery,
  ): Promise<MasterResult<VehicleListItem>> {
    return this.run(principal, async (tx) => {
      const where = {
        tenant_id: principal.tenantId,
        deleted_at: null,
        ...(query.filter ? { status: query.filter as never } : {}),
        ...(query.keyword
          ? {
              OR: [
                { vehicle_no: { contains: query.keyword, mode: 'insensitive' as const } },
                {
                  business_partner: {
                    partner_name: { contains: query.keyword, mode: 'insensitive' as const },
                  },
                },
              ],
            }
          : {}),
      };

      const [rows, total, activeCount] = await Promise.all([
        tx.vehicle.findMany({
          where,
          include: {
            vehicle_type: true,
            business_partner: { select: { partner_name: true } },
            driver_vehicle_default_driver_idTodriver: { select: { driver_name: true } },
            location: { select: { location_name: true } },
          },
          orderBy: [{ vehicle_type_id: 'desc' }, { vehicle_no: 'asc' }],
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.vehicle.count({ where }),
        tx.vehicle.count({ where: { ...where, is_active: true } }),
      ]);

      const soon = new Date();
      soon.setDate(soon.getDate() + SOON_DAYS);
      const attentionCount = await tx.vehicle.count({
        where: {
          ...where,
          OR: [
            { insurance_expire_date: { lte: soon } },
            { next_inspection_date: { lte: soon } },
          ],
        },
      });

      const items: VehicleListItem[] = rows.map((v) => ({
        vehicleId: v.vehicle_id.toString(),
        vehicleNo: v.vehicle_no,
        vehicleTypeName: v.vehicle_type.vehicle_type_name,
        bodyType: v.vehicle_type.body_type,
        tonClass: v.vehicle_type.ton_class === null ? null : Number(v.vehicle_type.ton_class),
        maxWeightKg: v.max_weight_kg === null ? null : Number(v.max_weight_kg),
        maxPalletQty: v.max_pallet_qty,
        ownershipType: v.ownership_type,
        carrierName: v.business_partner?.partner_name ?? null,
        defaultDriverName:
          v.driver_vehicle_default_driver_idTodriver?.driver_name ?? null,
        baseLocationName: v.location?.location_name ?? null,
        status: v.status,
        odometerKm: v.current_odometer === null ? null : Number(v.current_odometer),
        insurance: toValidity(v.insurance_expire_date),
        inspection: toValidity(v.next_inspection_date),
        isActive: v.is_active,
      }));

      return {
        ...toPageResult(items, total, query.page, query.size),
        meta2: { total, activeCount, attentionCount, attentionLabel: '만료 임박·경과' },
      };
    });
  }

  // -------------------------------------------------------------------
  // 기사
  // -------------------------------------------------------------------

  async drivers(
    principal: AuthPrincipal,
    query: MasterQuery,
  ): Promise<MasterResult<DriverListItem>> {
    return this.run(principal, async (tx) => {
      const where = {
        tenant_id: principal.tenantId,
        deleted_at: null,
        ...(query.filter ? { status: query.filter as never } : {}),
        ...(query.keyword
          ? {
              OR: [
                { driver_name: { contains: query.keyword, mode: 'insensitive' as const } },
                { driver_code: { contains: query.keyword, mode: 'insensitive' as const } },
                { mobile: { contains: query.keyword } },
              ],
            }
          : {}),
      };

      const soon = new Date();
      soon.setDate(soon.getDate() + SOON_DAYS);

      const [rows, total, activeCount, attentionCount] = await Promise.all([
        tx.driver.findMany({
          where,
          include: { business_partner: { select: { partner_name: true } } },
          orderBy: { driver_code: 'asc' },
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.driver.count({ where }),
        tx.driver.count({ where: { ...where, is_active: true } }),
        tx.driver.count({
          where: {
            ...where,
            OR: [
              { license_expire_date: { lte: soon } },
              { cargo_qualification_expire_date: { lte: soon } },
            ],
          },
        }),
      ]);

      const items: DriverListItem[] = rows.map((d) => ({
        driverId: d.driver_id.toString(),
        driverCode: d.driver_code,
        driverName: d.driver_name,
        carrierName: d.business_partner?.partner_name ?? null,
        mobile: d.mobile,
        licenseType: d.license_type,
        license: toValidity(d.license_expire_date),
        cargoQualification: toValidity(d.cargo_qualification_expire_date),
        hireDate: toDateString(d.hire_date),
        onTimeRate: d.on_time_rate === null ? null : Number(d.on_time_rate),
        evaluationScore: d.evaluation_score === null ? null : Number(d.evaluation_score),
        accidentCount: d.accident_count,
        status: d.status,
        isActive: d.is_active,
      }));

      return {
        ...toPageResult(items, total, query.page, query.size),
        meta2: { total, activeCount, attentionCount, attentionLabel: '자격 만료 임박' },
      };
    });
  }

  // -------------------------------------------------------------------
  // 상하차지 · 권역
  // -------------------------------------------------------------------

  async locations(
    principal: AuthPrincipal,
    query: MasterQuery,
  ): Promise<MasterResult<LocationListItem> & { zones: ZoneSummary[] }> {
    return this.run(principal, async (tx) => {
      const where = {
        tenant_id: principal.tenantId,
        deleted_at: null,
        ...(query.filter ? { zone_id: BigInt(query.filter) } : {}),
        ...(query.keyword
          ? {
              OR: [
                { location_name: { contains: query.keyword, mode: 'insensitive' as const } },
                { location_code: { contains: query.keyword, mode: 'insensitive' as const } },
                { address1: { contains: query.keyword, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [rows, total, activeCount, unverified, zones] = await Promise.all([
        tx.location.findMany({
          where,
          include: { zone: { select: { zone_name: true } } },
          orderBy: { location_code: 'asc' },
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.location.count({ where }),
        tx.location.count({ where: { ...where, is_active: true } }),
        tx.location.count({ where: { ...where, geo_verified: false } }),
        tx.zone.findMany({
          where: { tenant_id: principal.tenantId, is_active: true },
          include: { _count: { select: { location: true } } },
          orderBy: { sort_order: 'asc' },
        }),
      ]);

      // 이 거점을 드나드는 오더 수. 상차와 하차를 함께 센다 —
      // 어느 쪽이든 그 거점의 부하다.
      const ids = rows.map((r) => r.location_id);
      const [fromAgg, toAgg] = await Promise.all([
        tx.transport_order.groupBy({
          by: ['from_location_id'],
          where: {
            tenant_id: principal.tenantId,
            deleted_at: null,
            from_location_id: { in: ids },
          },
          _count: { _all: true },
        }),
        tx.transport_order.groupBy({
          by: ['to_location_id'],
          where: {
            tenant_id: principal.tenantId,
            deleted_at: null,
            to_location_id: { in: ids },
          },
          _count: { _all: true },
        }),
      ]);
      // 두 groupBy 의 결과 타입이 서로 달라 합쳐서 순회할 수 없다.
      // 각각 돌면서 같은 Map 에 더한다.
      const orderCount = new Map<string, number>();
      const bump = (id: bigint | null, n: number) => {
        if (id === null) return;
        const key = id.toString();
        orderCount.set(key, (orderCount.get(key) ?? 0) + n);
      };
      for (const a of fromAgg) bump(a.from_location_id, a._count._all);
      for (const a of toAgg) bump(a.to_location_id, a._count._all);

      const items: LocationListItem[] = rows.map((l) => ({
        locationId: l.location_id.toString(),
        locationCode: l.location_code,
        locationName: l.location_name,
        locationType: l.location_type,
        zoneName: l.zone?.zone_name ?? null,
        address: [l.address1, l.address2].filter(Boolean).join(' '),
        openTime: toClock(l.open_time),
        closeTime: toClock(l.close_time),
        dockCount: l.dock_count,
        standardLoadMin: l.standard_load_min,
        standardUnloadMin: l.standard_unload_min,
        hasForklift: l.has_forklift,
        requireReservation: l.require_reservation,
        geoVerified: l.geo_verified,
        orderCount: orderCount.get(l.location_id.toString()) ?? 0,
        isActive: l.is_active,
      }));

      return {
        ...toPageResult(items, total, query.page, query.size),
        meta2: {
          total,
          activeCount,
          attentionCount: unverified,
          attentionLabel: '좌표 미검증',
        },
        zones: zones.map((z) => ({
          zoneId: z.zone_id.toString(),
          zoneCode: z.zone_code,
          zoneName: z.zone_name,
          locationCount: z._count.location,
        })),
      };
    });
  }

  // -------------------------------------------------------------------
  // 라우트 (구간거리)
  // -------------------------------------------------------------------

  async routes(
    principal: AuthPrincipal,
    query: MasterQuery,
  ): Promise<MasterResult<RouteListItem>> {
    return this.run(principal, async (tx) => {
      const where = {
        tenant_id: principal.tenantId,
        ...(query.keyword
          ? {
              OR: [
                {
                  location_distance_master_from_location_idTolocation: {
                    location_name: {
                      contains: query.keyword,
                      mode: 'insensitive' as const,
                    },
                  },
                },
                {
                  location_distance_master_to_location_idTolocation: {
                    location_name: {
                      contains: query.keyword,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
      };

      const [rows, total, activeCount, all] = await Promise.all([
        tx.distance_master.findMany({
          where,
          include: {
            location_distance_master_from_location_idTolocation: {
              select: { location_name: true },
            },
            location_distance_master_to_location_idTolocation: {
              select: { location_name: true },
            },
          },
          orderBy: { distance_km: 'desc' },
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.distance_master.count({ where }),
        tx.distance_master.count({ where: { ...where, is_active: true } }),
        // 왕복 등록 여부를 보려면 전체 쌍이 필요하다. 구간 마스터는
        // 수천 건 규모라 통째로 읽어도 부담이 없다.
        tx.distance_master.findMany({
          where: { tenant_id: principal.tenantId },
          select: { from_location_id: true, to_location_id: true },
        }),
      ]);

      const pairs = new Set(
        all.map((a) => `${a.from_location_id.toString()}>${a.to_location_id.toString()}`),
      );

      const items: RouteListItem[] = rows.map((r) => {
        const km = Number(r.distance_km);
        const min = r.duration_minutes;
        return {
          distanceId: r.distance_id.toString(),
          fromName:
            r.location_distance_master_from_location_idTolocation.location_name,
          toName: r.location_distance_master_to_location_idTolocation.location_name,
          routeType: r.route_type,
          distanceKm: km,
          durationMinutes: min,
          tollFee: r.toll_fee === null ? null : Number(r.toll_fee),
          avgSpeedKmh: min && min > 0 ? Number(((km / min) * 60).toFixed(1)) : null,
          source: r.source,
          lastVerifiedAt: r.last_verified_at?.toISOString() ?? null,
          hasReverse: pairs.has(
            `${r.to_location_id.toString()}>${r.from_location_id.toString()}`,
          ),
          isActive: r.is_active,
        };
      });

      const oneWay = items.filter((i) => !i.hasReverse).length;

      return {
        ...toPageResult(items, total, query.page, query.size),
        meta2: {
          total,
          activeCount,
          attentionCount: oneWay,
          attentionLabel: '편도만 등록',
        },
      };
    });
  }

  // -------------------------------------------------------------------
  // 단가 (운임표)
  // -------------------------------------------------------------------

  async tariffs(
    principal: AuthPrincipal,
    query: MasterQuery,
  ): Promise<MasterResult<TariffListItem>> {
    return this.run(principal, async (tx) => {
      const where = {
        tenant_id: principal.tenantId,
        deleted_at: null,
        ...(query.filter ? { rate_target: query.filter as never } : {}),
        ...(query.keyword
          ? {
              OR: [
                {
                  rate_table_name: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  rate_table_code: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      };

      const soon = new Date();
      soon.setDate(soon.getDate() + SOON_DAYS);

      const [rows, total, activeCount, attentionCount] = await Promise.all([
        tx.rate_table.findMany({
          where,
          include: {
            business_partner: { select: { partner_name: true } },
            _count: { select: { rate_table_detail: true } },
          },
          orderBy: [{ rate_target: 'asc' }, { rate_table_code: 'asc' }],
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        tx.rate_table.count({ where }),
        tx.rate_table.count({ where: { ...where, is_active: true } }),
        tx.rate_table.count({
          where: { ...where, apply_end_date: { not: null, lte: soon } },
        }),
      ]);

      const items: TariffListItem[] = rows.map((t) => ({
        rateTableId: t.rate_table_id.toString(),
        rateTableCode: t.rate_table_code,
        rateTableName: t.rate_table_name,
        rateTarget: t.rate_target,
        rateMethod: t.rate_method,
        partnerName: t.business_partner?.partner_name ?? null,
        applyStartDate: toDateString(t.apply_start_date) ?? '',
        apply: toValidity(t.apply_end_date),
        minChargeAmount:
          t.min_charge_amount === null ? null : Number(t.min_charge_amount),
        applyFuelSurcharge: t.apply_fuel_surcharge,
        isTaxable: t.is_taxable,
        status: t.status,
        versionNo: t.version_no,
        detailCount: t._count.rate_table_detail,
        isActive: t.is_active,
      }));

      return {
        ...toPageResult(items, total, query.page, query.size),
        meta2: {
          total,
          activeCount,
          attentionCount,
          attentionLabel: '적용기간 만료 임박',
        },
      };
    });
  }
}

// ---------------------------------------------------------------------

/**
 * 거래처 목록의 세 번째 숫자.
 *
 * "사용중 N건 (사용중지 M건)" 옆에 다시 "사용중지 M건" 을 세우면 같은 말을
 * 두 번 하는 것이다. 역할마다 실제로 손이 가는 것이 다르므로 그것을 센다 —
 * 화주는 이번 달 물량이 끊긴 곳, 운송사는 배정을 자주 반려하는 곳.
 *
 * 이 두 숫자는 지금 페이지 안에서만 셀 수 있다(집계가 페이지 단위로 붙는다).
 * 라벨에 "이 쪽" 을 넣어 전체 건수와 헷갈리지 않게 한다.
 */
function partnerAttention(
  role: string,
  items: PartnerListItem[],
  total: number,
  activeCount: number,
): { attentionCount: number; attentionLabel: string } {
  if (role === 'SHIPPER') {
    return {
      attentionCount: items.filter((p) => (p.orderCount ?? 0) === 0).length,
      attentionLabel: '이 쪽 이번 달 물량 없음',
    };
  }
  if (role === 'CARRIER') {
    return {
      attentionCount: items.filter(
        (p) => p.acceptRate !== null && p.acceptRate !== undefined && p.acceptRate < 80,
      ).length,
      attentionLabel: '이 쪽 수락률 80% 미만',
    };
  }
  return { attentionCount: total - activeCount, attentionLabel: '사용중지' };
}

function toValidity(d: Date | null): Validity {
  if (!d) return { until: null, daysLeft: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return {
    until: toDateString(d),
    daysLeft: Math.round((target.getTime() - today.getTime()) / 86_400_000),
  };
}

function toDateString(d: Date | null): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `time without time zone` 은 1970-01-01 기준 UTC Date 로 온다 */
function toClock(d: Date | null): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
