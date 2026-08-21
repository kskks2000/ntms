/**
 * 초기 데이터 적재.
 *
 *   pnpm --filter @ntms/api seed
 *
 * 넣는 것
 *   1. 기능 권한(permission)          — 시스템 전역
 *   2. 표준 역할(role)                — tenant_id NULL = 전 테넌트 공용
 *   3. 표준 메뉴(menu) · 역할별 접근  — tenant_id NULL
 *   4. 데모 테넌트 · 채번규칙 · 관리자 계정
 *
 * ADMIN_DATABASE_URL(ntms_admin, BYPASSRLS) 로 접속한다. 공용 행은 tenant_id
 * 가 NULL 이라 애플리케이션 역할(ntms_app)의 RLS WITH CHECK 를 통과하지 못한다.
 * 즉 이 스크립트는 마이그레이션과 같은 성격이며, 요청 경로에서 쓰이지 않는다.
 *
 * 여러 번 실행해도 결과가 같다. 이미 있는 행은 건너뛴다.
 */
import { PrismaClient } from '@ntms/db';
import { hash } from '@node-rs/argon2';

const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const DEMO = {
  tenantCode: 'NTMS',
  tenantName: '엔티엠에스물류',
  adminLoginId: 'admin',
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Ntms@2026!log',
  adminName: '시스템 관리자',
  adminEmail: 'admin@ntms.example',
} as const;

// ---------------------------------------------------------------------
// 1. 기능 권한
//    코드 규칙 : <모듈>.<동작>. 화면이 아니라 업무 동작 단위로 끊는다.
// ---------------------------------------------------------------------
const PERMISSIONS: Array<{
  code: string;
  name: string;
  module: string;
  resource: string;
  action: string;
}> = [
  ['ORDER.READ', '운송오더 조회', 'ORDER', 'transport_order', 'READ'],
  ['ORDER.CREATE', '운송오더 등록', 'ORDER', 'transport_order', 'CREATE'],
  ['ORDER.UPDATE', '운송오더 수정', 'ORDER', 'transport_order', 'UPDATE'],
  ['ORDER.DELETE', '운송오더 삭제', 'ORDER', 'transport_order', 'DELETE'],
  ['ORDER.CONFIRM', '운송오더 확정', 'ORDER', 'transport_order', 'APPROVE'],
  ['PLAN.READ', '편성 조회', 'PLAN', 'trip', 'READ'],
  ['PLAN.CREATE', '편성 생성', 'PLAN', 'trip', 'CREATE'],
  ['PLAN.UPDATE', '편성 수정', 'PLAN', 'trip', 'UPDATE'],
  ['DISPATCH.READ', '배차 조회', 'PLAN', 'dispatch', 'READ'],
  ['DISPATCH.CREATE', '배차 지시', 'PLAN', 'dispatch', 'CREATE'],
  ['DISPATCH.APPROVE', '배차 승인', 'PLAN', 'dispatch', 'APPROVE'],
  ['EXECUTION.READ', '운송실행 조회', 'EXECUTION', 'transport_execution', 'READ'],
  ['EXECUTION.UPDATE', '운송실행 기록', 'EXECUTION', 'transport_execution', 'UPDATE'],
  ['ACTUAL.READ', '실적 조회', 'ACTUAL', 'transport_actual', 'READ'],
  ['ACTUAL.CONFIRM', '실적 확정', 'ACTUAL', 'transport_actual', 'APPROVE'],
  ['SETTLEMENT.READ', '정산 조회', 'SETTLEMENT', 'settlement', 'READ'],
  ['SETTLEMENT.CREATE', '정산 생성', 'SETTLEMENT', 'settlement', 'CREATE'],
  ['SETTLEMENT.APPROVE', '정산 확정', 'SETTLEMENT', 'settlement', 'APPROVE'],
  ['SETTLEMENT.EXPORT', '정산 내려받기', 'SETTLEMENT', 'settlement', 'EXPORT'],
  ['MASTER.READ', '기준정보 조회', 'MASTER', 'master', 'READ'],
  ['MASTER.UPDATE', '기준정보 관리', 'MASTER', 'master', 'UPDATE'],
  ['RATE.READ', '운임 조회', 'MASTER', 'rate_table', 'READ'],
  ['RATE.UPDATE', '운임 관리', 'MASTER', 'rate_table', 'UPDATE'],
  ['SYSTEM.USER', '사용자·권한 관리', 'SYSTEM', 'user_account', 'UPDATE'],
  ['SYSTEM.AUDIT', '감사로그 조회', 'SYSTEM', 'audit_log', 'READ'],
  ['SYSTEM.CONFIG', '시스템 설정', 'SYSTEM', 'tenant_config', 'UPDATE'],
].map(([code, name, module, resource, action]) => ({
  code: code!,
  name: name!,
  module: module!,
  resource: resource!,
  action: action!,
}));

