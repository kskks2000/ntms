'use client';

import type { KpiDimensionRow, KpiMetric } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * KPI 는 값이 아니라 방향이다.
 *
 * 정시율 94% 는 그 자체로 좋은지 나쁜지 알 수 없다. 지난주가 97% 였다면
 * 나쁜 숫자고, 88% 였다면 좋은 숫자다. 그래서 큰 숫자 카드를 나란히 늘어놓는
 * 대신 **선 위의 자리**로 보여 준다 — 값 하나, 기간 평균선 하나, 앞 기간과의
 * 차이 하나.
 *
 * 여덟 지표를 같은 모양으로 반복하는 것이 이 화면의 형식이다. 지표마다
 * 다른 그림을 그리면 견줄 수가 없다.
 */
export function KpiMetricCard({ metric }: { metric: KpiMetric }) {
  const better = isBetter(metric);

  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 py-3.5">
      <p className="truncate text-caption text-content-tertiary">{metric.label}</p>

      <p className="flex items-baseline gap-1.5">
        <span className="tabular text-[1.5rem] font-medium leading-none text-content-primary">
          {metric.value === null ? '—' : formatValue(metric.value, metric.unit)}
        </span>
        <span className="text-caption text-content-tertiary">{metric.unit}</span>

        {metric.delta !== null && metric.delta !== 0 && (
          <span
            className={cn(
              'tabular ml-auto text-caption font-medium',
              better === null
                ? 'text-content-tertiary'
                : better
                  ? 'text-status-success'
                  : 'text-status-warning',
            )}
            title="앞 기간 같은 길이와 비교"
          >
            {metric.delta > 0 ? '▲' : '▼'} {Math.abs(metric.delta).toLocaleString('ko-KR')}
          </span>
        )}
      </p>

      <Sparkline metric={metric} />

      <p className="text-caption leading-snug text-content-tertiary">{metric.hint}</p>
    </div>
  );
}

/**
 * 스파크라인.
 *
 * 점을 찍지 않고 선만 긋는다. 열네 점에 전부 동그라미를 달면 그림이 아니라
 * 눈금 모음이 된다. 마지막 점 하나만 표시해 "지금 여기" 를 남긴다.
 *
 * 가로 점선은 **기간 평균**이다. 기준선이 없으면 오르내림만 보이고 그것이
 * 평소보다 좋은지 나쁜지는 여전히 알 수 없다.
 */
function Sparkline({ metric }: { metric: KpiMetric }) {
  const points = metric.series.filter((p) => p.value !== null) as { date: string; value: number }[];
  if (points.length < 2) {
    return (
      <p className="flex h-9 items-center text-caption text-content-tertiary">
        추세를 그리려면 이틀 이상이 필요합니다
      </p>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values, metric.average ?? Infinity);
  const max = Math.max(...values, metric.average ?? -Infinity);
  // 값이 하루도 안 변하면 span 이 0 이 되어 선이 위쪽 끝에 달라붙는다
  const span = max - min || Math.abs(max) || 1;

  const W = 100;
  const H = 32;
  const pad = 3;
  const x = (i: number) => (metric.series.length <= 1 ? 0 : (i / (metric.series.length - 1)) * W);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);

  // 값이 빠진 날은 선을 끊는다. 이어 버리면 없는 날을 지어낸 것이 된다.
  const segments: string[] = [];
  let current: string[] = [];
  metric.series.forEach((p, i) => {
    if (p.value === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${x(i).toFixed(2)},${y(p.value).toFixed(2)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const lastIndex = metric.series.reduce((acc, p, i) => (p.value !== null ? i : acc), -1);
  const last = metric.series[lastIndex];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-9 w-full"
      role="img"
      aria-label={`${metric.label} 추세 — ${points[0]!.date} ${formatValue(points[0]!.value, metric.unit)} 에서 ${points[points.length - 1]!.date} ${formatValue(points[points.length - 1]!.value, metric.unit)}`}
    >
      {metric.average !== null && (
        <line
          x1="0"
          x2={W}
          y1={y(metric.average)}
          y2={y(metric.average)}
          stroke="rgb(var(--border-strong))"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {segments.map((d, i) => (
        <polyline
          key={i}
          points={d}
          fill="none"
          stroke="rgb(var(--text-primary))"
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {last?.value != null && (
        <circle cx={x(lastIndex)} cy={y(last.value)} r="1.6" fill="rgb(var(--accent))" />
      )}
    </svg>
  );
}

/**
 * 차원별 편차.
 *
 * 순위표를 만들지 않는다 — 1등과 꼴등만 보이고 가운데가 안 읽힌다. 대신
 * **전체 평균 0선에서 얼마나 벗어났는지**로 세운다. 실적 상세의 편차 축과
 * 같은 어휘라, 두 화면이 같은 방식으로 읽힌다.
 */
export function DimensionSpine({
  rows,
  baselineLabel,
}: {
  rows: KpiDimensionRow[];
  baselineLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-caption text-content-tertiary">
        이 기간에 확정된 실적이 없습니다.
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute bottom-0 top-0 z-10 w-px bg-line-strong"
          style={{ left: 'calc(11rem + (100% - 20rem) / 2)' }}
        />
        <ul className="space-y-px">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 rounded-sm py-1.5 hover:bg-surface-sunken"
            >
              <span className="w-[7rem] shrink-0 truncate text-label text-content-secondary">
                {row.name}
              </span>
              <span className="tabular w-[4rem] shrink-0 text-right text-caption text-content-tertiary">
                {row.count}건
              </span>

              <DeltaBar delta={row.onTimeDelta} scale={15} />

              <span className="tabular w-[4.5rem] shrink-0 text-right text-label text-content-primary">
                {row.onTimeRate === null ? '—' : `${row.onTimeRate.toFixed(1)}%`}
              </span>
              <span className="w-[4rem] shrink-0 text-right">
                <span
                  className={cn(
                    'tabular text-caption',
                    (row.onTimeDelta ?? 0) < -5
                      ? 'font-medium text-status-warning'
                      : 'text-content-tertiary',
                  )}
                >
                  {row.onTimeDelta === null
                    ? ''
                    : `${row.onTimeDelta > 0 ? '+' : ''}${row.onTimeDelta.toFixed(1)}%p`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2.5 border-t border-line-subtle pt-2 text-caption text-content-tertiary">
        가운데 선이 {baselineLabel}입니다. 오른쪽으로 벌어질수록 평균보다 정시율이 높습니다.
      </p>
    </div>
  );
}

function DeltaBar({ delta, scale }: { delta: number | null; scale: number }) {
  const offset = delta === null ? 0 : Math.max(-1, Math.min(1, delta / scale));
  const width = Math.abs(offset) * 50;
  const right = offset > 0;

  return (
    <span className="relative h-3.5 min-w-0 flex-1">
      {delta !== null && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 h-[6px] -translate-y-1/2 rounded-[1px]',
            right ? 'rounded-l-none bg-status-success/50' : 'rounded-r-none bg-status-warning/60',
          )}
          style={right ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      )}
    </span>
  );
}

/** 방향에 비추어 좋아진 것인가. 방향을 모르면 색을 안 준다 */
function isBetter(metric: KpiMetric): boolean | null {
  if (metric.delta === null || metric.delta === 0) return null;
  return metric.direction === 'up-good' ? metric.delta > 0 : metric.delta < 0;
}

function formatValue(v: number, unit: string): string {
  if (unit === '원') return Math.round(v).toLocaleString('ko-KR');
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}
