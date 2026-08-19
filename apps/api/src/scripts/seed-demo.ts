/**
 * 데모 운영 데이터.
 *
 *   pnpm --filter @ntms/api seed:demo
 *   pnpm --filter @ntms/api seed:demo -- --reset    (기존 데모 데이터 삭제 후 재생성)
 *
 * 하루치 운영을 통째로 만든다 — 기준정보부터 오더 · 편성 · 배정 · 배차 ·
 * 운송실행까지. 화면을 빈 껍데기로 두지 않기 위해서이기도 하지만, 더 큰
 * 이유는 **집계 화면은 데이터 없이 설계할 수 없기 때문**이다. 파이프라인의
 * 병목이 어디에 생기는지, 지연이 어떤 모습으로 나타나는지는 실제 분포를
 * 봐야 알 수 있다.
 *
 * 상태 분포는 임의로 흩뿌린 것이 아니라 "오전 9시의 배차실" 을 재현한 것이다.
 * 접수는 쌓여 있고, 편성은 절반쯤 돌았고, 몇 대는 이미 도로 위에 있고,
 * 어제 것 몇 건이 인수확인을 기다린다.
 *
 * ADMIN_DATABASE_URL 로 접속한다. 마이그레이션·초기적재와 같은 성격이며
 * 운영 DB 에서는 실행하지 않는다.
 */
import { PrismaClient } from '@ntms/db';
import type { OrderStatus, TripStatus } from '@ntms/shared';

const TENANT_CODE = 'NTMS';

/**
 * 고정 시드 난수.
 * 실행할 때마다 숫자가 달라지면 "어제 화면과 다른데 내가 뭘 바꿨나" 를
 * 매번 의심하게 된다. 같은 입력에는 같은 화면이 나와야 한다.
 */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const rnd = makeRandom(20260819);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const between = (min: number, max: number) => min + rnd() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));

/** 운영 시간대. 배차는 이 안에서만 만든다 */
const OPERATING_HOURS = { from: 6, to: 22 } as const;

/** 오늘 지정 시각 (Asia/Seoul 기준으로 돌린다는 전제) */
function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

const MINUTES_PER_DAY = 24 * 60;
const clampToDay = (m: number) => Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(m)));

/**
 * `time without time zone` 컬럼용 값.
 *
 * 이 컬럼에 로컬 시각의 Date 를 그대로 넘기면 Prisma 가 UTC 로 바꿔 보낸다.
 * KST 06:00 이 21:00(전날)로 들어가고, 거기에 2시간을 더한 종료시각이
 * 자정을 넘어 시작보다 작아진다 — ck_order_pickup_window 가 그걸 잡는다.
 * 벽시계 시각을 그대로 보내려면 UTC 기준으로 만들어야 한다.
 */
const timeOfDay = (minutesFromMidnight: number): Date => {
  const m = clampToDay(minutesFromMidnight);
  return new Date(Date.UTC(1970, 0, 1, Math.floor(m / 60), m % 60));
};
const todayDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// ---------------------------------------------------------------------
// 기준정보
// ---------------------------------------------------------------------

const ZONES = [
  { code: 'ZN-CAP', name: '수도권', lat: 37.45, lng: 127.0 },
  { code: 'ZN-CHU', name: '충청권', lat: 36.62, lng: 127.42 },
  { code: 'ZN-YEO', name: '영남권', lat: 35.6, lng: 128.6 },
  { code: 'ZN-HOS', name: '호남권', lat: 35.32, lng: 126.9 },
  { code: 'ZN-GAN', name: '강원권', lat: 37.75, lng: 128.35 },
] as const;

const VEHICLE_TYPES = [
  { code: 'CG-1', name: '1톤 카고', body: 'CARGO', ton: 1, weight: 1000, cbm: 6, pallet: 2 },
  { code: 'CG-25', name: '2.5톤 카고', body: 'CARGO', ton: 2.5, weight: 2500, cbm: 14, pallet: 6 },
  { code: 'WG-5', name: '5톤 윙바디', body: 'WING', ton: 5, weight: 5000, cbm: 30, pallet: 12 },
  { code: 'WG-11', name: '11톤 윙바디', body: 'WING', ton: 11, weight: 11000, cbm: 60, pallet: 22 },
  { code: 'RF-5', name: '5톤 냉장', body: 'REEFER', ton: 5, weight: 5000, cbm: 26, pallet: 10, temp: 'CHILLED' },
  { code: 'RF-11', name: '11톤 냉동', body: 'REEFER', ton: 11, weight: 11000, cbm: 54, pallet: 20, temp: 'FROZEN' },
  { code: 'TR-25', name: '25톤 트레일러', body: 'TRAILER', ton: 25, weight: 25000, cbm: 76, pallet: 40 },
] as const;

const SHIPPERS = [
  { code: 'SH-1001', name: '(주)한빛식품', biz: '3018112345', grade: 'S', tel: '02-555-1200' },
  { code: 'SH-1002', name: '(주)대명전자', biz: '2148856701', grade: 'A', tel: '031-770-3400' },
  { code: 'SH-1003', name: '서일화학(주)', biz: '4028834512', grade: 'A', tel: '041-580-2100' },
  { code: 'SH-1004', name: '(주)미래유통', biz: '1138645902', grade: 'B', tel: '02-2020-7700' },
] as const;