// ---------------------------------------------------------------------
// 2. 표준 역할 — 권한 코드는 접두어(prefix)로 매칭한다.
//    '*' 는 전부.
// ---------------------------------------------------------------------
const ROLES: Array<{
  code: string;
  name: string;
  description: string;
  sort: number;
  grants: string[];
}> = [
  {
    code: 'ADMIN',
    name: '운영관리자',
    description: '전 기능 사용 및 사용자·권한 관리',
    sort: 10,
    grants: ['*'],
  },
  {
    code: 'DISPATCHER',
    name: '배차담당자',
    description: '오더 접수부터 배차 지시까지',
    sort: 20,
    grants: ['ORDER.', 'PLAN.', 'DISPATCH.', 'EXECUTION.', 'ACTUAL.READ', 'MASTER.READ', 'RATE.READ'],
  },
  {
    code: 'SETTLEMENT',
    name: '정산담당자',
    description: '실적 확정과 정산 · 세금계산서',
    sort: 30,
    grants: ['SETTLEMENT.', 'ACTUAL.', 'ORDER.READ', 'MASTER.READ', 'RATE.'],
  },
  {
    code: 'SHIPPER_USER',
    name: '화주담당자',
    description: '자사 오더 등록과 진행 조회',
    sort: 40,
    grants: ['ORDER.READ', 'ORDER.CREATE', 'ORDER.UPDATE', 'EXECUTION.READ'],
  },
  {
    code: 'CARRIER_USER',
    name: '운송사담당자',
    description: '배정 수락과 운송 실행 기록',
    sort: 50,
    grants: ['DISPATCH.READ', 'EXECUTION.', 'ACTUAL.READ'],
  },
  {
    code: 'VIEWER',
    name: '조회전용',
    description: '모든 화면을 읽기만 한다',
    sort: 60,
    grants: ['ORDER.READ', 'PLAN.READ', 'DISPATCH.READ', 'EXECUTION.READ', 'ACTUAL.READ', 'MASTER.READ'],
  },
];

// ---------------------------------------------------------------------
// 3. 표준 메뉴 — 계획 → 실행 → 정산 순서를 그대로 따른다
// ---------------------------------------------------------------------
interface MenuSeed {
  code: string;
  name: string;
  path?: string;
  icon?: string;
  children?: MenuSeed[];
}

