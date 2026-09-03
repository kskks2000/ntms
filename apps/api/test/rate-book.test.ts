/**
 * 요율 꾸러미(RateBook) — 어느 표를 어떤 **순서로** 시도하는가.
 *
 * 이 저장소에서 돈이 실제로 틀렸던 자리가 정확히 여기다.
 *
 * `loadRateBook()` 이 거래처를 안 가리는 표를 `'COMMON'` 키 **하나**에 밀어
 * 넣었다. 매입 공통표가 둘(기본 거리요율 · 스팟 운임)이라 나중 것이 앞 것을
 * 덮었고, 표준 위수탁 계약을 맺은 운송사들이 전부 **스팟 단가로 지급**됐다.
 * 오류도 경고도 없고 금액은 나오므로 아무도 못 봤다 — 운송의 4분의 1이
 * 적자로 찍히고 나서야 드러났다.
 *
 * 그래서 여기서 못 박는 것은 셋이다:
 *   1. 승인된 표가 **사라지지 않는다** (공통표가 여러 장이어도)
 *   2. 계약이 지정한 표가 **맨 앞**이다
 *   3. 순서가 **실행마다 같다** (같은 운송이 어제와 오늘 다른 금액이면 안 된다)
 *
 * DB 대신 대역을 넘긴다. `loadRateBook` 이 tx 에서 쓰는 것은 findMany 둘뿐이라
 * 프리즈마를 띄울 이유가 없다 — 이 함수가 답해야 하는 것은 질의가 아니라
 * **모아 놓은 뒤의 순서**다.
 */
import { describe, expect, it } from 'vitest';
import { loadRateBook } from '../src/settlement/rate-engine.js';
import type { TxClient } from '@ntms/db';

interface FakeTable {
  code: string;
  partnerId: bigint | null;
  start: string;
}

/** rate_table 한 줄. 줄(detail)은 아무 조건도 안 거는 것 하나 */
function row(t: FakeTable, id: number) {
  return {
    rate_table_id: BigInt(id),
    rate_table_code: t.code,
    rate_table_name: t.code,
    rate_target: 'PAYMENT',
    rate_method: 'DISTANCE',
    partner_id: t.partnerId,
    apply_start_date: new Date(`${t.start}T00:00:00Z`),
    apply_end_date: null,
    min_charge_amount: null,
    round_unit: 1,
    round_method: 'ROUND',
    include_toll: true,
    apply_fuel_surcharge: false,
    is_taxable: true,
    rate_table_detail: [
      {
        rate_detail_id: BigInt(id * 100),
        line_no: 1,
        priority: 100,
        from_zone_id: null,
        to_zone_id: null,
        vehicle_type_id: null,
        distance_from: null,
        distance_to: null,
        weight_from: null,
        weight_to: null,
        volume_from: null,
        volume_to: null,
        qty_from: null,
        qty_to: null,
        stop_count_from: null,
        stop_count_to: null,
        base_amount: 100_000,
        unit_rate: null,
        min_amount: null,
        max_amount: null,
        extra_stop_amount: null,
        waiting_free_min: null,
        waiting_rate_hour: null,
        return_rate_pct: null,
      },
    ],
  };
}

/** findMany 둘만 답하는 대역 */
function fakeTx(tables: FakeTable[]): TxClient {
  return {
    // map 은 두 번째 인자로 **인덱스**를 넘긴다. row(t, i) 로 그냥 넘기면
    // id 가 0 부터 시작해 테스트가 헷갈린다. 1 부터로 못 박는다.
    rate_table: { findMany: async () => tables.map((t, i) => row(t, i + 1)) },
    fuel_surcharge: { findMany: async () => [] },
  } as unknown as TxClient;
}

/** 표의 id 는 넣은 순서로 정해지지만, 테스트는 코드로 찾는 편이 안 헷갈린다 */
function idOf(book: { byId: Map<string, { rateTableCode: string; rateTableId: string }> }, code: string): string {
  const hit = [...book.byId.values()].find((t) => t.rateTableCode === code);
  if (!hit) throw new Error(`${code} 를 못 찾았다`);
  return hit.rateTableId;
}

const load = (tables: FakeTable[]) =>
  loadRateBook(fakeTx(tables), 1n, 'PAYMENT', new Date('2026-07-01T00:00:00Z'), '202607');

