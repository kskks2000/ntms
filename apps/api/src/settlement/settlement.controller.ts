import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  paymentRecordSchema,
  settlementAdjustmentSchema,
  settlementApprovalSchema,
  settlementCalculateSchema,
  settlementChargeSchema,
  settlementCloseSchema,
  settlementDisputeSchema,
  settlementGenerateSchema,
  settlementReopenCloseSchema,
  settlementReopenSchema,
  settlementTransitionSchema,
  taxInvoiceIssueSchema,
  taxInvoiceStatusSchema,
  type PaymentRecordInput,
  type SettlementAdjustmentInput,
  type SettlementApprovalInput,
  type SettlementChargeInput,
  type SettlementCloseInput,
  type SettlementDisputeInput,
  type SettlementGenerateInput,
  type SettlementReopenCloseInput,
  type SettlementReopenInput,
  type SettlementTransitionInput,
  type TaxInvoiceIssueInput,
  type TaxInvoiceStatusInput,
} from '@ntms/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { SettlementService, type SettlementListQuery } from './settlement.service.js';
import { SettlementLedgerService, type InvoiceListQuery } from './settlement-ledger.service.js';
import { SettlementCloseService } from './settlement-close.service.js';

const currentYearMonth = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const yearMonth = z.string().regex(/^\d{6}$/, '연월 형식이 올바르지 않습니다 (YYYYMM)');
const settlementType = z.enum(['BILLING', 'PAYMENT']);

/**
 * 정렬 키는 허용 목록으로 받는다.
 *
 * 쿼리 문자열을 그대로 orderBy 에 넘기면 스키마가 노출되고, 인덱스 없는 칸으로
 * 표를 통째로 훑게 만들 수도 있다.
 */
const listSchema = z.object({
  settlementType,
  yearMonth: yearMonth.default(currentYearMonth),
  partnerId: z.string().regex(/^\d+$/).nullable().default(null),
  status: z
    .enum([
      'OPEN',
      'DRAFT',
      'CALCULATED',
      'REVIEWING',
      'CONFIRMED',
      'APPROVED',
      'INVOICED',
      'PARTIALLY_PAID',
      'PAID',
      'CLOSED',
      'CANCELLED',
    ])
    .nullable()
    .default(null),
  keyword: z.string().trim().max(60).default(''),
  overdueOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(200).default(20),
  sort: z
    .enum(['no:desc', 'no:asc', 'amount:desc', 'amount:asc', 'unpaid:desc', 'overdue:desc', 'partner:asc'])
    .default('no:desc'),
});

const summarySchema = z.object({ yearMonth: yearMonth.default(currentYearMonth) });

