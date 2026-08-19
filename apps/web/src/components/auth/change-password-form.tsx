'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AUTH_ERROR,
  authErrorMessage,
  changePasswordSchema,
  type ChangePasswordInput,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordField } from '@/components/ui/password-field';

/**
 * 비밀번호 변경.
 *
 * 두 경로로 들어온다.
 *   - 강제  : 초기 비밀번호이거나 유효기간이 지나 업무 화면에 못 들어간 상태
 *   - 자발  : 계정 메뉴에서 직접
 *
 * 두 경우에 할 일은 같고 안내 문구만 다르다. 화면을 둘로 나누면 규칙이
 * 갈라지므로 하나로 두고 문구만 바꾼다.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const { user, changePassword } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError: setFieldError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordConfirm: '' },
    mode: 'onBlur',
  });

  const newPassword = watch('newPassword') ?? '';
  const forced = user?.mustChangePassword ?? false;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await changePassword(values);
      router.replace('/dashboard');
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;

      if (err.code === AUTH_ERROR.CURRENT_PASSWORD_WRONG) {
        setFieldError('currentPassword', {
          message: authErrorMessage(err.code, err.payload.message),
        });
        setFocus('currentPassword');
        return;
      }
      if (err.code === AUTH_ERROR.PASSWORD_UNCHANGED) {
        setFieldError('newPassword', {
          message: authErrorMessage(err.code, err.payload.message),
        });
        setFocus('newPassword');
        return;
      }

      const fields = err.fields;
      if (fields) {
        for (const [name, messages] of Object.entries(fields)) {
          if (name in values && messages[0]) {
            setFieldError(name as keyof ChangePasswordInput, {
              message: messages[0],
            });
          }
        }
        setFocus('newPassword');
        return;
      }

      setError(authErrorMessage(err.code, err.payload.message));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <header className="animate-rise" style={{ animationDelay: '60ms' }}>
        <h1 className="text-title font-semibold text-content-primary">
          비밀번호 변경
        </h1>
        <p className="mt-1.5 text-body text-content-secondary">
          {forced
            ? '업무 화면에 들어가려면 먼저 비밀번호를 바꿔야 합니다.'
            : '바꾸고 나면 다른 기기는 모두 로그아웃됩니다.'}
        </p>
      </header>

      {forced && (
        <Alert tone="warning" className="mt-6" title="변경이 필요한 상태입니다">
          {user?.passwordExpiresInDays !== null &&
          (user?.passwordExpiresInDays ?? 0) <= 0
            ? '비밀번호 유효기간이 지났습니다.'
            : '관리자가 발급한 초기 비밀번호를 그대로 쓰고 있습니다.'}
        </Alert>
      )}

      {error && (
        <div className="mt-6">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div
        className="animate-rise mt-7 space-y-5"
        style={{ animationDelay: '110ms' }}
      >
        <PasswordField
          label="현재 비밀번호"
          hint="본인 확인을 위해 다시 한 번 입력합니다."
          autoComplete="current-password"
          autoFocus
          required
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />

        <div className="border-t border-line-subtle pt-5">
          <PasswordField
            label="새 비밀번호"
            hint="10자 이상, 영문 · 숫자 · 특수문자 중 3종 이상."
            autoComplete="new-password"
            showStrength
            strengthValue={newPassword}
            required
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
        </div>

        <PasswordField
          label="새 비밀번호 확인"
          autoComplete="new-password"
          required
          error={errors.newPasswordConfirm?.message}
          {...register('newPasswordConfirm')}
        />
      </div>

      <div className="animate-rise mt-8" style={{ animationDelay: '160ms' }}>
        <Button
          type="submit"
          size="lg"
          block
          loading={isSubmitting}
          loadingLabel="비밀번호를 바꾸는 중"
          trailingIcon={<ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />}
        >
          비밀번호 변경
        </Button>
      </div>

      <p
        className="animate-rise mt-6 flex items-start gap-2 text-caption text-content-tertiary"
        style={{ animationDelay: '210ms' }}
      >
        <ShieldCheck
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className="mt-0.5 shrink-0"
        />
        <span>
          변경하면 다른 기기의 로그인은 모두 끊깁니다. 지금 쓰는 이 창은 그대로
          유지되므로 하던 일을 이어서 하면 됩니다.
        </span>
      </p>
    </form>
  );
}