const MENUS: MenuSeed[] = [
  { code: 'DASHBOARD', name: '관제 현황', path: '/dashboard', icon: 'gauge' },
  {
    // 오더 접수부터 배차 지시까지. 실제 업무가 이 순서로 흐른다.
    code: 'PLAN',
    name: '운송계획',
    icon: 'route',
    children: [
      { code: 'PLAN_ORDER', name: '오더 관리', path: '/plan/orders' },
      { code: 'PLAN_CONSOLIDATE', name: '편성 · 상차조합', path: '/plan/consolidation' },
      { code: 'PLAN_ALLOCATION', name: '운송사 배정', path: '/plan/allocations' },
      { code: 'PLAN_DISPATCH', name: '배차', path: '/plan/dispatch' },
    ],
  },
  {
    code: 'EXECUTION',
    name: '운송실행',
    icon: 'truck',
    children: [
      { code: 'EXEC_CONTROL', name: '실시간 관제', path: '/execution/control' },
      { code: 'EXEC_TRACKING', name: '실시간 추적', path: '/execution/tracking' },
      { code: 'EXEC_POD', name: '인수증(POD)', path: '/execution/pod' },
      { code: 'EXEC_EXCEPTION', name: '운송 예외', path: '/execution/exceptions' },
    ],
  },
  {
    code: 'ACTUAL',
    name: '실적',
    icon: 'chart-line',
    children: [
      { code: 'ACTUAL_LIST', name: '운송실적', path: '/actuals' },
      { code: 'ACTUAL_DAILY', name: '운행일보', path: '/actuals/daily' },
      { code: 'ACTUAL_KPI', name: 'KPI 현황', path: '/actuals/kpi' },
    ],
  },
  {
    code: 'SETTLEMENT',
    name: '정산',
    icon: 'receipt',
    children: [
      { code: 'STL_BILLING', name: '매출 정산', path: '/settlements/billing' },
      { code: 'STL_PAYMENT', name: '매입 정산', path: '/settlements/payment' },
      { code: 'STL_INVOICE', name: '세금계산서', path: '/settlements/invoices' },
      { code: 'STL_CLOSE', name: '기간 마감', path: '/settlements/close' },
    ],
  },
  {
    code: 'MASTER',
    name: '기준정보',
    icon: 'database',
    children: [
      { code: 'MST_SHIPPER', name: '화주', path: '/master/shippers' },
      { code: 'MST_PARTNER', name: '거래처', path: '/master/partners' },
      { code: 'MST_CARRIER', name: '운송사', path: '/master/carriers' },
      { code: 'MST_VEHICLE', name: '차량', path: '/master/vehicles' },
      { code: 'MST_DRIVER', name: '기사', path: '/master/drivers' },
      { code: 'MST_LOCATION', name: '상하차지 · 권역', path: '/master/locations' },
      { code: 'MST_ROUTE', name: '라우트', path: '/master/routes' },
      { code: 'MST_TARIFF', name: '단가 (운임표)', path: '/master/tariffs' },
    ],
  },
  {
    code: 'SYSTEM',
    name: '시스템관리',
    icon: 'settings',
    children: [
      { code: 'SYS_USER', name: '사용자 · 권한', path: '/system/users' },
      { code: 'SYS_CODE', name: '공통코드', path: '/system/codes' },
      { code: 'SYS_AUDIT', name: '감사로그', path: '/system/audit' },
    ],
  },
];

/** 최상위 메뉴별로 접근을 허용할 역할 */
const MENU_ROLES: Record<string, string[]> = {
  DASHBOARD: ['ADMIN', 'DISPATCHER', 'SETTLEMENT', 'SHIPPER_USER', 'CARRIER_USER', 'VIEWER'],
  PLAN: ['ADMIN', 'DISPATCHER', 'SHIPPER_USER', 'CARRIER_USER', 'VIEWER'],
  EXECUTION: ['ADMIN', 'DISPATCHER', 'CARRIER_USER', 'VIEWER'],
  ACTUAL: ['ADMIN', 'DISPATCHER', 'SETTLEMENT', 'VIEWER'],
  SETTLEMENT: ['ADMIN', 'SETTLEMENT'],
  MASTER: ['ADMIN', 'DISPATCHER', 'SETTLEMENT', 'VIEWER'],
  SYSTEM: ['ADMIN'],
};

const NUMBERING = [
  { code: 'ORDER', name: '운송오더', prefix: 'TO', reset: 'DAILY' },
  { code: 'TRIP', name: '편성', prefix: 'TR', reset: 'DAILY' },
  { code: 'DISPATCH', name: '배차', prefix: 'DP', reset: 'DAILY' },
  { code: 'ACTUAL', name: '운송실적', prefix: 'AC', reset: 'DAILY' },
  { code: 'SETTLEMENT', name: '정산', prefix: 'ST', reset: 'MONTHLY' },
];

