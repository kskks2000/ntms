'use client';

import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { TripStopView } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 적재 곡선 — 정차 순서를 따라가며 적재량이 천장을 넘는가.
 *
 * ## 왜 총합이 아니라 곡선인가
 *
 * 6톤짜리 오더 두 건을 11톤차에 묶는다고 하자. 총합 12톤이니 안 될 것
 * 같지만, 하나를 내린 **뒤에** 다른 하나를 실으면 된다. 반대로 둘 다 먼저
 * 싣고 나중에 내리면 12톤이 한 번에 실려 안 된다.
 *
 * **순서가 답을 바꾼다.** 그래서 합계 한 줄로는 판정할 수 없고, 정차마다의
 * 적재량을 따라가야 한다. DB 의 trip_stop.cumulative_weight_kg 가 있는 것은
 * 우연이 아니다 — 스키마가 이미 이 곡선을 전제로 설계돼 있었고, 화면으로
 * 보인 적이 없었을 뿐이다.
 *
 * ## 이 앱의 축 어휘에서 이것의 자리
 *
 *   관제 현황   축 위로 흐르고 축 아래로 쌓인다      (흐름)
 *   배차판     계획 막대 위에 실적을 겹친다          (시간)
 *   오더 등록   두 창 사이에 소요시간이 들어가는가    (시간)
 *   여기       정차 순서를 따라가며 천장을 넘는가    (순서)
 *
 * 간트가 시간축이라면 이건 **순서축**이다. 가로가 시각이 아니라 몇 번째
 * 정차인지를 뜻한다 — 그래서 막대 사이 간격이 같다.
 */
export function LoadProfile({
  stops,
  capacityKg,
  compact = false,
}: {
  stops: TripStopView[];
  capacityKg: number | null;
  /** 트립 카드가 여러 장 늘어설 때는 낮게 그린다 */
  compact?: boolean;
}) {
  if (stops.length === 0) {
    return (
      <p className="py-6 text-center text-caption text-content-tertiary">
        오더를 넣으면 정차 순서와 적재량이 여기에 그려집니다.
      </p>
    );
  }

  const peak = Math.max(...stops.map((s) => s.cumulativeWeightKg), 0);
  // 천장이 없으면(차종 미지정) 곡선의 정점을 기준으로 그린다. 그때는
  // "얼마나 실리나" 만 보이고 "되는가" 는 답할 수 없다.
  const ceiling = capacityKg && capacityKg > 0 ? capacityKg : null;
  const top = ceiling ? Math.max(ceiling, peak) * 1.08 : peak * 1.15 || 1;
  const height = compact ? 72 : 132;
  const ceilingY = ceiling ? (1 - ceiling / top) * 100 : null;

  return (
    <div>
      <div className="relative" style={{ height }}>
        {/* 천장 — 넘으면 안 되는 선 */}
        {ceilingY !== null && (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-dashed border-status-danger/50"
              style={{ top: `${ceilingY}%` }}
            />
            {!compact && (
              <span
                className="tabular absolute right-0 -translate-y-full pb-0.5 text-[10px] text-status-danger/80"
                style={{ top: `${ceilingY}%` }}
              >
                한계 {ceiling!.toLocaleString('ko-KR')}kg
              </span>
            )}
          </>
        )}

        {/* 정차마다 막대 하나. 가로 간격이 같은 것은 이 축이 시각이 아니라
            순서이기 때문이다 */}
        <div className="absolute inset-0 flex items-end gap-1">
          {stops.map((s) => {
            const h = (s.cumulativeWeightKg / top) * 100;
            return (
              <span
                key={s.stopSeq}
                className="relative flex min-w-0 flex-1 items-end justify-center"
                style={{ height: '100%' }}
                title={`${s.stopSeq}. ${s.locationName} — ${s.cumulativeWeightKg.toLocaleString('ko-KR')}kg`}
              >
                <span
                  className={cn(
                    'w-full rounded-t-sm transition-[height] duration-fast',
                    s.over
                      ? 'bg-status-danger/70'
                      : s.stopType === 'PICKUP'
                        ? 'bg-content-accent/60'
                        : 'bg-content-accent/35',
                  )}
                  style={{ height: `${Math.max(2, h)}%` }}
                />
                {!compact && s.cumulativeWeightKg > 0 && (
                  <span
                    className={cn(
                      'tabular absolute -translate-y-full pb-0.5 text-[10px]',
                      s.over ? 'font-medium text-status-danger' : 'text-content-tertiary',
                    )}
                    style={{ bottom: `${Math.max(2, h)}%` }}
                  >
                    {Math.round(s.cumulativeWeightKg / 100) / 10}t
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* 정차 이름표 */}
      <div className="mt-1 flex gap-1 border-t border-line-subtle pt-1">
        {stops.map((s) => (
          <span
            key={s.stopSeq}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
            title={s.locationName}
          >
            {s.stopType === 'PICKUP' ? (
              <ArrowUpFromLine
                size={10}
                strokeWidth={2}
                aria-hidden="true"
                className="text-content-accent"
              />
            ) : (
              <ArrowDownToLine
                size={10}
                strokeWidth={2}
                aria-hidden="true"
                className="text-content-tertiary"
              />
            )}
            <span className="w-full truncate text-center text-[10px] leading-tight text-content-tertiary">
              {s.locationName}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 곡선 아래 한 줄 판정.
 *
 * "적재율 61%" 만으로는 부족하다. 넘쳤을 때 **어느 정차에서** 넘었는지가
 * 있어야 무엇을 빼야 할지 안다.
 */
export function LoadVerdictLine({
  peakWeightKg,
  peakRate,
  firstOverSeq,
  overBy,
  capacityKg,
  stops,
}: {
  peakWeightKg: number;
  peakRate: number;
  firstOverSeq: number | null;
  overBy: string[];
  capacityKg: number | null;
  stops: TripStopView[];
}) {
  if (capacityKg === null) {
    return (
      <p className="text-caption text-content-tertiary">
        차종을 고르면 실릴 수 있는지 판정합니다. 지금 정점은{' '}
        <span className="tabular">{peakWeightKg.toLocaleString('ko-KR')}kg</span> 입니다.
      </p>
    );
  }

  if (firstOverSeq !== null) {
    const at = stops.find((s) => s.stopSeq === firstOverSeq);
    const label: Record<string, string> = { weight: '중량', volume: '부피', pallet: '파렛트' };
    return (
      <p className="text-caption text-status-danger">
        <b>{firstOverSeq}번째 정차 {at ? `(${at.locationName})` : ''}</b> 에서{' '}
        {overBy.map((k) => label[k] ?? k).join(' · ')} 한계를 넘습니다 —{' '}
        <span className="tabular">{peakWeightKg.toLocaleString('ko-KR')}kg</span> /{' '}
        <span className="tabular">{capacityKg.toLocaleString('ko-KR')}kg</span>. 오더를 덜어내거나
        차종을 올리세요.
      </p>
    );
  }

  const rate = Math.round(peakRate * 100);
  return (
    <p className="text-caption text-content-secondary">
      정점 <span className="tabular">{peakWeightKg.toLocaleString('ko-KR')}kg</span> ·{' '}
      <span className={cn('tabular font-medium', rate >= 85 && 'text-status-success')}>
        적재율 {rate}%
      </span>
      {rate < 50 && <span className="text-content-tertiary"> — 더 실을 여유가 있습니다</span>}
    </p>
  );
}
