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
