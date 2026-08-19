'use client';

import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import {
  PASSWORD_STRENGTH_LABEL,
  assessPassword,
  type PasswordAssessment,
} from '@ntms/shared';
import { cn } from '@/lib/cn';
import { TextField, type TextFieldProps } from './text-field';

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'adornment'> {
  /** 강도 표시를 보여줄지. 로그인에는 필요 없고 신청·변경에만 쓴다 */
  showStrength?: boolean;
  /** 강도 계산에 쓸 현재 값 (react-hook-form 의 watch 값) */
  strengthValue?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    { showStrength = false, strengthValue = '', ...props },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const assessment = showStrength ? assessPassword(strengthValue) : null;

    return (
      <div className="space-y-2">
        <TextField
          ref={ref}
          type={visible ? 'text' : 'password'}
          // 브라우저 · 비밀번호 관리자가 알아보게 한다
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          adornment={
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              // 44px 터치 영역을 확보한다. 아이콘 크기와 누를 수 있는 크기는 다르다
              className="flex h-11 w-11 items-center justify-center rounded-md text-content-tertiary transition-colors duration-fast hover:text-content-primary"
              aria-label={visible ? '비밀번호 가리기' : '비밀번호 보기'}
              aria-pressed={visible}
            >
              {visible ? (
                <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Eye size={18} strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          }
          {...props}
        />

        {assessment && strengthValue.length > 0 && (
          <StrengthMeter assessment={assessment} />
        )}
      </div>
    );
  },
);

const BAR_TONE = {
  weak: 'bg-status-danger',
  fair: 'bg-status-warning',
  strong: 'bg-status-success',
} as const;

const TEXT_TONE = {
  weak: 'text-status-danger',
  fair: 'text-status-warning',
  strong: 'text-status-success',
} as const;

/**
 * 눈금 4칸. 색만으로 뜻을 전하지 않기 위해 항상 글자를 함께 둔다.
 * 아직 채우지 못한 규칙을 나열해서, 무엇을 고쳐야 하는지 바로 보이게 한다.
 */
function StrengthMeter({ assessment }: { assessment: PasswordAssessment }) {
  const { score, strength, unmet } = assessment;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-base ease-out',
                step <= score ? BAR_TONE[strength] : 'bg-line-subtle',
              )}
            />
          ))}
        </div>
        <span
          className={cn('eyebrow-ko shrink-0', TEXT_TONE[strength])}
          aria-live="polite"
        >
          {PASSWORD_STRENGTH_LABEL[strength]}
        </span>
      </div>

      {unmet.length > 0 && (
        <p className="mt-1.5 text-caption text-content-tertiary">
          남은 조건 · {unmet.join(' · ')}
        </p>
      )}
    </div>
  );
}
