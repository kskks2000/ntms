import { buildDayBand, type DayBandSegment, type VehicleDayRow } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 하루 띠 — 24시간을 한 줄로 펴고 돈을 번 시간만 채운다.
 *
 * 운행일보를 "총 주행 몇 km" 로 만들면 표가 되고, 표는 아무것도 안 알려
 * 준다. 관리자가 알아야 하는 것은 **하루 중 얼마가 돈을 벌었나** 다.
 *
 * 편차 축과 다른 축을 쓰는 이유는 묻는 것이 다르기 때문이다. 편차 축은
 * "계획에서 얼마나 벗어났나" 를 묻고, 이 띠는 "하루가 무엇으로 채워졌나" 를
 * 묻는다. 여기에 0선은 없다 — 하루의 길이는 누구에게나 같으므로 왼쪽 끝에서
 * 시작해 오른쪽 끝까지가 축이다.
 */
const SEGMENT_STYLE: Record<DayBandSegment['key'], { fill: string; swatch: string }> = {
  // 주행만 옥색이다. 이 시스템에서 옥색은 살아 있는 것 — 여기서는 돈을 버는 시간.
  driving: { fill: 'bg-accent', swatch: 'bg-accent' },
  waiting: { fill: 'bg-status-warning/55', swatch: 'bg-status-warning/55' },
  idle: { fill: 'bg-content-tertiary/45', swatch: 'bg-content-tertiary/45' },
  rest: { fill: 'bg-content-tertiary/20', swatch: 'bg-content-tertiary/20' },
  off: { fill: 'bg-surface-sunken', swatch: 'bg-surface-sunken border border-line-subtle' },
};

export function DayBand({ row }: { row: VehicleDayRow }) {
  const segments = buildDayBand(row);

  return (
    <div
      className="relative flex h-3.5 w-full overflow-hidden rounded-sm bg-surface-sunken"
      role="img"
      aria-label={
        row.isOperated
          ? segments.map((s) => `${s.label} ${formatMinutes(s.minutes)}`).join(', ')
          : `미가동 — ${row.nonOperationReason ?? '사유 없음'}`
      }
    >
      {segments.map((s) => (
        <span
          key={s.key}
          title={`${s.label} ${formatMinutes(s.minutes)}`}
          className={cn('h-full', SEGMENT_STYLE[s.key].fill)}
          style={{ width: `${s.percent}%` }}
        />
      ))}

      {/* 6시간마다 눈금. 띠가 어느 지점에서 끊겼는지 세지 않고 읽히게 한다 */}
      {[25, 50, 75].map((p) => (
        <span
          key={p}
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-surface-card/70"
          style={{ left: `${p}%` }}
        />
      ))}
    </div>
  );
}

/**
 * 띠의 범례.
 *
 * 범례 없는 그림은 그림에 그친다. 공회전이 실측이 아니라는 것도 여기서
 * 밝힌다 — 화면이 자기 숫자의 출처를 감추기 시작하면 그 숫자로 아무도
 * 결정을 못 한다.
 */
export function DayBandLegend() {
  const items: { key: DayBandSegment['key']; label: string }[] = [
    { key: 'driving', label: '주행' },
    { key: 'waiting', label: '대기' },
    { key: 'idle', label: '공회전' },
    { key: 'rest', label: '휴게' },
    { key: 'off', label: '미가동' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.key} className="flex items-center gap-1.5 text-caption text-content-tertiary">
          <span
            aria-hidden="true"
            className={cn('h-2.5 w-4 rounded-[2px]', SEGMENT_STYLE[i.key].swatch)}
          />
          {i.label}
        </span>
      ))}
      <span className="text-caption text-content-tertiary">
        · 띠 전체가 24시간, 눈금은 6시간입니다. 공회전은 가동시간에서 주행·대기·휴게를 뺀
        나머지이며 DTG 를 연동하면 실측으로 바뀝니다.
      </span>
    </div>
  );
}

/**
 * 실차 대 공차.
 *
 * 하루 띠가 시간을 나눈다면 이 막대는 거리를 나눈다. 두 막대를 나란히 두면
 * "오래 굴렸는데 실차가 적은 차" 가 눈에 걸린다 — 그게 배차가 손대야 할 차다.
 */
export function LoadedBar({
  loaded,
  total,
}: {
  loaded: number | null;
  total: number;
}) {
  if (loaded === null || total <= 0) {
    return <span className="text-caption text-content-tertiary">계기판 없음</span>;
  }
  const pct = Math.min(100, (loaded / total) * 100);
  const emptyPct = 100 - pct;

  return (
    <span className="flex items-center gap-2">
      <span
        className="relative flex h-2 w-20 shrink-0 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`실차 ${pct.toFixed(0)}%, 공차 ${emptyPct.toFixed(0)}%`}
      >
        <span className="h-full bg-content-secondary/60" style={{ width: `${pct}%` }} />
        <span
          className={cn('h-full', emptyPct >= 30 ? 'bg-status-warning' : 'bg-status-warning/40')}
          style={{ width: `${emptyPct}%` }}
        />
      </span>
      <span
        className={cn(
          'tabular text-caption',
          emptyPct >= 30 ? 'font-medium text-status-warning' : 'text-content-secondary',
        )}
      >
        공차 {emptyPct.toFixed(0)}%
      </span>
    </span>
  );
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0분';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
