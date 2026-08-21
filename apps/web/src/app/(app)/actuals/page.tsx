'use client';

import { CircleCheck, FileStack, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ACTUAL_CONFIRM_PHASE,
  ACTUAL_CONFIRM_STATUS_LABEL,
  type ActualListItem,
  type ActualListSummary,
  type BulkResult,
  type MasterOptions,
  type PageResult,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { GateBadge } from '@/components/actual/confirm-gate';
import { VarianceTick } from '@/components/actual/variance-spine';
import { DataTable, Pagination, type Column, type SortState } from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type ActualListResponse = PageResult<ActualListItem> & { summary: ActualListSummary };

/**
 * 운송실적.
 *
 * ## 이 화면이 답하는 질문
 *
 * "얼마나 실어 날랐나" 가 아니다. 그건 KPI 가 답한다. 여기서 검수자가 묻는
 * 것은 하나다 — **어느 건을 정산에 넘겨도 되나.**
 *
 * 그래서 목록의 주인공은 건수도 금액도 아니고 **관문**이다. 확정을 막는
 * 것이 있는 줄은 체크박스가 잠기고, 왜 잠겼는지가 그 자리에 붙는다.
 * 상세를 열어야 이유를 알 수 있으면, 스무 건을 확정하려고 스무 번을 연다.
 *
 * 거리 편차 막대는 상세의 편차 축을 한 줄로 줄인 것이다. 목록에서 눈에
 * 걸린 줄을 열면 같은 그림이 다섯 줄로 커져 있다.
 */
export default function ActualsPage() {
  const router = useRouter();
  const toast = useToast();

  const [from, setFrom] = useState(() => toDateInput(daysAgo(6)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [status, setStatus] = useState('OPEN');
  const [carrierId, setCarrierId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastRun, setLastRun] = useState<{ kind: '생성' | '확정'; result: BulkResult } | null>(null);

  const options = useApiQuery<MasterOptions>(['master-options'], '/master/options', {
    staleTime: 5 * 60_000,
  });

  const path = useMemo(() => {
    const params = new URLSearchParams({
      from,
      to,
      page: String(page),
      size: String(size),
      sort: `${sort.key}:${sort.dir}`,
    });
    if (status) params.set('status', status);
    if (carrierId) params.set('carrierId', carrierId);
    if (keyword) params.set('keyword', keyword);
    if (blockedOnly) params.set('blockedOnly', 'true');
    return `/actuals?${params.toString()}`;
  }, [from, to, page, size, sort, status, carrierId, keyword, blockedOnly]);

  const query = useApiQuery<ActualListResponse>(['actuals', path], path);
  const data = query.data;
  const rows = data?.items ?? [];

  // 조건이 바뀌면 선택을 버린다. 안 보이는 줄이 선택된 채로 남아 있으면
  // "확정 12건" 을 눌렀을 때 화면에 없는 건이 확정된다.
  const resetSelection = () => setSelected(new Set());

  const selectable = rows.filter((r) => r.canConfirm);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.actualId));

  const generate = useApiMutation<BulkResult, { from: string; to: string }>(
    () => ({ path: '/actuals/generate', method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: (result) => {
        setLastRun({ kind: '생성', result });
        if (result.succeeded > 0) {
          toast.success(
            `실적 ${result.succeeded}건을 만들었습니다`,
            '검수하고 확정하면 정산으로 넘어갑니다.',
          );
        } else if (result.requested === 0) {
          toast.info('실적을 만들 운송이 없습니다', '이 기간의 완료 운송은 모두 실적이 있습니다.');
        }
      },
    },
  );

  const confirm = useApiMutation<BulkResult, { actualIds: string[] }>(
    () => ({ path: '/actuals/confirm', method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: (result) => {
        setLastRun({ kind: '확정', result });
        resetSelection();
        if (result.succeeded > 0) {
          toast.success(
            `실적 ${result.succeeded}건을 확정했습니다`,
            '정산이 이 숫자를 물고 갑니다.',
          );
        }
      },
    },
  );

  const columns: Column<ActualListItem>[] = [
    {
      key: 'select',
      width: '2.5rem',
      header: (
        <input
          type="checkbox"
          checked={allSelected}
          disabled={selectable.length === 0}
          onChange={(e) =>
            setSelected(e.target.checked ? new Set(selectable.map((r) => r.actualId)) : new Set())
          }
          aria-label="확정할 수 있는 실적 모두 선택"
          className="h-[15px] w-[15px] cursor-pointer appearance-none rounded-sm border border-line-field bg-surface-field checked:border-action checked:bg-action disabled:cursor-not-allowed disabled:opacity-40"
        />
      ),
      render: (r) => (
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
          className="flex"
        >
          <input
            type="checkbox"
            checked={selected.has(r.actualId)}
            disabled={!r.canConfirm}
            // 잠긴 까닭을 그 자리에서 말한다. 상세를 열어야 알 수 있으면
            // 스무 건을 확정하려고 스무 번을 연다.
            title={r.canConfirm ? undefined : (r.blockedReason ?? '확정할 수 없는 상태입니다')}
            aria-label={`${r.actualNo} 선택`}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(r.actualId);
              else next.delete(r.actualId);
              setSelected(next);
            }}
            className="h-[15px] w-[15px] cursor-pointer appearance-none rounded-sm border border-line-field bg-surface-field checked:border-action checked:bg-action disabled:cursor-not-allowed disabled:opacity-30"
          />
        </span>
      ),
    },
    {
      key: 'actualNo',
      header: '실적번호',
      render: (r) => (
        <span className="flex flex-col">
          <span className="tabular font-medium">{r.actualNo}</span>
          <span className="tabular text-caption text-content-tertiary">{r.tripNo}</span>
        </span>
      ),
    },
    {
      key: 'date',
      header: '실적일',
      sortKey: 'date',
      render: (r) => <span className="tabular">{r.actualDate.slice(5)}</span>,
    },
    {
      key: 'status',
      header: '상태',
      render: (r) => (
        <StatusChip
          label={ACTUAL_CONFIRM_STATUS_LABEL[r.confirmStatus] ?? r.confirmStatus}
          phase={ACTUAL_CONFIRM_PHASE[r.confirmStatus] ?? 'planned'}
        />
      ),
    },
    {
      key: 'gate',
      header: '관문',
      render: (r) => <GateBadge blockerCount={r.blockerCount} cautionCount={r.cautionCount} />,
    },
    {
      key: 'carrier',
      header: '운송사 · 차량',
      render: (r) => (
        <span className="flex flex-col">
          <span className="truncate">{r.carrierName}</span>
          <span className="tabular text-caption text-content-tertiary">
            {r.vehicleNo ?? '—'} {r.driverName ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'lane',
      header: '구간',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{r.fromLocationName ?? '—'}</span>
          <span aria-hidden="true" className="text-content-tertiary">
            →
          </span>
          <span className="truncate">{r.toLocationName ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'variance',
      header: '거리 편차',
      sortKey: 'variance',
      width: '11rem',
      render: (r) => <VarianceTick rate={r.distanceVarianceRate} />,
    },
    {
      key: 'delay',
      header: '지연',
      numeric: true,
      render: (r) => (
        <span className={cn(r.delayMinutes >= 30 && 'font-medium text-status-warning')}>
          {r.delayMinutes === 0 ? '—' : `${r.delayMinutes}분`}
        </span>
      ),
    },
    {
      key: 'billing',
      header: '예상 매출',
      numeric: true,
      sortKey: 'billing',
      render: (r) => (r.billingAmount === null ? '—' : r.billingAmount.toLocaleString('ko-KR')),
    },
    {
      key: 'margin',
      header: '마진율',
      numeric: true,
      render: (r) => (r.marginRate === null ? '—' : `${r.marginRate.toFixed(1)}%`),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Actuals"
        title="운송실적"
        description="계획과 실제가 어디서 갈라졌는지 보고, 정산에 넘겨도 되는 건을 확정합니다."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRange
              from={from}
              to={to}
              onFrom={(v) => {
                setFrom(v);
                setPage(1);
                resetSelection();
              }}
              onTo={(v) => {
                setTo(v);
                setPage(1);
                resetSelection();
              }}
            />
            <Button
              variant="secondary"
              onClick={() => void query.refetch()}
              loading={query.isFetching}
              loadingLabel="새로 불러오는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              새로고침
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {/*
          아직 실적이 안 만들어진 완료 운송. 이 화면의 프로세스가 시작되는
          자리라 목록보다 위에 온다 — 실적이 없으면 확정할 것도 없다.
        */}
        {data && data.summary.pendingGeneration > 0 && (
          <Alert
            tone="info"
            title={`실적을 기다리는 운송 ${data.summary.pendingGeneration}건`}
            action={
              <Button
                size="sm"
                loading={generate.isPending}
                loadingLabel="실적을 만드는 중"
                leadingIcon={<Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => generate.mutate({ from, to })}
              >
                실적 만들기
              </Button>
            }
          >
            운송은 끝났는데 실적이 아직 없습니다. 실행 기록에서 거리 · 시간 · 인수증을 모아
            실적 한 건씩을 만듭니다. 만든 뒤에는 검수하고 확정하면 정산으로 넘어갑니다.
          </Alert>
        )}

        {lastRun && lastRun.result.failures.length > 0 && (
          <Alert
            tone="warning"
            title={`${lastRun.result.failures.length}건은 ${lastRun.kind}하지 못했습니다`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setLastRun(null)}>
                닫기
              </Button>
            }
          >
            <ul className="space-y-1">
              {lastRun.result.failures.slice(0, 6).map((f) => (
                <li key={f.id} className="text-caption">
                  <span className="tabular font-medium text-content-primary">{f.label}</span>{' '}
                  <span className="text-content-secondary">{f.reason}</span>
                </li>
              ))}
              {lastRun.result.failures.length > 6 && (
                <li className="text-caption text-content-tertiary">
                  외 {lastRun.result.failures.length - 6}건
                </li>
              )}
            </ul>
          </Alert>
        )}

        <StatRow>
          <Stat
            label="실적"
            value={data?.summary.count ?? '—'}
            unit="건"
            hint={data ? `미확정 ${data.summary.openCount} · 확정 ${data.summary.confirmedCount}` : undefined}
          />
          <Stat
            label="확정 막힘"
            value={data?.summary.blockedCount ?? '—'}
            unit="건"
            hint="인수증 · 예외 · 마감"
            tone={(data?.summary.blockedCount ?? 0) > 0 ? 'danger' : 'default'}
          />
          <Stat
            label="납품 정시율"
            value={data?.summary.onTimeRate ?? '—'}
            unit="%"
            tone={(data?.summary.onTimeRate ?? 100) < 90 ? 'warning' : 'default'}
          />
          <Stat
            label="주행거리"
            value={data ? Math.round(data.summary.totalDistanceKm).toLocaleString('ko-KR') : '—'}
            unit="km"
          />
          <Stat
            label="예상 매출"
            value={data ? compact(data.summary.billingAmount) : '—'}
            unit="원"
            hint="정산 확정 전 추정"
          />
          <Stat
            label="예상 마진"
            value={data ? compact(data.summary.marginAmount) : '—'}
            unit="원"
            hint={data?.summary.marginRate !== null && data ? `${data.summary.marginRate}%` : undefined}
          />
        </StatRow>

        <Panel
          title="실적 목록"
          subtitle="줄을 누르면 편차 축과 확정 관문이 열립니다"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <StatusFilter
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                  resetSelection();
                }}
              />
              <label className="flex items-center gap-1.5 text-caption text-content-secondary">
                <input
                  type="checkbox"
                  checked={blockedOnly}
                  onChange={(e) => {
                    setBlockedOnly(e.target.checked);
                    setPage(1);
                    resetSelection();
                  }}
                  className="h-[15px] w-[15px] cursor-pointer appearance-none rounded-sm border border-line-field bg-surface-field checked:border-action checked:bg-action"
                />
                막힌 것만
              </label>
              <select
                value={carrierId}
                onChange={(e) => {
                  setCarrierId(e.target.value);
                  setPage(1);
                  resetSelection();
                }}
                aria-label="운송사"
                className="h-8 max-w-[10rem] rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary"
              >
                <option value="">운송사 전체</option>
                {(options.data?.carriers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setKeyword(keywordInput.trim());
                  setPage(1);
                  resetSelection();
                }}
              >
                <input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder="실적번호 · 차량 · 기사"
                  aria-label="검색어"
                  className="h-8 w-44 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary placeholder:text-content-tertiary"
                />
              </form>
            </div>
          }
        >
          {/*
            선택 막대. 표 위에 두는 이유는 확정이 되돌릴 수 없는 동작이라,
            누르기 전에 몇 건인지가 반드시 보여야 하기 때문이다.
          */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle bg-surface-sunken px-4 py-2.5">
              <p className="text-label text-content-secondary">
                <span className="tabular font-medium text-content-primary">{selected.size}</span>건
                선택
              </p>
              <p className="text-caption text-content-tertiary">
                확정하면 정산이 이 숫자를 물고 갑니다. 되돌리려면 사유가 필요합니다.
              </p>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={resetSelection}>
                  선택 해제
                </Button>
                <Button
                  size="sm"
                  loading={confirm.isPending}
                  loadingLabel="확정하는 중"
                  leadingIcon={<CircleCheck size={15} strokeWidth={1.75} aria-hidden="true" />}
                  onClick={() => confirm.mutate({ actualIds: [...selected] })}
                >
                  {selected.size}건 확정
                </Button>
              </div>
            </div>
          )}

          <DataTable
            caption="운송실적 목록"
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.actualId}
            onRowClick={(r) => router.push(`/actuals/${r.actualId}`)}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            loading={query.isLoading}
            empty={
              query.isError ? (
                <EmptyState
                  icon={<FileStack size={24} strokeWidth={1.5} />}
                  title="실적을 불러오지 못했습니다"
                  description={query.error.payload.message}
                  action={
                    <Button variant="secondary" onClick={() => void query.refetch()}>
                      다시 시도
                    </Button>
                  }
                />
              ) : blockedOnly ? (
                <EmptyState
                  icon={<Lock size={24} strokeWidth={1.5} />}
                  title="확정을 막는 실적이 없습니다"
                  description="이 조건의 실적은 모두 확정할 수 있는 상태입니다. '막힌 것만' 을 꺼서 전체를 보세요."
                  action={
                    <Button variant="secondary" onClick={() => setBlockedOnly(false)}>
                      전체 보기
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<FileStack size={24} strokeWidth={1.5} />}
                  title="이 조건에 실적이 없습니다"
                  description={
                    (data?.summary.pendingGeneration ?? 0) > 0
                      ? '완료된 운송은 있는데 실적이 아직 없습니다. 위의 「실적 만들기」를 눌러 만드세요.'
                      : '기간이나 상태를 바꿔 보세요. 운송이 끝나야 실적이 생깁니다.'
                  }
                />
              )
            }
          />

          {data && data.items.length > 0 && (
            <Pagination
              page={data.meta.page}
              size={data.meta.size}
              total={data.meta.total}
              onPageChange={(p) => {
                setPage(p);
                resetSelection();
              }}
              onSizeChange={(s) => {
                setSize(s);
                setPage(1);
                resetSelection();
              }}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // 다섯 상태를 다 꺼내지 않는다. 검수자가 실제로 쓰는 것은 세 갈래다.
  const opts = [
    { key: 'OPEN', label: '검수 대기' },
    { key: 'CONFIRMED', label: '확정' },
    { key: '', label: '전체' },
  ];

  return (
    <div role="group" aria-label="확정 상태" className="flex rounded-md border border-line-field p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-[3px] px-2.5 py-1 text-caption transition-colors duration-fast',
            value === o.key
              ? 'bg-action text-action-text'
              : 'text-content-secondary hover:text-content-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onFrom(e.target.value)}
        aria-label="시작일"
        className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
      />
      <span aria-hidden="true" className="text-content-tertiary">
        —
      </span>
      <input
        type="date"
        value={to}
        min={from}
        onChange={(e) => onTo(e.target.value)}
        aria-label="종료일"
        className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
      />
    </span>
  );
}

/** 억 단위가 넘어가는 금액은 자릿수를 세게 하지 않는다 */
function compact(amount: number): string {
  if (Math.abs(amount) >= 100_000_000) return `${(amount / 100_000_000).toFixed(1)}억`;
  if (Math.abs(amount) >= 10_000) return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
  return amount.toLocaleString('ko-KR');
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