const CARRIERS = [
  { code: 'CR-2001', name: '(주)한결운수', biz: '6068811234', grade: 'S', tel: '051-600-8800' },
  { code: 'CR-2002', name: '동아로지스(주)', biz: '3138822345', grade: 'A', tel: '032-450-1900' },
  { code: 'CR-2003', name: '삼진택배운송', biz: '5148833456', grade: 'B', tel: '062-950-2300' },
  { code: 'CR-2004', name: '신흥물류(주)', biz: '4038844567', grade: 'A', tel: '043-260-5500' },
  { code: 'CR-2005', name: '대륙운송(주)', biz: '2028855678', grade: 'B', tel: '053-580-4100' },
] as const;

const CONSIGNEES = [
  { code: 'CN-3001', name: '수도권물류센터', tel: '031-8000-1000' },
  { code: 'CN-3002', name: '영남권 대리점', tel: '051-900-2000' },
  { code: 'CN-3003', name: '호남권 대리점', tel: '062-700-3000' },
] as const;

const LOCATIONS = [
  { code: 'LC-BSCY', name: '부산신항 CY', type: 'PORT', zone: 'ZN-YEO', addr: '부산광역시 강서구 신항북로 100', lat: 35.0758, lng: 128.8256, dock: 12 },
  { code: 'LC-YSICD', name: '양산 ICD', type: 'HUB', zone: 'ZN-YEO', addr: '경상남도 양산시 물금읍 산단로 55', lat: 35.3038, lng: 129.0088, dock: 8 },
  { code: 'LC-GCHUB', name: '김천 허브', type: 'HUB', zone: 'ZN-YEO', addr: '경상북도 김천시 어모면 물류단지로 21', lat: 36.15, lng: 128.11, dock: 16 },
  { code: 'LC-DGWH', name: '대구 물류센터', type: 'WAREHOUSE', zone: 'ZN-YEO', addr: '대구광역시 달성군 논공읍 위천로 240', lat: 35.7, lng: 128.42, dock: 10 },
  { code: 'LC-ASCDC', name: '안성 CDC', type: 'DC', zone: 'ZN-CAP', addr: '경기도 안성시 원곡면 무한로 388', lat: 37.0, lng: 127.15, dock: 20 },
  { code: 'LC-PJDC', name: '파주 DC', type: 'DC', zone: 'ZN-CAP', addr: '경기도 파주시 문발로 145', lat: 37.7, lng: 126.75, dock: 14 },
  { code: 'LC-ICWH', name: '이천 물류센터', type: 'WAREHOUSE', zone: 'ZN-CAP', addr: '경기도 이천시 마장면 서이천로 630', lat: 37.24, lng: 127.42, dock: 12 },
  { code: 'LC-ICPORT', name: '인천항 물류단지', type: 'PORT', zone: 'ZN-CAP', addr: '인천광역시 중구 항동7가 82', lat: 37.45, lng: 126.6, dock: 10 },
  { code: 'LC-CJPL', name: '청주 공장', type: 'PLANT', zone: 'ZN-CHU', addr: '충청북도 청주시 흥덕구 산단로 123', lat: 36.63, lng: 127.43, dock: 6 },
  { code: 'LC-GJST', name: '광주 지점', type: 'STORE', zone: 'ZN-HOS', addr: '광주광역시 광산구 하남산단로 200', lat: 35.17, lng: 126.79, dock: 4 },
] as const;

/** 실제로 물동량이 도는 구간. 거리·소요시간은 라우트 마스터로도 저장한다 */
const LANES = [
  { from: 'LC-BSCY', to: 'LC-PJDC', km: 418, min: 330, toll: 32400 },
  { from: 'LC-BSCY', to: 'LC-ASCDC', km: 332, min: 262, toll: 26100 },
  { from: 'LC-YSICD', to: 'LC-GCHUB', km: 128, min: 104, toll: 9800 },
  { from: 'LC-GCHUB', to: 'LC-ASCDC', km: 162, min: 126, toll: 12600 },
  { from: 'LC-ASCDC', to: 'LC-PJDC', km: 94, min: 86, toll: 5200 },
  { from: 'LC-CJPL', to: 'LC-ICWH', km: 71, min: 62, toll: 4100 },
  { from: 'LC-ICWH', to: 'LC-DGWH', km: 228, min: 184, toll: 17800 },
  { from: 'LC-GJST', to: 'LC-ASCDC', km: 268, min: 214, toll: 20900 },
  { from: 'LC-ICPORT', to: 'LC-CJPL', km: 132, min: 110, toll: 9200 },
  { from: 'LC-DGWH', to: 'LC-BSCY', km: 118, min: 94, toll: 8400 },
  { from: 'LC-PJDC', to: 'LC-ICWH', km: 86, min: 78, toll: 4800 },
  { from: 'LC-ASCDC', to: 'LC-GJST', km: 268, min: 216, toll: 20900 },
] as const;

const DRIVER_NAMES = [
  '김상호', '박정민', '이근우', '최영달', '정재현', '한동수', '오세진', '윤기태',
  '장병철', '임형준', '서만수', '조광일', '신대호', '권영수', '문태식', '배중근',
  '황인철', '노경식', '전상우', '고재만', '심우석', '류병호', '남기훈', '양동일',
] as const;

const ITEM_NAMES = [
  '생수 2L 6입', '라면 박스', '조미료 세트', '냉동만두', '식용유 18L',
  'LED 모니터', '세탁기 부품', '에어컨 실외기', '배터리 모듈',
  '공업용 세정제', '산업용 접착제', '수지 원료', '포장 필름',
  '생활용품 혼적', '가공식품 혼적', '음료 팔레트',
] as const;

