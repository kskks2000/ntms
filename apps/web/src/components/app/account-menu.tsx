'use client';

import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@ntms/shared';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';

/**
 * 계정 메뉴.
 *
 * Radix 없이 손으로 짠 이유는 인증 화면에서 쓰는 부품이 아직 이것 하나뿐이라
 * 의존성을 늘릴 근거가 약해서다. 대신 손으로 짠 만큼 지켜야 할 것을 지킨다 —
 * Escape 로 닫히고, 바깥을 누르면 닫히고, 포커스가 트리거로 돌아온다.
 */
export function AccountMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { logout } = useAuth();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initial = user.userName.slice(0, 1);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex h-9 items-center gap-2 rounded-md pl-1 pr-2 transition-colors duration-fast',
          'hover:bg-surface-sunken',
          open && 'bg-surface-sunken',
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas-850 text-label font-medium text-canvas-50"
        >
          {initial}
        </span>
        <span className="hidden text-body text-content-primary sm:inline">
          {user.userName}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          aria-hidden="true"
          className={cn(
            'text-content-tertiary transition-transform duration-fast',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="계정"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 overflow-hidden rounded-lg border border-line-subtle bg-surface-card shadow-lg"
        >
          <div className="border-b border-line-subtle px-3.5 py-3">
            <p className="text-body font-medium text-content-primary">
              {user.userName}
            </p>
            <p className="tabular mt-0.5 text-caption text-content-tertiary">
              {user.loginId} · {user.tenantCode}
            </p>
            <p className="mt-2 text-caption text-content-secondary">
              {user.roles.join(' · ') || '지정된 역할 없음'}
            </p>
          </div>

          <div className="p-1">
            <Link
              href="/password/change"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-content-secondary transition-colors duration-fast hover:bg-surface-sunken hover:text-content-primary"
            >
              <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
              비밀번호 변경
            </Link>
          </div>

          {/*
            로그아웃은 나머지와 떼어 놓는다. 되돌리기 어려운 동작이 목록 한가운데
            섞여 있으면 옆 항목을 누르려다 손이 미끄러진다.
          */}
          <div className="border-t border-line-subtle p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout().then(() => router.replace('/login'));
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-status-danger transition-colors duration-fast hover:bg-status-danger-surface"
            >
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
              로그아웃
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
