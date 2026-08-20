'use client';

import { ArrowDownToLine, CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react';
import type { CascadeRow, DelayCascade as Cascade } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 지연 전파 축.
 *
 * ## 왜 지도가 아니라 이것이 주인공인가
 *
 * 트래킹 화면은 대개 지도부터 크게 그린다. 그런데 지도가 담당자에게 알려
 * 주는 것은 "차가 저기 있구나" 하나뿐이고, 정작 손이 필요한 순간은 그
 * 다음이다 — 2번에서 40분 늦었으니 3·4·5번이 밀리고, 그중 4번은 도크가
 * 18:40 에 닫히니 **지금 화주에게 전화해야 한다**. 그 사슬을 사람이 암산으로
 * 이어붙이고 있으면 바쁜 날에는 반드시 놓친다.
 *
 * ## 이 앱의 축 어휘를 잇는다
 *
 *   관제 현황   축 위로 흐르고 축 아래로 쌓인다
 *   배차판     계획 막대 위에 실적을 겹친다
 *   기준정보    남은 날을 막대 길이로
 *   오더 등록   두 창 사이에 소요시간이 들어가는가
 *   편성       정차 순서를 따라가며 천장을 넘는가
 *   여기       계획선에서 오른쪽으로 얼마나 벗어났는가
 *
 * ## 읽는 법
 *
 * 칸을 세로로 관통하는 선이 **계획 도착**이다. 정차마다 그 선에서 오른쪽으로
 * 막대가 뻗는데, 길이가 곧 늦은 분이다. 모든 줄이 같은 눈금을 쓰므로 축을
 * 따라 내려가며 막대가 길어지면 지연이 번지는 것이고, 짧아지면 계획된 대기가
 * 삼킨 것이다. 왼쪽 점 사슬은 정차 순서이고, 실선이 끊기는 곳이 "여기까지가
 * 있었던 일" 의 경계다.
 *
 * 각 줄에는 **마감 눈금**이 하나 서 있다 — 계획 도착에서 도크가 닫힐 때까지
 * 남은 여유다. 막대가 그 눈금을 넘어가면 붉어진다. 넘었다는 사실이 길이의
 * 비교로 그대로 보이므로, 숫자를 읽지 않아도 어느 정차가 위험한지 안다.
 */
export function DelayCascade({ cascade }: { cascade: Cascade }) {
  const rows = cascade.rows;
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-caption text-content-tertiary">
        정차 실적이 아직 없습니다.
      </p>
    );
  }

  const scale = scaleOf(rows);

  return (
    <div>
      <ul className="px-4 py-1">
        {rows.map((r, i) => (
          <CascadeStop
            key={r.stopSeq}
            row={r}
            scale={scale}
            isFirst={i === 0}
            isLast={i === rows.length - 1}
            /* 다음 줄이 예측이면 이 줄 아래부터 선이 점선으로 바뀐다 —
               "여기까지가 있었던 일" 의 경계다 */
            nextIsForecast={rows[i + 1]?.basis !== 'actual'}
          />
        ))}
      </ul>
      <Legend scale={scale} />
    </div>
  );
}

/**
 * 막대가 쓸 수 있는 폭.
 *
 * 100 을 다 쓰지 않는다. 눈금 끝에 닿은 막대는 "여기서 잘렸나" 와 "딱
 * 맞나" 를 구별할 수 없다.
 */
const TRACK_W = 96;

