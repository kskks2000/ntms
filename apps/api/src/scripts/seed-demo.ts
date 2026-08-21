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
// 실적과 집계는 앱이 쓰는 함수를 그대로 부른다. 시드가 자기 계산을 따로
// 가지면 데모의 숫자와 앱이 만든 숫자가 갈라진다.
import { EXECUTION_FOR_ACTUAL, buildActualFromExecution } from '../actual/actual-build.js';
import { rebuildAggregates } from '../actual/actual-aggregate.js';

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
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/**
 * `date` 컬럼에 넣을 값을 UTC 자정으로 맞춘다.
 *
 * 로컬 자정으로 만든 Date 는 KST(+9) 에서 전날 15시 UTC 가 되고, Postgres 의
 * date 는 UTC 날짜만 취하므로 하루 앞당겨 저장된다. 2026-01-01 로 넣은 계약
 * 시작일이 화면에 2025-12-31 로 뜨는 것이 그 증상이다.
 */
const dateOnly = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * 만료일을 실제 차고처럼 흩는다.
 *
 * 유효기간 게이지는 기준정보 화면의 핵심 장치인데, 모든 값이 여유롭거나
 * 모두 비어 있으면 그 장치가 한 번도 켜지지 않는다. 대략 1/8 은 이미 지났고
 * 1/6 은 두 달 안에 끝나며, 나머지는 90~360일 사이에 고르게 퍼지도록 한다.
 * 남은 날이 제각각이어야 게이지 막대의 길이 차이가 정보로 읽힌다.
 *
 * 난수 대신 해시를 쓴다 — 실행할 때마다 화면이 달라지면 확인이 어렵다.
 * `seq * 4 + slot` 같은 선형식은 슬롯마다 나머지가 고정돼(보험은 전부 만료,
 * 면허는 전부 임박) 열 하나가 한 가지 색으로만 칠해지므로 쓰지 않는다.
 *
 * @param seq  대상의 일련번호
 * @param slot 같은 대상이 여러 기한을 가질 때 겹치지 않게 하는 오프셋
 */
function expiryFor(seq: number, slot: number): Date {
  const h = hash32(seq * 7 + slot * 101);
  const bucket = h % 24;
  const days =
    bucket < 3
      ? -(3 + ((h >>> 5) % 120))
      : bucket < 7
        ? 5 + ((h >>> 5) % 55)
        : 90 + ((h >>> 5) % 271);
  return dateOnly(addDays(new Date(), days));
}

/** 32비트 정수 해시 (Thomas Wang). 값을 흩기만 하면 되므로 이 정도면 충분하다 */
function hash32(n: number): number {
  let x = n | 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = x + (x << 3);
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

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
/*
  오늘. date 컬럼용이므로 dateOnly 를 거친다.

  setHours(0,0,0,0) 로 만든 로컬 자정은 KST 에서 전날 15시 UTC 라, 오더·
  트립·실행의 날짜가 전부 하루 앞당겨 저장된다. 값이 하루 어긋나면 화면은
  멀쩡한 데이터를 그리므로 눈치채기 어렵다 — 틀린 날의 데이터가 정상으로
  보이기 때문이다.
*/
const todayDate = () => dateOnly(new Date());

/**
 * 예외 유형 · 설명 · 조치 한 묶음.
 *
 * 셋을 따로 뽑으면 서로 안 맞는 줄이 나오고, 화면을 보는 사람은 그 한 줄에서
 * 데이터 전체를 못 믿기 시작한다. 데모 데이터가 그럴듯해야 화면의 판단이
 * 맞는지 볼 수 있다.
 */
/** 인수 결과와 그 사유. 둘은 늘 같이 다닌다 */
const POD_FLAWS = [
  { result: 'DAMAGED' as const, reason: '외박스 눌림 2박스, 수하처 확인서 수령' },
  { result: 'SHORTAGE' as const, reason: '검수 수량 부족, 재고 확인 요청' },
  { result: 'PARTIAL' as const, reason: '일부만 인수, 잔여분 익일 재배송' },
] as const;

const EXCEPTION_KINDS = [
  {
    type: 'TRAFFIC' as const,
    description: '경부고속도로 안성분기점 사고로 정체',
    action: '국도 우회 안내, 화주에 도착 지연 통보',
  },
  {
    type: 'LOADING_DELAY' as const,
    description: '상차지 도크가 차 있어 대기',
    action: '상차지에 도크 배정 요청, 다음 회차 시간 조정',
  },
  {
    type: 'BREAKDOWN' as const,
    description: '냉동기 경고등 점등, 갓길 점검',
    action: '인근 정비소에서 냉매 보충 후 재출발',
  },
  {
    type: 'WEATHER' as const,
    description: '폭우로 서행 구간 발생',
    action: '기상 정보 확인 후 출발 시각 재조정',
  },
  {
    type: 'CUSTOMER_ABSENT' as const,
    description: '하차지 담당자 부재로 인수 대기',
    action: '수하처 연락 후 대체 인수인 확인',
  },
  {
    type: 'DOCUMENT' as const,
    description: '거래명세서 누락으로 게이트 통과 지연',
    action: '사본 전송으로 반입 처리, 원본 익일 제출',
  },
] as const;

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
  { code: 'SH-1001', name: '(주)한빛식품', biz: '3018112345', grade: 'S', tel: '02-555-1200', mgr: '정하윤', mgrTel: '010-3412-7781', credit: 500_000_000, terms: 45, ceo: '한명수' },
  { code: 'SH-1002', name: '(주)대명전자', biz: '2148856701', grade: 'A', tel: '031-770-3400', mgr: '오세진', mgrTel: '010-2287-4460', credit: 300_000_000, terms: 30, ceo: '유대현' },
  { code: 'SH-1003', name: '서일화학(주)', biz: '4028834512', grade: 'A', tel: '041-580-2100', mgr: '배성호', mgrTel: '010-9930-1152', credit: 300_000_000, terms: 30, ceo: '곽재승' },
  { code: 'SH-1004', name: '(주)미래유통', biz: '1138645902', grade: 'B', tel: '02-2020-7700', mgr: '한지원', mgrTel: '010-7745-2038', credit: 150_000_000, terms: 20, ceo: '민경호' },
] as const;

const CARRIERS = [
  { code: 'CR-2001', name: '(주)한결운수', biz: '6068811234', grade: 'S', tel: '051-600-8800', mgr: '김도현', mgrTel: '010-5521-6604', terms: 20, ceo: '주영달' },
  { code: 'CR-2002', name: '동아로지스(주)', biz: '3138822345', grade: 'A', tel: '032-450-1900', mgr: '윤태경', mgrTel: '010-3308-9917', terms: 30, ceo: '차동혁' },
  { code: 'CR-2003', name: '삼진택배운송', biz: '5148833456', grade: 'B', tel: '062-950-2300', mgr: '문상철', mgrTel: '010-6614-3325', terms: 30, ceo: '엄상범' },
  { code: 'CR-2004', name: '신흥물류(주)', biz: '4038844567', grade: 'A', tel: '043-260-5500', mgr: '서민경', mgrTel: '010-2119-7743', terms: 25, ceo: '나종길' },
  { code: 'CR-2005', name: '대륙운송(주)', biz: '2028855678', grade: 'B', tel: '053-580-4100', mgr: '조현우', mgrTel: '010-8802-5510', terms: 30, ceo: '천우석' },
] as const;

const CONSIGNEES = [
  { code: 'CN-3001', name: '수도권물류센터', tel: '031-8000-1000', mgr: '임채원', mgrTel: '010-4470-8823', ceo: '구본석' },
  { code: 'CN-3002', name: '영남권 대리점', tel: '051-900-2000', mgr: '노기석', mgrTel: '010-7036-1194', ceo: '탁현서' },
  { code: 'CN-3003', name: '호남권 대리점', tel: '062-700-3000', mgr: '강수아', mgrTel: '010-5583-2270', ceo: '방인규' },
] as const;

