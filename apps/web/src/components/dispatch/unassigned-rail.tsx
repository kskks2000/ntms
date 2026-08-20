'use client';

import { CheckCircle2, Truck } from 'lucide-react';
import {
  TRIP_STATUS_LABEL,
  TRIP_STATUS_PHASE,
  type BoardBar,
  type BoardVehicle,
  type UnassignedTrip,
} from '@ntms/shared';
import { EmptyState } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { cn } from '@/lib/cn';

/**
 * 미배차 트립 — 배차 담당자의 일감 목록.
 *
 * 출발이 임박한 것부터 위로 온다. 목록 순서 자체가 "먼저 손대야 할 것" 을
 * 말해야 하고, 그러면 사람이 정렬 조건을 고르지 않아도 된다.
 */
export function UnassignedRail({
  trips,
  onAssign,
}: {
  trips: UnassignedTrip[];
  /** 주면 줄을 눌러 바로 배차할 수 있다 */
  onAssign?: (trip: UnassignedTrip) => void;
}) {
  if (trips.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={24} strokeWidth={1.5} />}
        title="배차를 기다리는 트립이 없습니다"
        description="편성된 트립에 모두 차량이 붙었습니다."
      />
    );
  }

  return (
    <ul className="divide-y divide-line-subtle">
      {trips.map((trip) => {
        const urgent = trip.minutesToStart !== null && trip.minutesToStart <= 120;
        const passed = trip.minutesToStart !== null && trip.minutesToStart < 0;

        return (
          <li
            key={trip.tripId}
            className={cn('px-4 py-3', onAssign && 'transition-colors hover:bg-surface-sunken')}
          >
            <div className="flex items-baseline gap-2">
              <span className="tabular text-caption text-content-tertiary">
                {trip.tripNo}
              </span>
              <StatusChip
                label={TRIP_STATUS_LABEL[trip.status] ?? trip.status}
                phase={TRIP_STATUS_PHASE[trip.status] ?? 'planned'}
              />
              {trip.minutesToStart !== null && (
                <span
                  className={cn(
                    'tabular ml-auto shrink-0 text-caption',
                    passed
                      ? 'font-medium text-status-danger'
                      : urgent
                        ? 'font-medium text-status-warning'
                        : 'text-content-tertiary',
                  )}
                >
                  {formatLead(trip.minutesToStart)}
                </span>
              )}
            </div>

            <p className="mt-1 flex items-center gap-1.5 text-body text-content-primary">
              <span className="truncate">{trip.fromName}</span>
              <span aria-hidden="true" className="shrink-0 text-content-tertiary">
                →
              </span>
              <span className="truncate">{trip.toName}</span>
            </p>

            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-caption text-content-tertiary">
              <span className="tabular">{trip.orderCount}건</span>
              <span className="tabular">
                {Math.round(trip.weightKg).toLocaleString('ko-KR')}kg
              </span>
              {trip.requiredVehicleTypeName && <span>{trip.requiredVehicleTypeName}</span>}
              {/*
                운송사가 정해졌는지가 배차 담당자의 다음 행동을 가른다.
                정해졌으면 차를 붙이면 되고, 아니면 배정부터 해야 한다.
              */}
              {trip.carrierName ? (
                <span className="text-content-secondary">{trip.carrierName}</span>
              ) : (
                <span className="text-status-warning">운송사 미정</span>
              )}
            </p>

            {/*
              운송사가 정해진 것만 배차 단추를 준다. 안 정해진 트립에
              단추를 보이면 눌러 보고 나서야 "배정 먼저" 라는 말을 듣는다.
            */}
            {onAssign && trip.carrierName && (
              <button
                type="button"
                onClick={() => onAssign(trip)}
                className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-line-field bg-surface-card px-2.5 text-caption font-medium text-content-primary transition-colors hover:bg-surface-sunken"
              >
                <Truck size={12} strokeWidth={2} aria-hidden="true" />
                차량 붙이기
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 선택한 배차의 상세.
 *
 * 막대를 누르면 여기에 펼친다. 별도 화면으로 넘기지 않는 이유는, 배차판에서
 * 하는 일이 "여러 개를 견주어 보는 것" 이라 화면을 떠나면 맥락이 끊기기 때문이다.
 */
export function BarDetail({
  bar,
  vehicle,
  onClose,
}: {
  bar: BoardBar;
  vehicle: BoardVehicle;
  onClose: () => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="tabular text-caption text-content-tertiary">{bar.dispatchNo}</p>
          <p className="tabular text-title-sm font-semibold text-content-primary">
            {vehicle.vehicleNo}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-sm text-caption text-content-tertiary underline-offset-4 hover:text-content-primary hover:underline"
        >
          닫기
        </button>
      </div>

      <dl className="mt-3 space-y-1.5">
        <Row label="트립">
          <span className="tabular">{bar.tripNo}</span>
        </Row>
        <Row label="기사">
          {bar.driverName} · {bar.carrierName}
        </Row>
        <Row label="차종">
          {vehicle.vehicleTypeName}
          {vehicle.tonClass !== null && (
            <span className="tabular text-content-tertiary"> · {vehicle.tonClass}t</span>
          )}
        </Row>
        <Row label="적재">
          <span className="tabular">{bar.orderCount}</span>건 ·{' '}
          <span className="tabular">
            {Math.round(bar.weightKg).toLocaleString('ko-KR')}
          </span>
          kg
        </Row>
      </dl>

      {/* 정차 계획 — 로그인 화면의 축·마디 언어를 그대로 쓴다 */}
      <ol className="mt-4 space-y-0">
        {bar.stops.map((stop, i) => (
          <li key={`${stop.locationName}-${i}`} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="relative flex w-3 shrink-0 justify-center"
            >
              <span className="absolute inset-y-0 w-px bg-line-strong" />
              <span
                className={cn(
                  'relative mt-1.5 h-2 w-2 shrink-0 rounded-full ring-2 ring-surface-card',
                  i === 0 ? 'bg-content-primary' : 'bg-content-tertiary',
                )}
              />
            </span>
            <span className="min-w-0 flex-1 pb-3">
              <span className="flex items-baseline gap-2">
                <span className="text-body text-content-primary">{stop.locationName}</span>
                <span className="tabular ml-auto text-caption text-content-tertiary">
                  {stop.plannedArrivalAt ? formatClock(stop.plannedArrivalAt) : '—'}
                </span>
              </span>
              <span className="text-caption text-content-tertiary">
                {stop.stopType === 'PICKUP' ? '상차' : stop.stopType === 'DELIVERY' ? '하차' : '경유'}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {/* 계획과 실행의 차이 — 이 제품이 남기겠다고 한 그것 */}
      <div className="mt-1 rounded-md border border-line-subtle bg-surface-sunken px-3 py-2.5">
        <p className="eyebrow-ko text-content-tertiary">계획 대비</p>
        <div className="mt-1.5 space-y-1">
          <Row label="계획">
            <span className="tabular">
              {formatClock(bar.plannedStartAt)}–{formatClock(bar.plannedEndAt)}
            </span>
          </Row>
          <Row label="실제 출발">
            <span className="tabular">
              {bar.actualStartAt ? formatClock(bar.actualStartAt) : '출발 전'}
            </span>
          </Row>
          <Row label="진행">
            <span className="tabular">{Math.round(bar.progressRate)}%</span>
          </Row>
          <Row label="지연">
            {bar.delayMinutes > 0 ? (
              <span className="tabular font-medium text-status-danger">
                +{bar.delayMinutes}분
              </span>
            ) : (
              <span className="text-content-tertiary">없음</span>
            )}
          </Row>
        </div>
      </div>

      {bar.hasConflict && (
        <p className="mt-3 flex items-start gap-1.5 text-caption text-status-danger">
          <Truck size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            같은 차량의 다른 배차와 시간이 겹칩니다. 한쪽을 다른 차로 옮기거나
            출발 시각을 조정하세요.
          </span>
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-body">
      <dt className="w-16 shrink-0 text-caption text-content-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-content-primary">{children}</dd>
    </div>
  );
}

function formatLead(minutes: number): string {
  if (minutes < 0) {
    const abs = Math.abs(minutes);
    return abs < 60 ? `${abs}분 지남` : `${Math.round(abs / 60)}시간 지남`;
  }
  return minutes < 60 ? `${minutes}분 뒤` : `${Math.round(minutes / 60)}시간 뒤`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
