'use client';

import { ArrowLeftRight, Route } from 'lucide-react';
import type { RouteListItem } from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import type { Column } from '@/components/tms/data-table';
import { cn } from '@/lib/cn';

/**
 * 라우트 (구간거리).
 *
 * 두 거점 사이의 거리·소요시간·통행료다. 이 값이 틀리면 운임과 도착예정이
 * 통째로 틀어지는데, 틀린 것을 눈으로 알아채기가 어렵다. 그래서 **평균속도**
 * 를 계산해 함께 보인다 — 시속 20km 이하나 110km 이상이면 거리나 시간 둘 중
 * 하나가 잘못 들어간 것이다.
 *
 * 편도만 등록된 구간도 표시한다. 왕복이 없으면 돌아오는 트립의 거리가
 * 잡히지 않는다.
 */

/** 고속 위주 간선의 상식 범위. 밖으로 나가면 데이터가 의심스럽다 */
const SPEED_MIN = 20;
/** 값을 어디서 받아왔는지. 수기로 고친 구간은 사람이 책임진 값이다 */
const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '수기 입력',
  MAP_API: '지도 API',
  ACTUAL: '실적 반영',
};
const SPEED_MAX = 110;

const columns: Column<RouteListItem>[] = [
  {
    key: 'lane',
    header: '구간',
    render: (r) => (
      <span className="flex items-center gap-1.5">
        <span className="truncate">{r.fromName}</span>
        <span aria-hidden="true" className="shrink-0 text-content-tertiary">
          →
        </span>
        <span className="truncate">{r.toName}</span>
      </span>
    ),
  },
  {
    key: 'reverse',
    header: '왕복',
    align: 'center',
    render: (r) =>
      r.hasReverse ? (
        <ArrowLeftRight
          size={15}
          strokeWidth={1.75}
          aria-label="왕복 등록됨"
          className="inline text-content-secondary"
        />
      ) : (
        <span className="text-caption text-status-warning">편도</span>
      ),
  },
  {
    key: 'distance',
    header: '거리',
    numeric: true,
    render: (r) => r.distanceKm.toLocaleString('ko-KR') + ' km',
  },
  {
    key: 'duration',
    header: '소요',
    numeric: true,
    render: (r) =>
      r.durationMinutes === null ? '—' : formatDuration(r.durationMinutes),
  },
  {
    key: 'speed',
    header: '평균속도',
    numeric: true,
    render: (r) => {
      if (r.avgSpeedKmh === null) return '—';
      const odd = r.avgSpeedKmh < SPEED_MIN || r.avgSpeedKmh > SPEED_MAX;
      return (
        <span
          className={cn(odd && 'font-medium text-status-warning')}
          title={odd ? '거리 또는 소요시간을 확인하세요' : undefined}
        >
          {r.avgSpeedKmh} km/h
        </span>
      );
    },
  },
  {
    key: 'toll',
    header: '통행료',
    numeric: true,
    render: (r) => (r.tollFee === null ? '—' : r.tollFee.toLocaleString('ko-KR')),
  },
  {
    key: 'source',
    header: '출처',
    render: (r) => (
      <span className="text-content-secondary">
        {r.source === null ? '—' : (SOURCE_LABEL[r.source] ?? r.source)}
      </span>
    ),
  },
  {
    key: 'verified',
    header: '최종 확인',
    render: (r) =>
      r.lastVerifiedAt ? (
        <span className="tabular text-content-secondary">
          {formatDate(r.lastVerifiedAt)}
        </span>
      ) : (
        <span className="text-content-tertiary">미확인</span>
      ),
  },
];

export default function RoutesPage() {
  return (
    <MasterPage<RouteListItem>
      eyebrow="Master"
      title="라우트"
      description="거점 사이의 거리·소요시간·통행료입니다. 운임과 도착예정이 이 값에서 나옵니다."
      endpoint="/master/routes"
      queryKey="master-routes"
      columns={columns}
      getRowKey={(r) => r.distanceId}
      searchPlaceholder="출발지 · 도착지"
      emptyIcon={<Route size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 구간이 없습니다"
      emptyDescription="구간을 등록하면 거리 기반 운임과 도착예정 시각을 계산할 수 있습니다."
      createLabel="구간 등록"
      extraStats={(d) => {
        if (!d) return null;
        const odd = d.items.filter(
          (r) =>
            r.avgSpeedKmh !== null &&
            (r.avgSpeedKmh < SPEED_MIN || r.avgSpeedKmh > SPEED_MAX),
        ).length;
        const totalKm = d.items.reduce((a, r) => a + r.distanceKm, 0);
        return (
          <>
            <div className="min-w-0 px-4 py-3.5">
              <p className="truncate text-caption text-content-tertiary">속도 이상</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span
                  className={cn(
                    'tabular text-[1.5rem] font-medium leading-none',
                    odd > 0 ? 'text-status-warning' : 'text-content-primary',
                  )}
                >
                  {odd}
                </span>
                <span className="text-caption text-content-tertiary">건</span>
              </p>
              <p className="mt-1 truncate text-caption text-content-tertiary">
                {SPEED_MIN}~{SPEED_MAX} km/h 밖
              </p>
            </div>
            <div className="min-w-0 px-4 py-3.5">
              <p className="truncate text-caption text-content-tertiary">이 쪽 총 거리</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span className="tabular text-[1.5rem] font-medium leading-none text-content-primary">
                  {Math.round(totalKm).toLocaleString('ko-KR')}
                </span>
                <span className="text-caption text-content-tertiary">km</span>
              </p>
            </div>
          </>
        );
      }}
    />
  );
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? h + '시간 ' + String(m).padStart(2, '0') + '분' : m + '분';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