const invoiceListSchema = z.object({
  settlementType: settlementType.nullable().default(null),
  yearMonth: yearMonth.nullable().default(null),
  status: z.enum(['DRAFT', 'ISSUED', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED']).nullable().default(null),
  keyword: z.string().trim().max(60).default(''),
  dueOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(200).default(20),
});

const closeBoardSchema = z.object({
  settlementType,
  year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getUTCFullYear()),
});

const agingSchema = z.object({ settlementType });

/**
 * 정산 창구.
 *
 * 매출과 매입이 **같은 표 · 같은 상태 · 같은 관문**이므로 창구도 하나다.
 * `settlementType` 이 갈래를 정한다. 두 벌로 나누면 확정 규칙이 한쪽에만
 * 반영되는 사고가 반드시 난다.
 *
 * ## 권한
 *
 * 조회는 정산·관리자·조회전용까지 열고, **금액을 움직이는 것은 정산·관리자만**
 * 한다. `@Roles` 는 데코레이터일 뿐이고 실제 집행은 `AuthModule` 에 등록된
 * `RolesGuard` 가 한다 — 가드 없이 데코레이터만 붙은 상태는 조용히 열린 문이다.
 */
@Controller('settlements')
export class SettlementController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly ledger: SettlementLedgerService,
    private readonly close: SettlementCloseService,
  ) {}

  // 구체 경로를 먼저 둔다. :id 가 위에 있으면 'summary' 를 id 로 먹는다.

  @Get('summary')
  summary(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(summarySchema)) q: { yearMonth: string },
  ) {
    return this.settlement.summary(user, q.yearMonth);
  }

  @Get('invoices')
  invoices(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(invoiceListSchema)) q: InvoiceListQuery,
  ) {
    return this.ledger.listInvoices(user, q);
  }

  @Get('aging')
  aging(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(agingSchema)) q: { settlementType: string },
  ) {
    return this.ledger.aging(user, q.settlementType);
  }

  @Get('closes')
  closeBoard(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(closeBoardSchema))
    q: { settlementType: 'BILLING' | 'PAYMENT'; year: number },
  ) {
    return this.close.board(user, q.settlementType, q.year);
  }

  @Post('closes')
  @Roles('ADMIN', 'SETTLEMENT')
  closePeriod(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(settlementCloseSchema)) dto: SettlementCloseInput,
  ) {
    return this.close.close(user, dto);
  }

  @Post('closes/:id/reopen')
  @Roles('ADMIN', 'SETTLEMENT')
  reopenPeriod(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementReopenCloseSchema)) dto: SettlementReopenCloseInput,
  ) {
    return this.close.reopen(user, id, dto.reason);
  }

  @Post('generate')
  @Roles('ADMIN', 'SETTLEMENT')
  generate(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(settlementGenerateSchema)) dto: SettlementGenerateInput,
  ) {
    return this.settlement.generate(user, dto);
  }

  @Post('payments')
  @Roles('ADMIN', 'SETTLEMENT')
  recordPayment(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(paymentRecordSchema)) dto: PaymentRecordInput,
  ) {
    return this.ledger.recordPayment(user, dto);
  }

  @Delete('payments/:id')
  @Roles('ADMIN', 'SETTLEMENT')
  deletePayment(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.ledger.deletePayment(user, id);
  }

  @Patch('invoices/:id')
  @Roles('ADMIN', 'SETTLEMENT')
  updateInvoice(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(taxInvoiceStatusSchema)) dto: TaxInvoiceStatusInput,
  ) {
    return this.ledger.updateInvoiceStatus(user, id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(listSchema)) q: SettlementListQuery,
  ) {
    return this.settlement.list(user, q);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.settlement.detail(user, id);
  }

  @Post(':id/calculate')
  @Roles('ADMIN', 'SETTLEMENT')
  calculate(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementCalculateSchema)) dto: { overwriteManual: boolean },
  ) {
    return this.settlement.calculate(user, id, dto.overwriteManual);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'SETTLEMENT')
  transition(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementTransitionSchema)) dto: SettlementTransitionInput,
  ) {
    return this.settlement.transition(user, id, dto);
  }

  @Post(':id/reopen')
  @Roles('ADMIN', 'SETTLEMENT')
  reopen(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementReopenSchema)) dto: SettlementReopenInput,
  ) {
    return this.settlement.reopen(user, id, dto.reason);
  }

  @Post(':id/dispute')
  @Roles('ADMIN', 'SETTLEMENT')
  dispute(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementDisputeSchema)) dto: SettlementDisputeInput,
  ) {
    return this.settlement.dispute(user, id, dto.reason);
  }

  @Post(':id/partner-confirm')
  @Roles('ADMIN', 'SETTLEMENT')
  partnerConfirm(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.settlement.partnerConfirm(user, id);
  }

  @Post(':id/charges')
  @Roles('ADMIN', 'SETTLEMENT')
  addCharge(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementChargeSchema)) dto: SettlementChargeInput,
  ) {
    return this.settlement.addCharge(user, id, dto);
  }

  @Patch(':id/charges/:chargeId')
  @Roles('ADMIN', 'SETTLEMENT')
  approveCharge(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @Body(new ZodValidationPipe(settlementApprovalSchema)) dto: SettlementApprovalInput,
  ) {
    return this.settlement.approveCharge(user, id, chargeId, dto.approve, dto.reason);
  }

  @Delete(':id/charges/:chargeId')
  @Roles('ADMIN', 'SETTLEMENT')
  deleteCharge(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
  ) {
    return this.settlement.deleteCharge(user, id, chargeId);
  }

  @Post(':id/adjustments')
  @Roles('ADMIN', 'SETTLEMENT')
  addAdjustment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementAdjustmentSchema)) dto: SettlementAdjustmentInput,
  ) {
    return this.settlement.addAdjustment(user, id, dto);
  }

  @Patch(':id/adjustments/:adjustmentId')
  @Roles('ADMIN', 'SETTLEMENT')
  approveAdjustment(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
    @Body(new ZodValidationPipe(settlementApprovalSchema)) dto: SettlementApprovalInput,
  ) {
    return this.settlement.approveAdjustment(user, id, adjustmentId, dto.approve, dto.reason);
  }

  @Post(':id/invoice')
  @Roles('ADMIN', 'SETTLEMENT')
  issueInvoice(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(taxInvoiceIssueSchema)) dto: TaxInvoiceIssueInput,
  ) {
    return this.ledger.issueInvoice(user, id, dto);
  }
}
