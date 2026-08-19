import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TxClient } from '@ntms/db';
import {
  AUTH_ERROR,
  AUTH_ERROR_MESSAGE,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResult,
  type MenuNode,
  type MenuPermissions,
  type SignupInput,
  type SignupResult,
  type TenantSummary,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthConfig } from './auth.config.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import type { AuthPrincipal, ResolvedTenant } from './auth.types.js';

type LoginResultCode =
  | 'SUCCESS'
  | 'FAIL_PASSWORD'
  | 'FAIL_NOT_FOUND'
  | 'FAIL_PENDING'
  | 'FAIL_LOCKED'
  | 'FAIL_DORMANT'
  | 'FAIL_EXPIRED'
  | 'FAIL_MFA'
  | 'FAIL_TENANT';

export interface IssuedSession {
  refreshToken: string;
  /** 쿠키 maxAge 로 그대로 쓴다 (초) */
  refreshTtl: number;
  /** "로그인 상태 유지" 를 끄면 세션 쿠키로 내보낸다 */
  persistent: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: AuthConfig,
  ) {}

  // -------------------------------------------------------------------
  // 회사(테넌트) 확인
  // -------------------------------------------------------------------

  /**
   * 회사코드로 테넌트를 찾는다.
   *
   * ntms.tenant 에는 RLS 가 걸려 있어 app.tenant_id 없이는 한 행도 보이지
   * 않는다. 그런데 로그인은 그 tenant_id 를 알아내려고 하는 중이다.
   * db/ddl/94_auth.sql 의 SECURITY DEFINER 함수가 이 한 지점만 뚫어 준다.
   */
  private async resolveTenant(tenantCode: string): Promise<ResolvedTenant | null> {
    const rows = await this.prisma.runSystem((tx) =>
      tx.$queryRaw<ResolvedTenant[]>`
        SELECT * FROM ntms.fn_auth_resolve_tenant(${tenantCode}::VARCHAR)
      `,
    );
    return rows[0] ?? null;
  }

  /** 로그인·계정신청 앞단에서 공통으로 쓰는 테넌트 검사 */
  private async requireActiveTenant(
    tenantCode: string,
    meta: RequestMeta,
    loginId: string,
  ): Promise<ResolvedTenant> {
    const tenant = await this.resolveTenant(tenantCode);

    if (!tenant) {
      await this.recordLogin(null, null, loginId, 'FAIL_TENANT', '회사코드 없음', meta);
      throw AppError.unauthorized(
        AUTH_ERROR.TENANT_NOT_FOUND,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_NOT_FOUND],
      );
    }

    if (tenant.status !== 'ACTIVE' || !tenant.is_active) {
      await this.recordLogin(
        tenant.tenant_id,
        null,
        loginId,
        'FAIL_TENANT',
        `테넌트 상태 ${tenant.status}`,
        meta,
      );
      throw AppError.forbidden(
        AUTH_ERROR.TENANT_INACTIVE,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_INACTIVE],
      );
    }

    return tenant;
  }

  /** 계정신청 1단계 — 회사코드가 실재하는지 확인하고 회사명을 돌려준다 */
  async lookupTenant(tenantCode: string): Promise<TenantSummary> {
    const tenant = await this.resolveTenant(tenantCode);
    if (!tenant) {
      throw AppError.notFound(
        AUTH_ERROR.TENANT_NOT_FOUND,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_NOT_FOUND],
      );
    }
    if (tenant.status !== 'ACTIVE' || !tenant.is_active) {
      throw AppError.forbidden(
        AUTH_ERROR.TENANT_INACTIVE,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_INACTIVE],
      );
    }
    return { tenantCode: tenant.tenant_code, tenantName: tenant.tenant_name };
  }

  // -------------------------------------------------------------------
  // 로그인
  // -------------------------------------------------------------------

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<{ result: LoginResult; session: IssuedSession }> {
    const tenant = await this.requireActiveTenant(
      input.tenantCode,
      meta,
      input.loginId,
    );

    const user = await this.prisma.runTenant({ tenantId: tenant.tenant_id }, (tx) =>
      tx.user_account.findFirst({
        where: {
          tenant_id: tenant.tenant_id,
          login_id: input.loginId,
          deleted_at: null,
        },
      }),
    );

    if (!user) {
      // 계정이 없어도 검증과 같은 시간을 쓴다 (사용자 열거 방지)
      await this.passwords.burnTime();
      await this.recordLogin(
        tenant.tenant_id,
        null,
        input.loginId,
        'FAIL_NOT_FOUND',
        null,
        meta,
      );
      throw AppError.unauthorized(
        AUTH_ERROR.INVALID_CREDENTIALS,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.INVALID_CREDENTIALS],
      );
    }

    await this.assertLoginableStatus(tenant, user, meta);

    const ok = await this.passwords.verify(user.password_hash, input.password);

    if (!ok) {
      const failCount = user.login_fail_count + 1;
      const willLock = failCount >= this.config.maxFailCount;

      await this.prisma.runTenant({ tenantId: tenant.tenant_id }, (tx) =>
        tx.user_account.update({
          where: { user_id: user.user_id },
          data: {
            login_fail_count: failCount,
            ...(willLock ? { status: 'LOCKED', locked_at: new Date() } : {}),
          },
        }),
      );

      await this.recordLogin(
        tenant.tenant_id,
        user.user_id,
        input.loginId,
        willLock ? 'FAIL_LOCKED' : 'FAIL_PASSWORD',
        `연속 실패 ${failCount}회`,
        meta,
      );

      if (willLock) {
        throw AppError.forbidden(
          AUTH_ERROR.ACCOUNT_LOCKED,
          AUTH_ERROR_MESSAGE[AUTH_ERROR.ACCOUNT_LOCKED],
        );
      }

      // 남은 시도 횟수를 알려 준다.
      //   장점 : 잠기기 전에 사용자가 멈출 수 있다. 잠금 해제 요청이 크게 준다.
      //   비용 : 이 응답이 오면 "그 아이디는 존재한다" 는 뜻이 된다.
      // 사내망에서 쓰는 업무 시스템이라 계정 열거 위험보다 잠금 사고 비용이
      // 크다고 보고 알려주는 쪽을 택했다. 외부 공개 서비스라면 반대여야 한다.
      throw AppError.unauthorized(
        AUTH_ERROR.INVALID_CREDENTIALS,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.INVALID_CREDENTIALS],
        { failCount, maxFailCount: this.config.maxFailCount },
      );
    }

    // --- 인증 통과 ---------------------------------------------------
    const previousLoginAt = user.last_login_at;

    const { authUser, session } = await this.prisma.run(
      { tenantId: tenant.tenant_id, userId: user.user_id, clientIp: meta.ip },
      async (tx) => {
        await tx.user_account.update({
          where: { user_id: user.user_id },
          data: {
            login_fail_count: 0,
            last_login_at: new Date(),
            last_login_ip: meta.ip ?? null,
          },
        });

        const { roles, permissions } = await this.loadAuthorization(
          tx,
          tenant.tenant_id,
          user.user_id,
        );

        const session = await this.createSession(
          tx,
          tenant.tenant_id,
          user.user_id,
          input.rememberMe,
          meta,
        );

        const authUser: AuthUser = {
          userId: user.user_id.toString(),
          userUuid: user.user_uuid,
          loginId: user.login_id,
          userName: user.user_name,
          email: user.email,
          userType: user.user_type,
          tenantId: tenant.tenant_id.toString(),
          tenantCode: tenant.tenant_code,
          tenantName: tenant.tenant_name,
          roles,
          permissions,
          mustChangePassword:
            user.must_change_password || isExpired(user.password_expire_at),
          passwordExpiresInDays: daysUntil(user.password_expire_at),
          lastLoginAt: previousLoginAt?.toISOString() ?? null,
        };

        return { authUser, session };
      },
    );

    await this.recordLogin(
      tenant.tenant_id,
      user.user_id,
      input.loginId,
      'SUCCESS',
      null,
      meta,
    );

    return {
      result: {
        accessToken: this.issueAccessToken(authUser),
        expiresIn: this.config.accessTtl,
        user: authUser,
      },
      session,
    };
  }

  /**
   * 상태별 차단. 순서가 곧 우선순위다 —
   * 승인 대기 > 잠김 > 휴면 > 정지/탈퇴.
   */
  private async assertLoginableStatus(
    tenant: ResolvedTenant,
    user: { user_id: bigint; login_id: string; status: string; last_login_at: Date | null },
    meta: RequestMeta,
  ): Promise<void> {
    const deny = async (
      result: LoginResultCode,
      code: string,
      reason: string,
    ): Promise<never> => {
      await this.recordLogin(
        tenant.tenant_id,
        user.user_id,
        user.login_id,
        result,
        reason,
        meta,
      );
      throw AppError.forbidden(
        code,
        AUTH_ERROR_MESSAGE[code as keyof typeof AUTH_ERROR_MESSAGE] ??
          '로그인할 수 없는 계정입니다.',
      );
    };

    switch (user.status) {
      case 'PENDING':
        await deny('FAIL_PENDING', AUTH_ERROR.ACCOUNT_PENDING, '승인 대기');
        break;
      case 'LOCKED':
        await deny('FAIL_LOCKED', AUTH_ERROR.ACCOUNT_LOCKED, '잠김');
        break;
      case 'DORMANT':
        await deny('FAIL_DORMANT', AUTH_ERROR.ACCOUNT_DORMANT, '휴면');
        break;
      case 'SUSPENDED':
        await deny('FAIL_LOCKED', AUTH_ERROR.ACCOUNT_SUSPENDED, '정지');
        break;
      case 'WITHDRAWN':
        await deny('FAIL_NOT_FOUND', AUTH_ERROR.ACCOUNT_WITHDRAWN, '탈퇴');
        break;
      default:
        break;
    }

    // 장기 미접속 휴면 전환. 배치가 놓친 계정을 로그인 시점에 잡는다.
    const dormantSince = Date.now() - this.config.dormantDays * 86_400_000;
    if (user.last_login_at && user.last_login_at.getTime() < dormantSince) {
      await this.prisma.runTenant({ tenantId: tenant.tenant_id }, (tx) =>
        tx.user_account.update({
          where: { user_id: user.user_id },
          data: { status: 'DORMANT', dormant_at: new Date() },
        }),
      );
      await deny('FAIL_DORMANT', AUTH_ERROR.ACCOUNT_DORMANT, '장기 미접속 자동 휴면');
    }
  }

  // -------------------------------------------------------------------
  // 세션 갱신 / 종료
  // -------------------------------------------------------------------

  async refresh(
    refreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<{ result: LoginResult; session: IssuedSession }> {
    if (!refreshToken) {
      throw AppError.unauthorized(
        AUTH_ERROR.SESSION_EXPIRED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
      );
    }

    const payload = this.tokens.verifyRefreshToken(refreshToken);
    if (!payload) {
      throw AppError.unauthorized(
        AUTH_ERROR.SESSION_EXPIRED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
      );
    }

    const tenantId = BigInt(payload.tid);
    const userId = BigInt(payload.uid);
    const tokenHash = this.tokens.hashToken(refreshToken);

    const existing = await this.prisma.runTenant({ tenantId }, (tx) =>
      tx.user_session.findFirst({ where: { token_hash: tokenHash } }),
    );

    if (!existing) {
      // 서명은 맞는데 세션 행이 없다 = 이미 정리된 세션이거나 위조.
      throw AppError.unauthorized(
        AUTH_ERROR.SESSION_EXPIRED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
      );
    }

    if (existing.revoked_at) {
      // 폐기된 세션이라도 이유가 다르면 뜻이 다르다.
      //
      //   ROTATED  갱신되어 교체된 토큰이 다시 왔다 = 유출로 봐야 한다.
      //   그 외     로그아웃 · 비밀번호 변경처럼 우리가 일부러 끊은 것이다.
      //
      // 구분하지 않으면 누군가 비밀번호를 바꿀 때마다 "토큰 탈취 감지" 경고가
      // 쌓여서, 정작 진짜 탈취가 났을 때 그 신호가 묻힌다.
      if (existing.revoke_reason === 'ROTATED') {
        this.logger.warn(
          `리프레시 토큰 재사용 감지: user_id=${userId} session=${existing.user_session_id}`,
        );
        await this.revokeAllSessions(tenantId, userId, 'REUSE_DETECTED');
        throw AppError.unauthorized(
          AUTH_ERROR.SESSION_REUSED,
          AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_REUSED],
        );
      }

      const code =
        existing.revoke_reason === 'PASSWORD_CHANGED'
          ? AUTH_ERROR.SESSION_PASSWORD_CHANGED
          : AUTH_ERROR.SESSION_EXPIRED;
      throw AppError.unauthorized(code, AUTH_ERROR_MESSAGE[code]);
    }

    if (existing.expires_at.getTime() <= Date.now()) {
      throw AppError.unauthorized(
        AUTH_ERROR.SESSION_EXPIRED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
      );
    }

    const tenant = await this.prisma.runTenant({ tenantId }, (tx) =>
      tx.tenant.findUnique({ where: { tenant_id: tenantId } }),
    );
    if (!tenant || tenant.status !== 'ACTIVE' || !tenant.is_active) {
      await this.revokeAllSessions(tenantId, userId, 'TENANT_INACTIVE');
      throw AppError.forbidden(
        AUTH_ERROR.TENANT_INACTIVE,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_INACTIVE],
      );
    }

    const { authUser, session } = await this.prisma.run(
      { tenantId, userId, clientIp: meta.ip },
      async (tx) => {
        const user = await tx.user_account.findFirst({
          where: { user_id: userId, tenant_id: tenantId, deleted_at: null },
        });
        if (!user || user.status !== 'ACTIVE') {
          throw AppError.unauthorized(
            AUTH_ERROR.SESSION_EXPIRED,
            AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
          );
        }

        await tx.user_session.update({
          where: { user_session_id: existing.user_session_id },
          data: {
            revoked_at: new Date(),
            revoke_reason: 'ROTATED',
            last_used_at: new Date(),
          },
        });

        const { roles, permissions } = await this.loadAuthorization(
          tx,
          tenantId,
          userId,
        );

        // 갱신은 원래 세션의 성격(유지/비유지)을 이어받는다.
        const persistent =
          existing.expires_at.getTime() - existing.issued_at.getTime() >
          this.config.refreshTtlSession * 1000;

        const session = await this.createSession(
          tx,
          tenantId,
          userId,
          persistent,
          meta,
        );

        const authUser: AuthUser = {
          userId: user.user_id.toString(),
          userUuid: user.user_uuid,
          loginId: user.login_id,
          userName: user.user_name,
          email: user.email,
          userType: user.user_type,
          tenantId: tenantId.toString(),
          tenantCode: tenant.tenant_code,
          tenantName: tenant.tenant_name,
          roles,
          permissions,
          mustChangePassword:
            user.must_change_password || isExpired(user.password_expire_at),
          passwordExpiresInDays: daysUntil(user.password_expire_at),
          lastLoginAt: user.last_login_at?.toISOString() ?? null,
        };

        return { authUser, session };
      },
    );

    return {
      result: {
        accessToken: this.issueAccessToken(authUser),
        expiresIn: this.config.accessTtl,
        user: authUser,
      },
      session,
    };
  }

  /** 로그아웃. 토큰이 이미 무효여도 조용히 성공시킨다 — 결과가 같기 때문이다 */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const payload = this.tokens.verifyRefreshToken(refreshToken);
    if (!payload) return;

    const tenantId = BigInt(payload.tid);
    const tokenHash = this.tokens.hashToken(refreshToken);

    await this.prisma
      .run(
        { tenantId, userId: BigInt(payload.uid) },
        async (tx) =>
          tx.user_session.updateMany({
            where: { token_hash: tokenHash, revoked_at: null },
            data: { revoked_at: new Date(), revoke_reason: 'LOGOUT' },
          }),
      )
      .catch((error: unknown) => {
        this.logger.warn(`로그아웃 세션 정리 실패: ${(error as Error).message}`);
      });
  }

  /** 현재 사용자 정보를 다시 읽는다 (권한 변경이 곧바로 반영되도록) */
  async me(principal: AuthPrincipal): Promise<AuthUser> {
    return this.prisma.run(
      { tenantId: principal.tenantId, userId: principal.userId },
      async (tx) => {
        const user = await tx.user_account.findFirst({
          where: {
            user_id: principal.userId,
            tenant_id: principal.tenantId,
            deleted_at: null,
          },
          include: { tenant: true },
        });
        if (!user) {
          throw AppError.unauthorized(
            AUTH_ERROR.SESSION_EXPIRED,
            AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
          );
        }

        const { roles, permissions } = await this.loadAuthorization(
          tx,
          principal.tenantId,
          principal.userId,
        );

        return {
          userId: user.user_id.toString(),
          userUuid: user.user_uuid,
          loginId: user.login_id,
          userName: user.user_name,
          email: user.email,
          userType: user.user_type,
          tenantId: user.tenant_id.toString(),
          tenantCode: user.tenant.tenant_code,
          tenantName: user.tenant.tenant_name,
          roles,
          permissions,
          mustChangePassword:
            user.must_change_password || isExpired(user.password_expire_at),
          passwordExpiresInDays: daysUntil(user.password_expire_at),
          lastLoginAt: user.last_login_at?.toISOString() ?? null,
        };
      },
    );
  }

  // -------------------------------------------------------------------
  // 비밀번호 변경
  // -------------------------------------------------------------------

  /**
   * 비밀번호를 바꾸고 **다른 기기의 세션을 전부 끊는다.**
   *
   * 지금 쓰는 세션은 남긴다. 비밀번호를 바꾼 사람까지 밖으로 내보내면
   * "바꿨더니 로그아웃됐다" 가 되어, 정작 급할 때 바꾸기를 꺼리게 된다.
   * 끊어야 할 것은 유출됐을지 모르는 **다른** 기기다.
   *
   * @param currentRefreshToken 지금 브라우저의 리프레시 토큰. 이 세션만 남긴다.
   */
  async changePassword(
    principal: AuthPrincipal,
    input: ChangePasswordInput,
    meta: RequestMeta,
    currentRefreshToken?: string,
  ): Promise<AuthUser> {
    const { tenantId, userId } = principal;
    const ctx = { tenantId, userId, clientIp: meta.ip };

    const user = await this.prisma.run(ctx, (tx) =>
      tx.user_account.findFirst({
        where: { user_id: userId, tenant_id: tenantId, deleted_at: null },
        include: { tenant: true },
      }),
    );
    if (!user) {
      throw AppError.unauthorized(
        AUTH_ERROR.SESSION_EXPIRED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
      );
    }

    const verified = await this.passwords.verify(
      user.password_hash,
      input.currentPassword,
    );
    if (!verified) {
      throw AppError.unauthorized(
        AUTH_ERROR.CURRENT_PASSWORD_WRONG,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.CURRENT_PASSWORD_WRONG],
      );
    }

    // 스키마가 평문 비교로 한 번 걸렀지만, 해시로 다시 본다.
    // 앞뒤 공백처럼 눈에 안 보이는 차이로 빠져나갈 수 있기 때문이다.
    const unchanged = await this.passwords.verify(
      user.password_hash,
      input.newPassword,
    );
    if (unchanged) {
      throw AppError.badRequest(
        AUTH_ERROR.PASSWORD_UNCHANGED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.PASSWORD_UNCHANGED],
      );
    }

    if (input.newPassword.toLowerCase().includes(user.login_id.toLowerCase())) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '입력값을 확인해 주세요.',
        undefined,
        { newPassword: ['비밀번호에 아이디를 포함할 수 없습니다'] },
      );
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();
    const keepTokenHash = currentRefreshToken
      ? this.tokens.hashToken(currentRefreshToken)
      : null;

    const { roles, permissions } = await this.prisma.run(ctx, async (tx) => {
      await tx.user_account.update({
        where: { user_id: userId },
        data: {
          password_hash: passwordHash,
          password_algo: this.passwords.algo,
          password_changed_at: now,
          password_expire_at: new Date(
            now.getTime() + this.config.passwordExpireDays * 86_400_000,
          ),
          must_change_password: false,
          // 잠기기 직전이던 계정이 비밀번호를 바꿨다면 실패 이력도 함께 지운다
          login_fail_count: 0,
        },
      });

      await tx.user_session.updateMany({
        where: {
          user_id: userId,
          revoked_at: null,
          ...(keepTokenHash ? { NOT: { token_hash: keepTokenHash } } : {}),
        },
        data: { revoked_at: now, revoke_reason: 'PASSWORD_CHANGED' },
      });

      return this.loadAuthorization(tx, tenantId, userId);
    });

    this.logger.log(
      `비밀번호 변경: tenant=${user.tenant.tenant_code} login_id=${user.login_id}`,
    );

    return {
      userId: user.user_id.toString(),
      userUuid: user.user_uuid,
      loginId: user.login_id,
      userName: user.user_name,
      email: user.email,
      userType: user.user_type,
      tenantId: tenantId.toString(),
      tenantCode: user.tenant.tenant_code,
      tenantName: user.tenant.tenant_name,
      roles,
      permissions,
      mustChangePassword: false,
      passwordExpiresInDays: this.config.passwordExpireDays,
      lastLoginAt: user.last_login_at?.toISOString() ?? null,
    };
  }

  // -------------------------------------------------------------------
  // 메뉴
  // -------------------------------------------------------------------

  /**
   * 이 사용자가 볼 수 있는 메뉴 트리.
   *
   * 화면 구성을 코드에 박지 않고 `menu` + `role_menu` 에서 읽는다. 테넌트마다
   * 쓰는 모듈이 다르고, 같은 테넌트에서도 배차담당자와 정산담당자가 보는 것이
   * 달라야 하기 때문이다.
   *
   * 메뉴를 감추는 것은 안내이지 차단이 아니다. 실제 차단은 언제나 권한 검사가 한다.
   */
  async menus(principal: AuthPrincipal): Promise<MenuNode[]> {
    return this.prisma.run(
      { tenantId: principal.tenantId, userId: principal.userId },
      async (tx) => {
        const roleIds = await this.activeRoleIds(
          tx,
          principal.tenantId,
          principal.userId,
        );
        if (roleIds.length === 0) return [];

        const grants = await tx.role_menu.findMany({
          where: { role_id: { in: roleIds }, can_read: true },
          include: { menu: true },
        });

        // 한 사람이 역할을 여러 개 가지면 같은 메뉴가 여러 번 나온다.
        // 권한은 OR 로 합친다 — 하나라도 허용하는 역할이 있으면 허용이다.
        const merged = new Map<
          string,
          { menu: (typeof grants)[number]['menu']; perms: MenuPermissions }
        >();

        for (const g of grants) {
          if (!g.menu.is_active || !g.menu.is_display) continue;

          const key = g.menu_id.toString();
          const existing = merged.get(key);
          const perms: MenuPermissions = {
            read: (existing?.perms.read ?? false) || g.can_read,
            create: (existing?.perms.create ?? false) || g.can_create,
            update: (existing?.perms.update ?? false) || g.can_update,
            delete: (existing?.perms.delete ?? false) || g.can_delete,
            approve: (existing?.perms.approve ?? false) || g.can_approve,
            export: (existing?.perms.export ?? false) || g.can_export,
          };
          merged.set(key, { menu: g.menu, perms });
        }

        return buildMenuTree([...merged.values()]);
      },
    );
  }

  // -------------------------------------------------------------------
  // 계정 신청
  // -------------------------------------------------------------------

  async signup(input: SignupInput, meta: RequestMeta): Promise<SignupResult> {
    const tenant = await this.resolveTenant(input.tenantCode);
    if (!tenant) {
      throw AppError.notFound(
        AUTH_ERROR.TENANT_NOT_FOUND,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_NOT_FOUND],
      );
    }
    if (tenant.status !== 'ACTIVE' || !tenant.is_active) {
      throw AppError.forbidden(
        AUTH_ERROR.TENANT_INACTIVE,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.TENANT_INACTIVE],
      );
    }

    const passwordHash = await this.passwords.hash(input.password);
    const now = new Date();
    const expireAt = new Date(
      now.getTime() + this.config.passwordExpireDays * 86_400_000,
    );

    await this.prisma.runTenant({ tenantId: tenant.tenant_id, clientIp: meta.ip }, async (tx) => {
      const dupId = await tx.user_account.findFirst({
        where: {
          tenant_id: tenant.tenant_id,
          login_id: input.loginId,
          deleted_at: null,
        },
        select: { user_id: true },
      });
      if (dupId) {
        throw AppError.conflict(
          AUTH_ERROR.LOGIN_ID_TAKEN,
          AUTH_ERROR_MESSAGE[AUTH_ERROR.LOGIN_ID_TAKEN],
        );
      }

      const dupEmail = await tx.user_account.findFirst({
        where: {
          tenant_id: tenant.tenant_id,
          email: input.email,
          deleted_at: null,
          status: { not: 'WITHDRAWN' },
        },
        select: { user_id: true },
      });
      if (dupEmail) {
        throw AppError.conflict(
          AUTH_ERROR.EMAIL_TAKEN,
          AUTH_ERROR_MESSAGE[AUTH_ERROR.EMAIL_TAKEN],
        );
      }

      // 승인 전에는 is_active 도 false 로 둔다.
      // status 만 보고 거르는 화면이 있더라도 목록에 섞이지 않게 하려는 것이다.
      await tx.user_account.create({
        data: {
          tenant_id: tenant.tenant_id,
          login_id: input.loginId,
          password_hash: passwordHash,
          password_algo: this.passwords.algo,
          password_changed_at: now,
          password_expire_at: expireAt,
          must_change_password: false,
          user_name: input.userName,
          email: input.email,
          mobile: input.mobile,
          user_type: 'INTERNAL',
          status: 'PENDING',
          is_active: false,
          agree_terms_at: now,
          agree_privacy_at: now,
          agree_marketing_at: input.agreeMarketing ? now : null,
          remark: input.deptName ? `신청 소속: ${input.deptName}` : null,
        },
      });
    });

    this.logger.log(
      `계정 신청 접수: tenant=${tenant.tenant_code} login_id=${input.loginId}`,
    );

    return {
      status: 'PENDING',
      tenantName: tenant.tenant_name,
      loginId: input.loginId,
      email: input.email,
    };
  }

  // -------------------------------------------------------------------
  // 내부 도우미
  // -------------------------------------------------------------------

  private issueAccessToken(user: AuthUser): string {
    return this.tokens.signAccessToken({
      sub: user.userUuid,
      uid: user.userId,
      tid: user.tenantId,
      tcd: user.tenantCode,
      lid: user.loginId,
      rol: user.roles,
    });
  }

  /**
   * 지금 유효한 역할.
   *
   * 권한 조회와 메뉴 조회가 같은 판정을 써야 한다. 따로 두면 "메뉴는 보이는데
   * 눌러 보면 권한이 없다" 같은 어긋남이 생긴다.
   */
  private async activeRoles(
    tx: TxClient,
    tenantId: bigint,
    userId: bigint,
  ): Promise<Array<{ roleId: bigint; roleCode: string }>> {
    const today = new Date();

    const userRoles = await tx.user_role.findMany({
      where: {
        user_id: userId,
        tenant_id: tenantId,
        AND: [
          { OR: [{ valid_from: null }, { valid_from: { lte: today } }] },
          { OR: [{ valid_to: null }, { valid_to: { gte: today } }] },
        ],
      },
      include: { role: true },
    });

    return userRoles
      .filter((ur) => ur.role.is_active)
      .map((ur) => ({ roleId: ur.role_id, roleCode: ur.role.role_code }));
  }

  private async activeRoleIds(
    tx: TxClient,
    tenantId: bigint,
    userId: bigint,
  ): Promise<bigint[]> {
    return (await this.activeRoles(tx, tenantId, userId)).map((r) => r.roleId);
  }

  /** 유효기간 안에 있는 역할과, 그 역할에 붙은 권한 코드 */
  private async loadAuthorization(
    tx: TxClient,
    tenantId: bigint,
    userId: bigint,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const active = await this.activeRoles(tx, tenantId, userId);
    const roles = active.map((r) => r.roleCode);
    const roleIds = active.map((r) => r.roleId);

    if (roleIds.length === 0) {
      return { roles: [], permissions: [] };
    }

    const grants = await tx.role_permission.findMany({
      where: { role_id: { in: roleIds } },
      include: { permission: true },
    });

    const permissions = [
      ...new Set(
        grants
          .filter((g) => g.permission.is_active)
          .map((g) => g.permission.permission_code),
      ),
    ].sort();

    return { roles: [...new Set(roles)].sort(), permissions };
  }

  private async createSession(
    tx: TxClient,
    tenantId: bigint,
    userId: bigint,
    persistent: boolean,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const ttl = persistent ? this.config.refreshTtl : this.config.refreshTtlSession;
    const refreshToken = this.tokens.signRefreshToken(
      { jti: randomUUID(), uid: userId.toString(), tid: tenantId.toString() },
      ttl,
    );

    await tx.user_session.create({
      data: {
        tenant_id: tenantId,
        user_id: userId,
        token_hash: this.tokens.hashToken(refreshToken),
        device_type: meta.deviceType,
        user_agent: meta.userAgent ?? null,
        ip_address: meta.ip ?? null,
        expires_at: new Date(Date.now() + ttl * 1000),
        last_used_at: new Date(),
      },
    });

    return { refreshToken, refreshTtl: ttl, persistent };
  }

  private async revokeAllSessions(
    tenantId: bigint,
    userId: bigint,
    reason: string,
  ): Promise<void> {
    await this.prisma.run({ tenantId, userId }, (tx) =>
      tx.user_session.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date(), revoke_reason: reason },
      }),
    );
  }

  /**
   * 로그인 시도 기록.
   *
   * Prisma 의 create() 는 INSERT ... RETURNING 을 쓰는데, RETURNING 은 RLS 의
   * SELECT 정책까지 통과해야 한다. login_history 는 tenant_id 가 NULL 인 행
   * (회사코드 자체가 틀린 경우)을 남겨야 하므로 RETURNING 이 걸린다.
   * append-only 테이블이라 돌려받을 값도 없으니 raw INSERT 로 넣는다.
   *
   * 기록 실패가 로그인 자체를 막지는 않게 한다. 다만 조용히 넘어가면
   * 보안 감사가 비어 버리므로 반드시 로그를 남긴다.
   */
  private async recordLogin(
    tenantId: bigint | null,
    userId: bigint | null,
    loginId: string,
    result: LoginResultCode,
    failReason: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    try {
      await this.prisma.runSystem(
        (tx) => tx.$executeRaw`
          INSERT INTO ntms.login_history (
            tenant_id, user_id, login_id, login_type, login_result,
            fail_reason, ip_address, user_agent, device_type
          ) VALUES (
            ${tenantId}, ${userId}, ${loginId}, 'PASSWORD',
            ${result}::ntms.login_result,
            ${failReason}, ${meta.ip ?? null}::inet, ${meta.userAgent ?? null},
            ${meta.deviceType}
          )
        `,
      );
    } catch (error) {
      this.logger.error(
        `로그인 이력 기록 실패 (login_id=${loginId}, result=${result}): ${(error as Error).message}`,
      );
    }
  }
}

