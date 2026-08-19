'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * 운행 다이어그램 (Marey 도표).
 *
 * 세로축은 거점, 가로축은 시간이다. 한 선이 차량 한 대의 하루이고,
 * 기울어진 구간은 이동, 평평한 구간은 정차다. 선끼리 만나는 지점이
 * 환적이 가능한 시각이고, 기울기가 완만할수록 느린 구간이다.
 *
 * 19세기 파리-리옹 열차 시각표에서 온 형식인데, 지금도 이 산업에서
 * "계획과 실행을 한 눈에 겹쳐 보는" 가장 정확한 그림이다. NTMS 가
 * 하려는 일이 정확히 그것이라 로그인 화면의 얼굴로 삼았다.
 *
 * 여기 그려진 운행은 형식을 보여주기 위한 예시다. 실제 데이터는
 * 로그인 이후 배차판에서 같은 형식으로 나타난다.
 */

const STATIONS = [
  '파주 DC',
  '안성 CDC',
  '김천 허브',
  '양산 ICD',
  '부산신항 CY',
] as const;

/** 시간축 범위 (시) */
const T_START = 4;
const T_END = 24;

/** 좌표계 */
const VIEW_W = 780;
const VIEW_H = 452;
const PAD_L = 118;
const PAD_R = 26;
const PAD_T = 38;
const PAD_B = 52;

const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;
const ROW_H = PLOT_H / (STATIONS.length - 1);

const x = (hour: number) => PAD_L + ((hour - T_START) / (T_END - T_START)) * PLOT_W;
const y = (station: number) => PAD_T + station * ROW_H;

/** [시각, 거점] — 같은 거점이 연달아 오면 그 사이가 정차 시간이다 */
type Waypoint = readonly [number, number];

interface Trip {
  id: string;
  label: string;
  waypoints: Waypoint[];
}

/** 부산신항에서 파주까지 올라가는 간선. 오늘의 주인공 */
const FOCUS_TRIP: Trip = {
  id: 'focus',
  label: '부산신항 → 파주 DC 간선',
  waypoints: [
    [5.0, 4],
    [6.2, 4],
    [6.9, 3],
    [7.4, 3],
    [9.6, 2],
    [10.3, 2],
    [12.3, 1],
    [13.0, 1],
    [14.5, 0],
  ],
};

const TRIPS: Trip[] = [
  {
    id: 't1',
    label: '파주 DC → 부산신항 간선',
    waypoints: [
      [6.0, 0],
      [7.1, 0],
      [8.7, 1],
      [9.3, 1],
      [11.4, 2],
      [12.0, 2],
      [14.3, 3],
      [14.9, 3],
      [15.7, 4],
    ],
  },
  {
    id: 't2',
    label: '김천 허브 ↔ 안성 CDC 셔틀',
    waypoints: [
      [5.5, 2],
      [6.3, 2],
      [8.4, 1],
      [9.4, 1],
      [11.5, 2],
      [12.6, 2],
      [14.7, 1],
      [15.5, 1],
      [17.6, 2],
    ],
  },
  {
    id: 't3',
    label: '양산 ICD → 김천 허브',
    waypoints: [
      [9.0, 3],
      [10.2, 3],
      [12.0, 2],
      [13.4, 2],
      [15.2, 3],
    ],
  },
  {
    id: 't4',
    label: '안성 CDC → 파주 DC 지선',
    waypoints: [
      [13.5, 1],
      [14.2, 1],
      [15.7, 0],
      [16.6, 0],
      [18.1, 1],
    ],
  },
  {
    id: 't5',
    label: '부산신항 야간 간선',
    waypoints: [
      [17.0, 4],
      [18.4, 4],
      [19.1, 3],
      [19.6, 3],
      [21.8, 2],
      [22.6, 2],
    ],
  },
];

function toPath(waypoints: Waypoint[]): string {
  return waypoints
    .map(([hour, station], i) => `${i === 0 ? 'M' : 'L'}${x(hour).toFixed(1)} ${y(station).toFixed(1)}`)
    .join(' ');
}

/** 정차(같은 거점에 연달아 머무는 구간)의 시작점만 뽑는다 */
function dwellNodes(waypoints: Waypoint[]): Waypoint[] {
  return waypoints.filter((wp, i) => {
    const next = waypoints[i + 1];
    return next !== undefined && next[1] === wp[1];
  });
}

const TICKS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

