'use client';

import { AlertTriangle, CircleCheck, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  EXCEPTION_SEVERITY_LABEL,
  EXCEPTION_STATUS_LABEL,
  EXCEPTION_TYPE_LABEL,
  type ExceptionPage,
  type ExceptionRow,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { ExceptionDrawer } from '@/components/execution/exception-drawer';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 운송 예외.
 *
 * ## 건수로 세면 손댈 곳을 못 찾는다
 *
 * "교통정체 6건 · 차량고장 1건" 만 보면 정체가 문제 같다. 그런데 고장 한
 * 건이 네 시간을 먹고 정체 여섯 건이 합쳐 40분이면, 손댈 곳은 정반대다.
 * 그래서 이 화면의 요약은 **까먹은 시간**으로 센다 — 유형 막대의 길이가
 * 건수가 아니라 분이다.
 *
 * ## 목록은 아직 안 끝난 것부터
 *
 * 기본 조건이 '미해결'인 이유는, 해결된 예외를 다시 볼 일은 월말 분석
 * 때뿐이고 지금 이 화면을 여는 사람은 오늘 처리할 것을 찾기 때문이다.
 */
export default function ExceptionsPage() {
  const [from, setFrom] = useState(() => toDateInput(daysAgo(7)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [status, setStatus] = useState('OPEN');
  const [editing, setEditing] = useState<ExceptionRow | null>(null);

  const query = useApiQuery<ExceptionPage>(
    ['execution', 'exceptions', from, to, status],
    `/execution/exceptions?from=${from}&to=${to}&status=${status}`,
  );
  const data = query.data;

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="운송 예외"
        description={
          data
            ? `미해결 ${data.openCount}건이 ${formatMinutes(data.openImpactMinutes)}을 까먹고 있습니다.`
            : '운행 중 어긋난 일을 모아 처리합니다.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="시작일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <span className="text-content-tertiary">—</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-label="종료일"
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
        <StatRow>
          <Stat
            label="미해결"
            value={data?.openCount ?? '—'}
            unit="건"
            tone={(data?.openCount ?? 0) > 0 ? 'warning' : 'default'}
          />
          <Stat
            label="까먹은 시간"
            value={data ? formatMinutes(data.openImpactMinutes) : '—'}
            hint="미해결 건 합계"
            tone={(data?.openImpactMinutes ?? 0) > 120 ? 'danger' : 'default'}
          />
          <Stat label="조회 건수" value={data?.total ?? '—'} unit="건" />
          <Stat label="유형" value={data?.byType.length ?? '—'} unit="종" />
        </StatRow>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel
            title="예외 목록"
            subtitle="줄을 누르면 상태를 넘기고 조치를 적을 수 있습니다"
            action={<StatusFilter value={status} onChange={setStatus} />}
          >
            {query.isLoading && (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}

            {query.isError && (
              <EmptyState
                icon={<AlertTriangle size={24} strokeWidth={1.5} />}
                title="예외 목록을 불러오지 못했습니다"
                description={query.error.payload.message}
                action={
                  <Button variant="secondary" onClick={() => void query.refetch()}>
                    다시 시도
                  </Button>
                }
              />
            )}

            {data && data.rows.length === 0 && (
              <EmptyState
                icon={<CircleCheck size={24} strokeWidth={1.5} />}
                title={status === 'OPEN' ? '처리할 예외가 없습니다' : '해당하는 예외가 없습니다'}
                description={
                  status === 'OPEN'
                    ? '이 기간에 손이 필요한 예외가 없습니다. 기간을 넓히거나 상태를 바꿔 보세요.'
                    : '기간이나 상태 조건을 바꿔 보세요.'
                }
              />
            )}

            {data && data.rows.length > 0 && (
              <ul className="divide-y divide-line-subtle">
                {data.rows.map((r) => (
                  <li key={r.exceptionId}>
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="flex w-full gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
                    >
                      {/* 심각도는 색으로만 말한다. 글자로 한 번 더 적으면
                          줄마다 같은 낱말이 반복돼 목록이 읽기 어려워진다 */}
                      <span
                        aria-hidden="true"
                        className={cn('mt-1 w-1 shrink-0 self-stretch rounded-full', severityBar(r.severity))}
                      />
                      <span className="sr-only">
                        심각도 {EXCEPTION_SEVERITY_LABEL[r.severity] ?? r.severity}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-label font-medium text-content-primary">
                            {EXCEPTION_TYPE_LABEL[r.exceptionType] ?? r.exceptionType}
                          </span>
                          <span className="tabular text-caption text-content-tertiary">
                            {r.vehicleNo ?? '차량 미상'}
                          </span>
                          {r.tripNo && (
                            <span className="tabular text-caption text-content-tertiary">
                              {r.tripNo}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-caption text-content-secondary">
                          {r.description}
                        </p>
                        {r.actionTaken && (
                          <p className="mt-0.5 truncate text-caption text-content-tertiary">
                            조치 · {r.actionTaken}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            'tabular text-label font-medium',
                            (r.impactMinutes ?? 0) >= 60
                              ? 'text-status-danger'
                              : 'text-content-primary',
                          )}
                        >
                          {r.impactMinutes === null ? '—' : `${r.impactMinutes}분`}
                        </p>
                        <p className="mt-0.5 text-caption text-content-tertiary">
                          {EXCEPTION_STATUS_LABEL[r.status] ?? r.status}
                        </p>
                        <p className="tabular mt-0.5 text-caption text-content-tertiary">
                          {formatDateTime(r.occurredAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="무엇이 시간을 먹나" subtitle="막대 길이는 건수가 아니라 분입니다">
            {data ? (
              <ImpactBars byType={data.byType} />
            ) : (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {editing && (
        <ExceptionDrawer
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void query.refetch();
          }}
        />
      )}
    </>
  );
}

/**
 * 유형별 까먹은 시간.
 *
 * 정렬도 분 기준이다. 건수로 정렬하면 자주 나지만 금방 푸는 일이 위로
 * 올라와, 이 표가 말하려는 것과 반대의 순서가 된다.
 */
function ImpactBars({ byType }: { byType: ExceptionPage['byType'] }) {
  if (byType.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-caption text-content-tertiary">
        미해결 예외가 없습니다.
      </p>
    );
  }
  const max = Math.max(...byType.map((t) => t.impactMinutes), 1);

  return (
    <ul className="space-y-3 px-4 py-4">
      {byType.map((t) => (
        <li key={t.type}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-label text-content-primary">
              {EXCEPTION_TYPE_LABEL[t.type] ?? t.type}
            </span>
            <span className="tabular shrink-0 text-caption text-content-secondary">
              {formatMinutes(t.impactMinutes)}
              <span className="ml-1.5 text-content-tertiary">{t.open}건</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={cn(
                'h-full rounded-full',
                t.impactMinutes >= 120 ? 'bg-status-danger' : 'bg-status-warning/75',
              )}
              style={{ width: `${(t.impactMinutes / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [
    { key: 'OPEN', label: '미해결' },
    { key: 'RESOLVED', label: '해결' },
    { key: 'CLOSED', label: '종결' },
  ];
  return (
    <div role="group" aria-label="상태" className="flex rounded-md border border-line-field p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-[3px] px-2.5 py-1 text-caption transition-colors duration-fast',
            value === o.key
              ? 'bg-action text-action-text'
              : 'text-content-secondary hover:text-content-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function severityBar(severity: string): string {
  return (
    {
      CRITICAL: 'bg-status-danger',
      HIGH: 'bg-status-danger/60',
      MEDIUM: 'bg-status-warning/70',
      LOW: 'bg-line-strong',
    }[severity] ?? 'bg-line-strong'
  );
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
