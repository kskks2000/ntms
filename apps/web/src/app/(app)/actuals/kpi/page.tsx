'use client';

import { LineChart, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { KpiBoard } from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { DimensionSpine, KpiMetricCard } from '@/components/actual/kpi-strip';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';

/**
 * KPI 현황.
 *
 * ## 지표는 값이 아니라 방향이다
 *
 * 정시율 94% 는 그 자체로 좋은지 나쁜지 알 수 없다. 지난주가 97% 였다면 나쁜
 * 숫자고, 88% 였다면 좋은 숫자다. 그래서 큰 숫자 카드를 나란히 늘어놓는 대신
 * 여덟 지표를 **같은 모양**으로 반복한다 — 값 하나, 기간 평균선 하나, 앞
 * 기간과의 차이 하나. 지표마다 다른 그림을 그리면 견줄 수가 없다.
 *
 * 아래 절반은 실적 상세와 같은 **편차 축**이다. 운송사와 화주를 순위로
 * 세우지 않고 전체 평균 0선에서 얼마나 벗어났는지로 세운다. 1등과 꼴등만
 * 보이는 순위표에서는 가운데가 안 읽힌다.
 *
 * ## 숫자가 언제 것인지 감추지 않는다
 *
 * KPI 는 확정된 실적만 센다. 미확정 실적은 아직 흔들리는 숫자라, 그것까지
 * 세면 아침에 본 정시율과 오후에 본 정시율이 달라진다. 대신 집계 시각을
 * 화면에 적고, 그 뒤에 확정된 건이 있으면 낡았다고 말한다.
 */
export default function KpiPage() {
  const toast = useToast();
  const [from, setFrom] = useState(() => toDateInput(daysAgo(13)));
  const [to, setTo] = useState(() => toDateInput(new Date()));

  const query = useApiQuery<KpiBoard>(
    ['actuals', 'kpi', from, to],
    `/actuals/kpi?from=${from}&to=${to}`,
  );
  const data = query.data;

  const rebuild = useApiMutation<{ dates: string[] }, { from: string; to: string }>(
    () => ({ path: '/actuals/rebuild', method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: (result) => {
        toast.success(`${result.dates.length}일치를 다시 집계했습니다`, '확정된 실적 기준입니다.');
        void query.refetch();
      },
    },
  );

  const empty = data && data.totals.actualCount === 0;

  return (
    <>
      <PageHeader
        eyebrow="Actuals"
        title="KPI 현황"
        description="확정된 실적을 날짜로 접어 봅니다. 값보다 방향이, 순위보다 평균과의 거리가 중요합니다."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangePresets
              onPick={(days) => {
                setFrom(toDateInput(daysAgo(days - 1)));
                setTo(toDateInput(new Date()));
              }}
            />
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="시작일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <span aria-hidden="true" className="text-content-tertiary">
              —
            </span>
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
              loading={rebuild.isPending}
              loadingLabel="집계하는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
              onClick={() => rebuild.mutate({ from, to })}
            >
              다시 집계
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {data?.stale && (
          <Alert
            tone="warning"
            title="집계 이후에 확정된 실적이 있습니다"
            action={
              <Button
                size="sm"
                loading={rebuild.isPending}
                loadingLabel="집계하는 중"
                onClick={() => rebuild.mutate({ from, to })}
              >
                다시 집계
              </Button>
            }
          >
            아래 숫자는 {data.calculatedAt ? formatDateTime(data.calculatedAt) : '이전'} 기준입니다.
            그 뒤에 확정된 실적은 아직 반영되지 않았습니다.
          </Alert>
        )}

        <StatRow>
          <Stat label="확정 실적" value={data?.totals.actualCount ?? '—'} unit="건" />
          <Stat label="오더" value={data?.totals.orderCount ?? '—'} unit="건" />
          <Stat
            label="주행거리"
            value={data ? Math.round(data.totals.distanceKm).toLocaleString('ko-KR') : '—'}
            unit="km"
          />
          <Stat
            label="물동량"
            value={data ? Math.round(data.totals.weightKg / 1000).toLocaleString('ko-KR') : '—'}
            unit="톤"
          />
          <Stat label="매출" value={data ? compact(data.totals.billingAmount) : '—'} unit="원" />
          <Stat
            label="마진"
            value={data ? compact(data.totals.marginAmount) : '—'}
            unit="원"
            hint="정산 확정 전 예상"
          />
        </StatRow>

        <Panel
          title="지표 여덟 줄"
          subtitle={
            data?.calculatedAt
              ? `${formatDateTime(data.calculatedAt)} 집계 · 점선은 기간 평균, 화살표는 앞 기간과의 차이`
              : '점선은 기간 평균, 화살표는 앞 기간과의 차이'
          }
        >
          {query.isLoading && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-px bg-line-subtle [&>*]:bg-surface-card">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="p-4">
                  <Skeleton className="h-20 w-full" />
                </div>
              ))}
            </div>
          )}

          {empty && (
            <EmptyState
              icon={<LineChart size={24} strokeWidth={1.5} />}
              title="이 기간에 확정된 실적이 없습니다"
              description="KPI 는 확정된 실적만 셉니다. 미확정 실적은 아직 흔들리는 숫자라서, 세면 지표가 하루에도 여러 번 달라집니다. 운송실적에서 확정한 뒤 다시 보세요."
              action={
                <Button variant="secondary" onClick={() => rebuild.mutate({ from, to })}>
                  집계 다시 돌리기
                </Button>
              }
            />
          )}

          {data && !empty && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-px bg-line-subtle [&>*]:bg-surface-card">
              {data.metrics.map((m) => (
                <KpiMetricCard key={m.key} metric={m} />
              ))}
            </div>
          )}
        </Panel>

        {data && !empty && (
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="운송사별 정시율" subtitle="전체 평균에서 얼마나 벗어났나">
              <DimensionSpine rows={data.carriers} baselineLabel="전체 평균 정시율" />
            </Panel>
            <Panel title="화주별 정시율" subtitle="오더 단위로 안분해 셉니다">
              <DimensionSpine rows={data.shippers} baselineLabel="전체 평균 정시율" />
            </Panel>
          </div>
        )}

        {data && !empty && <CarrierTable data={data} />}
      </div>
    </>
  );
}

