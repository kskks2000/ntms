'use client';

import { AlertTriangle, MapPin, RefreshCw, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  EXCEPTION_SEVERITY_LABEL,
  EXCEPTION_TYPE_LABEL,
  type ControlBoard,
  type ExecutionCard,
  type ExecutionTrack,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { CascadeVerdict, DelayCascade } from '@/components/execution/delay-cascade';
import { ExecutionRail, VehicleStrip } from '@/components/execution/execution-rail';
import { NaverMap, type MapLine, type MapMarker } from '@/components/map/naver-map';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 실시간 관제.
 *
 * ## 지도를 주인공으로 두지 않는다
 *
 * 트래킹 화면은 대개 지도로 화면을 꽉 채운다. 그런데 지도가 답하는 질문은
 * "차가 어디 있나" 하나뿐이고, 관제 담당자가 정작 알아야 하는 것은 **이
 * 지연이 앞으로 어디까지 번지느냐**다. 그래서 지도는 위치를 확인하는 창으로
 * 가운데에 두고, 오른쪽에 지연 전파 축을 세운다.
 *
 * ## 세 칸이 각각 답하는 것
 *
 *   왼쪽   어느 건에 손이 필요한가 (마감 위험 순)
 *   가운데 그 차가 지금 어디 있고 어디로 가는가
 *   오른쪽 그래서 무엇이 밀리고, 언제까지 버티는가
 */
export default function ControlPage() {
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const board = useApiQuery<ControlBoard>(
    ['execution', 'board', date],
    `/execution/board?date=${date}`,
    // 관제는 열어 두고 보는 화면이다. 30초면 사람이 새로고침을 누를 생각을
    // 하기 전에 갱신된다.
    { refetchInterval: 30_000 },
  );

  const executions = useMemo(() => board.data?.executions ?? [], [board.data]);

  // 목록이 오면 맨 위 — 즉 가장 급한 건 — 을 자동으로 연다. 화면을 열자마자
  // 손댈 곳이 보여야 관제 화면이다.
  useEffect(() => {
    if (executions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!executions.some((e) => e.executionId === selectedId)) {
      setSelectedId(executions[0]!.executionId);
    }
  }, [executions, selectedId]);

  const track = useApiQuery<ExecutionTrack>(
    ['execution', 'track', selectedId],
    `/execution/${selectedId}/track`,
    { enabled: selectedId !== null, refetchInterval: 30_000 },
  );

  const selected = executions.find((e) => e.executionId === selectedId) ?? null;
  const summary = board.data?.summary;

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="실시간 관제"
        description={
          summary
            ? `${formatDateLabel(date)} · 운행 중 ${summary.running}건`
            : '도로 위에 있는 운송을 보고, 밀리는 곳을 먼저 잡습니다.'
        }
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelectedId(null);
              }}
              aria-label="기준일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <Button
              variant="secondary"
              onClick={() => void board.refetch()}
              loading={board.isFetching}
              loadingLabel="새로 불러오는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              새로고침
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {summary && summary.breaching > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-status-danger/25 bg-status-danger-surface px-3.5 py-3"
          >
            <AlertTriangle
              size={18}
              strokeWidth={1.75}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-status-danger"
            />
            <p className="text-body text-content-secondary">
              <span className="font-semibold text-status-danger">
                도착 마감을 넘길 운송 {summary.breaching}건
              </span>{' '}
              — 목록 맨 위에 있습니다. 화주에게 미리 알리면 도착 후 반송되는 일을
              막을 수 있습니다.
            </p>
          </div>
        )}

        <StatRow>
          <Stat label="운행 중" value={summary?.running ?? '—'} unit="건" />
          <Stat
            label="지연"
            value={summary?.delayed ?? '—'}
            unit="건"
            tone={(summary?.delayed ?? 0) > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="마감 위험"
            value={summary?.breaching ?? '—'}
            unit="건"
            tone={(summary?.breaching ?? 0) > 0 ? 'danger' : 'default'}
          />
          <Stat
            label="정시율"
            value={summary?.onTimeRate ?? '—'}
            unit="%"
            hint="완료 건 기준"
            tone={(summary?.onTimeRate ?? 100) < 80 ? 'warning' : 'default'}
          />
          <Stat
            label="미해결 예외"
            value={summary?.openExceptions ?? '—'}
            unit="건"
            tone={(summary?.openExceptions ?? 0) > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="인수증 미도착"
            value={summary?.missingPods ?? '—'}
            unit="건"
            hint="완료 건 기준"
            tone={(summary?.missingPods ?? 0) > 0 ? 'warning' : 'default'}
          />
        </StatRow>

        <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)_23rem]">
          <Panel
            title="운행"
            subtitle={
              executions.length > 0 ? '마감 위험 · 지연 순' : undefined
            }
            bodyClassName="max-h-[34rem] overflow-y-auto"
          >
            {board.isLoading && (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}

            {board.isError && (
              <EmptyState
                icon={<AlertTriangle size={24} strokeWidth={1.5} />}
                title="관제 정보를 불러오지 못했습니다"
                description={board.error.payload.message}
                action={
                  <Button variant="secondary" onClick={() => void board.refetch()}>
                    다시 시도
                  </Button>
                }
              />
            )}

            {board.data && executions.length === 0 && (
              <EmptyState
                icon={<Truck size={24} strokeWidth={1.5} />}
                title="이 날짜에 운행이 없습니다"
                description="배차된 트립이 출발하면 여기에 나타납니다."
              />
            )}

            {executions.length > 0 && (
              <ExecutionRail
                executions={executions}
                selectedId={selectedId}
                onSelect={(e) => setSelectedId(e.executionId)}
              />
            )}
          </Panel>

          <Panel
            title={selected ? `${selected.vehicleNo} 위치` : '위치'}
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
                <TrackMap track={track.data} />
                <OrderStrip orders={track.data.orders} />
              </>
            ) : (
              <div className="p-4">
                <Skeleton className="h-[22rem] w-full" />
              </div>
            )}
          </Panel>

          <div className="space-y-5">
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

            {track.data && track.data.exceptions.length > 0 && (
              <Panel title="이 운송의 예외" subtitle={`${track.data.exceptions.length}건`}>
                <ul className="divide-y divide-line-subtle">
                  {track.data.exceptions.map((x) => (
                    <li key={x.exceptionId} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-label font-medium text-content-primary">
                          {EXCEPTION_TYPE_LABEL[x.exceptionType] ?? x.exceptionType}
                        </span>
                        <span
                          className={cn(
                            'eyebrow-ko shrink-0',
                            x.severity === 'CRITICAL' || x.severity === 'HIGH'
                              ? 'text-status-danger'
                              : 'text-content-tertiary',
                          )}
                        >
                          {EXCEPTION_SEVERITY_LABEL[x.severity] ?? x.severity}
                        </span>
                      </div>
                      <p className="mt-0.5 text-caption text-content-secondary">
                        {x.description}
                      </p>
                      {x.impactMinutes !== null && (
                        <p className="tabular mt-0.5 text-caption text-content-tertiary">
                          {x.impactMinutes}분 소요
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 지도.
 *
 * 세 겹을 그린다 — 계획 경로(굵은 옥색), 지나온 자취(가는 회색), 정차와
 * 현재 위치 마커. 도로 경로를 못 받았으면 정차를 직선으로 이어 대신한다.
 * 선이 아예 없으면 마커 두 개가 허공에 떠 있어 순서를 알 수 없다.
 */
function TrackMap({ track }: { track: ExecutionTrack }) {
  const markers: MapMarker[] = [
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

  const stopLine: [number, number][] = track.stops
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .map((s) => [s.longitude!, s.latitude!]);

  const lines: MapLine[] = [
    track.route.length > 1
      ? { path: track.route, color: '#0f766e', weight: 5, opacity: 0.55 }
      : { path: stopLine, color: '#0f766e', weight: 3, opacity: 0.4, dashed: true },
    { path: track.trail, color: '#b45309', weight: 2, opacity: 0.9 },
  ];

  return (
    <div className="p-4">
      <NaverMap
        markers={markers}
        lines={lines}
        height={340}
        fallbackHint="서버 .env 에 NAVER_MAP_CLIENT_ID 를 넣으면 여기에 차량 위치가 나옵니다. 오른쪽 지연 전파 축은 지도 없이도 그대로 동작합니다."
      />
      {track.route.length === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-caption text-content-tertiary">
          <MapPin size={11} strokeWidth={2} aria-hidden="true" />
          도로 경로를 받지 못해 정차를 직선으로 이었습니다.
        </p>
      )}
    </div>
  );
}

/** 이 차에 실린 것. 화주 전화를 받았을 때 바로 답할 수 있어야 한다 */
function OrderStrip({ orders }: { orders: ExecutionTrack['orders'] }) {
  if (orders.length === 0) return null;
  return (
    <div className="border-t border-line-subtle px-4 py-3">
      <p className="eyebrow-ko mb-1.5 text-content-tertiary">실린 오더 {orders.length}건</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {orders.map((o) => (
          <li key={o.orderId} className="text-caption text-content-secondary">
            <span className="tabular text-content-primary">{o.orderNo}</span>
            <span className="mx-1 text-content-tertiary">·</span>
            {o.shipperName}
            <span className="mx-1 text-content-tertiary">→</span>
            {o.toLocationName}
          </li>
        ))}
      </ul>
    </div>
  );
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${iso}T00:00:00`));
}
