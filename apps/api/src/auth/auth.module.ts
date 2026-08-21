import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { RolesGuard } from './roles.guard.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // 시크릿은 서명할 때마다 명시적으로 넘긴다. 액세스와 리프레시가 서로
    // 다른 키를 쓰기 때문에 모듈 기본값을 두면 실수로 섞이기 쉽다.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthConfig,
    AuthService,
    PasswordService,
    TokenService,
    JwtStrategy,
    // 전역 인증 가드. 기본은 잠김이고 @Public() 이 붙은 라우트만 열린다.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 그다음이 역할 가드. 순서가 뒤집히면 req.user 가 아직 없어 통과해 버린다.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthConfig, PasswordService],
})
export class AuthModule {}
