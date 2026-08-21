/**
 * 시스템관리 — 누가 무엇에 닿을 수 있고, 무엇이 실제로 바뀌었나.
 *
 * ## 세 화면이 각각 답하는 질문
 *
 * 시스템관리는 보통 "관리자용 잡동사니 서랍"이 된다. 계정 목록, 코드 표,
 * 로그 덤프. 셋 다 있기는 한데 아무도 안 본다. 안 보는 이유는 **화면이
 * 질문에 답하지 않고 표를 뿌리기 때문**이다.
 *
 *   사용자 · 권한   이 사람이 **어디까지 되돌릴 수 없는 일을 할 수 있나**
 *   공통코드        이 코드를 끄면 **다른 화면에서 무엇이 사라지나**
 *   감사로그        이 값이 **언제 누가 무엇에서 무엇으로** 바뀌었나
 *
 * ## 오른쪽이 위험하다
 *
 * 이 앱의 축은 늘 방향을 갖는다 — 편차 축은 오른쪽으로 벌어진 만큼이 초과고,
 * 지연 전파 축은 오른쪽이 늦은 것이다. 권한도 같은 규칙을 따른다.
 * 동작을 **되돌릴 수 있는 정도**로 세워 왼쪽에 조회를, 오른쪽에 승인을 둔다.
 * 한 계정의 격자가 오른쪽 끝까지 차 있으면 그 자체가 경고다.
 *
 * 판정을 여기 한 벌만 두는 이유는 늘 같다. 화면이 "이 사람은 승인 권한이
 * 없다"고 그렸는데 서버가 통과시키면, 그건 화면 버그가 아니라 사고다.
 */
import { z } from 'zod';
import type { StatusPhase } from './dashboard.js';

// ---------------------------------------------------------------------
// 1. 권한 격자
// ---------------------------------------------------------------------

/**
 * 동작을 **되돌릴 수 있는 정도**로 세운다. 이 순서가 곧 격자의 가로축이다.
 *
 * 알파벳순이나 CRUD 순으로 두면 격자가 아무것도 말해 주지 않는다. 조회는
 * 아무것도 바꾸지 않고, 등록은 지우면 되고, 수정은 이력이 남고, 내보내기는
 * 데이터가 회사 밖으로 나가고, 삭제는 되돌리기 어렵고, **승인은 돈을
 * 움직인다.** 그래서 오른쪽으로 갈수록 무거워지도록 세운다.
 */
