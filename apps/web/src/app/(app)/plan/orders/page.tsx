'use client';

import { ClipboardList, Download, Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ORDER_STATUS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_PHASE,
  type MasterOptions,
  type OrderListItem,
  type OrderListSummary,
  type PageResult,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { DataTable, Pagination, type Column, type SortState } from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type OrderListResponse = PageResult<OrderListItem> & { summary: OrderListSummary };

/**
 * 오더 관리.
 *
 * TMS 의 모든 목록 화면은 이 모양을 따른다 —
 *   조건 줄 → 조건에 걸린 합계 → 표 → 쪽 넘김
 *
 * 합계를 표 위에 두는 이유는, 조건을 바꿀 때마다 "몇 건 · 몇 톤" 이 먼저
 * 눈에 들어와야 하기 때문이다. 표 아래에 두면 스크롤해야 보인다.
 */
export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [status, setStatus] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'orderDate', dir: 'desc' });
  /*
    화주와 상차일 기간은 API 가 이미 받고 있었는데 화면에 없었다.
    배차실에서 가장 자주 하는 질문이 "이번 주 한빛식품 건" 이라 그 두 개를
    꺼내 둔다. 나머지 조건은 검색어로 충분하다.
  */
  const [shipperId, setShipperId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const router = useRouter();
  const options = useApiQuery<MasterOptions>(['master-options'], '/master/options', {
    staleTime: 5 * 60_000,
  });

  const path = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      sort: `${sort.key}:${sort.dir}`,
    });
    if (status) params.set('status', status);
    if (keyword) params.set('keyword', keyword);
    if (shipperId) params.set('shipperId', shipperId);
    if (dateFrom) params.set('pickupDateFrom', dateFrom);
    if (dateTo) params.set('pickupDateTo', dateTo);
    return `/orders?${params.toString()}`;
  }, [page, size, status, keyword, sort, shipperId, dateFrom, dateTo]);

  const query = useApiQuery<OrderListResponse>(['orders', path], path);
  const data = query.data;

  const hasCondition = Boolean(status || keyword || shipperId || dateFrom || dateTo);

  const applyKeyword = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };

  const columns: Column<OrderListItem>[] = [
    {
      key: 'orderNo',
      header: '오더번호',
      sortKey: 'orderNo',
      render: (o) => (
        <span className="flex items-center gap-1.5">
          <span className="tabular font-medium">{o.orderNo}</span>
          {o.isTimeCritical && (
            <span
              title="시간 엄수"
              className="rounded-sm bg-status-warning-surface px-1 text-[10px] font-medium text-status-warning"
            >
              시간엄수
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: '상태',
      sortKey: 'status',
      render: (o) => (
        <StatusChip
          label={ORDER_STATUS_LABEL[o.status] ?? o.status}
          phase={ORDER_STATUS_PHASE[o.status] ?? 'planned'}
        />
      ),
    },
    { key: 'shipper', header: '화주', render: (o) => o.shipperName },
    {
      key: 'lane',
      header: '구간',
      render: (o) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{o.fromName}</span>
          <span aria-hidden="true" className="text-content-tertiary">
            →
          </span>
          <span className="truncate">{o.toName}</span>
        </span>
      ),
    },
    {
      key: 'window',
      header: '상차 시간창',
      render: (o) =>
        o.pickupFrom ? (
          <span className="tabular text-content-secondary">
            {o.pickupFrom}–{o.pickupTo ?? ''}
          </span>
        ) : (
          <span className="text-content-tertiary">미지정</span>
        ),
    },
    {
      key: 'weight',
      header: '중량',
      numeric: true,
      sortKey: 'weightKg',
      render: (o) => `${o.weightKg.toLocaleString('ko-KR')} kg`,
    },
    {
      key: 'distance',
      header: '거리',
      numeric: true,
      sortKey: 'distanceKm',
      render: (o) => (o.distanceKm === null ? '—' : `${o.distanceKm.toLocaleString('ko-KR')} km`),
    },
    {
      key: 'amount',
      header: '예상운임',
      numeric: true,
      sortKey: 'amount',
      render: (o) =>
        o.estimatedAmount === null ? '—' : o.estimatedAmount.toLocaleString('ko-KR'),
    },
    {
      key: 'trip',
      header: '편성',
      render: (o) =>
        o.tripNo ? (
          <span className="tabular text-content-secondary">{o.tripNo}</span>
        ) : (
          <span className="text-caption text-content-tertiary">미편성</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title="오더 관리"
        description="접수된 운송오더를 확인하고 편성 대상을 고릅니다."
        actions={
          <>
            <Button
              variant="secondary"
              leadingIcon={<Download size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              내려받기
            </Button>
            <Link
              href="/plan/orders/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-action px-4 text-body font-medium text-action-text transition-colors hover:bg-action-hover"
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              오더 등록
            </Link>
          </>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {/* --- 조건 --------------------------------------------------- */}
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
              placeholder="오더번호 · 상차지 · 하차지"
              aria-label="오더 검색"
              className="field-text h-10 w-72 rounded-md border border-line-field bg-surface-field pl-9 pr-3 text-content-primary placeholder:text-content-tertiary/70"
            />
          </div>

          <StatusFilter
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
          />

          <label className="flex items-center gap-1.5">
            <span className="sr-only">화주</span>
            <select
              value={shipperId}
              onChange={(ev) => {
                setShipperId(ev.target.value);
                setPage(1);
              }}
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-label text-content-primary"
            >
              <option value="">화주 전체</option>
              {(options.data?.shippers ?? []).map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-caption text-content-tertiary">
            <span>상차일</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(ev) => {
                setDateFrom(ev.target.value);
                setPage(1);
              }}
              aria-label="상차일 시작"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-label text-content-primary"
            />
            <span aria-hidden="true">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(ev) => {
                setDateTo(ev.target.value);
                setPage(1);
              }}
              aria-label="상차일 종료"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-label text-content-primary"
            />
          </label>

          {(status || keyword || shipperId || dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus('');
                setKeyword('');
                setKeywordInput('');
                setShipperId('');
                setDateFrom('');
                setDateTo('');
                setPage(1);
              }}
              leadingIcon={<X size={14} strokeWidth={2} aria-hidden="true" />}
            >
              조건 지우기
            </Button>
          )}
        </div>

        {/* --- 조건에 걸린 합계 ---------------------------------------- */}
        <StatRow>
          <Stat label="오더" value={data?.summary.totalCount ?? '—'} unit="건" />
          <Stat
            label="총 중량"
            value={
              data ? Math.round(data.summary.totalWeightKg / 1000).toLocaleString('ko-KR') : '—'
            }
            unit="t"
          />
          <Stat
            label="예상 운임"
            value={
              data ? Math.round(data.summary.totalAmount / 10000).toLocaleString('ko-KR') : '—'
            }
            unit="만원"
          />
        </StatRow>

        {/* --- 표 ----------------------------------------------------- */}
        <Panel bodyClassName="flex flex-col">
          <DataTable
            caption="운송오더 목록"
            columns={columns}
            rows={data?.items ?? []}
            getRowKey={(o) => o.orderId}
            // 줄을 누르면 상세로 간다. 배차실에서 목록을 여는 목적은 거의
            // 언제나 "그 건 어떻게 됐나" 를 보는 것이다.
            onRowClick={(o) => router.push(`/plan/orders/${o.orderId}`)}
            loading={query.isLoading}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            empty={
              <EmptyState
                icon={<ClipboardList size={26} strokeWidth={1.5} />}
                title={
                  hasCondition ? '조건에 맞는 오더가 없습니다' : '접수된 오더가 없습니다'
                }
                description={
                  hasCondition
                    ? '검색어나 조건을 바꿔 보세요.'
                    : '화주 시스템에서 오더가 들어오거나, 직접 등록하면 여기에 쌓입니다.'
                }
                action={
                  <Link
                    href="/plan/orders/new"
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-action px-4 text-body font-medium text-action-text transition-colors hover:bg-action-hover"
                  >
                    <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                    오더 등록
                  </Link>
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
      </div>
    </>
  );
}

/**
 * 상태 거르개.
 *
 * 15가지를 드롭다운에 다 넣으면 고르기 어렵다. 배차 담당자가 실제로 자주
 * 거르는 몇 가지를 앞에 버튼으로 꺼내 두고, 나머지는 목록에 남긴다.
 */
const QUICK = ['RECEIVED', 'PLANNED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT'] as const;

function StatusFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {QUICK.map((s) => {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? '' : s)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-caption transition-colors duration-fast',
              active
                ? 'border-action bg-action text-action-text'
                : 'border-line-field bg-surface-card text-content-secondary hover:bg-surface-sunken',
            )}
          >
            {ORDER_STATUS_LABEL[s]}
          </button>
        );
      })}

      <label className="flex items-center gap-1.5">
        <span className="sr-only">전체 상태</span>
        <select
          value={QUICK.includes(value as (typeof QUICK)[number]) ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary"
        >
          <option value="">그 밖의 상태</option>
          {ORDER_STATUS.filter(
            (s) => !QUICK.includes(s as (typeof QUICK)[number]),
          ).map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
