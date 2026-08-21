import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  evaluateSettlementGate,
  toPageResult,
  type PageResult,
  type PaymentRecordInput,
  type SettlementInvoiceRow,
  type TaxInvoiceIssueInput,
  type TaxInvoiceStatusInput,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { SettlementService } from './settlement.service.js';
import {
  dateOnly,
  formatBusinessNo,
  invoiceRowOf,
  isoDate,
  monthRange,
  num,
  startOfToday,
} from './settlement-util.js';

export interface InvoiceListQuery {
  settlementType: string | null;
  yearMonth: string | null;
  status: string | null;
  keyword: string;
  dueOnly: boolean;
  page: number;
  size: number;
}

/**
 * 세금계산서와 수금·지급.
 *
 * ## 계산서는 정산의 그림자가 아니다
 *
 * 정산 금액이 바뀌면 계산서도 바뀌어야 할 것 같지만, 발행된 계산서는 국세청에
 * 이미 신고된 문서다. 금액을 고치는 길은 **수정 세금계산서** 하나뿐이고, 그
 * 사실이 이 서비스의 모든 제약을 만든다. 그래서 발행 시점의 금액과 상대처
 * 정보를 계산서 행에 통째로 박아 둔다(`supplier_*` · `buyer_*`).
 *
 * ## 공급자와 공급받는자는 매출·매입에서 뒤바뀐다
 *
 *   매출  우리가 화주에게 청구  → 공급자 = 우리 회사, 공급받는자 = 화주
 *   매입  운송사가 우리에게 청구 → 공급자 = 운송사, 공급받는자 = 우리 회사
 *
 * 매입 계산서는 원래 운송사가 발행하는 것이고, 여기서는 **받은 계산서를
 * 기록**하는 자리다. 그래서 국세청 전송을 하지 않는다.
 *
 * ## 국세청 실연동은 붙이지 않았다
 *
 * `nts_*` 칸은 있지만 실제 전송은 없다. 발행 대행사 계약과 인증서가 필요한
 * 일이라 이 범위 밖이다. 화면은 그 사실을 감추지 않는다 — 있는 척하는 버튼이
 * 가장 나쁘다.
 */