// ---------------------------------------------------------------------
// 공통코드
//
// DB 열거형(ntms.order_type 등)이 이미 잡고 있는 것은 여기 넣지 않는다.
// 공통코드는 **회사마다 다르고 운영 중에 늘어나는 것** 만 담는다 —
// 지연 사유를 하나 추가하려고 배포를 하면 안 되기 때문이다.
//
// 시드가 화면을 위해 일부러 만드는 것 셋:
//   · is_system 그룹 하나  — 잠긴 그룹이 어떻게 보이는지
//   · 꺼 둔 코드 몇 개      — 미리보기에서 사라지는 것을 볼 수 있게
//   · 계층 한 벌            — 미리보기가 들여쓰기로 접히는 것을 볼 수 있게
// ---------------------------------------------------------------------
interface CodeSeed {
  value: string;
  name: string;
  nameEn?: string;
  /** 상위 코드값. 계층형에서만 */
  parent?: string;
  attr1?: string;
  active?: boolean;
}

interface CodeGroupSeed {
  code: string;
  name: string;
  description: string;
  /** true = 앱이 코드값을 직접 참조한다. 화면에서 잠근다 */
  system?: boolean;
  /** true = tenant_id NULL. 모든 회사가 같이 쓴다 */
  shared?: boolean;
  codes: CodeSeed[];
}

