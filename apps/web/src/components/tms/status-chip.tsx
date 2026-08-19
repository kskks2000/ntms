import type { StatusPhase } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 상태 표시.
 *
 * 오더 상태만 15가지다. 상태마다 색을 하나씩 주면 색이 뜻을 잃는다.
 * **국면(phase) 네 가지**로 접어서 말한다.
 *
 *   planned  아직 움직이지 않았다   중립
 *   active   지금 움직이고 있다     옥색 — 이 시스템에서 옥색은 살아 있는 것
 *   done     끝났다                조용한 성공
 *   problem  손을 대야 한다         호박 · 적색
 *
 * 색만으로 말하지 않는다. 국면마다 앞머리 표식의 모양이 다르고, 글자는
 * 언제나 함께 있다.
 */
const TONE: Record<StatusPhase, { chip: string; dot: string }> = {
  planned: {
    chip: 'border-line-subtle bg-surface-sunken text-content-secondary',
    dot: 'bg-content-tertiary',
  },
  active: {
    chip: 'border-status-success/25 bg-status-success-surface text-status-success',
    // 진행 중인 것만 테두리를 두른다. 목록을 훑을 때 눈에 먼저 걸려야 하는 줄이다.
    dot: 'bg-status-success ring-2 ring-status-success/25',
  },
  done: {
    chip: 'border-line-subtle bg-surface-card text-content-tertiary',
    dot: 'bg-content-tertiary/50',
  },
  problem: {
    chip: 'border-status-danger/25 bg-status-danger-surface text-status-danger',
    dot: 'bg-status-danger',
  },
};

export function StatusChip({
  label,
  phase,
  className,
}: {
  label: string;
  phase: StatusPhase;
  className?: string;
}) {
  const tone = TONE[phase];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-caption font-medium',
        tone.chip,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {label}
    </span>
  );
}
