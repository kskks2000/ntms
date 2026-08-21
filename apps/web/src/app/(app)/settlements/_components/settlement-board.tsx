'use client';

import { Coins, FileStack, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_PHASE,
  compactWon,
  voiceOf,
  type BulkResult,
  type CashLadder as CashLadderData,
  type LadderStage,
  type MasterOptions,
  type PageResult,
  type SettlementListItem,
  type SettlementListSummary,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { CashLadder } from '@/components/settlement/cash-ladder';
import { GateBadge } from '@/components/settlement/settlement-gate';
import { CompactMoney, Money, PaidMeter } from '@/components/settlement/money';
import { DataTable, Pagination, type Column, type SortState } from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type ListResponse = PageResult<SettlementListItem> & { summary: SettlementListSummary };

/**
 * 매출 정산 · 매입 정산.
 *
 * ## 화면 하나를 두 번 쓴다
 *
 * `settlement` 은 매출과 매입을 같은 표 · 같은 상태 · 같은 관문으로 다룬다.
 * 화면을 두 벌로 나누면 확정 규칙이 한쪽에만 반영되는 사고가 반드시 난다.
 * 바뀌어야 하는 것은 **말**뿐이라(수금/지급 · 화주/운송사), 그 말은
 * `SETTLEMENT_VOICE` 한 곳에 모아 두고 여기서 꺼내 쓴다.
 *
 * ## 이 화면이 답하는 질문
 *
 * "이번 달 얼마 벌었나" 가 아니다. 그건 KPI 가 답한다. 월말에 정산 담당자가
 * 화면을 열며 묻는 것은 하나다 — **돈이 어디서 멈춰 있나.**
 *
 * 그래서 목록보다 사다리가 위에 온다. 사다리의 한 단을 누르면 목록이 그
 * 관문에 걸린 것만 남는다. 걸린 돈을 보고 나서 그 건들을 여는 순서다.
 */
export function SettlementBoard({ settlementType }: { settlementType: 'BILLING' | 'PAYMENT' }) {
  const router = useRouter();
  const toast = useToast();
  const voice = voiceOf(settlementType);

  const [yearMonth, setYearMonth] = useState(() => currentYearMonth());
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [stage, setStage] = useState<LadderStage | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ key: 'no', dir: 'desc' });
  const [lastRun, setLastRun] = useState<BulkResult | null>(null);

  const options = useApiQuery<MasterOptions>(['master-options'], '/master/options', {
    staleTime: 5 * 60_000,
  });

  const ladderPath = `/settlements/summary?yearMonth=${yearMonth}`;
  const ladder = useApiQuery<CashLadderData>(['settlement-summary', ladderPath], ladderPath);

  const listPath = useMemo(() => {
    const params = new URLSearchParams({
      settlementType,
      yearMonth,
      page: String(page),
      size: String(size),
      sort: `${sort.key}:${sort.dir}`,
    });
    if (partnerId) params.set('partnerId', partnerId);
    if (status) params.set('status', status);
    if (keyword) params.set('keyword', keyword);
    if (overdueOnly) params.set('overdueOnly', 'true');
    return `/settlements?${params.toString()}`;
  }, [settlementType, yearMonth, page, size, sort, partnerId, status, keyword, overdueOnly]);

  const query = useApiQuery<ListResponse>(['settlements', listPath], listPath);
  const data = query.data;

  /*
    사다리의 한 단을 누르면 목록이 그 관문에 걸린 것만 남는다.

    서버에 또 하나의 필터를 만들지 않고 화면에서 거른 이유는, 걸러야 하는
    조건이 **사다리가 이미 알고 있는 것**이기 때문이다. 관문의 정의를 서버와
    화면 두 곳에 두면 그림과 목록이 어긋나기 시작한다.
  */
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    if (stage === null) return items;
    return items.filter((i) => stuckAt(i.status) === stage);
  }, [data, stage]);

  const partners =
    settlementType === 'BILLING' ? (options.data?.shippers ?? []) : (options.data?.carriers ?? []);

  const generate = useApiMutation<
    BulkResult,
    { settlementType: string; yearMonth: string; partnerId: string | null }
  >(() => ({ path: '/settlements/generate', method: 'POST' }), {
    invalidate: [['settlements'], ['settlement-summary']],
    onSuccess: (result) => {
      setLastRun(result);
      if (result.succeeded > 0) {
        toast.success(
          `${voice.statementLabel} ${result.succeeded}건을 만들었습니다`,
          '운임을 산출하고 확정하면 계산서를 낼 수 있습니다.',
        );
      } else if (result.requested === 0) {
        toast.info(
          '정산할 실적이 없습니다',
          '이 달의 확정 실적은 모두 정산에 묶여 있습니다.',
        );
      }
    },
  });

  const columns: Column<SettlementListItem>[] = [
    {
      key: 'no',
      header: '정산번호',
      sortKey: 'no',
      render: (r) => (
        <span className="flex flex-col">
          <span className="tabular font-medium">{r.settlementNo}</span>
          <span className="tabular text-caption text-content-tertiary">
            {r.periodFrom.slice(5)} – {r.periodTo.slice(5)}
          </span>
        </span>
      ),
    },
    {
      key: 'partner',
      header: voice.partyLabel,
      sortKey: 'partner',
      render: (r) => (
        <span className="flex flex-col">
          <span className="truncate">{r.partnerName}</span>
          <span className="tabular text-caption text-content-tertiary">
            {r.detailCount}건
            {r.partnerBusinessNo ? ` · ${formatBizNo(r.partnerBusinessNo)}` : ' · 사업자번호 없음'}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: '상태',
      render: (r) => (
        <span className="flex flex-col gap-1">
          <StatusChip
            label={SETTLEMENT_STATUS_LABEL[r.status] ?? r.status}
            phase={SETTLEMENT_STATUS_PHASE[r.status] ?? 'planned'}
          />
          {r.hasDispute && (
            <span className="text-caption font-medium text-status-danger">이의 제기</span>
          )}
        </span>
      ),
    },
    {
      key: 'gate',
      header: '관문',
      render: (r) => (
        <GateBadge
          blockerCount={r.blockerCount}
          cautionCount={r.cautionCount}
          reason={r.blockedReason}
        />
      ),
    },
    {
      key: 'supply',
      header: '공급가액',
      numeric: true,
      render: (r) => <Money amount={r.supplyAmount} size="label" />,
    },
    {
      key: 'tax',
      header: '부가세',
      numeric: true,
      render: (r) => <Money amount={r.taxAmount} size="label" tone="muted" />,
    },
    {
      key: 'total',
      header: '합계',
      numeric: true,
      sortKey: 'amount',
      render: (r) => <Money amount={r.totalAmount} size="label" tone="strong" />,
    },
    {
      key: 'paid',
      header: voice.unpaidLabel,
      sortKey: 'unpaid',
      width: '11rem',
      render: (r) =>
        r.status === 'INVOICED' || r.status === 'PARTIALLY_PAID' || r.status === 'PAID' ? (
          <PaidMeter total={r.totalAmount} paid={r.paidAmount} overdueDays={r.overdueDays} />
        ) : (
          <span className="text-caption text-content-tertiary">계산서 발행 전</span>
        ),
    },
    {
      key: 'next',
      header: '다음 할 일',
      render: (r) =>
        r.nextActionLabel === null ? (
          <span className="text-caption text-content-tertiary">—</span>
        ) : (
          <span
            className={cn(
              'text-caption',
              r.canProceed ? 'text-content-secondary' : 'text-content-tertiary',
            )}
          >
            {r.nextActionLabel}
            {!r.canProceed && <span className="ml-1 text-status-danger">막힘</span>}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={voice.eyebrow}
        title={voice.title}
        description={
          settlementType === 'BILLING'
            ? '확정된 실적을 화주별로 묶어 청구하고, 계산서와 수금까지 따라갑니다.'
            : '확정된 실적을 운송사별로 묶어 지급하고, 계산서와 지급까지 따라갑니다.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker
              value={yearMonth}
              onChange={(v) => {
                setYearMonth(v);
                setPage(1);
                setStage(null);
              }}
            />
            <Button
              variant="secondary"
              onClick={() => {
                void query.refetch();
                void ladder.refetch();
              }}
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
        {data?.summary.periodClosed && (
          <Alert tone="info" title="마감된 기간입니다">
            이 달은 이미 마감돼 정산을 만들거나 금액을 바꿀 수 없습니다. 수납은 마감 뒤에도
            기록할 수 있습니다. 금액을 고쳐야 하면 기간 마감에서 먼저 마감을 푸세요.
          </Alert>
        )}

        {/*
          아직 정산에 안 묶인 확정 실적. 이 화면의 프로세스가 시작되는
          자리라 사다리보다 위에 온다 — 정산이 없으면 걸릴 곳도 없다.
        */}
        {data && data.summary.pendingActualCount > 0 && !data.summary.periodClosed && (
          <Alert
            tone="info"
            title={`정산을 기다리는 확정 실적 ${data.summary.pendingActualCount}건`}
            action={
              <Button
                size="sm"
                loading={generate.isPending}
                loadingLabel="정산을 만드는 중"
                leadingIcon={<Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() =>
                  generate.mutate({
                    settlementType,
                    yearMonth,
                    partnerId: partnerId || null,
                  })
                }
              >
                정산 만들기
              </Button>
            }
          >
            확정된 실적이 아직 어느 정산에도 안 묶였습니다(추정{' '}
            <span className="tabular">{compactWon(data.summary.pendingActualAmount)}원</span>).
            {settlementType === 'BILLING'
              ? ' 화주별로 한 장씩 묶어 명세를 만듭니다.'
              : ' 운송사별로 한 장씩 묶어 명세를 만듭니다.'}{' '}
            이미 만든 정산이 확정 전이면 거기에 덧붙입니다.
          </Alert>
        )}

        {lastRun && lastRun.failures.length > 0 && (
          <Alert
            tone="warning"
            title={`${lastRun.failures.length}곳은 정산을 만들지 못했습니다`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setLastRun(null)}>
                닫기
              </Button>
            }
          >
            <ul className="space-y-1">
              {lastRun.failures.slice(0, 6).map((f) => (
                <li key={f.id} className="text-caption">
                  <span className="font-medium text-content-primary">{f.label}</span>{' '}
                  <span className="text-content-secondary">{f.reason}</span>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <StatRow>
          <Stat
            label="정산"
            value={data?.summary.count ?? '—'}
            unit="건"
            hint={data ? `진행 중 ${data.summary.openCount}건` : undefined}
          />
          <Stat
            label="청구 합계"
            value={data ? <CompactMoney amount={data.summary.totalAmount} /> : '—'}
            unit="원"
            hint="부가세 포함"
          />
          <Stat
            label={voice.payLabel}
            value={data ? <CompactMoney amount={data.summary.paidAmount} /> : '—'}
            unit="원"
          />
          <Stat
            label={voice.unpaidLabel}
            value={data ? <CompactMoney amount={data.summary.unpaidAmount} /> : '—'}
            unit="원"
            tone={(data?.summary.unpaidAmount ?? 0) > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="기한 초과"
            value={data?.summary.overdueCount ?? '—'}
            unit="건"
            hint={data ? `${compactWon(data.summary.overdueAmount)}원` : undefined}
            tone={(data?.summary.overdueCount ?? 0) > 0 ? 'danger' : 'default'}
          />
        </StatRow>

        <Panel
          title="돈이 어디서 멈춰 있나"
          subtitle="한 단을 누르면 그 관문에 걸린 정산만 아래에 남습니다"
        >
          {ladder.data ? (
            <CashLadder ladder={ladder.data} selected={stage} onSelect={setStage} />
          ) : ladder.isError ? (
            <EmptyState
              icon={<Coins size={24} strokeWidth={1.5} />}
              title="사다리를 그리지 못했습니다"
              description={ladder.error.payload.message}
              action={
                <Button variant="secondary" onClick={() => void ladder.refetch()}>
                  다시 시도
                </Button>
              }
            />
          ) : (
            <div className="px-4 py-10 text-center text-caption text-content-tertiary">
              불러오는 중
            </div>
          )}
        </Panel>

        <Panel
          title={voice.statementLabel}
          subtitle="줄을 누르면 산출 근거와 관문이 열립니다"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {stage !== null && (
                <Button size="sm" variant="ghost" onClick={() => setStage(null)}>
                  관문 필터 해제
                </Button>
              )}
              <StatusFilter
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
              />
              <label className="flex items-center gap-1.5 text-caption text-content-secondary">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => {
                    setOverdueOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="h-[15px] w-[15px] cursor-pointer appearance-none rounded-sm border border-line-field bg-surface-field checked:border-action checked:bg-action"
                />
                기한 초과만
              </label>
              <select
                value={partnerId}
                onChange={(e) => {
                  setPartnerId(e.target.value);
                  setPage(1);
                }}
                aria-label={voice.partyLabel}
                className="h-8 max-w-[10rem] rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary"
              >
                <option value="">{voice.partyLabel} 전체</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setKeyword(keywordInput.trim());
                  setPage(1);
                }}
              >
                <input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder={`정산번호 · ${voice.partyLabel}`}
                  aria-label="검색어"
                  className="h-8 w-44 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary placeholder:text-content-tertiary"
                />
              </form>
            </div>
          }
        >
          <DataTable
            caption={`${voice.title} 목록`}
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.settlementId}
            onRowClick={(r) => router.push(`/settlements/${r.settlementId}`)}
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
                  title="정산을 불러오지 못했습니다"
                  description={query.error.payload.message}
                  action={
                    <Button variant="secondary" onClick={() => void query.refetch()}>
                      다시 시도
                    </Button>
                  }
                />
              ) : stage !== null ? (
                <EmptyState
                  icon={<Lock size={24} strokeWidth={1.5} />}
                  title="이 관문에 걸린 정산이 없습니다"
                  description="사다리의 다른 단을 누르거나 필터를 풀어 전체를 보세요."
                  action={
                    <Button variant="secondary" onClick={() => setStage(null)}>
                      전체 보기
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Coins size={24} strokeWidth={1.5} />}
                  title="이 달에 정산이 없습니다"
                  description={
                    (data?.summary.pendingActualCount ?? 0) > 0
                      ? '확정된 실적은 있는데 아직 정산으로 안 묶였습니다. 위의 「정산 만들기」를 누르세요.'
                      : '실적을 먼저 확정해야 정산이 생깁니다. 운송실적 화면에서 확정하세요.'
                  }
                />
              )
            }
          />

          {data && rows.length > 0 && stage === null && (
            <Pagination
              page={data.meta.page}
              size={data.meta.size}
              total={data.meta.total}
              onPageChange={setPage}
              onSizeChange={(s) => {
                setSize(s);
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
 * 상태가 사다리의 어느 단에서 멈춰 있나.
 *
 * `ladderStageOf()` 는 "어디까지 올라왔나" 를 말하고, 이것은 "**어디서
 * 멈췄나**" 를 말한다. 둘이 다르다 — CALCULATED 는 정산 생성까지 올라왔고
 * 확정 관문 앞에서 멈춰 있다.
 */
function stuckAt(status: string): LadderStage | null {
  switch (status) {
    case 'DRAFT':
    case 'CALCULATED':
    case 'REVIEWING':
      return 'CONFIRMED';
    case 'CONFIRMED':
    case 'APPROVED':
      return 'INVOICED';
    case 'INVOICED':
    case 'PARTIALLY_PAID':
      return 'PAID';
    default:
      return null;
  }
}

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // 열 상태를 다 꺼내지 않는다. 담당자가 실제로 쓰는 것은 셋이다.
  const opts = [
    { key: 'OPEN', label: '진행 중' },
    { key: 'PAID', label: '완납' },
    { key: '', label: '전체' },
  ];

  return (
    <div
      role="group"
      aria-label="정산 상태"
      className="flex rounded-md border border-line-field p-0.5"
    >
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

/**
 * 월 고르개.
 *
 * `<input type="month">` 을 쓰지 않는다. 브라우저마다 생김새가 다르고,
 * 정산은 앞뒤 달을 오가며 보는 일이 잦아 화살표가 있는 편이 빠르다.
 */
function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    onChange(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <span className="flex items-center rounded-md border border-line-field">
      <button
        type="button"
        onClick={() => shift(-1)}
        aria-label="이전 달"
        className="h-10 px-3 text-content-secondary transition-colors duration-fast hover:text-content-primary"
      >
        ‹
      </button>
      <span className="tabular w-[6.5rem] text-center text-body text-content-primary">
        {year}년 {month}월
      </span>
      <button
        type="button"
        onClick={() => shift(1)}
        aria-label="다음 달"
        className="h-10 px-3 text-content-secondary transition-colors duration-fast hover:text-content-primary"
      >
        ›
      </button>
    </span>
  );
}

/**
 * 화면을 열면 **지난달**이 잡힌다.
 *
 * 정산은 지난달 운송을 이번 달에 묶는 일이다. 이번 달을 기본으로 두면
 * 계산서도 수금도 아직 있을 수 없어 사다리의 아랫단 둘이 늘 비어 있고,
 * 월초에 열면 화면 전체가 빈 채로 뜬다 — 담당자는 그때 "정산이 안 도나"
 * 를 먼저 의심한다. 실제로 볼 것이 있는 달을 먼저 보여 준다.
 */
function currentYearMonth(): string {
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function formatBizNo(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
}
