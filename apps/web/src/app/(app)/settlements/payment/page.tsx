'use client';

import { SettlementBoard } from '../_components/settlement-board';

/**
 * 매입 정산 — 운송사에 지급한다.
 *
 * 매출과 같은 화면이고 `type` 만 다르다. 바뀌는 것은 말뿐이다 —
 * 수금이 지급이 되고 화주가 운송사가 된다(`SETTLEMENT_VOICE`).
 */
export default function PaymentSettlementPage() {
  return <SettlementBoard settlementType="PAYMENT" />;
}
