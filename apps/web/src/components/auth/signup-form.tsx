'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import {
  authErrorMessage,
  signupStep1Schema,
  signupStep2Schema,
  type SignupResult,
  type SignupStep1Input,
  type SignupStep2Input,
  type TenantSummary,
} from '@ntms/shared';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PasswordField } from '@/components/ui/password-field';
import { TextField } from '@/components/ui/text-field';

/**
 * 계정 신청.
 *
 * 두 단계로 나눈 이유는 화면을 짧게 하려는 것이 아니라, 순서가 실제로
 * 다르기 때문이다. 회사가 확인되기 전에는 아이디도 비밀번호도 의미가 없다.
 * 1단계에서 회사명을 되짚어 주기 때문에, 코드를 잘못 입력한 사람은
 * 나머지 열 칸을 채우기 전에 알아챈다.
 */
type Stage = 'company' | 'profile' | 'done';

const STEPS = [
  { key: 'company', label: '회사 확인' },
  { key: 'profile', label: '담당자 정보' },
] as const;

export function SignupForm() {
  const [stage, setStage] = useState<Stage>('company');
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [step1, setStep1] = useState<SignupStep1Input | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);

  if (stage === 'done' && result) {
    return <SubmittedNotice result={result} />;
  }

  return (
    <div>
      <header className="animate-rise" style={{ animationDelay: '60ms' }}>
        <h1 className="text-title font-semibold text-content-primary">계정 신청</h1>
        <p className="mt-1.5 text-body text-content-secondary">
          신청 후 사내 관리자가 승인하면 로그인할 수 있습니다.
        </p>
      </header>

      <StepRail current={stage === 'company' ? 0 : 1} />

      {stage === 'company' ? (
        <CompanyStep
          defaults={step1}
          onDone={(values, found) => {
            setStep1(values);
            setTenant(found);
            setStage('profile');
          }}
        />
      ) : (
        <ProfileStep
          tenant={tenant!}
          step1={step1!}
          onBack={() => setStage('company')}
          onDone={(res) => {
            setResult(res);
            setStage('done');
          }}
        />
      )}

      <div
        className="animate-rise mt-8 border-t border-line-subtle pt-6"
        style={{ animationDelay: '260ms' }}
      >
        <p className="text-body text-content-secondary">이미 계정이 있으신가요?</p>
        <Link
          href="/login"
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm text-body font-medium text-content-accent underline-offset-4 transition-colors duration-fast hover:underline"
        >
          로그인으로 돌아가기
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * 단계 표시.
 *
 * 번호를 붙인 이유는 장식이 아니라 이 두 칸이 실제로 순서이기 때문이다.
 * 앞 단계를 건너뛰고 뒤로 갈 수 없다.
 */
function StepRail({ current }: { current: number }) {
  return (
    <ol
      className="animate-rise mt-6 flex items-stretch gap-2"
      style={{ animationDelay: '90ms' }}
    >
      {STEPS.map((step, i) => {
        const state = i === current ? 'current' : i < current ? 'done' : 'upcoming';
        return (
          <li key={step.key} className="flex-1">
            <div
              className={
                state === 'upcoming'
                  ? 'h-0.5 rounded-full bg-line-subtle'
                  : 'h-0.5 rounded-full bg-accent'
              }
            />
            <p className="mt-2 flex items-baseline gap-1.5">
              <span
                className={
                  state === 'upcoming'
                    ? 'eyebrow text-content-tertiary'
                    : 'eyebrow text-content-accent'
                }
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={
                  state === 'current'
                    ? 'text-label font-medium text-content-primary'
                    : 'text-label text-content-tertiary'
                }
              >
                {step.label}
              </span>
              {state === 'current' && <span className="sr-only">(현재 단계)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------
// 1단계 : 회사 확인
// ---------------------------------------------------------------------
function CompanyStep({
  defaults,
  onDone,
}: {
  defaults: SignupStep1Input | null;
  onDone: (values: SignupStep1Input, tenant: TenantSummary) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<SignupStep1Input>({
    resolver: zodResolver(signupStep1Schema),
    defaultValues: defaults ?? { tenantCode: '', email: '' },
    mode: 'onBlur',
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const tenant = await apiFetch<TenantSummary>('/auth/tenant', {
        method: 'POST',
        body: { tenantCode: values.tenantCode },
      });
      onDone(values, tenant);
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;
      setError(authErrorMessage(err.code, err.payload.message));
      setFocus('tenantCode');
    }
  });

  const tenantCodeField = register('tenantCode');

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && (
        <div className="mt-6">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div
        className="animate-rise mt-7 space-y-5"
        style={{ animationDelay: '140ms' }}
      >
        <TextField
          label="회사 코드"
          hint="사내 시스템 담당자가 알려준 코드입니다."
          placeholder="예: NTMS"
          autoComplete="organization"
          autoFocus
          spellCheck={false}
          className="uppercase tracking-[0.08em]"
          required
          error={errors.tenantCode?.message}
          {...tenantCodeField}
          onChange={(e) => {
            e.target.value = e.target.value.toUpperCase();
            void tenantCodeField.onChange(e);
          }}
        />

        <TextField
          label="업무 이메일"
          hint="승인 결과를 이 주소로 보냅니다."
          placeholder="name@company.co.kr"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          required
          error={errors.email?.message}
          {...register('email')}
        />
      </div>

      <div className="animate-rise mt-8" style={{ animationDelay: '190ms' }}>
        <Button
          type="submit"
          size="lg"
          block
          loading={isSubmitting}
          loadingLabel="회사를 확인하는 중"
          trailingIcon={<ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />}
        >
          다음
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// 2단계 : 담당자 정보
// ---------------------------------------------------------------------
function ProfileStep({
  tenant,
  step1,
  onBack,
  onDone,
}: {
  tenant: TenantSummary;
  step1: SignupStep1Input;
  onBack: () => void;
  onDone: (result: SignupResult) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError: setFieldError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<SignupStep2Input>({
    resolver: zodResolver(signupStep2Schema),
    defaultValues: {
      userName: '',
      deptName: '',
      mobile: '',
      loginId: '',
      password: '',
      passwordConfirm: '',
      agreeMarketing: false,
    },
    mode: 'onBlur',
  });

  const password = watch('password') ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setError(null);

    if (values.password !== values.passwordConfirm) {
      setFieldError('passwordConfirm', { message: '비밀번호가 서로 다릅니다' });
      setFocus('passwordConfirm');
      return;
    }
    if (values.password.toLowerCase().includes(values.loginId.toLowerCase())) {
      setFieldError('password', { message: '비밀번호에 아이디를 포함할 수 없습니다' });
      setFocus('password');
      return;
    }

    try {
      const result = await apiFetch<SignupResult>('/auth/signup', {
        method: 'POST',
        body: { ...step1, ...values },
      });
      onDone(result);
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;

      // 서버가 필드별로 짚어 주면 그 칸에 붙이고 커서를 보낸다
      const fields = err.fields;
      if (fields) {
        let focused = false;
        for (const [name, messages] of Object.entries(fields)) {
          if (name in values && messages[0]) {
            setFieldError(name as keyof SignupStep2Input, { message: messages[0] });
            if (!focused) {
              setFocus(name as keyof SignupStep2Input);
              focused = true;
            }
          }
        }
        if (focused) return;
      }

      setError(authErrorMessage(err.code, err.payload.message));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <div
        className="animate-rise mt-6 flex items-center gap-2.5 rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3"
        style={{ animationDelay: '130ms' }}
      >
        <Building2
          size={18}
          strokeWidth={1.75}
          aria-hidden="true"
          className="shrink-0 text-content-accent"
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow-ko text-content-tertiary">신청 대상</p>
          <p className="truncate text-body font-medium text-content-primary">
            {tenant.tenantName}
            <span className="tabular ml-2 text-caption font-normal text-content-tertiary">
              {tenant.tenantCode}
            </span>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          변경
        </Button>
      </div>

      {error && (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div
        className="animate-rise mt-6 space-y-5"
        style={{ animationDelay: '170ms' }}
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextField
            label="이름"
            placeholder="홍길동"
            autoComplete="name"
            autoFocus
            required
            error={errors.userName?.message}
            {...register('userName')}
          />
          <TextField
            label="부서"
            placeholder="수도권물류팀"
            autoComplete="organization-title"
            error={errors.deptName?.message}
            {...register('deptName')}
          />
        </div>

        <TextField
          label="휴대폰"
          hint="배차 알림과 본인 확인에 사용합니다."
          placeholder="010-0000-0000"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          error={errors.mobile?.message}
          {...register('mobile')}
        />

        <TextField
          label="아이디"
          hint="영문 소문자로 시작하고 4자 이상. 승인 후에는 바꿀 수 없습니다."
          placeholder="hong.gd"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          required
          error={errors.loginId?.message}
          {...register('loginId')}
        />

        <PasswordField
          label="비밀번호"
          hint="10자 이상, 영문 · 숫자 · 특수문자 중 3종 이상."
          autoComplete="new-password"
          showStrength
          strengthValue={password}
          required
          error={errors.password?.message}
          {...register('password')}
        />

        <PasswordField
          label="비밀번호 확인"
          autoComplete="new-password"
          required
          error={errors.passwordConfirm?.message}
          {...register('passwordConfirm')}
        />
      </div>

      <fieldset
        className="animate-rise mt-7 space-y-1"
        style={{ animationDelay: '210ms' }}
      >
        <legend className="text-label font-medium text-content-secondary">
          약관 동의
        </legend>
        <div className="pt-1.5">
          <Checkbox
            label={
              <>
                <span className="text-status-danger">[필수]</span> 이용약관에 동의합니다
              </>
            }
            error={errors.agreeTerms?.message}
            {...register('agreeTerms')}
          />
          <Checkbox
            label={
              <>
                <span className="text-status-danger">[필수]</span> 개인정보 수집·이용에
                동의합니다
              </>
            }
            description="이름 · 이메일 · 휴대폰 · 소속을 계정 관리와 배차 연락에 사용합니다."
            error={errors.agreePrivacy?.message}
            {...register('agreePrivacy')}
          />
          <Checkbox
            label="[선택] 서비스 소식 수신에 동의합니다"
            {...register('agreeMarketing')}
          />
        </div>
      </fieldset>

      <div
        className="animate-rise mt-8 flex gap-3"
        style={{ animationDelay: '250ms' }}
      >
        <Button
          variant="secondary"
          size="lg"
          onClick={onBack}
          leadingIcon={<ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />}
        >
          이전
        </Button>
        <Button
          type="submit"
          size="lg"
          block
          loading={isSubmitting}
          loadingLabel="신청을 보내는 중"
        >
          신청하기
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// 완료
// ---------------------------------------------------------------------
function SubmittedNotice({ result }: { result: SignupResult }) {
  return (
    <div className="animate-rise">
      <CheckCircle2
        size={32}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-status-success"
      />
      <h1 className="mt-4 text-title font-semibold text-content-primary">
        신청이 접수되었습니다
      </h1>
      <p className="mt-2 text-body text-content-secondary">
        {result.tenantName} 관리자가 확인한 뒤 승인합니다. 결과는{' '}
        <span className="font-medium text-content-primary">{result.email}</span> 로
        보내드립니다.
      </p>

      <dl className="mt-6 divide-y divide-line-subtle rounded-md border border-line-subtle">
        <Row label="회사">{result.tenantName}</Row>
        <Row label="아이디">
          <span className="tabular">{result.loginId}</span>
        </Row>
        <Row label="상태">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-status-warning"
            />
            승인 대기
          </span>
        </Row>
      </dl>

      <p className="mt-6 text-caption text-content-tertiary">
        승인 전에는 로그인할 수 없습니다. 급한 건이면 사내 시스템 담당자에게 직접
        요청하세요.
      </p>

      <div className="mt-7">
        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-action px-5 text-lead font-medium text-action-text transition-colors duration-fast ease-out hover:bg-action-hover active:bg-action-active"
        >
          로그인 화면으로
        </Link>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 px-3.5 py-2.5">
      <dt className="w-20 shrink-0 text-label text-content-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 text-body text-content-primary">{children}</dd>
    </div>
  );
}