export function TripDiagram({ className }: { className?: string }) {
  // 현재 시각은 마운트 후에만 그린다. 서버에서 렌더한 시각과 브라우저의
  // 시각이 다르면 하이드레이션이 어긋나기 때문이다.
  const [nowHour, setNowHour] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowHour(d.getHours() + d.getMinutes() / 60);
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const nowInRange =
    nowHour !== null && nowHour >= T_START && nowHour <= T_END ? nowHour : null;

  return (
    // 너비가 아니라 "남는 공간" 에 맞춘다. 세로로 짧은 화면에서 폭 기준으로
    // 키우면 다이어그램이 캔버스 밖으로 밀려 잘린다.
    <figure className={cn('flex min-h-0 items-center justify-center', className)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full max-h-full w-full"
        role="img"
        aria-label={`운행 다이어그램 예시. 세로축은 ${STATIONS.join(' · ')} 다섯 거점, 가로축은 오전 4시부터 자정까지의 시간이며, 여섯 대의 하루 운행이 겹쳐 그려져 있습니다.`}
      >
        {/* --- 거점 기준선 --------------------------------------------- */}
        <g aria-hidden="true">
          {STATIONS.map((name, i) => (
            <g
              key={name}
              className="animate-rise"
              style={{ animationDelay: `${120 + i * 45}ms` }}
            >
              <line
                x1={PAD_L}
                y1={y(i)}
                x2={VIEW_W - PAD_R}
                y2={y(i)}
                stroke="currentColor"
                strokeWidth="1"
                className="text-canvas-700"
              />
              <text
                x={PAD_L - 16}
                y={y(i)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-canvas-300 font-sans text-[15px]"
              >
                {name}
              </text>
            </g>
          ))}
        </g>

        {/* --- 시간 눈금 ------------------------------------------------ */}
        <g
          aria-hidden="true"
          className="animate-rise"
          style={{ animationDelay: '340ms' }}
        >
          <line
            x1={PAD_L}
            y1={VIEW_H - PAD_B + 14}
            x2={VIEW_W - PAD_R}
            y2={VIEW_H - PAD_B + 14}
            stroke="currentColor"
            strokeWidth="1"
            className="text-canvas-700"
          />
          {TICKS.map((hour) => (
            <g key={hour}>
              <line
                x1={x(hour)}
                y1={VIEW_H - PAD_B + 14}
                x2={x(hour)}
                y2={VIEW_H - PAD_B + 21}
                stroke="currentColor"
                strokeWidth="1"
                className="text-canvas-600"
              />
              <text
                x={x(hour)}
                y={VIEW_H - PAD_B + 38}
                textAnchor="middle"
                className="fill-canvas-400 font-mono text-[13px]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {String(hour % 24).padStart(2, '0')}
              </text>
            </g>
          ))}
        </g>

        {/* --- 배경 운행선 ---------------------------------------------- */}
        <g aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {TRIPS.map((trip, i) => (
            <path
              key={trip.id}
              d={toPath(trip.waypoints)}
              pathLength={1}
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-canvas-500"
              style={{
                strokeDasharray: 1,
                strokeDashoffset: 1,
                animation: `ntms-draw 1100ms var(--ease-out) ${420 + i * 110}ms forwards`,
              }}
            />
          ))}
        </g>

        {/* --- 오늘의 주인공 -------------------------------------------- */}
        <g aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d={toPath(FOCUS_TRIP.waypoints)}
            pathLength={1}
            stroke="currentColor"
            strokeWidth="2.25"
            className="text-jade-400"
            style={{
              strokeDasharray: 1,
              strokeDashoffset: 1,
              animation: 'ntms-draw 1500ms var(--ease-out) 980ms forwards',
            }}
          />
          {dwellNodes(FOCUS_TRIP.waypoints).map(([hour, station], i) => (
            <circle
              key={`${hour}-${station}`}
              cx={x(hour)}
              cy={y(station)}
              r="4"
              className="fill-canvas-850 stroke-jade-400"
              strokeWidth="2"
              style={{
                opacity: 0,
                animation: `ntms-fade 320ms var(--ease-out) ${1200 + i * 180}ms forwards`,
              }}
            />
          ))}
        </g>

        {/* --- 지금 ----------------------------------------------------- */}
        {nowInRange !== null && (
          <g aria-hidden="true" style={{ opacity: 0, animation: 'ntms-fade 400ms var(--ease-out) 2200ms forwards' }}>
            <line
              x1={x(nowInRange)}
              y1={PAD_T - 18}
              x2={x(nowInRange)}
              y2={VIEW_H - PAD_B + 14}
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="3 4"
              className="text-jade-300"
            />
            <text
              x={x(nowInRange)}
              y={PAD_T - 26}
              textAnchor="middle"
              className="fill-jade-300 font-sans text-[13px] font-medium"
            >
              지금
            </text>
          </g>
        )}
      </svg>

      <figcaption className="sr-only">
        거점과 시간을 두 축으로 놓고 하루의 운행을 겹쳐 그린 예시입니다.
        기울어진 구간은 이동, 평평한 구간은 정차를 뜻합니다.
      </figcaption>
    </figure>
  );
}