const CODE_GROUPS: CodeGroupSeed[] = [
  {
    code: 'DELAY_REASON',
    name: '지연 사유',
    description: '관제에서 지연을 등록할 때 고르는 사유. 정산 귀책을 가르는 근거가 된다.',
    codes: [
      { value: 'TRAFFIC', name: '교통 정체', nameEn: 'Traffic', attr1: '불가항력' },
      { value: 'WEATHER', name: '기상 악화', nameEn: 'Weather', attr1: '불가항력' },
      { value: 'LOADING', name: '상차 지연', nameEn: 'Loading delay', attr1: '화주' },
      { value: 'DOCK_WAIT', name: '하차 대기', nameEn: 'Dock waiting', attr1: '화주' },
      { value: 'BREAKDOWN', name: '차량 고장', nameEn: 'Breakdown', attr1: '운송사' },
      { value: 'DRIVER', name: '기사 사정', nameEn: 'Driver', attr1: '운송사' },
      // 쓰다가 접은 사유. 미리보기에서 사라지는 것을 보여 준다.
      { value: 'STRIKE', name: '파업', nameEn: 'Strike', attr1: '불가항력', active: false },
    ],
  },
  {
    code: 'CARGO_TYPE',
    name: '화물 유형',
    description: '오더 등록에서 고른다. 차종 적합성과 부대비 산정에 쓰인다.',
    codes: [
      { value: 'GENERAL', name: '일반', nameEn: 'General' },
      { value: 'CHILLED', name: '냉장', nameEn: 'Chilled', attr1: '0~10도' },
      { value: 'FROZEN', name: '냉동', nameEn: 'Frozen', attr1: '-18도 이하' },
      { value: 'HAZARD', name: '위험물', nameEn: 'Hazardous' },
      { value: 'HEAVY', name: '중량물', nameEn: 'Heavy' },
      { value: 'FRAGILE', name: '파손주의', nameEn: 'Fragile' },
    ],
  },
  {
    code: 'PACKING_TYPE',
    name: '포장 형태',
    description: '오더 품목의 포장 단위. 팔레트 환산과 적재 판정의 입력이다.',
    codes: [
      { value: 'PALLET', name: '팔레트', nameEn: 'Pallet', attr1: 'T11' },
      { value: 'BOX', name: '박스', nameEn: 'Box' },
      { value: 'BAG', name: '마대', nameEn: 'Bag' },
      { value: 'DRUM', name: '드럼', nameEn: 'Drum' },
      { value: 'ROLL', name: '롤', nameEn: 'Roll' },
      { value: 'BULK', name: '벌크', nameEn: 'Bulk' },
    ],
  },
  {
    code: 'POD_FLAW',
    name: '인수 이상 사유',
    description: '인수증에 이상이 있을 때 고른다. 손해배상 구상의 첫 근거다.',
    codes: [
      { value: 'SHORTAGE', name: '수량 부족', nameEn: 'Shortage' },
      { value: 'DAMAGE', name: '파손', nameEn: 'Damage' },
      { value: 'WET', name: '침수 · 습기', nameEn: 'Water damage' },
      { value: 'TEMP', name: '온도 이탈', nameEn: 'Temperature deviation' },
      { value: 'WRONG', name: '오배송', nameEn: 'Misdelivery' },
      { value: 'REFUSED', name: '인수 거부', nameEn: 'Refused' },
    ],
  },
  {
    code: 'ORG_UNIT',
    name: '조직 · 부서',
    description: '계정을 소속으로 묶는다. 상위 조직 아래로 접힌다.',
    codes: [
      { value: 'HQ', name: '본사' },
      { value: 'HQ_PLAN', name: '운영기획팀', parent: 'HQ' },
      { value: 'HQ_SETTLE', name: '정산팀', parent: 'HQ' },
      { value: 'HQ_IT', name: '정보시스템팀', parent: 'HQ' },
      { value: 'CENTER', name: '물류센터' },
      { value: 'CT_SEOUL', name: '수도권센터', parent: 'CENTER' },
      { value: 'CT_JUNGBU', name: '중부센터', parent: 'CENTER' },
      { value: 'CT_YEONGNAM', name: '영남센터', parent: 'CENTER' },
      // 통폐합된 센터. 부모는 살아 있어도 자기는 미리보기에서 빠진다.
      { value: 'CT_HONAM', name: '호남센터', parent: 'CENTER', active: false },
    ],
  },
  {
    code: 'SURCHARGE_REASON',
    name: '부대비 발생 사유',
    description: '정산 부대비 라인에 붙는 사유. 증빙 요구 여부가 여기서 갈린다.',
    codes: [
      { value: 'WAITING', name: '대기 발생', attr1: '증빙필요' },
      { value: 'EXTRA_STOP', name: '경유지 추가', attr1: '증빙필요' },
      { value: 'HANDLING', name: '하역 지원' },
      { value: 'TOLL', name: '통행료', attr1: '증빙필요' },
      { value: 'ISLAND', name: '도서산간' },
      { value: 'NIGHT', name: '야간 · 휴일' },
    ],
  },
  {
    code: 'CANCEL_REASON',
    name: '오더 취소 사유',
    description: '오더를 취소할 때 고른다. 화주 귀책과 자사 귀책을 가른다.',
    codes: [
      { value: 'SHIPPER_REQ', name: '화주 요청', attr1: '화주' },
      { value: 'STOCK_OUT', name: '재고 부족', attr1: '화주' },
      { value: 'DUP', name: '중복 등록', attr1: '자사' },
      { value: 'NO_VEHICLE', name: '차량 수배 실패', attr1: '자사' },
      { value: 'CONSIGNEE_REQ', name: '수하처 요청', attr1: '수하처' },
    ],
  },
  {
    code: 'DOC_TYPE',
    name: '첨부 문서 유형',
    description: '파일을 올릴 때 무엇인지 고른다.',
    codes: [
      { value: 'POD', name: '인수증' },
      { value: 'TAX_INVOICE', name: '세금계산서' },
      { value: 'CONTRACT', name: '계약서' },
      { value: 'PHOTO', name: '현장 사진' },
      { value: 'CLAIM', name: '사고 · 클레임 자료' },
      { value: 'ETC', name: '기타' },
    ],
  },
  {
    code: 'SYS_LOCALE',
    name: '표시 언어',
    description: '앱이 코드값을 직접 참조한다. 값이 바뀌면 화면이 언어를 못 찾는다.',
    system: true,
    codes: [
      { value: 'KO_KR', name: '한국어', nameEn: 'Korean' },
      { value: 'EN_US', name: '영어', nameEn: 'English' },
      { value: 'JA_JP', name: '일본어', nameEn: 'Japanese', active: false },
    ],
  },
  {
    code: 'INCOTERMS',
    name: '인코텀즈',
    description: '국제 표준이라 회사가 고칠 수 없다. 모든 테넌트가 같은 표를 본다.',
    shared: true,
    codes: [
      { value: 'EXW', name: '공장인도', nameEn: 'Ex Works' },
      { value: 'FCA', name: '운송인인도', nameEn: 'Free Carrier' },
      { value: 'CPT', name: '운송비지급인도', nameEn: 'Carriage Paid To' },
      { value: 'DAP', name: '도착지인도', nameEn: 'Delivered At Place' },
      { value: 'DDP', name: '관세지급인도', nameEn: 'Delivered Duty Paid' },
    ],
  },
];

