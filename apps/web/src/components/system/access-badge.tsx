import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { AccessState } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 지금 들어올 수 있는가.
 *
 * 계정 화면의 흔한 실수는 **상태 칸 하나로 끝내는 것**이다. `ACTIVE` 라고
 * 적혀 있는데 비밀번호가 어제 만료됐거나 실패가 네 번 쌓여 있으면, 그
 * 사람은 내일 아침 못 들어온다. 그런데 목록의 상태 칸은 초록불이다.
 *
 * 그래서 상태 · 만료 · 실패 누적을 `evaluateAccess()` 한 곳에서 접고,
 * 화면은 그 결과 하나만 보여 준다. 색만으로 말하지 않는다 — 아이콘 모양이
 * 셋 다 다르고, 막힌 이유는 글자로 붙는다.
 *
 * 문구는 상태 이름이 아니라 **다음에 할 일**이다. "잠김" 이 아니라
 * "잠금을 풀어야 들어옵니다".
 */
const TONE = {
  open: {
    icon: ShieldCheck,
    chip: 'border-status-success/25 bg-status-success-surface text-status-success',
    label: '들어올 수 있음',
  },
  warning: {
    icon: ShieldAlert,
    chip: 'border-status-warning/25 bg-status-warning-surface text-status-warning',
    label: '곧 막힘',
  },
  blocked: {
    icon: ShieldX,
    chip: 'border-status-danger/25 bg-status-danger-surface text-status-danger',
    label: '못 들어옴',
  },
} as const;

export function AccessBadge({
  access,
  /** 목록에서는 이유를 접고 칩만 쓴다 */
  withReason = false,
  className,
}: {
  access: AccessState;
  withReason?: boolean;
  className?: string;
}) {
  const tone = TONE[access.level];
  const Icon = tone.icon;

  return (
    <span className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-caption font-medium',
          tone.chip,
        )}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {tone.label}
      </span>
      {access.reason && (
        <span
          className={cn(
            'text-caption text-content-secondary',
            // 목록에서는 한 줄로 자른다. 상세에서는 다 편다.
            withReason ? '' : 'truncate',
          )}
        >
          {access.reason}
        </span>
      )}
    </span>
  );
}
