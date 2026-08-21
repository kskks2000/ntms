import { AlertTriangle, Check, Lock } from 'lucide-react';
import type { ConfirmGate, GateCheck } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 확정 관문 — 되돌릴 수 없는 선 앞에 서는 것들.
 *
 * 확정된 실적은 정산이 물고 가고, 세금계산서가 나가면 조정 전표로만 고칠 수
 * 있다. 그래서 이 목록은 "확인 사항" 이 아니라 **문**이다.
 *
 * 두 단으로 나눈 이유는 하나다. 전부 막으면 아무것도 확정이 안 되고, 전부
 * 통과시키면 관문이 장식이 된다. 막는 것은 **없으면 돈을 못 받는 것**뿐이다.
 *
 * 통과한 항목도 지우지 않고 조용히 남긴다 — 무엇을 확인하고 넘겼는지가
 * 나중에 분쟁이 났을 때 이 화면이 답해야 하는 질문이기 때문이다.
 */
export function ConfirmGateList({ gate }: { gate: ConfirmGate }) {
  const failed = gate.checks.filter((c) => !c.passed);
  const passed = gate.checks.filter((c) => c.passed);
  // 막는 것이 먼저, 그다음이 짚는 것
  const ordered = [
    ...failed.filter((c) => c.level === 'blocker'),
    ...failed.filter((c) => c.level === 'caution'),
    ...passed,
  ];

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
          {/* 색만으로 말하지 않는다 — 막힘과 짚음은 글자로도 갈린다 */}
          {(blocked || caution) && (
            <span
              className={cn(
                'rounded-sm border px-1.5 py-px text-[11px] font-medium',
                blocked
                  ? 'border-status-danger/25 text-status-danger'
                  : 'border-status-warning/25 text-status-warning',
              )}
            >
              {blocked ? '확정 막힘' : '확인 필요'}
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
 * 건수만 적으면 "2건 막힘" 이 되어, 왜 막혔는지 알려면 상세를 열어야 한다.
 * 여기서는 숫자만 보이고 이유는 체크박스의 title 로 붙는다 — 표에 문장을
 * 넣으면 줄 높이가 들쭉날쭉해져 스무 줄을 훑을 수 없다.
 */
export function GateBadge({
  blockerCount,
  cautionCount,
}: {
  blockerCount: number;
  cautionCount: number;
}) {
  if (blockerCount === 0 && cautionCount === 0) {
    return <span className="text-caption text-content-tertiary">—</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {blockerCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-sm border border-status-danger/25 bg-status-danger-surface px-1.5 py-px text-caption font-medium text-status-danger">
          <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
          <span className="tabular">{blockerCount}</span>
          <span className="sr-only">건이 확정을 막고 있습니다</span>
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
