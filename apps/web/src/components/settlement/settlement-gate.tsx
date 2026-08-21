'use client';

import { AlertTriangle, Check, Lock } from 'lucide-react';
import type { CloseGate, GateCheck, SettlementGate } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 관문 — 되돌릴 수 없는 선 앞에 서는 것들.
 *
 * 실적의 확정 관문과 **같은 모양**이다(`components/actual/confirm-gate.tsx`).
 * 같은 질문에 같은 그림을 쓰는 것은 이 저장소의 규칙이다 — 정산 담당자가
 * 실적 화면에서 배운 것을 여기서 다시 배우지 않게 한다.
 *
 * 두 단으로 나눈 이유도 같다. 전부 막으면 월말에 아무것도 안 넘어가고, 전부
 * 통과시키면 관문이 장식이 된다. 막는 것은 **없으면 돈을 못 받거나 법을
 * 어기는 것**뿐이다.
 */
export function GateList({ gate }: { gate: SettlementGate | CloseGate }) {
  const failed = gate.checks.filter((c) => !c.passed);
  const passed = gate.checks.filter((c) => c.passed);
  const ordered = [
    ...failed.filter((c) => c.level === 'blocker'),
    ...failed.filter((c) => c.level === 'caution'),
    ...passed,
  ];

  if (ordered.length === 0) {
    return (
      <p className="px-4 py-4 text-caption text-content-secondary">
        지금 단계에서 확인할 것이 없습니다.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line-subtle">
      {ordered.map((check) => (
        <GateRow key={check.key} check={check} />
      ))}
    </ul>
  );
}

function GateRow({ check }: { check: GateCheck }) {
  const blocked = !check.passed && check.level === 'blocker';
  const caution = !check.passed && check.level === 'caution';
  const Icon = blocked ? Lock : caution ? AlertTriangle : Check;

  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm',
          blocked
            ? 'bg-status-danger-surface text-status-danger'
            : caution
              ? 'bg-status-warning-surface text-status-warning'
              : 'text-content-tertiary',
        )}
      >
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span
            className={cn(
              'text-label font-medium',
              blocked
                ? 'text-status-danger'
                : caution
                  ? 'text-status-warning'
                  : 'text-content-secondary',
            )}
          >
            {check.title}
          </span>
          {/* 색만으로 말하지 않는다 */}
          {(blocked || caution) && (
            <span
              className={cn(
                'rounded-sm border px-1.5 py-px text-[11px] font-medium',
                blocked
                  ? 'border-status-danger/25 text-status-danger'
                  : 'border-status-warning/25 text-status-warning',
              )}
            >
              {blocked ? '진행 막힘' : '확인 필요'}
            </span>
          )}
        </p>
        <p
          className={cn(
            'mt-0.5 text-caption',
            check.passed ? 'text-content-tertiary' : 'text-content-secondary',
          )}
        >
          {check.detail}
        </p>
      </div>
    </li>
  );
}

/**
 * 목록에서 쓰는 관문 요약.
 *
 * 표에 문장을 넣으면 줄 높이가 들쭉날쭉해져 스무 줄을 훑을 수 없다. 숫자만
 * 보이고 이유는 `title` 로 붙인다.
 */
export function GateBadge({
  blockerCount,
  cautionCount,
  reason,
}: {
  blockerCount: number;
  cautionCount: number;
  reason?: string | null;
}) {
  if (blockerCount === 0 && cautionCount === 0) {
    return <span className="text-caption text-content-tertiary">—</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5" title={reason ?? undefined}>
      {blockerCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-sm border border-status-danger/25 bg-status-danger-surface px-1.5 py-px text-caption font-medium text-status-danger">
          <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
          <span className="tabular">{blockerCount}</span>
          <span className="sr-only">건이 진행을 막고 있습니다</span>
        </span>
      )}
      {cautionCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-sm border border-line-subtle px-1.5 py-px text-caption text-status-warning">
          <AlertTriangle size={11} strokeWidth={2.25} aria-hidden="true" />
          <span className="tabular">{cautionCount}</span>
          <span className="sr-only">건을 확인해야 합니다</span>
        </span>
      )}
    </span>
  );
}
