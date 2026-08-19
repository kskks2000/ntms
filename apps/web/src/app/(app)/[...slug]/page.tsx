'use client';

import { ArrowLeft, Hammer } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { findMenuByPath } from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { useAuth } from '@/lib/auth-context';

/**
 * 아직 만들지 않은 화면.
 *
 * 메뉴는 DB(`ntms.menu`)에서 오므로 화면보다 먼저 생긴다. 그 사이를 404 로
 * 두면 내비게이션이 온통 죽은 링크가 되고, 반대로 그럴듯한 빈 화면을 두면
 * "고장났나?" 를 의심하게 된다. 메뉴에 있는 경로면 준비 중이라고 분명히
 * 말하고, 없는 경로면 잘못 들어온 것이라고 말한다.
 *
 * 실제 화면이 생기면 그 라우트가 이 catch-all 보다 우선한다. 여기를 지울
 * 필요도, 목록을 관리할 필요도 없다.
 */
export default function PlaceholderPage() {
  const pathname = usePathname();
  const { menus } = useAuth();
  const menu = findMenuByPath(menus, pathname);

  if (!menu) {
    return (
      <>
        <PageHeader
          title="페이지를 찾을 수 없습니다"
          description="주소가 바뀌었거나, 접근할 수 있는 메뉴가 아닙니다."
        />
        <div className="px-6 py-6">
          <BackLink />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={menu.menuName}
        description="이 화면은 아직 준비 중입니다."
      />

      <div className="px-6 py-10">
        <div className="mx-auto max-w-md text-center">
          <Hammer
            size={28}
            strokeWidth={1.5}
            aria-hidden="true"
            className="mx-auto text-content-tertiary"
          />
          <p className="mt-4 text-body text-content-secondary">
            메뉴와 권한은 이미 열려 있고, 화면만 아직 붙지 않았습니다.
            준비되면 이 자리에 그대로 나타납니다.
          </p>
          <p className="tabular mt-3 text-caption text-content-tertiary">
            {menu.menuCode} · {pathname}
          </p>
          <div className="mt-6">
            <BackLink />
          </div>
        </div>
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="inline-flex items-center gap-1.5 rounded-sm text-body font-medium text-content-accent underline-offset-4 transition-colors duration-fast hover:underline"
    >
      <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      관제 현황으로
    </Link>
  );
}