async function main(): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL 이 필요합니다.');

  const reset = process.argv.includes('--reset');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { tenant_code: TENANT_CODE, deleted_at: null },
    });
    if (!tenant) {
      throw new Error(
        `테넌트 ${TENANT_CODE} 이 없습니다. 먼저 'pnpm --filter @ntms/api seed' 를 실행하세요.`,
      );
    }
    const tenantId = tenant.tenant_id;

    if (reset) {
      console.log('기존 데모 데이터 삭제 중...');
      // FK 역순으로 지운다. order_status_history 는 트리거가 만든 것이라
      // 오더보다 먼저 치워야 한다.
      await prisma.transport_execution.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.dispatch.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.allocation.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.trip_stop.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.trip_order.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.trip.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.transport_order_item.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.order_status_history.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.transport_order.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.distance_master.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.rate_table.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.vehicle.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.driver.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.location.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.business_partner.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.vehicle_type.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.zone.deleteMany({ where: { tenant_id: tenantId } });
    }

    const existing = await prisma.transport_order.count({ where: { tenant_id: tenantId } });
    if (existing > 0) {
      console.log(
        `이미 오더 ${existing}건이 있습니다. 다시 만들려면 --reset 을 붙여 실행하세요.`,
      );
      return;
    }

    // --- 권역 -------------------------------------------------------
    const zoneId = new Map<string, bigint>();
    for (const [i, z] of ZONES.entries()) {
      const row = await prisma.zone.create({
        data: {
          tenant_id: tenantId,
          zone_code: z.code,
          zone_name: z.name,
          zone_level: 1,
          zone_type: 'DELIVERY',
          center_latitude: z.lat,
          center_longitude: z.lng,
          sort_order: (i + 1) * 10,
        },
      });
      zoneId.set(z.code, row.zone_id);
    }
    console.log(`권역 ${ZONES.length}건`);

    // --- 차종 -------------------------------------------------------
    const vtypeId = new Map<string, bigint>();
    for (const [i, v] of VEHICLE_TYPES.entries()) {
      const row = await prisma.vehicle_type.create({
        data: {
          tenant_id: tenantId,
          vehicle_type_code: v.code,
          vehicle_type_name: v.name,
          body_type: v.body,
          ton_class: v.ton,
          max_weight_kg: v.weight,
          max_volume_cbm: v.cbm,
          max_pallet_qty: v.pallet,
          is_temperature_controlled: 'temp' in v,
          temperature_zone: 'temp' in v ? (v.temp as 'CHILLED' | 'FROZEN') : 'AMBIENT',
          sort_order: (i + 1) * 10,
        },
      });
      vtypeId.set(v.code, row.vehicle_type_id);
    }
    console.log(`차종 ${VEHICLE_TYPES.length}건`);

    // --- 거래처 -----------------------------------------------------
    const partnerId = new Map<string, bigint>();
    const partnerName = new Map<bigint, string>();

    const createPartner = async (
      p: { code: string; name: string; biz?: string; grade?: string; tel?: string },
      roles: { shipper?: boolean; carrier?: boolean; consignee?: boolean },
    ) => {
      const row = await prisma.business_partner.create({
        data: {
          tenant_id: tenantId,
          partner_code: p.code,
          partner_name: p.name,
          is_shipper: roles.shipper ?? false,
          is_carrier: roles.carrier ?? false,
          is_consignee: roles.consignee ?? false,
          is_vendor: false,
          business_no: p.biz ?? null,
          tel: p.tel ?? null,
          grade: (p.grade as 'S' | 'A' | 'B' | 'C' | 'D') ?? null,
          settlement_cycle: 'MONTHLY',
          closing_day: 31,
          payment_terms_days: 30,
        },
      });
      partnerId.set(p.code, row.partner_id);
      partnerName.set(row.partner_id, p.name);
      return row.partner_id;
    };

    for (const p of SHIPPERS) await createPartner(p, { shipper: true });
    for (const p of CARRIERS) await createPartner(p, { carrier: true });
    for (const p of CONSIGNEES) await createPartner(p, { consignee: true });
    console.log(
      `거래처 ${SHIPPERS.length + CARRIERS.length + CONSIGNEES.length}건 ` +
        `(화주 ${SHIPPERS.length} · 운송사 ${CARRIERS.length} · 수하처 ${CONSIGNEES.length})`,
    );

    // --- 상하차지 ---------------------------------------------------
    const locId = new Map<string, bigint>();
    const locInfo = new Map<
      string,
      { id: bigint; name: string; addr: string; lat: number; lng: number; zone: bigint }
    >();
    for (const l of LOCATIONS) {
      const row = await prisma.location.create({
        data: {
          tenant_id: tenantId,
          location_code: l.code,
          location_name: l.name,
          location_type: l.type,
          zone_id: zoneId.get(l.zone) ?? null,
          address1: l.addr,
          latitude: l.lat,
          longitude: l.lng,
          geo_verified: true,
          dock_count: l.dock,
          open_time: new Date('1970-01-01T06:00:00Z'),
          close_time: new Date('1970-01-01T22:00:00Z'),
          standard_load_min: 45,
          standard_unload_min: 40,
          has_forklift: true,
          is_pickup_available: true,
          is_delivery_available: true,
        },
      });
      locId.set(l.code, row.location_id);
      locInfo.set(l.code, {
        id: row.location_id,
        name: l.name,
        addr: l.addr,
        lat: l.lat,
        lng: l.lng,
        zone: zoneId.get(l.zone)!,
      });
    }
    console.log(`상하차지 ${LOCATIONS.length}건`);

    // --- 라우트(구간거리) -------------------------------------------
    for (const lane of LANES) {
      await prisma.distance_master.create({
        data: {
          tenant_id: tenantId,
          from_location_id: locId.get(lane.from)!,
          to_location_id: locId.get(lane.to)!,
          route_type: 'FASTEST',
          distance_km: lane.km,
          duration_minutes: lane.min,
          toll_fee: lane.toll,
          source: 'MANUAL',
          last_verified_at: new Date(),
        },
      });
    }
    console.log(`라우트 ${LANES.length}건`);

    // --- 기사 · 차량 -------------------------------------------------
    const driverIds: bigint[] = [];
    for (const [i, name] of DRIVER_NAMES.entries()) {
      const carrier = CARRIERS[i % CARRIERS.length]!;
      const row = await prisma.driver.create({
        data: {
          tenant_id: tenantId,
          driver_code: `DR-${String(4001 + i)}`,
          driver_name: name,
          carrier_id: partnerId.get(carrier.code)!,
          mobile: `010-${String(intBetween(2000, 9999))}-${String(intBetween(1000, 9999))}`,
          license_type: '1종 대형',
          license_expire_date: new Date(2029, intBetween(0, 11), intBetween(1, 28)),
          hire_date: new Date(2019 + (i % 6), intBetween(0, 11), intBetween(1, 28)),
          on_time_rate: Number(between(91, 99.5).toFixed(2)),
          evaluation_score: Number(between(3.6, 4.9).toFixed(1)),
          status: 'ACTIVE',
        },
      });
      driverIds.push(row.driver_id);
    }

    // 차종 구성은 물동량을 감당할 수 있어야 한다. 장거리 한 건이 5~7시간을
    // 잡아먹는데 25톤이 두 대뿐이면 하루에 네 건밖에 못 돌고, 나머지는
    // 갈 곳이 없어 겹쳐 잡힌다 — 데이터가 아니라 차량 구성의 문제다.
    const VEHICLE_PLAN = [
      'TR-25', 'TR-25', 'TR-25', 'TR-25', 'TR-25',
      'WG-11', 'WG-11', 'WG-11', 'WG-11', 'WG-11', 'WG-11',
      'RF-11', 'RF-11', 'RF-11', 'RF-11',
      'WG-5', 'WG-5', 'WG-5', 'WG-5',
      'RF-5', 'RF-5', 'CG-25', 'CG-25', 'CG-1',
    ] as const;
    const vehicleIds: bigint[] = [];
    const vehicleInfo = new Map<
      bigint,
      { no: string; typeId: bigint; typeName: string; carrierId: bigint; driverId: bigint }
    >();

    for (const [i, code] of VEHICLE_PLAN.entries()) {
      const carrier = CARRIERS[i % CARRIERS.length]!;
      const vt = VEHICLE_TYPES.find((v) => v.code === code)!;
      const no = `${intBetween(10, 99)}${pick(['가', '나', '다', '라', '바', '사'])} ${String(intBetween(1000, 9999))}`;
      const row = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          vehicle_no: no,
          vehicle_type_id: vtypeId.get(code)!,
          carrier_id: partnerId.get(carrier.code)!,
          ownership_type: i < 4 ? 'OWNED' : i < 10 ? 'CONTRACTED' : 'CONSIGNED',
          manufacturer: pick(['현대', '타타대우', '볼보', '스카니아']),
          model_year: intBetween(2018, 2025),
          max_weight_kg: vt.weight,
          max_volume_cbm: vt.cbm,
          max_pallet_qty: vt.pallet,
          fuel_type: 'DIESEL',
          fuel_efficiency: Number(between(2.6, 5.4).toFixed(2)),
          base_location_id: locId.get(pick(LOCATIONS).code)!,
          default_driver_id: driverIds[i] ?? null,
          status: 'AVAILABLE',
          current_odometer: intBetween(40_000, 480_000),
        },
      });
      vehicleIds.push(row.vehicle_id);
      vehicleInfo.set(row.vehicle_id, {
        no,
        typeId: vtypeId.get(code)!,
        typeName: vt.name,
        carrierId: partnerId.get(carrier.code)!,
        driverId: driverIds[i]!,
      });
    }
    console.log(`기사 ${driverIds.length}명 · 차량 ${vehicleIds.length}대`);

    // --- 단가(운임표) -----------------------------------------------
    const tariffs = [
      { code: 'RT-BIL-DIST', name: '기본 거리요율 (매출)', target: 'BILLING', method: 'DISTANCE', partner: null },
      { code: 'RT-BIL-ZONE', name: '권역별 운임 (매출)', target: 'BILLING', method: 'ZONE', partner: 'SH-1001' },
      { code: 'RT-BIL-TRIP', name: '전세차 운임 (매출)', target: 'BILLING', method: 'PER_TRIP', partner: 'SH-1002' },
      { code: 'RT-PAY-DIST', name: '기본 거리요율 (매입)', target: 'PAYMENT', method: 'DISTANCE', partner: null },
      { code: 'RT-PAY-CR01', name: '한결운수 계약요율 (매입)', target: 'PAYMENT', method: 'ZONE', partner: 'CR-2001' },
      { code: 'RT-PAY-SPOT', name: '스팟 운임 (매입)', target: 'PAYMENT', method: 'PER_TRIP', partner: null },
    ] as const;
    for (const t of tariffs) {
      await prisma.rate_table.create({
        data: {
          tenant_id: tenantId,
          rate_table_code: t.code,
          rate_table_name: t.name,
          rate_target: t.target,
          rate_method: t.method,
          partner_id: t.partner ? partnerId.get(t.partner)! : null,
          currency_code: 'KRW',
          apply_start_date: new Date(new Date().getFullYear(), 0, 1),
          min_charge_amount: 80_000,
          apply_fuel_surcharge: true,
          is_taxable: true,
          status: 'APPROVED',
          approved_at: new Date(new Date().getFullYear(), 0, 2),
          version_no: 1,
        },
      });
    }
    console.log(`단가 ${tariffs.length}건`);

    // -----------------------------------------------------------------
    // 오더 — 오전 9시 배차실의 상태 분포
    // -----------------------------------------------------------------
    const ORDER_PLAN: Array<{ status: OrderStatus; count: number }> = [
      { status: 'RECEIVED', count: 18 },
      { status: 'ON_HOLD', count: 2 },
      { status: 'PLANNED', count: 9 },
      { status: 'ALLOCATED', count: 7 },
      { status: 'DISPATCHED', count: 11 },
      { status: 'PICKED_UP', count: 5 },
      { status: 'IN_TRANSIT', count: 11 },
      { status: 'DELIVERED', count: 6 },
      { status: 'CONFIRMED_POD', count: 5 },
      { status: 'FAILED', count: 1 },
    ];
    const orderTotal = ORDER_PLAN.reduce((a, b) => a + b.count, 0);

    const orderNos = await prisma.$queryRaw<Array<{ no: string }>>`
      SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'ORDER'::VARCHAR) AS no
        FROM generate_series(1, ${orderTotal}::INT)
    `;

    interface SeededOrder {
      id: bigint;
      status: OrderStatus;
      lane: (typeof LANES)[number];
      weight: number;
      volume: number;
    }
    const orders: SeededOrder[] = [];
    let orderIndex = 0;

    for (const planItem of ORDER_PLAN) {
      for (let n = 0; n < planItem.count; n += 1) {
        const lane = pick(LANES);
        const from = locInfo.get(lane.from)!;
        const to = locInfo.get(lane.to)!;
        const shipper = pick(SHIPPERS);
        const temp = pick(['AMBIENT', 'AMBIENT', 'AMBIENT', 'CHILLED', 'FROZEN'] as const);
        const weight = Math.round(between(600, 9800));
        const volume = Number((weight / between(180, 320)).toFixed(3));
        const qty = intBetween(20, 480);

        // 상차 06:00~13:00 사이에서 시작하고, 하차는 구간 소요시간 뒤.
        // 모두 같은 날 안에 들어오도록 잘라 낸다.
        const pickupFromMin = intBetween(6, 13) * 60 + pick([0, 10, 20, 30, 40, 50]);
        const pickupToMin = pickupFromMin + 120;
        const deliveryFromMin = Math.min(pickupFromMin + lane.min, 22 * 60);
        const deliveryToMin = Math.min(deliveryFromMin + 180, 23 * 60 + 50);
        const pickupAt = todayAt(Math.floor(pickupFromMin / 60), pickupFromMin % 60);

        const row = await prisma.transport_order.create({
          data: {
            tenant_id: tenantId,
            order_no: orderNos[orderIndex]!.no,
            order_type: 'DELIVERY',
            order_date: todayDate(),
            shipper_id: partnerId.get(shipper.code)!,
            consignee_id: partnerId.get(pick(CONSIGNEES).code)!,
            from_location_id: from.id,
            from_location_name: from.name,
            from_address1: from.addr,
            from_latitude: from.lat,
            from_longitude: from.lng,
            from_zone_id: from.zone,
            from_contact_name: pick(['배송담당', '출고팀', '물류팀']),
            from_contact_tel: '031-000-0000',
            to_location_id: to.id,
            to_location_name: to.name,
            to_address1: to.addr,
            to_latitude: to.lat,
            to_longitude: to.lng,
            to_zone_id: to.zone,
            to_contact_name: pick(['입고담당', '검수팀', '창고팀']),
            to_contact_tel: '051-000-0000',
            appointment_type: pick(['WINDOW', 'WINDOW', 'ASAP', 'APPOINTMENT'] as const),
            pickup_date: todayDate(),
            pickup_time_from: timeOfDay(pickupFromMin),
            pickup_time_to: timeOfDay(pickupToMin),
            delivery_date: todayDate(),
            delivery_time_from: timeOfDay(deliveryFromMin),
            delivery_time_to: timeOfDay(deliveryToMin),
            is_time_critical: rnd() < 0.18,
            total_item_count: 1,
            total_qty: qty,
            total_weight_kg: weight,
            total_volume_cbm: volume,
            total_pallet_qty: Math.max(1, Math.round(volume / 1.6)),
            temperature_zone: temp,
            distance_km: lane.km,
            estimated_amount: Math.round((lane.km * between(1150, 1850)) / 1000) * 1000,
            freight_terms: 'CREDIT',
            priority: pick(['NORMAL', 'NORMAL', 'NORMAL', 'HIGH', 'URGENT'] as const),
            status: planItem.status,
            hold_reason:
              planItem.status === 'ON_HOLD'
                ? pick(['화주 출고 지연', '수하처 입고 불가', '서류 미비'])
                : null,
            cancel_reason: planItem.status === 'FAILED' ? '수하처 부재 — 재배송 협의 중' : null,
            special_instruction: rnd() < 0.25 ? pick(['지게차 필요', '입차 사전예약 필수', '파손주의']) : null,
          },
        });

        await prisma.transport_order_item.create({
          data: {
            tenant_id: tenantId,
            order_id: row.order_id,
            line_no: 1,
            item_name: pick(ITEM_NAMES),
            qty,
            uom_code: 'BOX',
            weight_kg: weight,
            volume_cbm: volume,
            temperature_zone: temp,
          },
        });

        orders.push({ id: row.order_id, status: planItem.status, lane, weight, volume });
        orderIndex += 1;
      }
    }
    console.log(`운송오더 ${orders.length}건`);

    // -----------------------------------------------------------------
    // 편성 · 배정 · 배차 · 실행
    //
    // 오더 상태와 트립 상태가 서로 어긋나면 파이프라인 화면이 거짓말을 한다.
    // 오더를 상태별로 묶어 그 단계에 맞는 트립을 만든다.
    // -----------------------------------------------------------------
    const byStatus = (s: OrderStatus) => orders.filter((o) => o.status === s);

    const TRIP_PLAN: Array<{
      tripStatus: TripStatus;
      orderStatus: OrderStatus;
      trips: number;
    }> = [
      { tripStatus: 'CONFIRMED', orderStatus: 'PLANNED', trips: 3 },
      { tripStatus: 'ALLOCATING', orderStatus: 'ALLOCATED', trips: 2 },
      { tripStatus: 'ALLOCATED', orderStatus: 'ALLOCATED', trips: 1 },
      { tripStatus: 'DISPATCHED', orderStatus: 'DISPATCHED', trips: 4 },
      { tripStatus: 'EXECUTING', orderStatus: 'PICKED_UP', trips: 2 },
      { tripStatus: 'EXECUTING', orderStatus: 'IN_TRANSIT', trips: 4 },
      { tripStatus: 'COMPLETED', orderStatus: 'DELIVERED', trips: 2 },
      { tripStatus: 'CLOSED', orderStatus: 'CONFIRMED_POD', trips: 2 },
    ];

    const tripCount = TRIP_PLAN.reduce((a, b) => a + b.trips, 0);
    const tripNos = await prisma.$queryRaw<Array<{ no: string }>>`
      SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'TRIP'::VARCHAR) AS no
        FROM generate_series(1, ${tripCount}::INT)
    `;
    const dispatchNos = await prisma.$queryRaw<Array<{ no: string }>>`
      SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'DISPATCH'::VARCHAR) AS no
        FROM generate_series(1, ${tripCount}::INT)
    `;

    let tripIndex = 0;
    let vehicleCursor = 0;
    const pools = new Map<OrderStatus, SeededOrder[]>();
    for (const p of TRIP_PLAN) {
      if (!pools.has(p.orderStatus)) pools.set(p.orderStatus, [...byStatus(p.orderStatus)]);
    }

    /** 차량별 마지막 운행 종료 시각. 다음 배차를 언제부터 붙일 수 있는지 본다 */
    const lastEndByVehicle = new Map<string, number>();
    /** 일부러 만들 겹침의 상대. 배차가 생긴 첫 트립을 붙잡아 둔다 */
    let conflictAnchor: { id: bigint; end: number } | null = null;

    let allocationCount = 0;
    let dispatchCount = 0;
    let executionCount = 0;

    for (const plan of TRIP_PLAN) {
      const pool = pools.get(plan.orderStatus)!;

      for (let t = 0; t < plan.trips; t += 1) {
        const take = Math.max(1, Math.ceil(pool.length / (plan.trips - t)));
        const members = pool.splice(0, take);
        if (members.length === 0) continue;

        const lane = members[0]!.lane;
        const from = locInfo.get(lane.from)!;
        const to = locInfo.get(lane.to)!;

        // 실을 수 있는 차를 고른다. 아무 차나 붙이면 적재율이 300% 로 찍히고,
        // 그 화면을 본 사람은 시스템을 믿지 않게 된다. 용량이 모자라면
        // 오더를 덜어 내 다음 트립으로 돌린다 — 실제 편성이 하는 일과 같다.
        let totalWeight = members.reduce((a, o) => a + o.weight, 0);
        const largest = Math.max(...VEHICLE_TYPES.map((v) => v.weight));
        while (members.length > 1 && totalWeight > largest * 0.92) {
          const dropped = members.pop()!;
          pool.unshift(dropped);
          totalWeight -= dropped.weight;
        }

        const capable = vehicleIds.filter((id) => {
          const info = vehicleInfo.get(id)!;
          const type = VEHICLE_TYPES.find((v) => vtypeId.get(v.code) === info.typeId)!;
          return type.weight >= totalWeight;
        });
        const fitting = capable.length > 0 ? capable : vehicleIds;

        // --- 언제 · 어느 차에 붙일까 ---------------------------------
        //
        // 실제 배차 담당자가 하는 판단을 그대로 옮긴다. 차를 먼저 고르고
        // 시각을 나중에 정하면 25톤 트레일러 두 대에 장거리가 전부 몰려
        // 배차판이 온통 "겹침" 이 된다. 순서를 뒤집어야 한다 —
        // **가장 빨리 비는 차를 찾고, 그 차가 비는 시각에 붙인다.**
        const durationMs = (lane.min + 90) * 60_000;
        const dayOpen = todayAt(OPERATING_HOURS.from, 0).getTime();
        const dayClose = todayAt(OPERATING_HOURS.to, 0).getTime();

        let chosen: { id: bigint; start: number } | null = null;
        for (const id of fitting) {
          const lastEnd = lastEndByVehicle.get(id.toString());
          // 앞 운행이 끝나고 40분은 쉬어야 다음 배차가 가능하다
          const earliest =
            lastEnd === undefined
              ? dayOpen + intBetween(0, 210) * 60_000
              : lastEnd + 40 * 60_000;
          if (earliest + durationMs > dayClose) continue;
          if (chosen === null || earliest < chosen.start) {
            chosen = { id, start: earliest };
          }
        }

        // 한 건은 일부러 겹치게 둔다. 겹침 경고가 실제로 뜨는 화면을 봐야
        // 그 기능이 동작하는지 확인할 수 있다.
        //
        // **배차가 실제로 만들어지는 트립끼리** 겹쳐야 한다. 편성확정 ·
        // 배정중 단계의 트립은 배차 행이 없어서 배차판에 나타나지 않고,
        // 거기에 겹침을 만들면 화면에는 아무것도 보이지 않는다.
        const willDispatch = ['DISPATCHED', 'EXECUTING', 'COMPLETED', 'CLOSED'].includes(
          plan.tripStatus,
        );
        if (willDispatch && dispatchCount === 1 && conflictAnchor !== null) {
          chosen = {
            id: conflictAnchor.id,
            start: conflictAnchor.end - 90 * 60_000,
          };
        }

        // 하루 안에 넣을 자리가 없으면 **가장 일찍 비는** 차에 얹는다.
        // 무작위로 고르면 이미 꽉 찬 차에 또 얹혀 겹침이 번진다.
        if (chosen === null) {
          let leastBusy = fitting[0]!;
          let leastEnd = Number.POSITIVE_INFINITY;
          for (const id of fitting) {
            const end = lastEndByVehicle.get(id.toString()) ?? dayOpen;
            if (end < leastEnd) {
              leastEnd = end;
              leastBusy = id;
            }
          }
          chosen = { id: leastBusy, start: Math.max(dayOpen, leastEnd) };
        }

        // 타입을 굳이 적는다. 없으면 TS 가 제어 흐름을 한 바퀴 돌다 막힌다 —
        //   vehicle → chosen(686행에서 conflictAnchor.id 대입)
        //           → conflictAnchor(아래에서 { id: vehicle } 대입) → vehicle
        // 세 변수 모두 선언에 타입이 붙어 있어도, 좁혀진 타입을 구하려면
        // 대입식을 전부 훑어야 해서 순환이 생긴다(TS7022). 고리 하나만 끊으면 된다.
        const vehicle: bigint = chosen.id;
        const vinfo = vehicleInfo.get(vehicle)!;
        vehicleCursor += 1;

        const startAt = new Date(chosen.start);
        startAt.setSeconds(0, 0);
        const endAt = addMinutes(startAt, lane.min + 90);
        // 반드시 max 로 갱신한다. 일부러 겹치게 만든 배차는 앞 운행보다
        // 먼저 끝나는데, 그 값으로 덮으면 그 차가 다시 한가해 보여서
        // 이후 배차가 전부 한 대에 몰린다. (겹침 8건짜리 배차판이 나온다)
        const prevEnd = lastEndByVehicle.get(vehicle.toString()) ?? 0;
        lastEndByVehicle.set(vehicle.toString(), Math.max(prevEnd, endAt.getTime()));

        const totalVolume = members.reduce((a, o) => a + o.volume, 0);
        const vt = VEHICLE_TYPES.find((v) => vtypeId.get(v.code) === vinfo.typeId)!;

        const trip = await prisma.trip.create({
          data: {
            tenant_id: tenantId,
            trip_no: tripNos[tripIndex]!.no,
            plan_date: todayDate(),
            trip_type: members.length > 1 ? 'CONSOLIDATED' : 'SINGLE',
            transport_mode: 'ROAD',
            required_vehicle_type_id: vinfo.typeId,
            required_ton: vt.ton,
            temperature_zone: 'AMBIENT',
            start_location_id: from.id,
            end_location_id: to.id,
            start_zone_id: from.zone,
            end_zone_id: to.zone,
            total_stop_count: 2,
            pickup_stop_count: 1,
            delivery_stop_count: 1,
            total_order_count: members.length,
            total_weight_kg: totalWeight,
            total_volume_cbm: Number(totalVolume.toFixed(3)),
            total_pallet_qty: Math.max(1, Math.round(totalVolume / 1.6)),
            weight_loading_rate: Number(
              (Math.min((totalWeight / vt.weight) * 100, 100)).toFixed(2),
            ),
            volume_loading_rate: Number(
              (Math.min((totalVolume / vt.cbm) * 100, 100)).toFixed(2),
            ),
            planned_distance_km: lane.km,
            planned_duration_min: lane.min,
            planned_start_at: startAt,
            planned_end_at: endAt,
            planned_toll_fee: lane.toll,
            estimated_billing_amount: Math.round((lane.km * 1650) / 1000) * 1000,
            estimated_payment_amount: Math.round((lane.km * 1280) / 1000) * 1000,
            estimated_margin: Math.round((lane.km * 370) / 1000) * 1000,
            status: plan.tripStatus,
            is_auto_generated: rnd() < 0.4,
            confirmed_at: plan.tripStatus === 'DRAFT' ? null : startAt,
          },
        });

        for (const [i, m] of members.entries()) {
          await prisma.trip_order.create({
            data: {
              tenant_id: tenantId,
              trip_id: trip.trip_id,
              order_id: m.id,
              seq_no: i + 1,
              assigned_weight_kg: m.weight,
              assigned_volume_cbm: m.volume,
              allocation_basis: 'WEIGHT',
            },
          });
        }

        for (const [i, stop] of [
          { type: 'PICKUP' as const, loc: from, at: startAt },
          { type: 'DELIVERY' as const, loc: to, at: addMinutes(startAt, lane.min) },
        ].entries()) {
          await prisma.trip_stop.create({
            data: {
              tenant_id: tenantId,
              trip_id: trip.trip_id,
              stop_seq: i + 1,
              stop_type: stop.type,
              location_id: stop.loc.id,
              location_name: stop.loc.name,
              address1: stop.loc.addr,
              latitude: stop.loc.lat,
              longitude: stop.loc.lng,
              planned_arrival_at: stop.at,
              planned_departure_at: addMinutes(stop.at, 45),
              planned_service_min: 45,
              distance_from_prev_km: i === 0 ? 0 : lane.km,
              duration_from_prev_min: i === 0 ? 0 : lane.min,
              status:
                plan.tripStatus === 'COMPLETED' || plan.tripStatus === 'CLOSED'
                  ? 'COMPLETED'
                  : plan.tripStatus === 'EXECUTING' && i === 0
                    ? 'COMPLETED'
                    : 'PENDING',
            },
          });
        }

        // --- 배정 ---------------------------------------------------
        const needsAllocation = plan.tripStatus !== 'CONFIRMED' && plan.tripStatus !== 'DRAFT';
        if (needsAllocation) {
          const allocStatus = plan.tripStatus === 'ALLOCATING' ? 'REQUESTED' : 'ACCEPTED';
          const requestedAt = addMinutes(startAt, -180);
          await prisma.allocation.create({
            data: {
              tenant_id: tenantId,
              trip_id: trip.trip_id,
              allocation_seq: 1,
              carrier_id: vinfo.carrierId,
              allocation_type: pick(['DIRECT', 'DIRECT', 'ROTATION', 'SPOT'] as const),
              allocated_amount: Math.round((lane.km * 1280) / 1000) * 1000,
              total_amount: Math.round((lane.km * 1280) / 1000) * 1000,
              currency_code: 'KRW',
              status: allocStatus,
              requested_at: requestedAt,
              respond_deadline_at: addMinutes(requestedAt, 90),
              responded_at: allocStatus === 'ACCEPTED' ? addMinutes(requestedAt, 22) : null,
            },
          });
          allocationCount += 1;
        }

        // --- 배차 ---------------------------------------------------
        const needsDispatch = ['DISPATCHED', 'EXECUTING', 'COMPLETED', 'CLOSED'].includes(
          plan.tripStatus,
        );
        if (needsDispatch) {
          const dispatchStatus =
            plan.tripStatus === 'DISPATCHED'
              ? pick(['NOTIFIED', 'ACCEPTED', 'CONFIRMED'] as const)
              : plan.tripStatus === 'EXECUTING'
                ? 'STARTED'
                : 'COMPLETED';

          const dispatch = await prisma.dispatch.create({
            data: {
              tenant_id: tenantId,
              dispatch_no: dispatchNos[tripIndex]!.no,
              trip_id: trip.trip_id,
              dispatch_date: todayDate(),
              dispatch_type: pick(['CONSIGNED', 'CONTRACTED', 'OWN'] as const),
              carrier_id: vinfo.carrierId,
              carrier_name: partnerName.get(vinfo.carrierId)!,
              vehicle_id: vehicle,
              vehicle_no: vinfo.no,
              vehicle_type_id: vinfo.typeId,
              vehicle_type_name: vinfo.typeName,
              driver_id: vinfo.driverId,
              driver_name: DRIVER_NAMES[driverIds.indexOf(vinfo.driverId)] ?? '기사',
              driver_mobile: `010-${String(intBetween(2000, 9999))}-${String(intBetween(1000, 9999))}`,
              planned_start_at: startAt,
              planned_end_at: endAt,
              status: dispatchStatus,
              dispatched_at: addMinutes(startAt, -120),
              notified_at: addMinutes(startAt, -118),
              accepted_at: dispatchStatus === 'NOTIFIED' ? null : addMinutes(startAt, -95),
              dispatch_amount: Math.round((lane.km * 1280) / 1000) * 1000,
            },
          });
          dispatchCount += 1;
          conflictAnchor ??= { id: vehicle, end: endAt.getTime() };

          // --- 운송실행 -------------------------------------------
          if (['EXECUTING', 'COMPLETED', 'CLOSED'].includes(plan.tripStatus)) {
            const running = plan.tripStatus === 'EXECUTING';
            const delayMin = running && rnd() < 0.35 ? intBetween(18, 95) : 0;
            const progress = running ? Number(between(18, 88).toFixed(2)) : 100;

            await prisma.transport_execution.create({
              data: {
                tenant_id: tenantId,
                dispatch_id: dispatch.dispatch_id,
                trip_id: trip.trip_id,
                execution_date: todayDate(),
                carrier_id: vinfo.carrierId,
                vehicle_id: vehicle,
                driver_id: vinfo.driverId,
                actual_start_at: addMinutes(startAt, intBetween(-10, 25)),
                actual_end_at: running ? null : addMinutes(endAt, intBetween(-20, 40)),
                start_odometer: intBetween(40_000, 480_000),
                actual_distance_km: running
                  ? Number(((lane.km * progress) / 100).toFixed(1))
                  : lane.km,
                status: running ? pick(['IN_TRANSIT', 'IN_TRANSIT', 'ARRIVED'] as const) : 'COMPLETED',
                current_stop_seq: running ? 1 : 2,
                completed_stop_count: running ? 1 : 2,
                total_stop_count: 2,
                progress_rate: progress,
                last_latitude: Number(
                  (from.lat + (to.lat - from.lat) * (progress / 100)).toFixed(7),
                ),
                last_longitude: Number(
                  (from.lng + (to.lng - from.lng) * (progress / 100)).toFixed(7),
                ),
                last_location_at: addMinutes(new Date(), -intBetween(1, 12)),
                last_speed_kmh: running ? intBetween(0, 96) : 0,
                delay_minutes: delayMin,
                is_delayed: delayMin > 0,
                completed_at: running ? null : addMinutes(endAt, 10),
              },
            });
            executionCount += 1;
          }
        }

        tripIndex += 1;
      }
    }

    console.log(
      `편성 ${tripIndex}건 · 배정 ${allocationCount}건 · 배차 ${dispatchCount}건 · 운송실행 ${executionCount}건`,
    );
    console.log('\n완료. 관제 현황에서 확인하세요.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
