'use client';

import {
  clockToMinutes,
  daysBetween,
  evaluateSpine,
  formatDuration,
  minutesToClock,
  type SpineVerdict,
  type TimeSpineInput,
} from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 시간 축 — 이 오더가 시간상 성립하는가.
 *
 * ## 왜 이 장치가 필요한가
 *
 * 오더 폼에는 날짜 두 칸, 시각 네 칸이 따로 놓인다. 각각은 전부 정상인데
 * 함께 놓으면 성립하지 않는 조합이 흔하다 — 상차 마감 14:00, 하차 마감
 * 15:00, 구간 5시간. 사람이 이걸 암산으로 잡아내야 한다면 하루 오십 건을
 * 치는 접수 담당자에게는 사실상 못 잡는 것이고, 실제로는 며칠 뒤 편성이
 * 후보를 못 찾을 때에야 드러난다.
 *
 * ## 이 앱의 축 어휘를 잇는다
 *
 *   관제 현황   축 위로 흐르고 축 아래로 쌓인다
 *   배차판     계획 막대 위에 실적을 겹친다
 *   기준정보    남은 날을 막대 길이로
 *   여기       상차창과 하차창 사이에 소요시간이 들어가는가
 *
 * 간트는 **이미 배정된 것**을 그린다. 이건 **아직 없는 것이 들어갈 자리가
 * 있는지**를 그린다. 방향이 반대다.
 *
 * ## 읽는 법
 *
 * 두 막대를 같은 시간 축에 올린다. 아래 막대(하차창) 위에 **도착 가능
 * 구간**을 겹쳐 그린다 — 가장 일찍 상차했을 때부터 가장 늦게 상차했을
 * 때까지 도착이 떨어지는 범위다. 그 구간이 하차창 안에 들어오면 성립하고,
 * 오른쪽으로 삐져나오면 그만큼이 못 지키는 몫이다.
 */