/**
 * 평평한 메뉴 목록을 두 단계 트리로 접는다.
 *
 * 부모가 목록에 없는 자식은 버린다. 최상위 메뉴에 접근 권한이 없는데 그 아래
 * 화면만 열려 있으면, 갈 수 없는 곳으로 가는 링크가 남기 때문이다.
 */
function buildMenuTree(
  rows: Array<{
    menu: {
      menu_id: bigint;
      parent_menu_id: bigint | null;
      menu_code: string;
      menu_name: string;
      menu_path: string | null;
      icon_name: string | null;
      sort_order: number;
    };
    perms: MenuPermissions;
  }>,
): MenuNode[] {
  const toNode = (row: (typeof rows)[number]): MenuNode => ({
    menuId: row.menu.menu_id.toString(),
    menuCode: row.menu.menu_code,
    menuName: row.menu.menu_name,
    menuPath: row.menu.menu_path,
    iconName: row.menu.icon_name,
    permissions: row.perms,
    children: [],
  });

  const bySort = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.menu.sort_order - b.menu.sort_order;

  const roots = new Map<string, MenuNode>();
  for (const row of rows.filter((r) => r.menu.parent_menu_id === null).sort(bySort)) {
    roots.set(row.menu.menu_id.toString(), toNode(row));
  }

  for (const row of rows.filter((r) => r.menu.parent_menu_id !== null).sort(bySort)) {
    const parent = roots.get(row.menu.parent_menu_id!.toString());
    if (parent) parent.children.push(toNode(row));
  }

  return [...roots.values()];
}

function isExpired(at: Date | null): boolean {
  return at !== null && at.getTime() <= Date.now();
}

function daysUntil(at: Date | null): number | null {
  if (!at) return null;
  return Math.ceil((at.getTime() - Date.now()) / 86_400_000);
}