@Injectable()
export class SettlementLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
  ) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // 세금계산서
  // ===================================================================

  async listInvoices(
    principal: AuthPrincipal,
    query: InvoiceListQuery,
  ): Promise<
    PageResult<SettlementInvoiceRow> & {
      summary: {
        count: number;
        totalAmount: number;
        draftCount: number;
        issuedCount: number;
        rejectedCount: number;
        overdueCount: number;
        /** 승인됐는데 계산서가 아직 없는 정산 — 발행 대기 */
        awaitingCount: number;
        awaitingAmount: number;
        awaitingDueDays: number | null;
      };
    }
  > {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const today = isoDate(startOfToday());

      const settlementFilter = {
        ...(query.settlementType ? { settlement_type: query.settlementType as never } : {}),
        ...(query.yearMonth ? { settlement_year_month: query.yearMonth } : {}),
      };

      const rows = await tx.tax_invoice.findMany({
        where: {
          tenant_id,
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.keyword
            ? {
                OR: [
                  { invoice_no: { contains: query.keyword, mode: 'insensitive' as const } },
                  { buyer_name: { contains: query.keyword, mode: 'insensitive' as const } },
                  { supplier_name: { contains: query.keyword, mode: 'insensitive' as const } },
                  { nts_approval_no: { contains: query.keyword, mode: 'insensitive' as const } },
                ],
              }
            : {}),
          ...(Object.keys(settlementFilter).length > 0
            ? { settlement_tax_invoice_settlement_idTosettlement: { is: settlementFilter } }
            : {}),
        },
        include: {
          settlement_tax_invoice_settlement_idTosettlement: {
            select: {
              settlement_no: true,
              settlement_type: true,
              settlement_year_month: true,
            },
          },
        },
        orderBy: { tax_invoice_id: 'desc' },
      });

      const items = rows.map((r) =>
        invoiceRowOf(r, r.settlement_tax_invoice_settlement_idTosettlement, today),
      );
      const filtered = query.dueOnly
        ? items.filter((i) => i.deadline !== null && i.deadline.daysLeft <= 7)
        : items;

      /*
        발행 대기 — 승인은 났는데 계산서가 없는 정산.

        이 화면이 진짜 답해야 하는 것이 이것이다. 발행된 계산서 목록만 보여
        주면 "안 한 일" 이 화면에 없고, 기한은 안 한 일에 붙는다.
      */
      const awaiting = await tx.settlement.findMany({
        where: {
          tenant_id,
          deleted_at: null,
          status: 'APPROVED',
          ...(query.settlementType ? { settlement_type: query.settlementType as never } : {}),
          ...(query.yearMonth ? { settlement_year_month: query.yearMonth } : {}),
        },
        select: { total_amount: true, settlement_year_month: true },
      });

      let awaitingDueDays: number | null = null;
      for (const a of awaiting) {
        const [, end] = monthRange(a.settlement_year_month);
        const due = new Date(
          Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 10),
        );
        const days = Math.round((due.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
        awaitingDueDays = awaitingDueDays === null ? days : Math.min(awaitingDueDays, days);
      }

      const summary = {
        count: items.length,
        totalAmount: items.reduce((a, b) => a + b.totalAmount, 0),
        draftCount: items.filter((i) => i.status === 'DRAFT').length,
        issuedCount: items.filter((i) => ['ISSUED', 'SENT', 'ACCEPTED'].includes(i.status)).length,
        rejectedCount: items.filter((i) => i.status === 'REJECTED').length,
        overdueCount: items.filter((i) => i.deadline !== null && i.deadline.daysLeft < 0).length,
        awaitingCount: awaiting.length,
        awaitingAmount: awaiting.reduce((a, b) => a + (num(b.total_amount) ?? 0), 0),
        awaitingDueDays,
      };

      const page = filtered.slice((query.page - 1) * query.size, query.page * query.size);
      return { ...toPageResult(page, filtered.length, query.page, query.size), summary };
    });
  }

  /**
   * 계산서를 만든다.
   *
   * 발행은 되돌릴 수 없는 선이다. 그래서 관문을 서버가 다시 본다 — 화면이
   * 판정한 뒤 누르기까지 사이에 조정 전표가 승인되면 금액이 달라진다.
   */
  async issueInvoice(
    principal: AuthPrincipal,
    settlementId: string,
    dto: TaxInvoiceIssueInput,
  ): Promise<{ taxInvoiceId: string; invoiceNo: string | null }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.settlement.mustFind(tx, tenant_id, settlementId);

      if (header.status !== 'APPROVED') {
        throw AppError.conflict(
          'SETTLEMENT_NOT_APPROVED',
          '승인된 정산만 계산서를 낼 수 있습니다.',
        );
      }

      const existing = await tx.tax_invoice.findFirst({
        where: { tenant_id, settlement_id: header.settlement_id, status: { not: 'CANCELLED' } },
        select: { tax_invoice_id: true },
      });
      if (existing) {
        throw AppError.conflict(
          'INVOICE_DUPLICATE',
          '이미 계산서가 발행됐습니다. 금액을 바꾸려면 수정 세금계산서를 내야 합니다.',
        );
      }

      const [tenant, partner] = await Promise.all([
        tx.tenant.findFirst({
          where: { tenant_id },
          select: {
            tenant_name: true,
            business_no: true,
            ceo_name: true,
            address1: true,
            biz_type: true,
            biz_item: true,
            email: true,
          },
        }),
        tx.business_partner.findFirst({
          where: { tenant_id, partner_id: header.partner_id },
          select: {
            partner_name: true,
            business_no: true,
            ceo_name: true,
            address1: true,
            biz_type: true,
            biz_item: true,
            email: true,
          },
        }),
      ]);

      if (!tenant?.business_no) {
        throw AppError.badRequest(
          'TENANT_BUSINESS_NO_MISSING',
          '우리 회사의 사업자등록번호가 비어 있습니다. 시스템관리에서 채워야 계산서를 만들 수 있습니다.',
        );
      }
      if (!partner?.business_no) {
        throw AppError.badRequest(
          'PARTNER_BUSINESS_NO_MISSING',
          `${header.partner_name} 의 사업자등록번호가 비어 있습니다. 기준정보에서 채워 주세요.`,
        );
      }

      // 매출은 우리가 발행하고, 매입은 운송사가 발행한 것을 받아 적는다
      const weAreSupplier = header.settlement_type === 'BILLING';
      const supplier = weAreSupplier
        ? { name: tenant.tenant_name, ...tenant, business_no: tenant.business_no }
        : { name: partner.partner_name, ...partner, business_no: partner.business_no };
      const buyer = weAreSupplier
        ? { name: partner.partner_name, ...partner, business_no: partner.business_no }
        : { name: tenant.tenant_name, ...tenant, business_no: tenant.business_no };

      const supply = num(header.supply_amount) ?? 0;
      const tax = num(header.tax_amount) ?? 0;

      const invoice = await tx.tax_invoice.create({
        data: {
          tenant_id,
          settlement_id: header.settlement_id,
          invoice_type: dto.invoiceType as never,
          invoice_no: `${header.settlement_no}-TI`,
          issue_date: dateOnly(dto.issueDate),
          write_date: header.period_to,
          supplier_business_no: supplier.business_no,
          supplier_name: weAreSupplier ? tenant.tenant_name : partner.partner_name,
          supplier_ceo_name: supplier.ceo_name,
          supplier_address: supplier.address1,
          supplier_biz_type: supplier.biz_type,
          supplier_biz_item: supplier.biz_item,
          supplier_email: supplier.email,
          buyer_business_no: buyer.business_no,
          buyer_name: weAreSupplier ? partner.partner_name : tenant.tenant_name,
          buyer_ceo_name: buyer.ceo_name,
          buyer_address: buyer.address1,
          buyer_biz_type: buyer.biz_type,
          buyer_biz_item: buyer.biz_item,
          buyer_email: dto.buyerEmail ?? buyer.email,
          // ck_tax_invoice_amount — 합계를 먼저 만들고 역산하지 않는다
          supply_amount: supply,
          tax_amount: tax,
          total_amount: supply + tax,
          remark_text: dto.remarkText,
          // 국세청 실연동이 없으므로 ISSUED 에서 멈춘다. SENT 이상은 담당자가
          // 대행사 결과를 보고 손으로 옮긴다.
          status: 'ISSUED',
          created_by: principal.userId,
          updated_by: principal.userId,
        },
      });

      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          status: 'INVOICED',
          tax_invoice_id: invoice.tax_invoice_id,
          issue_date: dateOnly(dto.issueDate),
          updated_by: principal.userId,
        },
      });

      return { taxInvoiceId: String(invoice.tax_invoice_id), invoiceNo: invoice.invoice_no };
    });
  }

  /** 국세청 결과를 손으로 옮긴다 — 대행사 화면에서 본 것을 여기 적는다 */
  async updateInvoiceStatus(
    principal: AuthPrincipal,
    invoiceId: string,
    dto: TaxInvoiceStatusInput,
  ): Promise<{ taxInvoiceId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const row = await tx.tax_invoice.findFirst({
        where: { tenant_id, tax_invoice_id: BigInt(invoiceId) },
      });
      if (!row) throw AppError.notFound('INVOICE_NOT_FOUND', '계산서를 찾을 수 없습니다.');
      if (row.status === 'CANCELLED') {
        throw AppError.conflict('INVOICE_CANCELLED', '취소된 계산서는 상태를 바꿀 수 없습니다.');
      }
      if (dto.status === 'ACCEPTED' && !dto.ntsApprovalNo) {
        throw AppError.badRequest(
          'NTS_APPROVAL_NO_REQUIRED',
          '국세청 승인번호를 적어주세요. 승인번호 없는 승인은 확인할 방법이 없습니다.',
        );
      }
      if (dto.status === 'REJECTED' && !dto.ntsResultMessage) {
        throw AppError.badRequest('NTS_REASON_REQUIRED', '반려 사유를 적어주세요.');
      }

      await tx.tax_invoice.update({
        where: { tax_invoice_id: row.tax_invoice_id },
        data: {
          status: dto.status as never,
          nts_approval_no: dto.ntsApprovalNo ?? row.nts_approval_no,
          nts_result_message: dto.ntsResultMessage,
          nts_sent_at: dto.status === 'SENT' ? new Date() : row.nts_sent_at,
          updated_by: principal.userId,
        },
      });

      // 계산서가 취소되면 정산도 승인 상태로 되돌아간다. 안 그러면 발행되지
      // 않은 정산이 INVOICED 로 남아 수금 대상에 계속 뜬다.
      if (dto.status === 'CANCELLED' && row.settlement_id) {
        await tx.settlement.update({
          where: { settlement_id: row.settlement_id },
          data: { status: 'APPROVED', tax_invoice_id: null, updated_by: principal.userId },
        });
      }

      return { taxInvoiceId: invoiceId, status: dto.status };
    });
  }

  // ===================================================================
  // 수금 · 지급
  // ===================================================================

  /**
   * 돈이 들어온(나간) 것을 기록한다.
   *
   * 부분 수납이 정상이다 — 대기업 화주는 이의가 걸린 건만 빼고 나머지를 먼저
   * 보낸다. 그래서 상태는 금액이 정한다: 남으면 `PARTIALLY_PAID`, 다 들어오면
   * `PAID`.
   *
   * `ck_settlement_paid` 가 과입금(`paid > total + 0.01`)을 막는다. 여기서
   * 먼저 걸러 사람 말로 알려 주는 것은, DB 제약 위반 메시지를 그대로 보여
   * 주면 아무도 무슨 뜻인지 모르기 때문이다.
   */
  async recordPayment(
    principal: AuthPrincipal,
    dto: PaymentRecordInput,
  ): Promise<{ settlementId: string; status: string; paidAmount: number; unpaidAmount: number }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.settlement.mustFind(tx, tenant_id, dto.settlementId);

      if (!['INVOICED', 'PARTIALLY_PAID'].includes(header.status)) {
        throw AppError.conflict(
          'SETTLEMENT_NOT_PAYABLE',
          '계산서가 나간 정산에만 수납을 기록할 수 있습니다.',
        );
      }

      const total = num(header.total_amount) ?? 0;
      const paid = num(header.paid_amount) ?? 0;
      const remain = total - paid;
      if (dto.paymentAmount > remain) {
        throw AppError.badRequest(
          'PAYMENT_OVER',
          `남은 금액은 ${remain.toLocaleString('ko-KR')}원입니다. 그보다 많이 넣을 수 없습니다.`,
          { remain },
        );
      }

      await tx.payment_record.create({
        data: {
          tenant_id,
          settlement_id: header.settlement_id,
          partner_id: header.partner_id,
          payment_direction: (header.settlement_type === 'BILLING'
            ? 'RECEIPT'
            : 'DISBURSEMENT') as never,
          payment_method: dto.paymentMethod as never,
          payment_date: dateOnly(dto.paymentDate),
          payment_amount: dto.paymentAmount,
          bank_name: dto.bankName,
          account_no: dto.accountNo,
          depositor_name: dto.depositorName,
          transaction_no: dto.transactionNo,
          // 은행 거래내역 자동 대사는 이 범위 밖이다. 손으로 넣은 것은
          // 넣은 사람이 확인한 것이므로 대사 완료로 둔다.
          is_matched: true,
          matched_at: new Date(),
          matched_by: principal.userId,
          remark: dto.remark,
          created_by: principal.userId,
          updated_by: principal.userId,
        },
      });

      const nextPaid = paid + dto.paymentAmount;
      const status = nextPaid >= total ? 'PAID' : 'PARTIALLY_PAID';

      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          paid_amount: nextPaid,
          unpaid_amount: total - nextPaid,
          last_paid_at: new Date(),
          status: status as never,
          updated_by: principal.userId,
        },
      });

      return {
        settlementId: dto.settlementId,
        status,
        paidAmount: nextPaid,
        unpaidAmount: total - nextPaid,
      };
    });
  }

  /** 잘못 넣은 수납을 지운다. 상태도 같이 되돌린다 */
  async deletePayment(
    principal: AuthPrincipal,
    paymentId: string,
  ): Promise<{ settlementId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const row = await tx.payment_record.findFirst({
        where: { tenant_id, payment_record_id: BigInt(paymentId) },
      });
      if (!row) throw AppError.notFound('PAYMENT_NOT_FOUND', '수납 기록을 찾을 수 없습니다.');

      const header = await this.settlement.mustFind(tx, tenant_id, String(row.settlement_id));
      if (header.status === 'CLOSED') {
        throw AppError.conflict('SETTLEMENT_CLOSED', '마감된 정산의 수납은 지울 수 없습니다.');
      }

      await tx.payment_record.delete({ where: { payment_record_id: row.payment_record_id } });

      const total = num(header.total_amount) ?? 0;
      const rest = await tx.payment_record.aggregate({
        where: { tenant_id, settlement_id: header.settlement_id },
        _sum: { payment_amount: true },
      });
      const paid = num(rest._sum.payment_amount) ?? 0;
      const status = paid <= 0 ? 'INVOICED' : paid >= total ? 'PAID' : 'PARTIALLY_PAID';

      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          paid_amount: paid,
          unpaid_amount: total - paid,
          status: status as never,
          updated_by: principal.userId,
        },
      });

      return { settlementId: String(header.settlement_id), status };
    });
  }

  /**
   * 미수 · 미지급 현황.
   *
   * 연령분석(aging)은 정산 화면의 사다리가 답하지 못하는 질문에 답한다 —
   * 사다리는 "얼마가 걸렸나" 를 말하고, 이 표는 **"얼마나 오래 걸렸나"** 를
   * 말한다. 30일 넘은 미수와 어제 넘긴 미수는 같은 돈이 아니다.
   */
  async aging(
    principal: AuthPrincipal,
    settlementType: string,
  ): Promise<{
    buckets: { key: string; label: string; count: number; amount: number }[];
    partners: {
      partnerId: string;
      partnerName: string;
      count: number;
      amount: number;
      oldestDays: number;
      buckets: number[];
    }[];
    total: number;
  }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const today = startOfToday();

      const rows = await tx.settlement.findMany({
        where: {
          tenant_id,
          settlement_type: settlementType as never,
          deleted_at: null,
          status: { in: ['INVOICED', 'PARTIALLY_PAID'] },
        },
        select: {
          partner_id: true,
          partner_name: true,
          total_amount: true,
          paid_amount: true,
          payment_due_date: true,
        },
      });

      const edges = [0, 30, 60, 90];
      const labels = ['기한 내', '1–30일', '31–60일', '61–90일', '90일 초과'];
      const buckets = labels.map((label, i) => ({
        key: `b${i}`,
        label,
        count: 0,
        amount: 0,
      }));

      const byPartner = new Map<
        string,
        { partnerId: string; partnerName: string; count: number; amount: number; oldestDays: number; buckets: number[] }
      >();

      let total = 0;
      for (const r of rows) {
        const remain = (num(r.total_amount) ?? 0) - (num(r.paid_amount) ?? 0);
        if (remain <= 0) continue;
        const days = r.payment_due_date
          ? Math.round((today.getTime() - r.payment_due_date.getTime()) / 86_400_000)
          : 0;

        let idx = 0;
        if (days > 0) {
          idx = 1;
          for (let i = 1; i < edges.length; i += 1) if (days > edges[i]!) idx = i + 1;
        }

        buckets[idx]!.count += 1;
        buckets[idx]!.amount += remain;
        total += remain;

        const key = String(r.partner_id);
        const p =
          byPartner.get(key) ??
          {
            partnerId: key,
            partnerName: r.partner_name,
            count: 0,
            amount: 0,
            oldestDays: 0,
            buckets: labels.map(() => 0),
          };
        p.count += 1;
        p.amount += remain;
        p.oldestDays = Math.max(p.oldestDays, Math.max(0, days));
        p.buckets[idx]! += remain;
        byPartner.set(key, p);
      }

      return {
        buckets,
        partners: [...byPartner.values()].sort((a, b) => b.amount - a.amount),
        total,
      };
    });
  }

  /** 정산 상세가 쓰는 관문 — 컨트롤러에서 미리보기용으로 부른다 */
  gatePreview = evaluateSettlementGate;

  /** 사업자번호 표기 — 화면과 계산서가 같은 모양을 쓰게 한다 */
  formatBusinessNo = formatBusinessNo;
}
