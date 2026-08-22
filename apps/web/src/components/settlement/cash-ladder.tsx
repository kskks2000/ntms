'use client';

import { AlertTriangle } from 'lucide-react';
import type { CashLadder as CashLadderData, LadderRung, LadderStage } from '@ntms/shared';
import { compactWon, voiceOf, won } from '@ntms/shared';
import { cn } from '@/lib/cn';

/**
 * 사다리 — 이 화면의 얼굴.
 *
 * ## 축이 무엇인가
 *
 * 가로는 **금액**, 세로는 **관문**이다. 앞선 화면들의 축은 전부 시간이었고
 * (운행 다이어그램 · 간트 · 지연 전파), 실적에서 한 번 돌려 편차가 됐다.
 * 정산에서 다시 돌린다 — 여기서 묻는 것은 "언제" 도 "얼마나 벗어났나" 도
 * 아니고 **"돈이 어디서 멈춰 있나"** 다.
 *
 * ## 오른쪽이 무엇인가
 *
 * 오른쪽 끝이 그 관문을 **통과한** 금액이다. 아래로 내려갈수록 막대가
 * 짧아지고, **줄어든 만큼이 그 관문에 걸린 돈**이다. 그 줄어든 구간을
 * 지우지 않고 흐린 띠로 남겨 둔다 — 없어진 것이 아니라 거기 멈춰 있는
 * 것이므로, 빈자리로 두면 그림이 거짓말을 한다.
 *
 * ## 두 막대를 겹치는 이유
 *
 * 매출과 매입이 같은 표 · 같은 상태 · 같은 관문이다. 같은 0선에서 그으면
 * **두 막대의 오른쪽 끝 차이가 그 관문의 마진**이 된다. 마진을 따로 계산해
 * 옆에 숫자로 적는 대신 그림이 직접 보여 준다.
 *
 * 한 화면에 힘을 준 곳은 여기 하나다. 나머지 판은 전부 헤어라인과 여백으로
 * 조용히 둔다.
 */
export function CashLadder({
  ladder,
  selected,
  onSelect,
}: {
  ladder: CashLadderData;
  selected: LadderStage | null;
  onSelect: (stage: LadderStage | null) => void;
}) {
  return (
    <div className="px-4 py-4">
      <LadderHead ladder={ladder} />

      <ul className="mt-4 space-y-0.5">
        {ladder.rungs.map((rung, i) => (
          <Rung
            key={rung.key}
            rung={rung}
            first={i === 0}
            selected={selected === rung.key}
            onSelect={() => onSelect(selected === rung.key ? null : rung.key)}
          />
        ))}
      </ul>

      <Legend scale={ladder.scale} />
    </div>
  );
}

/**
 * 맨 위 한 문장.
 *
 * 그림을 읽기 전에 답을 준다. 사다리는 "어디서" 를 보여 주지만, 화면을 열자마자
 * 알아야 하는 것은 **"어디가 제일 심한가"** 다.
 */
function LadderHead({ ladder }: { ladder: CashLadderData }) {
  const worst = ladder.worst;
  const overdue = ladder.overdue;
  const overdueAmount = overdue.billingAmount + overdue.paymentAmount;

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line-subtle pb-3">
      <p className="text-body text-content-secondary">
        {worst === null ? (
          <>이 달은 관문에 걸린 돈이 없습니다.</>
        ) : (
          <>
            <span className="font-medium text-content-primary">{worst.label}</span> 앞에서{' '}
            <span className="tabular font-medium text-content-primary">{won(worst.amount)}원</span>
            이 멈춰 있습니다
            <span className="text-content-tertiary">
              {' '}
              ({worst.type === 'BILLING' ? '매출' : '매입'})
            </span>
          </>
        )}
      </p>

      {overdueAmount > 0 && (
        <p className="flex items-center gap-1.5 text-caption text-status-warning">
          <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
          {/*
            어느 쪽인지 이름을 붙인다.

            사다리는 매출과 매입을 겹쳐 놓으므로 이 건수는 두 쪽의 **합**이다.
            반면 위의 지표 카드는 지금 보고 있는 한쪽만 센다. 이름이 없으면
            매출 화면에서 "기한 초과 0건" 바로 아래에 "기한 초과 1건" 이 떠
            둘 중 하나가 틀린 것처럼 읽힌다.
          */}
          결제 기한 초과{' '}
          {[
            overdue.billingCount > 0 ? `매출 ${overdue.billingCount}건` : null,
            overdue.paymentCount > 0 ? `매입 ${overdue.paymentCount}건` : null,
          ]
            .filter((v): v is string => v !== null)
            .join(' · ')}{' '}
          ·{' '}
          <span className="tabular font-medium">{compactWon(overdueAmount)}원</span>
          {overdue.oldestDays !== null && (
            <span className="text-content-tertiary">최장 {overdue.oldestDays}일</span>
          )}
        </p>
      )}
    </div>
  );
}

