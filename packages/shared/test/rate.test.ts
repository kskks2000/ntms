/**
 * 운임 계산기.
 *
 * 이 파일이 있는 이유는 실제로 돈이 틀렸기 때문이다. 승인된 매입 운임표가
 * 키 충돌로 조용히 사라져서, 표준 계약을 맺은 운송사들이 몇 달간 스팟
 * 단가로 지급됐다. 오류도 경고도 없었고 금액은 나왔으므로 아무도 못 봤다 —
 * 운송의 4분의 1이 적자로 찍히고 나서야 드러났다.
 *
 * 그래서 여기서 제일 먼저 못 박는 것은 **요율 체인의 순서**다.
 */
import { describe, expect, it } from 'vitest';
import { calculateRate } from '../src/settlement.js';
import { ctx, fuel, line, step, table } from './fixtures.js';

describe('calculateRate — 요율 체인', () => {
  it('앞의 표에서 줄을 찾으면 뒤의 표는 안 본다', () => {
    const contract = table({
      rateTableId: '10',
      rateTableName: '계약 요율표',
      lines: [line({ baseAmount: 80_000 })],
    });
    const common = table({
      rateTableId: '20',
      rateTableName: '공통 요율표',
      lines: [line({ baseAmount: 500_000 })],
    });

    const r = calculateRate(ctx(), [contract, common]);

    expect(r.matched).toBe(true);
    expect(r.rateTableId).toBe('10');
    expect(r.baseAmount).toBe(80_000);
  });

  it('앞의 표에 맞는 줄이 없으면 뒤의 표로 떨어진다', () => {
    // 권역요율표는 실제로 오가는 구간만 담는다. 새 구간이 생기면 그 표에서는
    // 아무 줄도 안 걸리고, 그때 공통 거리요율로 떨어지는 것이 실무다.
    const zoneOnly = table({
      rateTableId: '10',
      rateTableName: '권역 요율표',
      lines: [line({ fromZoneId: 'Z9', toZoneId: 'Z8', baseAmount: 80_000 })],
    });
    const common = table({
      rateTableId: '20',
      rateTableName: '공통 거리요율',
      lines: [line({ baseAmount: 120_000 })],
    });

    const r = calculateRate(ctx({ fromZoneId: 'Z1', toZoneId: 'Z2' }), [zoneOnly, common]);

    expect(r.matched).toBe(true);
    expect(r.rateTableId).toBe('20');
  });

  it('표를 한 장도 안 주면 못 맞췄다고 답한다 — 예외를 던지지 않는다', () => {
    // 매칭 실패는 결과의 한 종류이지 사고가 아니다. 예외로 던지면 한 건 때문에
    // 그 달 정산 생성이 통째로 멈춘다.
    const r = calculateRate(ctx(), []);

    expect(r.matched).toBe(false);
    expect(r.totalAmount).toBe(0);
    expect(r.unmatchedReason).toBeTruthy();
  });

  it('표는 있는데 맞는 줄이 없으면 시도한 표 이름을 사유에 남긴다', () => {
    const r = calculateRate(
      ctx({ vehicleTypeId: 'VT-없는차종' }),
      [table({ rateTableName: '거리요율', lines: [line({ vehicleTypeId: 'VT1' })] })],
    );

    expect(r.matched).toBe(false);
    expect(r.unmatchedReason).toContain('거리요율');
  });
});

describe('calculateRate — 줄 고르기', () => {
  it('priority 가 작은 줄이 먼저다', () => {
    const t = table({
      lines: [
        line({ lineNo: 1, priority: 90, baseAmount: 90_000 }),
        line({ lineNo: 2, priority: 10, baseAmount: 10_000 }),
      ],
    });

    expect(calculateRate(ctx(), t).baseAmount).toBe(10_000);
  });

  it('priority 가 같으면 lineNo 가 작은 줄이 먼저다', () => {
    const t = table({
      lines: [
        line({ lineNo: 7, priority: 100, baseAmount: 70_000 }),
        line({ lineNo: 3, priority: 100, baseAmount: 30_000 }),
      ],
    });

    expect(calculateRate(ctx(), t).baseAmount).toBe(30_000);
  });

  it('거리 구간은 하한 이상 · 상한 미만이다', () => {
    // 경계에서 두 줄이 겹치면 같은 운송이 표를 읽는 사람마다 다른 금액이 된다.
    const t = table({
      lines: [
        line({ lineNo: 1, distanceFrom: 0, distanceTo: 150, baseAmount: 100_000 }),
        line({ lineNo: 2, distanceFrom: 150, distanceTo: null, baseAmount: 200_000 }),
      ],
    });

    expect(calculateRate(ctx({ distanceKm: 149.9 }), t).baseAmount).toBe(100_000);
    expect(calculateRate(ctx({ distanceKm: 150 }), t).baseAmount).toBe(200_000);
  });

  it('조건 칸이 있는데 컨텍스트가 비어 있으면 그 줄은 안 걸린다', () => {
    // 거리를 모르는 실적에 거리 구간 줄을 붙이면 0km 로 쳐서 최저 구간에
    // 걸린다. 모르는 것을 0 으로 읽는 순간 금액이 조용히 틀어진다.
    const t = table({ lines: [line({ distanceFrom: 0, distanceTo: 150 })] });

    expect(calculateRate(ctx({ distanceKm: null }), t).matched).toBe(false);
  });
});

