'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { PageHeader } from '@/components/app/page-header';
import { RateDetailEditor } from '@/components/master/rate-detail-editor';

/**
 * 요율 상세 — 운임표 한 건의 금액 규칙.
 *
 * 목록의 "요율 상세" 칸을 누르면 여기로 온다. 화면을 따로 둔 이유는
 * 편집기 주석에 적어 두었다 — 요약하면, 이건 표를 짜는 일이고 서랍에는
 * 표가 들어가지 않는다.
 */
export default function TariffRatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <>
      <PageHeader
        eyebrow="Master"
        title="요율 상세"
        description="이 표의 줄 하나가 한 건의 운임을 만듭니다. 줄이 없으면 금액이 계산되지 않습니다."
        actions={
          // Button 은 asChild 를 받지 않는다. 링크는 링크로 그리되 생김새만 맞춘다.
          <Link
            href="/master/tariffs"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line-field bg-surface-card px-4 text-body font-medium text-content-primary transition-colors hover:bg-surface-sunken"
          >
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            단가 목록
          </Link>
        }
      />

      <div className="px-6 py-6">
        <RateDetailEditor tariffId={id} />
      </div>
    </>
  );
}
