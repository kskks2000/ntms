import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import type {
  DriverFormValues,
  LocationFormValues,
  MasterOptions,
  PartnerFormValues,
  RateDetailBulkValues,
  RateDetailPage,
  RateDetailValues,
  RefOption,
  RouteFormValues,
  TariffFormValues,
  VehicleFormValues,
  ZoneFormValues,
} from '@ntms/shared';
import { axesOf } from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';

/**
 * 기준정보 쓰기.
 *
 * 읽기(MasterService)와 파일을 나눈 이유는 두 쪽이 하는 일이 다르기 때문이다.
 * 읽기는 여러 테이블을 모아 화면 한 장을 만들고, 쓰기는 한 행을 정확히
 * 바꾼다. 한 파일에 두면 목록용 집계 헬퍼와 저장용 매핑이 섞여, 어느 쪽을
 * 고쳐도 다른 쪽을 다시 읽어야 한다.
 *
 * 저장에서 반드시 지키는 것 둘:
 *
 * 1. **코드 중복은 DB 가 아니라 여기서 잡는다.** ux_partner_code 같은 부분
 *    유니크 인덱스에 걸리면 Prisma 가 P2002 를 던지는데, 그대로 500 으로
 *    나가면 화면은 "코드가 이미 있다" 를 말할 수 없다. 미리 세어 보고
 *    필드 오류로 돌려준다.
 *
 * 2. **참조 키는 테넌트 안에 있는지 확인한다.** RLS 가 읽기를 막아 주지만
 *    쓰기에서 남의 테넌트 id 를 넣으면 FK 는 통과한다(FK 에는 tenant_id 가
 *    없다). 그래서 넘어온 id 를 우리 테넌트에서 다시 찾아 본다.
 */
