'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AUTH_ERROR,
  authErrorMessage,
  loginSchema,
  type LoginInput,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PasswordField } from '@/components/ui/password-field';
import { TextField } from '@/components/ui/text-field';

/** 회사 코드는 사람마다 하나로 고정된다. 매번 다시 치게 하지 않는다 */
const TENANT_CODE_KEY = 'ntms.tenantCode';

interface FormAlert {
  tone: 'danger' | 'warning';
  title?: string;
  message: string;
}

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [alert, setAlert] = useState<FormAlert | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { tenantCode: '', loginId: '', password: '', rememberMe: false },
    mode: 'onBlur',
  });

  // 저장해 둔 회사 코드를 채우고, 커서는 그다음 칸으로 보낸다.
  useEffect(() => {
    const saved = window.localStorage.getItem(TENANT_CODE_KEY);
    if (saved) {
      setValue('tenantCode', saved);
      setFocus('loginId');
    } else {
      setFocus('tenantCode');
    }
  }, [setValue, setFocus]);

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    try {
      const user = await login(values);
      window.localStorage.setItem(TENANT_CODE_KEY, user.tenantCode);
      router.replace('/dashboard');
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      setAlert(toAlert(error));
      // 다시 시도할 곳으로 커서를 보낸다
      if (error.code === AUTH_ERROR.TENANT_NOT_FOUND) {
        setFocus('tenantCode');
      } else if (error.code === AUTH_ERROR.INVALID_CREDENTIALS) {
        setFocus('password');
      }
    }
  });

  const tenantCodeField = register('tenantCode');

  return (
    <form onSubmit={onSubmit} noValidate>
      <header className="animate-rise" style={{ animationDelay: '60ms' }}>
        <h1 className="text-title font-semibold text-content-primary">로그인</h1>
        <p className="mt-1.5 text-body text-content-secondary">
          회사에서 발급받은 계정으로 들어갑니다.
        </p>
      </header>

      {alert && (
        <div className="mt-6">
          <Alert tone={alert.tone} title={alert.title}>
            {alert.message}
          </Alert>
        </div>
      )}

      <div
        className="animate-rise mt-7 space-y-5"
        style={{ animationDelay: '110ms' }}
      >
        <TextField
          label="회사 코드"
          hint="사내 시스템 담당자가 알려준 코드입니다."
          placeholder="예: NTMS"
          autoComplete="organization"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          className="uppercase tracking-[0.08em]"
          required
          error={errors.tenantCode?.message}
          {...tenantCodeField}
          onChange={(e) => {
            // DB 에 대문자 제약이 걸려 있다. 입력하는 동안 맞춰 준다.
            e.target.value = e.target.value.toUpperCase();
            void tenantCodeField.onChange(e);
          }}
        />

        <TextField
          label="아이디"
          placeholder="아이디"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          required
          error={errors.loginId?.message}
          {...register('loginId')}
        />

        <PasswordField
          label="비밀번호"
          placeholder="비밀번호"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          labelAside={
            <Link
              href="/password/reset"
              className="rounded-sm text-caption text-content-tertiary underline-offset-4 transition-colors duration-fast hover:text-content-accent hover:underline"
            >
              비밀번호를 잊으셨나요?
            </Link>
          }
          {...register('password')}
        />

        <Checkbox
          label="로그인 상태 유지"
          description="공용 PC 에서는 켜지 마세요. 브라우저를 닫아도 7일간 로그인이 유지됩니다."
          {...register('rememberMe')}
        />
      </div>

      <div
        className="animate-rise mt-8"
        style={{ animationDelay: '160ms' }}
      >
        <Button
          type="submit"
          size="lg"
          block
          loading={isSubmitting}
          loadingLabel="로그인하는 중"
        >
          로그인
        </Button>
      </div>

      <div
        className="animate-rise mt-8 border-t border-line-subtle pt-6"
        style={{ animationDelay: '210ms' }}
      >
        <p className="text-body text-content-secondary">
          아직 계정이 없으신가요?
        </p>
        <Link
          href="/signup"
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm text-body font-medium text-content-accent underline-offset-4 transition-colors duration-fast hover:underline"
        >
          계정 신청하기
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </form>
  );
}

/**
 * 서버는 코드를, 화면은 문구를 책임진다.
 * 실패 횟수처럼 화면에서만 쓸모 있는 값은 detail 로 받아 문장을 만든다.
 */
function toAlert(error: ApiRequestError): FormAlert {
  const message = authErrorMessage(error.code, error.payload.message);

  if (error.code === AUTH_ERROR.INVALID_CREDENTIALS) {
    const failCount = Number(error.detail?.failCount ?? 0);
    const maxFailCount = Number(error.detail?.maxFailCount ?? 0);

    if (failCount > 0 && maxFailCount > 0) {
      const left = maxFailCount - failCount;
      return {
        tone: left <= 2 ? 'danger' : 'warning',
        message: `${message} ${left}회 더 틀리면 계정이 잠깁니다. (${failCount}/${maxFailCount})`,
      };
    }
    return { tone: 'danger', message };
  }

  if (
    error.code === AUTH_ERROR.ACCOUNT_PENDING ||
    error.code === AUTH_ERROR.PASSWORD_EXPIRED
  ) {
    return { tone: 'warning', message };
  }

  if (error.code === AUTH_ERROR.ACCOUNT_LOCKED) {
    return { tone: 'danger', title: '계정이 잠겼습니다', message };
  }

  return { tone: 'danger', message };
}
