import { validityLevel, type Validity } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 유효기간 게이지.
 *
 * 기준정보에서 나는 가장 흔한 사고는 **만료된 줄 모르고 쓰는 것**이다.
 * 보험이 끝난 차에 배차하고, 면허가 만료된 기사를 붙이고, 적용기간이 지난
 * 운임표로 청구한다. 날짜만 적어 두면 사람이 매번 오늘과 빼기를 해야 하고,
 * 200줄짜리 표에서 그 뺄셈은 아무도 하지 않는다.
 *
 * 그래서 남은 기간을 **막대 하나**로 줄인다. 차량·기사·단가 화면이 같은
 * 장치를 쓰므로, 한 화면에서 익히면 나머지에서 다시 배우지 않는다.
 *
 * 색만으로 말하지 않는다. 남은 일수를 숫자로 함께 적고, 지난 것은
 * "만료" 라고 글자로 밝힌다.
 */
const TONE = {
  ok: { bar: 'bg-status-success', text: 'text-content-secondary' },
  soon: { bar: 'bg-status-warning', text: 'text-status-warning' },
  expired: { bar: 'bg-status-danger', text: 'text-status-danger' },
  none: { bar: 'bg-line-subtle', text: 'text-content-tertiary' },
} as const;

/** 게이지가 가득 차는 기간. 1년 남으면 100% */
const FULL_DAYS = 365;

export function ValidityMeter({
  validity,
  label,
  className,
}: {
  validity: Validity;
  /** 무엇의 기한인가 — 보험 · 검사 · 면허 … */
  label?: string;
  className?: string;
}) {
  const level = validityLevel(validity);
  const tone = TONE[level];

  if (level === 'none') {
    return (
      <span className={cn('text-caption text-content-tertiary', className)}>미등록</span>
    );
  }

  const days = validity.daysLeft!;
  const ratio = Math.max(0, Math.min(1, days / FULL_DAYS));

  return (
    <span className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex items-baseline gap-1.5">
        {label && <span className="text-caption text-content-tertiary">{label}</span>}
        <span className={cn('tabular text-caption font-medium', tone.text)}>
          {days < 0 ? '만료' : `${days}일`}
        </span>
        <span className="tabular text-caption text-content-tertiary">
          {validity.until}
        </span>
      </span>
      <span
        className="h-1 w-full max-w-[7rem] overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`${label ?? '유효기간'} ${days < 0 ? '만료됨' : `${days}일 남음`}`}
      >
        <span
          className={cn('block h-full rounded-full', tone.bar)}
          style={{ width: days < 0 ? '100%' : `${Math.max(3, ratio * 100)}%` }}
        />
      </span>
    </span>
  );
}

/** 표 안에서 좁게 쓸 때 — 막대 없이 글자만 */
export function ValidityText({ validity }: { validity: Validity }) {
  const level = validityLevel(validity);
  if (level === 'none') {
    return <span className="text-content-tertiary">—</span>;
  }
  const days = validity.daysLeft!;
  return (
    <span className={cn('tabular', TONE[level].text)}>
      {days < 0 ? `만료 ${-days}일` : `${days}일`}
    </span>
  );
}