@Injectable()
export class MasterWriteService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // -------------------------------------------------------------------
  // 선택 목록 — 폼이 쓰는 참조 데이터를 한 번에
  // -------------------------------------------------------------------

  async options(principal: AuthPrincipal): Promise<MasterOptions> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const [vehicleTypes, partners, drivers, locations, zones] = await Promise.all([
        tx.vehicle_type.findMany({
          where: { tenant_id, is_active: true },
          orderBy: { sort_order: 'asc' },
          select: { vehicle_type_id: true, vehicle_type_code: true, vehicle_type_name: true },
        }),
        tx.business_partner.findMany({
          where: { tenant_id, deleted_at: null, is_active: true },
          orderBy: { partner_code: 'asc' },
          select: {
            partner_id: true,
            partner_code: true,
            partner_name: true,
            is_shipper: true,
            is_carrier: true,
          },
        }),
        tx.driver.findMany({
          // 퇴사·정지 기사를 기본 기사로 붙일 수는 없다
          where: { tenant_id, deleted_at: null, is_active: true, status: 'ACTIVE' },
          orderBy: { driver_code: 'asc' },
          select: {
            driver_id: true,
            driver_code: true,
            driver_name: true,
            business_partner: { select: { partner_name: true } },
          },
        }),
        tx.location.findMany({
          where: { tenant_id, deleted_at: null, is_active: true },
          orderBy: { location_code: 'asc' },
          select: {
            location_id: true,
            location_code: true,
            location_name: true,
            zone: { select: { zone_name: true } },
          },
        }),
        tx.zone.findMany({
          where: { tenant_id, is_active: true },
          orderBy: { sort_order: 'asc' },
          select: { zone_id: true, zone_code: true, zone_name: true },
        }),
      ]);

      return {
        vehicleTypes: vehicleTypes.map((v) => ({
          id: String(v.vehicle_type_id),
          code: v.vehicle_type_code,
          name: v.vehicle_type_name,
        })),
        carriers: partners.filter((p) => p.is_carrier).map(toPartnerOption),
        shippers: partners.filter((p) => p.is_shipper).map(toPartnerOption),
        partners: partners.map(toPartnerOption),
        drivers: drivers.map((d) => ({
          id: String(d.driver_id),
          code: d.driver_code,
          name: d.driver_name,
          group: d.business_partner?.partner_name ?? null,
        })),
        locations: locations.map((l) => ({
          id: String(l.location_id),
          code: l.location_code,
          name: l.location_name,
          group: l.zone?.zone_name ?? null,
        })),
        zones: zones.map((z) => ({
          id: String(z.zone_id),
          code: z.zone_code,
          name: z.zone_name,
        })),
      };
    });
  }

  // -------------------------------------------------------------------
  // 거래처
  // -------------------------------------------------------------------

  async partnerDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.business_partner.findFirst({
          where: { tenant_id: principal.tenantId, partner_id: toId(id), deleted_at: null },
        }),
        '거래처',
      );
      return {
        id: String(r.partner_id),
        partnerCode: r.partner_code,
        partnerName: r.partner_name,
        isShipper: r.is_shipper,
        isCarrier: r.is_carrier,
        isConsignee: r.is_consignee,
        isVendor: r.is_vendor,
        businessNo: r.business_no,
        ceoName: r.ceo_name,
        grade: r.grade as PartnerFormValues['grade'],
        tel: r.tel,
        email: r.email,
        address1: r.address1,
        managerName: r.manager_name,
        managerTel: r.manager_tel,
        settlementCycle: (r.settlement_cycle ??
          'MONTHLY') as PartnerFormValues['settlementCycle'],
        closingDay: r.closing_day,
        paymentTermsDays: r.payment_terms_days,
        creditLimit: num(r.credit_limit),
        remark: r.remark,
        isActive: r.is_active,
      };
    });
  }

  async savePartner(principal: AuthPrincipal, id: string | null, v: PartnerFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      await assertCodeFree(
        tx.business_partner.findFirst({
          where: {
            tenant_id,
            partner_code: v.partnerCode,
            deleted_at: null,
            ...notSelf('partner_id', id),
          },
          select: { partner_id: true },
        }),
        'partnerCode',
        '이미 쓰고 있는 거래처 코드입니다',
      );

      const data = {
        partner_code: v.partnerCode,
        partner_name: v.partnerName,
        is_shipper: v.isShipper,
        is_carrier: v.isCarrier,
        is_consignee: v.isConsignee,
        is_vendor: v.isVendor,
        business_no: v.businessNo,
        ceo_name: v.ceoName,
        grade: v.grade,
        tel: v.tel,
        email: v.email,
        address1: v.address1,
        manager_name: v.managerName,
        manager_tel: v.managerTel,
        settlement_cycle: v.settlementCycle,
        closing_day: v.closingDay,
        payment_terms_days: v.paymentTermsDays,
        credit_limit: v.creditLimit,
        remark: v.remark,
        is_active: v.isActive,
      };

      const row = id
        ? await tx.business_partner.update({
            where: { partner_id: await ownedId(tx, principal, 'partner', id) },
            data,
          })
        : await tx.business_partner.create({ data: { tenant_id, ...data } });

      return { id: String(row.partner_id) };
    });
  }

  // -------------------------------------------------------------------
  // 차량
  // -------------------------------------------------------------------

  async vehicleDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.vehicle.findFirst({
          where: { tenant_id: principal.tenantId, vehicle_id: toId(id), deleted_at: null },
        }),
        '차량',
      );
      return {
        id: String(r.vehicle_id),
        vehicleNo: r.vehicle_no,
        vehicleTypeId: String(r.vehicle_type_id),
        ownershipType: r.ownership_type as VehicleFormValues['ownershipType'],
        carrierId: idOrNull(r.carrier_id),
        defaultDriverId: idOrNull(r.default_driver_id),
        baseLocationId: idOrNull(r.base_location_id),
        status: r.status as VehicleFormValues['status'],
        insuranceCompany: r.insurance_company,
        insurancePolicyNo: r.insurance_policy_no,
        insuranceExpireDate: dateStr(r.insurance_expire_date),
        inspectionDate: dateStr(r.inspection_date),
        nextInspectionDate: dateStr(r.next_inspection_date),
        odometerKm: num(r.current_odometer),
        remark: r.remark,
        isActive: r.is_active,
      };
    });
  }

  async saveVehicle(principal: AuthPrincipal, id: string | null, v: VehicleFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      await assertCodeFree(
        tx.vehicle.findFirst({
          where: {
            tenant_id,
            vehicle_no: v.vehicleNo,
            deleted_at: null,
            ...notSelf('vehicle_id', id),
          },
          select: { vehicle_id: true },
        }),
        'vehicleNo',
        '이미 등록된 차량번호입니다',
      );

      const data = {
        vehicle_no: v.vehicleNo,
        vehicle_type_id: await ownedId(tx, principal, 'vehicleType', v.vehicleTypeId),
        ownership_type: v.ownershipType,
        carrier_id: await ownedIdOrNull(tx, principal, 'partner', v.carrierId),
        default_driver_id: await ownedIdOrNull(tx, principal, 'driver', v.defaultDriverId),
        base_location_id: await ownedIdOrNull(tx, principal, 'location', v.baseLocationId),
        status: v.status,
        insurance_company: v.insuranceCompany,
        insurance_policy_no: v.insurancePolicyNo,
        insurance_expire_date: toDate(v.insuranceExpireDate),
        inspection_date: toDate(v.inspectionDate),
        next_inspection_date: toDate(v.nextInspectionDate),
        current_odometer: v.odometerKm,
        remark: v.remark,
        is_active: v.isActive,
      };

      const row = id
        ? await tx.vehicle.update({
            where: { vehicle_id: await ownedId(tx, principal, 'vehicle', id) },
            data,
          })
        : await tx.vehicle.create({ data: { tenant_id, ...data } });

      return { id: String(row.vehicle_id) };
    });
  }

  // -------------------------------------------------------------------
  // 기사
  // -------------------------------------------------------------------

  async driverDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.driver.findFirst({
          where: { tenant_id: principal.tenantId, driver_id: toId(id), deleted_at: null },
        }),
        '기사',
      );
      return {
        id: String(r.driver_id),
        driverCode: r.driver_code,
        driverName: r.driver_name,
        carrierId: idOrNull(r.carrier_id),
        mobile: r.mobile,
        licenseNo: r.license_no,
        licenseType: r.license_type,
        licenseExpireDate: dateStr(r.license_expire_date),
        cargoQualificationNo: r.cargo_qualification_no,
        cargoQualificationExpireDate: dateStr(r.cargo_qualification_expire_date),
        hireDate: dateStr(r.hire_date),
        status: r.status as DriverFormValues['status'],
        remark: r.remark,
        isActive: r.is_active,
      };
    });
  }

  async saveDriver(principal: AuthPrincipal, id: string | null, v: DriverFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      await assertCodeFree(
        tx.driver.findFirst({
          where: {
            tenant_id,
            driver_code: v.driverCode,
            deleted_at: null,
            ...notSelf('driver_id', id),
          },
          select: { driver_id: true },
        }),
        'driverCode',
        '이미 쓰고 있는 기사 코드입니다',
      );

      const data = {
        driver_code: v.driverCode,
        driver_name: v.driverName,
        carrier_id: await ownedIdOrNull(tx, principal, 'partner', v.carrierId),
        mobile: v.mobile,
        license_no: v.licenseNo,
        license_type: v.licenseType,
        license_expire_date: toDate(v.licenseExpireDate),
        cargo_qualification_no: v.cargoQualificationNo,
        cargo_qualification_expire_date: toDate(v.cargoQualificationExpireDate),
        hire_date: toDate(v.hireDate),
        status: v.status,
        remark: v.remark,
        // 재직이 아닌 기사는 배차 후보에서 빠져야 한다. 상태와 사용여부가
        // 어긋나면 목록에서는 퇴사인데 배차 화면에는 뜨는 상태가 된다.
        is_active: v.status === 'ACTIVE' ? v.isActive : false,
      };

      const row = id
        ? await tx.driver.update({
            where: { driver_id: await ownedId(tx, principal, 'driver', id) },
            data,
          })
        : await tx.driver.create({ data: { tenant_id, ...data } });

      return { id: String(row.driver_id) };
    });
  }

  // -------------------------------------------------------------------
  // 상하차지
  // -------------------------------------------------------------------

  async locationDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.location.findFirst({
          where: { tenant_id: principal.tenantId, location_id: toId(id), deleted_at: null },
        }),
        '거점',
      );
      return {
        id: String(r.location_id),
        locationCode: r.location_code,
        locationName: r.location_name,
        locationType: r.location_type as LocationFormValues['locationType'],
        zoneId: idOrNull(r.zone_id),
        partnerId: idOrNull(r.partner_id),
        address1: r.address1 ?? '',
        address2: r.address2,
        latitude: num(r.latitude),
        longitude: num(r.longitude),
        geoVerified: r.geo_verified,
        tel: r.tel,
        managerName: r.manager_name,
        openTime: clockStr(r.open_time),
        closeTime: clockStr(r.close_time),
        standardLoadMin: r.standard_load_min,
        standardUnloadMin: r.standard_unload_min,
        dockCount: r.dock_count,
        hasForklift: r.has_forklift,
        requireReservation: r.require_reservation,
        isPickupAvailable: r.is_pickup_available,
        isDeliveryAvailable: r.is_delivery_available,
        remark: r.remark,
        isActive: r.is_active,
      };
    });
  }

  async saveLocation(principal: AuthPrincipal, id: string | null, v: LocationFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      await assertCodeFree(
        tx.location.findFirst({
          where: {
            tenant_id,
            location_code: v.locationCode,
            deleted_at: null,
            ...notSelf('location_id', id),
          },
          select: { location_id: true },
        }),
        'locationCode',
        '이미 쓰고 있는 거점 코드입니다',
      );

      const data = {
        location_code: v.locationCode,
        location_name: v.locationName,
        location_type: v.locationType,
        zone_id: await ownedIdOrNull(tx, principal, 'zone', v.zoneId),
        partner_id: await ownedIdOrNull(tx, principal, 'partner', v.partnerId),
        address1: v.address1,
        address2: v.address2,
        latitude: v.latitude,
        longitude: v.longitude,
        // 좌표를 지우면 "검증됨" 도 함께 내려야 한다. 좌표 없이 검증된
        // 거점이라는 상태는 성립하지 않는다.
        geo_verified: v.latitude === null ? false : v.geoVerified,
        tel: v.tel,
        manager_name: v.managerName,
        open_time: toClock(v.openTime),
        close_time: toClock(v.closeTime),
        standard_load_min: v.standardLoadMin,
        standard_unload_min: v.standardUnloadMin,
        dock_count: v.dockCount,
        has_forklift: v.hasForklift,
        require_reservation: v.requireReservation,
        is_pickup_available: v.isPickupAvailable,
        is_delivery_available: v.isDeliveryAvailable,
        remark: v.remark,
        is_active: v.isActive,
      };

      const row = id
        ? await tx.location.update({
            where: { location_id: await ownedId(tx, principal, 'location', id) },
            data,
          })
        : await tx.location.create({ data: { tenant_id, ...data } });

      return { id: String(row.location_id) };
    });
  }

  // -------------------------------------------------------------------
  // 권역
  // -------------------------------------------------------------------

  async zoneDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.zone.findFirst({
          where: { tenant_id: principal.tenantId, zone_id: toId(id) },
        }),
        '권역',
      );
      return {
        id: String(r.zone_id),
        zoneCode: r.zone_code,
        zoneName: r.zone_name,
        centerLatitude: num(r.center_latitude),
        centerLongitude: num(r.center_longitude),
        sortOrder: r.sort_order,
        isActive: r.is_active,
      };
    });
  }

  async saveZone(principal: AuthPrincipal, id: string | null, v: ZoneFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      await assertCodeFree(
        tx.zone.findFirst({
          where: { tenant_id, zone_code: v.zoneCode, ...notSelf('zone_id', id) },
          select: { zone_id: true },
        }),
        'zoneCode',
        '이미 쓰고 있는 권역 코드입니다',
      );

      const data = {
        zone_code: v.zoneCode,
        zone_name: v.zoneName,
        center_latitude: v.centerLatitude,
        center_longitude: v.centerLongitude,
        sort_order: v.sortOrder ?? 100,
        is_active: v.isActive,
      };

      const row = id
        ? await tx.zone.update({
            where: { zone_id: await ownedId(tx, principal, 'zone', id) },
            data,
          })
        : await tx.zone.create({
            data: { tenant_id, zone_level: 1, zone_type: 'DELIVERY', ...data },
          });

      return { id: String(row.zone_id) };
    });
  }

  // -------------------------------------------------------------------
  // 라우트
  // -------------------------------------------------------------------

  async routeDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.distance_master.findFirst({
          where: { tenant_id: principal.tenantId, distance_id: toId(id) },
        }),
        '구간',
      );
      return {
        id: String(r.distance_id),
        fromLocationId: String(r.from_location_id),
        toLocationId: String(r.to_location_id),
        distanceKm: num(r.distance_km) ?? 0,
        durationMinutes: r.duration_minutes,
        tollFee: num(r.toll_fee),
        source: r.source as RouteFormValues['source'],
        isActive: r.is_active,
      };
    });
  }

  async saveRoute(principal: AuthPrincipal, id: string | null, v: RouteFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const from_location_id = await ownedId(tx, principal, 'location', v.fromLocationId);
      const to_location_id = await ownedId(tx, principal, 'location', v.toLocationId);

      // uk_distance_master (tenant, from, to, route_type) — 같은 구간을 두 번
      // 넣으면 어느 값이 쓰일지 모르게 된다
      await assertCodeFree(
        tx.distance_master.findFirst({
          where: {
            tenant_id,
            from_location_id,
            to_location_id,
            route_type: 'FASTEST',
            ...notSelf('distance_id', id),
          },
          select: { distance_id: true },
        }),
        'toLocationId',
        '이미 등록된 구간입니다',
      );

      const data = {
        from_location_id,
        to_location_id,
        route_type: 'FASTEST',
        distance_km: v.distanceKm,
        duration_minutes: v.durationMinutes,
        toll_fee: v.tollFee,
        source: v.source,
        // 사람이 저장했다는 사실 자체가 "이 값을 지금 확인했다" 는 뜻이다
        last_verified_at: new Date(),
        is_active: v.isActive,
      };

      const row = id
        ? await tx.distance_master.update({
            where: { distance_id: await ownedId(tx, principal, 'route', id) },
            data,
          })
        : await tx.distance_master.create({ data: { tenant_id, ...data } });

      return { id: String(row.distance_id) };
    });
  }

  // -------------------------------------------------------------------
  // 단가
  // -------------------------------------------------------------------

  async tariffDetail(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const r = await mustFind(
        tx.rate_table.findFirst({
          where: { tenant_id: principal.tenantId, rate_table_id: toId(id), deleted_at: null },
        }),
        '운임표',
      );
      return {
        id: String(r.rate_table_id),
        rateTableCode: r.rate_table_code,
        rateTableName: r.rate_table_name,
        rateTarget: r.rate_target as TariffFormValues['rateTarget'],
        rateMethod: r.rate_method as TariffFormValues['rateMethod'],
        partnerId: idOrNull(r.partner_id),
        applyStartDate: dateStr(r.apply_start_date) ?? '',
        applyEndDate: dateStr(r.apply_end_date),
        minChargeAmount: num(r.min_charge_amount),
        applyFuelSurcharge: r.apply_fuel_surcharge,
        isTaxable: r.is_taxable,
        status: r.status as TariffFormValues['status'],
        description: r.description,
        isActive: r.is_active,
      };
    });
  }

  async saveTariff(principal: AuthPrincipal, id: string | null, v: TariffFormValues) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      await assertCodeFree(
        tx.rate_table.findFirst({
          where: {
            tenant_id,
            rate_table_code: v.rateTableCode,
            deleted_at: null,
            ...notSelf('rate_table_id', id),
          },
          select: { rate_table_id: true },
        }),
        'rateTableCode',
        '이미 쓰고 있는 운임표 코드입니다',
      );

      const data = {
        rate_table_code: v.rateTableCode,
        rate_table_name: v.rateTableName,
        rate_target: v.rateTarget,
        rate_method: v.rateMethod,
        partner_id: await ownedIdOrNull(tx, principal, 'partner', v.partnerId),
        apply_start_date: toDate(v.applyStartDate)!,
        apply_end_date: toDate(v.applyEndDate),
        min_charge_amount: v.minChargeAmount,
        apply_fuel_surcharge: v.applyFuelSurcharge,
        is_taxable: v.isTaxable,
        status: v.status,
        description: v.description,
        is_active: v.isActive,
        // 승인 시각은 상태를 따라간다. 승인으로 바꿔 놓고 시각이 비어 있으면
        // 언제부터 이 운임으로 청구했는지 나중에 답할 수 없다.
        approved_at: v.status === 'APPROVED' ? new Date() : null,
      };

      const row = id
        ? await tx.rate_table.update({
            where: { rate_table_id: await ownedId(tx, principal, 'tariff', id) },
            data,
          })
        : await tx.rate_table.create({ data: { tenant_id, currency_code: 'KRW', ...data } });

      return { id: String(row.rate_table_id) };
    });
  }
  // -------------------------------------------------------------------
  // 삭제
  //
  // 기준정보는 지우는 것이 아니라 **쓰지 않게 두는** 것이 기본이다. 오더 ·
  // 트립 · 배차 · 정산이 전부 이 행들을 가리키고 있어서, 지우면 지난 기록이
  // 무엇을 말하는지 알 수 없게 된다.
  //
  // 그래서 두 단계로 나눈다.
  //
  //   1. 무엇이 이 행을 쓰고 있는지 센다. 하나라도 있으면 거절하고, 어디가
  //      걸고 있는지 건수까지 알려준다. "삭제할 수 없습니다" 만 던지면
  //      사용자는 다음에 무엇을 해야 할지 알 수 없다.
  //   2. 아무도 안 쓰면 지운다. deleted_at 이 있는 테이블은 그 칸을 채우고
  //      (부분 유니크 인덱스가 deleted_at IS NULL 조건이라 코드가 곧바로
  //      다시 쓸 수 있게 풀린다), 없는 테이블은 실제로 지운다.
  // -------------------------------------------------------------------

  async deletePartner(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const partner_id = await ownedId(tx, principal, 'partner', id);
      const w = { tenant_id: principal.tenantId };
      await assertUnused([
        ['운송오더', tx.transport_order.count({ where: { ...w, OR: [
          { shipper_id: partner_id }, { consignor_id: partner_id }, { consignee_id: partner_id },
        ] } })],
        ['배차', tx.dispatch.count({ where: { ...w, carrier_id: partner_id } })],
        ['운송사 배정', tx.allocation.count({ where: { ...w, carrier_id: partner_id } })],
        ['정산', tx.settlement.count({ where: { ...w, partner_id } })],
        ['차량', tx.vehicle.count({ where: { ...w, carrier_id: partner_id, deleted_at: null } })],
        ['기사', tx.driver.count({ where: { ...w, carrier_id: partner_id, deleted_at: null } })],
        ['거점', tx.location.count({ where: { ...w, partner_id, deleted_at: null } })],
        ['운임표', tx.rate_table.count({ where: { ...w, partner_id, deleted_at: null } })],
        ['사용자 계정', tx.user_account.count({ where: { ...w, partner_id } })],
      ]);
      await tx.business_partner.update({
        where: { partner_id },
        data: { deleted_at: new Date(), deleted_by: principal.userId, is_active: false },
      });
      return { id };
    });
  }

  async deleteVehicle(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const vehicle_id = await ownedId(tx, principal, 'vehicle', id);
      const w = { tenant_id: principal.tenantId };
      await assertUnused([
        ['배차', tx.dispatch.count({ where: { ...w, vehicle_id } })],
        ['운송실행', tx.transport_execution.count({ where: { ...w, vehicle_id } })],
        ['운송실적', tx.transport_actual.count({ where: { ...w, vehicle_id } })],
        ['정비 이력', tx.vehicle_maintenance.count({ where: { ...w, vehicle_id } })],
        ['기사 배정', tx.vehicle_driver.count({ where: { ...w, vehicle_id } })],
      ]);
      await tx.vehicle.update({
        where: { vehicle_id },
        data: { deleted_at: new Date(), deleted_by: principal.userId, is_active: false },
      });
      return { id };
    });
  }

  async deleteDriver(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const driver_id = await ownedId(tx, principal, 'driver', id);
      const w = { tenant_id: principal.tenantId };
      await assertUnused([
        ['배차', tx.dispatch.count({ where: { ...w, OR: [
          { driver_id }, { sub_driver_id: driver_id },
        ] } })],
        ['운송실행', tx.transport_execution.count({ where: { ...w, driver_id } })],
        ['운송실적', tx.transport_actual.count({ where: { ...w, driver_id } })],
        ['기본 기사로 지정된 차량', tx.vehicle.count({ where: { ...w, default_driver_id: driver_id, deleted_at: null } })],
        ['사용자 계정', tx.user_account.count({ where: { ...w, driver_id } })],
      ]);
      await tx.driver.update({
        where: { driver_id },
        data: { deleted_at: new Date(), deleted_by: principal.userId, is_active: false },
      });
      return { id };
    });
  }

  async deleteLocation(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const location_id = await ownedId(tx, principal, 'location', id);
      const w = { tenant_id: principal.tenantId };
      await assertUnused([
        ['운송오더', tx.transport_order.count({ where: { ...w, OR: [
          { from_location_id: location_id }, { to_location_id: location_id },
        ] } })],
        ['트립', tx.trip.count({ where: { ...w, OR: [
          { start_location_id: location_id }, { end_location_id: location_id },
        ] } })],
        ['구간(라우트)', tx.distance_master.count({ where: { ...w, OR: [
          { from_location_id: location_id }, { to_location_id: location_id },
        ] } })],
        ['차고지로 지정된 차량', tx.vehicle.count({ where: { ...w, base_location_id: location_id, deleted_at: null } })],
      ]);
      await tx.location.update({
        where: { location_id },
        data: { deleted_at: new Date(), deleted_by: principal.userId, is_active: false },
      });
      return { id };
    });
  }

  async deleteZone(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const zone_id = await ownedId(tx, principal, 'zone', id);
      const w = { tenant_id: principal.tenantId };
      await assertUnused([
        ['거점', tx.location.count({ where: { ...w, zone_id, deleted_at: null } })],
        ['운송오더', tx.transport_order.count({ where: { ...w, OR: [
          { from_zone_id: zone_id }, { to_zone_id: zone_id },
        ] } })],
        ['운임표 요율 상세', tx.rate_table_detail.count({ where: { ...w, OR: [
          { from_zone_id: zone_id }, { to_zone_id: zone_id },
        ] } })],
      ]);
      // zone 에는 deleted_at 이 없다. 아무도 안 쓰는 것이 확인됐으므로 실제로 지운다.
      await tx.zone.delete({ where: { zone_id } });
      return { id };
    });
  }

  async deleteRoute(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const distance_id = await ownedId(tx, principal, 'route', id);
      // 구간거리는 계산에 쓰이고 끝난다 — 결과를 가리키는 행이 없다.
      await tx.distance_master.delete({ where: { distance_id } });
      return { id };
    });
  }

  async deleteTariff(principal: AuthPrincipal, id: string) {
    return this.run(principal, async (tx) => {
      const rate_table_id = await ownedId(tx, principal, 'tariff', id);
      const w = { tenant_id: principal.tenantId };
      await assertUnused([
        ['운송사 배정', tx.allocation.count({ where: { ...w, rate_table_id } })],
        ['정산 상세', tx.settlement_detail.count({ where: { ...w, rate_table_id } })],
        ['계약', tx.partner_contract.count({ where: { ...w, rate_table_id, deleted_at: null } })],
      ]);
      // 요율 상세는 rate_table 에 Cascade 로 걸려 있어 같이 정리된다.
      await tx.rate_table.update({
        where: { rate_table_id },
        data: { deleted_at: new Date(), deleted_by: principal.userId, is_active: false },
      });
      return { id };
    });
  }
  // -------------------------------------------------------------------
  // 요율 상세 — 금액이 실제로 만들어지는 줄들
  // -------------------------------------------------------------------

  async rateDetails(principal: AuthPrincipal, tariffId: string): Promise<RateDetailPage> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const head = await mustFind(
        tx.rate_table.findFirst({
          where: { tenant_id, rate_table_id: toId(tariffId), deleted_at: null },
          include: { business_partner: { select: { partner_name: true } } },
        }),
        '운임표',
      );

      const [rows, lockedBySettlement] = await Promise.all([
        tx.rate_table_detail.findMany({
          where: { tenant_id, rate_table_id: head.rate_table_id },
          orderBy: [{ priority: 'asc' }, { line_no: 'asc' }],
        }),
        tx.settlement_detail.count({
          where: { tenant_id, rate_table_id: head.rate_table_id },
        }),
      ]);

      return {
        tariff: {
          id: String(head.rate_table_id),
          rateTableCode: head.rate_table_code,
          rateTableName: head.rate_table_name,
          rateTarget: head.rate_target,
          rateMethod: head.rate_method,
          partnerName: head.business_partner?.partner_name ?? null,
          applyStartDate: dateStr(head.apply_start_date) ?? '',
          applyEndDate: dateStr(head.apply_end_date),
          minChargeAmount: num(head.min_charge_amount),
          status: head.status,
          isActive: head.is_active,
        },
        rows: rows.map((r) => ({
          lineNo: r.line_no,
          vehicleTypeId: idOrNull(r.vehicle_type_id),
          fromZoneId: idOrNull(r.from_zone_id),
          toZoneId: idOrNull(r.to_zone_id),
          distanceFrom: num(r.distance_from),
          distanceTo: num(r.distance_to),
          weightFrom: num(r.weight_from),
          weightTo: num(r.weight_to),
          qtyFrom: num(r.qty_from),
          qtyTo: num(r.qty_to),
          stopCountFrom: r.stop_count_from,
          stopCountTo: r.stop_count_to,
          baseAmount: num(r.base_amount) ?? 0,
          unitRate: num(r.unit_rate),
          minAmount: num(r.min_amount),
          maxAmount: num(r.max_amount),
          extraStopAmount: num(r.extra_stop_amount),
          waitingFreeMin: r.waiting_free_min,
          waitingRateHour: num(r.waiting_rate_hour),
          priority: r.priority,
          remark: r.remark,
        })),
        lockedBySettlement,
      };
    });
  }

  /**
   * 표 전체를 갈아 끼운다.
   *
   * 줄 단위로 저장하지 않는 이유는 요율표를 고치는 방식 때문이다 — 구간을
   * 새로 나누고 단가를 다시 배분하는 일이라, 중간 상태는 대개 말이 안 되는
   * 운임표다. 그 사이에 계산되는 오더가 있으면 틀린 금액이 나간다.
   *
   * 다만 **정산이 이미 참조한 줄이 있으면 거절한다.** settlement_detail 이
   * rate_detail_id 를 들고 있어서, 지우면 지난 청구서가 어느 요율로
   * 계산됐는지 답할 수 없게 된다.
   */
  async saveRateDetails(
    principal: AuthPrincipal,
    tariffId: string,
    body: RateDetailBulkValues,
  ) {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const rate_table_id = await ownedId(tx, principal, 'tariff', tariffId);

      const head = await mustFind(
        tx.rate_table.findFirst({
          where: { tenant_id, rate_table_id },
          select: { rate_method: true },
        }),
        '운임표',
      );

      const locked = await tx.settlement_detail.count({
        where: { tenant_id, rate_detail_id: { not: null }, rate_table_id },
      });
      if (locked > 0) {
        throw new AppError(
          409,
          'RATE_DETAIL_LOCKED',
          '정산에 이미 쓰인 요율이 있어 바꿀 수 없습니다. 새 운임표를 만들어 적용기간을 나누세요.',
          { locked },
        );
      }

      // 산정방식이 쓰지 않는 조건 축은 저장하지 않는다. 남겨 두면 매칭에
      // 조용히 끼어들어, 화면에 보이지도 않는 조건 때문에 금액이 달라진다.
      const axes = new Set(axesOf(head.rate_method));
      const keep = (axis: string, value: number | null) => (axes.has(axis as never) ? value : null);
      const keepRef = (axis: string, value: string | null) =>
        axes.has(axis as never) ? value : null;

      const rows = await Promise.all(
        body.rows.map(async (r: RateDetailValues, i: number) => ({
          tenant_id,
          rate_table_id,
          line_no: i + 1,
          vehicle_type_id: await ownedIdOrNull(
            tx,
            principal,
            'vehicleType',
            keepRef('vehicleType', r.vehicleTypeId),
          ),
          from_zone_id: await ownedIdOrNull(tx, principal, 'zone', keepRef('zonePair', r.fromZoneId)),
          to_zone_id: await ownedIdOrNull(tx, principal, 'zone', keepRef('zonePair', r.toZoneId)),
          distance_from: keep('distance', r.distanceFrom),
          distance_to: keep('distance', r.distanceTo),
          weight_from: keep('weight', r.weightFrom),
          weight_to: keep('weight', r.weightTo),
          qty_from: keep('qty', r.qtyFrom),
          qty_to: keep('qty', r.qtyTo),
          stop_count_from: toSmallInt(keep('stopCount', r.stopCountFrom)),
          stop_count_to: toSmallInt(keep('stopCount', r.stopCountTo)),
          base_amount: r.baseAmount,
          unit_rate: r.unitRate,
          min_amount: r.minAmount,
          max_amount: r.maxAmount,
          extra_stop_amount: r.extraStopAmount,
          waiting_free_min: toSmallInt(r.waitingFreeMin),
          waiting_rate_hour: r.waitingRateHour,
          priority: toSmallInt(r.priority) ?? 100,
          remark: r.remark,
        })),
      );

      await tx.rate_table_detail.deleteMany({ where: { tenant_id, rate_table_id } });
      if (rows.length > 0) {
        await tx.rate_table_detail.createMany({ data: rows as never });
      }

      return { count: rows.length };
    });
  }
}

