'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * 기준정보를 고치는 서랍.
 *
 * 폼을 새 페이지가 아니라 오른쪽에서 밀려 나오는 판으로 둔 이유가 둘 있다.
 *
 * 1. **목록을 놓치지 않는다.** 기준정보를 여는 일은 대개 한 건 고치고 끝나지
 *    않는다 — "만료 임박 8건" 을 보고 들어와 여덟 대를 차례로 손본다.
 *    페이지가 통째로 바뀌면 돌아올 때마다 몇 번째 줄이었는지 다시 찾는다.
 *
 * 2. **고친 결과가 바로 옆에서 확인된다.** 저장하면 뒤에 깔린 요약 숫자가
 *    줄어드는 것이 보인다. 일이 끝났다는 신호가 화면 안에서 닫힌다.
 *
 * 폭은 자원마다 다르다. 권역은 네 칸이면 끝나지만 거점은 스무 칸이 넘는다.
 * 좁은 폼에 넓은 판을 쓰면 오른쪽이 텅 비고, 넓은 폼에 좁은 판을 쓰면
 * 두 칸짜리 줄을 한 칸으로 접어야 한다.
 */
export function MasterFormDrawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  submitting = false,
  error,
  onSubmit,
  submitLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: 'sm' | 'md' | 'lg';
  submitting?: boolean;
  /** 필드에 매달 수 없는 오류 (코드 중복 · 네트워크 …) */
  error?: string | null;
  onSubmit: () => void;
  submitLabel: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /** 서랍을 열기 직전에 초점이 있던 곳. 닫을 때 그리로 돌려준다 */
  const openerRef = useRef<HTMLElement | null>(null);

  // 열릴 때 첫 칸으로 초점을 옮긴다. 서랍을 열고 마우스를 다시 잡게 하면
  // 여러 건을 이어서 고칠 때 손이 계속 오간다.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea',
      );
      first?.focus();
    }, 120);
    return () => {
      window.clearTimeout(timer);
      // 닫힌 뒤 초점이 문서 처음으로 튀면, 키보드로 여러 줄을 고치던 사람은
      // 매번 표까지 Tab 으로 되짚어 내려와야 한다.
      openerRef.current?.focus?.();
    };
  }, [open]);

  // Esc 로 닫고, Tab 은 서랍 안에 가둔다.
  //
  // aria-modal 은 낭독기에게 "뒤쪽은 없는 셈 치라" 고 알릴 뿐, 실제 초점까지
  // 막지는 못한다. 가두지 않으면 Tab 이 서랍을 빠져나가 뒤에 깔린 목록의
  // 단추들을 훑는다 — 화면에는 보이지도 않는 것들이다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;

      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  // 뒤에 깔린 목록이 같이 스크롤되면 어느 쪽을 움직이는지 알 수 없다
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="닫기"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex h-full w-full flex-col bg-surface-card shadow-2xl',
          'motion-safe:animate-[ntms-drawer-in_180ms_ease-out]',
          width === 'sm' && 'max-w-[26rem]',
          width === 'md' && 'max-w-[34rem]',
          width === 'lg' && 'max-w-[48rem]',
        )}
      >
        <header className="flex items-start gap-3 border-b border-line-subtle px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lead font-medium text-content-primary">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-caption text-content-tertiary">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="닫기"
            className="-mr-2 -mt-1 rounded-md p-2 text-content-tertiary transition-colors hover:bg-surface-sunken hover:text-content-primary disabled:opacity-40"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        {/*
          noValidate — 검증은 zod 한 곳에서만 한다.
          빼면 브라우저의 기본 검사가 먼저 걸려 제출 자체가 막히고, 우리
          오류 문구는 붙을 기회조차 없다. 게다가 브라우저 말풍선은 한 번에
          한 칸씩만, 필드에서 떨어진 자리에 뜬다 — 긴 폼에서 어느 칸이
          문제인지 찾는 데 가장 나쁜 방식이다.
          required 속성 자체는 남겨 둔다. 낭독기가 "필수" 를 읽는 근거다.
        */}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {error && (
              <Alert tone="danger" className="mb-5">
                {error}
              </Alert>
            )}
            {children}
          </div>

          {/*
            저장 단추는 아래에 고정한다. 긴 폼에서 맨 아래까지 굴려 내려가야
            저장할 수 있으면, 위쪽 칸 하나만 고친 사람도 끝까지 내려가야 한다.
          */}
          <footer className="flex items-center justify-end gap-2 border-t border-line-subtle bg-surface-sunken/50 px-6 py-3.5">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" loading={submitting} loadingLabel="저장하는 중">
              {submitLabel}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/**
 * 폼 안의 묶음.
 *
 * 스무 칸짜리 폼을 한 줄로 늘어놓으면 어디까지가 한 덩어리인지 알 수 없다.
 * 제목을 달아 "이 부분은 보험", "이 부분은 운영시간" 으로 끊는다.
 */
export function FormSection({
  title,
  description,
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2;
}) {
  return (
    /*
      묶음 제목은 그 안의 필드 라벨보다 강해야 한다. eyebrow-ko(12px)로 두면
      라벨(13px)보다 작아져 위계가 뒤집힌다 — "보험" 이 "보험사" 보다 옅게
      보이는 상태가 된다. 실선으로 묶음의 시작을 한 번 더 못박는다.
    */
    <section className="mt-6 border-t border-line-subtle pt-6 first:mt-0 first:border-0 first:pt-0">
      <div className="mb-3.5">
        <h3 className="text-label font-semibold text-content-primary">{title}</h3>
        {description && (
          <p className="mt-1 text-caption text-content-tertiary">{description}</p>
        )}
      </div>
      <div className={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2')}>{children}</div>
    </section>
  );
}

/** 두 칸짜리 줄에서 한 줄을 통째로 쓰는 칸 (주소 · 비고 …) */
export function FormFull({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}
