'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: ReactNode;
  description?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, description, error, className, ...props }, ref) {
    const id = useId();
    const errorId = `${id}-error`;

    return (
      <div>
        {/* 라벨 전체가 누를 수 있는 영역이다. 14px 네모만 노리게 하지 않는다 */}
        <label
          htmlFor={id}
          className="group flex cursor-pointer items-start gap-2.5 py-1"
        >
          <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
            <input
              ref={ref}
              id={id}
              type="checkbox"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                'peer h-[18px] w-[18px] appearance-none rounded-sm border bg-surface-field',
                'transition-colors duration-fast ease-out',
                'checked:border-action checked:bg-action',
                'group-hover:border-line-strong',
                'disabled:cursor-not-allowed disabled:opacity-45',
                error ? 'border-status-danger' : 'border-line-field',
                className,
              )}
              {...props}
            />
            <svg
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="pointer-events-none absolute h-3 w-3 text-action-text opacity-0 transition-opacity duration-fast peer-checked:opacity-100"
            >
              <path
                d="M2.5 8.5 6 12l7.5-8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>

          <span className="min-w-0">
            <span className="block text-body text-content-primary">{label}</span>
            {description && (
              <span className="mt-0.5 block text-caption text-content-tertiary">
                {description}
              </span>
            )}
          </span>
        </label>

        {error && (
          <p id={errorId} role="alert" className="mt-1 pl-7 text-caption text-status-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
