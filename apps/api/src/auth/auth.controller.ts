import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  signupSchema,
  tenantLookupSchema,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResult,
  type MenuNode,
  type SignupInput,
  type SignupResult,
  type TenantSummary,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { requestMeta } from '../common/request-meta.js';
import { AuthConfig } from './auth.config.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { CurrentUser, Public } from './auth.decorators.js';
import type { AuthPrincipal } from './auth.types.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
  ) {}

  /**
   * 회사코드 확인. 계정신청 1단계에서 회사명을 되짚어 주는 용도다.
   *
   * 회사코드는 비밀이 아니지만, 이 창구를 열어두면 코드 목록을 긁어 갈 수
   * 있다. 5분에 20회로 묶는다.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @Post('tenant')
  @HttpCode(HttpStatus.OK)
  lookupTenant(
    @Body(new ZodValidationPipe(tenantLookupSchema)) dto: { tenantCode: string },
  ): Promise<TenantSummary> {
    return this.auth.lookupTenant(dto.tenantCode);
  }

  /** 5분에 10회. 한 IP 에서 여러 계정을 훑는 시도를 막는다 */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const { result, session } = await this.auth.login(dto, requestMeta(req));
    this.setRefreshCookie(res, session);
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const token = req.cookies?.[this.config.cookieName] as string | undefined;
    try {
      const { result, session } = await this.auth.refresh(token, requestMeta(req));
      this.setRefreshCookie(res, session);
      return result;
    } catch (error) {
      // 갱신에 실패한 쿠키는 남겨 둘 이유가 없다. 매 요청마다 같은 실패를
      // 반복하지 않도록 여기서 지운다.
      this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.cookies?.[this.config.cookieName] as string | undefined);
    this.clearRefreshCookie(res);
  }

  /** 계정 신청. 승인 전까지 로그인할 수 없는 계정이 만들어진다 */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signup(
    @Body(new ZodValidationPipe(signupSchema)) dto: SignupInput,
    @Req() req: Request,
  ): Promise<SignupResult> {
    return this.auth.signup(dto, requestMeta(req));
  }

  @Get('me')
  me(@CurrentUser() user: AuthPrincipal): Promise<AuthUser> {
    return this.auth.me(user);
  }

  /**
   * 이 사용자가 볼 수 있는 메뉴 트리.
   * 앱 셸이 기동할 때 한 번 부르고, 그 뒤로는 캐시해서 쓴다.
   */
  @Get('menus')
  menus(@CurrentUser() user: AuthPrincipal): Promise<MenuNode[]> {
    return this.auth.menus(user);
  }

  /**
   * 비밀번호 변경.
   *
   * 쿠키를 새로 내리지 않는다. 지금 세션은 그대로 두고 다른 기기만 끊기 때문에,
   * 바꾼 사람은 하던 일을 이어서 하면 된다.
   *
   * 시도 제한을 거는 이유는 현재 비밀번호를 여기서 대입해 볼 수 있기 때문이다.
   */
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordInput,
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
  ): Promise<AuthUser> {
    return this.auth.changePassword(
      user,
      dto,
      requestMeta(req),
      req.cookies?.[this.config.cookieName] as string | undefined,
    );
  }

  // -------------------------------------------------------------------
  // 리프레시 쿠키
  //
  // path 를 '/auth' 로 좁히고 싶지만, 브라우저가 보는 경로는 배포 형태마다
  // 다르다 — 개발은 /api/auth (Next rewrites), 운영은 nginx 의 location
  // 설정에 달렸다. API 서버는 그 접두어를 알 수 없다. 경로로 좁히는 대신
  // httpOnly + SameSite 로 막는다.
  // -------------------------------------------------------------------

  private setRefreshCookie(res: Response, session: IssuedSession): void {
    res.cookie(this.config.cookieName, session.refreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      // "로그인 상태 유지" 를 끄면 maxAge 없이 내보낸다 = 브라우저를 닫으면 사라진다
      ...(session.persistent ? { maxAge: session.refreshTtl * 1000 } : {}),
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(this.config.cookieName, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
  }
}
