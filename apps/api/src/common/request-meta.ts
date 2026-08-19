import type { Request } from 'express';

/** 로그인 이력 · 세션에 남길 요청 정보 */
export interface RequestMeta {
  /** 감사로그의 client_ip. nginx 뒤이므로 trust proxy 설정에 의존한다 */
  ip: string | undefined;
  userAgent: string | undefined;
  deviceType: 'WEB' | 'MOBILE' | 'APP';
}

/**
 * Express 의 req.ip 는 trust proxy 설정에 따라 X-Forwarded-For 를 반영한다.
 * (main.ts 에서 set('trust proxy', 1))
 *
 * INET 컬럼에 그대로 들어가므로 IPv4-mapped IPv6(::ffff:1.2.3.4) 는 벗겨낸다.
 * 이 형식이 섞이면 같은 IP 가 두 가지로 기록되어 이력 조회가 어긋난다.
 */
export function requestMeta(req: Request): RequestMeta {
  const raw = req.ip ?? req.socket.remoteAddress ?? undefined;
  const ip = raw?.startsWith('::ffff:') ? raw.slice(7) : raw;
  const userAgent = req.get('user-agent') ?? undefined;

  return {
    ip: ip && ip !== '::1' ? ip : ip === '::1' ? '127.0.0.1' : undefined,
    userAgent: userAgent?.slice(0, 500),
    deviceType: detectDevice(userAgent),
  };
}

function detectDevice(userAgent: string | undefined): RequestMeta['deviceType'] {
  if (!userAgent) return 'WEB';
  if (/NTMS-App/i.test(userAgent)) return 'APP';
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent)) return 'MOBILE';
  return 'WEB';
}
