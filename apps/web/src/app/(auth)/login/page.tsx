import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: '로그인' };

export default function LoginPage() {
  return (
    <AuthShell
      headline={
        <>
          계획과 실행의 차이를,
          <br />
          남깁니다.
        </>
      }
      lead="오더 · 편성 · 배차 · 실행 · 실적 · 정산을 하나의 시간 축 위에 놓습니다. 무엇이 어긋났는지 알아야 다음 배차가 나아집니다."
    >
      <LoginForm />
    </AuthShell>
  );
}
