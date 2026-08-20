'use client';

import { Check, X } from 'lucide-react';
import {
  fitLoad,
  loadFitLabel,
  type LoadInput,
  type VehicleCapacity,
} from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 적재 판정 — 이 짐을 어느 차가 실을 수 있나.
 *
 * 시간 축이 이 화면의 시그니처라면 이건 조용한 보조 장치다. 굵게 그리지
 * 않는다 — 한 화면에 강한 것이 둘이면 둘 다 안 보인다.
 *
 * 그래도 두는 이유는 **요구 차종을 잘못 고르는 사고**가 흔하기 때문이다.
 * 12톤을 실으면서 요구 차종에 5톤을 걸어 두면 편성이 후보를 못 찾고, 그
 * 사실은 며칠 뒤 배차가 안 될 때에야 드러난다. 숫자를 치는 그 순간에
 * 알려 주면 그 왕복이 통째로 사라진다.
 *
 * 사용률 막대를 함께 그리는 이유는 "실린다" 와 "알맞다" 가 다르기
 * 때문이다. 25톤 트레일러에 1톤을 싣는 것은 실리기는 하지만 좋은 답이
 * 아니다.
 */
export function LoadVerdict({
  load,
  types,
  /** 폼에서 고른 요구 차종. 그 차가 못 싣는 짐이면 여기서 잡는다 */
  requiredTypeId,
  onPick,
}: {
  load: LoadInput;
  types: VehicleCapacity[];
  requiredTypeId?: string | null;
  /** 주면 줄을 눌러 요구 차종으로 고를 수 있다 */
  onPick?: (typeId: string) => void;
}) {
  const empty = load.weightKg <= 0 && load.volumeCbm <= 0 && load.palletQty <= 0;
  if (empty) {
    return (
      <p className="text-caption text-content-tertiary">
        품목의 중량·부피를 넣으면 실을 수 있는 차종을 알려 드립니다.
      </p>
    );
  }

  const fits = fitLoad(load, types);
  const usable = fits.filter((f) => f.fits);
  const picked = requiredTypeId ? fits.find((f) => f.type.id === requiredTypeId) : undefined;

  return (
    <div>
      {/* 고른 차종이 못 싣는 경우 — 목록보다 먼저 말한다 */}
      {picked && !picked.fits && (
        <p className="mb-2.5 rounded-md border border-status-danger/30 bg-status-danger-surface px-2.5 py-2 text-caption text-status-danger">
          고르신 <b>{picked.type.name}</b> 에는 이 짐이 안 실립니다 —{' '}
          {loadFitLabel(picked.reasons)}
        </p>
      )}
      {usable.length === 0 && (
        <p className="mb-2.5 rounded-md border border-status-danger/30 bg-status-danger-surface px-2.5 py-2 text-caption text-status-danger">
          등록된 차종 중에 이 짐을 한 번에 실을 수 있는 차가 없습니다. 오더를 나누거나
          차종을 늘리세요.
        </p>
      )}

      <ul className="space-y-1">
        {fits.map((f) => {
          const active = f.type.id === requiredTypeId;
          const Row = onPick ? 'button' : 'div';
          return (
            <li key={f.type.id}>
              <Row
                {...(onPick
                  ? {
                      type: 'button' as const,
                      onClick: () => onPick(f.type.id),
                      'aria-pressed': active,
                    }
                  : {})}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left',
                  onPick && 'transition-colors hover:bg-surface-sunken',
                  active && 'bg-surface-sunken ring-1 ring-inset ring-line-strong',
                )}
              >
                {f.fits ? (
                  <Check
                    size={13}
                    strokeWidth={2.5}
                    aria-hidden="true"
                    className="shrink-0 text-status-success"
                  />
                ) : (
                  <X
                    size={13}
                    strokeWidth={2.5}
                    aria-hidden="true"
                    className="shrink-0 text-content-tertiary"
                  />
                )}

                <span
                  className={cn(
                    'w-24 shrink-0 truncate text-caption',
                    f.fits ? 'text-content-primary' : 'text-content-tertiary',
                  )}
                >
                  {f.type.name}
                </span>

                {/* 사용률 — 100% 를 넘으면 넘친 만큼이 붉다 */}
                <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line-subtle">
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full',
                      !f.fits
                        ? 'bg-status-danger/60'
                        : f.utilization > 0.85
                          ? 'bg-status-success'
                          : 'bg-content-accent/50',
                    )}
                    style={{ width: `${Math.min(100, f.utilization * 100)}%` }}
                  />
                </span>

                <span
                  className={cn(
                    'tabular w-16 shrink-0 text-right text-[10px]',
                    f.fits ? 'text-content-secondary' : 'text-status-danger',
                  )}
                >
                  {f.fits ? `${Math.round(f.utilization * 100)}%` : loadFitLabel(f.reasons)}
                </span>
              </Row>
            </li>
          );
        })}
      </ul>

      {onPick && (
        <p className="mt-2 text-[10px] text-content-tertiary">
          줄을 누르면 요구 차종으로 지정됩니다. 비워 두면 편성이 알아서 고릅니다.
        </p>
      )}
    </div>
  );
}
