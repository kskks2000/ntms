'use client';

import { barTone, type BoardBar, type BoardVehicle } from '@ntms/shared';

/**
 * 거점축 다이어그램 (Marey 도표).
 *
 * 같은 하루를 다른 축으로 본 것이다.
 *   차량축(간트) — "이 차가 언제 비나"        → 배차를 붙일 때
 *   거점축(여기) — "이 거점에 언제 차가 오나"  → 환적 · 연계를 볼 때
 *
 * 세로축은 거점을 위도 순(북→남)으로 세운다. 선이 아래로 기울면 남하,
 * 위로 기울면 북상이다. 두 선이 한 거점에서 시간이 겹치면 그 자리가
 * 환적이 가능한 지점이고, 기울기가 완만할수록 느린 구간이다.
 *
 * 로그인 화면에서 예시로 보여준 그 도표에 실제 데이터를 채운 것이다.
 */

const VIEW_H_PER_LANE = 62;
const PAD_L = 132;
const PAD_R = 28;
const PAD_T = 30;
const PAD_B = 44;
const HOUR_WIDTH = 74;

const STROKE = {
  planned: 'text-content-tertiary',
  running: 'text-status-success',
  late: 'text-status-warning',
  done: 'text-content-tertiary/50',
  conflict: 'text-status-danger',
} as const;

interface Line {
  key: string;
  bar: BoardBar;
  vehicleNo: string;
  points: Array<{ t: number; lane: number }>;
}

export function LaneDiagram({
  vehicles,
  windowFrom,
  windowTo,
  now,
  selectedId,
  onSelect,
}: {
  vehicles: BoardVehicle[];
  windowFrom: string;
  windowTo: string;
  now: string;
  selectedId: string | null;
  onSelect: (bar: BoardBar, vehicle: BoardVehicle) => void;
}) {
  const from = Date.parse(windowFrom);
  const to = Date.parse(windowTo);
  const span = Math.max(to - from, 3_600_000);
  const hours = Math.ceil(span / 3_600_000);

  // --- 거점을 위도 순으로 세운다 -------------------------------------
  const laneMeta = new Map<string, number | null>();
  for (const v of vehicles) {
    for (const b of v.bars) {
      for (const s of b.stops) {
        if (!laneMeta.has(s.locationName)) laneMeta.set(s.locationName, s.latitude);
      }
    }
  }
  const lanes = [...laneMeta.entries()]
    .sort((a, b) => (b[1] ?? -90) - (a[1] ?? -90))
    .map(([name]) => name);
  const laneIndex = new Map(lanes.map((name, i) => [name, i]));

  const lines: Line[] = [];
  for (const v of vehicles) {
    for (const b of v.bars) {
      const points = b.stops
        .filter((s) => s.plannedArrivalAt !== null)
        .map((s) => ({
          t: Date.parse(s.plannedArrivalAt!),
          lane: laneIndex.get(s.locationName) ?? 0,
        }));
      if (points.length >= 2) {
        lines.push({ key: b.dispatchId, bar: b, vehicleNo: v.vehicleNo, points });
      }
    }
  }

  if (lanes.length === 0 || lines.length === 0) {
    return (
      <p className="px-6 py-16 text-center text-body text-content-secondary">
        거점축으로 그릴 운행이 없습니다. 배차가 잡히고 정차 계획이 생기면 나타납니다.
      </p>
    );
  }

  const plotW = hours * HOUR_WIDTH;
  const plotH = Math.max(1, lanes.length - 1) * VIEW_H_PER_LANE;
  const viewW = PAD_L + plotW + PAD_R;
  const viewH = PAD_T + plotH + PAD_B;

  const x = (t: number) => PAD_L + ((t - from) / span) * plotW;
  const y = (lane: number) => PAD_T + lane * VIEW_H_PER_LANE;
  const nowX = x(Date.parse(now));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        style={{ minWidth: viewW, height: viewH }}
        role="img"
        aria-label={`거점축 운행 다이어그램. 거점 ${lanes.length}곳, 운행 ${lines.length}건.`}
      >
        {/* --- 거점 기준선 --------------------------------------------- */}
        <g aria-hidden="true">
          {lanes.map((name, i) => (
            <g key={name}>
              <line
                x1={PAD_L}
                y1={y(i)}
                x2={PAD_L + plotW}
                y2={y(i)}
                stroke="currentColor"
                strokeWidth="1"
                className="text-line-subtle"
              />
              <text
                x={PAD_L - 12}
                y={y(i)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-content-secondary font-sans text-[13px]"
              >
                {name}
              </text>
            </g>
          ))}
        </g>

        {/* --- 시간 눈금 ------------------------------------------------ */}
        <g aria-hidden="true">
          {Array.from({ length: hours + 1 }).map((_, i) => {
            const tx = PAD_L + i * HOUR_WIDTH;
            return (
              <g key={i}>
                <line
                  x1={tx}
                  y1={PAD_T - 10}
                  x2={tx}
                  y2={PAD_T + plotH}
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-line-subtle/60"
                />
                <text
                  x={tx}
                  y={PAD_T + plotH + 22}
                  textAnchor="middle"
                  className="fill-content-tertiary font-mono text-[12px]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatHour(from + i * 3_600_000)}
                </text>
              </g>
            );
          })}
        </g>

        {/* --- 운행선 -------------------------------------------------- */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {lines.map((line) => {
            const tone = barTone(line.bar);
            const selected = selectedId === line.bar.dispatchId;
            const d = line.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.lane).toFixed(1)}`)
              .join(' ');

            return (
              <g
                key={line.key}
                className="cursor-pointer"
                onClick={() => {
                  const vehicle = vehicles.find((v) =>
                    v.bars.some((b) => b.dispatchId === line.bar.dispatchId),
                  );
                  if (vehicle) onSelect(line.bar, vehicle);
                }}
              >
                {/* 누르기 쉬우라고 깔아 두는 투명한 두꺼운 선 */}
                <path d={d} stroke="transparent" strokeWidth="16" />
                <path
                  d={d}
                  stroke="currentColor"
                  strokeWidth={selected ? 3.5 : 2}
                  className={STROKE[tone]}
                />
                {line.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={x(p.t)}
                    cy={y(p.lane)}
                    r={selected ? 4 : 3}
                    className={`${STROKE[tone]} fill-surface-card`}
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                ))}
                <title>
                  {`${line.bar.tripNo} · ${line.vehicleNo} · ${line.bar.driverName}`}
                </title>
              </g>
            );
          })}
        </g>

        {/* --- 지금 ---------------------------------------------------- */}
        {nowX >= PAD_L && nowX <= PAD_L + plotW && (
          <g aria-hidden="true">
            <line
              x1={nowX}
              y1={PAD_T - 18}
              x2={nowX}
              y2={PAD_T + plotH}
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="3 4"
              className="text-status-success"
            />
            <text
              x={nowX}
              y={PAD_T - 24}
              textAnchor="middle"
              className="fill-status-success font-sans text-[12px] font-medium"
            >
              지금
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function formatHour(ms: number): string {
  return `${String(new Date(ms).getHours()).padStart(2, '0')}:00`;
}
