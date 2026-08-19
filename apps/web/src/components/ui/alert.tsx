'use client';

import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'danger' | 'warning' | 'success' | 'info';

const TONE = {
  danger: {
    icon: ShieldAlert,
    surface: 'bg-status-danger-surface border-status-danger/25',
    text: 'text-status-danger',
  },
  warning: {
    icon: AlertTriangle,
    surface: 'bg-status-warning-surface border-status-warning/25',
    text: 'text-status-warning',
  },
  success: {
    icon: CheckCircle2,
    surface: 'bg-status-success-surface border-status-success/25',
    text: 'text-status-success',
  },
  info: {
    icon: Info,
    surface: 'bg-surface-sunken border-line-subtle',
    text: 'text-content-secondary',
  },
} as const;

export interface AlertProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  /** 이어서 할 수 있는 동작. 오류는 빠져나갈 길과 함께 보여준다 */
  action?: ReactNode;
  className?: string;
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: AlertProps) {
  const { icon: Icon, surface, text } = TONE[tone];
  const critical = tone === 'danger' || tone === 'warning';

  return (
    <div
      // 오류는 즉시(assertive), 나머지는 하던 일을 끊지 않고(polite) 알린다
      role={critical ? 'alert' : 'status'}
      aria-live={critical ? 'assertive' : 'polite'}
      className={cn(
        'flex gap-3 rounded-md border px-3.5 py-3 text-body',
        surface,
        className,
      )}
    >
      <Icon
        size={18}
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn('mt-0.5 shrink-0', text)}
      />
      <div className="min-w-0 flex-1">
        {title && (
          <p className={cn('mb-0.5 font-semibold', text)}>{title}</p>
        )}
        <div className="text-content-secondary">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