/** 매입처. 운송사와 달리 운송을 대지 않고 원가만 붙는다 (유류 · 정비 · 부대) */
const VENDORS = [
  { code: 'VD-5001', name: '대성에너지(주)', biz: '1078812340', tel: '02-410-6600', mgr: '진형준', mgrTel: '010-3350-8871', ceo: '최광일', terms: 15 },
  { code: 'VD-5002', name: '한성정비센터', biz: '3098823451', tel: '031-350-7200', mgr: '허성민', mgrTel: '010-8827-3312', ceo: '위재훈', terms: 30 },
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

/**
 * 거점 유형이 정하는 운영 조건.
 *
 * 편성 엔진은 여기 있는 네 값으로 시간창과 정차 시간을 잡는다. 항만은
 * 24시간 돌지만 반출입에 시간이 걸리고 지게차 대신 크레인을 쓰며 예약이
 * 필수다. 점포는 낮에만 열고 물량이 작아 금방 끝난다. 이 차이가 그대로
 * 배차 결과를 가른다.
 */
/** 좌표를 아직 확인하지 않은 거점. 이 곳이 낀 구간은 거리가 틀어질 수 있다 */
const UNVERIFIED_GEO = new Set(['LC-GJST', 'LC-CJPL']);

const LOCATION_PROFILE: Record<
  string,
  {
    open: string;
    close: string;
    load: number;
    unload: number;
    forklift: boolean;
    reserve: boolean;
  }
> = {
  PORT: { open: '00:00', close: '23:59', load: 70, unload: 60, forklift: false, reserve: true },
  HUB: { open: '00:00', close: '23:59', load: 30, unload: 25, forklift: true, reserve: false },
  DC: { open: '06:00', close: '22:00', load: 45, unload: 40, forklift: true, reserve: false },
  WAREHOUSE: { open: '08:00', close: '20:00', load: 50, unload: 45, forklift: true, reserve: false },
  PLANT: { open: '08:00', close: '18:00', load: 60, unload: 50, forklift: true, reserve: true },
  STORE: { open: '09:00', close: '18:00', load: 25, unload: 20, forklift: false, reserve: false },
};

/** "HH:MM" 을 time 컬럼용 Date 로. 로컬 시각으로 만들면 UTC 저장 때 밀린다 */
const clockAt = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

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

/**
 * 기사 명부. 앞의 24명이 재직이고 뒤의 4명이 휴직·정지·퇴사다.
 *
 * 차량 24대에 재직 기사를 한 명씩 붙여야 하므로 명부는 차량 수보다 크다.
 * 명부 인원과 실제 배차 가능 인원이 다르다는 것이 기사 화면의 요점이다.
 */
const DRIVER_NAMES = [
  '김상호', '박정민', '이근우', '최영달', '정재현', '한동수', '오세진', '윤기태',
  '장병철', '임형준', '서만수', '조광일', '신대호', '권영수', '문태식', '배중근',
  '황인철', '노경식', '전상우', '고재만', '심우석', '류병호', '남기훈', '양동일',
  '표성진', '용해균', '지창민', '석동환',
] as const;

/** 재직이 아닌 기사는 명부 끝에 몰아 둔다 — 앞의 24명이 배차 대상이다 */
const NON_ACTIVE_DRIVERS: Record<number, 'LEAVE' | 'SUSPENDED' | 'RESIGNED'> = {
  24: 'LEAVE',
  25: 'LEAVE',
  26: 'SUSPENDED',
  27: 'RESIGNED',
};

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

    /*
      실적을 확정한 사람.

      확정 이력이 "확정 · —" 로 비어 있으면 화면이 고장난 것처럼 보인다.
      시드가 만든 것이라는 표시로 관리자 계정을 쓴다.
    */
    const adminUser = await prisma.user_account.findFirst({
      where: { tenant_id: tenantId, login_id: 'admin' },
      select: { user_id: true },
    });
    const adminUserId = adminUser?.user_id ?? null;

    if (reset) {
      console.log('기존 데모 데이터 삭제 중...');
      // FK 역순으로 지운다. order_status_history 는 트리거가 만든 것이라
      // 오더보다 먼저 치워야 한다.
      /*
        FK 역순으로 지운다. 실적 계열이 실행 · 인수증을 물고 있으므로
        그것들보다 먼저 나간다. 새 자식 테이블을 만들면 여기에도 넣을 것 —
        빠뜨리면 다음 --reset 이 FK 로 죽는다.
      */
      await prisma.kpi_daily.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.driver_work_log.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.vehicle_operation_daily.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.actual_order.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.transport_actual.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.pod.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.transport_exception.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.gps_log.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.execution_stop.deleteMany({ where: { tenant_id: tenantId } });
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
      p: {
        code: string;
        name: string;
        biz?: string;
        grade?: string;
        tel?: string;
        mgr?: string;
        mgrTel?: string;
        ceo?: string;
        credit?: number;
        terms?: number;
      },
      roles: { shipper?: boolean; carrier?: boolean; consignee?: boolean; vendor?: boolean },
    ) => {
      const row = await prisma.business_partner.create({
        data: {
          tenant_id: tenantId,
          partner_code: p.code,
          partner_name: p.name,
          is_shipper: roles.shipper ?? false,
          is_carrier: roles.carrier ?? false,
          is_consignee: roles.consignee ?? false,
          is_vendor: roles.vendor ?? false,
          business_no: p.biz ?? null,
          tel: p.tel ?? null,
          ceo_name: p.ceo ?? null,
          manager_name: p.mgr ?? null,
          manager_tel: p.mgrTel ?? null,
          grade: (p.grade as 'S' | 'A' | 'B' | 'C' | 'D') ?? null,
          settlement_cycle: 'MONTHLY',
          closing_day: 31,
          // 유예일은 협상 결과라 거래처마다 다르다. 등급이 좋을수록 길다
          payment_terms_days: p.terms ?? 30,
          // 여신한도는 화주에게만 건다 — 운송사는 우리가 돈을 주는 쪽이다
          credit_limit: p.credit ?? null,
        },
      });
      partnerId.set(p.code, row.partner_id);
      partnerName.set(row.partner_id, p.name);
      return row.partner_id;
    };

    for (const p of SHIPPERS) await createPartner(p, { shipper: true });
    for (const p of CARRIERS) await createPartner(p, { carrier: true });
    for (const p of CONSIGNEES) await createPartner(p, { consignee: true });
    for (const p of VENDORS) await createPartner(p, { vendor: true });
    console.log(
      `거래처 ${SHIPPERS.length + CARRIERS.length + CONSIGNEES.length + VENDORS.length}건 ` +
        `(화주 ${SHIPPERS.length} · 운송사 ${CARRIERS.length} · ` +
        `수하처 ${CONSIGNEES.length} · 매입처 ${VENDORS.length})`,
    );

    // --- 상하차지 ---------------------------------------------------
    const locId = new Map<string, bigint>();
    const locInfo = new Map<
      string,
      { id: bigint; name: string; addr: string; lat: number; lng: number; zone: bigint }
    >();
    for (const l of LOCATIONS) {
      const profile = LOCATION_PROFILE[l.type]!;
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
          // 좌표 검증은 실무에서 잘 밀린다. 새로 튼 거점 몇 곳은 미검증으로 둔다
          geo_verified: !UNVERIFIED_GEO.has(l.code),
          dock_count: l.dock,
          open_time: clockAt(profile.open),
          close_time: clockAt(profile.close),
          standard_load_min: profile.load,
          standard_unload_min: profile.unload,
          has_forklift: profile.forklift,
          require_reservation: profile.reserve,
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
    //
    // 간선은 대개 왕복으로 등록한다 — 복로가 없으면 돌아오는 트립의 거리가
    // 잡히지 않아 운임이 한쪽만 계산된다. 여기서는 간선 대부분에 역방향을
    // 만들되 몇 구간은 일부러 편도로 남긴다. "편도만 등록" 지표가 실제로
    // 잡아내야 할 상태이므로, 전부 왕복이면 그 지표가 늘 0이 되어 죽는다.
    const ONE_WAY_ONLY = new Set(['LC-ICPORT>LC-CJPL', 'LC-YSICD>LC-GCHUB']);
    const routes: Array<{
      from: string;
      to: string;
      km: number;
      min: number;
      toll: number;
    }> = [];
    for (const lane of LANES) {
      routes.push({ ...lane });
      if (ONE_WAY_ONLY.has(`${lane.from}>${lane.to}`)) continue;
      // 이미 반대 방향이 원본에 있으면 두 번 넣지 않는다
      if (LANES.some((o) => o.from === lane.to && o.to === lane.from)) continue;
      // 복로는 같은 길이 아니다. 회차 구간과 신호 때문에 조금 더 걸린다
      routes.push({
        from: lane.to,
        to: lane.from,
        km: Math.round(lane.km * 1.02),
        min: Math.round(lane.min * 1.04),
        toll: lane.toll,
      });
    }

    for (const [i, lane] of routes.entries()) {
      await prisma.distance_master.create({
        data: {
          tenant_id: tenantId,
          from_location_id: locId.get(lane.from)!,
          to_location_id: locId.get(lane.to)!,
          route_type: 'FASTEST',
          distance_km: lane.km,
          duration_minutes: lane.min,
          toll_fee: lane.toll,
          // 지도 API 로 받은 것과 사람이 고친 것이 섞여 있는 게 보통이다
          source: i % 3 === 0 ? 'MANUAL' : 'MAP_API',
          // 확인 시점도 제각각이다. 오래된 구간일수록 다시 재 볼 값이다
          last_verified_at: addDays(new Date(), -((hash32(i * 13) % 300) + 5)),
        },
      });
    }
    console.log(`라우트 ${routes.length}건`);

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
          license_type: pick(['1종 대형', '1종 대형', '1종 보통', '1종 특수(트레일러)']),
          license_expire_date: expiryFor(i, 2),
          cargo_qualification_no: `CQ-${intBetween(10000, 99999)}`,
          cargo_qualification_expire_date: expiryFor(i, 3),
          hire_date: dateOnly(
            new Date(2019 + (i % 6), intBetween(0, 11), intBetween(1, 28)),
          ),
          // 정시율은 화면에서 정수로 읽는다. 소수 둘째 자리까지 저장하면
          // 없는 정밀도를 있는 것처럼 보이게 한다
          on_time_rate: Number(between(88, 99.5).toFixed(1)),
          evaluation_score: Number(between(3.6, 4.9).toFixed(1)),
          // 사고 이력은 드물지만 0이 전부면 배차 때 볼 이유가 없는 열이 된다
          accident_count: i % 8 === 3 ? 1 : i % 11 === 5 ? 2 : 0,
          status: NON_ACTIVE_DRIVERS[i] ?? 'ACTIVE',
          is_active: NON_ACTIVE_DRIVERS[i] === undefined,
        },
      });
      driverIds.push(row.driver_id);
    }

    /*
      차종 구성은 물동량을 감당할 수 있어야 한다.

      장거리 한 건이 5~7시간을 잡아먹는데 25톤이 두 대뿐이면 하루에 네
      건밖에 못 돌고, 나머지는 갈 곳이 없어 겹쳐 잡힌다 — 데이터가 아니라
      차량 구성의 문제다.

      트립 무게가 대개 19~21톤이라 실을 수 있는 차는 25톤 트레일러뿐이고,
      그 트립들의 시간대가 하루에 걸쳐 겹친다. 열 대는 있어야 한 대에
      쌓이지 않는다.
    */
    const VEHICLE_PLAN = [
      'TR-25', 'TR-25', 'TR-25', 'TR-25', 'TR-25',
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

          // 보험 · 검사 만료. 실제 차고를 닮게 흩는다 —
          // 대부분은 여유가 있고, 몇 대는 두 달 안에 끝나고, 한둘은 이미 지났다.
          // 전부 여유롭게 만들면 만료 경고가 한 번도 뜨지 않아
          // 그 기능이 동작하는지 확인할 수 없다.
          insurance_company: pick(['DB손해보험', '삼성화재', 'KB손해보험', '현대해상']),
          insurance_policy_no: `INS-${intBetween(100000, 999999)}`,
          insurance_expire_date: expiryFor(i, 0),
          inspection_date: dateOnly(addDays(new Date(), -intBetween(120, 400))),
          next_inspection_date: expiryFor(i, 1),
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
    //
    // 운임표는 머리(rate_table)만 있으면 아무 금액도 계산되지 않는다. 실제로
    // 금액을 만드는 것은 상세(rate_table_detail) 한 줄 한 줄이므로, 산정방식에
    // 맞는 상세를 함께 넣는다 — 거리요율은 거리구간 × 톤급, 권역요율은
    // 출발권역 × 도착권역, 전세차는 차종별 트립 단가다.
    //
    // 매입(지급)은 매출(청구)의 약 85% 로 둔다. 그래야 정산 화면에서 마진이
    // 음수로 뒤집히지 않는다.
    const PAY_RATIO = 0.85;

    /** 거리요율: 거리 구간 4개 × 톤급 4개. 기본료 + km 단가 */
    const DISTANCE_BANDS = [
      { from: 0, to: 50 },
      { from: 50, to: 150 },
      { from: 150, to: 300 },
      { from: 300, to: null },
    ] as const;
    const DISTANCE_TIERS = [
      { type: 'CG-25', base: 60_000, perKm: 900 },
      { type: 'WG-5', base: 95_000, perKm: 1_250 },
      { type: 'WG-11', base: 150_000, perKm: 1_750 },
      { type: 'TR-25', base: 230_000, perKm: 2_400 },
    ] as const;

    /** 권역요율: 실제로 오가는 짝만 넣는다. 없는 짝은 거리요율로 떨어진다 */
    const ZONE_PAIRS = [
      { from: 'ZN-CAP', to: 'ZN-CAP', amount: 180_000 },
      { from: 'ZN-CAP', to: 'ZN-CHU', amount: 320_000 },
      { from: 'ZN-CAP', to: 'ZN-YEO', amount: 620_000 },
      { from: 'ZN-CAP', to: 'ZN-HOS', amount: 560_000 },
      { from: 'ZN-CAP', to: 'ZN-GAN', amount: 380_000 },
      { from: 'ZN-CHU', to: 'ZN-YEO', amount: 400_000 },
      { from: 'ZN-CHU', to: 'ZN-HOS', amount: 350_000 },
      { from: 'ZN-YEO', to: 'ZN-CAP', amount: 640_000 },
      { from: 'ZN-HOS', to: 'ZN-CAP', amount: 580_000 },
    ] as const;

    /** 전세차: 차종 하나에 트립 단가 하나 */
    const TRIP_RATES: Record<string, number> = {
      'CG-1': 130_000,
      'CG-25': 190_000,
      'WG-5': 280_000,
      'WG-11': 430_000,
      'RF-5': 340_000,
      'RF-11': 520_000,
      'TR-25': 700_000,
    };

    const tariffs = [
      { code: 'RT-BIL-DIST', name: '기본 거리요율 (매출)', target: 'BILLING', method: 'DISTANCE', partner: null, openEnded: true, endsSoon: false, minCharge: 90_000, fuel: true, taxable: true },
      { code: 'RT-BIL-ZONE', name: '권역별 운임 (매출)', target: 'BILLING', method: 'ZONE', partner: 'SH-1001', openEnded: false, endsSoon: false, minCharge: 150_000, fuel: true, taxable: true },
      { code: 'RT-BIL-TRIP', name: '전세차 운임 (매출)', target: 'BILLING', method: 'PER_TRIP', partner: 'SH-1002', openEnded: false, endsSoon: true, minCharge: 130_000, fuel: false, taxable: true },
      { code: 'RT-PAY-DIST', name: '기본 거리요율 (매입)', target: 'PAYMENT', method: 'DISTANCE', partner: null, openEnded: true, endsSoon: false, minCharge: 75_000, fuel: true, taxable: true },
      { code: 'RT-PAY-CR01', name: '한결운수 계약요율 (매입)', target: 'PAYMENT', method: 'ZONE', partner: 'CR-2001', openEnded: false, endsSoon: false, minCharge: 120_000, fuel: true, taxable: true },
      { code: 'RT-PAY-SPOT', name: '스팟 운임 (매입)', target: 'PAYMENT', method: 'PER_TRIP', partner: null, openEnded: false, endsSoon: true, minCharge: 110_000, fuel: false, taxable: false },
    ] as const;

    const yearStart = dateOnly(new Date(new Date().getFullYear(), 0, 1));
    const yearEnd = dateOnly(new Date(new Date().getFullYear(), 11, 31));
    let rateDetailCount = 0;

    for (const t of tariffs) {
      const table = await prisma.rate_table.create({
        data: {
          tenant_id: tenantId,
          rate_table_code: t.code,
          rate_table_name: t.name,
          rate_target: t.target,
          rate_method: t.method,
          partner_id: t.partner ? partnerId.get(t.partner)! : null,
          currency_code: 'KRW',
          apply_start_date: yearStart,
          // 연 단위 계약이 흔하다. 일부는 무기한으로 두어 두 경우를 다 보인다.
          apply_end_date: t.endsSoon
            ? dateOnly(addDays(new Date(), intBetween(12, 50)))
            : t.openEnded
              ? null
              : yearEnd,
          min_charge_amount: t.minCharge,
          apply_fuel_surcharge: t.fuel,
          is_taxable: t.taxable,
          status: 'APPROVED',
          approved_at: new Date(new Date().getFullYear(), 0, 2),
          version_no: 1,
        },
      });

      const scale = t.target === 'PAYMENT' ? PAY_RATIO : 1;
      const round = (n: number) => Math.round((n * scale) / 1000) * 1000;
      const details: Array<Record<string, unknown>> = [];

      if (t.method === 'DISTANCE') {
        for (const tier of DISTANCE_TIERS) {
          for (const band of DISTANCE_BANDS) {
            // 멀수록 km 단가가 내려간다 — 실제 운임표가 그렇게 생겼다
            const taper = band.from >= 300 ? 0.8 : band.from >= 150 ? 0.88 : 1;
            details.push({
              vehicle_type_id: vtypeId.get(tier.type)!,
              distance_from: band.from,
              distance_to: band.to,
              base_amount: round(tier.base),
              unit_rate: Math.round(tier.perKm * taper * scale),
              min_amount: round(tier.base),
              // 좁은 구간이 먼저 잡혀야 한다
              priority: band.to === null ? 90 : 100,
              remark: `${band.from}~${band.to ?? ''}km`,
            });
          }
        }
      } else if (t.method === 'ZONE') {
        for (const pair of ZONE_PAIRS) {
          details.push({
            from_zone_id: zoneId.get(pair.from)!,
            to_zone_id: zoneId.get(pair.to)!,
            base_amount: round(pair.amount),
            extra_stop_amount: round(30_000),
            waiting_free_min: 60,
            waiting_rate_hour: round(25_000),
            priority: 100,
          });
        }
      } else {
        for (const vt of VEHICLE_TYPES) {
          details.push({
            vehicle_type_id: vtypeId.get(vt.code)!,
            base_amount: round(TRIP_RATES[vt.code]!),
            extra_stop_amount: round(40_000),
            waiting_free_min: 90,
            waiting_rate_hour: round(30_000),
            priority: 100,
          });
        }
      }

      await prisma.rate_table_detail.createMany({
        data: details.map((d, i) => ({
          tenant_id: tenantId,
          rate_table_id: table.rate_table_id,
          line_no: i + 1,
          ...d,
        })) as never,
      });
      rateDetailCount += details.length;
    }
    console.log(`단가 ${tariffs.length}건 · 요율 상세 ${rateDetailCount}건`);

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
    /** 차량별 계기판. 운행마다 이어져야 운행일보의 총 주행이 말이 된다 */
    const odometerByVehicle = new Map<string, number>();
    /** 일부러 만들 겹침의 상대. 배차가 생긴 첫 트립을 붙잡아 둔다 */
    let conflictAnchor: { id: bigint; end: number } | null = null;

    let allocationCount = 0;
    let dispatchCount = 0;
    let executionCount = 0;
    let stopActualCount = 0;
    let gpsCount = 0;
    let exceptionCount = 0;
    let podCount = 0;

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

        /* --- 언제 · 어느 차에 붙일까 ---------------------------------

          **시각을 먼저 정하고, 그 시각에 비어 있는 차를 고른다.**

          순서가 중요하다. 차를 먼저 고르면 그 차가 비는 시각이 곧 출발
          시각이 되는데, 그러면 '완료' 로 표시된 트립이 밤 11시에 끝나는
          것으로 잡힌다. 화면은 그래도 멀쩡히 그려지므로 이 어긋남은 눈에
          잘 안 띄는데, 실제로는 —

            인수증 경과 시간이 전부 0시간이 된다 (아직 안 끝났으니까)
            관제의 정시율이 아직 오지 않은 도착을 세고 있다
            지연 전파 축이 미래 시각을 '실적' 으로 그린다

          그래서 상태가 시각을 정한다. 끝난 것은 지금보다 앞에, 진행 중인
          것은 지금을 물고, 아직 안 떠난 것은 지금보다 뒤에.
        */
        const durationMs = (lane.min + 90) * 60_000;
        const dayOpen = todayAt(OPERATING_HOURS.from, 0).getTime();
        const nowMs = Date.now();

        const targetStart = (() => {
          switch (plan.tripStatus) {
            case 'CLOSED':
              /*
                정산까지 끝난 건은 어제 것이다.

                오늘 안에 다 넣으면 인수증 경과 막대가 전부 하루 안쪽이 되고,
                "이틀째 안 들어온 인수증" 이라는 이 화면의 본론이 데이터에
                한 건도 없게 된다.
              */
              return (
                todayAt(OPERATING_HOURS.from).getTime() -
                24 * 3_600_000 +
                intBetween(0, 480) * 60_000
              );
            case 'COMPLETED':
              /*
                오늘 아침에 떠나 지금보다 한 시간 이상 전에 끝났다.

                운영시간 안에 두는 이유는 배차판 때문이다. 새벽 두 시에
                시작하는 막대가 하나 있으면 간트 축이 그만큼 늘어나, 정작
                지금 시각 근처가 화면 밖으로 밀린다.
              */
              return clamp(
                nowMs - durationMs - intBetween(60, 300) * 60_000,
                todayAt(OPERATING_HOURS.from).getTime(),
                Math.max(todayAt(OPERATING_HOURS.from).getTime(), nowMs - durationMs - 3_600_000),
              );
            case 'EXECUTING':
              // 지금 도로 위에 있다 — 2할에서 8할 사이를 지났다
              return nowMs - Math.round(durationMs * between(0.2, 0.8));
            default:
              /*
                아직 안 떠났다. 지금부터 여섯 시간 안에 떠난다.

                영업 종료(22시) 전에 끝나도록 당기지 않는다. 일곱 시간짜리
                장거리는 어차피 자정을 넘기고, 억지로 당기면 그런 트립들이
                전부 같은 시각에 몰려 배차판이 한 줄로 겹친다.
              */
              return nowMs + intBetween(20, 360) * 60_000;
          }
        })();

        /*
          그 시각에 비어 있는 차 중 **가장 오래 논 차**를 고른다.

          먼저 찾은 차를 쓰면 목록 앞쪽 몇 대에 전부 몰린다. 차량이 트립보다
          많은데도 배차판이 겹침으로 뒤덮이고, 겹침 경고가 늘 켜져 있어
          진짜 겹침을 못 알아본다.
        */
        let chosen: { id: bigint; start: number } | null = null;
        let idlest = Number.POSITIVE_INFINITY;
        for (const id of fitting) {
          const lastEnd = lastEndByVehicle.get(id.toString()) ?? 0;
          // 앞 운행이 끝나고 40분은 쉬어야 다음 배차가 가능하다
          if (lastEnd + 40 * 60_000 > targetStart) continue;
          if (lastEnd < idlest) {
            idlest = lastEnd;
            chosen = { id, start: targetStart };
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

        /*
          그 시각에 비는 차가 없으면 가장 일찍 비는 차에 얹는다 — 시각은
          그대로 둔다. 여기서 시각을 미루면 상태와 다시 어긋나므로, 차라리
          겹침으로 남긴다. 겹침은 배차판이 경고로 보여 주지만, 하루 밀린
          날짜는 아무 화면도 안 알려 준다.
        */
        if (chosen === null) {
          /*
            **번갈아** 얹는다. 가장 한가한 차를 고르면 안 된다 —
            lastEndByVehicle 은 max 로만 갱신되므로(일부러 겹치게 만든
            배차 때문에 그렇다) 한 번 앞선 차는 영영 '가장 한가한' 자리를
            벗어나지 못하고, 넘치는 트립이 전부 그 한 대에 쌓인다.
          */
          chosen = { id: fitting[vehicleCursor % fitting.length]!, start: targetStart };
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
            // 자정을 넘겨 달리는 트립이 있으므로 출발일을 쓴다. 늘 오늘로
            // 박아 두면 어제 22시에 떠난 트립이 오늘 자로 잡혀, 배차판과
            // 관제가 같은 트립을 서로 다른 날에서 찾는다.
            plan_date: dateOnly(startAt),
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
              /*
                시간창.

                지연이 몇 분인지는 그 자체로 심각하지 않다. **마감을 넘느냐**가
                심각하다. 하차지 마감을 도착 예정 뒤 30분~4시간 사이로 흩어
                놓으면 같은 40분 지연이 어떤 트립에서는 아무 일도 아니고 어떤
                트립에서는 화주에게 전화할 일이 된다 — 관제 화면이 갈라 보여야
                하는 것이 그 차이다.
              */
              time_window_from: addMinutes(stop.at, stop.type === 'PICKUP' ? -60 : -30),
              // 마감은 두 갈래다 — 도크 닫는 시각이 빠듯한 곳(3할)과 넉넉한 곳.
              // 한 가지 폭으로 흩으면 전부 넉넉해져 지연이 아무 데도 안 걸린다.
              time_window_to: addMinutes(
                stop.at,
                stop.type === 'PICKUP' ? 180 : rnd() < 0.35 ? intBetween(25, 75) : intBetween(150, 330),
              ),
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
              dispatch_date: dateOnly(startAt),
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
            /*
              지연은 흔하다.

              실제 운송에서 정시 도착률은 좋아야 7할이다. 화면을 지연이 하나
              뜨는 데이터로 만들어 두면 "지연이 어디까지 번지나" 를 보여주는
              축이 늘 비어 있게 되고, 그 화면이 무엇을 위한 것인지 알 수 없다.
              끝난 건에도 지연을 남긴다 — 실적 확정에서 정시율을 따질 때 쓴다.
            */
            const delayMin = rnd() < (running ? 0.55 : 0.35) ? intBetween(15, 110) : 0;
            const progress = running ? Number(between(18, 88).toFixed(2)) : 100;

            /*
              정차를 먼저 읽는다. 헤더의 completed_stop_count / total_stop_count 를
              2 로 박아두면 편성으로 정차가 4곳이 된 트립에서 진행률이 거짓이 된다.
            */
            const execStops = await prisma.trip_stop.findMany({
              where: { tenant_id: tenantId, trip_id: trip.trip_id },
              orderBy: { stop_seq: 'asc' },
            });
            const totalStops = execStops.length;
            // 지금까지 몇 곳을 지났나 — 진행률을 정차 수로 환산한다
            const doneStops = running
              ? Math.max(1, Math.min(totalStops - 1, Math.floor((totalStops * progress) / 100)))
              : totalStops;

            /*
              계기판은 차마다 이어진다.

              한 대가 하루에 두 번 뛰면 두 번째 운행의 시작 계기판은 첫 번째의
              끝이어야 한다. 매번 난수로 찍으면 운행일보의 '총 주행'(끝−시작)이
              음수가 되거나 수만 km 가 된다.
            */
            const vkey = vehicle.toString();
            const startOdo =
              odometerByVehicle.get(vkey) ?? intBetween(40_000, 480_000);
            // 회송 — 직전 하차지에서 이번 상차지까지 빈 차로 간 거리
            const emptyKm = intBetween(6, 68);

            const execution = await prisma.transport_execution.create({
              data: {
                tenant_id: tenantId,
                dispatch_id: dispatch.dispatch_id,
                trip_id: trip.trip_id,
                execution_date: dateOnly(startAt),
                carrier_id: vinfo.carrierId,
                vehicle_id: vehicle,
                driver_id: vinfo.driverId,
                actual_start_at: addMinutes(startAt, intBetween(-10, 25)),
                actual_end_at: running ? null : addMinutes(endAt, intBetween(-20, 40)),
                start_odometer: startOdo,
                /*
                  계기판을 닫는다.

                  공차거리는 **계기판 차이에서 실차 노선 거리를 뺀 나머지**로
                  구한다(실적 생성 참고). 끝 계기판이 없으면 공차가 통째로
                  '모름' 이 되고, 운행일보의 공차율 칸이 전부 빈다.
                  회송(다음 상차지까지 빈 차로 가는 거리)을 여기에 얹는다.
                */
                end_odometer: running ? null : startOdo + lane.km + emptyKm,
                actual_distance_km: running
                  ? Number(((lane.km * progress) / 100).toFixed(1))
                  : lane.km,
                actual_duration_min: running ? null : lane.min + 90,
                // 주행 · 휴게를 나눠 둬야 운행일보의 하루 띠가 칸으로 갈린다
                driving_minutes: running ? null : lane.min,
                rest_minutes: running ? 0 : lane.min > 240 ? intBetween(30, 60) : 0,
                fuel_consumed_liter: running
                  ? null
                  : Number(((lane.km + emptyKm) / between(3.2, 4.6)).toFixed(1)),
                toll_fee: running ? null : lane.toll,
                status: running ? pick(['IN_TRANSIT', 'IN_TRANSIT', 'ARRIVED'] as const) : 'COMPLETED',
                current_stop_seq: running ? Math.min(doneStops + 1, totalStops) : totalStops,
                completed_stop_count: doneStops,
                total_stop_count: totalStops,
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
            odometerByVehicle.set(vkey, startOdo + lane.km + emptyKm);

            /*
              정차 실적.

              실행 헤더만 있으면 "지금 어디쯤" 은 보이지만 **지연이 어디서
              생겼고 앞으로 어디까지 번지는지**는 못 보인다. 관제 화면이
              답해야 하는 것이 그것이므로 정차 단위 실적을 함께 만든다.
            */
            // 정차 좌표는 마스터에 없을 수 있다. 없으면 노선 위에 균등 배치한다.
            const stopLat = (i: number) =>
              Number((from.lat + ((to.lat - from.lat) * i) / Math.max(1, totalStops - 1)).toFixed(7));
            const stopLng = (i: number) =>
              Number((from.lng + ((to.lng - from.lng) * i) / Math.max(1, totalStops - 1)).toFixed(7));

            for (const [si, ts] of execStops.entries()) {
              const isDone = si < doneStops;
              const isCurrent = running && si === doneStops;
              const plannedArr = ts.planned_arrival_at ?? addMinutes(startAt, si * 180);
              const plannedDep = ts.planned_departure_at ?? addMinutes(plannedArr, 40);

              // 지연은 앞 정차에서 생겨 뒤로 그대로 밀린다. 실제로도 그렇게 움직인다.
              const stopDelay = isDone ? delayMin : 0;
              const actualArr = isDone ? addMinutes(plannedArr, stopDelay) : null;
              const actualDep = isDone ? addMinutes(plannedDep, stopDelay) : null;

              await prisma.execution_stop.create({
                data: {
                  tenant_id: tenantId,
                  execution_id: execution.execution_id,
                  trip_stop_id: ts.trip_stop_id,
                  stop_seq: ts.stop_seq,
                  stop_type: ts.stop_type,
                  location_id: ts.location_id,
                  location_name: ts.location_name,
                  planned_arrival_at: plannedArr,
                  planned_departure_at: plannedDep,
                  actual_arrival_at: actualArr,
                  actual_departure_at: actualDep,
                  service_start_at: actualArr,
                  service_end_at: actualDep,
                  actual_service_min: isDone ? intBetween(20, 70) : null,
                  delay_minutes: stopDelay,
                  is_on_time: isDone ? stopDelay <= 10 : null,
                  arrival_latitude: isDone ? stopLat(si) : null,
                  arrival_longitude: isDone ? stopLng(si) : null,
                  is_geofence_verified: isDone,
                  // 이 칸은 NOT NULL DEFAULT 0 이다. 안 내린 정차는 0 이지 미상이 아니다.
                  actual_unload_weight_kg:
                    isDone && ts.stop_type === 'DELIVERY'
                      ? Number(ts.unload_weight_kg ?? 0)
                      : 0,
                  status: isDone ? 'COMPLETED' : isCurrent ? 'ARRIVED' : 'PENDING',
                },
              });
              stopActualCount += 1;
            }

            // GPS 궤적 — 출발지에서 현재 위치까지 몇 점. 지도에 지나온 길을 그린다.
            const trailPoints = running ? 12 : 20;
            for (let g = 0; g <= trailPoints; g += 1) {
              const t = (g / trailPoints) * (progress / 100);
              await prisma.gps_log.create({
                data: {
                  tenant_id: tenantId,
                  vehicle_id: vehicle,
                  driver_id: vinfo.driverId,
                  execution_id: execution.execution_id,
                  collected_at: addMinutes(
                    new Date(),
                    -Math.round((1 - g / trailPoints) * 180),
                  ),
                  latitude: Number((from.lat + (to.lat - from.lat) * t).toFixed(7)),
                  longitude: Number((from.lng + (to.lng - from.lng) * t).toFixed(7)),
                  speed_kmh: intBetween(0, 98),
                  is_ignition_on: true,
                  source: 'DTG',
                },
              });
              gpsCount += 1;
            }

            /*
              늦은 건에는 사유가 붙어 있다. 사유 없는 지연은 관제가 가장
              답답해하는 것이다.

              유형과 설명을 따로 뽑으면 "차량고장 — 고속도로 정체로 지연"
              같은 줄이 나온다. 화면을 보는 사람은 그 한 줄에서 데이터를
              못 믿기 시작하므로, 짝지어 둔 표에서 함께 꺼낸다.
            */
            if (delayMin >= 20) {
              const kind = pick(EXCEPTION_KINDS);
              // 아직 도로 위인 건은 손이 필요하니 접수 상태로 두고, 끝난
              // 건은 대개 처리돼 있다. 목록의 상태 필터가 셋 다 의미를
              // 가지려면 데이터에도 셋이 다 있어야 한다.
              const status = running
                ? pick(['REPORTED', 'REPORTED', 'INVESTIGATING'] as const)
                : pick(['ACTION_TAKEN', 'RESOLVED', 'RESOLVED', 'CLOSED'] as const);
              const settled = status === 'RESOLVED' || status === 'CLOSED';

              await prisma.transport_exception.create({
                data: {
                  tenant_id: tenantId,
                  exception_no: `EX${todayDate().toISOString().slice(0, 10).replace(/-/g, '')}${String(executionCount).padStart(4, '0')}`,
                  execution_id: execution.execution_id,
                  dispatch_id: dispatch.dispatch_id,
                  vehicle_id: vehicle,
                  driver_id: vinfo.driverId,
                  carrier_id: vinfo.carrierId,
                  exception_type: kind.type,
                  severity: delayMin >= 75 ? 'HIGH' : delayMin >= 40 ? 'MEDIUM' : 'LOW',
                  occurred_at: addMinutes(new Date(), -delayMin),
                  latitude: Number(
                    (from.lat + (to.lat - from.lat) * (progress / 200)).toFixed(7),
                  ),
                  longitude: Number(
                    (from.lng + (to.lng - from.lng) * (progress / 200)).toFixed(7),
                  ),
                  description: kind.description,
                  action_taken: status === 'REPORTED' ? null : kind.action,
                  impact_minutes: delayMin,
                  status,
                  reported_at: addMinutes(new Date(), -delayMin + 5),
                  resolved_at: settled ? addMinutes(new Date(), -Math.floor(delayMin / 3)) : null,
                  closed_at: status === 'CLOSED' ? new Date() : null,
                },
              });
              exceptionCount += 1;
            }

            /*
              늦지 않았어도 나는 예외.

              파손·오배송은 지연과 무관하게 터지고, 나중에 정산에서 공제·
              청구로 이어진다. 지연에서 파생된 예외만 있으면 예외 화면이
              "지연 목록 두 번째 판" 이 되고, 실제로 돈이 걸리는 종류가
              한 건도 안 보인다.
            */
            // 난수로 뽑으면 고정 시드에서 한 건도 안 나오는 수가 있다.
            // 이 종류가 화면에 아예 안 보이는 것이 데모에서는 더 나쁘다.
            if (!running && executionCount % 3 === 1) {
              const damage = intBetween(2, 9) * 100_000;
              await prisma.transport_exception.create({
                data: {
                  tenant_id: tenantId,
                  exception_no: `EX${todayDate().toISOString().slice(0, 10).replace(/-/g, '')}${String(executionCount).padStart(4, '0')}D`,
                  execution_id: execution.execution_id,
                  dispatch_id: dispatch.dispatch_id,
                  vehicle_id: vehicle,
                  driver_id: vinfo.driverId,
                  carrier_id: vinfo.carrierId,
                  exception_type: 'CARGO_DAMAGE',
                  severity: damage >= 600_000 ? 'HIGH' : 'MEDIUM',
                  occurred_at: addMinutes(endAt, -20),
                  latitude: to.lat,
                  longitude: to.lng,
                  description: '하차 중 파렛트 모서리 눌림, 외박스 파손 확인',
                  action_taken: '사진 촬영 후 수하처 확인서 수령, 재포장 후 인수',
                  impact_minutes: intBetween(15, 45),
                  damage_amount: damage,
                  liability_party: 'CARRIER',
                  settlement_impact: true,
                  status: 'INVESTIGATING',
                  reported_at: addMinutes(endAt, -10),
                },
              });
              exceptionCount += 1;
            }

            /*
              완료 건은 인수증이 남는다 — **오더마다 한 장씩**.

              트립 단위로 한 장만 만들면, 오더 셋을 실은 트립에서 둘은 늘
              "미도착" 으로 잡혀 수집률이 실제보다 훨씬 나쁘게 나온다.
              인수증은 화물을 받은 사람이 쓰는 것이므로 오더를 따라간다.

              그중 일부는 일부러 빠뜨린다. 인수증 화면의 본론이 **빠진 것**
              이므로, 다 들어온 데이터로는 그 화면을 볼 수 없다.
            */
            if (!running) {
              for (const [oi, m] of members.entries()) {
                // 다섯 중 하나는 아직 안 들어왔다
                if ((executionCount + oi) % 5 === 2) continue;

                podCount += 1;
                // 대부분은 정상이고, 가끔 수량이 모자라거나 파손이 있다.
                // 결과 칸이 늘 '정상' 이면 그 칸을 아무도 안 본다.
                // 결과와 사유는 짝지어 꺼낸다. 따로 뽑으면 "부분인수 —
                // 검수 수량 부족" 처럼 서로 안 맞는 줄이 나온다.
                const abnormal = (executionCount + oi) % 7 === 3;
                const flaw = abnormal ? pick(POD_FLAWS) : null;
                const result = flaw?.result ?? 'NORMAL';
                // 확인은 사람이 하나씩 누르는 일이라 밀린다. 절반쯤 남겨 둬야
                // '미확인' 필터와 확인 버튼이 화면에서 동작한다.
                const confirmed = !abnormal && (executionCount + oi) % 3 !== 0;
                const deliveredAt = addMinutes(endAt, intBetween(-15, 20));

                await prisma.pod.create({
                  data: {
                    tenant_id: tenantId,
                    execution_id: execution.execution_id,
                    order_id: m.id,
                    pod_no: `PD${dateOnly(startAt).toISOString().slice(0, 10).replace(/-/g, '')}${String(podCount).padStart(4, '0')}`,
                    pod_type: pick(['SIGNATURE', 'PHOTO'] as const),
                    receiver_name: pick(['김주임', '박과장', '이대리', '최반장'] as const),
                    receiver_relation: '담당자',
                    delivered_at: deliveredAt,
                    pod_result: result,
                    delivered_qty: m.weight,
                    shortage_qty: result === 'SHORTAGE' ? Math.round(m.weight * 0.05) : 0,
                    damaged_qty: result === 'DAMAGED' ? Math.round(m.weight * 0.03) : 0,
                    abnormal_reason: flaw?.reason ?? null,
                    latitude: to.lat,
                    longitude: to.lng,
                    // 지오펜스는 단말이 도착지 반경 안에 있었는지다. 늘 참으로
                    // 두면 분쟁 때 근거가 되는 이 표시가 아무 뜻도 없어진다.
                    is_geofence_verified: (executionCount + oi) % 6 !== 4,
                    is_confirmed: confirmed,
                    confirmed_at: confirmed ? addMinutes(deliveredAt, intBetween(30, 300)) : null,
                  },
                });
              }
            }
          }
        }

        tripIndex += 1;
      }
    }

    // -----------------------------------------------------------------
    // 지난 2주 — 실적 · 운행일보 · KPI 가 볼 것
    //
    // 여기까지 만든 것은 전부 **오늘** 이다. 관제와 배차판은 오늘만 있으면
    // 되지만, 실적 계열 화면은 그렇지 않다.
    //
    //   · KPI 는 점 하나가 아니라 **선**이다. 정시율 94% 는 지난주가 97%
    //     였는지 88% 였는지를 알아야 좋은 숫자인지 판단이 된다. 하루치만
    //     있으면 스파크라인이 점 하나로 그려지고, 그 화면의 요점이 통째로
    //     사라진다.
    //   · 운행일보는 대개 **어제** 것을 여는 화면이다. 오늘 것만 있으면 아직
    //     도로 위인 차들 때문에 가동시간이 전부 반쯤 잘려 있다.
    //   · 확정 관문은 **막힌 건**이 있어야 볼 수 있다. 인수증이 다 들어온
    //     데이터로는 그 화면이 늘 초록불이다.
    //
    // 그래서 지난 13일치 완료 운송을 따로 만든다. 오늘 것은 일부러 실적을
    // 만들지 않는다 — 사용자가 「실적 만들기」를 눌러 프로세스를 한 번
    // 밟아 볼 자리를 남겨 두는 것이다.
    // -----------------------------------------------------------------
    const HISTORY_DAYS = 13;

    /**
     * 나쁜 주와 회복하는 주.
     *
     * 지연을 고르게 흩으면 KPI 선이 평평해지고, 평평한 선은 있으나 마나다.
     * 실제 운영에도 사고가 겹치는 주가 있고 회복하는 주가 있으므로, 기간
     * 가운데(8일 전)를 골짜기로 두고 앞뒤로 회복시킨다. 화면을 열면 "여기서
     * 무슨 일이 있었나" 를 묻게 되는 모양이다.
     */
    const slump = (daysAgo: number) => Math.max(0, 1 - Math.abs(daysAgo - 8) / 4);

    /** 그날의 트립 수. 주말은 절반쯤으로 줄인다 — 물동량에도 요일이 있다 */
    const tripsOn = (day: Date) => {
      const dow = day.getDay();
      return dow === 0 ? 2 : dow === 6 ? 3 : 5 + (day.getDate() % 2);
    };

    const historyDays: Date[] = [];
    for (let d = HISTORY_DAYS; d >= 1; d -= 1) historyDays.push(addDays(new Date(), -d));

    const historyTripCount = historyDays.reduce((a, day) => a + tripsOn(day), 0);
    /*
      채번은 한 번에 받아 둔다.

      건마다 fn_next_no 를 부르면 왕복이 그만큼 늘고, 시드가 느려지면 아무도
      --reset 을 다시 돌리지 않는다. 안 돌리면 화면이 낡은 데이터로 남는다.
    */
    const historyOrderNos = await prisma.$queryRaw<Array<{ no: string }>>`
      SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'ORDER'::VARCHAR) AS no
        FROM generate_series(1, ${historyTripCount * 2}::INT)
    `;
    const historyTripNos = await prisma.$queryRaw<Array<{ no: string }>>`
      SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'TRIP'::VARCHAR) AS no
        FROM generate_series(1, ${historyTripCount}::INT)
    `;
    const historyDispatchNos = await prisma.$queryRaw<Array<{ no: string }>>`
      SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'DISPATCH'::VARCHAR) AS no
        FROM generate_series(1, ${historyTripCount}::INT)
    `;

    let hTrip = 0;
    let hOrder = 0;
    let hPod = 0;
    let actualCount = 0;
    let confirmedCount = 0;
    let blockedCount = 0;

    for (const day of historyDays) {
      const daysAgo = Math.round((Date.now() - day.getTime()) / 86_400_000);
      const bad = slump(daysAgo);

      for (let t = 0; t < tripsOn(day); t += 1) {
        const seq = hTrip;
        const lane = LANES[seq % LANES.length]!;
        const from = locInfo.get(lane.from)!;
        const to = locInfo.get(lane.to)!;

        // 출발은 06~13시. 트립마다 흩어야 운행일보의 하루 띠가 서로 겹치지 않는다.
        const startAt = new Date(day);
        startAt.setHours(6 + ((seq * 3) % 8), (seq * 17) % 60, 0, 0);
        const endAt = addMinutes(startAt, lane.min + 90);

        /*
          지연은 그날의 상태를 따른다.

          나쁜 주에는 절반 넘게 늦고 그 폭도 크다. 확률로만 뽑으면 고정 시드
          에서 어떤 날이 통째로 정시가 되어 선이 평평해지므로, 나머지 연산으로
          확정적으로 흩는다.
        */
        const late = seq % 10 < Math.round(2.5 + bad * 5);
        const delayMin = late ? intBetween(12, 40) + Math.round(bad * 60) : 0;

        const orderCount = seq % 3 === 0 ? 2 : 1;
        const members: Array<{ id: bigint; weight: number; volume: number }> = [];
        for (let m = 0; m < orderCount; m += 1) {
          const shipper = SHIPPERS[(seq + m) % SHIPPERS.length]!;
          const weight = Math.round(between(1200, 8600));
          const volume = Number((weight / between(180, 320)).toFixed(3));
          const qty = intBetween(20, 480);
          const dayMidnight = dateOnly(day);

          const row = await prisma.transport_order.create({
            data: {
              tenant_id: tenantId,
              order_no: historyOrderNos[hOrder]!.no,
              order_type: 'DELIVERY',
              order_date: dayMidnight,
              shipper_id: partnerId.get(shipper.code)!,
              consignee_id: partnerId.get(CONSIGNEES[(seq + m) % CONSIGNEES.length]!.code)!,
              from_location_id: from.id,
              from_location_name: from.name,
              from_address1: from.addr,
              from_latitude: from.lat,
              from_longitude: from.lng,
              from_zone_id: from.zone,
              to_location_id: to.id,
              to_location_name: to.name,
              to_address1: to.addr,
              to_latitude: to.lat,
              to_longitude: to.lng,
              to_zone_id: to.zone,
              appointment_type: 'WINDOW',
              pickup_date: dayMidnight,
              delivery_date: dayMidnight,
              total_item_count: 1,
              total_qty: qty,
              total_weight_kg: weight,
              total_volume_cbm: volume,
              total_pallet_qty: Math.max(1, Math.round(volume / 1.6)),
              temperature_zone: 'AMBIENT',
              distance_km: lane.km,
              estimated_amount: Math.round((lane.km * between(1150, 1850)) / 1000) * 1000,
              freight_terms: 'CREDIT',
              priority: 'NORMAL',
              /*
                지난 건은 인수확인까지 끝나 있다. 정산완료(SETTLED)로 두지
                않는 이유는 정산 단계가 아직 없어서다 — 있지도 않은 단계를
                가리키면 오더 이력이 거짓말이 된다.
              */
              status: 'CONFIRMED_POD',
            },
          });
          await prisma.transport_order_item.create({
            data: {
              tenant_id: tenantId,
              order_id: row.order_id,
              line_no: 1,
              item_name: ITEM_NAMES[(seq + m) % ITEM_NAMES.length]!,
              qty,
              uom_code: 'BOX',
              weight_kg: weight,
              volume_cbm: volume,
              temperature_zone: 'AMBIENT',
            },
          });
          members.push({ id: row.order_id, weight, volume });
          hOrder += 1;
        }

        const totalWeight = members.reduce((a, o) => a + o.weight, 0);
        const totalVolume = members.reduce((a, o) => a + o.volume, 0);
        // 실을 수 있는 차만 고른다. 아무 차나 붙이면 적재율이 300% 로 찍힌다.
        const capable = vehicleIds.filter((id) => {
          const info = vehicleInfo.get(id)!;
          const type = VEHICLE_TYPES.find((v) => vtypeId.get(v.code) === info.typeId)!;
          return type.weight >= totalWeight;
        });
        const fitting = capable.length > 0 ? capable : vehicleIds;
        const vehicle = fitting[seq % fitting.length]!;
        const vinfo = vehicleInfo.get(vehicle)!;
        const vt = VEHICLE_TYPES.find((v) => vtypeId.get(v.code) === vinfo.typeId)!;

        const trip = await prisma.trip.create({
          data: {
            tenant_id: tenantId,
            trip_no: historyTripNos[hTrip]!.no,
            plan_date: dateOnly(startAt),
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
            weight_loading_rate: Number(Math.min((totalWeight / vt.weight) * 100, 100).toFixed(2)),
            volume_loading_rate: Number(Math.min((totalVolume / vt.cbm) * 100, 100).toFixed(2)),
            planned_distance_km: lane.km,
            planned_duration_min: lane.min,
            planned_start_at: startAt,
            planned_end_at: endAt,
            planned_toll_fee: lane.toll,
            estimated_billing_amount: Math.round((lane.km * 1650) / 1000) * 1000,
            estimated_payment_amount: Math.round((lane.km * 1280) / 1000) * 1000,
            estimated_margin: Math.round((lane.km * 370) / 1000) * 1000,
            status: 'CLOSED',
            confirmed_at: addMinutes(startAt, -240),
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

        const tripStops = [];
        for (const [i, stop] of [
          { type: 'PICKUP' as const, loc: from, at: startAt },
          { type: 'DELIVERY' as const, loc: to, at: addMinutes(startAt, lane.min) },
        ].entries()) {
          tripStops.push(
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
                time_window_from: addMinutes(stop.at, stop.type === 'PICKUP' ? -60 : -30),
                time_window_to: addMinutes(
                  stop.at,
                  stop.type === 'PICKUP'
                    ? 180
                    : seq % 3 === 0
                      ? intBetween(25, 75)
                      : intBetween(150, 330),
                ),
                distance_from_prev_km: i === 0 ? 0 : lane.km,
                duration_from_prev_min: i === 0 ? 0 : lane.min,
                status: 'COMPLETED',
              },
            }),
          );
        }

        await prisma.allocation.create({
          data: {
            tenant_id: tenantId,
            trip_id: trip.trip_id,
            allocation_seq: 1,
            carrier_id: vinfo.carrierId,
            allocation_type: 'DIRECT',
            allocated_amount: Math.round((lane.km * 1280) / 1000) * 1000,
            total_amount: Math.round((lane.km * 1280) / 1000) * 1000,
            currency_code: 'KRW',
            status: 'ACCEPTED',
            requested_at: addMinutes(startAt, -240),
            respond_deadline_at: addMinutes(startAt, -150),
            responded_at: addMinutes(startAt, -220),
          },
        });

        const dispatch = await prisma.dispatch.create({
          data: {
            tenant_id: tenantId,
            dispatch_no: historyDispatchNos[hTrip]!.no,
            trip_id: trip.trip_id,
            dispatch_date: dateOnly(startAt),
            dispatch_type: 'CONSIGNED',
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
            status: 'COMPLETED',
            dispatched_at: addMinutes(startAt, -120),
            notified_at: addMinutes(startAt, -118),
            accepted_at: addMinutes(startAt, -95),
            dispatch_amount: Math.round((lane.km * 1280) / 1000) * 1000,
          },
        });

        const vkey = vehicle.toString();
        const startOdo = odometerByVehicle.get(vkey) ?? intBetween(40_000, 480_000);
        /*
          회송 거리. 나쁜 주에는 배차가 꼬여 빈 차로 더 달린다.

          공차율이 정시율과 같은 방향으로 움직여야 KPI 에서 두 선을 겹쳐 볼
          뜻이 생긴다 — 관계없는 잡음 두 개를 나란히 두면 아무것도 안 읽힌다.
        */
        const emptyKm = intBetween(6, 48) + Math.round(bad * 30);

        const execution = await prisma.transport_execution.create({
          data: {
            tenant_id: tenantId,
            dispatch_id: dispatch.dispatch_id,
            trip_id: trip.trip_id,
            execution_date: dateOnly(startAt),
            carrier_id: vinfo.carrierId,
            vehicle_id: vehicle,
            driver_id: vinfo.driverId,
            actual_start_at: addMinutes(startAt, intBetween(-10, 15)),
            actual_end_at: addMinutes(endAt, delayMin),
            start_odometer: startOdo,
            end_odometer: startOdo + lane.km + emptyKm,
            actual_distance_km: lane.km,
            actual_duration_min: lane.min + 90 + delayMin,
            driving_minutes: lane.min,
            rest_minutes: lane.min > 240 ? intBetween(30, 60) : 0,
            fuel_consumed_liter: Number(((lane.km + emptyKm) / between(3.2, 4.6)).toFixed(1)),
            toll_fee: lane.toll,
            status: 'COMPLETED',
            current_stop_seq: 2,
            completed_stop_count: 2,
            total_stop_count: 2,
            progress_rate: 100,
            last_latitude: to.lat,
            last_longitude: to.lng,
            last_location_at: addMinutes(endAt, delayMin),
            last_speed_kmh: 0,
            delay_minutes: delayMin,
            is_delayed: delayMin > 0,
            completed_at: addMinutes(endAt, delayMin + 10),
          },
        });
        odometerByVehicle.set(vkey, startOdo + lane.km + emptyKm);

        for (const [si, ts] of tripStops.entries()) {
          const plannedArr = ts.planned_arrival_at!;
          const plannedDep = ts.planned_departure_at!;
          // 지연은 상차에서 생겨 하차로 밀린다. 실제로도 그렇게 움직인다.
          const stopDelay = si === 0 ? Math.round(delayMin / 2) : delayMin;
          // 계획(45분)을 넘긴 작업시간이 곧 대기다 — 대기료의 근거가 된다
          const serviceMin = 45 + (late && si === 0 ? intBetween(10, 50) : intBetween(-8, 12));

          await prisma.execution_stop.create({
            data: {
              tenant_id: tenantId,
              execution_id: execution.execution_id,
              trip_stop_id: ts.trip_stop_id,
              stop_seq: ts.stop_seq,
              stop_type: ts.stop_type,
              location_id: ts.location_id,
              location_name: ts.location_name,
              planned_arrival_at: plannedArr,
              planned_departure_at: plannedDep,
              actual_arrival_at: addMinutes(plannedArr, stopDelay),
              actual_departure_at: addMinutes(plannedDep, stopDelay),
              service_start_at: addMinutes(plannedArr, stopDelay),
              service_end_at: addMinutes(plannedDep, stopDelay),
              actual_service_min: serviceMin,
              delay_minutes: stopDelay,
              is_on_time: stopDelay <= 10,
              arrival_latitude: si === 0 ? from.lat : to.lat,
              arrival_longitude: si === 0 ? from.lng : to.lng,
              is_geofence_verified: true,
              actual_unload_weight_kg: ts.stop_type === 'DELIVERY' ? totalWeight : 0,
              status: 'COMPLETED',
            },
          });
        }

        /*
          확정 관문을 볼 수 있게 두 가지를 일부러 남긴다.

            · 인수증이 아직 안 들어온 건 (최근 이틀)
            · 손해액이 걸린 미해결 예외 (최근 나흘)

          둘 다 확정을 **막는** 조건이라, 이 건들은 목록에서 체크박스가 잠긴다.
          데이터가 전부 깨끗하면 그 화면이 무엇을 위한 것인지 알 수 없다.
        */
        const podMissing = daysAgo <= 2 && seq % 6 === 1;
        const damaged = daysAgo <= 4 && seq % 9 === 2;

        if (delayMin >= 30) {
          const kind = EXCEPTION_KINDS[seq % EXCEPTION_KINDS.length]!;
          await prisma.transport_exception.create({
            data: {
              tenant_id: tenantId,
              exception_no: `EX${dateOnly(startAt).toISOString().slice(0, 10).replace(/-/g, '')}H${String(seq).padStart(4, '0')}`,
              execution_id: execution.execution_id,
              dispatch_id: dispatch.dispatch_id,
              vehicle_id: vehicle,
              driver_id: vinfo.driverId,
              carrier_id: vinfo.carrierId,
              exception_type: kind.type,
              severity: delayMin >= 75 ? 'HIGH' : delayMin >= 40 ? 'MEDIUM' : 'LOW',
              occurred_at: addMinutes(startAt, 60),
              latitude: from.lat,
              longitude: from.lng,
              description: kind.description,
              action_taken: kind.action,
              impact_minutes: delayMin,
              // 지난 건의 지연 예외는 이미 닫혀 있다. 열어 두면 예외 화면의
              // '미해결' 목록이 2주치로 불어나 오늘 손댈 건이 묻힌다.
              status: 'CLOSED',
              reported_at: addMinutes(startAt, 70),
              resolved_at: addMinutes(endAt, 30),
              closed_at: addMinutes(endAt, 120),
            },
          });
        }

        if (damaged) {
          await prisma.transport_exception.create({
            data: {
              tenant_id: tenantId,
              exception_no: `EX${dateOnly(startAt).toISOString().slice(0, 10).replace(/-/g, '')}D${String(seq).padStart(4, '0')}`,
              execution_id: execution.execution_id,
              dispatch_id: dispatch.dispatch_id,
              vehicle_id: vehicle,
              driver_id: vinfo.driverId,
              carrier_id: vinfo.carrierId,
              exception_type: 'CARGO_DAMAGE',
              severity: 'HIGH',
              occurred_at: addMinutes(endAt, -20),
              latitude: to.lat,
              longitude: to.lng,
              description: '하차 중 파렛트 전도, 외박스 8박스 파손',
              action_taken: '사진 촬영 후 수하처 확인서 수령',
              impact_minutes: intBetween(20, 60),
              damage_amount: intBetween(3, 12) * 100_000,
              liability_party: 'CARRIER',
              /*
                귀책은 적혀 있어도 아직 못 닫았다. 이 한 건이 실적 확정을
                막는다 — 누가 무는지 최종 확인이 나야 금액이 갈리기 때문이다.
              */
              settlement_impact: true,
              status: 'INVESTIGATING',
              reported_at: addMinutes(endAt, -10),
            },
          });
        }

        for (const [oi, m] of members.entries()) {
          if (podMissing && oi === 0) continue;
          hPod += 1;
          const flaw = seq % 11 === 4 && oi === 0 ? POD_FLAWS[seq % POD_FLAWS.length]! : null;
          const deliveredAt = addMinutes(endAt, delayMin - intBetween(0, 15));
          // 지난 건의 인수증은 대개 확인까지 끝나 있다. 최근 이틀만 남긴다 —
          // '인수증 확인' 관문이 짚는 대상이 그것이다.
          const confirmed = daysAgo > 2 || seq % 4 !== 0;

          await prisma.pod.create({
            data: {
              tenant_id: tenantId,
              execution_id: execution.execution_id,
              order_id: m.id,
              pod_no: `PD${dateOnly(startAt).toISOString().slice(0, 10).replace(/-/g, '')}H${String(hPod).padStart(4, '0')}`,
              pod_type: seq % 2 === 0 ? 'SIGNATURE' : 'PHOTO',
              receiver_name: ['김주임', '박과장', '이대리', '최반장'][seq % 4]!,
              receiver_relation: '담당자',
              delivered_at: deliveredAt,
              pod_result: flaw?.result ?? 'NORMAL',
              delivered_qty: m.weight,
              shortage_qty: flaw?.result === 'SHORTAGE' ? Math.round(m.weight * 0.05) : 0,
              damaged_qty: flaw?.result === 'DAMAGED' ? Math.round(m.weight * 0.03) : 0,
              abnormal_reason: flaw?.reason ?? null,
              latitude: to.lat,
              longitude: to.lng,
              is_geofence_verified: true,
              is_confirmed: confirmed,
              confirmed_at: confirmed ? addMinutes(deliveredAt, intBetween(30, 300)) : null,
            },
          });
        }

        /*
          실적은 **앱과 같은 함수**로 만든다.

          시드가 실적을 직접 INSERT 하면 앱이 만드는 실적과 계산이 갈라지고,
          데모에서 멀쩡하던 화면이 실제 운영에서 틀린다. 그 차이는 정산까지
          가서야 드러나므로 가장 비싼 종류의 어긋남이다.
        */
        const forActual = await prisma.transport_execution.findUniqueOrThrow({
          where: { execution_id: execution.execution_id },
          include: EXECUTION_FOR_ACTUAL,
        });
        const built = await buildActualFromExecution(
          prisma,
          { tenantId, userId: adminUserId },
          forActual,
        );
        actualCount += 1;

        /*
          확정 상태는 나이를 따른다.

          오래된 것은 이미 닫혔고, 어제 것은 아직 손이 남아 있다. 전부 확정으로
          두면 검수 화면에 할 일이 하나도 없고, 전부 미확정으로 두면 KPI 가
          텅 빈다 — KPI 는 확정된 실적만 세기 때문이다.
        */
        const blocked = podMissing || damaged;
        const confirmStatus = blocked
          ? 'DRAFT'
          : daysAgo <= 1
            ? seq % 3 === 0
              ? 'DRAFT'
              : 'CONFIRMED'
            : daysAgo === 2 && seq % 7 === 3
              ? 'REOPENED'
              : 'CONFIRMED';

        if (blocked) blockedCount += 1;
        if (confirmStatus === 'CONFIRMED') confirmedCount += 1;

        if (confirmStatus !== 'DRAFT') {
          await prisma.transport_actual.update({
            where: { actual_id: built.actualId },
            data: {
              confirm_status: confirmStatus,
              confirmed_at: addMinutes(endAt, 180),
              confirmed_by: adminUserId,
              reopened_at: confirmStatus === 'REOPENED' ? addMinutes(endAt, 600) : null,
              reopen_reason:
                confirmStatus === 'REOPENED' ? '화주가 대기료 산정 근거를 다시 요청' : null,
            },
          });
        }

        hTrip += 1;
      }
    }

    console.log(`지난 ${HISTORY_DAYS}일 — 트립 ${hTrip}건 · 오더 ${hOrder}건 · 인수증 ${hPod}건`);
    console.log(`실적 ${actualCount}건 (확정 ${confirmedCount} · 확정 막힘 ${blockedCount})`);

    // -----------------------------------------------------------------
    // 집계 — 운행일보 · 기사 근무 · KPI
    //
    // 앱이 실적을 확정할 때 도는 것과 **같은 함수**를 부른다. 시드가 자기 몫의
    // 집계를 따로 계산하면 화면에 뜬 숫자와 「다시 집계」를 누른 뒤의 숫자가
    // 달라진다. 그건 지표를 통째로 못 믿게 만드는 종류의 어긋남이다.
    // -----------------------------------------------------------------
    for (const day of [...historyDays, new Date()]) {
      await rebuildAggregates(prisma, { tenantId, userId: adminUserId }, dateOnly(day));
    }
    console.log(`집계 ${historyDays.length + 1}일치 — 운행일보 · 기사 근무 · KPI`);

    console.log(
      `편성 ${tripIndex}건 · 배정 ${allocationCount}건 · 배차 ${dispatchCount}건 · 운송실행 ${executionCount}건`,
    );
    console.log(
      `정차실적 ${stopActualCount}건 · GPS ${gpsCount}점 · 예외 ${exceptionCount}건 · 인수증 ${podCount}건`,
    );
    console.log('\n완료. 관제 현황과 실적 관리에서 확인하세요.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
