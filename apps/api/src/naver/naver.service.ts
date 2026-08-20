import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/api-error.js';

/**
 * NAVER Cloud Platform 지도 API.
 *
 * ## 왜 서버를 거치나
 *
 * 지오코딩과 경로탐색은 **키가 필요한 유료 API** 다. 브라우저에서 직접
 * 부르면 키가 개발자 도구에 그대로 보이고, 남이 그 키로 우리 요금을 쓴다.
 * 지도를 그리는 JS SDK 만 브라우저용 키(ncpKeyId)를 쓰고, 나머지는 전부
 * 여기를 거친다.
 *
 * ## 키가 없을 때
 *
 * 키를 안 넣어도 앱은 뜬다. 지도 자리에 "키가 설정되지 않았습니다" 가
 * 보이고 이 창구는 503 을 낸다. 지도 하나 때문에 배차판 전체가 안 뜨는
 * 것이 훨씬 나쁘다.
 *
 * ## 발급받을 것 (NCP 콘솔)
 *
 *   Maps > Application 등록 후
 *     NAVER_MAP_CLIENT_ID       Client ID
 *     NAVER_MAP_CLIENT_SECRET   Client Secret (서버 전용)
 *
 *   Application 의 "Web 서비스 URL" 에 접속 도메인을 등록해야 SDK 가 뜬다.
 *   지금이면 http://www.qqq.ai.kr 과 http://175.45.193.174 둘 다.
 */
@Injectable()
export class NaverService {
  private readonly logger = new Logger(NaverService.name);

  private readonly clientId: string | null;
  private readonly apiKeyId: string | null;
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    /*
      NCP Maps 는 Application 하나에 Client ID · Client Secret 한 쌍을 준다.
      그 한 쌍이 두 곳에 쓰인다 —

        JS SDK      ncpKeyId = Client ID
        REST API    x-ncp-apigw-api-key-id = Client ID
                    x-ncp-apigw-api-key    = Client Secret

      즉 브라우저에 나가는 값과 서버 전용 값이 갈리는 지점은 **Secret 하나**다.
      Client ID 는 원래 화면에 박히는 값이라 감출 대상이 아니고, 대신 NCP
      콘솔의 "Web 서비스 URL" 로 도메인을 묶어 남이 못 쓰게 한다.
    */
    this.clientId = trimmed(config.get<string>('NAVER_MAP_CLIENT_ID'));
    this.apiKeyId = this.clientId;
    this.apiKey = trimmed(config.get<string>('NAVER_MAP_CLIENT_SECRET'));

