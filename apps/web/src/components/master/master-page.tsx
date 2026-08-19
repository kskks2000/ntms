'use client';

import { Download, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { MasterListMeta, PageResult } from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import {
  DataTable,
  Pagination,
  type Column,
} from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type MasterResponse<T> = PageResult<T> & { meta2: MasterListMeta };

export interface FilterOption {
  value: string;
  label: string;
  /** 버튼 옆에 붙는 수. 없으면 안 붙는다 */
  count?: number;
}

/**
 * 기준정보 목록 화면의 뼈대.
 *
 * 여덟 화면이 같은 골격을 쓴다 —
 *   검색·거르개 → 조건에 걸린 요약 → 표 → 쪽 넘김
 *
 * 화면마다 다른 것은 **컬럼과 요약 지표뿐**이다. 표를 화면마다 새로 짜면
 * 정렬 방식·빈 상태·쪽 넘김이 여덟 갈래로 갈라지고, 사람이 화면을 옮길
 * 때마다 다시 배워야 한다.
 *
 * 요약에 "사용중" 과 "손봐야 할 것" 을 함께 두는 이유는, 기준정보를 여는
 * 목적이 목록을 보는 것이 아니라 **쓸 수 있는 상태인지 확인하는 것**이기
 * 때문이다. 그 수가 0이 아니면 색이 바뀐다.
 */
export function MasterPage<T>({
  eyebrow,
  title,
  description,
  endpoint,
  fixedFilter,
  queryKey,
  columns,
  getRowKey,
  filters,
  filterLabel,
  searchPlaceholder,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  createLabel,
  extraStats,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** `/master/vehicles` 처럼 앞에 슬래시를 붙인 경로. 쿼리는 붙이지 않는다 */
  endpoint: string;
  /**
   * 화면 자체가 고정으로 거는 조건 (화주 화면의 SHIPPER 처럼).
   * 사용자가 바꿀 수 없으므로 거르개 버튼으로 내보내지 않는다.
   */
  fixedFilter?: string;
  queryKey: string;
  columns: Column<T>[];
  getRowKey: (row: T) => string;
  filters?: FilterOption[];
  filterLabel?: string;
  searchPlaceholder: string;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  createLabel: string;
  /** 화면 고유의 숫자 칸 */
  extraStats?: (data: MasterResponse<T> | undefined) => ReactNode;
  /** 표 옆에 붙는 것 (권역 목록 등) */
  aside?: (data: MasterResponse<T> | undefined) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [filter, setFilter] = useState('');

  const path = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), size: String(size) });
    if (keyword) p.set('keyword', keyword);
    const applied = fixedFilter ?? filter;
    if (applied) p.set('filter', applied);
    return `${endpoint}?${p.toString()}`;
  }, [endpoint, fixedFilter, page, size, keyword, filter]);

  const query = useApiQuery<MasterResponse<T>>([queryKey, path], path);
  const data = query.data;
  const hasCondition = Boolean(keyword || filter);

  const applyKeyword = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };

  const table = (
    <Panel bodyClassName="flex flex-col">
      <DataTable
        caption={`${title} 목록`}
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={getRowKey}
        loading={query.isLoading}
        empty={
          <EmptyState
            icon={emptyIcon}
            title={hasCondition ? '조건에 맞는 항목이 없습니다' : emptyTitle}
            description={
              hasCondition ? '검색어나 거르개를 바꿔 보세요.' : emptyDescription
            }
            action={
              hasCondition ? (
                <Button variant="secondary" onClick={() => clearAll()}>
                  조건 지우기
                </Button>
              ) : (
                <Button leadingIcon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}>
                  {createLabel}
                </Button>
              )
            }
          />
        }
      />
      {data && data.items.length > 0 && (
        <Pagination
          page={data.meta.page}
          size={data.meta.size}
          total={data.meta.total}
          onPageChange={setPage}
          onSizeChange={(n) => {
            setSize(n);
            setPage(1);
          }}
        />
      )}
    </Panel>
  );

  function clearAll() {
    setKeyword('');
    setKeywordInput('');
    setFilter('');
    setPage(1);
  }

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <>
            <Button
              variant="secondary"
              leadingIcon={<Download size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              내려받기
            </Button>
            <Button leadingIcon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}>
              {createLabel}
            </Button>
          </>
        }
      />

      <div className="space-y-5 px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
            />
            <input
              type="search"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyKeyword()}
              onBlur={applyKeyword}
              placeholder={searchPlaceholder}
              aria-label={`${title} 검색`}
              className="field-text h-10 w-72 rounded-md border border-line-field bg-surface-field pl-9 pr-3 text-content-primary placeholder:text-content-tertiary/70"
            />
          </div>

          {filters && filters.length > 0 && (
            <div
              role="group"
              aria-label={filterLabel ?? '거르개'}
              className="flex flex-wrap items-center gap-1.5"
            >
              {filters.map((opt) => {
                const active = filter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFilter(active ? '' : opt.value);
                      setPage(1);
                    }}
                    className={cn(
                      'h-8 rounded-md border px-2.5 text-caption transition-colors duration-fast',
                      active
                        ? 'border-action bg-action text-action-text'
                        : 'border-line-field bg-surface-card text-content-secondary hover:bg-surface-sunken',
                    )}
                  >
                    {opt.label}
                    {opt.count !== undefined && (
                      <span className="tabular ml-1.5 opacity-70">{opt.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {hasCondition && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              leadingIcon={<X size={14} strokeWidth={2} aria-hidden="true" />}
            >
              조건 지우기
            </Button>
          )}
        </div>

        <StatRow>
          <Stat label="전체" value={data?.meta2.total ?? '—'} unit="건" />
          <Stat
            label="사용중"
            value={data?.meta2.activeCount ?? '—'}
            unit="건"
            // 세 번째 칸이 이미 사용중지를 세고 있으면 같은 말을 두 번 하지 않는다
            hint={
              data && data.meta2.attentionLabel !== '사용중지'
                ? `사용중지 ${data.meta2.total - data.meta2.activeCount}건`
                : undefined
            }
          />
          <Stat
            label={data?.meta2.attentionLabel ?? '확인 필요'}
            value={data?.meta2.attentionCount ?? '—'}
            unit="건"
            tone={(data?.meta2.attentionCount ?? 0) > 0 ? 'warning' : 'default'}
          />
          {extraStats?.(data)}
        </StatRow>

        {aside ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
            {table}
            {aside(data)}
          </div>
        ) : (
          table
        )}
      </div>
    </>
  );
}