export const PERMISSION_ACTIONS = [
  'READ',
  'CREATE',
  'UPDATE',
  'EXPORT',
  'DELETE',
  'APPROVE',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_ACTION_LABEL: Record<PermissionAction, string> = {
  READ: '조회',
  CREATE: '등록',
  UPDATE: '수정',
  EXPORT: '내보내기',
  DELETE: '삭제',
  APPROVE: '승인',
};

/**
 * 되돌릴 수 없는 동작.
 *
 * 삭제한 행은 감사로그에만 남고, 승인한 정산은 세금계산서가 물고 나간다.
 * 계정을 만들 때 이 둘만은 따로 세어 보여 준다.
 */
export const IRREVERSIBLE_ACTIONS: readonly PermissionAction[] = ['DELETE', 'APPROVE'];

export function isIrreversible(action: string): boolean {
  return IRREVERSIBLE_ACTIONS.includes(action as PermissionAction);
}

/**
 * 격자의 세로축.
 *
 * `permission.module_code` 가 아니라 **권한코드의 앞자리**를 쓴다.
 * DB 의 module_code 는 DISPATCH 를 PLAN 에, RATE 를 MASTER 에 접어 두었는데,
 * 화면에서 쓰는 사람은 배차와 편성을, 운임과 기준정보를 다른 일로 안다.
 * 격자는 사람이 아는 단위로 그린다.
 */
export const PERMISSION_DOMAINS = [
  'ORDER',
  'PLAN',
  'DISPATCH',
  'EXECUTION',
  'ACTUAL',
  'SETTLEMENT',
  'MASTER',
  'RATE',
  'SYSTEM',
] as const;
export type PermissionDomain = (typeof PERMISSION_DOMAINS)[number];

export const PERMISSION_DOMAIN_LABEL: Record<string, string> = {
  ORDER: '오더',
  PLAN: '운송계획',
  DISPATCH: '배차',
  EXECUTION: '운송실행',
  ACTUAL: '실적',
  SETTLEMENT: '정산',
  MASTER: '기준정보',
  RATE: '운임',
  SYSTEM: '시스템',
};

/** 권한코드에서 도메인을 뽑는다. `SETTLEMENT.APPROVE` → `SETTLEMENT` */
export function domainOf(permissionCode: string): string {
  const dot = permissionCode.indexOf('.');
  return dot === -1 ? permissionCode : permissionCode.slice(0, dot);
}

export interface PermissionDef {
  permissionCode: string;
  permissionName: string;
  actionType: string;
}

export interface ReachCell {
  action: PermissionAction;
  /** null = 이 도메인에 이 동작 자체가 없다. 빈칸으로 둔다 */
  permissionCode: string | null;
  permissionName: string | null;
  granted: boolean;
  /** 이 권한을 켜 준 역할. 여러 역할이 겹치면 다 적는다 */
  viaRoles: string[];
}

export interface ReachRow {
  domain: string;
  label: string;
  cells: ReachCell[];
  grantedCount: number;
  definedCount: number;
  /** 이 줄에서 되돌릴 수 없는 동작을 갖고 있는가 */
  hasIrreversible: boolean;
}

export interface ReachGrid {
  rows: ReachRow[];
  grantedCount: number;
  definedCount: number;
  irreversibleCount: number;
  /**
   * 가장 오른쪽까지 닿은 자리. 요약 한 줄로 쓴다 —
   * "정산 승인까지 닿습니다" 처럼.
   */
  furthest: { domain: string; label: string; action: PermissionAction } | null;
}

/**
 * 권한 격자를 만든다.
 *
 * `defs` 는 시스템에 정의된 권한 전체, `grantedBy` 는 권한코드 → 그 권한을
 * 켜 준 역할 이름들이다. 안 가진 권한도 **윤곽으로 남겨 둔다** — 가진 것만
 * 그리면 "이 사람에게 없는 것"이 안 보이고, 그게 이 화면의 절반이다.
 */
export function buildReachGrid(
  defs: PermissionDef[],
  grantedBy: Record<string, string[]>,
): ReachGrid {
  const byDomain = new Map<string, Map<string, PermissionDef>>();
  for (const def of defs) {
    const domain = domainOf(def.permissionCode);
    let slot = byDomain.get(domain);
    if (!slot) {
      slot = new Map();
      byDomain.set(domain, slot);
    }
    // 한 도메인에 같은 동작이 둘일 수 없다는 보장은 없다(ORDER.CONFIRM 은
    // APPROVE 다). 먼저 온 것을 남기고 뒤는 무시한다 — 격자는 한 칸이다.
    if (!slot.has(def.actionType)) slot.set(def.actionType, def);
  }

  // 정의된 순서를 먼저 쓰고, 목록에 없는 도메인이 생기면 뒤에 붙인다.
  // 새 도메인이 추가됐을 때 격자에서 조용히 빠지는 것을 막는다.
  const domains = [
    ...PERMISSION_DOMAINS.filter((d) => byDomain.has(d)),
    ...[...byDomain.keys()].filter(
      (d) => !PERMISSION_DOMAINS.includes(d as PermissionDomain),
    ),
  ];

  const rows: ReachRow[] = domains.map((domain) => {
    const slot = byDomain.get(domain)!;
    const cells: ReachCell[] = PERMISSION_ACTIONS.map((action) => {
      const def = slot.get(action) ?? null;
      const viaRoles = def ? (grantedBy[def.permissionCode] ?? []) : [];
      return {
        action,
        permissionCode: def?.permissionCode ?? null,
        permissionName: def?.permissionName ?? null,
        granted: viaRoles.length > 0,
        viaRoles,
      };
    });

    return {
      domain,
      label: PERMISSION_DOMAIN_LABEL[domain] ?? domain,
      cells,
      grantedCount: cells.filter((c) => c.granted).length,
      definedCount: cells.filter((c) => c.permissionCode !== null).length,
      hasIrreversible: cells.some((c) => c.granted && isIrreversible(c.action)),
    };
  });

  // 가장 오른쪽 = PERMISSION_ACTIONS 의 뒤쪽. 같은 열이면 위 도메인을 쓴다.
  let furthest: ReachGrid['furthest'] = null;
  for (let i = PERMISSION_ACTIONS.length - 1; i >= 0 && !furthest; i -= 1) {
    const action = PERMISSION_ACTIONS[i]!;
    const row = rows.find((r) => r.cells[i]?.granted);
    if (row) furthest = { domain: row.domain, label: row.label, action };
  }

  return {
    rows,
    grantedCount: rows.reduce((a, r) => a + r.grantedCount, 0),
    definedCount: rows.reduce((a, r) => a + r.definedCount, 0),
    irreversibleCount: rows.reduce(
      (a, r) => a + r.cells.filter((c) => c.granted && isIrreversible(c.action)).length,
      0,
    ),
    furthest,
  };
}

// ---------------------------------------------------------------------
// 2. 계정 상태
// ---------------------------------------------------------------------

export const USER_STATUS = [
  'PENDING',
  'ACTIVE',
  'LOCKED',
  'DORMANT',
  'SUSPENDED',
  'WITHDRAWN',
] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const USER_STATUS_LABEL: Record<string, string> = {
  PENDING: '승인대기',
  ACTIVE: '정상',
  LOCKED: '잠김',
  DORMANT: '휴면',
  SUSPENDED: '정지',
  WITHDRAWN: '탈퇴',
};

/**
 * 상태 다섯을 국면 셋으로 접는다.
 *
 * 관리자가 손대야 하는 것은 **잠김**뿐이다. 휴면과 정지는 그럴 만해서 그런
 * 것이고 탈퇴는 끝난 일이다. 다섯 색을 다 쓰면 목록에서 잠긴 계정이
 * 휴면 계정에 묻힌다.
 */
export const USER_STATUS_PHASE: Record<string, StatusPhase> = {
  PENDING: 'planned',
  ACTIVE: 'active',
  LOCKED: 'problem',
  DORMANT: 'planned',
  SUSPENDED: 'problem',
  WITHDRAWN: 'planned',
};

export const USER_TYPE_LABEL: Record<string, string> = {
  INTERNAL: '내부 직원',
  SHIPPER: '화주',
  CARRIER: '운송사',
  DRIVER: '기사',
  SYSTEM: '시스템',
};

/**
 * 계정이 지금 들어올 수 있는가.
 *
 * 상태만 보면 안 된다. `ACTIVE` 인데 비밀번호가 만료됐거나 실패가 쌓여 곧
 * 잠길 계정이 있다. 목록에서 이 셋을 한 칸에 접어 보여 준다 — 셋을 따로
 * 두면 세 칸을 다 훑어야 문제가 보인다.
 */
export interface AccessState {
  level: 'open' | 'warning' | 'blocked';
  /** 무엇이 막고 있는지, 또는 무엇이 곧 막을지 */
  reason: string | null;
}

export interface AccessInput {
  status: string;
  isActive: boolean;
  loginFailCount: number;
  /** 잠금까지 남은 실패 횟수의 기준값 */
  failLimit: number;
  passwordExpiresInDays: number | null;
  mustChangePassword: boolean;
}

export function evaluateAccess(input: AccessInput): AccessState {
  if (!input.isActive) return { level: 'blocked', reason: '비활성 계정입니다.' };
  if (input.status === 'PENDING')
    return { level: 'blocked', reason: '가입 승인을 기다리는 계정입니다.' };
  if (input.status === 'WITHDRAWN') return { level: 'blocked', reason: '탈퇴한 계정입니다.' };
  if (input.status === 'LOCKED')
    return {
      level: 'blocked',
      reason: `비밀번호를 ${input.loginFailCount}회 틀려 잠겼습니다. 잠금을 풀어야 들어옵니다.`,
    };
  if (input.status === 'SUSPENDED') return { level: 'blocked', reason: '정지된 계정입니다.' };
  if (input.status === 'DORMANT')
    return { level: 'blocked', reason: '오래 안 써서 휴면으로 돌렸습니다. 본인 확인 후 풀립니다.' };

  if (input.passwordExpiresInDays !== null && input.passwordExpiresInDays <= 0)
    return { level: 'blocked', reason: '비밀번호가 만료됐습니다. 다음 로그인에서 바꿔야 합니다.' };

  if (input.mustChangePassword)
    return { level: 'warning', reason: '다음 로그인에서 비밀번호를 바꿔야 합니다.' };

  const remaining = input.failLimit - input.loginFailCount;
  if (input.loginFailCount > 0 && remaining <= 2)
    return { level: 'warning', reason: `${remaining}회 더 틀리면 잠깁니다.` };

  if (input.passwordExpiresInDays !== null && input.passwordExpiresInDays <= 14)
    return { level: 'warning', reason: `비밀번호 만료까지 ${input.passwordExpiresInDays}일 남았습니다.` };

  return { level: 'open', reason: null };
}

// ---------------------------------------------------------------------
// 3. 감사로그 — 바뀐 칸만
// ---------------------------------------------------------------------

export const AUDIT_ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  INSERT: '등록',
  UPDATE: '수정',
  DELETE: '삭제',
};

