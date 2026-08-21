import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * 업무 화면의 판.
 *
 * 그림자를 거의 쓰지 않고 헤어라인으로 나눈다. 한 화면에 판이 예닐곱 개씩
 * 올라가는 관제 화면에서 그림자를 겹쳐 쓰면 종이가 들뜬 것처럼 어수선해진다.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
  bodyClassName,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-card border border-line-subtle bg-surface-card',
        className,
      )}
    >
      {title && (
        <header className="flex items-center gap-3 border-b border-line-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-title-sm font-semibold text-content-primary">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-caption text-content-tertiary">{subtitle}</p>
            )}
          </div>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * 숫자 한 칸.
 *
 * 큰 숫자 카드를 나란히 늘어놓는 대시보드를 만들지 않는다. 숫자가 클수록
 * 중요하다는 뜻은 아니기 때문이다. 크기는 절제하고, 단위와 이름을 붙여
 * **무엇을 센 숫자인지** 가 먼저 읽히게 한다.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string;
  /**
   * 숫자가 대부분이지만 상태 칩이 오기도 한다(정산 상세의 「상태」 칸).
   * 고정폭·자간은 아래 span 이 걸어 주므로 요소가 와도 줄이 안 흔들린다.
   */
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
}) {
  const valueTone = {
    default: 'text-content-primary',
    accent: 'text-status-success',
    warning: 'text-status-warning',
    danger: 'text-status-danger',
  }[tone];

  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="truncate text-caption text-content-tertiary">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={cn('tabular text-[1.5rem] font-medium leading-none', valueTone)}>
          {value}
        </span>
        {unit && <span className="text-caption text-content-tertiary">{unit}</span>}
      </p>
      {hint && <p className="mt-1 truncate text-caption text-content-tertiary">{hint}</p>}
    </div>
  );
}

/**
 * 숫자 칸을 헤어라인으로 잇는 줄.
 *
 * 칸 수를 고정하지 않고 폭에 맞춰 채운다. 6칸으로 고정해 두면 3칸짜리
 * 화면에서 오른쪽 절반이 빈 채로 남는다.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-px overflow-hidden rounded-card border border-line-subtle bg-line-subtle [&>*]:bg-surface-card">
      {children}
    </div>
  );
}

/**
 * 빈 화면.
 * 비어 있다는 사실만 알리지 않는다. 왜 비었는지와 다음에 할 일을 적는다.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="text-content-tertiary">{icon}</div>}
      <p className="mt-3 text-body font-medium text-content-primary">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-caption text-content-secondary">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 불러오는 동안 자리를 잡아 둔다. 화면이 뛰지 않게 하려는 것이다 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-sm bg-surface-sunken', className)}
    />
  );
}
