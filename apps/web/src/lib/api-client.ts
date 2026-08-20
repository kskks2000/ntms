import type { ApiError } from '@ntms/shared';

/**
 * API 호출 한 곳.
 *
 * 개발에서는 Next 의 rewrites 가, 배포에서는 nginx 가 /api 를 Nest 로 넘긴다.
 * 그래서 브라우저는 언제나 같은 출처의 /api 만 부르면 된다 — CORS 와
 * 쿠키 도메인 문제가 통째로 사라진다.
 */
const BASE = '/api';

/** 서버가 내려준 ApiError 를 그대로 들고 다니는 예외 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiError,
  ) {
    super(payload.message);
    this.name = 'ApiRequestError';
  }

  get code(): string {
    return this.payload.code;
  }

  /** 필드별 검증 오류. react-hook-form 의 setError 에 그대로 넘긴다 */
  get fields(): Record<string, string[]> | undefined {
    return this.payload.fields;
  }

  get detail(): Record<string, unknown> | undefined {
    return this.payload.detail;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 액세스 토큰. 메모리에만 두므로 호출부가 넘긴다 */
  accessToken?: string | null;
  signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  { method = 'GET', body, accessToken, signal }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // 리프레시 쿠키를 주고받아야 한다
      credentials: 'include',
      signal,
    });
  } catch {
    // 네트워크가 끊긴 것과 서버가 거절한 것은 사용자가 할 일이 다르다.
    // 같은 문구로 뭉뚱그리지 않는다.
    throw new ApiRequestError(0, {
      code: 'NETWORK_ERROR',
      message: '서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.',
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    const payload: ApiError =
      isApiError(data)
        ? data
        : {
            code: 'UNEXPECTED_RESPONSE',
            message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          };
    throw new ApiRequestError(response.status, payload);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value
  );
}