async function main(): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) {
    throw new Error(
      'ADMIN_DATABASE_URL 이 필요합니다. 공용 행(tenant_id NULL)은 ntms_admin 으로만 넣을 수 있습니다.',
    );
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // --- 1. 권한 ---------------------------------------------------
    for (const p of PERMISSIONS) {
      await prisma.permission.upsert({
        where: { permission_code: p.code },
        update: { permission_name: p.name },
        create: {
          permission_code: p.code,
          permission_name: p.name,
          module_code: p.module,
          resource_type: p.resource,
          action_type: p.action,
        },
      });
    }
    console.log(`권한 ${PERMISSIONS.length}건`);

    const allPermissions = await prisma.permission.findMany();

    // --- 2. 표준 역할 ----------------------------------------------
    const roleIdByCode = new Map<string, bigint>();
    for (const r of ROLES) {
      let role = await prisma.role.findFirst({
        where: { tenant_id: null, role_code: r.code },
      });
      role ??= await prisma.role.create({
        data: {
          tenant_id: null,
          role_code: r.code,
          role_name: r.name,
          description: r.description,
          is_system: true,
          sort_order: r.sort,
        },
      });
      roleIdByCode.set(r.code, role.role_id);

      const granted = allPermissions.filter((p) =>
        r.grants.some(
          (g) => g === '*' || p.permission_code === g || p.permission_code.startsWith(g),
        ),
      );
      for (const p of granted) {
        await prisma.role_permission.upsert({
          where: {
            role_id_permission_id: {
              role_id: role.role_id,
              permission_id: p.permission_id,
            },
          },
          update: {},
          create: { role_id: role.role_id, permission_id: p.permission_id },
        });
      }
    }
    console.log(`표준 역할 ${ROLES.length}건`);

    // --- 3. 표준 메뉴 ----------------------------------------------
    let menuCount = 0;
    let grantCount = 0;

    for (const [index, top] of MENUS.entries()) {
      const parent = await upsertMenu(prisma, top, null, 1, (index + 1) * 10);
      menuCount += 1;

      const childIds: bigint[] = [];
      for (const [childIndex, child] of (top.children ?? []).entries()) {
        const created = await upsertMenu(
          prisma,
          child,
          parent.menu_id,
          2,
          (childIndex + 1) * 10,
        );
        childIds.push(created.menu_id);
        menuCount += 1;
      }

      for (const roleCode of MENU_ROLES[top.code] ?? []) {
        const roleId = roleIdByCode.get(roleCode);
        if (!roleId) continue;

        const writable = roleCode === 'ADMIN' || roleCode === 'DISPATCHER';
        const flags = {
          can_read: true,
          can_create: writable,
          can_update: writable,
          can_delete: roleCode === 'ADMIN',
          can_approve: roleCode === 'ADMIN',
          can_export: roleCode === 'ADMIN' || roleCode === 'SETTLEMENT',
        };

        // 자식에도 같은 행을 만든다. 부모 권한을 물려받게 하지 않고 행으로
        // 남기는 이유는, 관리자가 나중에 하위 화면 하나만 회수할 수 있어야
        // 하기 때문이다. 상속으로 처리하면 그 순간 예외를 표현할 방법이 없다.
        for (const menuId of [parent.menu_id, ...childIds]) {
          await prisma.role_menu.upsert({
            where: { role_id_menu_id: { role_id: roleId, menu_id: menuId } },
            update: {},
            create: { role_id: roleId, menu_id: menuId, ...flags },
          });
          grantCount += 1;
        }
      }
    }
    // 이 스크립트가 표준 메뉴의 정본이다. 목록에서 빠진 코드는 예전 구조의
    // 잔재이므로 내려 둔다. 지우지 않고 is_active=false 로 두는 이유는
    // role_menu · 감사로그가 menu_id 를 참조하고 있기 때문이다.
    const knownCodes = MENUS.flatMap((m) => [
      m.code,
      ...(m.children ?? []).map((c) => c.code),
    ]);
    const stale = await prisma.menu.updateMany({
      where: { tenant_id: null, menu_code: { notIn: knownCodes }, is_active: true },
      data: { is_active: false },
    });

    console.log(
      `표준 메뉴 ${menuCount}건 · 역할-메뉴 ${grantCount}건` +
        (stale.count > 0 ? ` · 옛 메뉴 ${stale.count}건 내림` : ''),
    );

    // --- 4. 데모 테넌트 --------------------------------------------
    let tenant = await prisma.tenant.findFirst({
      where: { tenant_code: DEMO.tenantCode, deleted_at: null },
    });
    tenant ??= await prisma.tenant.create({
      data: {
        tenant_code: DEMO.tenantCode,
        tenant_name: DEMO.tenantName,
        tenant_name_en: 'NTMS Logistics',
        ceo_name: '대표이사',
        biz_type: '운수업',
        biz_item: '화물운송주선',
        timezone: 'Asia/Seoul',
        locale: 'ko-KR',
        currency_code: 'KRW',
        status: 'ACTIVE',
      },
    });
    console.log(`테넌트 ${tenant.tenant_code} (tenant_id=${tenant.tenant_id})`);

    for (const n of NUMBERING) {
      await prisma.numbering_rule.upsert({
        where: {
          tenant_id_rule_code: { tenant_id: tenant.tenant_id, rule_code: n.code },
        },
        update: {},
        create: {
          tenant_id: tenant.tenant_id,
          rule_code: n.code,
          rule_name: n.name,
          prefix: n.prefix,
          date_format: n.reset === 'MONTHLY' ? 'YYYYMM' : 'YYYYMMDD',
          seq_length: 5,
          reset_cycle: n.reset,
        },
      });
    }
    console.log(`채번규칙 ${NUMBERING.length}건`);

    // --- 5. 관리자 계정 --------------------------------------------
    const existing = await prisma.user_account.findFirst({
      where: {
        tenant_id: tenant.tenant_id,
        login_id: DEMO.adminLoginId,
        deleted_at: null,
      },
    });

    if (existing) {
      console.log(`관리자 계정 ${DEMO.adminLoginId} 은 이미 있습니다 (그대로 둡니다)`);
    } else {
      const now = new Date();
      const admin = await prisma.user_account.create({
        data: {
          tenant_id: tenant.tenant_id,
          login_id: DEMO.adminLoginId,
          password_hash: await hash(DEMO.adminPassword, ARGON2_OPTIONS),
          password_algo: 'argon2id',
          password_changed_at: now,
          password_expire_at: new Date(now.getTime() + 90 * 86_400_000),
          // 초기 비밀번호는 이 파일에 적혀 있다. 첫 로그인에서 반드시 바꾸게 한다.
          must_change_password: true,
          user_name: DEMO.adminName,
          email: DEMO.adminEmail,
          user_type: 'INTERNAL',
          status: 'ACTIVE',
          agree_terms_at: now,
          agree_privacy_at: now,
        },
      });

      const adminRoleId = roleIdByCode.get('ADMIN');
      if (adminRoleId) {
        await prisma.user_role.create({
          data: {
            user_id: admin.user_id,
            role_id: adminRoleId,
            tenant_id: tenant.tenant_id,
          },
        });
      }
      console.log(`관리자 계정 생성: ${DEMO.tenantCode} / ${DEMO.adminLoginId}`);
      console.log(`초기 비밀번호: ${DEMO.adminPassword}  ← 첫 로그인 후 변경 필요`);
    }

    await seedCodes(prisma, tenant.tenant_id);

    console.log('\n완료.');
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 공통코드 적재.
 *
 * 멱등이어야 한다 — 시드는 배포할 때마다 다시 돈다. 그런데 **이미 있는
 * 코드의 이름과 순서는 덮어쓰지 않는다.** 운영자가 화면에서 고쳐 둔 것을
 * 배포가 되돌리면 그 화면은 두 번 다시 쓰이지 않는다. 새로 생긴 것만
 * 넣고 나머지는 그대로 둔다.
 */
async function seedCodes(prisma: PrismaClient, tenantId: bigint): Promise<void> {
  let groupCount = 0;
  let codeCount = 0;

  for (const [gi, g] of CODE_GROUPS.entries()) {
    const tenant = g.shared ? null : tenantId;

    let group = await prisma.code_group.findFirst({
      where: { group_code: g.code, tenant_id: tenant },
      select: { code_group_id: true },
    });
    if (!group) {
      group = await prisma.code_group.create({
        data: {
          tenant_id: tenant,
          group_code: g.code,
          group_name: g.name,
          description: g.description,
          is_system: g.system ?? false,
          sort_order: (gi + 1) * 10,
          is_active: true,
        },
        select: { code_group_id: true },
      });
      groupCount += 1;
    }

    // 부모를 먼저 넣어야 자식이 물 수 있다. 시드 배열의 순서가 그것이다.
    const idByValue = new Map<string, bigint>();
    for (const [ci, c] of g.codes.entries()) {
      const existing = await prisma.code.findFirst({
        where: { code_group_id: group.code_group_id, code_value: c.value },
        select: { code_id: true },
      });
      if (existing) {
        idByValue.set(c.value, existing.code_id);
        continue;
      }

      const created = await prisma.code.create({
        data: {
          code_group_id: group.code_group_id,
          tenant_id: tenant,
          code_value: c.value,
          code_name: c.name,
          code_name_en: c.nameEn ?? null,
          parent_code_id: c.parent ? (idByValue.get(c.parent) ?? null) : null,
          // 10 단위로 벌려 둔다. 사이에 한 줄 끼울 때 전체를 다시 매기지
          // 않아도 된다. 화면의 순서 저장도 같은 규칙을 쓴다.
          sort_order: (ci + 1) * 10,
          attr1: c.attr1 ?? null,
          is_active: c.active ?? true,
        },
        select: { code_id: true },
      });
      idByValue.set(c.value, created.code_id);
      codeCount += 1;
    }
  }

  console.log(`공통코드 그룹 ${groupCount}건 · 코드 ${codeCount}건 (이미 있는 것은 두었다)`);
}

async function upsertMenu(
  prisma: PrismaClient,
  seed: MenuSeed,
  parentId: bigint | null,
  level: number,
  sort: number,
) {
  const found = await prisma.menu.findFirst({
    where: { tenant_id: null, menu_code: seed.code },
  });

  // 이미 있으면 갱신한다. 코드는 그대로 두고 이름·경로만 바꾸는 일이 흔한데,
  // 새로 만들 때만 반영하면 화면에는 예전 이름이 그대로 남는다.
  // (메뉴 구조를 고쳤는데 내비게이션이 안 바뀌는 형태로 드러난다)
  if (found) {
    return prisma.menu.update({
      where: { menu_id: found.menu_id },
      data: {
        parent_menu_id: parentId,
        menu_name: seed.name,
        menu_path: seed.path ?? null,
        icon_name: seed.icon ?? null,
        menu_level: level,
        sort_order: sort,
        is_leaf: !seed.children,
        is_active: true,
      },
    });
  }

  return prisma.menu.create({
    data: {
      tenant_id: null,
      parent_menu_id: parentId,
      menu_code: seed.code,
      menu_name: seed.name,
      menu_path: seed.path ?? null,
      icon_name: seed.icon ?? null,
      menu_level: level,
      sort_order: sort,
      is_leaf: !seed.children,
      program_id: seed.code,
    },
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
