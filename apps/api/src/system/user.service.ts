import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  buildReachGrid,
  evaluateAccess,
  isIrreversible,
  toPageResult,
  PERMISSION_ACTION_LABEL,
  type LoginHistoryItem,
  type PageResult,
  type PermissionDef,
  type ReachGrid,
  type RoleSummary,
  type UserActionInput,
  type UserDetail,
  type UserListItem,
  type UserListSummary,
  type UserUpsertValues,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { AuthConfig } from '../auth/auth.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toTenantContext, type AuthPrincipal } from '../auth/auth.types.js';

export interface UserListQuery {
  keyword: string;
  status: string | null;
  roleId: string | null;
  /** 되돌릴 수 없는 권한을 가진 계정만 */
  privilegedOnly: boolean;
  /** 지금 못 들어오는 계정만 */
  blockedOnly: boolean;
  page: number;
  size: number;
  sort: string;
}

/** 90일 안 들어오면 "오래된 계정"으로 본다. 휴면 전환 기준과 맞춘다 */
const STALE_DAYS = 90;

const DAY = 86_400_000;

function daysUntil(at: Date | null): number | null {
  if (!at) return null;
  return Math.ceil((at.getTime() - Date.now()) / DAY);
}

function daysSince(at: Date | null): number | null {
  if (!at) return null;
  return Math.floor((Date.now() - at.getTime()) / DAY);
}

