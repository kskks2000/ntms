'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { DashboardOverview } from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { AttentionList } from '@/components/dashboard/attention-list';
import { PipelineFlow } from '@/components/dashboard/pipeline-flow';
import { RunningList } from '@/components/dashboard/running-list';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { useAuth } from '@/lib/auth-context';

/**
 * 관제 현황 — 로그인하면 처음 만나는 화면.
 *
 * 이 화면의 단 하나의 일은 **"지금 뭘 해야 하나" 에 답하는 것**이다.
 * 그래서 위에서부터 이 순서다.
 *
 *   1. 파이프라인   오늘 일이 어디에 쌓여 있나        ← 판단
 *   2. 오늘의 숫자   규모와 품질                      ← 배경
 *   3. 손댈 일       지금 처리해야 하는 건            ← 행동
 *   4. 도로 위       나가 있는 차                     ← 감시
 *
 * 숫자를 크게 늘어놓는 대시보드를 만들지 않았다. 큰 숫자는 보기에는 좋지만
 * 아무 결정도 만들어 주지 않는다.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(() => toDateInput(new Date()));

  const query = useApiQuery<DashboardOverview>(
    ['dashboard', 'overview', date],
    `/dashboard/overview?date=${date}`,
    { refetchInterval: 60_000 },
  );

  const data = query.data;

  return (
    <>
      <PageHeader
        eyebrow="Control"
        title="관제 현황"
        description={
          data
            ? `${formatDateLabel(data.date)} · ${formatClock(data.generatedAt)} 기준`
            : '오늘의 운송이 어디까지 왔는지 한 화면에서 봅니다.'
        }
        actions={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="dashboard-date">
              기준일
            </label>
            <input
              id="dashboard-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
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
        {query.isError && (
          <Panel>
            <EmptyState
              icon={<AlertTriangle size={26} strokeWidth={1.5} />}
              title="현황을 불러오지 못했습니다"
              description={query.error.payload.message}
              action={
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  다시 시도
                </Button>
              }
            />
          </Panel>
        )}

        {/* --- 1. 파이프라인 : 이 화면의 얼굴 -------------------------- */}
        <section className="overflow-hidden rounded-card bg-canvas-850 px-5 pb-5 pt-5 sm:px-7">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="eyebrow-ko text-canvas-300">운송 파이프라인</h2>
            <p className="text-caption text-canvas-400">
              축 위로 흐르고, 축 아래로 쌓입니다
            </p>
            {data && (
              <p className="tabular ml-auto text-caption text-canvas-400">
                오더 {data.today.orderCount}건 기준
              </p>
            )}
          </div>

          <div className="mt-2 min-h-[240px]">
            {data ? (
              <PipelineFlow nodes={data.pipeline} />
            ) : (
              <div className="flex h-[240px] items-end justify-between gap-6 px-6 pb-10">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full bg-canvas-800" />
                ))}
              </div>
            )}
          </div>

          <PipelineLegend />
        </section>

        {/* --- 2. 오늘의 숫자 ----------------------------------------- */}
        <StatRow>
          <Stat label="오더" value={data?.today.orderCount ?? '—'} unit="건" />
          <Stat label="편성" value={data?.today.tripCount ?? '—'} unit="트립" />
          <Stat
            label="운행 차량"
            value={data?.today.runningCount ?? '—'}
            unit="대"
            tone={data && data.today.runningCount > 0 ? 'accent' : 'default'}
            hint={data ? `배차 ${data.today.dispatchCount}건` : undefined}
          />
          <Stat label="물동량" value={data?.today.weightTon ?? '—'} unit="t" />
          <Stat
            label="정시율"
            value={data?.today.onTimeRate ?? '—'}
            unit={data?.today.onTimeRate === null ? undefined : '%'}
            hint={data?.today.onTimeRate === null ? '완료된 운행 없음' : '완료 기준'}
            tone={
              data?.today.onTimeRate !== null && (data?.today.onTimeRate ?? 100) < 90
                ? 'warning'
                : 'default'
            }
          />
          <Stat
            label="지연"
            value={data?.today.delayedCount ?? '—'}
            unit="건"
            tone={(data?.today.delayedCount ?? 0) > 0 ? 'danger' : 'default'}
            hint={data ? `적재율 ${data.today.loadingRate ?? '—'}%` : undefined}
          />
        </StatRow>

        {/* --- 3 · 4. 손댈 일과 도로 위 -------------------------------- */}
        <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
          <Panel
            title="지금 손대야 할 일"
            subtitle={
              data ? `${data.attention.length}건` : undefined
            }
            action={
              <Link
                href="/plan/dispatch"
                className="text-caption font-medium text-content-accent underline-offset-4 hover:underline"
              >
                배차 화면
              </Link>
            }
          >
            {data ? <AttentionList items={data.attention} /> : <ListSkeleton rows={5} />}
          </Panel>

          <Panel
            title="지금 도로 위"
            subtitle={data ? `${data.running.length}대 운행 중` : undefined}
            action={
              <Link
                href="/execution/control"
                className="text-caption font-medium text-content-accent underline-offset-4 hover:underline"
              >
                실시간 관제
              </Link>
            }
          >
            {data ? <RunningList trips={data.running} /> : <ListSkeleton rows={4} />}
          </Panel>
        </div>

        <p className="text-caption text-content-tertiary">
          {user?.tenantName} · 1분마다 자동으로 다시 읽습니다.
        </p>
      </div>
    </>
  );
}

/** 그림은 범례 없이는 그림에 그친다 */
function PipelineLegend() {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="flex items-center gap-2 text-caption text-canvas-400">
        <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="text-canvas-600" />
        </svg>
        다음 단계로 넘어간 양
      </span>
      <span className="flex items-center gap-2 text-caption text-canvas-400">
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
          <rect x="3" y="0" width="6" height="14" rx="3" fill="currentColor" className="text-canvas-500" />
        </svg>
        그 단계에 쌓인 양
      </span>
      <span className="flex items-center gap-2 text-caption text-canvas-400">
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
          <rect x="3" y="0" width="6" height="14" rx="3" fill="currentColor" className="text-amber-300" />
        </svg>
        손대야 할 정체
      </span>
      <span className="flex items-center gap-2 text-caption text-canvas-400">
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
          <rect x="3" y="0" width="6" height="14" rx="3" fill="currentColor" className="text-jade-400" />
        </svg>
        도로 위 (정체 아님)
      </span>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-line-subtle">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2 px-4 py-3.5">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
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

function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
