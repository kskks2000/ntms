'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import {
  EXCEPTION_SEVERITY_LABEL,
  EXCEPTION_STATUS_LABEL,
  EXCEPTION_TYPE_LABEL,
  type ExceptionRow,
} from '@ntms/shared';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { TextareaField } from '@/components/ui/textarea-field';
import { useApiMutation } from '@/lib/query';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/**
 * 예외 처리 서랍.
 *
 * ## 조치 없는 해결을 막는다
 *
 * 상태만 바꿔 닫을 수 있게 두면 목록은 깨끗해지고 기록은 사라진다. 같은
 * 상하차지에서 매달 지연이 나도, 조치란이 비어 있으면 다음 사람이 그 사실을
 * 알 방법이 없다. 그래서 조치완료 이후 상태로 넘어가려면 무엇을 했는지
 * 적어야 한다 — 서버도 같은 규칙을 들고 있다.
 */
const FLOW = ['REPORTED', 'INVESTIGATING', 'ACTION_TAKEN', 'RESOLVED', 'CLOSED'] as const;

export function ExceptionDrawer({
  row,
  onClose,
  onDone,
}: {
  row: ExceptionRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<string>(nextOf(row.status));
  const [severity, setSeverity] = useState<string>(row.severity);
  const [actionTaken, setActionTaken] = useState(row.actionTaken ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const save = useApiMutation<{ exceptionId: string }, Record<string, unknown>>(
    () => ({ path: `/execution/exceptions/${row.exceptionId}`, method: 'PATCH' }),
    {
      invalidate: [['execution']],
      onSuccess: () => {
        toast.success(
          '예외를 갱신했습니다',
          `${EXCEPTION_STATUS_LABEL[status] ?? status} 로 넘겼습니다.`,
        );
        onDone();
      },
    },
  );

  const needsAction = ['ACTION_TAKEN', 'RESOLVED', 'CLOSED'].includes(status);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/35"
      />

      <aside
        role="dialog"
        aria-label="예외 처리"
        className="relative flex h-full w-full max-w-md flex-col bg-surface-card shadow-xl [animation:ntms-drawer-in_var(--dur-base)_var(--ease-out)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow text-content-tertiary">{row.exceptionNo ?? 'EXCEPTION'}</p>
            <h2 className="mt-1 text-heading font-semibold text-content-primary">
              {EXCEPTION_TYPE_LABEL[row.exceptionType] ?? row.exceptionType}
            </h2>
            <p className="tabular mt-0.5 text-caption text-content-tertiary">
              {row.vehicleNo ?? '차량 미상'} · {formatDateTime(row.occurredAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1.5 text-content-tertiary hover:bg-surface-sunken hover:text-content-primary"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <section>
            <p className="text-label font-semibold text-content-primary">무슨 일이 있었나</p>
            <p className="mt-1.5 text-body text-content-secondary">{row.description}</p>
            {row.impactMinutes !== null && (
              <p className="tabular mt-2 text-caption text-content-tertiary">
                이 건이 까먹은 시간 {row.impactMinutes}분
              </p>
            )}
          </section>

          <section className="mt-5 border-t border-line-subtle pt-4">
            <p className="text-label font-semibold text-content-primary">진행</p>
            <Flow current={row.status} />
          </section>

          <form
            className="mt-5 space-y-4 border-t border-line-subtle pt-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (needsAction && actionTaken.trim().length === 0) {
                setFieldError('어떻게 조치했는지 적어야 이 상태로 넘길 수 있습니다.');
                return;
              }
              setFieldError(null);
              save.mutate({
                status,
                severity,
                actionTaken: actionTaken.trim() || null,
              });
            }}
          >
            <SelectField
              label="다음 상태"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={FLOW.map((f) => ({
                value: f,
                label: EXCEPTION_STATUS_LABEL[f] ?? f,
              }))}
            />

            <SelectField
              label="심각도"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              hint="확인해 보니 생각보다 크거나 작았다면 여기서 고칩니다."
              options={(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => ({
                value: s,
                label: EXCEPTION_SEVERITY_LABEL[s] ?? s,
              }))}
            />

            <TextareaField
              label="조치 내용"
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              rows={4}
              error={fieldError ?? undefined}
              hint={
                needsAction
                  ? '조치완료 이후 상태로 넘기려면 필요합니다.'
                  : '지금 적어 두면 같은 일이 또 났을 때 근거가 됩니다.'
              }
              placeholder="예: 화주에 15시 도착으로 재통보, 도크 연장 협의 완료"
            />

            {save.isError && (
              <p role="alert" className="text-caption text-status-danger">
                {save.error.payload.message}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" loading={save.isPending} loadingLabel="저장하는 중">
                저장
              </Button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}

/** 어디까지 왔는지. 상태 이름만 보면 순서를 모른다 */
function Flow({ current }: { current: string }) {
  const at = FLOW.indexOf(current as (typeof FLOW)[number]);
  return (
    <ol className="mt-2 flex items-center gap-1">
      {FLOW.map((f, i) => (
        <li key={f} className="flex flex-1 items-center gap-1">
          <span
            className={cn(
              'flex-1 rounded-sm px-1.5 py-1 text-center text-caption',
              i < at
                ? 'bg-surface-sunken text-content-tertiary'
                : i === at
                  ? 'bg-action text-action-text'
                  : 'border border-dashed border-line-subtle text-content-tertiary',
            )}
          >
            {EXCEPTION_STATUS_LABEL[f] ?? f}
          </span>
        </li>
      ))}
    </ol>
  );
}

function nextOf(status: string): string {
  const i = FLOW.indexOf(status as (typeof FLOW)[number]);
  return FLOW[Math.min(i + 1, FLOW.length - 1)] ?? status;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