describe('loadRateBook — 승인된 표가 사라지지 않는다', () => {
  it('거래처를 안 가리는 표가 여러 장이어도 전부 남는다', async () => {
    // 이것이 바로 그 사고다. 예전에는 'COMMON' 키 하나에 밀어 넣어
    // 나중 것이 앞 것을 덮었다.
    const book = await load([
      { code: 'RT-PAY-DIST', partnerId: null, start: '2026-01-01' },
      { code: 'RT-PAY-SPOT', partnerId: null, start: '2026-01-01' },
    ]);

    expect(book.common).toHaveLength(2);
    expect(book.common.map((t) => t.rateTableCode).sort()).toEqual(['RT-PAY-DIST', 'RT-PAY-SPOT']);
  });

  it('공통표가 둘이면 둘 다 시도 대상에 들어간다', async () => {
    const book = await load([
      { code: 'RT-PAY-DIST', partnerId: null, start: '2026-01-01' },
      { code: 'RT-PAY-SPOT', partnerId: null, start: '2026-01-01' },
    ]);

    expect(book.tablesFor(null)).toHaveLength(2);
  });

  it('같은 거래처의 표가 여러 장이면 개정판(시작일이 늦은 것)이 이긴다', async () => {
    // 전용표는 덮는 것이 맞다. 같은 거래처의 같은 표가 개정된 것이기 때문이다.
    const book = await load([
      { code: 'RT-OLD', partnerId: 7n, start: '2026-01-01' },
      { code: 'RT-NEW', partnerId: 7n, start: '2026-06-01' },
    ]);

    expect(book.tables.get('7')?.rateTableCode).toBe('RT-NEW');
  });
});

describe('loadRateBook — 시도 순서', () => {
  it('계약이 지정한 표가 맨 앞이다', async () => {
    // 표의 partner_id 는 "이 표는 누구 것인가" 이지 "이 거래처는 어느 표를
    // 쓰는가" 가 아니다. 스팟 요율표 한 장을 여러 운송사가 함께 쓰는 것이
    // 실무이고, 그것을 정하는 것은 계약서다.
    const book = await load([
      { code: 'RT-COMMON', partnerId: null, start: '2026-01-01' },
      { code: 'RT-OWN', partnerId: 7n, start: '2026-01-01' },
      { code: 'RT-CONTRACT', partnerId: 9n, start: '2026-01-01' },
    ]);

    const chain = book.tablesFor('7', idOf(book, 'RT-CONTRACT'));

    expect(chain.map((t) => t.rateTableCode)).toEqual(['RT-CONTRACT', 'RT-OWN', 'RT-COMMON']);
  });

  it('계약이 없으면 전용표 → 공통표 순이다', async () => {
    const book = await load([
      { code: 'RT-COMMON', partnerId: null, start: '2026-01-01' },
      { code: 'RT-OWN', partnerId: 7n, start: '2026-01-01' },
    ]);

    expect(book.tablesFor('7').map((t) => t.rateTableCode)).toEqual(['RT-OWN', 'RT-COMMON']);
  });

  it('전용표도 계약도 없으면 공통표만 남는다', async () => {
    const book = await load([{ code: 'RT-COMMON', partnerId: null, start: '2026-01-01' }]);

    expect(book.tablesFor('99').map((t) => t.rateTableCode)).toEqual(['RT-COMMON']);
  });

  it('같은 표가 두 번 들어가지 않는다', async () => {
    // 계약이 지정한 표가 그 거래처의 전용표와 같을 수 있다. 두 번 시도해도
    // 결과는 같지만, 화면의 "시도한 표" 목록에 같은 이름이 두 번 뜬다.
    const book = await load([{ code: 'RT-OWN', partnerId: 7n, start: '2026-01-01' }]);
    const own = book.tables.get('7')!;

    expect(book.tablesFor('7', own.rateTableId)).toHaveLength(1);
  });
});

describe('loadRateBook — 순서가 실행마다 같다', () => {
  it('같은 날 시작한 공통표 둘은 코드 순으로 고정된다', async () => {
    // 순서가 실행마다 달라지면 같은 운송의 금액이 어제와 오늘이 다르고,
    // 그건 아무도 재현하지 못하는 버그가 된다.
    const forward = await load([
      { code: 'RT-AAA', partnerId: null, start: '2026-01-01' },
      { code: 'RT-BBB', partnerId: null, start: '2026-01-01' },
    ]);
    const reversed = await load([
      { code: 'RT-BBB', partnerId: null, start: '2026-01-01' },
      { code: 'RT-AAA', partnerId: null, start: '2026-01-01' },
    ]);

    expect(forward.common.map((t) => t.rateTableCode)).toEqual(['RT-AAA', 'RT-BBB']);
    expect(reversed.common.map((t) => t.rateTableCode)).toEqual(['RT-AAA', 'RT-BBB']);
  });

  it('시작일이 늦은 공통표를 먼저 시도한다', async () => {
    // 개정판이 먼저다. 옛 표는 개정판에 없는 구간을 받는 바닥으로 남는다.
    const book = await load([
      { code: 'RT-2026', partnerId: null, start: '2026-01-01' },
      { code: 'RT-2025', partnerId: null, start: '2025-01-01' },
    ]);

    expect(book.common.map((t) => t.rateTableCode)).toEqual(['RT-2026', 'RT-2025']);
  });
});

describe('loadRateBook — 표가 없을 때', () => {
  it('빈 꾸러미를 돌려준다 — 예외를 던지지 않는다', async () => {
    const book = await load([]);

    expect(book.common).toHaveLength(0);
    expect(book.tablesFor('7')).toHaveLength(0);
    expect(book.fuel).toBeNull();
  });
});
