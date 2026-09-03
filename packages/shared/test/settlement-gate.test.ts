/**
 * 정산 관문과 상태 전이.
 *
 * 관문은 두 단이다 — `blocker` 는 막고 `caution` 은 짚기만 한다. 이 구분이
 * 무너지면 둘 중 하나가 일어난다: 막아야 할 것을 안 막아 잘못된 돈이 나가거나,
 * 짚을 것까지 막아 월말에 아무것도 안 넘어간다.
 *
 * 그래서 여기서 세는 것은 문구가 아니라 **어느 것이 막고 어느 것이 안 막는가**다.
 */
import { describe, expect, it } from 'vitest';
import {
  canTransition,
  evaluateCloseGate,
  evaluateSettlementGate,
  nextAction,
  statusAfter,
  type CloseGateInput,
  type SettlementGateInput,
} from '../src/settlement.js';

/** 아무것도 안 막는 상태. 여기에 얹어서 한 칸만 망가뜨린다 */
function gateInput(over: Partial<SettlementGateInput> = {}): SettlementGateInput {
  return {
    status: 'CALCULATED',
    detailCount: 10,
    uncalculatedCount: 0,
    manualCount: 0,
    pendingChargeCount: 0,
    pendingAdjustmentCount: 0,
    hasDispute: false,
    partnerConfirmed: true,
    totalAmount: 1_000_000,
    paidAmount: 0,
    periodClosed: false,
    hasInvoice: false,
    hasBusinessNo: true,
    ...over,
  };
}

const blocked = (i: Partial<SettlementGateInput>, key: string) => {
  const g = evaluateSettlementGate(gateInput(i));
  return { canProceed: g.canProceed, check: g.checks.find((c) => c.key === key) };
};

describe('nextAction — 지금 할 수 있는 일은 하나뿐이다', () => {
  it('상태마다 다음 동작이 정해져 있다', () => {
    expect(nextAction('DRAFT')).toBe('CALCULATE');
    expect(nextAction('CALCULATED')).toBe('CONFIRM');
    expect(nextAction('REVIEWING')).toBe('CONFIRM');
    expect(nextAction('CONFIRMED')).toBe('APPROVE');
    expect(nextAction('APPROVED')).toBe('INVOICE');
    expect(nextAction('INVOICED')).toBe('PAY');
    expect(nextAction('PARTIALLY_PAID')).toBe('PAY');
  });

  it('끝난 정산은 더 갈 곳이 없다', () => {
    for (const s of ['PAID', 'CLOSED', 'CANCELLED']) {
      expect(nextAction(s), s).toBeNull();
    }
  });

  it('수납은 금액이 상태를 정하므로 statusAfter 가 답하지 않는다', () => {
    // 부분이면 PARTIALLY_PAID, 전액이면 PAID 다. 동작 이름만으로는 못 정한다.
    expect(statusAfter('PAY')).toBeNull();
    expect(statusAfter('CONFIRM')).toBe('CONFIRMED');
    expect(statusAfter('CANCEL')).toBe('CANCELLED');
  });

  it('허용되지 않은 전이는 막는다', () => {
    expect(canTransition('DRAFT', 'CALCULATED')).toBe(true);
    expect(canTransition('DRAFT', 'PAID')).toBe(false);
    expect(canTransition('PAID', 'DRAFT')).toBe(false);
  });
});

describe('evaluateSettlementGate — 언제나 막는 것', () => {
  it('마감된 기간의 정산은 어느 단계에서도 못 넘어간다', () => {
    for (const status of ['DRAFT', 'CALCULATED', 'CONFIRMED', 'APPROVED']) {
      const g = evaluateSettlementGate(gateInput({ status, periodClosed: true }));
      expect(g.canProceed, status).toBe(false);
    }
  });

  it('명세가 한 줄도 없으면 막는다', () => {
    const { canProceed, check } = blocked({ detailCount: 0 }, 'detail');

    expect(canProceed).toBe(false);
    expect(check?.level).toBe('blocker');
  });
});

describe('evaluateSettlementGate — 확정(CONFIRM)', () => {
  it('운임을 못 맞춘 줄이 있으면 막는다', () => {
    // 0원짜리 줄을 안고 확정하면 그 돈은 영영 청구되지 않는다.
    const { canProceed, check } = blocked({ status: 'CALCULATED', uncalculatedCount: 3 }, 'uncalculated');

    expect(canProceed).toBe(false);
    expect(check?.level).toBe('blocker');
  });

  it('이의가 걸려 있으면 막는다', () => {
    expect(blocked({ status: 'CALCULATED', hasDispute: true }, 'dispute').canProceed).toBe(false);
  });

  it('수기 입력과 상대처 미확인은 **막지 않는다** — 짚기만 한다', () => {
    // 이것까지 막으면 월말에 아무것도 안 넘어간다.
    const g = evaluateSettlementGate(
      gateInput({ status: 'CALCULATED', manualCount: 2, partnerConfirmed: false }),
    );

    expect(g.canProceed).toBe(true);
    expect(g.cautionCount).toBe(2);
    expect(g.checks.find((c) => c.key === 'manual')?.level).toBe('caution');
    expect(g.checks.find((c) => c.key === 'partner')?.level).toBe('caution');
  });

  it('확정은 되돌리기 어려운 동작으로 표시된다', () => {
    expect(evaluateSettlementGate(gateInput({ status: 'CALCULATED' })).irreversible).toBe(true);
  });
});

