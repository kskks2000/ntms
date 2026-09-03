/**
 * CashLadder — 정산 화면의 축.
 *
 * 이 그림의 요점은 각 단의 **줄어든 폭**이다. 그 폭이 그 관문에 걸린 돈이고,
 * 그것을 잘못 세면 화면 전체가 거짓말을 한다. 그래서 여기서 지키는 것은
 * 숫자 하나하나가 아니라 **관계**다 — 아랫단이 윗단보다 클 수 없고,
 * 걸린 돈은 음수가 될 수 없다.
 */
import { describe, expect, it } from 'vitest';
import { buildCashLadder, ladderStageOf, type LadderStage } from '../src/settlement.js';

type Side = Record<LadderStage, { amount: number; count: number }>;

/** 다섯 단을 한 줄로 적는다. [실적확정, 정산생성, 확정·승인, 계산서발행, 수납완료] */
function side(amounts: [number, number, number, number, number], counts?: [number, number, number, number, number]): Side {
  const c = counts ?? [5, 4, 3, 2, 1];
  return {
    ACTUAL: { amount: amounts[0], count: c[0] },
    CREATED: { amount: amounts[1], count: c[1] },
    CONFIRMED: { amount: amounts[2], count: c[2] },
    INVOICED: { amount: amounts[3], count: c[3] },
    PAID: { amount: amounts[4], count: c[4] },
  };
}

const noOverdue = {
  billingAmount: 0,
  billingCount: 0,
  paymentAmount: 0,
  paymentCount: 0,
  oldestDays: null,
};

function ladder(billing: Side, payment: Side) {
  return buildCashLadder({ yearMonth: '202607', billing, payment, overdue: noOverdue });
}

describe('buildCashLadder — 걸린 돈', () => {
  it('앞 단과의 차이가 그 관문에 걸린 돈이다', () => {
    const l = ladder(
      side([120_000_000, 98_000_000, 82_000_000, 71_500_000, 43_800_000]),
      side([0, 0, 0, 0, 0]),
    );

    expect(l.rungs[1]?.billing.stuckAmount).toBe(22_000_000);
    expect(l.rungs[2]?.billing.stuckAmount).toBe(16_000_000);
    expect(l.rungs[3]?.billing.stuckAmount).toBe(10_500_000);
    expect(l.rungs[4]?.billing.stuckAmount).toBe(27_700_000);
  });

  it('맨 윗단은 걸린 것이 아니다 — 앞 단이 없으므로 0', () => {
    const l = ladder(side([120_000_000, 98_000_000, 82_000_000, 71_500_000, 43_800_000]), side([0, 0, 0, 0, 0]));

    expect(l.rungs[0]?.billing.stuckAmount).toBe(0);
  });

  it('아랫단이 윗단보다 커도 걸린 돈이 음수가 되지 않는다', () => {
    // 데이터가 어긋나는 경우는 실제로 생긴다(집계 시점 차이, 취소 정산).
    // 그때 음수 폭이 나오면 막대가 반대로 뻗어 화면이 깨진다.
    const l = ladder(side([100, 200, 300, 400, 500]), side([0, 0, 0, 0, 0]));

    for (const r of l.rungs) {
      expect(r.billing.stuckAmount).toBeGreaterThanOrEqual(0);
      expect(r.billing.stuckCount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildCashLadder — 마진', () => {
  it('두 사다리의 차이가 마진이다', () => {
    const l = ladder(side([120_000_000, 0, 0, 0, 0]), side([80_000_000, 0, 0, 0, 0]));

    expect(l.rungs[0]?.marginAmount).toBe(40_000_000);
    expect(l.rungs[0]?.marginRate).toBeCloseTo(33.3, 1);
  });

  it('매출이 0 이면 마진율은 없다 — 0 으로 나누지 않는다', () => {
    const l = ladder(side([0, 0, 0, 0, 0]), side([0, 0, 0, 0, 0]));

    expect(l.rungs[0]?.marginRate).toBeNull();
  });

  it('매입이 매출보다 크면 마진이 음수로 나온다 — 감추지 않는다', () => {
    // 실제로 그런 달이 있다(지급이 먼저, 수금이 나중). 0 으로 깎으면
    // 돈이 나간 것보다 덜 들어온 달을 알아볼 수 없다.
    const l = ladder(side([50_000_000, 0, 0, 0, 0]), side([80_000_000, 0, 0, 0, 0]));

    expect(l.rungs[0]?.marginAmount).toBe(-30_000_000);
  });
});

describe('buildCashLadder — 가장 크게 걸린 관문', () => {
  it('맨 윗단은 후보에서 뺀다', () => {
    // 맨 윗단은 "청구 가능한 전액" 이지 걸린 돈이 아니다.
    const l = ladder(side([100_000_000, 10_000_000, 9_000_000, 8_000_000, 7_000_000]), side([0, 0, 0, 0, 0]));

    expect(l.worst?.stage).toBe('CREATED');
    expect(l.worst?.amount).toBe(90_000_000);
  });

  it('매출·매입 중 큰 쪽을 집고 어느 쪽인지 말한다', () => {
    const l = ladder(
      side([100, 90, 80, 70, 60]),
      side([100_000_000, 10_000_000, 9_000_000, 8_000_000, 7_000_000]),
    );

    expect(l.worst?.type).toBe('PAYMENT');
  });

  it('아무 데도 안 걸렸으면 없다고 답한다', () => {
    const flat = side([100, 100, 100, 100, 100], [1, 1, 1, 1, 1]);

    expect(ladder(flat, flat).worst).toBeNull();
  });
});

describe('buildCashLadder — 막대 길이', () => {
  it('축의 오른쪽 끝은 매출·매입의 맨 윗단 중 큰 쪽이다', () => {
    const l = ladder(side([100, 0, 0, 0, 0]), side([250, 0, 0, 0, 0]));

    expect(l.scale).toBe(250);
  });

  it('전부 0 이어도 0 으로 나누지 않는다', () => {
    const zero = side([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
    const l = ladder(zero, zero);

    expect(l.scale).toBe(1);
    for (const r of l.rungs) expect(r.billing.ratio).toBe(0);
  });

  it('비율은 0~1 을 벗어나지 않는다', () => {
    const l = ladder(side([100, 500, -50, 0, 0]), side([0, 0, 0, 0, 0]));

    for (const r of l.rungs) {
      expect(r.billing.ratio).toBeGreaterThanOrEqual(0);
      expect(r.billing.ratio).toBeLessThanOrEqual(1);
    }
  });
});

describe('ladderStageOf — 상태가 어느 단까지 올라왔나', () => {
  it('마감된 정산도 수납 완료로 센다', () => {
    // 마감은 기간을 잠그는 것이지 돈을 되돌리는 것이 아니다.
    expect(ladderStageOf('PAID')).toBe('PAID');
    expect(ladderStageOf('CLOSED')).toBe('PAID');
  });

  it('부분수납은 계산서 단에 머문다 — 아직 다 안 들어왔다', () => {
    expect(ladderStageOf('INVOICED')).toBe('INVOICED');
    expect(ladderStageOf('PARTIALLY_PAID')).toBe('INVOICED');
  });

  it('확정·승인은 같은 단이다', () => {
    expect(ladderStageOf('CONFIRMED')).toBe('CONFIRMED');
    expect(ladderStageOf('APPROVED')).toBe('CONFIRMED');
  });

  it('그 앞의 상태는 전부 생성 단이다', () => {
    for (const s of ['DRAFT', 'CALCULATED', 'REVIEWING']) {
      expect(ladderStageOf(s), s).toBe('CREATED');
    }
  });
});