    if (!this.clientId) {
      this.logger.warn(
        '지도 키가 없습니다 (NAVER_MAP_CLIENT_ID). 지도 화면은 안내 문구만 보입니다',
      );
    }
  }

  /** 화면이 지도를 띄울 수 있는지, 띄운다면 어떤 키로 */
  config(): { enabled: boolean; clientId: string | null; serverReady: boolean } {
    return {
      enabled: this.clientId !== null,
      clientId: this.clientId,
      serverReady: this.apiKeyId !== null && this.apiKey !== null,
    };
  }

  /**
   * 주소 → 좌표.
   *
   * 거점 마스터의 위·경도를 채우는 데 쓴다. 좌표가 없으면 구간 거리도,
   * 지도 위 위치도 없다.
   */
  async geocode(query: string): Promise<GeocodeResult[]> {
    const body = await this.call<{
      addresses?: {
        roadAddress?: string;
        jibunAddress?: string;
        x: string;
        y: string;
      }[];
    }>('https://maps.apigw.ntruss.com/map-geocode/v2/geocode', { query });

    return (body.addresses ?? []).map((a) => ({
      roadAddress: a.roadAddress ?? null,
      jibunAddress: a.jibunAddress ?? null,
      longitude: Number(a.x),
      latitude: Number(a.y),
    }));
  }

  /**
   * 경로탐색 (Directions 5).
   *
   * 트립의 정차 순서를 그대로 넘겨 실제 도로 경로를 받는다. 지금은
   * 라우트 마스터의 고정 거리를 쓰지만, 이 창구가 붙으면 **그날의
   * 도로 사정을 반영한 거리·소요시간**을 쓸 수 있다.
   *
   * 경유지는 최대 5곳이다(Directions 5 제한). 그보다 많은 정차는 구간을
   * 나눠 여러 번 불러야 한다.
   */
  async directions(input: {
    start: LatLng;
    goal: LatLng;
    waypoints?: LatLng[];
    option?: 'trafast' | 'tracomfort' | 'traoptimal' | 'traavoidtoll';
  }): Promise<DirectionsResult> {
    const waypoints = (input.waypoints ?? []).slice(0, 5);
    if ((input.waypoints ?? []).length > 5) {
      this.logger.warn(
        `경유지가 ${input.waypoints!.length}곳입니다. Directions 5 는 5곳까지라 앞의 5곳만 씁니다`,
      );
    }

    const params: Record<string, string> = {
      start: `${input.start.longitude},${input.start.latitude}`,
      goal: `${input.goal.longitude},${input.goal.latitude}`,
      option: input.option ?? 'trafast',
    };
    if (waypoints.length > 0) {
      params.waypoints = waypoints.map((w) => `${w.longitude},${w.latitude}`).join('|');
    }

    const body = await this.call<{
      code: number;
      message?: string;
      route?: Record<
        string,
        {
          summary: { distance: number; duration: number; tollFare?: number; taxiFare?: number };
          path: [number, number][];
        }[]
      >;
    }>('https://maps.apigw.ntruss.com/map-direction/v1/driving', params);

    if (body.code !== 0) {
      throw AppError.badRequest(
        'NAVER_DIRECTIONS_FAILED',
        body.message ?? '경로를 찾지 못했습니다.',
      );
    }

    const first = Object.values(body.route ?? {})[0]?.[0];
    if (!first) {
      throw AppError.badRequest('NAVER_DIRECTIONS_EMPTY', '경로를 찾지 못했습니다.');
    }

    return {
      distanceKm: Math.round((first.summary.distance / 1000) * 10) / 10,
      durationMin: Math.round(first.summary.duration / 60_000),
      tollFare: first.summary.tollFare ?? null,
      // [경도, 위도] 순서로 온다. 지도 SDK 도 같은 순서를 쓰므로 그대로 둔다.
      path: first.path,
    };
  }

  // -------------------------------------------------------------------

  private async call<T>(url: string, params: Record<string, string>): Promise<T> {
    if (!this.apiKeyId || !this.apiKey) {
      throw new AppError(
        503,
        'NAVER_KEY_MISSING',
        '지도 서버 키가 설정되지 않았습니다. 관리자에게 문의하세요.',
      );
    }

    const qs = new URLSearchParams(params).toString();
    let res: Response;
    try {
      res = await fetch(`${url}?${qs}`, {
        headers: {
          'x-ncp-apigw-api-key-id': this.apiKeyId,
          'x-ncp-apigw-api-key': this.apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // 지도 API 가 느리거나 막혀도 우리 화면이 통째로 멎으면 안 된다
      throw new AppError(
        503,
        'NAVER_UNREACHABLE',
        '지도 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`네이버 API ${res.status}: ${text.slice(0, 200)}`);
      throw new AppError(
        res.status === 401 || res.status === 403 ? 502 : 502,
        'NAVER_API_ERROR',
        res.status === 401 || res.status === 403
          ? '지도 API 키가 올바르지 않습니다.'
          : '지도 서비스가 요청을 처리하지 못했습니다.',
      );
    }

    return (await res.json()) as T;
  }
}

function trimmed(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface GeocodeResult {
  roadAddress: string | null;
  jibunAddress: string | null;
  latitude: number;
  longitude: number;
}

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  tollFare: number | null;
  /** [경도, 위도] 쌍의 배열 */
  path: [number, number][];
}
