/** API 응답 공통 형식 */

export interface PageMeta {
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

export interface PageResult<T> {
  items: T[];
  meta: PageMeta;
}

export interface ApiError {
  code: string;
  message: string;
  /** 필드별 검증 오류. 폼에 그대로 매핑한다. */
  fields?: Record<string, string[]>;
  /**
   * 화면이 문구를 만들 때 쓰는 부가 정보.
   * 예) 로그인 실패 시 { failCount, maxFailCount } → "5회 중 2회 실패".
   * 사람이 읽는 문장을 서버가 만들지 않기 위한 자리다.
   */
  detail?: Record<string, unknown>;
  traceId?: string;
}

export function toPageResult<T>(
  items: T[],
  total: number,
  page: number,
  size: number,
): PageResult<T> {
  return {
    items,
    meta: {
      page,
      size,
      total,
      totalPages: size > 0 ? Math.ceil(total / size) : 0,
    },
  };
}
