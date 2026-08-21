import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller.js';
import { SettlementService } from './settlement.service.js';
import { SettlementLedgerService } from './settlement-ledger.service.js';
import { SettlementCloseService } from './settlement-close.service.js';

/**
 * 정산 — 파이프라인의 마지막 칸.
 *
 * 서비스를 셋으로 나눈 것은 파일 길이 때문이 아니라 **되돌릴 수 없는 선이
 * 셋이기 때문**이다. 정산 확정 · 계산서 발행 · 기간 마감. 각각 다른 것을
 * 잠그고 다른 관문을 지난다.
 */
@Module({
  controllers: [SettlementController],
  providers: [SettlementService, SettlementLedgerService, SettlementCloseService],
  exports: [SettlementService],
})
export class SettlementModule {}
