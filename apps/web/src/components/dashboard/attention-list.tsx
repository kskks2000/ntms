'use client';

import { CheckCircle2, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { AttentionItem } from '@ntms/shared';
import { EmptyState } from '@/components/tms/panels';
import { cn } from '@/lib/cn';

/**
 * 지금 손대야 할 일.
 *
 * 알림을 모아 보여주는 자리가 아니라 **일감 목록**이다. 그래서 한 줄마다
 * 무엇을(업무번호) · 무슨 일이(제목) · 얼마나 급한지(표식) · 어디로 가면
 * 되는지(링크)가 모두 들어 있다. 읽고 끝나는 줄은 만들지 않는다.
 *
 * 심각도는 색과 함께 왼쪽 띠의 두께로도 말한다. 색각 이상이 있는 사람에게도
 * 급한 줄이 먼저 보여야 한다.
 */
const SEVERITY = {
  critical: {
    bar: 'bg-status-danger',
    label: '긴급',
    labelClass: 'text-status-danger',
  },
  warning: {
    bar: 'bg-status-warning',
    label: '주의',
    labelClass: 'text-status-warning',
  },
  info: {
    bar: 'bg-content-tertiary/40',
    label: '확인',
    labelClass: 'text-content-tertiary',
  },
} as const;

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={26} strokeWidth={1.5} />}
        title="지금 손댈 일이 없습니다"
        description="지연 · 수락 대기 · 출발 임박 건이 모두 정리된 상태입니다."
      />
    );
  }

  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((item) => {
        const tone = SEVERITY[item.severity];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group flex items-stretch gap-3 transition-colors duration-fast hover:bg-surface-sunken"
            >
              <span
                aria-hidden="true"
                className={cn('w-[3px] shrink-0', tone.bar)}
              />
              <span className="min-w-0 flex-1 py-3 pr-3">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={cn('eyebrow-ko shrink-0', tone.labelClass)}>
                    {tone.label}
                  </span>
                  <span className="text-body font-medium text-content-primary">
                    {item.title}
                  </span>
                  <span className="tabular text-caption text-content-tertiary">
                    {item.ref}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-caption text-content-secondary">
                  {item.detail}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 pr-3 text-caption text-content-tertiary">
                {item.at && <RelativeTime iso={item.at} />}
                <ChevronRight
                  size={15}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="transition-transform duration-fast group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "12분 전 / 40분 뒤".
 *
 * 절대 시각만 적으면 급한지 아닌지를 사람이 매번 뺄셈해야 한다.
 * 정확한 시각은 title 로 남겨 둔다.
 */
function RelativeTime({ iso }: { iso: string }) {
  const target = new Date(iso);
  const diffMin = Math.round((target.getTime() - Date.now()) / 60_000);
  const abs = Math.abs(diffMin);

  const text =
    abs < 1
      ? '방금'
      : abs < 60
        ? `${abs}분 ${diffMin < 0 ? '전' : '뒤'}`
        : `${Math.round(abs / 60)}시간 ${diffMin < 0 ? '전' : '뒤'}`;

  return (
    <time dateTime={iso} title={target.toLocaleString('ko-KR')} className="tabular whitespace-nowrap">
      {text}
    </time>
  );
}
