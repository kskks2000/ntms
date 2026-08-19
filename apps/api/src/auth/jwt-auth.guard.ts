import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_ERROR, AUTH_ERROR_MESSAGE } from '@ntms/shared';
import type { Observable } from 'rxjs';
import { AppError } from '../common/api-error.js';
import { IS_PUBLIC_KEY } from './auth.decorators.js';

/**
 * 전역 가드. 기본값은 "잠김" 이고 @Public() 이 붙은 라우트만 연다.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      // 만료와 위조를 구분해 알려주지 않는다. 화면은 어느 쪽이든 재로그인이다.
      throw AppError.unauthorized(
        AUTH_ERROR.SESSION_EXPIRED,
        AUTH_ERROR_MESSAGE[AUTH_ERROR.SESSION_EXPIRED],
      );
    }
    return user;
  }
}
