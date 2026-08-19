'use client';

import { AlertTriangle } from 'lucide-react';
import { barTone, type BoardBar, type BoardVehicle } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 배차판 — 차량 × 시간.
 *
 * 막대 하나에 계획과 실행을 **겹쳐** 그린다. 이 제품이 하겠다고 한 일이
 * "계획과 실행의 차이를 남기는 것" 이기 때문이다.
 *
 *   ┌──────────────────────────────┐
 *   │ TR…0011  부산신항 CY → 파주 DC │  ← 막대 전체 = 계획 구간
 *   │ ███████████░░░░░░░░░░  +45분  │  ← 채운 부분 = 실제 진행, 꼬리 = 지연
 *   └──────────────────────────────┘
 *
 * 간트를 계획용과 실적용으로 두 개 그리는 제품이 많은데, 그러면 사람이
 * 두 화면을 번갈아 보며 머릿속에서 빼기를 해야 한다. 차이는 시스템이
 * 계산해서 한 자리에 놓아야 한다.
 */

/** 한 시간당 픽셀. 좁히면 하루가 다 들어오지만 막대 안 글자가 사라진다 */
const HOUR_WIDTH = 78;
const LABEL_WIDTH = 208;
const ROW_HEIGHT = 46;

const TONE = {
  planned: {
    bar: 'bg-surface-sunken border-line-strong',
    text: 'text-content-secondary',
    fill: 'bg-content-tertiary/25',
  },
  running: {
    bar: 'bg-status-success-surface border-status-success/40',
    text: 'text-status-success',
    fill: 'bg-status-success/35',
  },
  late: {
    bar: 'bg-status-warning-surface border-status-warning/45',
    text: 'text-status-warning',
    fill: 'bg-status-warning/35',
  },
  done: {
    bar: 'bg-surface-card border-line-subtle',
    text: 'text-content-tertiary',
    fill: 'bg-content-tertiary/15',
  },
  conflict: {
    bar: 'bg-status-danger-surface border-status-danger',
    text: 'text-status-danger',
    fill: 'bg-status-danger/25',
  },
} as const;