describe('evaluateSettlementGate — 승인(APPROVE)', () => {
  it('합계가 0원이면 막는다', () => {
    const { canProceed, check } = blocked({ status: 'CONFIRMED', totalAmount: 0 }, 'amount');

    expect(canProceed).toBe(false);
    expect(check?.level).toBe('blocker');
  });

  it('부대비·조정 결재가 안 끝났어도 막지 않는다', () => {
    // 부대비는 나중에 조정 전표로 붙이는 것이 정상 운영이다.
    const g = evaluateSettlementGate(
      gateInput({ status: 'CONFIRMED', pendingChargeCount: 2, pendingAdjustmentCount: 1 }),
    );

    expect(g.canProceed).toBe(true);
    expect(g.checks.find((c) => c.key === 'charge')?.level).toBe('caution');
  });
});

describe('evaluateSettlementGate — 계산서 발행(INVOICE)', () => {
  it('상대처 사업자등록번호가 없으면 막는다', () => {
    const { canProceed, check } = blocked({ status: 'APPROVED', hasBusinessNo: false }, 'businessNo');

    expect(canProceed).toBe(false);
    expect(check?.level).toBe('blocker');
  });

  it('이미 계산서가 있으면 막는다 — 중복 발행은 수정계산서로만 푼다', () => {
    expect(blocked({ status: 'APPROVED', hasInvoice: true }, 'duplicate').canProceed).toBe(false);
  });

  it('발행도 되돌리기 어려운 동작이다', () => {
    expect(evaluateSettlementGate(gateInput({ status: 'APPROVED' })).irreversible).toBe(true);
  });
});

describe('evaluateSettlementGate — 수납(PAY)', () => {
  it('남은 금액이 없으면 막는다 — 과입금은 DB 가 거절한다', () => {
    // ck_settlement_paid 가 paid <= total 을 강제한다. 화면이 먼저 말해 주는
    // 편이 낫다. 넣고 나서 거절당하면 얼마를 넣어야 했는지 다시 세야 한다.
    const { canProceed, check } = blocked(
      { status: 'INVOICED', totalAmount: 1_000_000, paidAmount: 1_000_000 },
      'remain',
    );

    expect(canProceed).toBe(false);
    expect(check?.level).toBe('blocker');
  });

  it('부분수납 상태에서는 남은 만큼 더 받을 수 있다', () => {
    const g = evaluateSettlementGate(
      gateInput({ status: 'PARTIALLY_PAID', totalAmount: 1_000_000, paidAmount: 600_000 }),
    );

    expect(g.canProceed).toBe(true);
  });
});

describe('evaluateSettlementGate — 더 갈 곳이 없을 때', () => {
  it('완납·마감·취소는 동작이 없고 진행도 못 한다', () => {
    for (const status of ['PAID', 'CLOSED', 'CANCELLED']) {
      const g = evaluateSettlementGate(gateInput({ status }));
      expect(g.action, status).toBeNull();
      expect(g.canProceed, status).toBe(false);
      expect(g.checks, status).toHaveLength(0);
    }
  });
});

// =====================================================================

function closeInput(over: Partial<CloseGateInput> = {}): CloseGateInput {
  return {
    yearMonth: '202607',
    unconfirmedActualCount: 0,
    unsettledActualCount: 0,
    unsettledAmount: 0,
    openSettlementCount: 0,
    disputeCount: 0,
    uninvoicedCount: 0,
    unpaidAmount: 0,
    unpaidCount: 0,
    alreadyClosed: false,
    future: false,
    ...over,
  };
}

describe('evaluateCloseGate — 마감', () => {
  it('아무것도 안 남았으면 닫을 수 있다', () => {
    const g = evaluateCloseGate(closeInput());

    expect(g.canClose).toBe(true);
    expect(g.blockerCount).toBe(0);
  });

  it('미확정 실적이 남아 있으면 막는다', () => {
    // 마감하면 그 실적들은 영영 정산에 못 들어간다. 되돌릴 수 없는 손실이다.
    const g = evaluateCloseGate(closeInput({ unconfirmedActualCount: 7 }));

    expect(g.canClose).toBe(false);
    expect(g.checks.find((c) => c.key === 'actual')?.level).toBe('blocker');
  });

  it('확정됐는데 정산에 안 묶인 실적이 남아 있으면 막는다', () => {
    const g = evaluateCloseGate(closeInput({ unsettledActualCount: 3, unsettledAmount: 5_000_000 }));

    expect(g.canClose).toBe(false);
    expect(g.checks.find((c) => c.key === 'unsettled')?.level).toBe('blocker');
  });

  it('이의가 걸려 있으면 막는다', () => {
    expect(evaluateCloseGate(closeInput({ disputeCount: 1 })).canClose).toBe(false);
  });

  it('이미 마감됐거나 아직 오지 않은 달은 막는다', () => {
    expect(evaluateCloseGate(closeInput({ alreadyClosed: true })).canClose).toBe(false);
    expect(evaluateCloseGate(closeInput({ future: true })).canClose).toBe(false);
  });

  it('미수·미발행·승인 전 정산은 **막지 않는다**', () => {
    // 마감은 기간을 잠그는 것이지 미수를 없애는 것이 아니다. 수납은 마감
    // 뒤에도 기록할 수 있다. 이것까지 막으면 돈이 다 들어올 때까지 회계를
    // 못 닫는다.
    const g = evaluateCloseGate(
      closeInput({ openSettlementCount: 2, uninvoicedCount: 3, unpaidCount: 4, unpaidAmount: 9_000_000 }),
    );

    expect(g.canClose).toBe(true);
    expect(g.cautionCount).toBe(3);
  });

  it('막힌 이유는 첫 번째 blocker 의 문장을 그대로 쓴다', () => {
    const g = evaluateCloseGate(closeInput({ unconfirmedActualCount: 7 }));

    expect(g.blockedReason).toBeTruthy();
    expect(g.blockedReason).toContain('7');
  });
});