export const AUDIT_ACTION_PHASE: Record<string, StatusPhase> = {
  INSERT: 'planned',
  UPDATE: 'active',
  DELETE: 'problem',
};

/**
 * 모든 UPDATE 에 딸려 오는 칸.
 *
 * 이것들을 그대로 보여 주면 "수정" 한 줄을 열 때마다 `updated_at` 과
 * `row_version` 이 맨 위에 뜨고, 정작 바뀐 금액 한 칸은 그 아래 묻힌다.
 * 세기는 하되 접어 둔다.
 */
const META_FIELDS = new Set([
  'updated_at',
  'updated_by',
  'created_at',
  'created_by',
  'row_version',
]);

/** 화면에 절대 흘리지 않는 칸 */
const SECRET_FIELDS = new Set([
  'password_hash',
  'password_algo',
  'mfa_secret',
  'refresh_token_hash',
  'token_hash',
]);

export const AUDIT_FIELD_LABEL: Record<string, string> = {
  // 계정 · 권한
  login_id: '로그인 ID',
  user_name: '이름',
  email: '이메일',
  mobile: '휴대폰',
  status: '상태',
  user_type: '구분',
  login_fail_count: '로그인 실패',
  locked_at: '잠긴 시각',
  last_login_at: '마지막 접속',
  must_change_password: '비밀번호 변경 요구',
  password_expire_at: '비밀번호 만료',
  is_active: '사용',
  role_id: '역할',
  permission_id: '권한',
  // 거래 · 금액
  order_no: '오더번호',
  order_status: '오더 상태',
  total_amount: '합계',
  supply_amount: '공급가액',
  tax_amount: '부가세',
  base_amount: '기본운임',
  unit_rate: '단가',
  billing_amount: '매출',
  payment_amount: '매입',
  margin_amount: '마진',
  confirm_status: '확정 상태',
  planned_distance_km: '계획 거리',
  actual_distance_km: '실제 거리',
  delay_minutes: '지연',
  vehicle_no: '차량번호',
  driver_id: '기사',
  carrier_id: '운송사',
  valid_from: '유효 시작',
  valid_to: '유효 종료',
  remark: '비고',
};

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABEL[field] ?? field;
}

