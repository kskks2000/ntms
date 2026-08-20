'use client';

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
  useQuery,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError, apiFetch } from './api-client';
import { useAuth } from './auth-context';

/**
 * 관제 화면은 사람이 계속 들여다보는 화면이다. 창을 다시 보는 순간 낡은
 * 숫자가 떠 있으면 안 되고, 반대로 매초 다시 부르면 서버가 견디지 못한다.
 * 그 사이를 기본값으로 정해 둔다.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // 인증·권한 문제는 다시 불러도 결과가 같다. 재시도는 소음일 뿐이다.
          if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // 클라이언트를 렌더마다 새로 만들면 캐시가 매번 비워진다
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * 인증된 GET 조회.
 *
 * 액세스 토큰은 메모리에만 있으므로 훅이 직접 꺼내 붙인다. 토큰이 아직
 * 없으면(세션 복구 중) 질의를 미룬다 — 없는 토큰으로 불러서 401 을 받고
 * 재시도하는 것보다 기다리는 편이 조용하다.
 */
export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  options?: Omit<UseQueryOptions<T, ApiRequestError>, 'queryKey' | 'queryFn'>,
): UseQueryResult<T, ApiRequestError> {
  const { accessToken, ready } = useAuth();

  return useQuery<T, ApiRequestError>({
    queryKey: key,
    queryFn: ({ signal }) => apiFetch<T>(path, { accessToken, signal }),
    enabled: ready && Boolean(accessToken) && (options?.enabled ?? true),
    ...options,
  });
}

/**
 * 인증된 쓰기 (POST · PATCH · DELETE).
 *
 * 성공하면 `invalidate` 로 준 접두사를 가진 질의를 모두 낡은 것으로 표시한다.
 * 기준정보를 고치면 목록의 행뿐 아니라 위쪽 요약 숫자("만료 임박 8건")도
 * 함께 달라지는데, 고친 행만 갈아 끼우면 그 숫자가 옛 값으로 남는다.
 */
export function useApiMutation<TResult, TBody>(
  build: (body: TBody) => { path: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' },
  options?: {
    /** 낡은 것으로 표시할 질의 키 접두사 */
    invalidate?: readonly (readonly unknown[])[];
    onSuccess?: (result: TResult, body: TBody) => void;
  },
): UseMutationResult<TResult, ApiRequestError, TBody> {
  const { accessToken } = useAuth();
  const client = useQueryClient();

  return useMutation<TResult, ApiRequestError, TBody>({
    mutationFn: (body) => {
      const { path, method } = build(body);
      return apiFetch<TResult>(path, { method, body, accessToken });
    },
    onSuccess: (result, body) => {
      for (const key of options?.invalidate ?? []) {
        void client.invalidateQueries({ queryKey: key });
      }
      options?.onSuccess?.(result, body);
    },
  });
}