function CascadeStop({
  row,
  scale,
  isFirst,
  isLast,
  nextIsForecast,
}: {
  row: CascadeRow;
  scale: number;
  isFirst: boolean;
  isLast: boolean;
  nextIsForecast: boolean;
}) {
  const late = Math.max(0, row.deltaMinutes);
  const barW = (Math.min(late, scale) / scale) * TRACK_W;

  const slack = slackMinutes(row);
  const deadlineX = slack === null ? null : (Math.min(slack, scale) / scale) * TRACK_W;

  const tone = row.isBreach ? 'danger' : late > 10 ? 'warning' : 'calm';
  const passed = row.basis === 'actual';

  return (
    <li className="relative flex gap-3 py-3">
      {/* 정차 사슬. 지난 구간은 실선, 남은 구간은 점선 — 여기까지가
          있었던 일이라는 경계다 */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[7px] w-px',
          isFirst ? 'top-4' : 'top-0',
          isLast ? 'h-4' : 'bottom-0',
          nextIsForecast ? 'bg-line-strong' : 'bg-content-tertiary/50',
        )}
        style={nextIsForecast && !isLast ? DASHED_AXIS : undefined}
      />

      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 bg-surface-card',
          passed
            ? 'border-content-secondary'
            : row.isBreach
              ? 'border-status-danger'
              : 'border-line-strong',
        )}
      >
        {passed && <span className="h-1.5 w-1.5 rounded-full bg-content-secondary" />}
      </span>

      <div className="relative min-w-0 flex-1 pl-3">
        {/*
          계획선.

          이 화면의 기준선이다. 줄마다 짧은 눈금을 두면 위아래가 안 이어져
          "벗어났다" 가 한 줄 안에서만 읽히는데, 이 화면이 보여주려는 것은
          줄을 따라 내려가며 벗어난 길이가 **어떻게 변하는가**다. 그래서
          칸 전체를 관통하는 한 줄로 세운다.

          칸의 왼쪽 경계에 세우고 본문을 그만큼 들여쓴다. 안쪽에 세우면
          선이 지명과 글자를 가로질러 취소선처럼 읽힌다.
        */}
        <span
          aria-hidden="true"
          className="absolute left-0 w-px bg-line-strong"
          // 줄 사이 여백만큼 위아래로 늘려 토막이 아니라 한 줄로 보이게 한다.
          // 첫 줄 위와 마지막 줄 아래로는 안 넘긴다.
          style={{ top: isFirst ? 0 : '-0.75rem', bottom: isLast ? 0 : '-0.75rem' }}
        />

        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-label font-medium text-content-primary">
            <span className="tabular mr-1.5 text-content-tertiary">{row.stopSeq}</span>
            {row.locationName}
            <span className="ml-1.5 text-caption font-normal text-content-tertiary">
              {row.stopType === 'PICKUP' ? '상차' : '하차'}
            </span>
          </p>
          <p className="tabular shrink-0 text-caption text-content-secondary">
            {hhmm(row.plannedArrivalAt)}
            <span className="mx-1 text-content-tertiary">→</span>
            <span
              className={cn(
                'font-medium',
                row.isBreach ? 'text-status-danger' : 'text-content-primary',
              )}
            >
              {hhmm(row.expectedArrivalAt)}
            </span>
          </p>
        </div>

        {/* 계획선에서 오른쪽으로 벗어난 길이 */}
        <div className="relative mt-1.5 h-3">
          {barW > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-[3px] h-1.5 rounded-r-sm',
                tone === 'danger'
                  ? 'bg-status-danger'
                  : tone === 'warning'
                    ? 'bg-status-warning/75'
                    : 'bg-content-tertiary/45',
              )}
              style={{ width: `${barW}%` }}
            />
          )}
          {deadlineX !== null && (
            <span
              aria-hidden="true"
              title="도크 마감"
              className={cn(
                'absolute -top-0.5 h-4 w-px',
                row.isBreach ? 'bg-status-danger' : 'bg-content-tertiary/70',
              )}
              style={{ left: `${deadlineX}%` }}
            />
          )}
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption">
          <span
            className={cn(
              'tabular',
              row.isBreach
                ? 'font-medium text-status-danger'
                : late > 10
                  ? 'text-status-warning'
                  : row.deltaMinutes < 0
                    ? 'text-status-success'
                    : 'text-content-tertiary',
            )}
          >
            {/* 일찍 온 경우는 막대가 없다 — 계획선 왼쪽에는 그릴 자리가
                없고, 이 화면이 답하는 것은 늦음이지 이름이 아니다 */}
            {row.deltaMinutes === 0
              ? '계획대로'
              : row.deltaMinutes > 0
                ? `+${row.deltaMinutes}분`
                : `${row.deltaMinutes}분 일찍`}
            {!passed && row.deltaMinutes !== 0 && ' 예상'}
          </span>

          {row.absorbedMinutes > 0 && (
            <span className="flex items-center gap-1 text-status-success">
              <ArrowDownToLine size={11} strokeWidth={2} aria-hidden="true" />
              <span className="tabular">대기로 {row.absorbedMinutes}분 흡수</span>
            </span>
          )}

          {row.isBreach && (
            <span className="flex items-center gap-1 font-medium text-status-danger">
              <TriangleAlert size={11} strokeWidth={2} aria-hidden="true" />
              <span className="tabular">
                마감 {hhmm(row.windowTo)} · {row.breachMinutes}분 초과
              </span>
            </span>
          )}

          {!row.isBreach && slack !== null && !passed && (
            <span className="tabular text-content-tertiary">
              마감 {hhmm(row.windowTo)}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * 축 위 요약 — 지금 무엇을 해야 하나.
 *
 * "40분 늦었다" 는 지난 일이고 "앞으로 12분까지 버틴다" 는 지금 할 일을
 * 정한다. 그래서 큰 글자는 뒤쪽 숫자에 준다.
 */
export function CascadeVerdict({ cascade }: { cascade: Cascade }) {
  if (cascade.firstBreachSeq !== null) {
    /*
      이미 벌어진 일과 아직 막을 수 있는 일을 갈라 말한다.

      끝난 운송에 "미리 알리세요" 라고 적으면 그 문구는 곧 아무도 안 읽는
      배경이 된다. 지금 할 수 있는 일이 있는 경우에만 할 일을 적는다.
    */
    const stillAhead = cascade.rows.some((r) => r.isBreach && r.basis !== 'actual');
    return (
      <Verdict
        tone="danger"
        icon={<TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />}
        headline={
          stillAhead
            ? `${cascade.breachCount}곳이 마감을 넘깁니다`
            : `${cascade.breachCount}곳이 마감을 넘겼습니다`
        }
        detail={
          stillAhead
            ? `${cascade.firstBreachSeq}번 정차부터입니다. 화주에게 미리 알리거나 순서를 바꿔야 합니다.`
            : `${cascade.firstBreachSeq}번 정차에서 도크 마감을 지나 도착했습니다. 인수 거부나 반송이 있었는지 확인하세요.`
        }
      />
    );
  }

  if (cascade.headroomMinutes === null) {
    return (
      <Verdict
        tone="calm"
        icon={<CircleCheck size={16} strokeWidth={2} aria-hidden="true" />}
        headline="남은 정차가 없습니다"
        detail="모든 정차가 끝났습니다."
      />
    );
  }

  const tight = cascade.headroomMinutes < 30;
  return (
    <Verdict
      tone={tight ? 'warning' : 'calm'}
      icon={
        tight ? (
          <CircleDashed size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
        )
      }
      headline={`앞으로 ${cascade.headroomMinutes}분까지 버팁니다`}
      detail={
        cascade.currentDelayMinutes > 0
          ? `지금 ${cascade.currentDelayMinutes}분 늦었지만 남은 정차의 마감은 아직 지킵니다.`
          : '모든 정차가 시간창 안에 들어옵니다.'
      }
    />
  );
}

function Verdict({
  tone,
  icon,
  headline,
  detail,
}: {
  tone: 'calm' | 'warning' | 'danger';
  icon: React.ReactNode;
  headline: string;
  detail: string;
}) {
  const skin = {
    calm: 'border-line-subtle bg-surface-sunken text-content-secondary',
    warning: 'border-status-warning/30 bg-status-warning-surface text-status-warning',
    danger: 'border-status-danger/30 bg-status-danger-surface text-status-danger',
  }[tone];

  return (
    <div className={cn('flex items-start gap-2.5 border-b px-4 py-3', skin)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-label font-semibold">{headline}</p>
        <p className="mt-0.5 text-caption text-content-secondary">{detail}</p>
      </div>
    </div>
  );
}

function Legend({ scale }: { scale: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-subtle px-4 py-2.5 text-caption text-content-tertiary">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-px bg-line-strong" />
        계획 도착
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-1.5 w-5 rounded-sm bg-content-tertiary/45" />
        늦은 분
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-px bg-content-tertiary/70" />
        도크 마감
      </span>
      <span className="tabular">눈금 폭 = {scale}분</span>
    </div>
  );
}

// ---------------------------------------------------------------------

const DASHED_AXIS: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, rgb(var(--border-strong)) 0 3px, transparent 3px 7px)',
  backgroundColor: 'transparent',
};

/**
 * 모든 줄이 같은 눈금을 쓴다.
 *
 * 줄마다 자기 최대값으로 늘리면 40분 지연과 4분 지연이 똑같은 길이로
 * 그려져 축을 따라 내려가며 번지는 모습이 사라진다 — 이 화면이 보여주려는
 * 것이 바로 그 변화다.
 *
 * 마감 여유도 같은 눈금에 얹으므로 둘 중 큰 쪽을 기준으로 잡는다. 최소
 * 30분은 두어, 다들 정시일 때 몇 분짜리 오차가 화면을 가득 채우지 않게 한다.
 */
function scaleOf(rows: CascadeRow[]): number {
  let max = 30;
  for (const r of rows) {
    max = Math.max(max, Math.abs(r.deltaMinutes));
    const s = slackMinutes(r);
    if (s !== null) max = Math.max(max, Math.min(s, 240));
  }
  // 눈금은 사람이 읽는 숫자로 올림한다
  const steps = [30, 45, 60, 90, 120, 180, 240, 300, 420, 600];
  return steps.find((s) => s >= max) ?? Math.ceil(max / 60) * 60;
}

/** 계획 도착에서 도크가 닫힐 때까지 남은 분 */
function slackMinutes(r: CascadeRow): number | null {
  if (!r.plannedArrivalAt || !r.windowTo) return null;
  const v = (Date.parse(r.windowTo) - Date.parse(r.plannedArrivalAt)) / 60_000;
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
}

function hhmm(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
