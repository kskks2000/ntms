import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignupForm } from '@/components/auth/signup-form';

export const metadata: Metadata = { title: '계정 신청' };

export default function SignupPage() {
  return (
    <AuthShell
      headline={
        <>
          맡은 일에 필요한
          <br />
          권한만 받습니다.
        </>
      }
      lead="계정은 사내 관리자가 승인한 뒤 발급됩니다. 배차 · 정산 · 조회처럼 담당 업무에 맞는 역할이 함께 지정됩니다."
    >
      <SignupForm />
    </AuthShell>
  );
}
