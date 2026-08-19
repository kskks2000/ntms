import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 15m / 7d 같은 표기를 초로 바꾼다. 숫자만 오면 그대로 초로 본다.
 * 토큰 수명과 쿠키 maxAge 가 서로 다른 단위로 굴러가는 사고를 막으려고
 * 한 곳에서만 해석한다.
 */
export function parseDurationSeconds(value: string, fallbackSeconds: number): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'd':
      return n * 86_400;
    case 'h':
      return n * 3_600;
    case 'm':
      return n * 60;
    default:
      return n;
  }
}

@Injectable()
export class AuthConfig {
  private readonly logger = new Logger(AuthConfig.name);

  readonly accessSecret: string;
  readonly refreshSecret: string;
  /** 액세스 토큰 수명(초) */
  readonly accessTtl: number;
  /** "로그인 상태 유지" 를 켰을 때의 리프레시 토큰 수명(초) */
  readonly refreshTtl: number;
  /** 켜지 않았을 때. 브라우저를 닫으면 사라지는 세션 쿠키로 나간다 */
  readonly refreshTtlSession: number;
  readonly maxFailCount: number;
  readonly passwordExpireDays: number;
  readonly dormantDays: number;
  readonly cookieName = 'ntms_rt';
  readonly cookieSecure: boolean;

  constructor(config: ConfigService) {
    const isProd = config.get<string>('NODE_ENV') === 'production';

    this.accessSecret = required(config, 'JWT_ACCESS_SECRET', isProd);
    this.refreshSecret = required(config, 'JWT_REFRESH_SECRET', isProd);

    if (this.accessSecret === this.refreshSecret) {
      // 같은 키를 쓰면 액세스 토큰을 리프레시 토큰 자리에 밀어 넣을 수 있다.
      throw new Error('JWT_ACCESS_SECRET 과 JWT_REFRESH_SECRET 은 서로 달라야 합니다');
    }

    this.accessTtl = parseDurationSeconds(
      config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
      900,
    );
    this.refreshTtl = parseDurationSeconds(
      config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
      604_800,
    );
    this.refreshTtlSession = parseDurationSeconds(
      config.get<string>('JWT_REFRESH_SESSION_EXPIRES_IN') ?? '12h',
      43_200,
    );
    this.maxFailCount = Number(config.get('LOGIN_MAX_FAIL_COUNT') ?? 5);
    this.passwordExpireDays = Number(config.get('PASSWORD_EXPIRE_DAYS') ?? 90);
    this.dormantDays = Number(config.get('DORMANT_DAYS') ?? 365);
    this.cookieSecure = isProd;

    if (!isProd) {
      this.logger.warn(
        `개발 모드: 리프레시 쿠키가 Secure 없이 나갑니다 (accessTtl=${this.accessTtl}s)`,
      );
    }
  }
}

function required(config: ConfigService, key: string, isProd: boolean): string {
  const value = config.get<string>(key);
  if (value && value.length >= 32) return value;

  if (isProd) {
    // 운영에서 기본값으로 뜨면 모든 토큰을 누구나 위조할 수 있다. 기동을 막는다.
    throw new Error(`${key} 가 없거나 너무 짧습니다(32자 이상). .env 를 확인하세요.`);
  }
  return value ?? `dev-only-${key.toLowerCase()}-do-not-use-in-production-0000`;
}
