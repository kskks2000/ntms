'use client';

import { CalendarCheck, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  CLOSE_STATUS_LABEL,
  CLOSE_STATUS_PHASE,
  compactWon,
  won,
  type SettlementCloseBoard,
  type SettlementCloseRow,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { GateList } from '@/components/settlement/settlement-gate';
import { Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 기간 마감.
 *
 * ## 마감은 이 시스템에서 가장 되돌리기 어려운 동작이다
 *
 * `settlement_close` 가 CLOSED 가 되는 순간 DB 트리거가 그 기간의 실적 변경을
 * 막는다. 앱이 마음을 바꿔도 안 된다. 그래서 화면은 **누르기 전에** 무엇이
 * 남았는지를 전부 펼쳐 보인다 — 관문을 눌러서 열어 보게 하지 않는다.
 *
 * ## 한 해를 한 화면에 둔다
 *
 * 마감은 달마다 하는 일이지만 순서가 있다 — 오래된 달부터 닫는다. 한 달만
 * 보여 주면 그 순서가 화면에 없고, 담당자는 9월을 닫으려다 8월이 열려
 * 있다는 것을 거절당하고 나서야 안다.
 */
export default function SettlementClosePage() {
  const toast = useToast();
  const [settlementType, setSettlementType] = useState<'BILLING' | 'PAYMENT'>('BILLING');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const path = `/settlements/closes?settlementType=${settlementType}&year=${year}`;
  const query = useApiQuery<SettlementCloseBoard>(['closes', path], path);
  const data = query.data;

  const close = useApiMutation<
    { yearMonth: string; totalCount: number; totalAmount: number },
    { settlementType: string; yearMonth: string }
  >(() => ({ path: '/settlements/closes', method: 'POST' }), {
    invalidate: [['closes'], ['settlements'], ['settlement-summary']],
    onSuccess: (r) =>
      toast.success(
        `${Number(r.yearMonth.slice(4))}월을 마감했습니다`,
        `정산 ${r.totalCount}건 · ${compactWon(r.totalAmount)}원. 이제 이 기간의 실적은 못 고칩니다.`,
      ),
  });

  const reopen = useApiMutation<{ status: string }, { closeId: string; reason: string }>(
    (b) => ({ path: `/settlements/closes/${b.closeId}/reopen`, method: 'POST' }),
    {
      invalidate: [['closes'], ['settlements'], ['settlement-summary']],
      onSuccess: () => toast.success('마감을 풀었습니다', '사유가 이력에 남습니다.'),
    },
  );

  const months = data?.months ?? [];
  const active = months.filter((m) => m.hasActivity);
  const closedCount = active.filter((m) => m.status === 'CLOSED').length;

  return (
    <>
      <PageHeader
        eyebrow="Period Close"
        title="기간 마감"
        description="마감한 달은 실적도 정산도 못 고칩니다. 무엇이 남았는지 먼저 보고 닫습니다."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="정산 구분" className="flex rounded-md border border-line-field p-0.5">
              {(['BILLING', 'PAYMENT'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={settlementType === t}
                  onClick={() => {
                    setSettlementType(t);
                    setOpenMonth(null);
                  }}
                  className={cn(
                    'rounded-[3px] px-3 py-1.5 text-caption transition-colors duration-fast',
                    settlementType === t
                      ? 'bg-action text-action-text'
                      : 'text-content-secondary hover:text-content-primary',
                  )}
                >
                  {t === 'BILLING' ? '매출' : '매입'}
                </button>
              ))}
            </div>
            <span className="flex items-center rounded-md border border-line-field">
              <button
                type="button"
                onClick={() => setYear(year - 1)}
                aria-label="이전 해"
                className="h-10 px-3 text-content-secondary hover:text-content-primary"
              >
                ‹
              </button>
              <span className="tabular w-[4.5rem] text-center text-body text-content-primary">
                {year}년
              </span>
              <button
                type="button"
                onClick={() => setYear(year + 1)}
                aria-label="다음 해"
                className="h-10 px-3 text-content-secondary hover:text-content-primary"
              >
                ›
              </button>
            </span>
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
        {data?.oldestOpen && (
          <Alert tone="info" title="오래된 달부터 닫습니다">
            지금 열려 있는 가장 오래된 달은{' '}
            <span className="tabular font-medium text-content-primary">
              {data.oldestOpen.slice(0, 4)}년 {Number(data.oldestOpen.slice(4))}월
            </span>{' '}
            입니다. 앞 달을 열어 둔 채 뒤 달을 닫으면, 나중에 앞 달 실적이 바뀌었을 때 그 차이가
            갈 곳이 없어집니다.
          </Alert>
        )}

        <StatRow>
          <Stat
            label="내역이 있는 달"
            value={active.length}
            unit="개월"
            hint={`${year}년`}
          />
          <Stat label="마감 완료" value={closedCount} unit="개월" />
          <Stat
            label="열린 달"
            value={active.length - closedCount}
            unit="개월"
            tone={active.length - closedCount > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="마감 금액"
            value={compactWon(
              active.filter((m) => m.status === 'CLOSED').reduce((a, b) => a + b.totalAmount, 0),
            )}
            unit="원"
          />
        </StatRow>

        <Panel
          title={`${year}년 ${settlementType === 'BILLING' ? '매출' : '매입'} 마감`}
          subtitle="달을 누르면 무엇이 남았는지 관문이 펼쳐집니다"
        >
          {query.isLoading ? (
            <p className="px-4 py-10 text-center text-caption text-content-tertiary">불러오는 중</p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {months.map((m) => (
                <MonthRow
                  key={m.yearMonth}
                  month={m}
                  open={openMonth === m.yearMonth}
                  onToggle={() => setOpenMonth(openMonth === m.yearMonth ? null : m.yearMonth)}
                  onClose={() => {
                    const ok = window.confirm(
                      `${Number(m.yearMonth.slice(4))}월을 마감합니다.\n마감하면 이 기간의 실적과 정산 금액을 더 고칠 수 없습니다.\n\n진행할까요?`,
                    );
                    if (ok) close.mutate({ settlementType, yearMonth: m.yearMonth });
                  }}
                  onReopen={() => {
                    const reason = window.prompt(
                      '마감을 푸는 이유를 적어주세요. 감사 대상이라 이력에 남습니다.',
                    );
                    if (reason?.trim() && m.settlementCloseId)
                      reopen.mutate({ closeId: m.settlementCloseId, reason: reason.trim() });
                  }}
                  pending={close.isPending || reopen.isPending}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function MonthRow({
  month,
  open,
  onToggle,
  onClose,
  onReopen,
  pending,
}: {
  month: SettlementCloseRow;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onReopen: () => void;
  pending: boolean;
}) {
  const closed = month.status === 'CLOSED';
  const label = `${Number(month.yearMonth.slice(4))}월`;

  return (
    <li className={cn(!month.hasActivity && 'opacity-55')}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          disabled={!month.hasActivity}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
        >
          <span className="tabular w-[3rem] shrink-0 text-title-sm font-medium text-content-primary">
            {label}
          </span>

          <StatusChip
            label={CLOSE_STATUS_LABEL[month.status] ?? month.status}
            phase={CLOSE_STATUS_PHASE[month.status] ?? 'planned'}
          />

          {month.hasActivity ? (
            <span className="min-w-0 flex-1">
              <span className="block text-label text-content-secondary">
                정산 <span className="tabular">{month.totalCount}</span>건 ·{' '}
                <span className="tabular">{won(month.totalAmount)}</span>원
              </span>
              {closed ? (
                <span className="block text-caption text-content-tertiary">
                  {month.closedAt ? dayLocal(month.closedAt) : ''} {month.closedByName ?? ''} 마감
                </span>
              ) : (
                <span
                  className={cn(
                    'block text-caption',
                    month.gate.blockerCount > 0
                      ? 'text-status-danger'
                      : month.gate.cautionCount > 0
                        ? 'text-status-warning'
                        : 'text-content-tertiary',
                  )}
                >
                  {month.gate.blockerCount > 0
                    ? month.gate.blockedReason
                    : month.gate.cautionCount > 0
                      ? `확인할 것 ${month.gate.cautionCount}가지 — 마감은 됩니다`
                      : '남은 것이 없습니다'}
                </span>
              )}
              {month.reopenReason && (
                <span className="block text-caption text-status-warning">
                  마감 해제: {month.reopenReason}
                </span>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-caption text-content-tertiary">
              내역이 없는 달입니다. 닫을 것도 없습니다.
            </span>
          )}
        </button>

        {month.hasActivity &&
          (closed ? (
            <Button
              size="sm"
              variant="ghost"
              loading={pending}
              leadingIcon={<LockOpen size={15} strokeWidth={1.75} aria-hidden="true" />}
              onClick={onReopen}
            >
              마감 해제
            </Button>
          ) : (
            <Button
              size="sm"
              variant={month.gate.canClose ? 'primary' : 'secondary'}
              disabled={!month.gate.canClose}
              loading={pending}
              loadingLabel="마감하는 중"
              leadingIcon={<Lock size={15} strokeWidth={1.75} aria-hidden="true" />}
              onClick={onClose}
            >
              마감하기
            </Button>
          ))}
      </div>

      {open && month.hasActivity && (
        <div className="border-t border-line-subtle bg-surface-sunken/40">
          <p className="flex items-center gap-2 px-4 pt-3 text-caption text-content-tertiary">
            <CalendarCheck size={13} strokeWidth={2} aria-hidden="true" />
            {month.periodFrom} – {month.periodTo} 를 잠급니다
          </p>
          <GateList gate={month.gate} />
        </div>
      )}
    </li>
  );
}

/** timestamptz 의 로컬 날짜. ISO 를 자르면 UTC 라 오전에는 어제가 나온다 */
function dayLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