export function TimeSpine({
  input,
  compact = false,
}: {
  input: TimeSpineInput;
  /** 상세 화면처럼 좁은 자리에서는 눈금을 줄인다 */
  compact?: boolean;
}) {
  const verdict = evaluateSpine(input);
  const geo = layout(input);

  return (
    <div>
      {geo ? (
        <div className="mb-3">
          {/* 눈금 */}
          <div className="relative mb-1.5 h-4">
            {geo.ticks.map((t) => (
              <span
                key={t.at}
                className="tabular absolute -translate-x-1/2 text-[10px] leading-none text-content-tertiary"
                style={{ left: `${pct(t.at, geo)}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>

          <Track label="상차" hint={compact ? null : geo.pickupHint}>
            <span
              className="absolute inset-y-0 rounded-sm bg-content-accent/70"
              style={{ left: `${pct(geo.pickFrom, geo)}%`, width: `${span(geo.pickFrom, geo.pickTo, geo)}%` }}
            />
          </Track>

          {/* 구간 소요시간 — 두 막대를 잇는다 */}
          {input.transitMinutes !== null && (
            <div className="relative h-5">
              <span
                aria-hidden="true"
                className="absolute top-0 h-full border-l border-dashed border-line-strong"
                style={{ left: `${pct(geo.pickTo, geo)}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-px bg-line-strong"
                style={{
                  left: `${pct(geo.pickTo, geo)}%`,
                  width: `${span(geo.pickTo, geo.latestArrival, geo)}%`,
                }}
              />
              <span
                className="tabular absolute top-1/2 -translate-y-1/2 whitespace-nowrap bg-surface-card px-1 text-[10px] text-content-tertiary"
                style={{ left: `${pct((geo.pickTo + geo.latestArrival) / 2, geo)}%`, transform: 'translate(-50%,-50%)' }}
              >
                {formatDuration(input.transitMinutes)}
              </span>
            </div>
          )}

          <Track label="하차" hint={compact ? null : geo.deliveryHint}>
            {/* 하차창 — 받아 주는 시간대 */}
            <span
              className="absolute inset-y-0 rounded-sm bg-line-subtle"
              style={{
                left: `${pct(geo.dropOpen, geo)}%`,
                width: `${span(geo.dropOpen, geo.dropClose, geo)}%`,
              }}
            />
            {/* 도착 가능 구간 — 창 안이면 초록, 밖으로 나가면 그 부분이 붉다 */}
            <span
              className={cn(
                'absolute inset-y-1 rounded-sm',
                verdict.kind === 'short' ? 'bg-status-danger/25' : 'bg-status-success/30',
              )}
              style={{
                left: `${pct(geo.earliestArrival, geo)}%`,
                width: `${span(geo.earliestArrival, geo.latestArrival, geo)}%`,
              }}
            />
            {geo.overflowFrom !== null && (
              <span
                className="absolute inset-y-1 rounded-sm bg-status-danger/55"
                style={{
                  left: `${pct(geo.overflowFrom, geo)}%`,
                  width: `${span(geo.overflowFrom, geo.latestArrival, geo)}%`,
                }}
              />
            )}
            {/* 하차 마감 — 넘으면 안 되는 선 */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-content-secondary"
              style={{ left: `${pct(geo.dropClose, geo)}%` }}
            />
          </Track>
        </div>
      ) : null}

      <Verdict verdict={verdict} compact={compact} />
    </div>
  );
}

function Track({
  label,
  hint,
  children,
}: {
  label: string;
  /** null 이면 오른쪽 칸을 통째로 빼고 축을 넓힌다 */
  hint: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-caption text-content-tertiary">{label}</span>
      <span className="relative h-5 min-w-0 flex-1 rounded-sm bg-surface-sunken">{children}</span>
      {hint !== null && (
        <span className="tabular w-24 shrink-0 text-right text-[10px] text-content-tertiary">
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * 판정 한 줄.
 *
 * "안 됩니다" 로 끝내지 않는다. 되기는 하는데 늦게 상차하면 못 맞추는
 * 경우(tight)에는 **몇 시까지 상차해야 하는지**를 말한다 — 접수 담당자가
 * 화주에게 바로 옮길 수 있는 문장이어야 한다.
 */
function Verdict({ verdict, compact }: { verdict: SpineVerdict; compact: boolean }) {
  const tone =
    verdict.kind === 'short'
      ? 'danger'
      : verdict.kind === 'tight'
        ? 'warning'
        : verdict.kind === 'fits'
          ? 'success'
          : 'muted';

  const TONE = {
    danger: 'border-status-danger/30 bg-status-danger-surface text-status-danger',
    warning: 'border-status-warning/30 bg-status-warning-surface text-status-warning',
    success: 'border-status-success/30 bg-status-success-surface text-status-success',
    muted: 'border-line-subtle bg-surface-sunken text-content-tertiary',
  } as const;

  const HEAD = {
    short: '이 시간에는 못 갑니다',
    tight: '상차를 당겨야 합니다',
    fits: '시간이 됩니다',
    incomplete: '아직 계산할 수 없습니다',
    unknown: '계산할 수 없습니다',
  } as const;

  return (
    <div className={cn('rounded-md border px-3 py-2', TONE[tone])}>
      <p className="text-label font-medium">{HEAD[verdict.kind]}</p>
      <p className="mt-0.5 text-caption opacity-90">{verdict.message}</p>

      {!compact && verdict.kind === 'short' && (
        <p className="mt-1.5 text-caption opacity-80">
          하차 마감을 늦추거나, 상차를 앞당기거나, 더 빠른 구간을 쓰셔야 합니다.
        </p>
      )}
      {!compact && verdict.kind === 'tight' && (
        <p className="mt-1.5 text-caption opacity-80">
          상차창 앞쪽에서 출발하면 됩니다. 마감(
          {minutesToClock(verdict.latestPickup)}) 을 넘기면 하차 마감을 못 지킵니다.
        </p>
      )}
      {!compact && verdict.kind === 'fits' && verdict.waitMinutes > 0 && (
        <p className="mt-1.5 text-caption opacity-80">
          일찍 도착하면 하차창이 열릴 때까지 {formatDuration(verdict.waitMinutes)} 기다립니다.
        </p>
      )}
      {verdict.kind === 'unknown' && !compact && (
        <p className="mt-1.5 text-caption opacity-80">
          기준정보 · 라우트에 이 구간을 등록하면 계산합니다.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 축 계산
// ---------------------------------------------------------------------

interface Geo {
  from: number;
  to: number;
  pickFrom: number;
  pickTo: number;
  dropOpen: number;
  dropClose: number;
  earliestArrival: number;
  latestArrival: number;
  /** 하차 마감을 넘어선 지점. 없으면 null */
  overflowFrom: number | null;
  ticks: { at: number; label: string }[];
  pickupHint: string | null;
  deliveryHint: string | null;
}

/**
 * 모든 시각을 **상차일 자정부터의 분** 하나로 환산해 한 축에 올린다.
 *
 * 날짜가 다른 하차(익일 상차 등)를 따로 그리면 축이 둘로 갈라져, 정작
 * 보려던 "사이에 소요시간이 들어가는가" 가 안 보인다.
 */
function layout(v: TimeSpineInput): Geo | null {
  const pickFrom = clockToMinutes(v.pickupFrom) ?? clockToMinutes(v.pickupTo);
  const pickTo = clockToMinutes(v.pickupTo) ?? pickFrom;
  const dropFrom = clockToMinutes(v.deliveryFrom) ?? clockToMinutes(v.deliveryTo);
  const dropTo = clockToMinutes(v.deliveryTo) ?? dropFrom;

  if (
    !v.pickupDate ||
    !v.deliveryDate ||
    pickFrom === null ||
    pickTo === null ||
    dropFrom === null ||
    dropTo === null
  ) {
    return null;
  }

  const dayGap = daysBetween(v.pickupDate, v.deliveryDate) * 1440;
  const dropOpen = dayGap + dropFrom;
  const dropClose = dayGap + dropTo;

  const transit = v.transitMinutes ?? 0;
  const earliestArrival = pickFrom + transit;
  const latestArrival = pickTo + transit;

  const lo = Math.min(pickFrom, dropOpen, earliestArrival);
  const hi = Math.max(pickTo, dropClose, latestArrival);
  const pad = Math.max(30, Math.round((hi - lo) * 0.08));
  const from = lo - pad;
  const to = hi + pad;

  return {
    from,
    to,
    pickFrom,
    pickTo,
    dropOpen,
    dropClose,
    earliestArrival,
    latestArrival,
    overflowFrom: latestArrival > dropClose ? Math.max(dropClose, earliestArrival) : null,
    ticks: makeTicks(from, to),
    pickupHint: `${minutesToClock(pickFrom)}–${minutesToClock(pickTo)}`,
    deliveryHint: `${minutesToClock(dropOpen)}–${minutesToClock(dropClose)}`,
  };
}

/**
 * 눈금은 정시에만 찍는다.
 *
 * 축 길이에 따라 간격을 벌린다 — 12시간짜리 축에 매시간 눈금을 찍으면
 * 글자가 겹쳐 오히려 못 읽는다.
 */
function makeTicks(from: number, to: number): { at: number; label: string }[] {
  const span = to - from;
  const stepHours = span > 20 * 60 ? 6 : span > 10 * 60 ? 3 : span > 5 * 60 ? 2 : 1;
  // 눈금이 촘촘하면 글자가 겹쳐 오히려 못 읽는다
  const step = stepHours * 60;
  const first = Math.ceil(from / step) * step;
  const out: { at: number; label: string }[] = [];
  for (let t = first; t <= to; t += step) {
    out.push({ at: t, label: minutesToClock(t) });
  }
  return out;
}

const pct = (at: number, geo: Geo) => ((at - geo.from) / (geo.to - geo.from)) * 100;
const span = (a: number, b: number, geo: Geo) =>
  Math.max(0.6, ((b - a) / (geo.to - geo.from)) * 100);
