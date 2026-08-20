'use client';

import { ChevronDown } from 'lucide-react';
import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  /** 오른쪽에 옅게 붙는 보조 문구 (코드 · 소속 운송사 …) */
  note?: string | null;
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
  /**
   * 비워 둘 수 있을 때 맨 위에 놓는 줄. 문구를 받는 이유는 "선택 안 함" 이
   * 화면마다 다른 뜻이기 때문이다 — 운송사가 없으면 자차이고, 권역이
   * 없으면 미지정이다.
   */
  placeholder?: string;
  labelAside?: ReactNode;
}

/**
 * 고르는 칸.
 *
 * 네이티브 `<select>` 를 쓴다. 기준정보 폼에는 거점 · 기사처럼 수십에서
 * 수백 줄이 되는 목록이 있는데, 직접 만든 드롭다운은 그 규모에서 키보드
 * 타이핑 검색 · 화면 낭독기 · 모바일 휠 선택을 전부 다시 만들어야 한다.
 * 브라우저가 이미 잘 하는 일이다.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, options, hint, error, placeholder, labelAside, required, className, ...props },
    ref,
  ) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;

    return (
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-label font-medium text-content-secondary">
            {label}
            {required && (
              <>
                <span aria-hidden="true" className="ml-0.5 text-status-danger">
                  *
                </span>
                <span className="sr-only">필수</span>
              </>
            )}
          </label>
          {labelAside}
        </div>

        <div className="relative">
          <select
            ref={ref}
            id={id}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
              undefined
            }
            className={cn(
              'field-text block h-11 w-full appearance-none rounded-md border bg-surface-field pl-3 pr-9',
              'text-content-primary',
              'transition-[border-color,box-shadow] duration-fast ease-out',
              'hover:border-line-strong',
              'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-tertiary',
              error ? 'border-status-danger' : 'border-line-field',
              className,
            )}
            {...props}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.note ? `${o.label} · ${o.note}` : o.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-tertiary"
          />
        </div>

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