function Rung({
  rung,
  first,
  selected,
  onSelect,
}: {
  rung: LadderRung;
  first: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const stuck = rung.billing.stuckAmount + rung.payment.stuckAmount;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'w-full rounded-md px-2 py-2 text-left transition-colors duration-fast',
          selected ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/60',
        )}
      >
        <div className="flex items-baseline gap-3">
          <span
            className={cn(
              'w-[5.5rem] shrink-0 text-label',
              selected ? 'font-medium text-content-primary' : 'text-content-secondary',
            )}
          >
            {rung.label}
          </span>

          <span className="min-w-0 flex-1">
            <SideBar
              side={rung.billing}
              tone="billing"
              label={voiceOf('BILLING').title}
              /* 첫 단은 앞이 없으므로 걸린 구간도 없다 */
              showStuck={!first}
            />
            <SideBar
              side={rung.payment}
              tone="payment"
              label={voiceOf('PAYMENT').title}
              showStuck={!first}
            />
          </span>

          <span className="w-[8.5rem] shrink-0 text-right">
            {first || stuck === 0 ? (
              <span className="tabular text-caption text-content-tertiary">
                마진 {compactWon(rung.marginAmount)}
              </span>
            ) : (
              <>
                <span className="tabular block text-label font-medium text-status-warning">
                  {compactWon(stuck)}원
                </span>
                <span className="block text-caption text-content-tertiary">
                  {rung.billing.stuckCount + rung.payment.stuckCount}건 걸림
                </span>
              </>
            )}
          </span>
        </div>

        <p className="mt-1 pl-[6.5rem] text-caption text-content-tertiary">{rung.question}</p>
      </button>
    </li>
  );
}

/**
 * 막대 한 줄.
 *
 * 채워진 부분이 통과한 금액, 흐린 부분이 이 관문에 걸린 금액이다. 둘을 이어
 * 그리므로 **두 막대의 전체 길이는 앞 단과 같다** — 그래야 "여기서 이만큼이
 * 잘렸다" 로 읽힌다.
 */
function SideBar({
  side,
  tone,
  label,
  showStuck,
}: {
  side: { amount: number; count: number; stuckAmount: number; ratio: number };
  tone: 'billing' | 'payment';
  label: string;
  showStuck: boolean;
}) {
  const passed = Math.max(0, Math.min(100, side.ratio * 100));
  // 걸린 구간은 통과분 바로 뒤에 이어 붙는다. 사다리 전체가 같은 눈금이므로
  // 앞 단의 길이를 다시 계산할 필요가 없다.
  const stuckWidth = showStuck ? Math.max(0, Math.min(100 - passed, 100)) : 0;

  return (
    <span className="flex items-center gap-2 py-[3px]">
      <span
        className="relative h-[9px] min-w-0 flex-1 rounded-[2px] bg-surface-sunken"
        role="img"
        aria-label={`${label} ${won(side.amount)}원, ${side.count}건`}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 rounded-l-[2px]',
            // 매출은 잉크로 꽉 채우고 매입은 흐리게 둔다. 받을 돈과 줄 돈을
            // 색으로 가르되 유채색을 쓰지 않는다 — 옥색은 살아 있는 것에만.
            tone === 'billing' ? 'bg-content-primary/80' : 'bg-content-tertiary/45',
            passed >= 99.5 && 'rounded-r-[2px]',
          )}
          style={{ width: `${passed}%` }}
        />
        {stuckWidth > 0.2 && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 rounded-r-[2px] bg-status-warning/25"
            style={{ left: `${passed}%`, width: `${stuckWidth}%` }}
          />
        )}
      </span>

      <span className="tabular w-[7.5rem] shrink-0 text-right text-caption text-content-secondary">
        {won(side.amount)}
      </span>
    </span>
  );
}

/** 범례 없는 그림은 그림에 그친다 */
function Legend({ scale }: { scale: number }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-subtle pt-2.5 text-caption text-content-tertiary">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[9px] w-6 rounded-[2px] bg-content-primary/80" />
        매출(받을 돈)
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[9px] w-6 rounded-[2px] bg-content-tertiary/45" />
        매입(줄 돈)
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[9px] w-6 rounded-[2px] bg-status-warning/25" />
        이 관문에 걸린 돈
      </span>
      <span className="ml-auto">
        축의 오른쪽 끝 = <span className="tabular">{won(scale)}</span>원 · 두 막대의 끝 차이가 마진
      </span>
    </div>
  );
}
