'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  EXECUTION_STATUS_LABEL,
  type ExecutionLookupPage,
  type ExecutionTrack,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { CascadeVerdict, DelayCascade } from '@/components/execution/delay-cascade';
import { VehicleStrip } from '@/components/execution/execution-rail';
import { NaverMap, type MapLine, type MapMarker } from '@/components/map/naver-map';
import { EmptyState, Panel, Skeleton } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 실시간 추적.
 *
 * ## 관제와 무엇이 다른가
 *
 * 관제는 **오늘 전체**를 본다. 여기는 **한 통의 전화**에 답한다 — "우리
 * 물건 어디쯤 왔나요". 그때 담당자 손에 있는 것은 오더번호 하나이고, 그
 * 오더가 몇 번 트립에 실렸는지도 모른다. 그래서 날짜를 묻지 않고, 오더 ·
 * 트립 · 차량 어느 번호로든 같은 칸에서 찾는다.
 *
 * 화주는 날짜를 모른다. 묻는 쪽이 날짜를 알아야 답을 얻는 검색은 검색이
 * 아니다.
 */
export default function TrackingPage() {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const lookup = useApiQuery<ExecutionLookupPage>(
    ['execution', 'lookup', q],
    `/execution/lookup?q=${encodeURIComponent(q)}`,
    { enabled: q.trim().length >= 2 },
  );
  const rows = lookup.data?.rows ?? [];

  // 결과가 하나면 곧바로 편다. 한 건뿐인데 한 번 더 누르게 하지 않는다.
  useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!rows.some((r) => r.executionId === selectedId)) {
      setSelectedId(rows[0]!.executionId);
    }
  }, [rows, selectedId]);

  const track = useApiQuery<ExecutionTrack>(
    ['execution', 'track', selectedId],
    `/execution/${selectedId}/track`,
    { enabled: selectedId !== null, refetchInterval: 30_000 },
  );

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="실시간 추적"
        description="오더번호 · 트립번호 · 차량번호 중 아는 것 하나로 찾습니다."
        actions={
          selectedId && (
            <Button
              variant="secondary"
              onClick={() => void track.refetch()}
              loading={track.isFetching}
              loadingLabel="새로 불러오는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              새로고침
            </Button>
          )
        }
      />

      <div className="space-y-5 px-6 py-6">
        <form
          className="flex flex-wrap items-center gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setQ(term.trim());
          }}
        >
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
            />
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="TO2026082000891 · TR20260820002 · 53바 3384"
              aria-label="오더번호 · 트립번호 · 차량번호"
              className="field-text tabular h-10 w-full rounded-md border border-line-field bg-surface-field pl-9 pr-3 text-content-primary placeholder:text-content-tertiary"
            />
          </div>
          <Button type="submit" loading={lookup.isFetching} loadingLabel="찾는 중">
            찾기
          </Button>
        </form>

        {q.trim().length < 2 && (
          <Panel>
            <EmptyState
              icon={<Search size={26} strokeWidth={1.5} />}
              title="번호를 입력하면 그 화물의 지금 위치가 나옵니다"
              description="화주가 부르는 오더번호, 기사가 부르는 차량번호 어느 쪽이든 됩니다. 두 글자부터 찾습니다."
            />
          </Panel>
        )}

        {q.trim().length >= 2 && rows.length === 0 && !lookup.isFetching && (
          <Panel>
            <EmptyState
              icon={<Search size={26} strokeWidth={1.5} />}
              title={`'${q}' 로 찾은 운송이 없습니다`}
              description="번호 일부만 넣어도 찾습니다. 아직 출발하지 않은 오더는 오더 관리에서 확인하세요."
            />
          </Panel>
        )}

        {rows.length > 0 && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <div className="space-y-5">
              {rows.length > 1 && (
                <Panel title="찾은 운송" subtitle={`${rows.length}건 · 최근 순`}>
                  <ul className="divide-y divide-line-subtle">
                    {rows.map((r) => (
                      <li key={r.executionId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.executionId)}
                          aria-current={selectedId === r.executionId ? 'true' : undefined}
                          className={cn(
                            'flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors duration-fast',
                            'hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
                            selectedId === r.executionId && 'bg-surface-sunken',
                          )}
                        >
                          <span className="tabular text-label font-medium text-content-primary">
                            {r.vehicleNo}
                          </span>
                          <span className="tabular text-caption text-content-tertiary">
                            {r.tripNo}
                          </span>
                          <span className="text-caption text-content-secondary">
                            {r.carrierName}
                          </span>
                          {r.matchedOrderNo && (
                            <span className="tabular text-caption text-content-accent">
                              {r.matchedOrderNo}
                            </span>
                          )}
                          <span className="tabular ml-auto text-caption text-content-tertiary">
                            {r.executionDate} · {EXECUTION_STATUS_LABEL[r.status] ?? r.status}
                            {r.delayMinutes > 0 && (
                              <span className="ml-1.5 text-status-warning">
                                {r.delayMinutes}분 지연
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel
                title={track.data ? `${track.data.vehicleNo} 위치` : '위치'}
                subtitle="굵은 선이 계획 경로, 가는 선이 단말이 보낸 자취입니다"
                bodyClassName="min-w-0"
              >
                {track.data ? (
                  <>
                    <VehicleStrip
                      vehicleNo={track.data.vehicleNo}
                      carrierName={track.data.carrierName}
                      driverName={track.data.driverName}
                      driverMobile={track.data.driverMobile}
                      lastLocationAt={track.data.lastLocationAt}
                      lastSpeedKmh={track.data.lastSpeedKmh}
                      actualDistanceKm={track.data.actualDistanceKm}
                      plannedDistanceKm={track.data.plannedDistanceKm}
                    />
                    <div className="p-4">
                      <NaverMap
                        markers={markersOf(track.data)}
                        lines={linesOf(track.data)}
                        height={420}
                        fallbackHint="서버 .env 에 NAVER_MAP_CLIENT_ID 를 넣으면 여기에 차량 위치가 나옵니다."
                      />
                    </div>
                    <OrderTable track={track.data} />
                  </>
                ) : (
                  <div className="p-4">
                    <Skeleton className="h-[26rem] w-full" />
                  </div>
                )}
              </Panel>
            </div>

            <Panel title="지연 전파" subtitle="계획선에서 오른쪽으로 벗어난 길이가 지연입니다">
              {track.data ? (
                <>
                  <CascadeVerdict cascade={track.data.cascade} />
                  <DelayCascade cascade={track.data.cascade} />
                </>
              ) : (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>
    </>
  );
}

/** 실린 오더. 화주가 물어본 건이 이 중 하나다 */
function OrderTable({ track }: { track: ExecutionTrack }) {
  if (track.orders.length === 0) return null;
  return (
    <div className="border-t border-line-subtle">
      <p className="eyebrow-ko px-4 pt-3 text-content-tertiary">
        실린 오더 {track.orders.length}건
      </p>
      <ul className="px-4 pb-3 pt-1.5">
        {track.orders.map((o) => (
          <li
            key={o.orderId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line-subtle py-1.5 text-label last:border-0"
          >
            <span className="tabular text-content-primary">{o.orderNo}</span>
            <span className="text-content-secondary">{o.shipperName}</span>
            <span className="text-content-tertiary">→ {o.toLocationName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function markersOf(track: ExecutionTrack): MapMarker[] {
  return [
    ...track.stops
      .filter((s) => s.latitude !== null && s.longitude !== null)
      .map((s) => ({
        id: `stop-${s.stopSeq}`,
        latitude: s.latitude!,
        longitude: s.longitude!,
        label: String(s.stopSeq),
        title: s.locationName,
        tone: (s.stopType === 'PICKUP' ? 'pickup' : 'delivery') as MapMarker['tone'],
      })),
    ...(track.lastLatitude !== null && track.lastLongitude !== null
      ? [
          {
            id: 'vehicle',
            latitude: track.lastLatitude,
            longitude: track.lastLongitude,
            label: '▲',
            title: `${track.vehicleNo} 현재 위치`,
            tone: 'vehicle' as const,
          },
        ]
      : []),
  ];
}

function linesOf(track: ExecutionTrack): MapLine[] {
  const stopLine: [number, number][] = track.stops
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .map((s) => [s.longitude!, s.latitude!]);

  return [
    track.route.length > 1
      ? { path: track.route, color: '#0f766e', weight: 5, opacity: 0.55 }
      : { path: stopLine, color: '#0f766e', weight: 3, opacity: 0.4, dashed: true },
    { path: track.trail, color: '#b45309', weight: 2, opacity: 0.9 },
  ];
}
