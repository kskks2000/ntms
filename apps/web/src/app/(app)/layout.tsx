'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/app/app-shell';
import { useAuth } from '@/lib/auth-context';

/**
 * 업무 화면의 문지기.
 *
 * 서버 미들웨어로 막지 않는 이유는 액세스 토큰을 메모리에만 두기 때문이다.
 * 서버는 그 토큰을 볼 수 없다. 진짜 차단은 API 가 하고, 여기서는 갈 곳을
 * 정리해 준다 — 로그인하지 않았으면 로그인으로, 비밀번호를 바꿔야 하면
 * 변경 화면으로.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.mustChangePassword) {
      router.replace('/password/change');
    }
  }, [ready, user, router]);

  // 세션 복구가 끝나기 전에 화면을 그리면, 로그인한 사용자에게도 로그인
  // 화면이 한 번 번쩍인다.
  if (!ready || !user || user.mustChangePassword) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-page">
        <p className="eyebrow-ko text-content-tertiary" aria-live="polite">
          세션 확인 중
        </p>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
