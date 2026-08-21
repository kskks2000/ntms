'use client';

import {
  ArrowLeft,
  CircleCheck,
  FileWarning,
  PauseCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ACTUAL_CONFIRM_PHASE,
  ACTUAL_CONFIRM_STATUS_LABEL,
  EXCEPTION_SEVERITY_LABEL,
  EXCEPTION_STATUS_LABEL,
  EXCEPTION_TYPE_LABEL,
  LIABILITY_PARTY_LABEL,
  POD_RESULT_LABEL,
  STOP_STATUS_LABEL,
  type ActualDetail,
  type BulkResult,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { ConfirmGateList } from '@/components/actual/confirm-gate';
import { VarianceSpine } from '@/components/actual/variance-spine';
import { EmptyState, Panel, Skeleton } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextareaField } from '@/components/ui/textarea-field';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 실적 상세 — 검수하고 확정하는 화면.
 *
 * ## 되돌릴 수 없는 선
 *
 * 확정을 누르면 정산이 이 숫자를 물고 간다. 세금계산서가 나가고 나면 고치는
 * 길은 조정 전표뿐이다. 그래서 이 화면의 구성은 그 선을 중심으로 짜여 있다 —
 * 왼쪽은 **판단할 재료**(편차 축 · 관문 · 오더 · 정차 · 예외), 오른쪽은
 * **선을 넘는 손잡이**다.
 *
 * 오른쪽 기둥이 스크롤을 따라오는 이유는, 아래쪽 정차 실적을 보다가 확정하려고
 * 다시 맨 위로 올라가게 하지 않기 위해서다. 긴 표를 훑는 화면에서 동작이
 * 화면 밖으로 나가면 사람은 확인을 덜 하게 된다.
 */
