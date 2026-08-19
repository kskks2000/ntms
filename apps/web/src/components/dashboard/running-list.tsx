'use client';

import { Truck } from 'lucide-react';
import { EXECUTION_STATUS_LABEL, type RunningTrip } from '@ntms/shared';
import { EmptyState } from '@/components/tms/panels';
import { cn } from '@/lib/cn';

/**
 * 지금 도로 위.
 *
 * 진행률을 막대로 그리되, 계획 대비 얼마나 늦었는지를 **같은 막대 위에**
 * 표시한다. 진행률과 지연을 따로 두면 "80% 왔는데 왜 늦었지" 를 두 번
 * 읽어야 한다. 지연이 있는 차는 막대 색이 바뀌고 분 수가 붙는다.
 */
export function RunningList({ trips }: { trips: RunningTrip[] }) {
  if (trips.length === 0) {
    return (
      <EmptyState
        icon={<Truck size={26} strokeWidth={1.5} />}
        title="운행 중인 차량이 없습니다"
        description="배차된 트립이 출발하면 여기에 나타납니다."
      />
    );
  }

  return (
    <ul className="divide-y divide-line-subtle">
      {trips.map((trip) => {
        const delayed = trip.delayMinutes > 0;
        const severe = trip.delayMinutes >= 60;

        return (
          <li key={trip.tripId} className="px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-caption text-content-tertiary">
                {trip.tripNo}
              </span>
              <span className="tabular text-body font-medium text-content-primary">
                {trip.vehicleNo}
              </span>
              <span className="truncate text-caption text-content-secondary">
                {trip.driverName} · {trip.carrierName}
              </span>
              <span
                className={cn(
                  'tabular ml-auto shrink-0 text-caption',
                  severe
                    ? 'font-medium text-status-danger'
                    : delayed
                      ? 'font-medium text-status-warning'
                      : 'text-content-tertiary',
                )}
              >
                {delayed ? `${trip.delayMinutes}분 지연` : EXECUTION_STATUS_LABEL[trip.status] ?? trip.status}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <span className="truncate text-caption text-content-secondary">
                {trip.fromName}
              </span>
              <span aria-hidden="true" className="shrink-0 text-content-tertiary">
                →
              </span>
              <span className="truncate text-caption text-content-secondary">
                {trip.toName}
              </span>
              <span className="tabular ml-auto shrink-0 text-caption text-content-tertiary">
                {Math.round(trip.progressRate)}%
              </span>
            </div>

            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuenow={Math.round(trip.progressRate)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${trip.tripNo} 진행률`}
            >
              <span
                className={cn(
                  'block h-full rounded-full transition-[width] duration-slow ease-out',
                  severe
                    ? 'bg-status-danger'
                    : delayed
                      ? 'bg-status-warning'
                      : 'bg-status-success',
                )}
                style={{ width: `${Math.max(2, Math.min(100, trip.progressRate))}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
