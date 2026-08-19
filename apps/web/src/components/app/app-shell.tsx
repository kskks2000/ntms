'use client';

import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { findActiveTrail, type MenuNode } from '@ntms/shared';
import { NtmsMark } from '@/components/brand/ntms-mark';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { AccountMenu } from './account-menu';
import { MenuIcon } from './menu-icon';

/**
 * 앱 셸.
 *
 *   [ 레일 ][ 메뉴 패널 ][ 상단바 + 본문 ]
 *     76px     232px
 *
 * 레일은 인증 화면의 그것과 같은 자리 · 같은 폭이다. 로그인 화면에서 보던
 * 척추가 그대로 남고, 그 옆에 모듈의 하위 화면이 붙는 구조다.
 *
 * 두 단으로 나눈 것은 데이터 구조를 그대로 따른 것이다 —
 * 레일은 최상위 메뉴(모듈), 패널은 그 아래 화면. 메뉴 계층이 두 단계라
 * 내비게이션도 두 단이면 충분하다.
 */
const PANEL_STATE_KEY = 'ntms.navPanelOpen';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, menus } = useAuth();
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setPanelOpen(window.localStorage.getItem(PANEL_STATE_KEY) !== 'false');
  }, []);

  // 화면을 옮기면 모바일 서랍은 닫는다. 열어 둔 채 넘어가면
  // 도착한 화면이 서랍에 가려 보이지 않는다.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const togglePanel = () => {
    setPanelOpen((v) => {
      window.localStorage.setItem(PANEL_STATE_KEY, String(!v));
      return !v;
    });
  };

  const trail = findActiveTrail(menus, pathname);
  const activeTop = trail?.top ?? null;

  // 하위 화면이 없는 모듈(관제 현황)에는 패널을 띄우지 않는다.
  // 제목과 항목이 같은 이름으로 두 번 나오면 고장난 것처럼 보이고,
  // 그렇다고 빈 232px 을 남겨 두는 것도 낭비다. 본문이 그만큼 넓어진다.
  const panelItems: MenuNode[] = activeTop?.children ?? [];

  if (!user) return null;

  return (
    <div className="flex min-h-dvh">
      <NavRail menus={menus} activeCode={activeTop?.menuCode ?? null} />

      {panelOpen && panelItems.length > 0 && (
        <nav
          aria-label={`${activeTop?.menuName ?? ''} 하위 메뉴`}
          className="hidden w-[232px] shrink-0 flex-col border-r border-canvas-800 bg-canvas-850 lg:flex"
        >
          <p className="px-5 pb-3 pt-6 text-title-sm font-semibold text-canvas-50">
            {activeTop?.menuName}
          </p>
          <ul className="space-y-0.5 px-3 pb-4">
            {panelItems.map((item) => (
              <li key={item.menuId}>
                <PanelLink item={item} active={item.menuPath === pathname} />
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-surface-page">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle bg-surface-card px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="메뉴 열기"
            className="flex h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors duration-fast hover:bg-surface-sunken lg:hidden"
          >
            <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelOpen ? '메뉴 패널 접기' : '메뉴 패널 펼치기'}
            aria-pressed={panelOpen}
            className="hidden h-9 w-9 items-center justify-center rounded-md text-content-tertiary transition-colors duration-fast hover:bg-surface-sunken hover:text-content-primary lg:flex"
          >
            {panelOpen ? (
              <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>

          <Breadcrumb top={trail?.top ?? null} child={trail?.child ?? null} />

          <div className="ml-auto flex items-center gap-2">
            <AccountMenu user={user} />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>

      {drawerOpen && (
        <MobileDrawer
          menus={menus}
          pathname={pathname}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

/** 최상위 메뉴 = 모듈. 아이콘만 두지 않고 이름을 함께 둔다 */
function NavRail({
  menus,
  activeCode,
}: {
  menus: MenuNode[];
  activeCode: string | null;
}) {
  return (
    <nav
      aria-label="모듈"
      className="hidden w-[76px] shrink-0 flex-col items-center bg-canvas-900 py-4 lg:flex"
    >
      <Link
        href="/dashboard"
        aria-label="NTMS 홈"
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-md text-canvas-100 transition-colors duration-fast hover:bg-canvas-800"
      >
        <NtmsMark size={26} />
      </Link>

      <ul className="flex w-full flex-1 flex-col items-center gap-1 px-1.5">
        {menus.map((menu) => {
          const active = menu.menuCode === activeCode;
          const href = menu.menuPath ?? menu.children[0]?.menuPath ?? '/dashboard';
          return (
            <li key={menu.menuId} className="w-full">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md px-1 py-2 transition-colors duration-fast',
                  active
                    ? 'bg-canvas-800 text-canvas-50'
                    : 'text-canvas-300 hover:bg-canvas-850 hover:text-canvas-100',
                )}
              >
                <MenuIcon name={menu.iconName} size={20} />
                <span className="text-[11px] leading-tight tracking-[-0.01em]">
                  {menu.menuName}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* 인증 화면의 레일과 같은 눈금 · 같은 자리 */}
      <div className="mt-4 flex flex-col items-center gap-3">
        <span aria-hidden="true" className="flex flex-col items-center gap-1.5">
          <span className="h-px w-4 bg-canvas-700" />
          <span className="h-px w-2.5 bg-canvas-700" />
          <span className="h-px w-4 bg-canvas-700" />
        </span>
        <span className="tabular text-[10px] text-canvas-400">v0.1</span>
      </div>
    </nav>
  );
}

function PanelLink({ item, active }: { item: MenuNode; active: boolean }) {
  const content = (
    <span
      className={cn(
        'flex items-center rounded-md px-2.5 py-2 text-body transition-colors duration-fast',
        active
          ? 'bg-canvas-800 font-medium text-canvas-50'
          : 'text-canvas-300 hover:bg-canvas-800/60 hover:text-canvas-100',
      )}
    >
      {item.menuName}
    </span>
  );

  // 경로가 없는 메뉴는 그룹일 뿐이라 이동할 곳이 없다. 누를 수 있는 것처럼
  // 보이면 눌러 보고 아무 일도 일어나지 않는다.
  if (!item.menuPath) {
    return <span className="block cursor-default opacity-60">{content}</span>;
  }

  return (
    <Link href={item.menuPath} aria-current={active ? 'page' : undefined} className="block">
      {content}
    </Link>
  );
}

function Breadcrumb({
  top,
  child,
}: {
  top: MenuNode | null;
  child: MenuNode | null;
}) {
  if (!top) return null;
  return (
    <nav aria-label="현재 위치" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-body">
        <li className="shrink-0 text-content-tertiary">{top.menuName}</li>
        {child && (
          <>
            <li aria-hidden="true" className="shrink-0 text-content-tertiary">
              ›
            </li>
            <li className="truncate font-medium text-content-primary">
              {child.menuName}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

/** 1024px 아래: 레일과 패널을 하나의 서랍으로 합친다 */
function MobileDrawer({
  menus,
  pathname,
  onClose,
}: {
  menus: MenuNode[];
  pathname: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* 뒤를 충분히 덮어야 앞의 내용이 배경과 싸우지 않는다 */}
      <div
        className="absolute inset-0 bg-canvas-950/55"
        onClick={onClose}
        aria-hidden="true"
      />

      <nav
        aria-label="전체 메뉴"
        className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-canvas-900"
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-canvas-800 px-4">
          <NtmsMark size={22} className="text-canvas-100" />
          <span className="text-title-sm font-semibold text-canvas-50">NTMS</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="메뉴 닫기"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-canvas-300 transition-colors duration-fast hover:bg-canvas-800"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <ul className="flex-1 space-y-4 px-3 py-4">
          {menus.map((menu) => (
            <li key={menu.menuId}>
              <p className="flex items-center gap-2 px-2.5 pb-1.5 text-label font-medium text-canvas-300">
                <MenuIcon name={menu.iconName} size={16} />
                {menu.menuName}
              </p>
              <ul className="space-y-0.5">
                {/*
                  서랍에서는 하위가 없는 모듈도 한 줄로 남긴다. 여기서는 모듈
                  이름이 제목이자 유일한 이동 수단이라, 빼면 갈 방법이 없다.
                */}
                {(menu.children.length > 0 ? menu.children : [menu]).map((item) => (
                  <li key={item.menuId}>
                    <PanelLink item={item} active={item.menuPath === pathname} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
