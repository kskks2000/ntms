/**
 * 실적 확정 관문.
 *
 * 확정이 파이프라인의 경계다. 확정된 실적은 정산이 물고 가고, 세금계산서가
 * 나가면 고치는 길은 조정 전표뿐이다. 그래서 이 관문이 무엇을 막고 무엇을
 * 짚기만 하는지가 곧 "돌이킬 수 없는 지점" 의 정의다.
 *
 * 화면과 서버가 이 함수를 **같이** 부른다. 서버가 한 번 더 부르는 것은 화면을
 * 안 믿어서가 아니라, 화면이 판정한 뒤 확정을 누르기까지 사이에 인수증이
 * 취소될 수 있어서다.
 */
import { describe, expect, it } from 'vitest';
import { evaluateConfirmGate, type ConfirmGateInput } from '../src/actual.js';

/** 아무것도 안 막는 실적. 여기에 얹어서 한 칸만 망가뜨린다 */
function actual(over: Partial<ConfirmGateInput> = {}): ConfirmGateInput {
  return {
    confirmStatus: 'DRAFT',
    orderCount: 3,
    podCollectedCount: 3,
    podConfirmedCount: 3,
    openSettlementExceptionCount: 0,
    incompleteStopCount: 0,
    stopCount: 2,
    plannedDistanceKm: 100,
    actualDistanceKm: 102,
    periodClosed: false,
    ...over,
  };
}

const check = (i: Partial<ConfirmGateInput>, key: string) =>
  evaluateConfirmGate(actual(i)).checks.find((c) => c.key === key);

describe('evaluateConfirmGate — 막는 것', () => {
  it('아무 문제가 없으면 확정할 수 있다', () => {
    const g = evaluateConfirmGate(actual());

    expect(g.canConfirm).toBe(true);
    expect(g.blockerCount).toBe(0);
    expect(g.blockedReason).toBeNull();
  });

  it('마감된 기간의 실적은 막는다', () => {
    // DB 트리거(fn_guard_settlement_close)도 막지만, 버튼을 눌러 놓고
    // 42501 을 받는 것보다 화면이 먼저 말해 주는 편이 낫다.
    const g = evaluateConfirmGate(actual({ periodClosed: true }));

    expect(g.canConfirm).toBe(false);
    expect(check({ periodClosed: true }, 'period')?.level).toBe('blocker');
  });

  it('인수증이 빠진 오더가 있으면 막는다', () => {
    // 인수증 없이 확정하면 청구 근거가 빈 채로 정산에 넘어간다.
    const g = evaluateConfirmGate(actual({ orderCount: 3, podCollectedCount: 1 }));

    expect(g.canConfirm).toBe(false);
    expect(g.blockedReason).toContain('2건');
  });

  it('정산에 영향을 주는 미해결 예외가 있으면 막는다', () => {
    // 손해액을 누가 무는지 정해야 금액이 갈린다.
    const g = evaluateConfirmGate(actual({ openSettlementExceptionCount: 1 }));

    expect(g.canConfirm).toBe(false);
    expect(check({ openSettlementExceptionCount: 1 }, 'exception')?.level).toBe('blocker');
  });

  it('인수증이 오더 수보다 많아도 음수로 세지 않는다', () => {
    // 한 오더에 인수증이 두 장 붙는 일이 있다(재배송·분할인도).
    const g = evaluateConfirmGate(actual({ orderCount: 2, podCollectedCount: 5 }));

    expect(g.canConfirm).toBe(true);
  });
});

describe('evaluateConfirmGate — 짚기만 하는 것', () => {
  it('인수증 확인 전 · 정차 미완 · 거리 편차는 막지 않는다', () => {
    // 이것까지 막으면 월말에 아무것도 확정되지 않는다.
    const g = evaluateConfirmGate(
      actual({
        podConfirmedCount: 0,
        incompleteStopCount: 2,
        plannedDistanceKm: 100,
        actualDistanceKm: 150,
      }),
    );

    expect(g.canConfirm).toBe(true);
    expect(g.cautionCount).toBe(3);
  });

  it('거리 편차는 15% 가 경계다', () => {
    const under = actual({ plannedDistanceKm: 100, actualDistanceKm: 114 });
    const over = actual({ plannedDistanceKm: 100, actualDistanceKm: 115 });

    expect(evaluateConfirmGate(under).cautionCount).toBe(0);
    expect(evaluateConfirmGate(over).cautionCount).toBe(1);
  });

  it('덜 달린 것도 편차다 — 부호를 보지 않는다', () => {
    // 계획보다 짧게 달렸으면 그만큼 운임 근거가 줄어든다.
    const g = evaluateConfirmGate(actual({ plannedDistanceKm: 100, actualDistanceKm: 50 }));

    expect(g.checks.find((c) => c.key === 'distance')?.passed).toBe(false);
  });

  it('거리를 모르면 편차를 따지지 않는다', () => {
    // 모르는 것을 0 으로 읽으면 100% 편차가 되어 모든 실적에 경고가 뜬다.
    for (const d of [{ plannedDistanceKm: null }, { actualDistanceKm: null }, { plannedDistanceKm: 0 }]) {
      expect(evaluateConfirmGate(actual(d)).cautionCount, JSON.stringify(d)).toBe(0);
    }
  });
});

describe('evaluateConfirmGate — 이미 끝난 실적', () => {
  it('관문이 전부 통과여도 다시 확정할 수 없다', () => {
    const g = evaluateConfirmGate(actual({ confirmStatus: 'CONFIRMED' }));

    expect(g.blockerCount).toBe(0);
    expect(g.canConfirm).toBe(false);
    expect(g.blockedReason).toBe('이미 확정된 실적입니다.');
  });

  it('마감된 실적은 마감이라고 말한다 — 확정과 구별한다', () => {
    expect(evaluateConfirmGate(actual({ confirmStatus: 'CLOSED' })).blockedReason).toBe(
      '마감된 실적입니다.',
    );
  });

  it('확정 해제된 실적은 다시 확정할 수 있다', () => {
    expect(evaluateConfirmGate(actual({ confirmStatus: 'REOPENED' })).canConfirm).toBe(true);
  });
});

describe('evaluateConfirmGate — 목록에서도 보이려면', () => {
  it('막힌 이유가 한 문장으로 나온다', () => {
    // 상세를 열어야 이유를 알면 스무 건을 확정하려고 스무 번을 연다.
    const g = evaluateConfirmGate(actual({ orderCount: 3, podCollectedCount: 0 }));

    expect(g.blockedReason).toBeTruthy();
    expect(typeof g.blockedReason).toBe('string');
  });

  it('막는 것이 여럿이면 첫 번째 이유를 든다', () => {
    const g = evaluateConfirmGate(
      actual({ periodClosed: true, podCollectedCount: 0, openSettlementExceptionCount: 2 }),
    );

    expect(g.blockerCount).toBe(3);
    expect(g.blockedReason).toContain('마감된 정산 기간');
  });
});
