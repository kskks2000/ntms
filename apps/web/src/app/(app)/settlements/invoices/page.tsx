'use client';

import { FileText, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  SETTLEMENT_TYPE_LABEL,
  TAX_INVOICE_STATUS_LABEL,
  TAX_INVOICE_STATUS_PHASE,
  TAX_INVOICE_TYPE_LABEL,
  compactWon,
  type PageResult,
  type SettlementInvoiceRow,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { DeadlineMeter, Money } from '@/components/settlement/money';
import { DataTable, Pagination, type Column } from '@/components/tms/data-table';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

interface InvoiceSummary {
  count: number;
  totalAmount: number;
  draftCount: number;
  issuedCount: number;
  rejectedCount: number;
  overdueCount: number;
  awaitingCount: number;
  awaitingAmount: number;
  awaitingDueDays: number | null;
}
type InvoiceResponse = PageResult<SettlementInvoiceRow> & { summary: InvoiceSummary };

/**
 * 세금계산서.
 *
 * ## 이 화면의 축은 "며칠 남았나" 다
 *
 * 발행된 계산서 목록만 보여 주면 **안 한 일이 화면에 없다.** 그런데 이
 * 도메인의 위험은 전부 안 한 일에 있다 — 부가가치세법은 공급일이 속한 달의
 * 다음 달 10일까지 발행하라고 정해 두었고, 넘기면 가산세가 붙는다.
 *
 * 그래서 목록보다 위에 **발행 대기**가 온다. 그리고 각 줄에는 남은 날을
 * 막대로 그린다 — 기준정보 화면의 유효기간 막대와 같은 장치다. 같은 질문
 * (언제까지인가)이면 같은 그림이어야 사람이 화면마다 다시 배우지 않는다.
 *
 * ## 국세청 연동은 없다
 *
 * 발행 대행사 계약과 인증서가 필요한 일이라 이 범위 밖이다. 화면은 그 사실을
 * 감추지 않고, 대행사에서 확인한 결과를 손으로 옮겨 적는 자리를 준다.
 * 있는 척하는 버튼이 가장 나쁘다.
 */
export default function InvoicesPage() {
  const router = useRouter();
  const toast = useToast();

  const [settlementType, setSettlementType] = useState('');
  const [status, setStatus] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);

  const path = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (settlementType) params.set('settlementType', settlementType);
    if (status) params.set('status', status);
    if (keyword) params.set('keyword', keyword);
    if (dueOnly) params.set('dueOnly', 'true');
    return `/settlements/invoices?${params.toString()}`;
  }, [settlementType, status, keyword, dueOnly, page, size]);

  const query = useApiQuery<InvoiceResponse>(['invoices', path], path);
  const data = query.data;

  const update = useApiMutation<
    { status: string },
    { invoiceId: string; status: string; ntsApprovalNo: string | null; ntsResultMessage: string | null }
  >((b) => ({ path: `/settlements/invoices/${b.invoiceId}`, method: 'PATCH' }), {
    invalidate: [['invoices'], ['settlement'], ['settlements']],
    onSuccess: (r) =>
      toast.success(`${TAX_INVOICE_STATUS_LABEL[r.status] ?? r.status} 로 바꿨습니다`),
  });

  const columns: Column<SettlementInvoiceRow>[] = [
    {
      key: 'no',
      header: '관리번호',
      render: (r) => (
        <span className="flex flex-col">
          <span className="tabular font-medium">{r.invoiceNo ?? '—'}</span>
          <span className="text-caption text-content-tertiary">
            {TAX_INVOICE_TYPE_LABEL[r.invoiceType] ?? r.invoiceType}
          </span>
        </span>
      ),
    },
    {
      key: 'settlement',
      header: '정산',
      render: (r) => (
        <span className="flex flex-col">
          <span className="tabular">{r.settlementNo ?? '—'}</span>
          <span className="text-caption text-content-tertiary">
            {r.settlementType ? SETTLEMENT_TYPE_LABEL[r.settlementType as 'BILLING'] : ''}
            {r.yearMonth ? ` · ${r.yearMonth.slice(0, 4)}.${r.yearMonth.slice(4)}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'party',
      header: '공급자 → 공급받는자',
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-caption text-content-secondary">{r.supplierName}</span>
          <span className="truncate">{r.buyerName}</span>
        </span>
      ),
    },
    {
      key: 'issue',
      header: '발행일',
      render: (r) => <span className="tabular">{r.issueDate}</span>,
    },
    {
      key: 'deadline',
      header: '법정 발행기한',
      width: '11rem',
      render: (r) => <DeadlineMeter deadline={r.deadline} />,
    },
    {
      key: 'status',
      header: '상태',
      render: (r) => (
        <span className="flex flex-col gap-1">
          <StatusChip
            label={TAX_INVOICE_STATUS_LABEL[r.status] ?? r.status}
            phase={TAX_INVOICE_STATUS_PHASE[r.status] ?? 'planned'}
          />
          {r.ntsResultMessage && (
            <span className="text-caption text-status-danger">{r.ntsResultMessage}</span>
          )}
        </span>
      ),
    },
    {
      key: 'supply',
      header: '공급가액',
      numeric: true,
      render: (r) => <Money amount={r.supplyAmount} size="label" />,
    },
    {
      key: 'total',
      header: '합계',
      numeric: true,
      render: (r) => <Money amount={r.totalAmount} size="label" tone="strong" />,
    },
    {
      key: 'nts',
      header: '국세청',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
          {r.ntsApprovalNo ? (
            <span className="tabular text-caption text-content-secondary">{r.ntsApprovalNo}</span>
          ) : r.status === 'ISSUED' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const no = window.prompt(
                  '대행사에서 받은 국세청 승인번호를 적어주세요.\n(이 시스템은 국세청에 직접 전송하지 않습니다)',
                );
                if (no?.trim())
                  update.mutate({
                    invoiceId: r.taxInvoiceId,
                    status: 'ACCEPTED',
                    ntsApprovalNo: no.trim(),
                    ntsResultMessage: null,
                  });
              }}
            >
              승인번호 입력
            </Button>
          ) : (
            <span className="text-caption text-content-tertiary">—</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Tax Invoices"
        title="세금계산서"
        description="발행한 계산서와, 아직 발행하지 않은 채 기한이 다가오는 정산을 함께 봅니다."
        actions={
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            loading={query.isFetching}
            loadingLabel="새로 불러오는 중"
            leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
          >
            새로고침
          </Button>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {/*
          안 한 일이 먼저 온다. 발행된 목록만 보여 주면 기한이 걸린 정산이
          화면 어디에도 없고, 이 도메인의 위험은 전부 거기 있다.
        */}
        {data && data.summary.awaitingCount > 0 && (
          <Alert
            tone={
              data.summary.awaitingDueDays !== null && data.summary.awaitingDueDays <= 3
                ? 'danger'
                : 'warning'
            }
            title={`발행을 기다리는 정산 ${data.summary.awaitingCount}건`}
            action={
              <Button size="sm" variant="secondary" onClick={() => router.push('/settlements/billing')}>
                정산 목록으로
              </Button>
            }
          >
            승인은 났는데 계산서가 아직 안 나갔습니다(
            <span className="tabular">{compactWon(data.summary.awaitingAmount)}원</span>).
            {data.summary.awaitingDueDays !== null && (
              <>
                {' '}
                가장 급한 건의 법정 기한이{' '}
                <span className="tabular font-medium">
                  {data.summary.awaitingDueDays < 0
                    ? `${Math.abs(data.summary.awaitingDueDays)}일 지났습니다`
                    : `${data.summary.awaitingDueDays}일 남았습니다`}
                </span>
                .
              </>
            )}{' '}
            정산 상세를 열어 발행하세요.
          </Alert>
        )}

        <StatRow>
          <Stat label="계산서" value={data?.summary.count ?? '—'} unit="장" />
          <Stat
            label="발행 완료"
            value={data?.summary.issuedCount ?? '—'}
            unit="장"
            hint="국세청 승인 포함"
          />
          <Stat
            label="발행 대기"
            value={data?.summary.awaitingCount ?? '—'}
            unit="건"
            tone={(data?.summary.awaitingCount ?? 0) > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="기한 넘겨 발행"
            value={data?.summary.overdueCount ?? '—'}
            unit="장"
            tone={(data?.summary.overdueCount ?? 0) > 0 ? 'danger' : 'default'}
          />
          <Stat
            label="반려"
            value={data?.summary.rejectedCount ?? '—'}
            unit="장"
            tone={(data?.summary.rejectedCount ?? 0) > 0 ? 'danger' : 'default'}
          />
          <Stat
            label="발행 합계"
            value={data ? compactWon(data.summary.totalAmount) : '—'}
            unit="원"
          />
        </StatRow>

        <Panel
          title="계산서 목록"
          subtitle="줄을 누르면 그 정산으로 갑니다"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={settlementType}
                onChange={(v) => {
                  setSettlementType(v);
                  setPage(1);
                }}
                options={[
                  { key: '', label: '전체' },
                  { key: 'BILLING', label: '매출' },
                  { key: 'PAYMENT', label: '매입' },
                ]}
                label="정산 구분"
              />
              <label className="flex items-center gap-1.5 text-caption text-content-secondary">
                <input
                  type="checkbox"
                  checked={dueOnly}
                  onChange={(e) => {
                    setDueOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="h-[15px] w-[15px] cursor-pointer appearance-none rounded-sm border border-line-field bg-surface-field checked:border-action checked:bg-action"
                />
                기한 임박만
              </label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label="계산서 상태"
                className="h-8 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary"
              >
                <option value="">상태 전체</option>
                {Object.entries(TAX_INVOICE_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
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
                  placeholder="관리번호 · 상대처 · 승인번호"
                  aria-label="검색어"
                  className="h-8 w-48 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary placeholder:text-content-tertiary"
                />
              </form>
            </div>
          }
        >
          <DataTable
            caption="세금계산서 목록"
            columns={columns}
            rows={data?.items ?? []}
            getRowKey={(r) => r.taxInvoiceId}
            onRowClick={(r) => r.settlementId && router.push(`/settlements/${r.settlementId}`)}
            loading={query.isLoading}
            empty={
              query.isError ? (
                <EmptyState
                  icon={<FileText size={24} strokeWidth={1.5} />}
                  title="계산서를 불러오지 못했습니다"
                  description={query.error.payload.message}
                  action={
                    <Button variant="secondary" onClick={() => void query.refetch()}>
                      다시 시도
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<FileText size={24} strokeWidth={1.5} />}
                  title="계산서가 없습니다"
                  description={
                    (data?.summary.awaitingCount ?? 0) > 0
                      ? '승인된 정산이 있습니다. 정산 상세를 열어 발행하세요.'
                      : '정산을 승인하면 계산서를 낼 수 있습니다.'
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

function Segmented({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-line-field p-0.5">
      {options.map((o) => (
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
