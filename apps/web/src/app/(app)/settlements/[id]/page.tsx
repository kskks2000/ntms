'use client';

import {
  ArrowLeft,
  Ban,
  Calculator,
  ChevronDown,
  FileText,
  Plus,
  Receipt,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ADJUSTMENT_TYPE_LABEL,
  APPROVAL_STATUS_LABEL,
  CHARGE_METHOD_LABEL,
  PAYMENT_METHOD_LABEL,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_PHASE,
  TAX_INVOICE_STATUS_LABEL,
  TAX_INVOICE_STATUS_PHASE,
  voiceOf,
  won,
  type SettlementDetailPage,
  type SettlementDetailRow,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { GateList } from '@/components/settlement/settlement-gate';
import { Money, PaidMeter } from '@/components/settlement/money';
import { RateBreakdown, RateOrigin } from '@/components/settlement/rate-breakdown';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 정산 상세 — "이 금액이 어떻게 나왔나".
 *
 * ## 화면의 순서가 곧 프로세스다
 *
 * 관문 → 명세 → 부대비 → 조정 → 계산서 → 수납. 담당자가 실제로 밟는 순서
 * 그대로 내려간다. 금액 요약을 맨 위에 크게 놓지 않은 이유는, 이 화면을 여는
 * 사람은 대부분 **금액을 이미 알고 왜 그런지를 물으러** 오기 때문이다.
 *
 * ## 되돌릴 수 없는 선이 둘이다
 *
 * 확정하면 금액은 조정 전표로만 바뀌고, 계산서가 나가면 수정계산서 말고는
 * 길이 없다. 그래서 그 두 버튼만 확인 절차를 한 겹 더 둔다.
 */
export default function SettlementDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params.id;

  const path = `/settlements/${id}`;
  const query = useApiQuery<SettlementDetailPage>(['settlement', id], path);
  const data = query.data;
  const voice = voiceOf(data?.settlementType ?? 'BILLING');

  const [openLine, setOpenLine] = useState<string | null>(null);
  const [form, setForm] = useState<'charge' | 'adjustment' | 'payment' | 'invoice' | null>(null);

  const invalidate = [['settlement', id], ['settlements'], ['settlement-summary']] as const;

  const advance = useApiMutation<{ status: string }, { action: string; reason: string | null }>(
    () => ({ path: `/settlements/${id}/status`, method: 'PATCH' }),
    {
      invalidate: [...invalidate],
      onSuccess: (r) =>
        toast.success(
          `${SETTLEMENT_STATUS_LABEL[r.status] ?? r.status} 상태로 넘어갔습니다`,
          r.status === 'CONFIRMED' ? '이제 금액은 조정 전표로만 바뀝니다.' : undefined,
        ),
    },
  );

  const calculate = useApiMutation<
    { recalculated: number; unmatched: number },
    { overwriteManual: boolean }
  >(() => ({ path: `/settlements/${id}/calculate`, method: 'POST' }), {
    invalidate: [...invalidate],
    onSuccess: (r) =>
      r.unmatched > 0
        ? toast.info(
            `${r.recalculated}건을 산출했고 ${r.unmatched}건이 운임표에 안 걸립니다`,
            '안 걸린 줄은 0원입니다. 요율표의 차종·구간을 확인하세요.',
          )
        : toast.success(`${r.recalculated}건의 운임을 다시 산출했습니다`),
  });

  const reopen = useApiMutation<{ status: string }, { reason: string }>(
    () => ({ path: `/settlements/${id}/reopen`, method: 'POST' }),
    {
      invalidate: [...invalidate],
      onSuccess: () => toast.success('한 단계 되돌렸습니다', '사유가 이력에 남습니다.'),
    },
  );

  if (query.isError) {
    return (
      <>
        <PageHeader eyebrow="Settlement" title="정산 상세" />
        <div className="px-6 py-6">
          <EmptyState
            icon={<Receipt size={24} strokeWidth={1.5} />}
            title="정산을 불러오지 못했습니다"
            description={query.error.payload.message}
            action={
              <Button variant="secondary" onClick={() => router.back()}>
                목록으로
              </Button>
            }
          />
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader eyebrow="Settlement" title="정산 상세" />
        <div className="px-6 py-10 text-center text-caption text-content-tertiary">
          불러오는 중
        </div>
      </>
    );
  }

  const gate = data.gate;

  return (
    <>
      <PageHeader
        eyebrow="Settlement"
        title={`${data.settlementNo}`}
        description={`${data.partnerName} · ${data.yearMonth.slice(0, 4)}년 ${Number(data.yearMonth.slice(4))}월 (${data.periodFrom} – ${data.periodTo}) · ${voice.statementLabel} ${data.detailCount}건`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => router.push(`/settlements/${data.settlementType === 'BILLING' ? 'billing' : 'payment'}`)}
              leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              목록
            </Button>
            {data.reopenBlockedReason === null && (
              <Button
                variant="secondary"
                leadingIcon={<Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => {
                  const reason = window.prompt('무엇을 다시 봐야 하나요? 이력에 남습니다.');
                  if (reason?.trim()) reopen.mutate({ reason: reason.trim() });
                }}
              >
                한 단계 되돌리기
              </Button>
            )}
            <NextActionButton
              gate={gate}
              pending={advance.isPending || calculate.isPending}
              onCalculate={() => calculate.mutate({ overwriteManual: false })}
              onAdvance={(action) => advance.mutate({ action, reason: null })}
              onInvoice={() => setForm('invoice')}
              onPay={() => setForm('payment')}
            />
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {data.disputeReason && (
          <Alert tone="danger" title="상대처가 이의를 제기했습니다">
            {data.disputeReason} — 조정 전표로 정리해야 확정할 수 있습니다.
          </Alert>
        )}
        {data.periodClosed && (
          <Alert tone="info" title="마감된 기간입니다">
            이 달은 마감돼 금액을 바꿀 수 없습니다. 기간 마감에서 먼저 마감을 푸세요.
          </Alert>
        )}

        <StatRow>
          <Stat
            label="상태"
            value={
              <StatusChip
                label={SETTLEMENT_STATUS_LABEL[data.status] ?? data.status}
                phase={SETTLEMENT_STATUS_PHASE[data.status] ?? 'planned'}
              />
            }
            hint={data.contractNo ? `계약 ${data.contractNo}` : '계약 없음'}
          />
          <Stat label="기본 운임" value={won(data.baseAmount)} unit="원" />
          <Stat
            label="부대비 · 할증"
            value={won(data.surchargeAmount + data.fuelSurchargeAmount)}
            unit="원"
            hint={`유류할증 ${won(data.fuelSurchargeAmount)}`}
          />
          <Stat
            label="조정"
            value={won(data.adjustmentAmount)}
            unit="원"
            tone={data.adjustmentAmount !== 0 ? 'warning' : 'default'}
          />
          <Stat label="공급가액" value={won(data.supplyAmount)} unit="원" />
          <Stat label="부가세" value={won(data.taxAmount)} unit="원" />
          <Stat label="합계" value={won(data.totalAmount)} unit="원" tone="accent" />
        </StatRow>

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-5">
            <Panel
              title="정산 명세"
              subtitle="줄을 누르면 그 금액이 어떻게 나왔는지 계단으로 펼쳐집니다"
            >
              <DetailTable
                rows={data.details}
                openLine={openLine}
                onToggle={(k) => setOpenLine(openLine === k ? null : k)}
              />
            </Panel>

            <ChargePanel data={data} settlementId={id} open={form === 'charge'} setOpen={(v) => setForm(v ? 'charge' : null)} />
            <AdjustmentPanel data={data} settlementId={id} open={form === 'adjustment'} setOpen={(v) => setForm(v ? 'adjustment' : null)} />
          </div>

          <div className="min-w-0 space-y-5">
            <Panel
              title={gate.actionLabel ? `${gate.actionLabel} 관문` : '관문'}
              subtitle={
                gate.action === null
                  ? '더 진행할 단계가 없습니다'
                  : gate.canProceed
                    ? '넘어갈 수 있습니다'
                    : '아래를 먼저 해결하세요'
              }
            >
              <GateList gate={gate} />
            </Panel>

            <InvoicePanel
              data={data}
              settlementId={id}
              open={form === 'invoice'}
              setOpen={(v) => setForm(v ? 'invoice' : null)}
            />

            <PaymentPanel
              data={data}
              settlementId={id}
              open={form === 'payment'}
              setOpen={(v) => setForm(v ? 'payment' : null)}
            />

            <Panel title="이력" subtitle="언제 무엇이 넘어갔나">
              <ol className="divide-y divide-line-subtle">
                {data.history.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="flex gap-3 px-4 py-2.5">
                    <span className="tabular w-[7.5rem] shrink-0 text-caption text-content-tertiary">
                      {stampLocal(h.at)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-label text-content-primary">{h.label}</span>
                      {h.detail && (
                        <span className="block text-caption text-content-tertiary">{h.detail}</span>
                      )}
                      {h.actor && (
                        <span className="block text-caption text-content-tertiary">{h.actor}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 다음에 할 일 하나.
 *
 * 버튼을 여섯 개 늘어놓지 않는다. 지금 상태에서 할 수 있는 것은 하나뿐이고,
 * 서버도 그 하나만 받는다(`nextAction`). 여섯 개를 두면 다섯 개는 누를 때마다
 * 거절당하고, 거절당하는 버튼은 사람을 화면에서 쫓아낸다.
 */
function NextActionButton({
  gate,
  pending,
  onCalculate,
  onAdvance,
  onInvoice,
  onPay,
}: {
  gate: SettlementDetailPage['gate'];
  pending: boolean;
  onCalculate: () => void;
  onAdvance: (action: string) => void;
  onInvoice: () => void;
  onPay: () => void;
}) {
  if (gate.action === null) {
    return (
      <span className="text-caption text-content-tertiary">{gate.blockedReason ?? '완료'}</span>
    );
  }

  const icon =
    gate.action === 'CALCULATE' ? (
      <Calculator size={16} strokeWidth={1.75} aria-hidden="true" />
    ) : gate.action === 'INVOICE' ? (
      <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
    ) : gate.action === 'PAY' ? (
      <Receipt size={16} strokeWidth={1.75} aria-hidden="true" />
    ) : (
      <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
    );

  const run = () => {
    if (gate.action === 'CALCULATE') return onCalculate();
    if (gate.action === 'INVOICE') return onInvoice();
    if (gate.action === 'PAY') return onPay();
    // 되돌릴 수 없는 동작은 한 번 더 묻는다
    if (gate.irreversible) {
      const ok = window.confirm(
        '확정하면 이 정산의 금액은 조정 전표로만 바뀝니다. 진행할까요?',
      );
      if (!ok) return;
    }
    onAdvance(gate.action!);
  };

  return (
    <span className="flex items-center gap-2">
      {!gate.canProceed && gate.blockedReason && (
        <span className="max-w-[18rem] text-caption text-status-danger">{gate.blockedReason}</span>
      )}
      <Button
        disabled={!gate.canProceed}
        loading={pending}
        loadingLabel="처리 중"
        leadingIcon={icon}
        onClick={run}
      >
        {gate.actionLabel}
      </Button>
    </span>
  );
}

/** 명세 표. 한 줄을 열면 그 줄의 산출 계단이 아래에 펼쳐진다 */
function DetailTable({
  rows,
  openLine,
  onToggle,
}: {
  rows: SettlementDetailRow[];
  openLine: string | null;
  onToggle: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="명세가 비어 있습니다"
        description="확정된 실적을 붙이거나 이 정산을 취소하세요. 목록 화면의 「정산 만들기」가 확정 실적을 묶어 줍니다."
      />
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse">
        <caption className="sr-only">정산 명세</caption>
        <thead>
          <tr className="border-b border-line-subtle">
            {['', '운송일', '오더 · 구간', '차량', '거리', '적용 요율', '공급가액', '부가세', '합계'].map(
              (h, i) => (
                <th
                  key={h || i}
                  scope="col"
                  className={cn(
                    'sticky top-0 z-10 whitespace-nowrap bg-surface-card px-3 py-2.5 text-label font-medium text-content-secondary',
                    i >= 4 && i !== 5 ? 'text-right' : 'text-left',
                  )}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = r.settlementDetailId;
            const open = openLine === key;
            return (
              <tr key={key} className="border-b border-line-subtle align-top">
                <td colSpan={9} className="p-0">
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-expanded={open}
                    className={cn(
                      'flex w-full items-baseline text-left transition-colors duration-fast',
                      open ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
                    )}
                  >
                    <span className="w-8 shrink-0 px-3 py-2.5">
                      <ChevronDown
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className={cn(
                          'text-content-tertiary transition-transform duration-fast',
                          open && 'rotate-180',
                        )}
                      />
                    </span>
                    <span className="tabular w-[5.5rem] shrink-0 px-3 py-2.5 text-body">
                      {r.transportDate.slice(5)}
                    </span>
                    <span className="min-w-0 flex-1 px-3 py-2.5">
                      <span className="tabular block truncate text-body text-content-primary">
                        {r.orderNo ?? `실적 ${r.actualId ?? ''}`}
                      </span>
                      <span className="block truncate text-caption text-content-tertiary">
                        {r.fromLocationName ?? '—'} → {r.toLocationName ?? '—'}
                      </span>
                    </span>
                    <span className="tabular w-[6.5rem] shrink-0 px-3 py-2.5 text-caption text-content-secondary">
                      {r.vehicleNo ?? '—'}
                    </span>
                    <span className="tabular w-[5rem] shrink-0 px-3 py-2.5 text-right text-body">
                      {r.distanceKm === null ? '—' : `${r.distanceKm.toLocaleString('ko-KR')}km`}
                    </span>
                    <span className="w-[11rem] shrink-0 px-3 py-2.5">
                      <RateOrigin
                        rateTableName={r.rateTableName}
                        rateMethod={r.rateMethod}
                        unitRate={r.unitRate}
                        note={r.calculationNote}
                      />
                      {r.isManual && (
                        <span className="mt-0.5 block text-caption text-status-warning">
                          수기 입력
                        </span>
                      )}
                    </span>
                    <span className="w-[7rem] shrink-0 px-3 py-2.5 text-right">
                      <Money amount={r.supplyAmount} size="body" />
                    </span>
                    <span className="w-[6rem] shrink-0 px-3 py-2.5 text-right">
                      <Money amount={r.taxAmount} size="body" tone="muted" />
                    </span>
                    <span className="w-[7.5rem] shrink-0 px-3 py-2.5 text-right">
                      <Money amount={r.totalAmount} size="body" tone="strong" />
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-line-subtle bg-surface-sunken/40">
                      <p className="px-4 pt-3 text-caption text-content-tertiary">
                        이 줄의 산출 근거입니다. 운임표가 개정돼도 이 값은 그대로 남습니다.
                      </p>
                      <RateBreakdown steps={r.steps} dense />
                      {r.calculationNote && (
                        <p className="px-4 pb-3 text-caption text-status-warning">
                          {r.calculationNote}
                        </p>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// 부대비
// ---------------------------------------------------------------------

function ChargePanel({
  data,
  settlementId,
  open,
  setOpen,
}: {
  data: SettlementDetailPage;
  settlementId: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const toast = useToast();
  const invalidate = [['settlement', settlementId], ['settlements'], ['settlement-summary']] as const;
  const editable = ['DRAFT', 'CALCULATED', 'REVIEWING'].includes(data.status);

  const add = useApiMutation<{ settlementChargeId: string }, Record<string, unknown>>(
    () => ({ path: `/settlements/${settlementId}/charges`, method: 'POST' }),
    {
      invalidate: [...invalidate],
      onSuccess: () => {
        setOpen(false);
        toast.success('부대비를 붙였습니다', '승인이 필요한 유형은 결재 뒤에 합계에 들어갑니다.');
      },
    },
  );

  const approve = useApiMutation<
    { approvalStatus: string },
    { chargeId: string; approve: boolean; reason: string | null }
  >((b) => ({ path: `/settlements/${settlementId}/charges/${b.chargeId}`, method: 'PATCH' }), {
    invalidate: [...invalidate],
    onSuccess: (r) =>
      toast.success(r.approvalStatus === 'APPROVED' ? '승인했습니다' : '반려했습니다'),
  });

  const auto = data.charges.filter((c) => c.isAutoCalculated);
  const manual = data.charges.filter((c) => !c.isAutoCalculated);

  return (
    <Panel
      title="부대비용"
      subtitle="대기료 · 경유료 · 통행료는 실적에서 자동으로 붙습니다"
      action={
        editable && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Plus size={15} strokeWidth={2} aria-hidden="true" />}
            onClick={() => setOpen(!open)}
          >
            부대비 추가
          </Button>
        )
      }
    >
      {open && (
        <ChargeForm
          types={data.surchargeTypes}
          pending={add.isPending}
          onCancel={() => setOpen(false)}
          onSubmit={(v) => add.mutate(v)}
        />
      )}

      {data.charges.length === 0 ? (
        <EmptyState
          title="붙은 부대비가 없습니다"
          description="대기·경유·통행료는 실적에 숫자가 있으면 운임 산출 때 자동으로 붙습니다. 하역비처럼 사람이 판단하는 것은 위에서 직접 추가하세요."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {[...manual, ...auto].map((c) => (
            <li key={c.settlementChargeId} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-label font-medium text-content-primary">{c.chargeName}</span>
                  <span className="text-caption text-content-tertiary">
                    {CHARGE_METHOD_LABEL[c.chargeMethod] ?? c.chargeMethod}
                  </span>
                  {c.isAutoCalculated ? (
                    <span className="rounded-sm border border-line-subtle px-1.5 py-px text-[11px] text-content-tertiary">
                      자동 · 명세에 포함됨
                    </span>
                  ) : (
                    c.approvalStatus !== 'APPROVED' && (
                      <span className="rounded-sm border border-status-warning/30 px-1.5 py-px text-[11px] text-status-warning">
                        {APPROVAL_STATUS_LABEL[c.approvalStatus] ?? c.approvalStatus} · 합계 미반영
                      </span>
                    )
                  )}
                </span>
                {c.lineNo !== null && (
                  <span className="block text-caption text-content-tertiary">
                    명세 {c.lineNo}번 줄
                    {c.baseValue !== null && ` · 기준 ${c.baseValue}${c.baseUnit ?? ''}`}
                  </span>
                )}
                {c.remark && (
                  <span className="block text-caption text-content-tertiary">{c.remark}</span>
                )}
              </span>

              <Money amount={c.amount} size="label" />

              {!c.isAutoCalculated && c.approvalStatus === 'REQUESTED' && editable && (
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      approve.mutate({
                        chargeId: c.settlementChargeId,
                        approve: true,
                        reason: null,
                      })
                    }
                  >
                    승인
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const reason = window.prompt('반려 사유를 적어주세요.');
                      if (reason?.trim())
                        approve.mutate({
                          chargeId: c.settlementChargeId,
                          approve: false,
                          reason: reason.trim(),
                        });
                    }}
                  >
                    반려
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ChargeForm({
  types,
  pending,
  onCancel,
  onSubmit,
}: {
  types: SettlementDetailPage['surchargeTypes'];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: Record<string, unknown>) => void;
}) {
  const [typeId, setTypeId] = useState(types[0]?.surchargeTypeId ?? '');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);

  const picked = types.find((t) => t.surchargeTypeId === typeId) ?? null;

  return (
    // noValidate 를 안 붙이면 브라우저 기본 검증이 submit 을 가로채
    // 아래 오류 문구가 영영 안 뜬다.
    <form
      noValidate
      className="space-y-3 border-b border-line-subtle bg-surface-sunken/50 px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(amount.replace(/,/g, ''));
        if (!picked) return setError('비용 유형을 고르세요.');
        if (!Number.isFinite(n) || n <= 0) return setError('금액을 원 단위로 입력하세요.');
        setError(null);
        onSubmit({
          surchargeTypeId: picked.surchargeTypeId,
          chargeCode: picked.surchargeCode,
          chargeName: picked.surchargeName,
          chargeMethod: picked.chargeMethod,
          amount: Math.round(n),
          isTaxable: picked.isTaxable,
          qty: 1,
          remark: remark.trim() || null,
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-label text-content-secondary">비용 유형</span>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
          >
            {types.map((t) => (
              <option key={t.surchargeTypeId} value={t.surchargeTypeId}>
                {t.surchargeName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-[10rem] flex-col gap-1">
          <span className="text-label text-content-secondary">
            금액 <span className="text-status-danger">*</span>
            <span className="sr-only">필수</span>
          </span>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="60000"
            className="field-text tabular h-10 rounded-md border border-line-field bg-surface-field px-2 text-right text-content-primary"
          />
        </label>

        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-label text-content-secondary">메모</span>
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="근거를 적어 두면 분쟁 때 이 줄이 답합니다"
            className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
          />
        </label>

        <span className="flex gap-2">
          <Button type="submit" size="md" loading={pending} loadingLabel="붙이는 중">
            붙이기
          </Button>
          <Button type="button" size="md" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        </span>
      </div>

      {picked && (picked.requireApproval || picked.requireEvidence) && (
        <p className="text-caption text-content-secondary">
          {picked.surchargeName} 은(는) {picked.requireEvidence ? '증빙과 ' : ''}승인이 필요합니다.
          결재가 끝나기 전까지는 합계에 안 들어갑니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-caption text-status-danger">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------
// 조정
// ---------------------------------------------------------------------

function AdjustmentPanel({
  data,
  settlementId,
  open,
  setOpen,
}: {
  data: SettlementDetailPage;
  settlementId: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const toast = useToast();
  const invalidate = [['settlement', settlementId], ['settlements'], ['settlement-summary']] as const;

  const add = useApiMutation<{ settlementAdjustmentId: string }, Record<string, unknown>>(
    () => ({ path: `/settlements/${settlementId}/adjustments`, method: 'POST' }),
    {
      invalidate: [...invalidate],
      onSuccess: () => {
        setOpen(false);
        toast.success('조정 전표를 올렸습니다', '승인해야 금액에 반영됩니다.');
      },
    },
  );

  const approve = useApiMutation<
    { status: string },
    { adjustmentId: string; approve: boolean; reason: string | null }
  >((b) => ({ path: `/settlements/${settlementId}/adjustments/${b.adjustmentId}`, method: 'PATCH' }), {
    invalidate: [...invalidate],
    onSuccess: (r) => toast.success(r.status === 'APPROVED' ? '승인했습니다' : '반려했습니다'),
  });

  const locked = ['CANCELLED', 'CLOSED'].includes(data.status);

  return (
    <Panel
      title="조정 전표"
      subtitle="확정된 정산의 금액을 바꾸는 유일한 길입니다"
      action={
        !locked && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Plus size={15} strokeWidth={2} aria-hidden="true" />}
            onClick={() => setOpen(!open)}
          >
            조정 올리기
          </Button>
        )
      }
    >
      {open && (
        <AdjustmentForm pending={add.isPending} onCancel={() => setOpen(false)} onSubmit={(v) => add.mutate(v)} />
      )}

      {data.adjustments.length === 0 ? (
        <EmptyState
          title="조정이 없습니다"
          description="운임을 잘못 매겼거나, 파손 구상·지체상금이 붙으면 여기에 전표를 올립니다. 명세 원본은 고치지 않습니다 — 이미 보낸 명세서와 어긋나기 때문입니다."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {data.adjustments.map((a) => (
            <li key={a.settlementAdjustmentId} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-label font-medium text-content-primary">
                    {ADJUSTMENT_TYPE_LABEL[a.adjustmentType] ?? a.adjustmentType}
                  </span>
                  <span
                    className={cn(
                      'rounded-sm border px-1.5 py-px text-[11px]',
                      a.status === 'APPROVED'
                        ? 'border-line-subtle text-content-tertiary'
                        : a.status === 'REJECTED'
                          ? 'border-status-danger/30 text-status-danger'
                          : 'border-status-warning/30 text-status-warning',
                    )}
                  >
                    {APPROVAL_STATUS_LABEL[a.status] ?? a.status}
                    {a.status !== 'APPROVED' && ' · 합계 미반영'}
                  </span>
                </span>
                <span className="block text-caption text-content-secondary">{a.reason}</span>
              </span>

              <span className="text-right">
                <Money
                  amount={a.totalAmount}
                  size="label"
                  tone={a.totalAmount < 0 ? 'warning' : 'default'}
                />
                <span className="block text-caption text-content-tertiary">
                  공급가 {won(a.supplyAmount)}
                </span>
              </span>

              {a.status === 'REQUESTED' && !locked && (
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      approve.mutate({
                        adjustmentId: a.settlementAdjustmentId,
                        approve: true,
                        reason: null,
                      })
                    }
                  >
                    승인
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const reason = window.prompt('반려 사유를 적어주세요.');
                      if (reason?.trim())
                        approve.mutate({
                          adjustmentId: a.settlementAdjustmentId,
                          approve: false,
                          reason: reason.trim(),
                        });
                    }}
                  >
                    반려
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AdjustmentForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: Record<string, unknown>) => void;
}) {
  const [type, setType] = useState('DEDUCT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const negative = ['DEDUCT', 'DISCOUNT', 'PENALTY', 'CLAIM'].includes(type);

  return (
    <form
      noValidate
      className="space-y-3 border-b border-line-subtle bg-surface-sunken/50 px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(amount.replace(/,/g, ''));
        if (!Number.isFinite(n) || n <= 0) return setError('조정할 공급가액을 원 단위로 입력하세요.');
        if (!reason.trim()) return setError('사유는 명세서에 그대로 남습니다. 적어주세요.');
        setError(null);
        onSubmit({
          adjustmentType: type,
          supplyAmount: Math.round(n),
          isTaxable: true,
          reason: reason.trim(),
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-[10rem] flex-col gap-1">
          <span className="text-label text-content-secondary">조정 유형</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
          >
            {Object.entries(ADJUSTMENT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-[10rem] flex-col gap-1">
          <span className="text-label text-content-secondary">
            공급가액 <span className="text-status-danger">*</span>
            <span className="sr-only">필수</span>
          </span>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="200000"
            className="field-text tabular h-10 rounded-md border border-line-field bg-surface-field px-2 text-right text-content-primary"
          />
          <span className="text-caption text-content-tertiary">
            {negative ? '차감으로 들어갑니다' : '가산으로 들어갑니다'} · 부호는 유형이 정합니다
          </span>
        </label>

        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="text-label text-content-secondary">
            사유 <span className="text-status-danger">*</span>
            <span className="sr-only">필수</span>
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예) 8/12 파손 1건 구상 — 예외 EX-2026-0812"
            className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
          />
        </label>

        <span className="flex gap-2">
          <Button type="submit" size="md" loading={pending} loadingLabel="올리는 중">
            결재 올리기
          </Button>
          <Button type="button" size="md" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        </span>
      </div>

      {error && (
        <p role="alert" className="text-caption text-status-danger">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------
// 세금계산서
// ---------------------------------------------------------------------

function InvoicePanel({
  data,
  settlementId,
  open,
  setOpen,
}: {
  data: SettlementDetailPage;
  settlementId: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const toast = useToast();
  const invalidate = [['settlement', settlementId], ['settlements'], ['settlement-summary'], ['invoices']] as const;
  const [issueDate, setIssueDate] = useState(todayInput);

  const issue = useApiMutation<{ invoiceNo: string | null }, { issueDate: string }>(
    () => ({ path: `/settlements/${settlementId}/invoice`, method: 'POST' }),
    {
      invalidate: [...invalidate],
      onSuccess: (r) => {
        setOpen(false);
        toast.success(`계산서 ${r.invoiceNo ?? ''} 를 발행했습니다`, '금액은 이제 수정계산서로만 바뀝니다.');
      },
    },
  );

  const inv = data.invoice;

  return (
    <Panel title="세금계산서" subtitle={inv ? '발행된 계산서' : '승인 뒤에 발행합니다'}>
      {open && !inv && (
        <form
          noValidate
          className="space-y-3 border-b border-line-subtle bg-surface-sunken/50 px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            issue.mutate({ issueDate });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-label text-content-secondary">발행일</span>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
            />
            <span className="text-caption text-content-tertiary">
              법정 기한은 공급일이 속한 달의 다음 달 10일입니다.
            </span>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={issue.isPending} loadingLabel="발행하는 중">
              발행하기
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
          </div>
          <p className="text-caption text-content-secondary">
            국세청 전송은 이 시스템에 붙어 있지 않습니다. 발행 대행사에서 처리한 결과를 계산서
            화면에서 손으로 옮겨 적습니다.
          </p>
        </form>
      )}

      {inv ? (
        <dl className="divide-y divide-line-subtle">
          <Row label="상태">
            <StatusChip
              label={TAX_INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
              phase={TAX_INVOICE_STATUS_PHASE[inv.status] ?? 'planned'}
            />
          </Row>
          <Row label="관리번호">
            <span className="tabular">{inv.invoiceNo ?? '—'}</span>
          </Row>
          <Row label="발행일">
            <span className="tabular">{inv.issueDate}</span>
          </Row>
          <Row label="공급자">
            {inv.supplierName}
            <span className="tabular block text-caption text-content-tertiary">
              {inv.supplierBusinessNo}
            </span>
          </Row>
          <Row label="공급받는자">
            {inv.buyerName}
            <span className="tabular block text-caption text-content-tertiary">
              {inv.buyerBusinessNo}
            </span>
          </Row>
          <Row label="합계">
            <Money amount={inv.totalAmount} size="label" tone="strong" />
          </Row>
          <Row label="국세청 승인번호">
            <span className="tabular">{inv.ntsApprovalNo ?? '전송 전'}</span>
          </Row>
        </dl>
      ) : (
        <p className="px-4 py-6 text-caption text-content-secondary">
          아직 계산서가 없습니다. 정산을 승인하면 발행할 수 있습니다.
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------
// 수납
// ---------------------------------------------------------------------

function PaymentPanel({
  data,
  settlementId,
  open,
  setOpen,
}: {
  data: SettlementDetailPage;
  settlementId: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const toast = useToast();
  const voice = voiceOf(data.settlementType);
  const invalidate = [['settlement', settlementId], ['settlements'], ['settlement-summary']] as const;

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput);
  const [depositor, setDepositor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const record = useApiMutation<{ unpaidAmount: number }, Record<string, unknown>>(
    () => ({ path: '/settlements/payments', method: 'POST' }),
    {
      invalidate: [...invalidate],
      onSuccess: (r) => {
        setOpen(false);
        setAmount('');
        toast.success(
          `${voice.payLabel}을 기록했습니다`,
          r.unpaidAmount > 0 ? `${won(r.unpaidAmount)}원이 남았습니다.` : '전액이 정리됐습니다.',
        );
      },
    },
  );

  const payable = ['INVOICED', 'PARTIALLY_PAID'].includes(data.status);

  return (
    <Panel
      title={voice.payLabel}
      subtitle={payable ? `남은 금액 ${won(data.unpaidAmount)}원` : '계산서 발행 뒤에 기록합니다'}
      action={
        payable && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
            {voice.payVerb}
          </Button>
        )
      }
    >
      {payable && (
        <div className="border-b border-line-subtle px-4 py-3">
          <PaidMeter total={data.totalAmount} paid={data.paidAmount} overdueDays={null} />
          {data.paymentDueDate && (
            <p className="mt-1.5 text-caption text-content-tertiary">
              결제 예정일 <span className="tabular">{data.paymentDueDate}</span>
            </p>
          )}
        </div>
      )}

      {open && payable && (
        <form
          noValidate
          className="space-y-3 border-b border-line-subtle bg-surface-sunken/50 px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(amount.replace(/,/g, ''));
            if (!Number.isFinite(n) || n <= 0) return setError('금액을 원 단위로 입력하세요.');
            if (n > data.unpaidAmount)
              return setError(`남은 금액은 ${won(data.unpaidAmount)}원입니다. 그보다 많이 넣을 수 없습니다.`);
            setError(null);
            record.mutate({
              settlementId,
              paymentDate: date,
              paymentAmount: Math.round(n),
              depositorName: depositor.trim() || null,
              paymentMethod: 'BANK_TRANSFER',
            });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-label text-content-secondary">금액</span>
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(data.unpaidAmount)}
              className="field-text tabular h-10 rounded-md border border-line-field bg-surface-field px-2 text-right text-content-primary"
            />
            <span className="text-caption text-content-tertiary">
              부분 {voice.payLabel}도 됩니다. 남은 금액은 계속 따라갑니다.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label text-content-secondary">입금일</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label text-content-secondary">입금자명</span>
            <input
              value={depositor}
              onChange={(e) => setDepositor(e.target.value)}
              placeholder="통장에 찍힌 이름 — 대사할 때 씁니다"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2 text-content-primary"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={record.isPending} loadingLabel="기록하는 중">
              기록하기
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-caption text-status-danger">
              {error}
            </p>
          )}
        </form>
      )}

      {data.payments.length === 0 ? (
        <p className="px-4 py-5 text-caption text-content-secondary">
          {payable
            ? `아직 ${voice.payLabel} 기록이 없습니다.`
            : '계산서를 발행하면 여기에 기록할 수 있습니다.'}
        </p>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {data.payments.map((p) => (
            <li key={p.paymentRecordId} className="flex items-baseline gap-3 px-4 py-2.5">
              <span className="tabular w-[5.5rem] shrink-0 text-caption text-content-tertiary">
                {p.paymentDate.slice(5)}
              </span>
              <span className="min-w-0 flex-1 truncate text-caption text-content-secondary">
                {PAYMENT_METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}
                {p.depositorName ? ` · ${p.depositorName}` : ''}
              </span>
              <Money amount={p.paymentAmount} size="label" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <dt className="w-[7rem] shrink-0 text-caption text-content-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 text-label text-content-primary">{children}</dd>
    </div>
  );
}

/**
 * 오늘 — **로컬 기준**.
 *
 * `new Date().toISOString().slice(0, 10)` 은 UTC 날짜라 KST 오전 9시 전에는
 * **어제**가 나온다. 그 값이 세금계산서 발행일과 수납일로 그대로 저장되고,
 * 화면은 멀쩡히 그려지므로 아무도 못 본다. 아침에 발행한 계산서만 하루
 * 앞당겨 찍히는 종류의 사고다.
 */
function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** timestamptz 를 로컬 시각으로. ISO 문자열을 자르면 UTC 가 보인다 */
function stampLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