// ---------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------

function toPartnerOption(p: {
  partner_id: bigint;
  partner_code: string;
  partner_name: string;
}): RefOption {
  return { id: String(p.partner_id), code: p.partner_code, name: p.partner_name };
}

/** 화면이 보낸 문자열 id 를 BigInt 로. 숫자가 아니면 없는 것으로 본다 */
function toId(value: string): bigint {
  if (!/^\d+$/.test(value)) throw AppError.notFound('MASTER_NOT_FOUND', '찾을 수 없습니다.');
  return BigInt(value);
}

function idOrNull(value: bigint | null): string | null {
  return value === null ? null : String(value);
}

/** Prisma Decimal → number. 화면은 Decimal 을 모른다 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/** date 컬럼 → `YYYY-MM-DD`. UTC 로 읽어야 하루 밀리지 않는다 */
function dateStr(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → UTC 자정. 로컬 자정으로 만들면 KST 에서 하루 앞당겨 저장된다 */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00Z`);
}

/** time 컬럼 → `HH:MM`. Prisma 는 1970-01-01 기준 Date 로 준다 */
function clockStr(value: Date | null): string | null {
  if (!value) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

function toClock(value: string | null): Date | null {
  return value === null ? null : new Date(`1970-01-01T${value}:00Z`);
}

/**
 * 이 기준정보를 쓰고 있는 곳이 있으면 삭제를 막는다.
 *
 * 막는 것으로 끝내지 않고 **어디가 몇 건 걸고 있는지** 를 돌려준다.
 * "삭제할 수 없습니다" 만으로는 사용자가 다음에 무엇을 해야 할지 모른다.
 */
async function assertUnused(probes: [string, Promise<number>][]): Promise<void> {
  const counts = await Promise.all(probes.map(([, promise]) => promise));
  const blockers = probes
    .map(([label], i) => ({ label, count: counts[i]! }))
    .filter((b) => b.count > 0);

  if (blockers.length === 0) return;

  const summary = blockers
    .map((b) => label(b.label, b.count))
    .join(' · ');
  throw new AppError(
    409,
    'MASTER_IN_USE',
    summary + '이 이 항목을 쓰고 있어 삭제할 수 없습니다.',
    { blockers },
  );
}

function label(name: string, count: number): string {
  return name + ' ' + count.toLocaleString('ko-KR') + '건';
}

/** SMALLINT 칸. 화면은 숫자 하나로 다루지만 DB 는 범위가 좁다 */
function toSmallInt(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

async function mustFind<T>(promise: Promise<T | null>, label: string): Promise<T> {
  const row = await promise;
  if (!row) throw AppError.notFound('MASTER_NOT_FOUND', `${label}을(를) 찾을 수 없습니다.`);
  return row;
}

/** 수정일 때 자기 자신은 중복이 아니다 */
function notSelf(key: string, id: string | null): Record<string, unknown> {
  return id ? { NOT: { [key]: toId(id) } } : {};
}

async function assertCodeFree(
  probe: Promise<unknown>,
  field: string,
  message: string,
): Promise<void> {
  if (await probe) {
    throw new AppError(409, 'MASTER_CODE_TAKEN', message, undefined, { [field]: [message] });
  }
}

type RefKind = 'partner' | 'driver' | 'location' | 'zone' | 'vehicle' | 'vehicleType' | 'route' | 'tariff';

/**
 * 넘어온 참조 id 가 우리 테넌트 것인지 확인하고 BigInt 로 돌려준다.
 *
 * FK 제약에는 tenant_id 가 없어서, 남의 테넌트 id 를 넣어도 DB 는 받아준다.
 * RLS 는 읽기를 막지만 그때는 이미 저장된 뒤다.
 */
async function ownedId(
  tx: TxClient,
  principal: AuthPrincipal,
  kind: RefKind,
  id: string,
): Promise<bigint> {
  const tenant_id = principal.tenantId;
  const key = toId(id);
  const found = await (async () => {
    switch (kind) {
      case 'partner':
        return tx.business_partner.findFirst({
          where: { tenant_id, partner_id: key, deleted_at: null },
          select: { partner_id: true },
        });
      case 'driver':
        return tx.driver.findFirst({
          where: { tenant_id, driver_id: key, deleted_at: null },
          select: { driver_id: true },
        });
      case 'location':
        return tx.location.findFirst({
          where: { tenant_id, location_id: key, deleted_at: null },
          select: { location_id: true },
        });
      case 'zone':
        return tx.zone.findFirst({ where: { tenant_id, zone_id: key }, select: { zone_id: true } });
      case 'vehicle':
        return tx.vehicle.findFirst({
          where: { tenant_id, vehicle_id: key, deleted_at: null },
          select: { vehicle_id: true },
        });
      case 'vehicleType':
        return tx.vehicle_type.findFirst({
          where: { tenant_id, vehicle_type_id: key },
          select: { vehicle_type_id: true },
        });
      case 'route':
        return tx.distance_master.findFirst({
          where: { tenant_id, distance_id: key },
          select: { distance_id: true },
        });
      case 'tariff':
        return tx.rate_table.findFirst({
          where: { tenant_id, rate_table_id: key, deleted_at: null },
          select: { rate_table_id: true },
        });
    }
  })();

  if (!found) throw AppError.notFound('MASTER_REF_NOT_FOUND', '고른 항목을 찾을 수 없습니다.');
  return key;
}

async function ownedIdOrNull(
  tx: TxClient,
  principal: AuthPrincipal,
  kind: RefKind,
  id: string | null,
): Promise<bigint | null> {
  return id === null ? null : ownedId(tx, principal, kind, id);
}