/**
 * 사용자 · 권한.
 *
 * ## 이 화면이 답하는 질문
 *
 * 계정 목록은 누구나 만든다. 정작 보안 담당자가 묻는 것은 둘이다 —
 * **이 계정이 지금 들어올 수 있나**, 그리고 **들어오면 어디까지 되돌릴 수
 * 없는 일을 할 수 있나.**
 *
 * 첫 번째는 `evaluateAccess()` 가 상태 · 비밀번호 만료 · 실패 누적을 한 칸으로
 * 접어 답한다. 세 칸을 따로 두면 세 칸을 다 훑어야 문제가 보인다.
 *
 * 두 번째는 `buildReachGrid()` 의 격자다. 권한을 되돌릴 수 있는 정도로
 * 세워 두면, 조회만 하면 되는 사람의 격자가 오른쪽까지 차 있는 것이
 * 숫자를 읽기 전에 눈에 들어온다.
 *
 * ## 권한은 역할에서만 온다
 *
 * 계정에 권한을 직접 붙이는 길은 열지 않는다. 한 번 열면 "이 사람만
 * 예외로" 가 쌓이고, 반 년 뒤에는 누가 무엇을 할 수 있는지 아무도 모르게
 * 된다. 권한이 필요하면 역할을 만든다.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthConfig,
  ) {}

  // -------------------------------------------------------------------
  // 권한 정의 — 격자의 뼈대
  // -------------------------------------------------------------------

  /**
   * 시스템에 정의된 권한 전체.
   *
   * 격자는 **안 가진 권한도 윤곽으로** 그린다. 그래서 사용자별 권한만이
   * 아니라 전체 정의가 매번 필요하다. 테넌트와 무관한 전역 표라 캐시한다.
   */
  private permissionDefs: PermissionDef[] | null = null;

  private async loadPermissionDefs(tx: TxClient): Promise<PermissionDef[]> {
    if (this.permissionDefs) return this.permissionDefs;
    const rows = await tx.permission.findMany({
      where: { is_active: true },
      select: { permission_code: true, permission_name: true, action_type: true },
      orderBy: { permission_id: 'asc' },
    });
    this.permissionDefs = rows.map((r) => ({
      permissionCode: r.permission_code,
      permissionName: r.permission_name,
      actionType: r.action_type,
    }));
    return this.permissionDefs;
  }

  /** 역할 → 그 역할이 켜는 권한코드 */
  private async loadRolePermissions(tx: TxClient): Promise<Map<bigint, string[]>> {
    const rows = await tx.role_permission.findMany({
      select: { role_id: true, permission: { select: { permission_code: true } } },
    });
    const map = new Map<bigint, string[]>();
    for (const r of rows) {
      const list = map.get(r.role_id);
      if (list) list.push(r.permission.permission_code);
      else map.set(r.role_id, [r.permission.permission_code]);
    }
    return map;
  }

  /**
   * 역할 묶음이 켜는 권한을 "권한코드 → 켜 준 역할 이름들" 로 뒤집는다.
   *
   * 역할 이름을 들고 다니는 이유는 화면에서 셀에 손을 올렸을 때 **어느
   * 역할이 이걸 켰는지** 말해 주기 위해서다. 그게 없으면 관리자는 권한을
   * 빼려고 역할을 하나씩 꺼 보게 된다.
   */
  private grantedBy(
    roles: { roleId: bigint; roleName: string }[],
    rolePerms: Map<bigint, string[]>,
  ): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const role of roles) {
      for (const code of rolePerms.get(role.roleId) ?? []) {
        (out[code] ??= []).push(role.roleName);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------
  // 목록
  // -------------------------------------------------------------------

  async list(user: AuthPrincipal, q: UserListQuery): Promise<
    PageResult<UserListItem> & { summary: UserListSummary }
  > {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const [defs, rolePerms] = await Promise.all([
        this.loadPermissionDefs(tx),
        this.loadRolePermissions(tx),
      ]);

      const where: Record<string, unknown> = { deleted_at: null };
      if (q.status) where.status = q.status;
      if (q.keyword) {
        where.OR = [
          { login_id: { contains: q.keyword, mode: 'insensitive' } },
          { user_name: { contains: q.keyword, mode: 'insensitive' } },
          { email: { contains: q.keyword, mode: 'insensitive' } },
        ];
      }
      if (q.roleId) {
        where.user_role = { some: { role_id: BigInt(q.roleId) } };
      }

      /*
        권한 격자로 거르는 조건(privilegedOnly)은 SQL 로 못 짠다 — 판정이
        `@ntms/shared` 에 있고, 그 판정은 화면과 같아야 한다. 그래서 페이지를
        자르기 전에 후보를 먼저 만들고 메모리에서 거른다.

        계정 수는 대기업 테넌트라도 수천 단위이고 화면은 관리자 전용이라
        이 비용을 감당할 수 있다. 만 단위를 넘기면 격자 요약을 컬럼으로
        떨어뜨려야 한다.
      */
      const rows = await tx.user_account.findMany({
        where,
        select: USER_SELECT,
        orderBy: { user_id: 'asc' },
      });

      const mapped = rows.map((r) => this.toListItem(r, defs, rolePerms));

      const filtered = mapped.filter((u) => {
        if (q.privilegedOnly && u.irreversibleCount === 0) return false;
        if (q.blockedOnly && u.access.level === 'open') return false;
        return true;
      });

      const sorted = this.sortUsers(filtered, q.sort);
      const start = (q.page - 1) * q.size;

      const summary: UserListSummary = {
        total: mapped.length,
        activeCount: mapped.filter((u) => u.status === 'ACTIVE' && u.isActive).length,
        lockedCount: mapped.filter((u) => u.status === 'LOCKED').length,
        dormantCount: mapped.filter((u) => u.status === 'DORMANT').length,
        privilegedCount: mapped.filter((u) => u.irreversibleCount > 0).length,
        staleCount: mapped.filter((u) => {
          if (u.status !== 'ACTIVE' || !u.isActive) return false;
          const since = u.lastLoginAt ? daysSince(new Date(u.lastLoginAt)) : null;
          return since !== null && since >= STALE_DAYS;
        }).length,
        neverLoggedInCount: mapped.filter((u) => u.lastLoginAt === null).length,
      };

      return {
        ...toPageResult(sorted.slice(start, start + q.size), sorted.length, q.page, q.size),
        summary,
      };
    });
  }

  private sortUsers(items: UserListItem[], sort: string): UserListItem[] {
    const [key, dir] = sort.split(':');
    const sign = dir === 'asc' ? 1 : -1;
    const by: Record<string, (a: UserListItem, b: UserListItem) => number> = {
      // 기본 정렬은 이름순(오름차순)이다. 관리자가 사람을 찾는 화면이라
      // "최근 뭐가 바뀌었나" 보다 "그 사람 어디 있나" 가 먼저다.
      name: (a, b) => a.userName.localeCompare(b.userName, 'ko') * -sign,
      login: (a, b) => a.loginId.localeCompare(b.loginId) * -sign,
      reach: (a, b) =>
        (a.irreversibleCount - b.irreversibleCount || a.grantedCount - b.grantedCount) * sign,
      lastLogin: (a, b) =>
        ((a.lastLoginAt ? Date.parse(a.lastLoginAt) : 0) -
          (b.lastLoginAt ? Date.parse(b.lastLoginAt) : 0)) *
        sign,
    };
    return [...items].sort(by[key ?? 'name'] ?? by.name!);
  }

  private toListItem(
    r: UserRow,
    defs: PermissionDef[],
    rolePerms: Map<bigint, string[]>,
  ): UserListItem {
    const roles = r.user_role.map((ur) => ({
      roleId: ur.role.role_id,
      roleCode: ur.role.role_code,
      roleName: ur.role.role_name,
      isSystem: ur.role.is_system,
    }));
    const grid = buildReachGrid(defs, this.grantedBy(roles, rolePerms));
    const expiresIn = daysUntil(r.password_expire_at);

    return {
      userId: String(r.user_id),
      loginId: r.login_id,
      userName: r.user_name,
      email: r.email,
      mobile: r.mobile,
      userType: r.user_type,
      status: r.status,
      isActive: r.is_active,
      deptName: null,
      partnerName: r.business_partner?.partner_name ?? null,
      roleCodes: roles.map((x) => x.roleCode),
      roleNames: roles.map((x) => x.roleName),
      lastLoginAt: r.last_login_at?.toISOString() ?? null,
      lastLoginIp: r.last_login_ip,
      loginFailCount: r.login_fail_count,
      mfaEnabled: r.mfa_enabled,
      mustChangePassword: r.must_change_password,
      passwordExpiresInDays: expiresIn,
      access: evaluateAccess({
        status: r.status,
        isActive: r.is_active,
        loginFailCount: r.login_fail_count,
        failLimit: this.auth.maxFailCount,
        passwordExpiresInDays: expiresIn,
        mustChangePassword: r.must_change_password,
      }),
      grantedCount: grid.grantedCount,
      irreversibleCount: grid.irreversibleCount,
      furthestLabel: grid.furthest
        ? `${grid.furthest.label} ${PERMISSION_ACTION_LABEL[grid.furthest.action]}`
        : null,
    };
  }

  // -------------------------------------------------------------------
  // 상세
  // -------------------------------------------------------------------

  async detail(user: AuthPrincipal, userId: string): Promise<UserDetail> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const row = await tx.user_account.findFirst({
        where: { user_id: BigInt(userId), deleted_at: null },
        select: {
          ...USER_SELECT,
          user_uuid: true,
          tel: true,
          employee_id: true,
          remark: true,
          created_at: true,
          password_changed_at: true,
          locked_at: true,
          dormant_at: true,
        },
      });
      if (!row) throw AppError.notFound('USER_NOT_FOUND', '없는 계정입니다.');

      const [defs, rolePerms] = await Promise.all([
        this.loadPermissionDefs(tx),
        this.loadRolePermissions(tx),
      ]);

      const roles = row.user_role.map((ur) => ({
        roleId: ur.role.role_id,
        roleCode: ur.role.role_code,
        roleName: ur.role.role_name,
        isSystem: ur.role.is_system,
      }));
      const grid = buildReachGrid(defs, this.grantedBy(roles, rolePerms));

      const [menuCount, logins] = await Promise.all([
        roles.length === 0
          ? Promise.resolve(0)
          : tx.role_menu
              .findMany({
                where: { role_id: { in: roles.map((x) => x.roleId) } },
                select: { menu_id: true },
                distinct: ['menu_id'],
              })
              .then((rows) => rows.length),
        tx.login_history.findMany({
          where: { user_id: row.user_id },
          select: {
            login_at: true,
            login_result: true,
            fail_reason: true,
            ip_address: true,
            device_type: true,
            user_agent: true,
          },
          orderBy: { login_at: 'desc' },
          take: 10,
        }),
      ]);

      const base = this.toListItem(row, defs, rolePerms);
      const recentLogins: LoginHistoryItem[] = logins.map((l) => ({
        loginAt: l.login_at.toISOString(),
        result: l.login_result,
        failReason: l.fail_reason,
        ipAddress: l.ip_address ? String(l.ip_address) : null,
        deviceType: l.device_type,
        userAgent: l.user_agent,
      }));

      return {
        ...base,
        userUuid: row.user_uuid,
        tel: row.tel,
        employeeId: row.employee_id === null ? null : String(row.employee_id),
        remark: row.remark,
        createdAt: row.created_at.toISOString(),
        passwordChangedAt: row.password_changed_at?.toISOString() ?? null,
        lockedAt: row.locked_at?.toISOString() ?? null,
        dormantAt: row.dormant_at?.toISOString() ?? null,
        roles: roles.map((x) => ({
          roleId: String(x.roleId),
          roleCode: x.roleCode,
          roleName: x.roleName,
          isSystem: x.isSystem,
        })),
        grid,
        menuCount,
        recentLogins,
      };
    });
  }

  // -------------------------------------------------------------------
  // 역할
  // -------------------------------------------------------------------

  /**
   * 역할 목록과 각 역할의 격자.
   *
   * 계정을 만들 때 역할을 고르는 화면에서, 고른 역할이 **무엇을 여는지**
   * 그 자리에서 보여 주기 위한 것이다. 역할 이름만 보고 고르게 하면
   * `VIEWER` 인 줄 알았는데 승인 권한이 딸려 오는 일이 생긴다.
   */
  async roles(user: AuthPrincipal): Promise<RoleSummary[]> {
    return this.prisma.run(toTenantContext(user), async (tx) => {
      const [defs, rolePerms, rows] = await Promise.all([
        this.loadPermissionDefs(tx),
        this.loadRolePermissions(tx),
        tx.role.findMany({
          where: { is_active: true },
          select: {
            role_id: true,
            role_code: true,
            role_name: true,
            description: true,
            is_system: true,
            sort_order: true,
            _count: { select: { user_role: true, role_menu: true } },
          },
          orderBy: { sort_order: 'asc' },
        }),
      ]);

      return rows.map((r) => {
        const grid = buildReachGrid(
          defs,
          this.grantedBy([{ roleId: r.role_id, roleName: r.role_name }], rolePerms),
        );
        return {
          roleId: String(r.role_id),
          roleCode: r.role_code,
          roleName: r.role_name,
          description: r.description,
          isSystem: r.is_system,
          userCount: r._count.user_role,
          permissionCount: grid.grantedCount,
          menuCount: r._count.role_menu,
          irreversibleCount: grid.irreversibleCount,
          grid,
        };
      });
    });
  }

  // -------------------------------------------------------------------
  // 쓰기
  // -------------------------------------------------------------------

  async update(
    user: AuthPrincipal,
    userId: string,
    input: UserUpsertValues,
  ): Promise<UserDetail> {
    const targetId = BigInt(userId);

    await this.prisma.run(toTenantContext(user), async (tx) => {
      const current = await tx.user_account.findFirst({
        where: { user_id: targetId, deleted_at: null },
        select: { user_id: true, login_id: true, user_role: { select: { role_id: true } } },
      });
      if (!current) throw AppError.notFound('USER_NOT_FOUND', '없는 계정입니다.');

      this.guardSelfDemotion(user, targetId, input);

      const dup = await tx.user_account.findFirst({
        where: { login_id: input.loginId, deleted_at: null, NOT: { user_id: targetId } },
        select: { user_id: true },
      });
      if (dup)
        throw AppError.conflict('LOGIN_ID_TAKEN', '이미 쓰고 있는 로그인 ID 입니다.');

      await tx.user_account.update({
        where: { user_id: targetId },
        data: {
          login_id: input.loginId,
          user_name: input.userName,
          email: input.email || null,
          mobile: input.mobile || null,
          tel: input.tel || null,
          // zod 의 문자열 리터럴 유니온과 Prisma 의 enum 은 이름만 같고 타입이
          // 다르다. 값 자체는 스키마가 이미 좁혀 두었다.
          user_type: input.userType as never,
          status: input.status,
          is_active: input.isActive,
          must_change_password: input.mustChangePassword,
          remark: input.remark || null,
        },
      });

      /*
        역할은 지우고 다시 넣는다.

        차집합을 계산해 넣고 빼면 코드는 짧아지지만 감사로그에 "무엇이
        바뀌었는지" 가 흐릿하게 남는다. 통째로 지우고 넣으면 DELETE 와
        INSERT 가 짝으로 남아 누가 언제 어떤 역할을 뺐는지가 그대로 보인다.
        역할은 계정당 몇 개뿐이라 비용도 문제되지 않는다.
      */
      const nextRoleIds = input.roleIds.map((id) => BigInt(id));
      await tx.user_role.deleteMany({ where: { user_id: targetId } });
      for (const roleId of nextRoleIds) {
        await tx.user_role.create({
          data: { tenant_id: user.tenantId, user_id: targetId, role_id: roleId },
        });
      }
    });

    return this.detail(user, userId);
  }

  /**
   * 자기 손으로 자기 관리자 권한을 떼는 것을 막는다.
   *
   * 테넌트에 관리자가 한 명뿐인데 그 사람이 자기 역할을 바꾸면 아무도 이
   * 화면에 못 들어온다. DB 를 직접 고치는 것 말고는 복구할 길이 없다.
   */
  private guardSelfDemotion(
    user: AuthPrincipal,
    targetId: bigint,
    input: UserUpsertValues,
  ): void {
    if (targetId !== user.userId) return;
    if (!input.isActive || input.status !== 'ACTIVE')
      throw AppError.badRequest(
        'SELF_LOCKOUT',
        '자기 계정은 잠그거나 비활성으로 바꿀 수 없습니다. 다른 관리자에게 요청해 주세요.',
      );
  }

  /** 관리자 역할이 이 계정 하나에만 남는지 본다 */
  private async guardLastAdmin(tx: TxClient, targetId: bigint): Promise<void> {
    const adminRole = await tx.role.findFirst({
      where: { role_code: 'ADMIN' },
      select: { role_id: true },
    });
    if (!adminRole) return;

    const admins = await tx.user_role.findMany({
      where: {
        role_id: adminRole.role_id,
        user_account: { deleted_at: null, is_active: true, status: 'ACTIVE' },
      },
      select: { user_id: true },
    });
    if (admins.length === 1 && admins[0]!.user_id === targetId)
      throw AppError.badRequest(
        'LAST_ADMIN',
        '마지막 남은 운영관리자입니다. 다른 사람에게 관리자 역할을 준 뒤에 바꿀 수 있습니다.',
      );
  }

  /** 잠금 해제 — 실패 횟수를 0 으로 되돌린다 */
  async unlock(
    user: AuthPrincipal,
    userId: string,
    input: UserActionInput,
  ): Promise<UserDetail> {
    await this.prisma.run(toTenantContext(user), async (tx) => {
      const row = await tx.user_account.findFirst({
        where: { user_id: BigInt(userId), deleted_at: null },
        select: { status: true, login_fail_count: true },
      });
      if (!row) throw AppError.notFound('USER_NOT_FOUND', '없는 계정입니다.');
      if (row.status !== 'LOCKED' && row.status !== 'DORMANT' && row.login_fail_count === 0)
        throw AppError.badRequest('NOT_LOCKED', '잠기지 않은 계정입니다.');

      await tx.user_account.update({
        where: { user_id: BigInt(userId) },
        data: {
          status: 'ACTIVE',
          login_fail_count: 0,
          locked_at: null,
          dormant_at: null,
          // 왜 풀었는지가 감사로그에 남아야 한다. 사유 없는 잠금 해제는
          // 나중에 "누가 왜 풀었나" 를 아무도 답할 수 없게 만든다.
          remark: input.reason,
        },
      });
    });
    return this.detail(user, userId);
  }

  /** 비활성 — 지우지 않는다. 지우면 감사로그의 참조가 끊긴다 */
  async deactivate(
    user: AuthPrincipal,
    userId: string,
    input: UserActionInput,
  ): Promise<UserDetail> {
    const targetId = BigInt(userId);
    await this.prisma.run(toTenantContext(user), async (tx) => {
      if (targetId === user.userId)
        throw AppError.badRequest('SELF_LOCKOUT', '자기 계정은 잠글 수 없습니다.');
      await this.guardLastAdmin(tx, targetId);

      await tx.user_account.update({
        where: { user_id: targetId },
        data: { status: 'SUSPENDED', is_active: false, remark: input.reason },
      });

      // 지금 열려 있는 세션도 끊는다. 계정만 잠그고 세션을 두면 그 사람은
      // 리프레시가 만료될 때까지 계속 쓴다.
      await tx.user_session.updateMany({
        where: { user_id: targetId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    });
    return this.detail(user, userId);
  }
}

const USER_SELECT = {
  user_id: true,
  login_id: true,
  user_name: true,
  email: true,
  mobile: true,
  user_type: true,
  status: true,
  is_active: true,
  last_login_at: true,
  last_login_ip: true,
  login_fail_count: true,
  mfa_enabled: true,
  must_change_password: true,
  password_expire_at: true,
  business_partner: { select: { partner_name: true } },
  user_role: {
    select: {
      role: {
        select: { role_id: true, role_code: true, role_name: true, is_system: true },
      },
    },
  },
} as const;

interface UserRow {
  user_id: bigint;
  login_id: string;
  user_name: string;
  email: string | null;
  mobile: string | null;
  user_type: string;
  status: string;
  is_active: boolean;
  last_login_at: Date | null;
  last_login_ip: string | null;
  login_fail_count: number;
  mfa_enabled: boolean;
  must_change_password: boolean;
  password_expire_at: Date | null;
  business_partner: { partner_name: string } | null;
  user_role: {
    role: { role_id: bigint; role_code: string; role_name: string; is_system: boolean };
  }[];
}

/** 격자를 목록 응답에도 담고 싶을 때 쓰는 헬퍼. 지금은 상세만 쓴다 */
export type { ReachGrid };
export { isIrreversible };
