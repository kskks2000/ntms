import type { VarianceRow, VarianceSpine as VarianceSpineData } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 편차 축 — 이 화면의 얼굴.
 *
 * 앞선 화면들의 축은 전부 시간이었다(운행 다이어그램 · 간트 · 지연 전파).
 * 실적 화면이 열릴 때 시간은 이미 끝나 있으므로, 축을 90도 돌린다.
 *
 *   **계획이 가운데 0선에 서고, 실제가 좌우로 벌어진다.**
 *
 * 세로로 내려긋는 한 줄이 이 화면에서 유일하게 힘을 준 곳이다. 다섯 줄이
 * 같은 선을 지나가므로, 어느 항목이 얼마나 벗어났는지가 숫자를 읽기 전에
 * 눈으로 먼저 들어온다.
 *
 * 막대 길이는 줄마다 눈금이 다르다(거리는 %, 대기는 분). 한 눈금으로
 * 통일하면 읽기는 쉬워지지만 뜻이 틀려지므로, 막대는 **모양**으로 두고
 * 정확한 값은 오른쪽 숫자에 맡긴다. 범례에 그렇게 적어 둔다.
 */
export function VarianceSpine({ spine }: { spine: VarianceSpineData }) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-baseline gap-3 pb-2 pl-[13.5rem] pr-[10.5rem]">
        <span className="eyebrow-ko flex-1 text-right text-content-tertiary">← 계획보다 덜</span>
        <span className="eyebrow-ko flex-1 text-content-tertiary">계획보다 더 →</span>
      </div>

      <div className="relative">
        {/*
          0선. 다섯 줄을 관통하는 이 선이 화면의 서명이다. 줄마다 따로
          그리면 눈금이 어긋나 보여서 축으로 안 읽힌다.
        */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 top-0 z-10 w-px bg-line-strong"
          style={{ left: 'calc(13.5rem + (100% - 24rem) / 2)' }}
        />

        <ul className="space-y-px">
          {spine.rows.map((row) => (
            <SpineRow key={row.key} row={row} />
          ))}
        </ul>
      </div>

      <p className="mt-3 border-t border-line-subtle pt-2.5 text-caption text-content-tertiary">
        가운데 선이 계획입니다. 막대 길이는 줄마다 눈금이 달라
        (거리·시간 ±30% · 대기·지연 120분 · 적재율 ±30%p) 크기를 견주는 그림이고,
        정확한 값은 오른쪽 숫자입니다.
      </p>
    </div>
  );
}

const BAR_TONE: Record<VarianceRow['tone'], string> = {
  neutral: 'bg-content-tertiary/30',
  caution: 'bg-status-warning/40',
  over: 'bg-status-warning',
};

function SpineRow({ row }: { row: VarianceRow }) {
  const width = Math.abs(row.offset) * 50;
  const right = row.offset > 0;
  const known = row.actual !== null;

  return (
    <li className="flex items-center gap-3 rounded-sm py-1.5 hover:bg-surface-sunken">
      <span className="w-[4.5rem] shrink-0 text-label text-content-secondary">{row.label}</span>

      {/* 계획 → 실제. 두 숫자를 붙여 두어야 축이 무엇을 견주는지 읽힌다 */}
      <span className="tabular w-[8rem] shrink-0 text-right text-label text-content-tertiary">
        {format(row.planned)}
        <span aria-hidden="true" className="mx-1 text-content-tertiary/60">
          →
        </span>
        <span className={cn('font-medium', known ? 'text-content-primary' : 'text-content-tertiary')}>
          {format(row.actual)}
        </span>
      </span>

      <span className="relative h-4 min-w-0 flex-1" role="img" aria-label={describe(row)}>
        {/* 눈금 — 축의 절반 지점. 막대가 어디쯤인지 견줄 자리가 있어야 한다 */}
        {[25, 75].map((p) => (
          <span
            key={p}
            aria-hidden="true"
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line-subtle"
            style={{ left: `${p}%` }}
          />
        ))}
        {known && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[1px]',
              BAR_TONE[row.tone],
              right ? 'rounded-l-none' : 'rounded-r-none',
            )}
            style={
              right
                ? { left: '50%', width: `${width}%` }
                : { right: '50%', width: `${width}%` }
            }
          />
        )}
      </span>

      <span className="w-[4.5rem] shrink-0 text-right">
        <span
          className={cn(
            'tabular text-label',
            row.tone === 'over'
              ? 'font-medium text-status-warning'
              : row.delta && row.delta > 0
                ? 'text-content-secondary'
                : 'text-content-tertiary',
          )}
        >
          {signed(row.delta, row.key === 'loading' ? '%p' : '')}
        </span>
      </span>

      {/* 돈이 되는 편차인가. 없으면 자리만 비운다 — 매 줄에 문구를 붙이면 아무도 안 읽는다 */}
      <span className="w-[9rem] shrink-0 truncate text-caption text-content-tertiary">
        {row.billingNote}
      </span>
    </li>
  );
}

/**
 * 목록의 한 칸에 들어가는 축.
 *
 * 상세의 다섯 줄을 그대로 넣을 수는 없으니 **거리 편차 한 줄**만 가져온다.
 * 같은 0선 · 같은 방향이라, 목록에서 눈에 걸린 줄을 열면 같은 그림이 커져
 * 있는 것으로 읽힌다.
 */
export function VarianceTick({
  rate,
  className,
}: {
  /** 계획 대비 % */
  rate: number | null;
  className?: string;
}) {
  if (rate === null) {
    return <span className={cn('text-caption text-content-tertiary', className)}>—</span>;
  }

  const offset = Math.max(-1, Math.min(1, rate / 30));
  const width = Math.abs(offset) * 50;
  const right = offset > 0;
  const abs = Math.abs(rate);

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="relative h-3 w-16 shrink-0"
        role="img"
        aria-label={`계획 대비 ${rate > 0 ? '초과' : '미만'} ${abs.toFixed(1)}%`}
      >
        <span aria-hidden="true" className="absolute bottom-0 left-1/2 top-0 w-px bg-line-strong" />
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 h-[5px] -translate-y-1/2',
            abs >= 15 ? 'bg-status-warning' : abs >= 10 ? 'bg-status-warning/40' : 'bg-content-tertiary/30',
          )}
          style={right ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      </span>
      <span
        className={cn(
          'tabular text-caption',
          abs >= 15 ? 'font-medium text-status-warning' : 'text-content-secondary',
        )}
      >
        {rate > 0 ? '+' : ''}
        {rate.toFixed(1)}%
      </span>
    </span>
  );
}

function format(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

function signed(v: number | null, suffix: string): string {
  if (v === null) return '—';
  if (v === 0) return `0${suffix}`;
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${suffix}`;
}

function describe(row: VarianceRow): string {
  if (row.actual === null) return `${row.label} 실적 없음`;
  const dir = (row.delta ?? 0) > 0 ? '초과' : (row.delta ?? 0) < 0 ? '미만' : '일치';
  return `${row.label} 계획 ${format(row.planned)}${row.unit}, 실제 ${format(row.actual)}${row.unit}, ${dir}`;
}
