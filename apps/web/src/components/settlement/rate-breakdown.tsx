'use client';

import type { RateStep } from '@ntms/shared';
import { won } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 산출 계단 — 상세가 답해야 하는 질문.
 *
 * 정산 상세가 답할 것은 "얼마인가" 가 아니다. 그건 목록이 이미 말했다.
 * 여기서 담당자가 묻는 것은 **"이 금액이 어떻게 나왔나"** 이고, 화주가
 * 전화로 물어 오는 것도 그것이다.
 *
 * 그래서 계단이다. 위에서 아래로 한 칸씩 내려가며 누계가 자란다. 오른쪽
 * 열의 누계가 이 그림의 축이고, 마지막 칸이 명세서에 찍히는 금액이다.
 *
 * ## 화면이 다시 계산하지 않는다
 *
 * 칸의 내용은 전부 `calculation_detail` JSONB 에 저장된 것을 그대로 편
 * 것이다. 화면이 자기 식으로 다시 계산하면, 운임표가 개정된 뒤 과거 정산을
 * 열었을 때 저장된 금액과 화면의 그림이 어긋난다. 그때 어느 쪽을 믿을지
 * 아무도 모른다.
 */
export function RateBreakdown({ steps, dense = false }: { steps: RateStep[]; dense?: boolean }) {
  if (steps.length === 0) {
    return (
      <p className="px-4 py-6 text-caption text-content-secondary">
        산출 근거가 없습니다. 「운임 산출」을 돌리면 적용된 요율표와 계산 과정이 여기 남습니다.
      </p>
    );
  }

  return (
    <div className={cn('px-4', dense ? 'py-2' : 'py-3')}>
      <ol className="space-y-0">
        {steps.map((step, i) => (
          <Step key={step.key} step={step} first={i === 0} />
        ))}
      </ol>
    </div>
  );
}

const KIND_LABEL: Record<RateStep['kind'], string | null> = {
  base: null,
  unit: null,
  floor: '하한 보정',
  cap: '상한 적용',
  round: '절사',
  surcharge: '부대비',
  fuel: '할증',
  supply: null,
  tax: null,
  total: null,
};

function Step({ step, first }: { step: RateStep; first: boolean }) {
  const isTotal = step.kind === 'total';
  const isSupply = step.kind === 'supply';
  // 하한·상한·절사는 규칙이 개입한 자리다. 그냥 더한 칸과 같은 무게로 두면
  // "왜 여기서 금액이 튀었나" 가 안 보인다.
  const adjusted = step.kind === 'floor' || step.kind === 'cap' || step.kind === 'round';
  const negative = step.amount < 0;

  return (
    <li
      className={cn(
        'flex items-baseline gap-3 py-1.5',
        !first && 'border-t border-line-subtle/70',
        isSupply && 'mt-1 border-t-line-subtle pt-2.5',
        isTotal && 'border-t-line-strong',
      )}
    >
      {/* 계단의 세로선. 마지막 두 칸은 합계라 계단 밖으로 나온다 */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          isTotal
            ? 'bg-content-primary'
            : adjusted
              ? 'bg-status-warning/60'
              : 'bg-content-tertiary/40',
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              'text-label',
              isTotal
                ? 'font-semibold text-content-primary'
                : isSupply
                  ? 'font-medium text-content-primary'
                  : 'text-content-secondary',
            )}
          >
            {step.label}
          </span>
          {KIND_LABEL[step.kind] && (
            <span
              className={cn(
                'rounded-sm border px-1.5 py-px text-[11px]',
                adjusted
                  ? 'border-status-warning/30 text-status-warning'
                  : 'border-line-subtle text-content-tertiary',
              )}
            >
              {KIND_LABEL[step.kind]}
            </span>
          )}
        </span>
        {step.expression && (
          <span className="tabular mt-0.5 block truncate text-caption text-content-tertiary">
            {step.expression}
          </span>
        )}
      </span>

      {/* 이 칸이 더한 금액 */}
      <span
        className={cn(
          'tabular w-[7rem] shrink-0 text-right text-label',
          isTotal
            ? 'text-content-tertiary'
            : negative
              ? 'text-status-warning'
              : 'text-content-secondary',
        )}
      >
        {isTotal || isSupply ? '' : `${negative ? '−' : '+'}${won(Math.abs(step.amount))}`}
      </span>

      {/* 누계 — 이 그림의 축 */}
      <span
        className={cn(
          'tabular w-[8rem] shrink-0 text-right',
          isTotal
            ? 'text-body font-semibold text-content-primary'
            : isSupply
              ? 'text-label font-medium text-content-primary'
              : 'text-label text-content-primary',
        )}
      >
        {won(step.running)}
      </span>
    </li>
  );
}

/**
 * 목록 칸에 들어가는 한 줄 요약.
 *
 * 명세 표에서 스무 줄을 훑을 때는 계단 전체를 펼 수 없다. 적용된 요율표와
 * 단가만 보여 주고, 계단은 줄을 눌러 열게 한다.
 */
export function RateOrigin({
  rateTableName,
  rateMethod,
  unitRate,
  note,
}: {
  rateTableName: string | null;
  rateMethod: string | null;
  unitRate: number | null;
  note: string | null;
}) {
  if (!rateTableName) {
    return (
      <span className="text-caption text-status-warning" title={note ?? undefined}>
        운임표 미적용
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-caption text-content-secondary">{rateTableName}</span>
      {unitRate !== null && unitRate > 0 && (
        <span className="tabular text-caption text-content-tertiary">
          {RATE_UNIT[rateMethod ?? ''] ?? ''} {won(unitRate)}원
        </span>
      )}
    </span>
  );
}

const RATE_UNIT: Record<string, string> = {
  DISTANCE: 'km당',
  WEIGHT: 'kg당',
  VOLUME: 'CBM당',
  PALLET: 'PLT당',
  QTY: '개당',
  PER_STOP: '정차당',
  TON_KM: '톤·km당',
};
