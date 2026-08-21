'use client';

import { SettlementBoard } from '../_components/settlement-board';

/**
 * 매출 정산 — 화주에게 청구한다.
 *
 * 화면 본체는 매입과 공유한다. `settlement` 이 매출·매입을 같은 구조로 다루기
 * 때문이고, 두 벌로 나누면 확정 규칙이 한쪽에만 반영되는 사고가 반드시 난다.
 */
export default function BillingSettlementPage() {
  return <SettlementBoard settlementType="BILLING" />;
}
