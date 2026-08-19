'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { useAuth } from '@/lib/auth-context';

/**
 * 비밀번호 변경은 자격증명을 다루는 일이라 업무 셸이 아니라 인증 셸에 둔다.
 * 강제로 넘어온 사람은 아직 앱 안으로 들어온 것이 아니고,
 * 자발적으로 들어온 사람에게도 한 가지 일에만 집중하는 화면이 낫다.
 */
export default function PasswordChangePage() {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-page">
        <p className="eyebrow-ko text-content-tertiary" aria-live="polite">
          세션 확인 중
        </p>
      </div>
    );
  }

  return (
    <AuthShell
      headline={
        <>
          계정 하나에
          <br />
          사람 한 명.
        </>
      }
      lead="비밀번호는 다른 사람과 나눠 쓰지 않습니다. 접속 기록이 누가 무엇을 했는지의 근거가 되기 때문입니다."
    >
      <ChangePasswordForm />
    </AuthShell>
  );
}
