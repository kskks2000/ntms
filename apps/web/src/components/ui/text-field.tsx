'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** 항상 보이는 라벨. placeholder 로 대신하지 않는다 */
  label: string;
  /** 입력 전에 미리 읽는 안내. 오류가 나기 전에 규칙을 알려주는 자리다 */
  hint?: string;
  error?: string;
  /** 오른쪽 끝에 붙는 버튼 등 (비밀번호 보기 토글) */
  adornment?: ReactNode;
  /** 라벨 오른쪽에 붙는 보조 요소 (예: '비밀번호 찾기') */
  labelAside?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      hint,
      error,
      adornment,
      labelAside,
      required,
      className,
      ...props
    },
    ref,
  ) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;

    return (
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label
            htmlFor={id}
            className="text-label font-medium text-content-secondary"
          >
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
          <input
            ref={ref}
            id={id}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [error ? errorId : null, hint ? hintId : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
            className={cn(
              'field-text block h-11 w-full rounded-md border bg-surface-field px-3',
              'text-content-primary placeholder:text-content-tertiary/70',
              'transition-[border-color,box-shadow] duration-fast ease-out',
              'hover:border-line-strong',
              'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-tertiary',
              // 읽기 전용은 비활성과 다르다. 값은 유효하고 복사도 된다.
              'read-only:bg-surface-sunken read-only:text-content-secondary',
              error
                ? 'border-status-danger'
                : 'border-line-field',
              adornment && 'pr-11',
              className,
            )}
            {...props}
          />
          {adornment && (
            <div className="absolute inset-y-0 right-1 flex items-center">
              {adornment}
            </div>
          )}
        </div>

        {hint && !error && (
          <p id={hintId} className="text-caption text-content-tertiary">
            {hint}
          </p>
        )}

        {/*
          오류는 필드 바로 아래에 둔다. 화면 맨 위에 모아 두면 긴 폼에서
          어느 칸이 문제인지 다시 찾아 내려와야 한다.
          role="alert" 로 스크린리더에도 즉시 전달한다.
        */}
        {error && (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-caption text-status-danger"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="mt-[3px] shrink-0"
            >
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8 5v3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="11" r="0.85" fill="currentColor" />
            </svg>
            <span>{error}</span>
          </p>
        )}
      </div>
    );
  },
);