describe('calculateRate — 금액', () => {
  it('기본료 + 단위×단가', () => {
    const t = table({
      rateMethod: 'DISTANCE',
      lines: [line({ baseAmount: 150_000, unitRate: 1_540 })],
    });

    const r = calculateRate(ctx({ distanceKm: 162 }), t);

    // 150,000 + 162 × 1,540 = 399,480
    expect(r.baseAmount).toBe(399_480);
    expect(step(r.steps, 'unit')?.amount).toBe(249_480);
  });

  it('ZONE · PER_TRIP 은 곱할 것이 없어 기본료가 전부다', () => {
    for (const method of ['ZONE', 'PER_TRIP', 'FIXED']) {
      const t = table({ rateMethod: method, lines: [line({ baseAmount: 300_000, unitRate: 9_999 })] });
      expect(calculateRate(ctx(), t).baseAmount).toBe(300_000);
    }
  });

  it('표의 최저 청구액이 그보다 적은 금액을 끌어올린다', () => {
    const t = table({
      minChargeAmount: 90_000,
      lines: [line({ baseAmount: 30_000 })],
    });

    const r = calculateRate(ctx(), t);

    expect(r.baseAmount).toBe(90_000);
    expect(step(r.steps, 'minCharge')?.amount).toBe(60_000);
  });

  it('최저 청구액을 이미 넘으면 건드리지 않는다', () => {
    const t = table({ minChargeAmount: 90_000, lines: [line({ baseAmount: 120_000 })] });
    const r = calculateRate(ctx(), t);

    expect(r.baseAmount).toBe(120_000);
    expect(step(r.steps, 'minCharge')).toBeUndefined();
  });

  it('절사는 표가 정한 단위와 방식을 따른다', () => {
    const base = { lines: [line({ baseAmount: 123_456 })], roundUnit: 1_000 };

    expect(calculateRate(ctx(), table({ ...base, roundMethod: 'FLOOR' })).baseAmount).toBe(123_000);
    expect(calculateRate(ctx(), table({ ...base, roundMethod: 'CEIL' })).baseAmount).toBe(124_000);
    expect(calculateRate(ctx(), table({ ...base, roundMethod: 'ROUND' })).baseAmount).toBe(123_000);
  });
});

describe('calculateRate — 부대비', () => {
  it('대기료는 무료 시간을 넘긴 만큼, 시간 단위로 올린다', () => {
    const t = table({
      lines: [line({ baseAmount: 100_000, waitingFreeMin: 60, waitingRateHour: 25_000 })],
    });

    // 90분 중 30분 초과 → 1시간으로 올림
    const r = calculateRate(ctx({ waitingMinutes: 90 }), t);
    const waiting = r.charges.find((c) => c.chargeCode === 'WAITING');

    expect(waiting?.amount).toBe(25_000);
    expect(waiting?.qty).toBe(1);
  });

  it('무료 시간 안에 끝났으면 대기료가 없다', () => {
    const t = table({
      lines: [line({ baseAmount: 100_000, waitingFreeMin: 60, waitingRateHour: 25_000 })],
    });

    expect(calculateRate(ctx({ waitingMinutes: 60 }), t).charges).toHaveLength(0);
  });

  it('경유료는 상·하차 두 곳을 넘는 정차마다 붙는다', () => {
    const t = table({ lines: [line({ baseAmount: 100_000, extraStopAmount: 30_000 })] });

    expect(calculateRate(ctx({ stopCount: 2 }), t).charges).toHaveLength(0);

    const r = calculateRate(ctx({ stopCount: 5 }), t);
    expect(r.charges.find((c) => c.chargeCode === 'EXTRA_STOP')?.amount).toBe(90_000);
  });

  it('통행료는 운임에 포함하지 않는 표에서만 실비로 얹는다', () => {
    const withToll = table({ includeToll: true, lines: [line({ baseAmount: 100_000 })] });
    const withoutToll = table({ includeToll: false, lines: [line({ baseAmount: 100_000 })] });

    expect(calculateRate(ctx({ tollFee: 7_570 }), withToll).charges).toHaveLength(0);
    expect(calculateRate(ctx({ tollFee: 7_570 }), withoutToll).charges[0]?.amount).toBe(7_570);
  });
});

