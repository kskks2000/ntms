/**
 * 세금계산서 발행 기한.
 *
 * 이 파일도 실제로 틀렸던 자리다. 발행이 끝난 계산서까지 **오늘과** 견주는
 * 바람에, 8월 10일에 제때 낸 7월 계산서가 8월 22일에는 "기한 12일 초과" 로
 * 떴다. 지표 카드의 「기한 초과」가 발행한 장 수와 같아졌고(13장 중 13장),
 * 그 순간 그 숫자는 아무 뜻도 없어졌다.
 *
 * 축이 둘이라는 것이 요점이다:
 *   발행 전 → "며칠 남았나" (오늘과 견준다)
 *   발행 후 → "제때 냈나"   (발행일과 견준다)
 */
import { describe, expect, it } from 'vitest';
import { invoiceDeadline } from '../src/settlement.js';

describe('invoiceDeadline — 법정 기한', () => {
  it('공급일이 속한 달의 다음 달 10일이다', () => {
    expect(invoiceDeadline('202607', '2026-08-01').dueDate).toBe('2026-08-10');
  });

  it('12월은 해를 넘긴다', () => {
    // 월에 1을 더하다 13월을 만드는 실수가 흔하다.
    expect(invoiceDeadline('202612', '2026-12-20').dueDate).toBe('2027-01-10');
  });
});

describe('invoiceDeadline — 발행 전 (며칠 남았나)', () => {
  it('남은 날을 센다', () => {
    const d = invoiceDeadline('202607', '2026-08-01');

    expect(d.daysLeft).toBe(9);
    expect(d.label).toBe('9일 남음');
    expect(d.tone).toBe('normal');
  });

  it('사흘 이내면 urgent, 이레 이내면 soon', () => {
    expect(invoiceDeadline('202607', '2026-08-08').tone).toBe('urgent'); // 2일
    expect(invoiceDeadline('202607', '2026-08-05').tone).toBe('soon'); // 5일
  });

  it('당일은 "오늘이 기한"', () => {
    const d = invoiceDeadline('202607', '2026-08-10');

    expect(d.daysLeft).toBe(0);
    expect(d.label).toBe('오늘이 기한');
  });

  it('넘겼으면 초과로 센다', () => {
    const d = invoiceDeadline('202607', '2026-08-22');

    expect(d.daysLeft).toBe(-12);
    expect(d.label).toBe('기한 12일 초과');
    expect(d.tone).toBe('over');
  });
});

describe('invoiceDeadline — 발행 후 (제때 냈나)', () => {
  it('기한 당일에 냈으면 "기한 내 발행"이다', () => {
    // 이것이 틀렸던 바로 그 경우다. 기한에 딱 맞춰 낸 것을 초과로 세면
    // 제때 낸 계산서가 영원히 빨간 줄로 남는다.
    const d = invoiceDeadline('202607', '2026-08-10', true);

    expect(d.label).toBe('기한 내 발행');
    expect(d.tone).toBe('normal');
  });

  it('기한보다 일찍 냈어도 "기한 내 발행" 하나로 말한다', () => {
    // 발행이 끝난 뒤에는 "며칠 남았었나" 가 아무 정보도 아니다.
    expect(invoiceDeadline('202607', '2026-08-03', true).label).toBe('기한 내 발행');
  });

  it('늦게 냈으면 며칠 넘겼는지 과거형으로 말한다', () => {
    const d = invoiceDeadline('202607', '2026-08-13', true);

    expect(d.label).toBe('기한 3일 넘겨 발행');
    expect(d.tone).toBe('over');
  });

  it('발행한 뒤에는 urgent · soon 이 나오지 않는다', () => {
    // 이미 끝난 일에 "급함" 을 붙이면 목록이 온통 빨간색이 되고,
    // 그러면 진짜 급한 줄이 안 보인다.
    for (const day of ['2026-08-04', '2026-08-08', '2026-08-09', '2026-08-10']) {
      expect(invoiceDeadline('202607', day, true).tone, day).toBe('normal');
    }
  });

  it('시간이 지나도 판정이 안 바뀐다 — 발행일만 보기 때문이다', () => {
    // 같은 계산서를 오늘 봐도 반 년 뒤에 봐도 같은 말이 나와야 한다.
    const issued = invoiceDeadline('202607', '2026-08-10', true);
    const laterView = invoiceDeadline('202607', '2026-08-10', true);

    expect(laterView).toEqual(issued);
  });
});

describe('invoiceDeadline — 막대 길이', () => {
  it('발행이 끝난 줄은 막대를 꽉 채운다', () => {
    expect(invoiceDeadline('202607', '2026-08-10', true).ratio).toBe(1);
  });

  it('발행 전에는 남은 날에 비례하고 0~1 을 벗어나지 않는다', () => {
    expect(invoiceDeadline('202607', '2026-08-22').ratio).toBe(0); // 넘긴 것
    expect(invoiceDeadline('202607', '2026-08-10').ratio).toBe(0); // 당일
    expect(invoiceDeadline('202607', '2026-07-01').ratio).toBeLessThanOrEqual(1);
    expect(invoiceDeadline('202607', '2026-07-01').ratio).toBeGreaterThan(0);
  });
});