export interface FieldChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  kind: 'added' | 'removed' | 'changed';
  /** 값이 길어 한 줄에 안 들어가는가 (JSON · 긴 문자열) */
  long: boolean;
}

export interface AuditDiff {
  changes: FieldChange[];
  /** 접어 둔 메타 칸 */
  meta: FieldChange[];
  /** 비밀이라 지운 칸의 이름 */
  redacted: string[];
}

function present(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * 변경 전/후 스냅샷에서 **실제로 달라진 칸만** 뽑는다.
 *
 * 감사 화면이 JSON 두 덩이를 나란히 놓는 순간 아무도 안 본다. 마흔 칸짜리
 * 행에서 사람이 찾는 것은 바뀐 한 칸이고, 그걸 찾는 일은 화면이 해야 한다.
 *
 * INSERT 는 after 만, DELETE 는 before 만 있다. 그때는 값이 있는 칸을
 * 그대로 세운다 — 등록/삭제에서는 전체가 곧 변경이다.
 */
export function diffSnapshot(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiff {
  const fields = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  const meta: FieldChange[] = [];
  const redacted: string[] = [];

  for (const field of [...fields].sort()) {
    if (SECRET_FIELDS.has(field)) {
      const b = present(before?.[field]);
      const a = present(after?.[field]);
      if (b !== a) redacted.push(auditFieldLabel(field));
      continue;
    }

    const b = present(before?.[field]);
    const a = present(after?.[field]);
    if (b === a) continue;

    const change: FieldChange = {
      field,
      label: auditFieldLabel(field),
      before: b,
      after: a,
      kind: b === null ? 'added' : a === null ? 'removed' : 'changed',
      long: (b?.length ?? 0) > 40 || (a?.length ?? 0) > 40,
    };
    (META_FIELDS.has(field) ? meta : changes).push(change);
  }

  return { changes, meta, redacted };
}

/**
 * 감사 대상 테이블의 한글 이름.
 *
 * 화면에 `transport_order` 를 그대로 띄우면 그건 개발자용 화면이다.
 * 목록에 없는 테이블은 이름 그대로 두되, 감사 트리거가 붙은 테이블은
 * 전부 여기 있어야 한다.
 */
export const AUDIT_TABLE_LABEL: Record<string, string> = {
  user_account: '사용자 계정',
  user_role: '사용자 역할',
  role_permission: '역할 권한',
  role_menu: '역할 메뉴',
  user_tenant_access: '테넌트 접근',
  business_partner: '거래처',
  partner_contract: '계약',
  carrier_info: '운송사',
  shipper_info: '화주',
  vehicle: '차량',
  driver: '기사',
  location: '상하차지',
  rate_table: '운임표',
  rate_table_detail: '운임 상세',
  surcharge_type: '부대비 유형',
  fuel_surcharge: '유류할증',
  transport_order: '운송오더',
  transport_order_item: '오더 품목',
  trip: '트립',
  trip_order: '트립 오더',
  allocation: '운송사 배정',
  dispatch: '배차',
  transport_actual: '운송실적',
  actual_order: '오더 실적',
  settlement: '정산',
  settlement_detail: '정산 명세',
  settlement_charge: '부대비',
  settlement_adjustment: '정산 조정',
  tax_invoice: '세금계산서',
  payment_record: '수금 · 지급',
  settlement_close: '정산 마감',
};

export function auditTableLabel(table: string): string {
  return AUDIT_TABLE_LABEL[table] ?? table;
}

/**
 * 감사 대상을 업무 묶음으로 접는다.
 *
 * 서른 개 테이블을 드롭다운에 그대로 늘어놓으면 고르는 데만 한참이다.
 * 분쟁이 나는 자리는 대개 정산 · 운임 · 계정 셋 중 하나다.
 */
export const AUDIT_SCOPES = [
  { key: 'ALL', label: '전체', tables: [] as string[] },
  {
    key: 'SETTLEMENT',
    label: '정산 · 세금계산서',
    tables: [
      'settlement',
      'settlement_detail',
      'settlement_charge',
      'settlement_adjustment',
      'tax_invoice',
      'payment_record',
      'settlement_close',
    ],
  },
  {
    key: 'RATE',
    label: '운임 · 계약',
    tables: ['rate_table', 'rate_table_detail', 'surcharge_type', 'fuel_surcharge', 'partner_contract'],
  },
  {
    key: 'ACCOUNT',
    label: '계정 · 권한',
    tables: ['user_account', 'user_role', 'role_permission', 'role_menu', 'user_tenant_access'],
  },
  {
    key: 'ORDER',
    label: '오더 · 배차',
    tables: ['transport_order', 'transport_order_item', 'trip', 'trip_order', 'allocation', 'dispatch'],
  },
  {
    key: 'ACTUAL',
    label: '실적',
    tables: ['transport_actual', 'actual_order'],
  },
  {
    key: 'MASTER',
    label: '기준정보',
    tables: ['business_partner', 'carrier_info', 'shipper_info', 'vehicle', 'driver', 'location'],
  },
] as const;

export type AuditScopeKey = (typeof AUDIT_SCOPES)[number]['key'];

export function tablesOfScope(scope: string): string[] {
  return [...(AUDIT_SCOPES.find((s) => s.key === scope)?.tables ?? [])];
}

// ---------------------------------------------------------------------
// 4. 공통코드
// ---------------------------------------------------------------------

/**
 * 코드가 실제로 화면에서 어떻게 보이는가.
 *
 * 공통코드 화면의 결과물은 표가 아니라 **다른 화면의 드롭다운**이다.
 * 관리자가 여기서 하는 일(순서 바꾸기 · 끄기)이 그 드롭다운을 바꾼다.
 * 그런데 대부분의 코드 관리 화면은 표만 보여 주고, 관리자는 자기가 뭘
 * 바꿨는지 다른 화면을 열어 봐야 안다.
 *
 * 그래서 편집하는 표 옆에 **미리보기**를 세운다. 끈 코드는 미리보기에서
 * 사라지고, 순서를 바꾸면 미리보기 순서가 바뀐다.
 */
export interface CodeOption {
  codeValue: string;
  codeName: string;
  depth: number;
}

export function buildCodePreview(
  codes: { codeValue: string; codeName: string; sortOrder: number; isActive: boolean; parentCodeValue: string | null }[],
): CodeOption[] {
  const live = codes.filter((c) => c.isActive);
  const byParent = new Map<string | null, typeof live>();
  for (const c of live) {
    const key = c.parentCodeValue;
    const slot = byParent.get(key);
    if (slot) slot.push(c);
    else byParent.set(key, [c]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.codeValue.localeCompare(b.codeValue));
  }

  const out: CodeOption[] = [];
  // 부모가 꺼져 있으면 자식도 드롭다운에서 사라진다. 화면이 그렇게 그리므로
  // 미리보기도 그렇게 그려야 한다 — 뿌리에서만 내려간다.
  const walk = (parent: string | null, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ codeValue: c.codeValue, codeName: c.codeName, depth });
      walk(c.codeValue, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---------------------------------------------------------------------
// 5. 목록 · 상세 타입
// ---------------------------------------------------------------------

export interface UserListItem {
  userId: string;
  loginId: string;
  userName: string;
  email: string | null;
  mobile: string | null;
  userType: string;
  status: string;
  isActive: boolean;
  deptName: string | null;
  partnerName: string | null;
  roleCodes: string[];
  roleNames: string[];
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  loginFailCount: number;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  passwordExpiresInDays: number | null;
  access: AccessState;
  /** 격자 요약 — 목록에서는 숫자만 쓴다 */
  grantedCount: number;
  irreversibleCount: number;
  furthestLabel: string | null;
}

export interface UserListSummary {
  total: number;
  activeCount: number;
  lockedCount: number;
  dormantCount: number;
  /** 되돌릴 수 없는 권한을 가진 계정 수 */
  privilegedCount: number;
  /** 90일 넘게 안 들어온 정상 계정 */
  staleCount: number;
  neverLoggedInCount: number;
}

export interface LoginHistoryItem {
  loginAt: string;
  result: string;
  failReason: string | null;
  ipAddress: string | null;
  deviceType: string | null;
  userAgent: string | null;
}

export interface UserDetail extends UserListItem {
  userUuid: string;
  tel: string | null;
  employeeId: string | null;
  remark: string | null;
  createdAt: string;
  passwordChangedAt: string | null;
  lockedAt: string | null;
  dormantAt: string | null;
  roles: { roleId: string; roleCode: string; roleName: string; isSystem: boolean }[];
  grid: ReachGrid;
  menuCount: number;
  recentLogins: LoginHistoryItem[];
}

export interface RoleSummary {
  roleId: string;
  roleCode: string;
  roleName: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
  menuCount: number;
  irreversibleCount: number;
  grid: ReachGrid;
}

export interface CodeItem {
  codeId: string;
  codeValue: string;
  codeName: string;
  codeNameEn: string | null;
  parentCodeId: string | null;
  parentCodeValue: string | null;
  sortOrder: number;
  attr1: string | null;
  attr2: string | null;
  attr3: string | null;
  description: string | null;
  isActive: boolean;
}

export interface CodeGroupItem {
  codeGroupId: string;
  groupCode: string;
  groupName: string;
  description: string | null;
  isSystem: boolean;
  /** tenant_id NULL = 전 테넌트 공용 */
  isShared: boolean;
  sortOrder: number;
  isActive: boolean;
  codeCount: number;
  activeCodeCount: number;
}

export interface CodeGroupDetail extends CodeGroupItem {
  codes: CodeItem[];
  preview: CodeOption[];
}

export interface AuditListItem {
  auditLogId: string;
  changedAt: string;
  tableName: string;
  tableLabel: string;
  recordPk: string | null;
  action: string;
  changedBy: string | null;
  changedByName: string | null;
  changedByLoginId: string | null;
  clientIp: string | null;
  programId: string | null;
  /** 목록에서 보여 줄 변경 요약 — 바뀐 칸 수와 첫 칸 이름 */
  changeCount: number;
  headline: string;
}

export interface AuditListSummary {
  total: number;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  /** 사람이 한 변경 (changed_by 가 있는 것) */
  byPersonCount: number;
  actorCount: number;
}

export interface AuditDetail extends AuditListItem {
  diff: AuditDiff;
}

// ---------------------------------------------------------------------
// 6. 입력 스키마 — 화면과 서버가 같은 규칙을 쓴다
// ---------------------------------------------------------------------

const trimmed = (max: number) => z.string().trim().max(max);

export const userUpsertSchema = z.object({
  loginId: z
    .string()
    .trim()
    .min(4, '4자 이상으로 지어 주세요')
    .max(50)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, '영문 소문자 · 숫자 · . _ - 만 씁니다'),
  userName: z.string().trim().min(1, '이름을 적어 주세요').max(100),
  email: z.union([z.literal(''), z.string().trim().email('이메일 형식이 아닙니다').max(200)]),
  mobile: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^01[016789]-?\d{3,4}-?\d{4}$/, '휴대폰 번호 형식이 아닙니다'),
  ]),
  tel: trimmed(30),
  // SYSTEM 은 뺀다. 사람이 만드는 계정이 아니다.
  userType: z.enum(['INTERNAL', 'SHIPPER', 'CARRIER', 'DRIVER']),
  status: z.enum(USER_STATUS),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  remark: trimmed(500),
  roleIds: z.array(z.string().min(1)).min(1, '역할을 하나 이상 고르세요'),
});
export type UserUpsertInput = z.input<typeof userUpsertSchema>;
export type UserUpsertValues = z.output<typeof userUpsertSchema>;

