import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthConfig } from './auth.config.js';
import type { AccessTokenPayload, AuthPrincipal } from './auth.types.js';

/**
 * 액세스 토큰 검증. 통과하면 req.user 에 AuthPrincipal 이 실린다.
 *
 * 여기서 DB 를 조회하지 않는 것은 의도된 선택이다. 요청마다 계정을 다시
 * 읽으면 초당 수천 건이 오가는 관제 화면에서 DB 가 먼저 무너진다.
 * 대신 액세스 토큰 수명을 15분으로 짧게 두고, 권한 변경은 그 안에 반영된다.
 * 즉시 차단이 필요하면 세션을 폐기하는 쪽(refresh 거부)으로 처리한다.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AuthConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
    });
  }

  validate(payload: AccessTokenPayload): AuthPrincipal {
    return {
      userId: BigInt(payload.uid),
      userUuid: payload.sub,
      tenantId: BigInt(payload.tid),
      tenantCode: payload.tcd,
      loginId: payload.lid,
      roles: payload.rol ?? [],
    };
  }
}
