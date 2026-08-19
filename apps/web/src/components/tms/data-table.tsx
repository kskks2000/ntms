'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from './panels';

/**
 * 업무 표.
 *
 * TMS 화면의 대부분은 표다. 오더 · 트립 · 배차 · 차량 · 정산 명세가 모두
 * 같은 모양이어야 하고, 그래야 사람이 화면마다 다시 배우지 않는다.
 * 그래서 표는 화면마다 만들지 않고 여기 하나만 둔다.
 *
 * 규칙
 *   · 숫자는 오른쪽 정렬 + 고정폭. 자릿수가 세로로 맞아야 눈으로 비교된다.
 *   · 머리글은 스크롤에 붙어 있는다. 200줄을 내려가도 무슨 열인지 알아야 한다.
 *   · 줄무늬(zebra)를 쓰지 않는다. 헤어라인만으로 충분하고, 줄무늬는 상태
 *     색과 싸운다.
 *   · 행 전체가 눌린다. 좁은 링크 하나를 조준하게 하지 않는다.
 */
export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  /** 표 폭을 고정할 때. 미지정이면 내용에 맡긴다 */
  width?: string;
  /** 숫자 열인가 — 고정폭 · 오른쪽 정렬이 함께 걸린다 */
  numeric?: boolean;
  sortKey?: string;
  render: (row: T) => ReactNode;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  sort,
  onSortChange,
  loading = false,
  skeletonRows = 8,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  /** 표가 무엇을 담고 있는지. 화면에는 보이지 않는다 */
  caption: string;
}) {
  if (!loading && rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-subtle">
            {columns.map((col) => {
              const active = sort && col.sortKey === sort.key;
              const sortable = Boolean(col.sortKey && onSortChange);

              return (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    'sticky top-0 z-10 whitespace-nowrap bg-surface-card px-3 py-2.5 text-label font-medium text-content-secondary',
                    col.numeric || col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                        ? 'text-center'
                        : 'text-left',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSortChange!({
                          key: col.sortKey!,
                          dir: active && sort.dir === 'desc' ? 'asc' : 'desc',
                        })
                      }
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm transition-colors duration-fast hover:text-content-primary',
                        active && 'text-content-primary',
                        col.numeric || col.align === 'right' ? 'flex-row-reverse' : '',
                      )}
                    >
                      {col.header}
                      {active ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp size={13} strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={13} strokeWidth={2} aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown
                          size={13}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="text-content-tertiary/60"
                        />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="border-b border-line-subtle">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2.5">
                      <Skeleton className="h-3.5 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-line-subtle transition-colors duration-fast',
                    onRowClick && 'cursor-pointer hover:bg-surface-sunken',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-3 py-2.5 text-body text-content-primary',
                        col.numeric && 'tabular text-right',
                        !col.numeric && col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 쪽 넘김.
 *
 * "1 2 3 … 47" 식의 번호 나열을 쓰지 않는다. 47쪽으로 바로 가는 사람은 없고,
 * 대신 지금 몇 번째를 보고 있는지가 항상 보여야 한다.
 */
export function Pagination({
  page,
  size,
  total,
  onPageChange,
  onSizeChange,
}: {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange?: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-4 py-3">
      <p className="text-caption text-content-secondary">
        <span className="tabular">
          {from.toLocaleString('ko-KR')}–{to.toLocaleString('ko-KR')}
        </span>{' '}
        / 전체 <span className="tabular">{total.toLocaleString('ko-KR')}</span>건
      </p>

      {onSizeChange && (
        <label className="flex items-center gap-1.5 text-caption text-content-tertiary">
          <span className="sr-only">쪽당 건수</span>
          <select
            value={size}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            className="h-8 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary"
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}건씩
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ml-auto flex items-center gap-2">
        <PageButton disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          이전
        </PageButton>
        <span className="tabular text-caption text-content-secondary">
          {page} / {totalPages}
        </span>
        <PageButton
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          다음
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 rounded-md border border-line-field bg-surface-card px-3 text-caption text-content-primary transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
