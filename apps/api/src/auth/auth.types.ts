import type { TenantContext } from '@ntms/db';

/**
 * 액세스 토큰이 싣고 다니는 것.
 *
 * 권한 코드(permission)는 넣지 않는다. 대기업 테넌트에서는 수백 개가 되어
 * 헤더 크기를 압박하고, 권한을 회수해도 토큰 만료(15분)까지 살아 있게 된다.
 * 역할(role)만 싣고 세부 권한은 서버에서 확인한다.
 */
export interface AccessTokenPayload {
  /** 외부 노출용 식별자 (user_uuid). 순번 추측을 막는다 */
  sub: string;
  /** user_id — BIGINT 라 문자열로 싣는다 */
  uid: string;
  /** tenant_id */
  tid: string;
  /** tenant_code */
  tcd: string;
  /** login_id */
  lid: string;
  /** 역할 코드 */
  rol: string[];
  iat?: number;
  exp?: number;
}

/**
 * 리프레시 토큰.
 *
 * 실제 판정은 user_session 행(token_hash · revoked_at · expires_at)이 한다.
 * 토큰이 나르는 것은 "어느 테넌트의 세션을 찾아야 하는가" 뿐이다.
 */
export interface RefreshTokenPayload {
  /** 같은 순간 발급돼도 토큰이 겹치지 않게 하는 난수 */
  jti: string;
  uid: string;
  tid: string;
  iat?: number;
  exp?: number;
}

/** 인증을 통과한 요청 주체. @CurrentUser() 가 돌려준다 */
export interface AuthPrincipal {
  userId: bigint;
  userUuid: string;
  tenantId: bigint;
  tenantCode: string;
  loginId: string;
  roles: string[];
}

/** 회사코드로 찾아낸 테넌트 (fn_auth_resolve_tenant 반환) */
export interface ResolvedTenant {
  tenant_id: bigint;
  tenant_code: string;
  tenant_name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  is_active: boolean;
  locale: string;
  timezone: string;
}

/** 주체 + 요청 IP → DB 세션 컨텍스트 */
export function toTenantContext(
  principal: AuthPrincipal,
  clientIp?: string,
): TenantContext {
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    clientIp,
  };
}