/** 잠금 해제 · 휴면 해제처럼 이유가 남아야 하는 동작 */
export const userActionSchema = z.object({
  reason: z.string().trim().min(1, '왜 푸는지 적어주세요').max(500),
});
export type UserActionInput = z.infer<typeof userActionSchema>;

export const codeGroupUpsertSchema = z.object({
  groupCode: z
    .string()
    .trim()
    .min(2, '2자 이상으로 지어 주세요')
    .max(50)
    .regex(/^[A-Z][A-Z0-9_]*$/, '영문 대문자로 시작하고 대문자 · 숫자 · _ 만 씁니다'),
  groupName: z.string().trim().min(1, '그룹 이름을 적어 주세요').max(200),
  description: trimmed(500),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
});
export type CodeGroupUpsertInput = z.input<typeof codeGroupUpsertSchema>;
export type CodeGroupUpsertValues = z.output<typeof codeGroupUpsertSchema>;

export const codeUpsertSchema = z.object({
  codeValue: z
    .string()
    .trim()
    .min(1, '코드값을 적어 주세요')
    .max(50)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, '영문 대문자 · 숫자 · _ - 만 씁니다'),
  codeName: z.string().trim().min(1, '코드명을 적어 주세요').max(200),
  codeNameEn: trimmed(200),
  parentCodeId: z.string().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  attr1: trimmed(200),
  attr2: trimmed(200),
  attr3: trimmed(200),
  description: trimmed(500),
  isActive: z.boolean(),
});
export type CodeUpsertInput = z.input<typeof codeUpsertSchema>;
export type CodeUpsertValues = z.output<typeof codeUpsertSchema>;

/** 끌어 옮긴 순서를 한 번에 저장한다 */
export const codeReorderSchema = z.object({
  codeIds: z.array(z.string().min(1)).min(1),
});
export type CodeReorderInput = z.infer<typeof codeReorderSchema>;
