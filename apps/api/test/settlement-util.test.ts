/**
 * 정산 모듈의 날짜·숫자 변환.
 *
 * 이 저장소에서 가장 자주 난 사고가 여기 있다. `date` 컬럼에 **로컬 자정**을
 * 넣으면 KST(+9)에서 전날 15시 UTC 가 되고 Postgres 가 하루 앞당겨 저장한다.
 * 이 계열 버그는 **화면이 멀쩡히 그려져서** 안 보인다 — 틀린 날의 데이터가
 * 정상으로 나올 뿐이다.
 *
 * 이번에도 났다. 세금계산서 발행일 기본값이 `toISOString().slice(0,10)` 이라
 * KST 오전 9시 전에 발행하면 **어제 날짜로 저장**됐다.
 *
 * 그래서 여기서는 "KST 이른 아침" 과 "KST 늦은 밤" 을 일부러 골라 넣는다.
 * 그 두 시각이 UTC 로 날짜가 갈리는 지점이기 때문이다.
 */
import { describe, expect, it } from 'vitest';
import {
  addDaysUtc,
  dateOnly,
  formatBusinessNo,
  invoiceIssueDate,
  isoDate,
  monthRange,
  num,
  sum,
} from '../src/settlement/settlement-util.js';

describe('dateOnly — YYYY-MM-DD 를 그날 UTC 자정으로', () => {
  it('시각이 UTC 자정이다', () => {
    const d = dateOnly('2026-08-22');

    expect(d.toISOString()).toBe('2026-08-22T00:00:00.000Z');
    expect(d.getUTCHours()).toBe(0);
  });

  it('로컬 시간대와 무관하게 같은 날이 나온다', () => {
    // `new Date('2026-08-22')` 와 달리 `new Date(2026, 7, 22)` 는 로컬 자정이라
    // KST 에서 UTC 로 바꾸면 8월 21일 15시가 된다. 그 차이를 못 박는다.
    expect(isoDate(dateOnly('2026-08-22'))).toBe('2026-08-22');
    expect(isoDate(dateOnly('2026-01-01'))).toBe('2026-01-01');
    expect(isoDate(dateOnly('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('isoDate — Date 를 YYYY-MM-DD 로', () => {
  it('UTC 기준으로 자른다', () => {
    expect(isoDate(new Date('2026-08-22T00:00:00Z'))).toBe('2026-08-22');
    expect(isoDate(new Date('2026-08-22T23:59:59Z'))).toBe('2026-08-22');
  });

  it('KST 이른 아침은 UTC 로 전날이다 — 이 함수는 UTC 를 말한다', () => {
    // KST 08:00 = UTC 전날 23:00. 이 함수의 결과를 "오늘" 로 쓰면 하루가 밀린다.
    // 화면의 기본값에는 로컬 날짜를 따로 만들어 쓰는 이유가 이것이다.
    const kstMorning = new Date('2026-08-22T08:00:00+09:00');

    expect(isoDate(kstMorning)).toBe('2026-08-21');
  });

  it('KST 늦은 밤은 UTC 로 같은 날이다', () => {
    const kstNight = new Date('2026-08-22T23:00:00+09:00');

    expect(isoDate(kstNight)).toBe('2026-08-22');
  });
});

describe('monthRange — 그달 1일과 말일', () => {
  it('말일을 정확히 집는다', () => {
    const [from, to] = monthRange('202607');

    expect(isoDate(from)).toBe('2026-07-01');
    expect(isoDate(to)).toBe('2026-07-31');
  });

  it('30일인 달 · 2월 · 윤년을 가른다', () => {
    expect(isoDate(monthRange('202606')[1])).toBe('2026-06-30');
    expect(isoDate(monthRange('202602')[1])).toBe('2026-02-28');
    expect(isoDate(monthRange('202402')[1])).toBe('2024-02-29'); // 윤년
  });

  it('12월도 해를 안 넘긴다', () => {
    const [from, to] = monthRange('202612');

    expect(isoDate(from)).toBe('2026-12-01');
    expect(isoDate(to)).toBe('2026-12-31');
  });

  it('양끝이 UTC 자정이다 — date 컬럼과 견주려면 시각이 0이어야 한다', () => {
    const [from, to] = monthRange('202607');

    expect(from.getUTCHours()).toBe(0);
    expect(to.getUTCHours()).toBe(0);
  });
});

describe('invoiceIssueDate — 법정 발행기한', () => {
  it('공급일이 속한 달의 다음 달 10일이다', () => {
    expect(isoDate(invoiceIssueDate('202607'))).toBe('2026-08-10');
  });

  it('12월은 이듬해 1월 10일이다', () => {
    // 월에 1을 더하다 13월을 만드는 실수가 흔하다.
    expect(isoDate(invoiceIssueDate('202612'))).toBe('2027-01-10');
  });
});

describe('addDaysUtc — 결제 예정일 계산', () => {
  it('일수를 더한다', () => {
    expect(isoDate(addDaysUtc(dateOnly('2026-07-31'), 30))).toBe('2026-08-30');
  });

  it('달과 해를 넘긴다', () => {
    expect(isoDate(addDaysUtc(dateOnly('2026-12-20'), 30))).toBe('2027-01-19');
  });

  it('원본을 바꾸지 않는다', () => {
    const base = dateOnly('2026-07-31');
    addDaysUtc(base, 30);

    expect(isoDate(base)).toBe('2026-07-31');
  });
});

describe('num — Decimal 을 숫자로', () => {
  it('null 과 undefined 는 null 로 통과시킨다', () => {
    // 0 으로 바꾸면 "값이 없다" 와 "0원" 이 구별되지 않는다. 미청구와 무료는
    // 다른 것이다.
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  it('Prisma Decimal 처럼 문자열로 오는 것도 숫자로 만든다', () => {
    expect(num('433016')).toBe(433_016);
    expect(num('433016.50')).toBe(433_016.5);
    expect(num(0)).toBe(0);
  });

  it('숫자가 아닌 것은 null 이다 — NaN 을 흘려보내지 않는다', () => {
    // NaN 이 합계에 한 번 섞이면 그 뒤 모든 금액이 NaN 이 된다.
    expect(num('abc')).toBeNull();
    expect(num({})).toBeNull();
    expect(num(Infinity)).toBeNull();
  });
});

describe('sum', () => {
  it('빈 배열은 0이다', () => {
    expect(sum([])).toBe(0);
  });

  it('음수가 섞여도 그대로 더한다 — 조정 전표가 음수다', () => {
    expect(sum([1_000_000, -180_000, 20_000])).toBe(840_000);
  });
});

describe('formatBusinessNo — 000-00-00000', () => {
  it('열 자리를 세 토막으로 나눈다', () => {
    expect(formatBusinessNo('1208147521')).toBe('120-81-47521');
  });

  it('열 자리가 아니면 손대지 않는다', () => {
    // 잘못된 번호를 그럴듯한 모양으로 만들면 틀린 것을 못 알아본다.
    expect(formatBusinessNo('12345')).toBe('12345');
  });

  it('null 은 null 이다', () => {
    expect(formatBusinessNo(null)).toBeNull();
  });
});
