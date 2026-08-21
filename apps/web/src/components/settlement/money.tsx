'use client';

import type { InvoiceDeadline } from '@ntms/shared';
import { compactWon, won } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 금액 칸.
 *
 * 표의 금액은 **한 원까지** 보인다. 억·만으로 접는 것은 요약 숫자에서만
 * 한다 — 명세서와 대사하는 사람에게 "2.5억" 은 아무 쓸모가 없다.
 */
export function Money({
  amount,
  tone = 'default',
  size = 'body',
  suffix,
}: {
  amount: number | null;
  tone?: 'default' | 'muted' | 'warning' | 'strong';
  size?: 'caption' | 'label' | 'body' | 'lead';
  suffix?: string;
}) {
  if (amount === null) return <span className="text-content-tertiary">—</span>;

  return (
    <span
      className={cn(
        'tabular',
        size === 'caption' && 'text-caption',
        size === 'label' && 'text-label',
        size === 'body' && 'text-body',
        size === 'lead' && 'text-lead',
        tone === 'default' && 'text-content-primary',
        tone === 'muted' && 'text-content-tertiary',
        tone === 'warning' && 'font-medium text-status-warning',
        tone === 'strong' && 'font-semibold text-content-primary',
      )}
    >
      {won(amount)}
      {suffix && <span className="ml-0.5 text-caption text-content-tertiary">{suffix}</span>}
    </span>
  );
}

/**
 * 수납 진행.
 *
 * 부분수납이 정상인 도메인이라 "얼마 들어왔나" 를 상태 글자로만 두면 안
 * 된다. 30%가 들어온 건과 95%가 들어온 건은 같은 `PARTIALLY_PAID` 지만
 * 담당자가 할 일이 다르다.
 */
export function PaidMeter({
  total,
  paid,
  overdueDays,
}: {
  total: number;
  paid: number;
  overdueDays: number | null;
}) {
  const pct = total <= 0 ? 0 : Math.max(0, Math.min(100, (paid / total) * 100));
  const done = paid >= total && total > 0;
  const late = overdueDays !== null && overdueDays > 0 && !done;

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span
        className="relative h-[7px] w-full rounded-[2px] bg-surface-sunken"
        role="img"
        aria-label={`${Math.round(pct)}% 수납${late ? `, 기한 ${overdueDays}일 초과` : ''}`}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 rounded-[2px]',
            done ? 'bg-content-tertiary/50' : late ? 'bg-status-warning' : 'bg-content-primary/70',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="flex items-baseline gap-1.5 text-caption">
        <span className={cn('tabular', late ? 'font-medium text-status-warning' : 'text-content-secondary')}>
          {won(total - paid)}
        </span>
        <span className="text-content-tertiary">남음</span>
        {late && <span className="text-status-warning">· {overdueDays}일 초과</span>}
      </span>
    </span>
  );
}

/**
 * 세금계산서 발행 기한.
 *
 * 축은 "발행했나" 가 아니라 **"며칠 남았나"** 다. 부가가치세법이 공급일이
 * 속한 달의 다음 달 10일로 정해 두었고, 넘기면 가산세가 붙는다.
 *
 * 기준정보 화면의 유효기간 막대(ValidityMeter)와 같은 장치를 쓴다 — 같은
 * 질문이면 같은 그림이어야 사람이 화면마다 다시 배우지 않는다.
 */
export function DeadlineMeter({ deadline }: { deadline: InvoiceDeadline | null }) {
  if (!deadline) return <span className="text-caption text-content-tertiary">—</span>;

  const tone =
    deadline.tone === 'over' || deadline.tone === 'urgent'
      ? 'text-status-danger'
      : deadline.tone === 'soon'
        ? 'text-status-warning'
        : 'text-content-secondary';

  const bar =
    deadline.tone === 'over'
      ? 'bg-status-danger'
      : deadline.tone === 'urgent'
        ? 'bg-status-danger/70'
        : deadline.tone === 'soon'
          ? 'bg-status-warning'
          : 'bg-content-tertiary/45';

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="relative h-[7px] w-14 shrink-0 rounded-[2px] bg-surface-sunken"
        role="img"
        aria-label={`발행기한 ${deadline.dueDate}, ${deadline.label}`}
      >
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 rounded-[2px]', bar)}
          // 넘긴 것은 막대를 꽉 채워 붉게 둔다. 0으로 만들면 "아무 일도 없음"
          // 처럼 보이는데, 사실은 가장 급한 줄이다.
          style={{ width: deadline.daysLeft < 0 ? '100%' : `${deadline.ratio * 100}%` }}
        />
      </span>
      <span className={cn('tabular whitespace-nowrap text-caption', tone)}>{deadline.label}</span>
    </span>
  );
}

/** 요약 줄의 큰 숫자. 억·만으로 접는다 */
export function CompactMoney({ amount }: { amount: number | null }) {
  if (amount === null) return <>—</>;
  return <>{compactWon(amount)}</>;
}
