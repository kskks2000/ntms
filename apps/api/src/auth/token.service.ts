import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { AuthConfig } from './auth.config.js';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types.js';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AuthConfig,
  ) {}

  signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
    return this.jwt.sign(payload, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessTtl,
    });
  }

  /**
   * 리프레시 토큰도 JWT 로 만든다.
   *
   * 단순 난수를 쓰면 토큰만 보고는 어느 테넌트인지 알 수 없다. 그런데
   * user_session 에는 RLS 가 걸려 있어 app.tenant_id 없이는 조회 자체가
   * 불가능하다 — 세션을 찾으려면 테넌트를 먼저 알아야 하는 순환이 생긴다.
   * 서명된 JWT 에 tid 를 실어서 그 순환을 끊는다.
   *
   * 토큰 자체는 신뢰의 근거가 아니다. 진짜 판정은 user_session 행의
   * token_hash · revoked_at · expires_at 이 한다.
   */
  signRefreshToken(
    payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>,
    ttlSeconds: number,
  ): string {
    return this.jwt.sign(payload, {
      secret: this.config.refreshSecret,
      expiresIn: ttlSeconds,
    });
  }

  verifyRefreshToken(token: string): RefreshTokenPayload | null {
    try {
      return this.jwt.verify<RefreshTokenPayload>(token, {
        secret: this.config.refreshSecret,
      });
    } catch {
      return null;
    }
  }

  /**
   * user_session.token_hash 에 저장할 값.
   * 평문을 저장하면 DB 를 읽을 수 있는 사람이 곧바로 남의 세션이 된다.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