export default function ActualDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params.id;

  const query = useApiQuery<ActualDetail>(['actuals', 'detail', id], `/actuals/${id}`);
  const data = query.data;

  if (query.isError) {
    return (
      <>
        <PageHeader eyebrow="Actual" title="운송실적" />
        <div className="px-6 py-6">
          <EmptyState
            icon={<FileWarning size={24} strokeWidth={1.5} />}
            title="실적을 불러오지 못했습니다"
            description={query.error.payload.message}
            action={
              <Button variant="secondary" onClick={() => router.push('/actuals')}>
                목록으로
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={data ? `ACTUAL · ${data.actualNo}` : 'Actual'}
        title={data ? `${data.tripNo} 실적` : '실적 검수'}
        description={
          data
            ? `${data.actualDate} · ${data.carrierName} · ${data.vehicleNo ?? '차량 미상'} · ${data.fromLocationName ?? '—'} → ${data.toLocationName ?? '—'}`
            : '계획과 실제가 어디서 갈라졌는지 확인하고 확정합니다.'
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => router.push('/actuals')}
            leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />}
          >
            목록으로
          </Button>
        }
      />

      {query.isLoading || !data ? (
        <div className="space-y-4 px-6 py-6">
          <Skeleton className="h-56 w-full rounded-card" />
          <Skeleton className="h-72 w-full rounded-card" />
        </div>
      ) : (
        <div className="grid gap-5 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-5">
            <Panel
              title="계획과 실제가 갈라진 곳"
              subtitle="가운데 선이 계획입니다. 오른쪽으로 벌어진 만큼을 더 썼습니다"
            >
              <VarianceSpine spine={data.variance} />
            </Panel>

            <Panel
              title="확정 관문"
              subtitle={
                data.gate.blockerCount > 0
                  ? `${data.gate.blockerCount}건이 확정을 막고 있습니다`
                  : data.gate.cautionCount > 0
                    ? `막는 것은 없지만 ${data.gate.cautionCount}건을 확인하세요`
                    : '모두 통과했습니다'
              }
            >
              <ConfirmGateList gate={data.gate} />
            </Panel>

            <OrdersPanel detail={data} />
            <StopsPanel detail={data} />
            {data.exceptions.length > 0 && <ExceptionsPanel detail={data} />}
          </div>

          <aside className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
            <ConfirmCard detail={data} onDone={() => void query.refetch()} />
            <FiguresCard detail={data} />
            <ReviewCard detail={data} onDone={() => void query.refetch()} />
            <HistoryCard detail={data} />
          </aside>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// 확정
// ---------------------------------------------------------------------

/**
 * 선을 넘는 손잡이.
 *
 * 세 동작이 성격이 다르다. **확정**은 앞으로 가는 일, **보류**는 옆으로
 * 미루는 일, **되돌리기**는 뒤로 가는 일이다. 셋을 같은 모양의 버튼으로
 * 늘어놓으면 실수로 되돌리기를 누른다 — 되돌리기는 사유를 받는 폼을
 * 펼쳐야만 눌리게 해 두었다.
 */
function ConfirmCard({ detail, onDone }: { detail: ActualDetail; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'none' | 'hold' | 'reopen'>('none');

  const confirm = useApiMutation<BulkResult, { actualIds: string[] }>(
    () => ({ path: '/actuals/confirm', method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: (result) => {
        if (result.succeeded > 0) {
          toast.success('실적을 확정했습니다', '정산이 이 숫자를 물고 갑니다.');
          onDone();
        } else {
          toast.danger('확정하지 못했습니다', result.failures[0]?.reason ?? '상태를 확인해 주세요.');
        }
      },
    },
  );

  const hold = useApiMutation<{ confirmStatus: string }, { reason: string }>(
    () => ({ path: `/actuals/${detail.actualId}/hold`, method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: () => {
        toast.success('검수 보류로 표시했습니다', '다른 사람이 이어받을 수 있습니다.');
        setMode('none');
        onDone();
      },
    },
  );

  const reopen = useApiMutation<{ confirmStatus: string }, { reason: string }>(
    () => ({ path: `/actuals/${detail.actualId}/reopen`, method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: () => {
        toast.success('확정을 되돌렸습니다', '다시 검수하고 확정할 수 있습니다.');
        setMode('none');
        onDone();
      },
    },
  );

  const settled = detail.billingSettled || detail.paymentSettled;
  const confirmed = detail.confirmStatus === 'CONFIRMED' || detail.confirmStatus === 'CLOSED';

  return (
    <Panel title="확정">
      <div className="space-y-3.5 px-4 py-4">
        <div className="flex items-center gap-2">
          <StatusChip
            label={ACTUAL_CONFIRM_STATUS_LABEL[detail.confirmStatus] ?? detail.confirmStatus}
            phase={ACTUAL_CONFIRM_PHASE[detail.confirmStatus] ?? 'planned'}
          />
          {settled && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-line-subtle px-1.5 py-px text-caption text-content-secondary">
              <ShieldCheck size={11} strokeWidth={2.25} aria-hidden="true" />
              정산 반영됨
            </span>
          )}
        </div>

        {/*
          지난 일과 지금 할 일을 갈라 쓴다. 이미 확정된 건에 "확인하세요" 라고
          적으면 그 문구는 곧 아무도 안 읽는 배경이 된다.
        */}
        <p className="text-caption leading-relaxed text-content-secondary">
          {confirmed
            ? detail.confirmedAt
              ? `${formatDateTime(detail.confirmedAt)}${detail.confirmedByName ? ` · ${detail.confirmedByName}` : ''} 확정. 금액은 정산이 산출해 이 실적에 되돌려 씁니다.`
              : '확정된 실적입니다.'
            : detail.gate.blockerCount > 0
              ? '아래 관문을 먼저 통과해야 확정할 수 있습니다.'
              : '확정하면 정산이 이 숫자를 물고 갑니다. 되돌리려면 사유가 필요합니다.'}
        </p>

        {!confirmed && detail.gate.blockedReason && (
          <p className="rounded-md border border-status-danger/25 bg-status-danger-surface px-3 py-2 text-caption text-content-secondary">
            {detail.gate.blockedReason}
          </p>
        )}

        {!confirmed && (
          <div className="space-y-2">
            <Button
              block
              disabled={!detail.gate.canConfirm}
              loading={confirm.isPending}
              loadingLabel="확정하는 중"
              leadingIcon={<CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />}
              onClick={() => confirm.mutate({ actualIds: [detail.actualId] })}
            >
              확정
            </Button>
            {mode !== 'hold' && (
              <Button
                block
                variant="secondary"
                leadingIcon={<PauseCircle size={16} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => setMode('hold')}
              >
                검수 보류
              </Button>
            )}
          </div>
        )}

        {mode === 'hold' && (
          <ReasonForm
            label="무엇을 확인해야 하나요"
            hint="다음 사람이 이어받을 수 있게 적습니다. 실적 메모에 남습니다."
            submitLabel="보류로 표시"
            pending={hold.isPending}
            error={hold.error?.payload.message}
            onCancel={() => setMode('none')}
            onSubmit={(reason) => hold.mutate({ reason })}
          />
        )}

        {confirmed &&
          (detail.reopenBlockedReason ? (
            <p className="rounded-md border border-line-subtle bg-surface-sunken px-3 py-2 text-caption text-content-secondary">
              {detail.reopenBlockedReason}
            </p>
          ) : mode === 'reopen' ? (
            <ReasonForm
              label="왜 되돌리나요"
              hint="확정을 되돌린 흔적이 없으면, 정산에서 금액이 틀어졌을 때 되짚을 데가 없습니다."
              submitLabel="확정 되돌리기"
              tone="danger"
              pending={reopen.isPending}
              error={reopen.error?.payload.message}
              onCancel={() => setMode('none')}
              onSubmit={(reason) => reopen.mutate({ reason })}
            />
          ) : (
            <Button
              block
              variant="ghost"
              leadingIcon={<RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />}
              onClick={() => setMode('reopen')}
            >
              확정 되돌리기
            </Button>
          ))}
      </div>
    </Panel>
  );
}

/**
 * 사유를 받는 폼.
 *
 * `window.prompt` 를 쓰지 않는다. 되돌릴 수 없는 경계에서 하는 일이라 사유가
 * 기록으로 남는데, 브라우저 기본 창은 무엇을 적어야 하는지 안내할 자리가
 * 없고 취소도 실수로 눌린다.
 */
function ReasonForm({
  label,
  hint,
  submitLabel,
  tone = 'primary',
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  label: string;
  hint: string;
  submitLabel: string;
  tone?: 'primary' | 'danger';
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const empty = value.trim().length === 0;

  return (
    <form
      noValidate
      className="space-y-2.5 rounded-md border border-line-subtle bg-surface-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (empty) return;
        onSubmit(value.trim());
      }}
    >
      <TextareaField
        label={label}
        hint={hint}
        rows={3}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setTouched(true)}
        error={touched && empty ? '사유를 적어야 진행할 수 있습니다.' : (error ?? undefined)}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
        <Button
          type="submit"
          size="sm"
          variant={tone === 'danger' ? 'danger' : 'primary'}
          loading={pending}
          loadingLabel="처리 중"
          className="ml-auto"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// 숫자 · 검수 · 이력
// ---------------------------------------------------------------------

function FiguresCard({ detail }: { detail: ActualDetail }) {
  return (
    <Panel title="실적 숫자">
      <dl className="divide-y divide-line-subtle">
        <Figure label="오더 · 정차" value={`${detail.orderCount}건 · ${detail.completedStopCount}/${detail.stopCount}곳`} />
        <Figure label="인도 중량" value={`${Math.round(detail.actualWeightKg).toLocaleString('ko-KR')} kg`} />
        <Figure
          label="주행 (계획 → 실제)"
          value={`${fmt(detail.plannedDistanceKm)} → ${fmt(detail.actualDistanceKm)} km`}
        />
        <Figure
          label="공차거리"
          value={detail.emptyDistanceKm === null ? '계기판 없음' : `${fmt(detail.emptyDistanceKm)} km`}
          hint={detail.emptyDistanceKm === null ? '주행계 기록이 없어 산출하지 않았습니다' : '노선 밖 주행'}
        />
        <Figure
          label="운행 시각"
          value={`${formatTime(detail.actualStartAt)} – ${formatTime(detail.actualEndAt)}`}
          hint={detail.plannedStartAt ? `계획 ${formatTime(detail.plannedStartAt)} – ${formatTime(detail.plannedEndAt)}` : undefined}
        />
        <Figure label="적재율" value={detail.loadingRate === null ? '—' : `${detail.loadingRate.toFixed(1)}%`} />
        <Figure
          label="예상 매출"
          value={won(detail.billingAmount)}
          hint="정산이 산출하면 이 값이 갱신됩니다"
        />
        <Figure label="예상 매입" value={won(detail.paymentAmount)} />
        <Figure
          label="예상 마진"
          value={won(detail.marginAmount)}
          hint={detail.marginRate === null ? undefined : `${detail.marginRate.toFixed(1)}%`}
        />
      </dl>
    </Panel>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <dt className="shrink-0 text-caption text-content-tertiary">{label}</dt>
      <dd className="ml-auto min-w-0 text-right">
        <span className="tabular text-label text-content-primary">{value}</span>
        {hint && <span className="mt-0.5 block text-caption text-content-tertiary">{hint}</span>}
      </dd>
    </div>
  );
}

/**
 * 실비 검수.
 *
 * 고칠 수 있는 것은 실비와 메모뿐이다. 주행거리나 도착 시각을 손으로 고치게
 * 하면 실행 기록과 실적이 갈라지고, 그다음부터 어느 쪽이 사실인지 아무도
 * 모른다. 실행이 틀렸으면 실행을 고치고 실적을 다시 만든다.
 */
function ReviewCard({ detail, onDone }: { detail: ActualDetail; onDone: () => void }) {
  const toast = useToast();
  const editable = !['CONFIRMED', 'CLOSED'].includes(detail.confirmStatus);

  const [form, setForm] = useState(() => ({
    waitingMinutes: String(detail.waitingMinutes),
    fuelConsumedLiter: detail.fuelConsumedLiter?.toString() ?? '',
    fuelCost: detail.fuelCost?.toString() ?? '',
    tollFee: detail.tollFee?.toString() ?? '',
    otherCost: detail.otherCost?.toString() ?? '',
    remark: detail.remark ?? '',
  }));

  // 되돌리거나 다시 불러오면 서버 값이 진짜다. 화면에 남은 옛 입력이
  // 다음 저장에서 되살아나면 검수자가 안 고친 값을 고친 것이 된다.
  useEffect(() => {
    setForm({
      waitingMinutes: String(detail.waitingMinutes),
      fuelConsumedLiter: detail.fuelConsumedLiter?.toString() ?? '',
      fuelCost: detail.fuelCost?.toString() ?? '',
      tollFee: detail.tollFee?.toString() ?? '',
      otherCost: detail.otherCost?.toString() ?? '',
      remark: detail.remark ?? '',
    });
  }, [
    detail.actualId,
    detail.waitingMinutes,
    detail.fuelConsumedLiter,
    detail.fuelCost,
    detail.tollFee,
    detail.otherCost,
    detail.remark,
  ]);

  const save = useApiMutation<{ confirmStatus: string }, Record<string, unknown>>(
    () => ({ path: `/actuals/${detail.actualId}`, method: 'PATCH' }),
    {
      invalidate: [['actuals']],
      onSuccess: () => {
        toast.success('검수 내용을 저장했습니다', '이 건은 검수중으로 표시됩니다.');
        onDone();
      },
    },
  );

  return (
    <Panel
      title="실비 검수"
      subtitle={editable ? '영수증과 맞춰 고칩니다' : '확정된 실적은 고칠 수 없습니다'}
    >
      <form
        noValidate
        className="space-y-3 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            waitingMinutes: blankToNull(form.waitingMinutes),
            fuelConsumedLiter: blankToNull(form.fuelConsumedLiter),
            fuelCost: blankToNull(form.fuelCost),
            tollFee: blankToNull(form.tollFee),
            otherCost: blankToNull(form.otherCost),
            remark: form.remark.trim() === '' ? null : form.remark.trim(),
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <NumberInput
            label="대기시간"
            unit="분"
            disabled={!editable}
            value={form.waitingMinutes}
            onChange={(v) => setForm((f) => ({ ...f, waitingMinutes: v }))}
          />
          <NumberInput
            label="주유량"
            unit="L"
            disabled={!editable}
            value={form.fuelConsumedLiter}
            onChange={(v) => setForm((f) => ({ ...f, fuelConsumedLiter: v }))}
          />
          <NumberInput
            label="유류비"
            unit="원"
            disabled={!editable}
            value={form.fuelCost}
            onChange={(v) => setForm((f) => ({ ...f, fuelCost: v }))}
          />
          <NumberInput
            label="통행료"
            unit="원"
            disabled={!editable}
            value={form.tollFee}
            onChange={(v) => setForm((f) => ({ ...f, tollFee: v }))}
          />
          <NumberInput
            label="기타 실비"
            unit="원"
            disabled={!editable}
            value={form.otherCost}
            onChange={(v) => setForm((f) => ({ ...f, otherCost: v }))}
          />
        </div>

        <TextareaField
          label="검수 메모"
          hint="다음 사람이 읽습니다"
          rows={2}
          disabled={!editable}
          value={form.remark}
          onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
        />

        {save.isError && (
          <p role="alert" className="text-caption text-status-danger">
            {save.error.payload.message}
          </p>
        )}

        {editable && (
          <Button
            type="submit"
            block
            variant="secondary"
            loading={save.isPending}
            loadingLabel="저장하는 중"
          >
            검수 내용 저장
          </Button>
        )}
      </form>
    </Panel>
  );
}

function NumberInput({
  label,
  unit,
  value,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-caption text-content-tertiary">
        {label} <span className="text-content-tertiary/70">({unit})</span>
      </span>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="tabular field-text mt-1 h-9 w-full rounded-md border border-line-field bg-surface-field px-2.5 text-right text-content-primary disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-tertiary"
      />
    </label>
  );
}

function HistoryCard({ detail }: { detail: ActualDetail }) {
  return (
    <Panel title="이력">
      <ol className="space-y-0 px-4 py-3">
        {detail.history.map((h, i) => (
          <li key={`${h.at}-${i}`} className="flex gap-3 py-1.5">
            <span className="tabular shrink-0 text-caption text-content-tertiary">
              {formatDateTime(h.at)}
            </span>
            <span className="min-w-0">
              <span className="text-caption font-medium text-content-secondary">{h.label}</span>
              {h.detail && (
                <span className="ml-1.5 text-caption text-content-tertiary">{h.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ---------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------

/**
 * 오더별 실적.
 *
 * 트립 실적을 오더로 나눈 결과이고, **화주 청구의 최소 단위**다. 안분 비중이
 * 왜 보이냐면, 청구서에 적히는 금액이 이 비율에서 나오기 때문이다. 비율이
 * 이상해 보이면 여기서 잡아야지 청구서가 나간 뒤에 잡으면 늦다.
 */
function OrdersPanel({ detail }: { detail: ActualDetail }) {
  return (
    <Panel title="오더별 실적" subtitle="화주에게 청구하는 최소 단위입니다">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-left">
          <caption className="sr-only">오더별 인도 실적과 안분 금액</caption>
          <thead>
            <tr className="border-b border-line-subtle">
              <Th>오더 · 화주</Th>
              <Th>도착지</Th>
              <Th className="text-right">인도중량</Th>
              <Th className="text-right">파손 · 부족</Th>
              <Th>인수 결과</Th>
              <Th className="text-right">안분</Th>
              <Th className="text-right">예상 매출</Th>
            </tr>
          </thead>
          <tbody>
            {detail.orders.map((o) => {
              const flawed = o.damagedQty > 0 || o.shortageQty > 0;
              return (
                <tr key={o.actualOrderId} className="border-b border-line-subtle last:border-0">
                  <Td>
                    <span className="tabular text-content-primary">{o.orderNo}</span>
                    <span className="ml-2 text-content-tertiary">{o.shipperName}</span>
                    {o.podId === null ? (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded-sm border border-status-danger/25 px-1 text-[11px] font-medium text-status-danger">
                        인수증 없음
                      </span>
                    ) : (
                      !o.podConfirmed && (
                        <span className="ml-1.5 inline-flex items-center rounded-sm border border-line-subtle px-1 text-[11px] text-status-warning">
                          미확인
                        </span>
                      )
                    )}
                  </Td>
                  <Td>{o.toLocationName ?? '—'}</Td>
                  <Td className="tabular text-right">
                    {Math.round(o.deliveredWeightKg).toLocaleString('ko-KR')}
                  </Td>
                  <Td className="tabular text-right">
                    <span className={cn(flawed ? 'font-medium text-status-danger' : 'text-content-tertiary')}>
                      {flawed ? `${o.damagedQty} · ${o.shortageQty}` : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        o.deliveryResult !== 'NORMAL'
                          ? 'font-medium text-status-danger'
                          : 'text-content-secondary',
                      )}
                    >
                      {POD_RESULT_LABEL[o.deliveryResult] ?? o.deliveryResult}
                    </span>
                  </Td>
                  <Td className="tabular text-right text-content-tertiary">
                    {o.allocationRatio === null ? '—' : `${o.allocationRatio.toFixed(1)}%`}
                  </Td>
                  <Td className="tabular text-right">{won(o.billingAmount)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * 정차 실적.
 *
 * 지연이 어디서 생겼고 어디서 서 있었는지가 여기 있다. 대기 칸이 대기료의
 * 근거이므로, 계획 작업시간과 실제 작업시간을 나란히 둔다 — 청구할 때
 * 화주가 되묻는 것이 정확히 이 두 숫자다.
 */
function StopsPanel({ detail }: { detail: ActualDetail }) {
  return (
    <Panel title="정차 실적" subtitle="대기 칸이 대기료의 근거입니다">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <caption className="sr-only">정차별 계획 대비 실적</caption>
          <thead>
            <tr className="border-b border-line-subtle">
              <Th className="w-10 text-right">#</Th>
              <Th>정차지</Th>
              <Th>계획 도착</Th>
              <Th>실제 도착</Th>
              <Th className="text-right">지연</Th>
              <Th className="text-right">작업 (계획→실제)</Th>
              <Th className="text-right">대기</Th>
              <Th>상태</Th>
            </tr>
          </thead>
          <tbody>
            {detail.stops.map((s) => (
              <tr key={s.stopSeq} className="border-b border-line-subtle last:border-0">
                <Td className="tabular text-right text-content-tertiary">{s.stopSeq}</Td>
                <Td>
                  <span className="text-content-primary">{s.locationName}</span>
                  <span className="ml-1.5 text-caption text-content-tertiary">
                    {s.stopType === 'PICKUP' ? '상차' : '하차'}
                  </span>
                </Td>
                <Td className="tabular">{formatTime(s.plannedArrivalAt)}</Td>
                <Td className="tabular">{formatTime(s.actualArrivalAt)}</Td>
                <Td className="tabular text-right">
                  <span
                    className={cn(
                      s.delayMinutes >= 30
                        ? 'font-medium text-status-warning'
                        : s.delayMinutes > 0
                          ? 'text-content-secondary'
                          : 'text-content-tertiary',
                    )}
                  >
                    {s.delayMinutes === 0 ? '정시' : `+${s.delayMinutes}분`}
                  </span>
                </Td>
                <Td className="tabular text-right text-content-secondary">
                  {s.plannedServiceMin ?? '—'} → {s.actualServiceMin ?? '—'}
                </Td>
                <Td className="tabular text-right">
                  <span className={cn(s.waitMinutes >= 30 && 'font-medium text-status-warning')}>
                    {s.waitMinutes === 0 ? '—' : `${s.waitMinutes}분`}
                  </span>
                </Td>
                <Td>{STOP_STATUS_LABEL[s.status] ?? s.status}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * 예외.
 *
 * 정산에 영향을 주는 예외를 맨 위로 올린다. 손해액과 귀책이 붙은 건이
 * 확정을 막는 것이고, 나머지는 참고다. 둘을 섞어 두면 매번 전부 읽어야 한다.
 */
function ExceptionsPanel({ detail }: { detail: ActualDetail }) {
  const rows = [...detail.exceptions].sort(
    (a, b) => Number(b.settlementImpact) - Number(a.settlementImpact),
  );

  return (
    <Panel
      title="예외"
      subtitle="정산에 영향을 주는 건이 위에 옵니다"
      action={
        <Link
          href="/execution/exceptions"
          className="text-caption text-content-accent underline-offset-4 hover:underline"
        >
          예외 관리로
        </Link>
      }
    >
      <ul className="divide-y divide-line-subtle">
        {rows.map((e) => (
          <li key={e.exceptionId} className="flex gap-3 px-4 py-3">
            <span
              className={cn(
                'mt-0.5 shrink-0',
                e.settlementImpact ? 'text-status-danger' : 'text-content-tertiary',
              )}
            >
              <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-label font-medium text-content-primary">
                  {EXCEPTION_TYPE_LABEL[e.exceptionType] ?? e.exceptionType}
                </span>
                <span className="text-caption text-content-tertiary">
                  {EXCEPTION_SEVERITY_LABEL[e.severity] ?? e.severity} ·{' '}
                  {EXCEPTION_STATUS_LABEL[e.status] ?? e.status}
                </span>
                {e.settlementImpact && (
                  <span className="rounded-sm border border-status-danger/25 px-1.5 py-px text-[11px] font-medium text-status-danger">
                    정산 영향
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-caption text-content-secondary">{e.description}</p>
              {e.actionTaken && (
                <p className="mt-0.5 text-caption text-content-tertiary">조치 · {e.actionTaken}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              {e.damageAmount !== null && (
                <p className="tabular text-label font-medium text-status-danger">
                  {won(e.damageAmount)}
                </p>
              )}
              <p className="text-caption text-content-tertiary">
                {e.liabilityParty
                  ? `${LIABILITY_PARTY_LABEL[e.liabilityParty] ?? e.liabilityParty} 부담`
                  : '귀책 미정'}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn('eyebrow-ko px-4 py-2.5 font-medium text-content-tertiary', className)}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cn('px-4 py-2.5 text-label text-content-secondary', className)}>{children}</td>
  );
}

function blankToNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

function won(v: number | null): string {
  return v === null ? '—' : `${Math.round(v).toLocaleString('ko-KR')}원`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
