'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * 주요 동작은 표면과 가장 대비가 큰 색으로 칠한다(라이트=잉크, 다크=흰색).
 * 브랜드색인 옥색은 버튼이 아니라 신호 — 포커스 · 진행 중 표시 — 에만 쓴다.
 * 한 화면에 primary 는 하나뿐이다.
 */
const button = cva(
  [
    'relative inline-flex items-center justify-center gap-2',
    'rounded-md font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow] duration-fast ease-out',
    'disabled:cursor-not-allowed disabled:opacity-45',
    // 터치 지연 300ms 제거
    'touch-manipulation select-none',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-action text-action-text',
          'hover:bg-action-hover active:bg-action-active',
        ],
        secondary: [
          'bg-surface-card text-content-primary border border-line-field',
          'hover:bg-surface-sunken active:bg-surface-sunken',
        ],
        ghost: [
          'bg-transparent text-content-secondary',
          'hover:bg-surface-sunken hover:text-content-primary',
        ],
        link: [
          'bg-transparent text-content-accent underline-offset-4 hover:underline',
          'h-auto px-0',
        ],
      },
      size: {
        sm: 'h-8 px-3 text-label',
        md: 'h-10 px-4 text-body',
        lg: 'h-12 px-5 text-lead',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** 처리 중. 버튼을 잠그고 진행 표시를 띄운다 */
  loading?: boolean;
  /** 처리 중일 때 읽어 줄 문구. 화면에는 보이지 않는다 */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      block,
      loading = false,
      loadingLabel = '처리 중',
      leadingIcon,
      trailingIcon,
      children,
      disabled,
      onClick,
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(button({ variant, size, block }), className)}
        // 처리 중에도 포커스는 유지한다. disabled 로 만들면 포커스가 튀어
        // 스크린리더 사용자가 맥락을 잃는다.
        aria-disabled={disabled || loading}
        aria-busy={loading}
        disabled={disabled}
        {...props}
        // spread 뒤에 온다. 앞에 두면 props 의 onClick 이 이 가드를 덮어써서
        // 처리 중에도 두 번 눌리는 상태가 된다.
        onClick={loading ? (e) => e.preventDefault() : onClick}
      >
        <span
          className={cn(
            'inline-flex items-center gap-2',
            loading && 'opacity-0',
          )}
        >
          {leadingIcon}
          {children}
          {trailingIcon}
        </span>

        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
            <span className="sr-only">{loadingLabel}</span>
          </span>
        )}
      </button>
    );
  },
);

/** 운행선이 진행하는 모습. 이 제품의 신호 언어를 그대로 쓴다 */
function Spinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle
        cx="10"
        cy="10"
        r="7.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.75"
      />
      <path
        d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