describe('calculateRate — 유류할증', () => {
  it('표가 유류할증을 안 쓰면 유가가 올라도 안 붙는다', () => {
    const t = table({ applyFuelSurcharge: false, lines: [line({ baseAmount: 100_000 })] });

    expect(calculateRate(ctx(), t, fuel({ surchargeRatePct: 6.5 })).fuelSurchargeAmount).toBe(0);
  });

  it('비율은 **기본 운임** 기준이다 — 부대비를 포함하지 않는다', () => {
    // 부대비까지 포함해 곱하면 대기가 길었던 운송만 유류할증이 커진다.
    // 유가와 대기시간은 아무 상관이 없다.
    const t = table({
      applyFuelSurcharge: true,
      lines: [line({ baseAmount: 100_000, extraStopAmount: 50_000 })],
    });

    const r = calculateRate(ctx({ stopCount: 4 }), t, fuel({ surchargeRatePct: 10 }));

    expect(r.surchargeAmount).toBe(100_000); // 경유 2곳
    expect(r.fuelSurchargeAmount).toBe(10_000); // 기본 100,000 의 10%
  });

  it('km 단가가 비율보다 우선한다', () => {
    const t = table({ applyFuelSurcharge: true, lines: [line({ baseAmount: 100_000 })] });

    const r = calculateRate(
      ctx({ distanceKm: 200 }),
      t,
      fuel({ surchargePerKm: 30, surchargeRatePct: 50 }),
    );

    expect(r.fuelSurchargeAmount).toBe(6_000); // 200km × 30원
  });
});

describe('calculateRate — 공급가와 부가세', () => {
  it('공급가를 먼저 세우고 부가세를 그 위에서 만든다', () => {
    // ck_settlement_amount 가 total = supply + tax 를 강제한다. 합계를 먼저
    // 정하고 공급가를 역산하면 반올림으로 1원이 어긋나 INSERT 자체가 죽는다.
    const t = table({ lines: [line({ baseAmount: 433_016 })] });
    const r = calculateRate(ctx(), t);

    expect(r.supplyAmount).toBe(433_016);
    expect(r.taxAmount).toBe(43_302);
    expect(r.totalAmount).toBe(r.supplyAmount + r.taxAmount);
  });

  it('금액이 얼마든 total = supply + tax 가 깨지지 않는다', () => {
    for (const amount of [1, 7, 999, 12_345, 433_016, 1_000_001, 87_654_321]) {
      const r = calculateRate(ctx(), table({ lines: [line({ baseAmount: amount })] }));
      expect(r.totalAmount, `기본료 ${amount}`).toBe(r.supplyAmount + r.taxAmount);
    }
  });

  it('면세 표는 부가세가 0 이고 합계가 공급가와 같다', () => {
    const t = table({ isTaxable: false, lines: [line({ baseAmount: 100_000 })] });
    const r = calculateRate(ctx(), t);

    expect(r.taxAmount).toBe(0);
    expect(r.totalAmount).toBe(100_000);
  });
});

describe('calculateRate — 산출 근거', () => {
  it('계단의 마지막 running 이 합계와 같다', () => {
    // 화면은 이 계단을 그대로 편다. 계단의 끝과 헤더의 합계가 다르면
    // 보는 사람은 둘 중 무엇을 믿어야 할지 알 수 없다.
    const t = table({
      applyFuelSurcharge: true,
      includeToll: false,
      lines: [line({ baseAmount: 150_000, unitRate: 1_540, extraStopAmount: 30_000 })],
    });

    const r = calculateRate(
      ctx({ distanceKm: 162, stopCount: 3, tollFee: 7_570 }),
      t,
      fuel({ surchargeRatePct: 6.5 }),
    );

    expect(r.steps.at(-1)?.key).toBe('total');
    expect(r.steps.at(-1)?.running).toBe(r.totalAmount);
  });

  it('근거에 표의 값을 값째로 박는다 — id 만 남기지 않는다', () => {
    // 운임표가 개정돼도 과거 정산을 재현할 수 있어야 한다. id 로 다시 읽으면
    // 개정된 값이 나온다.
    const t = table({ rateTableCode: 'RT-BIL-DIST', lines: [line({ baseAmount: 100_000 })] });
    const r = calculateRate(ctx(), t);

    expect(r.rateTableCode).toBe('RT-BIL-DIST');
    expect(r.detail).toBeTruthy();
  });
});
