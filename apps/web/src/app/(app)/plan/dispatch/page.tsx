'use client';

import { AlertTriangle, RefreshCw, Truck } from 'lucide-react';
import { useState } from 'react';
import type { BoardBar, BoardVehicle, DispatchBoard } from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { GanttBoard } from '@/components/dispatch/gantt-board';
import { LaneDiagram } from '@/components/dispatch/lane-diagram';
import { BarDetail, UnassignedRail } from '@/components/dispatch/unassigned-rail';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

type Axis = 'vehicle' | 'lane';

/**
 * 배차판.
 *
 * 배차 담당자가 하루의 대부분을 보내는 화면이다. 여기서 하는 일은 넷이다 —
 * 어느 차에 무엇이 붙었나, 아직 차 없는 트립은 무엇인가, 차는 언제 비나,
 * 겹쳐 잡힌 것은 없나.
 *
 * 축을 둘로 나눈 이유는 두 질문의 성격이 다르기 때문이다.
 *   차량축  "이 차가 언제 비나"       → 배차를 붙일 때
 *   거점축  "이 거점에 언제 차가 오나" → 환적 · 연계를 볼 때
 * 데이터는 같고 보는 각도만 바뀐다.
 */
export default function DispatchBoardPage() {
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [axis, setAxis] = useState<Axis>('vehicle');
  const [showIdle, setShowIdle] = useState(false);
  const [selected, setSelected] = useState<{ bar: BoardBar; vehicle: BoardVehicle } | null>(
    null,
  );

  const query = useApiQuery<DispatchBoard>(
    ['dispatch', 'board', date],
    `/dispatch/board?date=${date}`,
    { refetchInterval: 60_000 },
  );
  const data = query.data;

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title="배차판"
        description={
          data
            ? `${formatDateLabel(data.date)} · 차량 ${data.summary.vehicleCount}대 중 ${data.summary.usedVehicleCount}대 운용`
            : '편성된 트립에 차량과 기사를 붙입니다.'
        }
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelected(null);
              }}
              aria-label="기준일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <Button
              variant="secondary"
              onClick={() => void query.refetch()}
              loading={query.isFetching}
              loadingLabel="새로 불러오는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              새로고침
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {data && data.summary.conflictCount > 0 && (
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
                같은 차량에 겹쳐 잡힌 배차 {data.summary.conflictCount}건
              </span>{' '}
              — 한쪽을 다른 차로 옮기거나 출발 시각을 조정하세요. 그대로 두면 당일에
              한 대가 두 곳에서 기다리게 됩니다.
            </p>
          </div>
        )}

        <StatRow>
          <Stat label="보유 차량" value={data?.summary.vehicleCount ?? '—'} unit="대" />
          <Stat
            label="배차"
            value={data?.summary.dispatchCount ?? '—'}
            unit="건"
            hint={data ? `${data.summary.usedVehicleCount}대 운용` : undefined}
          />
          <Stat
            label="가동률"
            value={data?.summary.utilizationRate ?? '—'}
            unit="%"
            tone={(data?.summary.utilizationRate ?? 100) < 50 ? 'warning' : 'default'}
          />
          <Stat
            label="미배차"
            value={data?.summary.unassignedCount ?? '—'}
            unit="트립"
            tone={(data?.summary.unassignedCount ?? 0) > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="겹침"
            value={data?.summary.conflictCount ?? '—'}
            unit="건"
            tone={(data?.summary.conflictCount ?? 0) > 0 ? 'danger' : 'default'}
          />
        </StatRow>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <Panel
            title="배차 현황"
            subtitle={
              axis === 'vehicle'
                ? '막대 전체가 계획, 채워진 부분이 실제 진행입니다'
                : '북에서 남으로 세운 거점축. 선이 아래로 기울면 남하입니다'
            }
            action={
              <div className="flex items-center gap-3">
                {axis === 'vehicle' && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-caption text-content-secondary">
                    <input
                      type="checkbox"
                      checked={showIdle}
                      onChange={(e) => setShowIdle(e.target.checked)}
                      className="h-3.5 w-3.5 rounded-sm border border-line-field accent-[rgb(var(--action-primary))]"
                    />
                    빈 차량도 보기
                  </label>
                )}
                <AxisToggle value={axis} onChange={setAxis} />
              </div>
            }
            bodyClassName="min-w-0"
          >
            {query.isLoading && <BoardSkeleton />}

            {query.isError && (
              <EmptyState
                icon={<AlertTriangle size={26} strokeWidth={1.5} />}
                title="배차판을 불러오지 못했습니다"
                description={query.error.payload.message}
                action={
                  <Button variant="secondary" onClick={() => void query.refetch()}>
                    다시 시도
                  </Button>
                }
              />
            )}

            {data && data.summary.dispatchCount === 0 && (
              <EmptyState
                icon={<Truck size={26} strokeWidth={1.5} />}
                title="이 날짜에 배차가 없습니다"
                description="편성된 트립에 차량을 붙이면 여기에 나타납니다."
              />
            )}

            {data && data.summary.dispatchCount > 0 && (
              <>
                {axis === 'vehicle' ? (
                  <GanttBoard
                    vehicles={data.vehicles}
                    windowFrom={data.windowFrom}
                    windowTo={data.windowTo}
                    now={data.now}
                    selectedId={selected?.bar.dispatchId ?? null}
                    onSelect={(bar, vehicle) => setSelected({ bar, vehicle })}
                    showIdleVehicles={showIdle}
                  />
                ) : (
                  <LaneDiagram
                    vehicles={data.vehicles}
                    windowFrom={data.windowFrom}
                    windowTo={data.windowTo}
                    now={data.now}
                    selectedId={selected?.bar.dispatchId ?? null}
                    onSelect={(bar, vehicle) => setSelected({ bar, vehicle })}
                  />
                )}
                <BoardLegend axis={axis} />
              </>
            )}
          </Panel>

          <div className="space-y-5">
            {selected && (
              <Panel title="선택한 배차">
                <BarDetail
                  bar={selected.bar}
                  vehicle={selected.vehicle}
                  onClose={() => setSelected(null)}
                />
              </Panel>
            )}

            <Panel
              title="배차 대기"
              subtitle={data ? `${data.unassigned.length}트립` : undefined}
            >
              {data ? (
                <UnassignedRail trips={data.unassigned} />
              ) : (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function AxisToggle({ value, onChange }: { value: Axis; onChange: (v: Axis) => void }) {
  return (
    <div
      role="group"
      aria-label="보는 축"
      className="flex rounded-md border border-line-field p-0.5"
    >
      {(
        [
          { key: 'vehicle', label: '차량축' },
          { key: 'lane', label: '거점축' },
        ] as const
      ).map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            'rounded-[3px] px-2.5 py-1 text-caption transition-colors duration-fast',
            value === opt.key
              ? 'bg-action text-action-text'
              : 'text-content-secondary hover:text-content-primary',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** 막대 색이 무엇을 뜻하는지 적어 둔다. 범례 없는 그림은 그림에 그친다 */
function BoardLegend({ axis }: { axis: Axis }) {
  const items = [
    { tone: 'bg-surface-sunken border-line-strong', label: '출발 전' },
    { tone: 'bg-status-success-surface border-status-success/40', label: '운행 중' },
    { tone: 'bg-status-warning-surface border-status-warning/45', label: '지연' },
    { tone: 'bg-status-danger-surface border-status-danger', label: '겹침' },
    { tone: 'bg-surface-card border-line-subtle', label: '완료' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-subtle px-4 py-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-caption text-content-tertiary">
          <span aria-hidden="true" className={cn('h-3 w-5 rounded-sm border', item.tone)} />
          {item.label}
        </span>
      ))}
      <span className="text-caption text-content-tertiary">
        {axis === 'vehicle'
          ? '· 막대 오른쪽 빗금은 계획을 넘긴 지연분입니다'
          : '· 선이 만나는 지점이 환적 가능한 시각입니다'}
      </span>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-48 shrink-0" />
          <Skeleton className="h-8 flex-1" />
        </div>
      ))}
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
  }).format(new Date(iso));
}
