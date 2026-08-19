import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: '비밀번호 재설정' };

/**
 * 아직 자동 재설정이 없다. 그래서 "메일을 보냈습니다" 라고 하지 않고
 * 실제로 밟아야 하는 절차를 적는다. 막다른 길에 안내를 두는 것이
 * 없는 기능을 있는 척하는 것보다 낫다.
 */
export default function PasswordResetPage() {
  return (
    <AuthShell
      headline={
        <>
          계정은 사람에게,
          <br />
          권한은 역할에.
        </>
      }
      lead="비밀번호 재설정은 본인 확인을 거쳐야 합니다. 지금은 사내 관리자가 직접 처리합니다."
    >
      <div>
        <h1 className="text-title font-semibold text-content-primary">
          비밀번호 재설정
        </h1>
        <p className="mt-1.5 text-body text-content-secondary">
          사내 시스템 담당자에게 요청하면 임시 비밀번호를 발급받습니다.
        </p>

        <Alert tone="info" className="mt-6">
          메일로 직접 재설정하는 기능은 아직 열리지 않았습니다. 승인된 관리자만
          비밀번호를 초기화할 수 있도록 하기 위해서입니다.
        </Alert>

        <ol className="mt-6 space-y-4">
          <Step n={1} title="담당자에게 요청">
            사내 시스템 담당자에게 회사 코드와 아이디를 알려 초기화를 요청합니다.
          </Step>
          <Step n={2} title="임시 비밀번호 수신">
            등록된 업무 이메일로 임시 비밀번호가 전달됩니다.
          </Step>
          <Step n={3} title="첫 로그인에서 변경">
            임시 비밀번호로 로그인하면 곧바로 새 비밀번호를 지정하게 됩니다.
          </Step>
        </ol>

        <div className="mt-8 border-t border-line-subtle pt-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-sm text-body font-medium text-content-accent underline-offset-4 transition-colors duration-fast hover:underline"
          >
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

/**
 * 번호를 붙인 이유는 이 세 칸이 실제 순서이기 때문이다.
 * 순서가 없는 목록에는 번호를 붙이지 않는다.
 */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: string;
}) {
  return (
    <li className="flex gap-3.5">
      <span className="eyebrow mt-1 shrink-0 text-content-tertiary">
        {String(n).padStart(2, '0')}
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-content-primary">
          {title}
        </span>
        <span className="mt-0.5 block text-body text-content-secondary">
          {children}
        </span>
      </span>
    </li>
  );
}
