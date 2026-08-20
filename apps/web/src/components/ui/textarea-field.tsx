'use client';

import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

/**
 * 여러 줄 입력. 지금은 비고 칸에만 쓴다.
 *
 * 비고는 다른 칸이 담지 못한 사정이 들어오는 자리다 — "게이트 통과증
 * 필요", "야간 반입 불가" 같은 것. 그래서 세 줄로 시작하되 늘릴 수 있게
 * 둔다.
 */
export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField({ label, hint, error, className, rows = 3, ...props }, ref) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;

    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-label font-medium text-content-secondary">
          {label}
        </label>

        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
          }
          className={cn(
            'field-text block w-full resize-y rounded-md border bg-surface-field px-3 py-2.5',
            'text-content-primary placeholder:text-content-tertiary/70',
            'transition-[border-color,box-shadow] duration-fast ease-out',
            'hover:border-line-strong',
            error ? 'border-status-danger' : 'border-line-field',
            className,
          )}
          {...props}
        />

        {hint && !error && (
          <p id={hintId} className="text-caption text-content-tertiary">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} role="alert" className="text-caption text-status-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