export function GanttBoard({
  vehicles,
  windowFrom,
  windowTo,
  now,
  selectedId,
  onSelect,
  showIdleVehicles,
}: {
  vehicles: BoardVehicle[];
  windowFrom: string;
  windowTo: string;
  now: string;
  selectedId: string | null;
  onSelect: (bar: BoardBar, vehicle: BoardVehicle) => void;
  showIdleVehicles: boolean;
}) {
  const from = Date.parse(windowFrom);
  const to = Date.parse(windowTo);
  const span = Math.max(to - from, 3_600_000);
  const hours = Math.ceil(span / 3_600_000);
  const trackWidth = hours * HOUR_WIDTH;

  /** 시각 → 트랙 안의 픽셀 위치 */
  const px = (iso: string) => ((Date.parse(iso) - from) / span) * trackWidth;

  const rows = showIdleVehicles ? vehicles : vehicles.filter((v) => v.bars.length > 0);
  const nowPx = px(now);
  const nowVisible = nowPx >= 0 && nowPx <= trackWidth;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: LABEL_WIDTH + trackWidth }}>
        {/* --- 시간 눈금 ------------------------------------------------ */}
        <div className="sticky top-0 z-20 flex border-b border-line-subtle bg-surface-card">
          <div
            className="sticky left-0 z-10 shrink-0 border-r border-line-subtle bg-surface-card px-3 py-2 text-label font-medium text-content-secondary"
            style={{ width: LABEL_WIDTH }}
          >
            차량
          </div>
          <div className="relative" style={{ width: trackWidth, height: 34 }}>
            {Array.from({ length: hours + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 flex h-full items-center"
                style={{ left: i * HOUR_WIDTH }}
              >
                <span className="tabular -translate-x-1/2 px-1 text-caption text-content-tertiary">
                  {formatHour(from + i * 3_600_000)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* --- 차량 줄 -------------------------------------------------- */}
        <div className="relative">
          {/* 지금 — 모든 줄을 관통한다 */}
          {nowVisible && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-10 h-full border-l border-dashed border-status-success"
              style={{ left: LABEL_WIDTH + nowPx }}
            >
              <span className="eyebrow-ko absolute -top-0.5 left-1 rounded-sm bg-status-success px-1 text-content-inverse">
                지금
              </span>
            </div>
          )}

          {rows.map((vehicle) => (
            <div
              key={vehicle.vehicleId}
              className="flex border-b border-line-subtle"
              style={{ height: ROW_HEIGHT }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-line-subtle bg-surface-card px-3"
                style={{ width: LABEL_WIDTH }}
              >
                <span className="tabular truncate text-body font-medium text-content-primary">
                  {vehicle.vehicleNo}
                </span>
                <span className="truncate text-caption text-content-tertiary">
                  {vehicle.vehicleTypeName} · {vehicle.carrierName}
                </span>
              </div>

              <div className="relative" style={{ width: trackWidth }}>
                {/* 시간 격자 — 막대 위치를 눈으로 읽는 근거 */}
                {Array.from({ length: hours }).map((_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="absolute top-0 h-full border-l border-line-subtle/60"
                    style={{ left: (i + 1) * HOUR_WIDTH }}
                  />
                ))}

                {vehicle.bars.map((bar) => (
                  <Bar
                    key={bar.dispatchId}
                    bar={bar}
                    left={px(bar.plannedStartAt)}
                    width={px(bar.plannedEndAt) - px(bar.plannedStartAt)}
                    hourWidth={HOUR_WIDTH}
                    selected={selectedId === bar.dispatchId}
                    onSelect={() => onSelect(bar, vehicle)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({
  bar,
  left,
  width,
  hourWidth,
  selected,
  onSelect,
}: {
  bar: BoardBar;
  left: number;
  width: number;
  hourWidth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = TONE[barTone(bar)];

  // 계획 구간이 아주 짧아도 누를 수는 있어야 한다
  const planWidth = Math.max(width, 26);
  // 지연분은 계획 끝을 넘어 꼬리로 뻗는다 — 이것이 "차이" 다
  const delayWidth = (bar.delayMinutes / 60) * hourWidth;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${bar.tripNo} · ${bar.fromName} → ${bar.toName}\n${bar.driverName} · ${bar.carrierName}\n계획 ${formatClock(bar.plannedStartAt)}–${formatClock(bar.plannedEndAt)}${bar.delayMinutes > 0 ? `\n${bar.delayMinutes}분 지연` : ''}`}
      aria-label={`${bar.tripNo} ${bar.fromName}에서 ${bar.toName}, ${bar.driverName}${bar.delayMinutes > 0 ? `, ${bar.delayMinutes}분 지연` : ''}`}
      className={cn(
        'group absolute top-1.5 flex flex-col justify-center overflow-hidden rounded-md border text-left transition-shadow duration-fast',
        tone.bar,
        selected && 'ring-2 ring-accent ring-offset-1 ring-offset-surface-card',
      )}
      style={{ left, width: planWidth, height: ROW_HEIGHT - 14 }}
    >
      {/* 실제 진행분 — 막대 안을 왼쪽부터 채운다 */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0', tone.fill)}
        style={{ width: `${Math.min(100, Math.max(0, bar.progressRate))}%` }}
      />

      <span className="relative flex items-center gap-1 px-1.5">
        {bar.hasConflict && (
          <AlertTriangle
            size={11}
            strokeWidth={2.25}
            aria-hidden="true"
            className="shrink-0 text-status-danger"
          />
        )}
        <span className={cn('tabular truncate text-[11px] font-medium', tone.text)}>
          {bar.tripNo.slice(-5)}
        </span>
        <span className="truncate text-[11px] text-content-secondary">
          {bar.driverName}
        </span>
      </span>
      <span className="relative truncate px-1.5 text-[11px] text-content-tertiary">
        {bar.fromName} → {bar.toName}
      </span>

      {/* 지연 꼬리 */}
      {delayWidth > 2 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 right-0 translate-x-full"
          style={{ width: delayWidth }}
        >
          <span className="block h-full rounded-r-md bg-status-danger/25 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(var(--status-danger)/0.35)_3px,rgb(var(--status-danger)/0.35)_6px)]" />
        </span>
      )}
    </button>
  );
}

function formatHour(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
