'use client';

import { Phone, Radio, TriangleAlert } from 'lucide-react';
import { EXECUTION_STATUS_LABEL, type ExecutionCard } from '@ntms/shared';
import { cn } from '@/lib/cn';

/** 아직 도로 위에 있는 상태 */
const RUNNING = ['READY', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING'];

/**
 * 운행 목록.
 *
 * 정렬은 서버가 정한다 — **운행 중인 건이 먼저**, 그 안에서 마감 위험 ·
 * 지연 순이다. 차량번호순으로 두면 손이 필요한 건을 스크롤로 찾아야 하고,
 * 스무 대가 넘어가면 못 찾는다.
 *
 * 한 줄이 답하는 것은 셋이다. 어느 차인가 · 얼마나 왔나 · 지금 괜찮은가.
 * 세 번째가 이 줄의 본론이므로 오른쪽 끝에 두지 않고 색으로 먼저 말한다.
 */
export function ExecutionRail({
  executions,
  selectedId,
  onSelect,
}: {
  executions: ExecutionCard[];
  selectedId: string | null;
  onSelect: (e: ExecutionCard) => void;
}) {
  return (
    <ul className="divide-y divide-line-subtle">
      {executions.map((e) => (
        <li key={e.executionId}>
          <button
            type="button"
            onClick={() => onSelect(e)}
            aria-current={selectedId === e.executionId ? 'true' : undefined}
            className={cn(
              'w-full px-4 py-3 text-left transition-colors duration-fast',
              'hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
              selectedId === e.executionId && 'bg-surface-sunken',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="tabular truncate text-label font-semibold text-content-primary">
                {e.vehicleNo}
              </span>
              <StatusPill status={e.status} />
            </div>

            <p className="mt-0.5 flex items-center gap-1.5 truncate text-caption text-content-tertiary">
              <span className="tabular">{e.tripNo}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{e.carrierName}</span>
            </p>

            <ProgressTrack
              done={e.completedStopCount}
              total={e.totalStopCount}
              rate={e.progressRate}
              tone={e.breachCount > 0 ? 'danger' : e.delayMinutes > 10 ? 'warning' : 'calm'}
            />

            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-caption">
              <Verdict card={e} />
              {e.openExceptionCount > 0 && (
                <span className="flex items-center gap-1 text-status-warning">
                  <TriangleAlert size={11} strokeWidth={2} aria-hidden="true" />
                  예외 {e.openExceptionCount}
                </span>
              )}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 이 줄의 본론 — 지금 괜찮은가 */
function Verdict({ card }: { card: ExecutionCard }) {
  const running = RUNNING.includes(card.status);

  if (card.breachCount > 0) {
    // 끝난 건에 '예상' 이라고 적으면 이미 벌어진 일이 아직 막을 수 있는
    // 일처럼 읽힌다. 목록에서 둘이 섞이면 어느 쪽에 손대야 할지 흐려진다.
    return (
      <span className="font-medium text-status-danger">
        마감 {card.breachCount}곳 초과{running ? ' 예상' : ''}
      </span>
    );
  }
  if (card.nextStopName) {
    return (
      <span className="truncate text-content-secondary">
        다음 {card.nextStopName}
        <span className="tabular ml-1 text-content-tertiary">{hhmm(card.nextStopEtaAt)}</span>
        {card.headroomMinutes !== null && card.headroomMinutes < 30 && (
          <span className="tabular ml-1.5 text-status-warning">
            여유 {card.headroomMinutes}분
          </span>
        )}
      </span>
    );
  }
  if (card.delayMinutes > 0) {
    return (
      <span className="tabular text-content-tertiary">{card.delayMinutes}분 늦게 종료</span>
    );
  }
  return <span className="text-content-tertiary">정시 종료</span>;
}

/**
 * 진행 막대.
 *
 * 길이는 정차 기준 진행률, 색은 지연 여부다. 두 가지를 한 막대에 얹는
 * 이유는, 담당자가 실제로 묶어서 보기 때문이다 — "8할 왔는데 40분 늦음"
 * 과 "2할 왔는데 40분 늦음" 은 완전히 다른 상황이다.
 */
function ProgressTrack({
  done,
  total,
  rate,
  tone,
}: {
  done: number;
  total: number;
  rate: number;
  tone: 'calm' | 'warning' | 'danger';
}) {
  const pct = Math.max(0, Math.min(100, rate));
  const fill = {
    calm: 'bg-accent/70',
    warning: 'bg-status-warning/80',
    danger: 'bg-status-danger',
  }[tone];

  return (
    <div className="mt-2 flex items-center gap-2">
      <div
        className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`정차 ${total}곳 중 ${done}곳 완료`}
      >
        <div className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular shrink-0 text-caption text-content-tertiary">
        {done}/{total}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const skin =
    status === 'COMPLETED'
      ? 'border-line-subtle bg-surface-sunken text-content-tertiary'
      : status === 'SUSPENDED' || status === 'CANCELLED'
        ? 'border-status-danger/30 bg-status-danger-surface text-status-danger'
        : 'border-status-success/30 bg-status-success-surface text-status-success';

  return (
    <span
      className={cn(
        'eyebrow-ko shrink-0 rounded-full border px-1.5 py-px leading-tight',
        skin,
      )}
    >
      {EXECUTION_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * 차량 · 기사 · 마지막 수신.
 *
 * **마지막 수신 시각을 숨기지 않는다.** 단말이 끊긴 차는 지도 위에서
 * 마지막 위치에 멀쩡히 서 있어서, 시각을 안 보면 40분 전 위치를 지금
 * 위치로 믿는다. 이 화면에서 가장 조용하게 틀리는 방식이 그것이다.
 */
export function VehicleStrip({
  vehicleNo,
  carrierName,
  driverName,
  driverMobile,
  lastLocationAt,
  lastSpeedKmh,
  actualDistanceKm,
  plannedDistanceKm,
}: {
  vehicleNo: string;
  carrierName: string;
  driverName: string | null;
  driverMobile: string | null;
  lastLocationAt: string | null;
  lastSpeedKmh: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
}) {
  const age = staleMinutes(lastLocationAt);
  const stale = age !== null && age > 20;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line-subtle px-4 py-3">
      <div>
        <p className="tabular text-label font-semibold text-content-primary">{vehicleNo}</p>
        <p className="text-caption text-content-tertiary">{carrierName}</p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-label text-content-primary">{driverName ?? '기사 미정'}</p>
        {driverMobile && (
          <a
            href={`tel:${driverMobile.replace(/-/g, '')}`}
            className="tabular flex items-center gap-1 text-caption text-content-accent hover:underline"
          >
            <Phone size={11} strokeWidth={2} aria-hidden="true" />
            {driverMobile}
          </a>
        )}
      </div>

      <div className="ml-auto flex items-center gap-5">
        <div className="text-right">
          <p className="eyebrow-ko text-content-tertiary">주행</p>
          <p className="tabular text-label text-content-primary">
            {actualDistanceKm === null ? '—' : `${Math.round(actualDistanceKm)}km`}
            {plannedDistanceKm !== null && (
              <span className="text-caption text-content-tertiary">
                {' '}
                / {Math.round(plannedDistanceKm)}
              </span>
            )}
          </p>
        </div>

        <div className="text-right">
          <p className="eyebrow-ko text-content-tertiary">최근 수신</p>
          <p
            className={cn(
              'tabular flex items-center justify-end gap-1 text-label',
              stale ? 'text-status-warning' : 'text-content-primary',
            )}
          >
            <Radio size={12} strokeWidth={2} aria-hidden="true" />
            {age === null ? '—' : age < 1 ? '방금' : `${age}분 전`}
            {lastSpeedKmh !== null && !stale && (
              <span className="text-content-tertiary"> · {Math.round(lastSpeedKmh)}km/h</span>
            )}
          </p>
        </div>
      </div>

      {stale && (
        <p className="w-full text-caption text-status-warning">
          단말 신호가 {age}분째 끊겼습니다. 지도의 위치는 그때 것이므로 지금 위치로
          믿으면 안 됩니다.
        </p>
      )}
    </div>
  );
}

function staleMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

function hhmm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
