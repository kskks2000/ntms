import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/api-error.js';
import { IS_PUBLIC_KEY, REQUIRED_ROLES_KEY } from './auth.decorators.js';
import type { AuthPrincipal } from './auth.types.js';

/**
 * `@Roles()` 를 실제로 집행한다.
 *
 * 데코레이터만 있고 이걸 읽는 가드가 없으면 `@Roles('ADMIN')` 은 **주석과
 * 같다.** 붙여 놓은 쪽은 잠갔다고 믿고, 실제로는 로그인한 누구나 들어온다.
 * 조용히 열려 있는 문이라 아무도 눈치채지 못한다.
 *
 * JwtAuthGuard 다음에 돌아야 `req.user` 가 채워져 있다. AuthModule 의
 * providers 배열 순서가 그 순서다.
 *
 * 역할은 액세스 토큰(`rol`)에서 온다. 토큰 수명이 15분이므로 역할을 회수해도
 * 최대 15분은 남는다. 되돌릴 수 없는 동작(정산 승인 · 계정 삭제)은 이
 * 가드만 믿지 말고 서비스에서 DB 의 현재 역할을 다시 볼 것.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    const roles = req.user?.roles ?? [];
    if (roles.some((role) => required.includes(role))) return true;

    // 무엇이 필요한지는 알려주지 않는다. 권한 구조를 훑는 데 쓰인다.
    throw AppError.forbidden(
      'FORBIDDEN',
      '이 화면을 볼 권한이 없습니다. 필요하면 시스템 담당자에게 요청해 주세요.',
    );
  }
}