/**
 * 운송사 상세 표.
 *
 * 편차 축이 "누가 평균에서 벗어났나" 를 보여 준다면, 이 표는 그 뒤의 숫자를
 * 담는다. 금액과 마진율까지 같이 두는 이유는, 정시율이 나쁜 운송사가 단가가
 * 싸서 쓰고 있는 곳인지 아닌지가 다음 배정을 정하기 때문이다.
 */
function CarrierTable({ data }: { data: KpiBoard }) {
  return (
    <Panel title="운송사 실적" subtitle="물량이 많은 순">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <caption className="sr-only">운송사별 KPI</caption>
          <thead>
            <tr className="border-b border-line-subtle">
              {['운송사', '실적', '정시율', '평균 지연', '예외 · 파손', '주행', '매입', '마진율'].map(
                (h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`eyebrow-ko px-4 py-2.5 font-medium text-content-tertiary ${i === 0 ? '' : 'text-right'}`}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.carriers.map((c) => (
              <tr key={c.id} className="border-b border-line-subtle last:border-0">
                <td className="px-4 py-2.5 text-label text-content-primary">{c.name}</td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {c.count}건
                </td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {c.onTimeRate === null ? '—' : `${c.onTimeRate.toFixed(1)}%`}
                </td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {c.avgDelayMinutes === null ? '—' : `${c.avgDelayMinutes.toFixed(0)}분`}
                </td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {c.exceptionCount} · {c.damageCount}
                </td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {Math.round(c.distanceKm).toLocaleString('ko-KR')} km
                </td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {compact(c.paymentAmount)}
                </td>
                <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                  {c.marginRate === null ? '—' : `${c.marginRate.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RangePresets({ onPick }: { onPick: (days: number) => void }) {
  return (
    <div role="group" aria-label="기간" className="flex rounded-md border border-line-field p-0.5">
      {[
        { days: 7, label: '7일' },
        { days: 14, label: '14일' },
        { days: 30, label: '30일' },
      ].map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => onPick(p.days)}
          className="rounded-[3px] px-2.5 py-1 text-caption text-content-secondary transition-colors duration-fast hover:text-content-primary"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function compact(amount: number): string {
  if (Math.abs(amount) >= 100_000_000) return `${(amount / 100_000_000).toFixed(1)}억`;
  if (Math.abs(amount) >= 10_000) return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
  return amount.toLocaleString('ko-KR');
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
