import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from './auth.types.js';

export const IS_PUBLIC_KEY = 'ntms:isPublic';

/**
 * 인증 없이 열어 두는 라우트.
 *
 * JwtAuthGuard 가 전역(APP_GUARD)으로 걸려 있으므로, 기본값은 "잠김" 이고
 * 여는 쪽에 표시를 남긴다. 반대로 하면 새 컨트롤러를 추가할 때마다 가드를
 * 붙이는 것을 잊는 순간 그대로 공개된다.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_ROLES_KEY = 'ntms:roles';

/** 지정한 역할 중 하나라도 가지고 있어야 통과한다 */
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

/** 인증을 통과한 요청 주체를 꺼낸다 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    if (!req.user) {
      throw new Error('CurrentUser 를 인증되지 않은 라우트에서 사용했습니다');
    }
    return req.user;
  },
);
