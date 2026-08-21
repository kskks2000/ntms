import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  buildCashLadder,
  evaluateSettlementGate,
  nextAction,
  settlementReopenBlockReason,
  statusAfter,
  toPageResult,
  canTransition,
  SETTLEMENT_ACTION_LABEL,
  SETTLEMENT_OPEN_STATUSES,
  type BulkResult,
  type CashLadder,
  type LadderStage,
  type PageResult,
  type RateCalculation,
  type RateStep,
  type SettlementAdjustmentInput,
  type SettlementAdjustmentRow,
  type SettlementChargeInput,
  type SettlementChargeRow,
  type SettlementDetailPage,
  type SettlementDetailRow,
  type SettlementGenerateInput,
  type SettlementHistoryEntry,
  type SettlementListItem,
  type SettlementListSummary,
  type SettlementPaymentRow,
  type SettlementTransitionInput,
  type SurchargeTypeOption,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import {
  billingContext,
  loadRateBook,
  paymentContext,
  runRate,
  type RateBook,
} from './rate-engine.js';
import {
  addDaysUtc,
  invoiceIssueDate,
  invoiceRowOf,
  iso,
  isoDate,
  monthRange,
  num,
  startOfToday,
  sum,
} from './settlement-util.js';

const VAT_RATE = 0.1;

export interface SettlementListQuery {
  settlementType: 'BILLING' | 'PAYMENT';
  yearMonth: string;
  partnerId: string | null;
  status: string | null;
  keyword: string;
  overdueOnly: boolean;
  page: number;
  size: number;
  sort: string;
}

/**
 * 정산 — 생성 · 산출 · 확정 · 승인.
 *
 * ## 정산은 실적 위에서만 존재한다
 *
 * 스키마가 그렇게 못 박아 두었다(`settlement_detail.actual_id` FK). 확정되지
 * 않은 실적은 정산에 못 들어오고, 정산에 들어간 실적은 확정을 못 되돌린다.
 * 그 경계가 `transport_actual.billing_settled` · `payment_settled` 다.
 *
 * ## 매출과 매입은 단위가 다르다
 *
 * 같은 표를 쓰지만 한 줄이 뜻하는 것이 다르다.
 *
 *   매출  화주에게 청구한다  → 한 줄 = **오더 한 건**(`actual_order`)
 *   매입  운송사에 지급한다  → 한 줄 = **트립 한 건**(`transport_actual`)
 *
 * 한 차에 두 화주의 짐이 실리면 청구서는 두 장으로 갈리지만, 그 차를 굴린
 * 운송사에는 한 번만 준다. 이것을 한 단위로 통일하면 둘 중 하나가 반드시
 * 틀린다.
 *
 * ## 금액은 항상 세 층으로 쌓는다
 *
 *   명세(detail)  운임표가 만든 것 + 계산기가 아는 부대비
 *   부대비(charge) 사람이 붙인 것 — 하역비 · 도서산간 · 특수장비
 *   조정(adjustment) 확정 뒤에 금액을 바꾸는 **유일한 길**
 *
 * 헤더 금액은 이 셋의 합이고, `recomputeTotals()` 한 곳에서만 다시 만든다.
 * 여러 곳에서 헤더를 직접 고치기 시작하면 `ck_settlement_amount` 가
 * (total = supply + tax) 언젠가 반드시 터진다.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // CashLadder — 돈이 어디서 멈춰 있나
  // ===================================================================

  async summary(principal: AuthPrincipal, yearMonth: string): Promise<CashLadder> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const [from, to] = monthRange(yearMonth);
      const today = startOfToday();

      const [settlements, actuals] = await Promise.all([
        tx.settlement.findMany({
          where: {
            tenant_id,
            settlement_year_month: yearMonth,
            deleted_at: null,
            status: { not: 'CANCELLED' },
          },
          select: {
            settlement_type: true,
            status: true,
            total_amount: true,
            paid_amount: true,
            payment_due_date: true,
          },
        }),
        /*
          아직 정산에 안 묶인 확정 실적.

          사다리 맨 윗단(청구 가능한 전액)은 "정산된 것 + 아직 안 묶인 것"
          이다. 정산 금액만 세면 맨 윗단과 둘째 단이 늘 같아져서, 가장 흔한
          병목("실적은 확정됐는데 정산을 안 돌렸다")이 그림에서 사라진다.
        */
        tx.transport_actual.findMany({
          where: {
            tenant_id,
            actual_date: { gte: from, lte: to },
            confirm_status: 'CONFIRMED',
            OR: [{ billing_settled: false }, { payment_settled: false }],
          },
          select: {
            billing_settled: true,
            payment_settled: true,
            billing_amount: true,
            payment_amount: true,
          },
        }),
      ]);

      const blank = (): Record<LadderStage, { amount: number; count: number }> => ({
        ACTUAL: { amount: 0, count: 0 },
        CREATED: { amount: 0, count: 0 },
        CONFIRMED: { amount: 0, count: 0 },
        INVOICED: { amount: 0, count: 0 },
        PAID: { amount: 0, count: 0 },
      });
      const billing = blank();
      const payment = blank();

      for (const s of settlements) {
        const bucket = s.settlement_type === 'BILLING' ? billing : payment;
        const total = num(s.total_amount) ?? 0;
        const paid = num(s.paid_amount) ?? 0;

        bucket.CREATED.amount += total;
        bucket.CREATED.count += 1;

        if (['CONFIRMED', 'APPROVED', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'].includes(s.status)) {
          bucket.CONFIRMED.amount += total;
          bucket.CONFIRMED.count += 1;
        }
        if (['INVOICED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'].includes(s.status)) {
          bucket.INVOICED.amount += total;
          bucket.INVOICED.count += 1;
        }
        // 마지막 단만 **실제로 들어온 돈**을 센다. 상태로 세면 부분수납이
        // 통째로 미수로 보이거나 통째로 수납으로 보인다.
        bucket.PAID.amount += paid;
        if (s.status === 'PAID' || s.status === 'CLOSED') bucket.PAID.count += 1;
      }

      for (const a of actuals) {
        if (!a.billing_settled) {
          billing.ACTUAL.amount += num(a.billing_amount) ?? 0;
          billing.ACTUAL.count += 1;
        }
        if (!a.payment_settled) {
          payment.ACTUAL.amount += num(a.payment_amount) ?? 0;
          payment.ACTUAL.count += 1;
        }
      }
      billing.ACTUAL.amount += billing.CREATED.amount;
      billing.ACTUAL.count += billing.CREATED.count;
      payment.ACTUAL.amount += payment.CREATED.amount;
      payment.ACTUAL.count += payment.CREATED.count;

      // 기한을 넘긴 것
      const overdue = {
        billingAmount: 0,
        billingCount: 0,
        paymentAmount: 0,
        paymentCount: 0,
        oldestDays: null as number | null,
      };
      for (const s of settlements) {
        if (!['INVOICED', 'PARTIALLY_PAID'].includes(s.status)) continue;
        if (!s.payment_due_date || s.payment_due_date >= today) continue;
        const remain = (num(s.total_amount) ?? 0) - (num(s.paid_amount) ?? 0);
        if (remain <= 0) continue;
        const days = Math.round((today.getTime() - s.payment_due_date.getTime()) / 86_400_000);
        if (s.settlement_type === 'BILLING') {
          overdue.billingAmount += remain;
          overdue.billingCount += 1;
        } else {
          overdue.paymentAmount += remain;
          overdue.paymentCount += 1;
        }
        overdue.oldestDays = Math.max(overdue.oldestDays ?? 0, days);
      }

      return buildCashLadder({ yearMonth, billing, payment, overdue });
    });
  }

  // ===================================================================
  // 목록
  // ===================================================================

  async list(
    principal: AuthPrincipal,
    query: SettlementListQuery,
  ): Promise<PageResult<SettlementListItem> & { summary: SettlementListSummary }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const [from, to] = monthRange(query.yearMonth);
      const today = startOfToday();

      const where = {
        tenant_id,
        settlement_type: query.settlementType as never,
        settlement_year_month: query.yearMonth,
        deleted_at: null,
        ...(query.status === 'OPEN'
          ? { status: { in: [...SETTLEMENT_OPEN_STATUSES] as never } }
          : query.status
            ? { status: query.status as never }
            : {}),
        ...(query.partnerId ? { partner_id: BigInt(query.partnerId) } : {}),
        ...(query.keyword
          ? {
              OR: [
                { settlement_no: { contains: query.keyword, mode: 'insensitive' as const } },
                { partner_name: { contains: query.keyword, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const rows = await tx.settlement.findMany({
        where,
        include: {
          tax_invoice_tax_invoice_settlement_idTosettlement: {
            select: { tax_invoice_id: true, status: true },
            orderBy: { tax_invoice_id: 'desc' },
            take: 1,
          },
        },
      });

      const ids = rows.map((r) => r.settlement_id);
      const [pendingCharges, pendingAdjustments, uncalculated, manualCounts, closed] =
        await Promise.all([
          groupCount(tx, 'settlement_charge', ids, tenant_id, {
            approval_status: { in: ['DRAFT', 'REQUESTED'] },
            is_auto_calculated: false,
          }),
          groupCount(tx, 'settlement_adjustment', ids, tenant_id, {
            status: { in: ['DRAFT', 'REQUESTED'] },
          }),
          // 운임을 못 맞춘 줄은 `rate_detail_id` 가 비어 있다. 표는 찾았지만
          // 맞는 줄이 없는 경우가 있어 `rate_table_id` 로 세면 안 잡힌다 —
          // 그러면 0원짜리 줄이 확정 관문을 그대로 통과한다.
          groupCount(tx, 'settlement_detail', ids, tenant_id, { rate_detail_id: null }),
          groupCount(tx, 'settlement_detail', ids, tenant_id, { is_manual: true }),
          this.closedPeriod(tx, tenant_id, query.settlementType, query.yearMonth),
        ]);

      const items: SettlementListItem[] = rows.map((r) => {
        const invoice = r.tax_invoice_tax_invoice_settlement_idTosettlement[0] ?? null;
        const key = String(r.settlement_id);
        const total = num(r.total_amount) ?? 0;
        const paid = num(r.paid_amount) ?? 0;

        const gate = evaluateSettlementGate({
          status: r.status,
          detailCount: r.detail_count,
          uncalculatedCount: uncalculated.get(key) ?? 0,
          manualCount: manualCounts.get(key) ?? 0,
          pendingChargeCount: pendingCharges.get(key) ?? 0,
          pendingAdjustmentCount: pendingAdjustments.get(key) ?? 0,
          hasDispute: Boolean(r.dispute_reason),
          partnerConfirmed: r.partner_confirmed,
          totalAmount: total,
          paidAmount: paid,
          periodClosed: closed,
          hasInvoice: invoice !== null,
          hasBusinessNo: Boolean(r.partner_business_no),
        });

        const overdueDays =
          ['INVOICED', 'PARTIALLY_PAID'].includes(r.status) &&
          r.payment_due_date &&
          r.payment_due_date < today &&
          total - paid > 0
            ? Math.round((today.getTime() - r.payment_due_date.getTime()) / 86_400_000)
            : null;

        return {
          settlementId: key,
          settlementNo: r.settlement_no,
          settlementType: r.settlement_type,
          status: r.status,
          partnerId: String(r.partner_id),
          partnerName: r.partner_name,
          partnerBusinessNo: r.partner_business_no,
          yearMonth: r.settlement_year_month,
          periodFrom: isoDate(r.period_from),
          periodTo: isoDate(r.period_to),
          issueDate: r.issue_date ? isoDate(r.issue_date) : null,
          paymentDueDate: r.payment_due_date ? isoDate(r.payment_due_date) : null,
          detailCount: r.detail_count,
          baseAmount: num(r.base_amount) ?? 0,
          surchargeAmount: num(r.surcharge_amount) ?? 0,
          adjustmentAmount: num(r.adjustment_amount) ?? 0,
          supplyAmount: num(r.supply_amount) ?? 0,
          taxAmount: num(r.tax_amount) ?? 0,
          totalAmount: total,
          paidAmount: paid,
          unpaidAmount: total - paid,
          marginAmount: null,
          marginRate: null,
          hasInvoice: invoice !== null,
          invoiceStatus: invoice?.status ?? null,
          hasDispute: Boolean(r.dispute_reason),
          overdueDays,
          nextAction: gate.action,
          nextActionLabel: gate.actionLabel,
          blockerCount: gate.blockerCount,
          cautionCount: gate.cautionCount,
          canProceed: gate.canProceed,
          blockedReason: gate.blockedReason,
          confirmedAt: iso(r.confirmed_at),
          approvedAt: iso(r.approved_at),
        };
      });

      const pending = await tx.transport_actual.aggregate({
        where: {
          tenant_id,
          actual_date: { gte: from, lte: to },
          confirm_status: 'CONFIRMED',
          ...(query.settlementType === 'BILLING'
            ? { billing_settled: false }
            : { payment_settled: false }),
        },
        _count: { _all: true },
        _sum: query.settlementType === 'BILLING' ? { billing_amount: true } : { payment_amount: true },
      });

      const filtered = query.overdueOnly ? items.filter((i) => i.overdueDays !== null) : items;
      const sorted = sortItems(filtered, query.sort);

      const summary: SettlementListSummary = {
        count: items.length,
        openCount: items.filter((i) =>
          (SETTLEMENT_OPEN_STATUSES as readonly string[]).includes(i.status),
        ).length,
        totalAmount: sum(items.map((i) => i.totalAmount)),
        paidAmount: sum(items.map((i) => i.paidAmount)),
        unpaidAmount: sum(items.map((i) => i.unpaidAmount)),
        overdueCount: items.filter((i) => i.overdueDays !== null).length,
        overdueAmount: sum(items.filter((i) => i.overdueDays !== null).map((i) => i.unpaidAmount)),
        pendingActualCount: pending._count._all,
        pendingActualAmount:
          num(
            query.settlementType === 'BILLING'
              ? (pending._sum as { billing_amount?: unknown }).billing_amount
              : (pending._sum as { payment_amount?: unknown }).payment_amount,
          ) ?? 0,
        periodClosed: closed,
      };

      const page = sorted.slice((query.page - 1) * query.size, query.page * query.size);
      return { ...toPageResult(page, sorted.length, query.page, query.size), summary };
    });
  }

  // ===================================================================
  // 정산 만들기
  // ===================================================================

  /**
   * 확정된 미정산 실적을 거래처별로 묶어 정산을 만든다.
   *
   * ## 왜 거래처 × 월인가
   *
   * 세금계산서가 그 단위로 나가기 때문이다. 건별로 계산서를 내면 한 화주에게
   * 한 달에 이백 장이 나가고, 국세청 전송비와 상대방 경리의 대사 비용이 그만큼
   * 늘어난다. 실무는 월 단위 합계 계산서 한 장에 명세서를 붙여 보낸다.
   *
   * ## 이미 만든 정산에 덧붙인다
   *
   * 월중에 한 번 돌리고 월말에 또 돌리는 것이 정상 운영이다. 그때마다 새
   * 정산을 만들면 한 화주에게 정산이 세 장 생기고 계산서도 세 장이 된다.
   * 그래서 **확정 전(DRAFT · CALCULATED)** 정산이 있으면 거기에 붙인다.
   * 이미 확정된 정산에는 못 붙인다 — 확정은 되돌릴 수 없는 선이다.
   */
  async generate(principal: AuthPrincipal, dto: SettlementGenerateInput): Promise<BulkResult> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const type = dto.settlementType;
      const [from, to] = monthRange(dto.yearMonth);

      if (await this.closedPeriod(tx, tenant_id, type, dto.yearMonth)) {
        throw AppError.conflict(
          'SETTLEMENT_PERIOD_CLOSED',
          '이 기간은 마감됐습니다. 마감을 풀어야 정산을 만들 수 있습니다.',
        );
      }

      const book = await loadRateBook(tx, tenant_id, type, from, dto.yearMonth);
      const result: BulkResult = { requested: 0, succeeded: 0, failures: [] };

      const groups =
        type === 'BILLING'
          ? await this.billingGroups(tx, tenant_id, from, to, dto.partnerId)
          : await this.paymentGroups(tx, tenant_id, from, to, dto.partnerId);

      result.requested = groups.length;
      if (groups.length === 0) return result;

      const partners = await tx.business_partner.findMany({
        where: { tenant_id, partner_id: { in: groups.map((g) => g.partnerId) } },
        select: {
          partner_id: true,
          partner_name: true,
          business_no: true,
          payment_terms_days: true,
          closing_day: true,
        },
      });
      const partnerById = new Map(partners.map((p) => [String(p.partner_id), p]));

      const contracts = await tx.partner_contract.findMany({
        where: {
          tenant_id,
          partner_id: { in: groups.map((g) => g.partnerId) },
          contract_target: type as never,
          status: 'ACTIVE',
          deleted_at: null,
        },
        select: {
          contract_id: true,
          partner_id: true,
          payment_terms_days: true,
          contract_no: true,
          // 계약서가 어느 표로 정산한다고 적었는지. 이것이 요율 체인의 맨 앞이다.
          rate_table_id: true,
        },
      });
      const contractByPartner = new Map(contracts.map((c) => [String(c.partner_id), c]));

      for (const group of groups) {
        const key = String(group.partnerId);
        const partner = partnerById.get(key);
        if (!partner) {
          result.failures.push({ id: key, label: key, reason: '거래처를 찾을 수 없습니다.' });
          continue;
        }

        try {
          const contract = contractByPartner.get(key) ?? null;
          const terms = contract?.payment_terms_days ?? partner.payment_terms_days ?? 30;

          let header = dto.appendToExisting
            ? await tx.settlement.findFirst({
                where: {
                  tenant_id,
                  settlement_type: type as never,
                  settlement_year_month: dto.yearMonth,
                  partner_id: group.partnerId,
                  status: { in: ['DRAFT', 'CALCULATED'] },
                  deleted_at: null,
                },
                orderBy: { settlement_id: 'asc' },
              })
            : null;

          if (!header) {
            const no = await nextNo(tx, tenant_id);
            header = await tx.settlement.create({
              data: {
                tenant_id,
                settlement_no: no,
                settlement_type: type as never,
                partner_id: group.partnerId,
                partner_name: partner.partner_name,
                partner_business_no: partner.business_no,
                contract_id: contract?.contract_id ?? null,
                settlement_year_month: dto.yearMonth,
                period_from: from,
                period_to: to,
                closing_date: to,
                issue_date: invoiceIssueDate(dto.yearMonth),
                payment_due_date: addDaysUtc(to, terms),
                status: 'DRAFT',
                created_by: principal.userId,
                updated_by: principal.userId,
              },
            });
          }

          const startLine =
            (
              await tx.settlement_detail.aggregate({
                where: { settlement_id: header.settlement_id },
                _max: { line_no: true },
              })
            )._max.line_no ?? 0;

          let lineNo = startLine;
          for (const row of group.rows) {
            lineNo += 1;
            await this.insertDetail(tx, {
              tenantId: tenant_id,
              settlementId: header.settlement_id,
              lineNo,
              type,
              row,
              book,
              partnerId: key,
              contractTableId:
                contract?.rate_table_id === null || contract?.rate_table_id === undefined
                  ? null
                  : String(contract.rate_table_id),
              userId: principal.userId,
            });
          }

          // 실적에 "정산이 물고 갔다" 를 남긴다. 이 표시가 확정 해제를 막는다.
          await this.markSettled(tx, tenant_id, type, group, header.settlement_id, principal.userId);
          await this.recomputeTotals(tx, tenant_id, header.settlement_id, principal.userId);

          result.succeeded += 1;
        } catch (error) {
          result.failures.push({
            id: key,
            label: partner.partner_name,
            reason: reasonOf(error),
          });
        }
      }

      return result;
    });
  }

  /** 매출 — 확정 실적의 오더를 화주별로 모은다 */
  private async billingGroups(
    tx: TxClient,
    tenant_id: bigint,
    from: Date,
    to: Date,
    partnerId: string | null,
  ): Promise<GenerateGroup[]> {
    const orders = await tx.actual_order.findMany({
      where: {
        tenant_id,
        ...(partnerId ? { shipper_id: BigInt(partnerId) } : {}),
        transport_actual: {
          tenant_id,
          actual_date: { gte: from, lte: to },
          confirm_status: 'CONFIRMED',
          billing_settled: false,
        },
      },
      include: {
        transport_actual: true,
        transport_order: {
          select: {
            order_no: true,
            from_zone_id: true,
            to_zone_id: true,
            from_location_name: true,
            to_location_name: true,
          },
        },
      },
      orderBy: [{ shipper_id: 'asc' }, { actual_order_id: 'asc' }],
    });

    const grouped = new Map<string, GenerateGroup>();
    for (const o of orders) {
      const key = String(o.shipper_id);
      const g = grouped.get(key) ?? { partnerId: o.shipper_id, rows: [] };
      g.rows.push({ kind: 'BILLING', order: o, actual: o.transport_actual });
      grouped.set(key, g);
    }
    return [...grouped.values()];
  }

  /** 매입 — 확정 실적을 운송사별로 모은다 */
  private async paymentGroups(
    tx: TxClient,
    tenant_id: bigint,
    from: Date,
    to: Date,
    partnerId: string | null,
  ): Promise<GenerateGroup[]> {
    const actuals = await tx.transport_actual.findMany({
      where: {
        tenant_id,
        actual_date: { gte: from, lte: to },
        confirm_status: 'CONFIRMED',
        payment_settled: false,
        ...(partnerId ? { carrier_id: BigInt(partnerId) } : {}),
      },
      orderBy: [{ carrier_id: 'asc' }, { actual_id: 'asc' }],
    });

    const grouped = new Map<string, GenerateGroup>();
    for (const a of actuals) {
      const key = String(a.carrier_id);
      const g = grouped.get(key) ?? { partnerId: a.carrier_id, rows: [] };
      g.rows.push({ kind: 'PAYMENT', actual: a });
      grouped.set(key, g);
    }
    return [...grouped.values()];
  }

  /** 명세 한 줄을 넣고, 계산기가 만든 부대비도 같이 남긴다 */
  private async insertDetail(
    tx: TxClient,
    args: {
      tenantId: bigint;
      settlementId: bigint;
      lineNo: number;
      type: 'BILLING' | 'PAYMENT';
      row: GenerateRow;
      book: RateBook;
      partnerId: string;
      /** 계약이 지정한 요율표. 없으면 전용표 → 공통표로 떨어진다 */
      contractTableId: string | null;
      userId: bigint;
    },
  ): Promise<void> {
    const { row, book, type } = args;
    const actual = row.actual;
    const calc =
      type === 'BILLING'
        ? runRate(
            billingContext(actual, row.order!, {
              from_zone_id: row.order!.transport_order.from_zone_id,
              to_zone_id: row.order!.transport_order.to_zone_id,
            }),
            book,
            args.partnerId,
            args.contractTableId,
          )
        : runRate(paymentContext(actual), book, args.partnerId, args.contractTableId);

    const ctxDistance =
      type === 'BILLING'
        ? (num(row.order!.distance_km) ?? num(actual.actual_distance_km))
        : num(actual.actual_distance_km);

    const detail = await tx.settlement_detail.create({
      data: {
        tenant_id: args.tenantId,
        settlement_id: args.settlementId,
        line_no: args.lineNo,
        actual_id: actual.actual_id,
        actual_order_id: row.order?.actual_order_id ?? null,
        order_id: row.order?.order_id ?? null,
        dispatch_id: actual.dispatch_id,
        trip_id: actual.trip_id,
        transport_date: actual.actual_date,
        order_no: row.order?.transport_order.order_no ?? null,
        from_location_name:
          row.order?.transport_order.from_location_name ?? actual.from_location_name,
        to_location_name: row.order?.transport_order.to_location_name ?? actual.to_location_name,
        vehicle_no: actual.vehicle_no,
        vehicle_type_name: null,
        driver_name: actual.driver_name,
        item_summary: null,
        distance_km: ctxDistance,
        weight_kg:
          type === 'BILLING' ? num(row.order!.delivered_weight_kg) : num(actual.actual_weight_kg),
        volume_cbm:
          type === 'BILLING' ? num(row.order!.delivered_volume_cbm) : num(actual.actual_volume_cbm),
        qty: type === 'BILLING' ? num(row.order!.delivered_qty) : num(actual.actual_qty),
        pallet_qty:
          type === 'BILLING'
            ? num(row.order!.delivered_pallet_qty)
            : num(actual.actual_pallet_qty),
        stop_count: actual.stop_count,
        waiting_minutes: actual.waiting_minutes,
        rate_table_id: calc.rateTableId === null ? null : BigInt(calc.rateTableId),
        rate_detail_id: calc.rateDetailId === null ? null : BigInt(calc.rateDetailId),
        rate_method: (calc.rateMethod ?? null) as never,
        unit_rate: calc.unitRate,
        base_amount: calc.baseAmount,
        surcharge_amount: calc.surchargeAmount,
        fuel_surcharge_amount: calc.fuelSurchargeAmount,
        discount_amount: calc.discountAmount,
        adjustment_amount: 0,
        supply_amount: calc.supplyAmount,
        tax_amount: calc.taxAmount,
        total_amount: calc.totalAmount,
        is_taxable: calc.isTaxable,
        calculation_detail: calc.detail as never,
        calculation_note: calc.matched ? null : calc.unmatchedReason,
        created_by: args.userId,
        updated_by: args.userId,
      },
    });

    await this.writeAutoCharges(tx, args.tenantId, args.settlementId, detail.settlement_detail_id, calc, args.userId);
  }

  /**
   * 계산기가 만든 부대비를 행으로 남긴다.
   *
   * 금액은 이미 명세 줄의 `supply_amount` 안에 들어 있다. 여기 남기는 것은
   * **근거를 조회할 수 있게** 하려는 것이지 금액을 더하려는 것이 아니다.
   * 그래서 `is_auto_calculated = true` 로 표시하고, 헤더 합계는 이 행들을
   * 세지 않는다(`recomputeTotals` 참고). 두 번 세면 청구서가 부풀고, 그
   * 오차는 부가세까지 번져 계산서 반려로 돌아온다.
   */
  private async writeAutoCharges(
    tx: TxClient,
    tenantId: bigint,
    settlementId: bigint,
    detailId: bigint,
    calc: RateCalculation,
    userId: bigint,
  ): Promise<void> {
    if (calc.charges.length === 0) return;

    const types = await tx.surcharge_type.findMany({
      where: { tenant_id: tenantId, surcharge_code: { in: calc.charges.map((c) => c.chargeCode) } },
      select: { surcharge_type_id: true, surcharge_code: true },
    });
    const typeByCode = new Map(types.map((t) => [t.surcharge_code, t.surcharge_type_id]));

    await tx.settlement_charge.createMany({
      data: calc.charges.map((c) => ({
        tenant_id: tenantId,
        settlement_id: settlementId,
        settlement_detail_id: detailId,
        surcharge_type_id: typeByCode.get(c.chargeCode) ?? null,
        charge_code: c.chargeCode,
        charge_name: c.chargeName,
        charge_method: c.chargeMethod as never,
        base_value: c.baseValue,
        base_unit: c.baseUnit,
        unit_rate: c.unitRate,
        qty: c.qty,
        amount: c.amount,
        is_taxable: c.isTaxable,
        // 자동 산출분은 결재를 따로 받지 않는다. 근거가 실적에 숫자로 남아
        // 있고, 사람이 판단한 것이 아니기 때문이다.
        approval_status: 'APPROVED' as never,
        approved_by: userId,
        approved_at: new Date(),
        is_auto_calculated: true,
        created_by: userId,
        updated_by: userId,
      })),
    });
  }

  /** 실적에 정산 표시를 남긴다 */
  private async markSettled(
    tx: TxClient,
    tenantId: bigint,
    type: 'BILLING' | 'PAYMENT',
    group: GenerateGroup,
    settlementId: bigint,
    userId: bigint,
  ): Promise<void> {
    const actualIds = [...new Set(group.rows.map((r) => r.actual.actual_id))];

    if (type === 'PAYMENT') {
      await tx.transport_actual.updateMany({
        where: { tenant_id: tenantId, actual_id: { in: actualIds } },
        data: { payment_settled: true, payment_settlement_id: settlementId, updated_by: userId },
      });
      return;
    }

    /*
      매출은 한 실적이 여러 화주로 갈릴 수 있다.

      `billing_settlement_id` 는 칸이 하나뿐이라 두 장을 가리킬 수 없다.
      그래서 **모든 오더가 정산에 들어간 실적만** 확정 표시를 하고, 정산
      id 는 그중 하나를 가리키게 둔다. 남은 오더가 있는 실적은 표시를 안
      하므로 다음 「정산 만들기」가 그 오더를 다시 집는다.
    */
    const remaining = await tx.actual_order.findMany({
      where: {
        tenant_id: tenantId,
        actual_id: { in: actualIds },
        settlement_detail: { none: {} },
      },
      select: { actual_id: true },
    });
    const stillOpen = new Set(remaining.map((r) => String(r.actual_id)));
    const done = actualIds.filter((id) => !stillOpen.has(String(id)));

    if (done.length > 0) {
      await tx.transport_actual.updateMany({
        where: { tenant_id: tenantId, actual_id: { in: done } },
        data: { billing_settled: true, billing_settlement_id: settlementId, updated_by: userId },
      });
    }
  }

  // ===================================================================
  // 운임 재산출
  // ===================================================================

  /**
   * 명세의 금액을 다시 만든다.
   *
   * 운임표를 고쳤거나, 실적을 다시 만들었거나, 만들 때 표가 안 걸렸던 줄을
   * 뒤늦게 채운 경우다. **수기로 고친 줄은 기본적으로 지킨다** — 사람이
   * 이유를 적고 넣은 숫자를 배치가 조용히 덮으면, 그 사람은 다음부터 이
   * 화면을 안 쓴다.
   */
  async calculate(
    principal: AuthPrincipal,
    settlementId: string,
    overwriteManual: boolean,
  ): Promise<{ settlementId: string; recalculated: number; unmatched: number }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);

      if (!['DRAFT', 'CALCULATED', 'REVIEWING'].includes(header.status)) {
        throw AppError.conflict(
          'SETTLEMENT_NOT_CALCULABLE',
          '확정된 정산은 다시 산출할 수 없습니다. 금액을 바꾸려면 조정 전표를 넣으세요.',
        );
      }
      if (await this.closedPeriod(tx, tenant_id, header.settlement_type, header.settlement_year_month)) {
        throw AppError.conflict('SETTLEMENT_PERIOD_CLOSED', '이 기간은 마감됐습니다.');
      }

      const book = await loadRateBook(
        tx,
        tenant_id,
        header.settlement_type as 'BILLING' | 'PAYMENT',
        header.period_from,
        header.settlement_year_month,
      );

      const details = await tx.settlement_detail.findMany({
        where: { tenant_id, settlement_id: header.settlement_id },
        include: {
          transport_actual: true,
          actual_order: {
            include: {
              transport_order: { select: { from_zone_id: true, to_zone_id: true } },
            },
          },
        },
        orderBy: { line_no: 'asc' },
      });

      let recalculated = 0;
      let unmatchedCount = 0;
      const partnerId = String(header.partner_id);
      /*
        재산출도 생성과 **같은 표**를 봐야 한다.

        여기서 계약을 안 읽으면 「운임 재산출」 한 번에 금액이 바뀐다 —
        생성은 계약표로, 재산출은 공통표로 계산하기 때문이다. 버튼을 누른
        사람은 자기가 무엇을 바꿨는지 모른다.
      */
      const contract = header.contract_id
        ? await tx.partner_contract.findFirst({
            where: { tenant_id, contract_id: header.contract_id },
            select: { rate_table_id: true },
          })
        : null;
      const contractTableId =
        contract?.rate_table_id === null || contract?.rate_table_id === undefined
          ? null
          : String(contract.rate_table_id);

      for (const d of details) {
        if (d.is_manual && !overwriteManual) continue;
        const actual = d.transport_actual;
        if (!actual) continue;

        const calc =
          header.settlement_type === 'BILLING' && d.actual_order
            ? runRate(
                billingContext(actual, d.actual_order, {
                  from_zone_id: d.actual_order.transport_order?.from_zone_id ?? null,
                  to_zone_id: d.actual_order.transport_order?.to_zone_id ?? null,
                }),
                book,
                partnerId,
                contractTableId,
              )
            : runRate(paymentContext(actual), book, partnerId, contractTableId);

        if (!calc.matched) unmatchedCount += 1;

        await tx.settlement_detail.update({
          where: { settlement_detail_id: d.settlement_detail_id },
          data: {
            rate_table_id: calc.rateTableId === null ? null : BigInt(calc.rateTableId),
            rate_detail_id: calc.rateDetailId === null ? null : BigInt(calc.rateDetailId),
            rate_method: (calc.rateMethod ?? null) as never,
            unit_rate: calc.unitRate,
            base_amount: calc.baseAmount,
            surcharge_amount: calc.surchargeAmount,
            fuel_surcharge_amount: calc.fuelSurchargeAmount,
            discount_amount: calc.discountAmount,
            supply_amount: calc.supplyAmount,
            tax_amount: calc.taxAmount,
            total_amount: calc.totalAmount,
            is_taxable: calc.isTaxable,
            calculation_detail: calc.detail as never,
            calculation_note: calc.matched ? null : calc.unmatchedReason,
            is_manual: overwriteManual ? false : d.is_manual,
            manual_reason: overwriteManual ? null : d.manual_reason,
            updated_by: principal.userId,
          },
        });

        // 자동 부대비는 매번 지우고 다시 만든다. 남겨 두면 대기료가 두 줄이 된다.
        await tx.settlement_charge.deleteMany({
          where: {
            tenant_id,
            settlement_detail_id: d.settlement_detail_id,
            is_auto_calculated: true,
          },
        });
        await this.writeAutoCharges(
          tx,
          tenant_id,
          header.settlement_id,
          d.settlement_detail_id,
          calc,
          principal.userId,
        );

        recalculated += 1;
      }

      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          calculated_at: new Date(),
          status: header.status === 'DRAFT' ? 'CALCULATED' : (header.status as never),
          updated_by: principal.userId,
        },
      });
      await this.recomputeTotals(tx, tenant_id, header.settlement_id, principal.userId);

      return { settlementId, recalculated, unmatched: unmatchedCount };
    });
  }

  // ===================================================================
  // 상태 전이
  // ===================================================================

  /**
   * 확정 · 승인 · 발행 대기.
   *
   * 관문을 서버가 한 번 더 부르는 것은 화면을 믿지 않아서가 아니라, 화면이
   * 판정한 뒤 버튼을 누르기까지 사이에 이의가 접수될 수 있기 때문이다.
   */
  async transition(
    principal: AuthPrincipal,
    settlementId: string,
    dto: SettlementTransitionInput,
  ): Promise<{ settlementId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);

      if (dto.action === 'CANCEL') {
        if (!canTransition(header.status, 'CANCELLED')) {
          throw AppError.conflict(
            'SETTLEMENT_NOT_CANCELLABLE',
            '이 단계에서는 취소할 수 없습니다. 계산서가 나간 정산은 수정 세금계산서로만 되돌립니다.',
          );
        }
        if (!dto.reason) {
          throw AppError.badRequest('SETTLEMENT_REASON_REQUIRED', '취소 사유를 적어주세요.');
        }
        await tx.settlement.update({
          where: { settlement_id: header.settlement_id },
          data: {
            status: 'CANCELLED',
            cancel_reason: dto.reason,
            cancelled_at: new Date(),
            cancelled_by: principal.userId,
            updated_by: principal.userId,
          },
        });
        await this.releaseActuals(tx, tenant_id, header, principal.userId);
        return { settlementId, status: 'CANCELLED' };
      }

      const expected = nextAction(header.status);
      if (expected !== dto.action) {
        throw AppError.conflict(
          'SETTLEMENT_WRONG_ACTION',
          expected === null
            ? '이 정산은 더 진행할 단계가 없습니다.'
            : `지금 할 수 있는 것은 「${SETTLEMENT_ACTION_LABEL[expected]}」 입니다. 화면을 새로 불러오세요.`,
        );
      }

      const gate = await this.gateOf(tx, tenant_id, header);
      if (!gate.canProceed) {
        throw AppError.conflict(
          'SETTLEMENT_GATE_BLOCKED',
          gate.blockedReason ?? '지금은 진행할 수 없습니다.',
        );
      }

      const to = statusAfter(dto.action);
      if (to === null) {
        throw AppError.badRequest(
          'SETTLEMENT_USE_PAYMENT',
          '수납은 수납 기록으로 넣습니다. 금액과 입금일이 필요합니다.',
        );
      }
      if (!canTransition(header.status, to)) {
        throw AppError.conflict('SETTLEMENT_INVALID_TRANSITION', '허용되지 않는 상태 변경입니다.');
      }

      const now = new Date();
      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          status: to as never,
          ...(to === 'CONFIRMED' ? { confirmed_at: now, confirmed_by: principal.userId } : {}),
          ...(to === 'APPROVED' ? { approved_at: now, approved_by: principal.userId } : {}),
          ...(dto.reason ? { remark: dto.reason } : {}),
          updated_by: principal.userId,
        },
      });

      return { settlementId, status: to };
    });
  }

  /** 확정 · 승인을 되돌린다. 사유가 남는다 */
  async reopen(
    principal: AuthPrincipal,
    settlementId: string,
    reason: string,
  ): Promise<{ settlementId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);

      const invoice = await tx.tax_invoice.findFirst({
        where: { tenant_id, settlement_id: header.settlement_id, status: { not: 'CANCELLED' } },
        select: { tax_invoice_id: true },
      });

      const blocked = settlementReopenBlockReason({
        status: header.status,
        hasInvoice: invoice !== null,
        paidAmount: num(header.paid_amount) ?? 0,
        periodClosed: await this.closedPeriod(
          tx,
          tenant_id,
          header.settlement_type,
          header.settlement_year_month,
        ),
      });
      if (blocked) throw AppError.conflict('SETTLEMENT_REOPEN_BLOCKED', blocked);

      // 한 단계만 되돌린다. 승인 → 확정, 확정 → 검수중.
      const to =
        header.status === 'APPROVED'
          ? 'CONFIRMED'
          : header.status === 'CONFIRMED'
            ? 'REVIEWING'
            : 'DRAFT';

      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          status: to as never,
          reject_reason: reason,
          ...(to === 'REVIEWING' ? { confirmed_at: null, confirmed_by: null } : {}),
          ...(to === 'CONFIRMED' ? { approved_at: null, approved_by: null } : {}),
          updated_by: principal.userId,
        },
      });
      return { settlementId, status: to };
    });
  }

  /** 상대처 이의 제기 — 확정을 막는다 */
  async dispute(
    principal: AuthPrincipal,
    settlementId: string,
    reason: string,
  ): Promise<{ settlementId: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: { dispute_reason: reason, partner_confirmed: false, updated_by: principal.userId },
      });
      return { settlementId };
    });
  }

  /** 상대처 확인 — 명세를 봤고 이견이 없다 */
  async partnerConfirm(
    principal: AuthPrincipal,
    settlementId: string,
  ): Promise<{ settlementId: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      await tx.settlement.update({
        where: { settlement_id: header.settlement_id },
        data: {
          partner_confirmed: true,
          partner_confirmed_at: new Date(),
          dispute_reason: null,
          updated_by: principal.userId,
        },
      });
      return { settlementId };
    });
  }

  // ===================================================================
  // 부대비 · 조정
  // ===================================================================

  async addCharge(
    principal: AuthPrincipal,
    settlementId: string,
    dto: SettlementChargeInput,
  ): Promise<{ settlementChargeId: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      if (!['DRAFT', 'CALCULATED', 'REVIEWING'].includes(header.status)) {
        throw AppError.conflict(
          'SETTLEMENT_LOCKED',
          '확정된 정산에는 부대비를 못 붙입니다. 조정 전표를 넣으세요.',
        );
      }

      const type = dto.surchargeTypeId
        ? await tx.surcharge_type.findFirst({
            where: { tenant_id, surcharge_type_id: BigInt(dto.surchargeTypeId) },
            select: { require_approval: true, require_evidence: true },
          })
        : null;

      /*
        증빙이나 승인이 필요한 유형은 DRAFT 로 들어간다.

        바로 승인 상태로 넣으면 통제가 장식이 된다. 승인 전 항목은 헤더
        합계에 안 들어가므로, 결재가 끝나기 전까지 청구 금액이 부풀지 않는다.
      */
      const needsApproval = type?.require_approval || type?.require_evidence;

      const row = await tx.settlement_charge.create({
        data: {
          tenant_id,
          settlement_id: header.settlement_id,
          settlement_detail_id: dto.settlementDetailId ? BigInt(dto.settlementDetailId) : null,
          surcharge_type_id: dto.surchargeTypeId ? BigInt(dto.surchargeTypeId) : null,
          charge_code: dto.chargeCode,
          charge_name: dto.chargeName,
          charge_method: dto.chargeMethod as never,
          base_value: dto.baseValue,
          base_unit: dto.baseUnit,
          unit_rate: dto.unitRate,
          qty: dto.qty,
          amount: dto.amount,
          is_taxable: dto.isTaxable,
          approval_status: (needsApproval ? 'REQUESTED' : 'APPROVED') as never,
          requested_by: principal.userId,
          requested_at: new Date(),
          ...(needsApproval ? {} : { approved_by: principal.userId, approved_at: new Date() }),
          is_auto_calculated: false,
          remark: dto.remark,
          created_by: principal.userId,
          updated_by: principal.userId,
        },
      });

      await this.recomputeTotals(tx, tenant_id, header.settlement_id, principal.userId);
      return { settlementChargeId: String(row.settlement_charge_id) };
    });
  }

  async approveCharge(
    principal: AuthPrincipal,
    settlementId: string,
    chargeId: string,
    approve: boolean,
    reason: string | null,
  ): Promise<{ settlementChargeId: string; approvalStatus: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      const row = await tx.settlement_charge.findFirst({
        where: { tenant_id, settlement_charge_id: BigInt(chargeId), settlement_id: header.settlement_id },
      });
      if (!row) throw AppError.notFound('CHARGE_NOT_FOUND', '부대비를 찾을 수 없습니다.');
      if (!approve && !reason) {
        throw AppError.badRequest('CHARGE_REASON_REQUIRED', '반려 사유를 적어주세요.');
      }

      const status = approve ? 'APPROVED' : 'REJECTED';
      await tx.settlement_charge.update({
        where: { settlement_charge_id: row.settlement_charge_id },
        data: {
          approval_status: status as never,
          approved_by: principal.userId,
          approved_at: new Date(),
          reject_reason: approve ? null : reason,
          updated_by: principal.userId,
        },
      });

      await this.recomputeTotals(tx, tenant_id, header.settlement_id, principal.userId);
      return { settlementChargeId: chargeId, approvalStatus: status };
    });
  }

  async deleteCharge(
    principal: AuthPrincipal,
    settlementId: string,
    chargeId: string,
  ): Promise<{ settlementChargeId: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      const row = await tx.settlement_charge.findFirst({
        where: { tenant_id, settlement_charge_id: BigInt(chargeId), settlement_id: header.settlement_id },
        select: { settlement_charge_id: true, is_auto_calculated: true },
      });
      if (!row) throw AppError.notFound('CHARGE_NOT_FOUND', '부대비를 찾을 수 없습니다.');
      if (row.is_auto_calculated) {
        throw AppError.conflict(
          'CHARGE_AUTO',
          '자동 산출된 부대비는 지울 수 없습니다. 실적의 대기·정차를 고치고 다시 산출하세요.',
        );
      }
      if (!['DRAFT', 'CALCULATED', 'REVIEWING'].includes(header.status)) {
        throw AppError.conflict('SETTLEMENT_LOCKED', '확정된 정산의 부대비는 지울 수 없습니다.');
      }

      await tx.settlement_charge.delete({ where: { settlement_charge_id: row.settlement_charge_id } });
      await this.recomputeTotals(tx, tenant_id, header.settlement_id, principal.userId);
      return { settlementChargeId: chargeId };
    });
  }

  /**
   * 조정 전표.
   *
   * 확정된 정산의 금액을 바꾸는 유일한 길이다. 원본 명세를 고치지 않고 줄을
   * 얹는 이유는, 명세서를 이미 상대방에게 보냈기 때문이다 — 보낸 종이와
   * 우리 원장이 달라지면 대사가 안 맞고, 그 차이는 몇 달 뒤에 드러난다.
   */
  async addAdjustment(
    principal: AuthPrincipal,
    settlementId: string,
    dto: SettlementAdjustmentInput,
  ): Promise<{ settlementAdjustmentId: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      if (['CANCELLED', 'CLOSED'].includes(header.status)) {
        throw AppError.conflict(
          'SETTLEMENT_LOCKED',
          '취소·마감된 정산에는 조정을 넣을 수 없습니다.',
        );
      }

      // 부호는 화면이 아니라 유형이 정한다. 사용자가 음수를 입력하게 하면
      // 언젠가 차감을 양수로 넣어 청구가 두 배가 된다.
      const sign = (['DEDUCT', 'DISCOUNT', 'PENALTY', 'CLAIM'] as string[]).includes(
        dto.adjustmentType,
      )
        ? -1
        : 1;
      const supply = sign * dto.supplyAmount;
      const tax = sign * dto.taxAmount;

      const row = await tx.settlement_adjustment.create({
        data: {
          tenant_id,
          settlement_id: header.settlement_id,
          settlement_detail_id: dto.settlementDetailId ? BigInt(dto.settlementDetailId) : null,
          adjustment_type: dto.adjustmentType as never,
          reason: dto.reason,
          supply_amount: supply,
          tax_amount: tax,
          total_amount: supply + tax,
          exception_id: dto.exceptionId ? BigInt(dto.exceptionId) : null,
          // 조정은 언제나 결재를 거친다. 금액을 바꾸는 일이라 예외를 두지 않는다.
          status: 'REQUESTED',
          requested_by: principal.userId,
          requested_at: new Date(),
          created_by: principal.userId,
          updated_by: principal.userId,
        },
      });

      return { settlementAdjustmentId: String(row.settlement_adjustment_id) };
    });
  }

  async approveAdjustment(
    principal: AuthPrincipal,
    settlementId: string,
    adjustmentId: string,
    approve: boolean,
    reason: string | null,
  ): Promise<{ settlementAdjustmentId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);
      const row = await tx.settlement_adjustment.findFirst({
        where: {
          tenant_id,
          settlement_adjustment_id: BigInt(adjustmentId),
          settlement_id: header.settlement_id,
        },
      });
      if (!row) throw AppError.notFound('ADJUSTMENT_NOT_FOUND', '조정 전표를 찾을 수 없습니다.');
      if (!approve && !reason) {
        throw AppError.badRequest('ADJUSTMENT_REASON_REQUIRED', '반려 사유를 적어주세요.');
      }

      const status = approve ? 'APPROVED' : 'REJECTED';
      await tx.settlement_adjustment.update({
        where: { settlement_adjustment_id: row.settlement_adjustment_id },
        data: {
          status: status as never,
          approved_by: principal.userId,
          approved_at: new Date(),
          applied_at: approve ? new Date() : null,
          reject_reason: approve ? null : reason,
          updated_by: principal.userId,
        },
      });

      await this.recomputeTotals(tx, tenant_id, header.settlement_id, principal.userId);
      return { settlementAdjustmentId: adjustmentId, status };
    });
  }

  // ===================================================================
  // 상세
  // ===================================================================

  async detail(principal: AuthPrincipal, settlementId: string): Promise<SettlementDetailPage> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const header = await this.mustFind(tx, tenant_id, settlementId);

      const [details, charges, adjustments, payments, invoice, contract, surchargeTypes, closed, actors] =
        await Promise.all([
          tx.settlement_detail.findMany({
            where: { tenant_id, settlement_id: header.settlement_id },
            include: { rate_table: { select: { rate_table_name: true } } },
            orderBy: { line_no: 'asc' },
          }),
          tx.settlement_charge.findMany({
            where: { tenant_id, settlement_id: header.settlement_id },
            include: {
              settlement_detail: { select: { line_no: true } },
              surcharge_type: { select: { require_evidence: true } },
            },
            orderBy: { settlement_charge_id: 'asc' },
          }),
          tx.settlement_adjustment.findMany({
            where: { tenant_id, settlement_id: header.settlement_id },
            orderBy: { settlement_adjustment_id: 'asc' },
          }),
          tx.payment_record.findMany({
            where: { tenant_id, settlement_id: header.settlement_id },
            orderBy: { payment_date: 'asc' },
          }),
          tx.tax_invoice.findFirst({
            where: { tenant_id, settlement_id: header.settlement_id },
            orderBy: { tax_invoice_id: 'desc' },
          }),
          header.contract_id
            ? tx.partner_contract.findFirst({
                where: { tenant_id, contract_id: header.contract_id },
                select: { contract_no: true },
              })
            : null,
          tx.surcharge_type.findMany({
            where: {
              tenant_id,
              is_active: true,
              OR: [{ rate_target: null }, { rate_target: header.settlement_type as never }],
            },
            orderBy: { sort_order: 'asc' },
          }),
          this.closedPeriod(tx, tenant_id, header.settlement_type, header.settlement_year_month),
          tx.user_account.findMany({
            where: {
              tenant_id,
              user_id: {
                in: [header.confirmed_by, header.approved_by, header.cancelled_by].filter(
                  (v): v is bigint => v !== null,
                ),
              },
            },
            select: { user_id: true, user_name: true },
          }),
        ]);

      const nameOf = (id: bigint | null) =>
        id === null ? null : (actors.find((a) => a.user_id === id)?.user_name ?? null);

      const detailRows: SettlementDetailRow[] = details.map((d) => ({
        settlementDetailId: String(d.settlement_detail_id),
        lineNo: d.line_no,
        actualId: d.actual_id === null ? null : String(d.actual_id),
        actualNo: null,
        orderId: d.order_id === null ? null : String(d.order_id),
        orderNo: d.order_no,
        transportDate: isoDate(d.transport_date),
        fromLocationName: d.from_location_name,
        toLocationName: d.to_location_name,
        vehicleNo: d.vehicle_no,
        vehicleTypeName: d.vehicle_type_name,
        driverName: d.driver_name,
        itemSummary: d.item_summary,
        distanceKm: num(d.distance_km),
        weightKg: num(d.weight_kg),
        stopCount: d.stop_count,
        waitingMinutes: d.waiting_minutes,
        rateTableId: d.rate_table_id === null ? null : String(d.rate_table_id),
        rateTableName: d.rate_table?.rate_table_name ?? null,
        rateMethod: d.rate_method,
        unitRate: num(d.unit_rate),
        baseAmount: num(d.base_amount) ?? 0,
        surchargeAmount: num(d.surcharge_amount) ?? 0,
        fuelSurchargeAmount: num(d.fuel_surcharge_amount) ?? 0,
        discountAmount: num(d.discount_amount) ?? 0,
        adjustmentAmount: num(d.adjustment_amount) ?? 0,
        supplyAmount: num(d.supply_amount) ?? 0,
        taxAmount: num(d.tax_amount) ?? 0,
        totalAmount: num(d.total_amount) ?? 0,
        isManual: d.is_manual,
        manualReason: d.manual_reason,
        calculationNote: d.calculation_note,
        steps: stepsOf(d.calculation_detail),
      }));

      const chargeRows: SettlementChargeRow[] = charges.map((c) => ({
        settlementChargeId: String(c.settlement_charge_id),
        settlementDetailId: c.settlement_detail_id === null ? null : String(c.settlement_detail_id),
        lineNo: c.settlement_detail?.line_no ?? null,
        chargeCode: c.charge_code,
        chargeName: c.charge_name,
        chargeMethod: c.charge_method,
        baseValue: num(c.base_value),
        baseUnit: c.base_unit,
        unitRate: num(c.unit_rate),
        qty: num(c.qty) ?? 1,
        amount: num(c.amount) ?? 0,
        isTaxable: c.is_taxable,
        approvalStatus: c.approval_status,
        isAutoCalculated: c.is_auto_calculated,
        requireEvidence: c.surcharge_type?.require_evidence ?? false,
        hasEvidence: c.evidence_file_id !== null,
        exceptionId: c.exception_id === null ? null : String(c.exception_id),
        remark: c.remark,
      }));

      const adjustmentRows: SettlementAdjustmentRow[] = adjustments.map((a) => ({
        settlementAdjustmentId: String(a.settlement_adjustment_id),
        adjustmentNo: a.adjustment_no,
        adjustmentType: a.adjustment_type,
        reason: a.reason,
        supplyAmount: num(a.supply_amount) ?? 0,
        taxAmount: num(a.tax_amount) ?? 0,
        totalAmount: num(a.total_amount) ?? 0,
        status: a.status,
        exceptionId: a.exception_id === null ? null : String(a.exception_id),
        requestedAt: iso(a.requested_at),
        approvedAt: iso(a.approved_at),
        appliedAt: iso(a.applied_at),
      }));

      const paymentRows: SettlementPaymentRow[] = payments.map((p) => ({
        paymentRecordId: String(p.payment_record_id),
        paymentDirection: p.payment_direction,
        paymentMethod: p.payment_method,
        paymentDate: isoDate(p.payment_date),
        paymentAmount: num(p.payment_amount) ?? 0,
        bankName: p.bank_name,
        accountNo: p.account_no,
        depositorName: p.depositor_name,
        transactionNo: p.transaction_no,
        isMatched: p.is_matched,
        remark: p.remark,
      }));

      const gate = evaluateSettlementGate({
        status: header.status,
        detailCount: details.length,
        uncalculatedCount: details.filter((d) => d.rate_detail_id === null).length,
        manualCount: details.filter((d) => d.is_manual).length,
        pendingChargeCount: charges.filter(
          (c) => !c.is_auto_calculated && ['DRAFT', 'REQUESTED'].includes(c.approval_status),
        ).length,
        pendingAdjustmentCount: adjustments.filter((a) =>
          ['DRAFT', 'REQUESTED'].includes(a.status),
        ).length,
        hasDispute: Boolean(header.dispute_reason),
        partnerConfirmed: header.partner_confirmed,
        totalAmount: num(header.total_amount) ?? 0,
        paidAmount: num(header.paid_amount) ?? 0,
        periodClosed: closed,
        hasInvoice: invoice !== null && invoice.status !== 'CANCELLED',
        hasBusinessNo: Boolean(header.partner_business_no),
      });

      const history: SettlementHistoryEntry[] = [
        {
          at: iso(header.created_at)!,
          label: '정산 생성',
          detail: `확정 실적 ${header.detail_count}건을 묶었습니다`,
          actor: null,
        },
      ];
      if (header.calculated_at) {
        history.push({
          at: iso(header.calculated_at)!,
          label: '운임 산출',
          detail: null,
          actor: null,
        });
      }
      if (header.confirmed_at) {
        history.push({
          at: iso(header.confirmed_at)!,
          label: '확정',
          detail: '금액은 조정 전표로만 바뀝니다',
          actor: nameOf(header.confirmed_by),
        });
      }
      if (header.approved_at) {
        history.push({ at: iso(header.approved_at)!, label: '승인', detail: null, actor: nameOf(header.approved_by) });
      }
      if (invoice) {
        history.push({
          at: iso(invoice.created_at)!,
          label: '세금계산서 발행',
          detail: invoice.invoice_no,
          actor: null,
        });
      }
      for (const p of payments) {
        history.push({
          at: iso(p.created_at)!,
          label: header.settlement_type === 'BILLING' ? '수금' : '지급',
          detail: `${(num(p.payment_amount) ?? 0).toLocaleString('ko-KR')}원`,
          actor: p.depositor_name,
        });
      }
      if (header.cancelled_at) {
        history.push({
          at: iso(header.cancelled_at)!,
          label: '취소',
          detail: header.cancel_reason,
          actor: nameOf(header.cancelled_by),
        });
      }
      history.sort((a, b) => a.at.localeCompare(b.at));

      const total = num(header.total_amount) ?? 0;
      const paid = num(header.paid_amount) ?? 0;

      return {
        settlementId: String(header.settlement_id),
        settlementNo: header.settlement_no,
        settlementType: header.settlement_type,
        status: header.status,
        partnerId: String(header.partner_id),
        partnerName: header.partner_name,
        partnerBusinessNo: header.partner_business_no,
        contractNo: contract?.contract_no ?? null,
        yearMonth: header.settlement_year_month,
        periodFrom: isoDate(header.period_from),
        periodTo: isoDate(header.period_to),
        closingDate: header.closing_date ? isoDate(header.closing_date) : null,
        issueDate: header.issue_date ? isoDate(header.issue_date) : null,
        paymentDueDate: header.payment_due_date ? isoDate(header.payment_due_date) : null,
        detailCount: header.detail_count,
        baseAmount: num(header.base_amount) ?? 0,
        surchargeAmount: num(header.surcharge_amount) ?? 0,
        fuelSurchargeAmount: num(header.fuel_surcharge_amount) ?? 0,
        discountAmount: num(header.discount_amount) ?? 0,
        adjustmentAmount: num(header.adjustment_amount) ?? 0,
        supplyAmount: num(header.supply_amount) ?? 0,
        taxAmount: num(header.tax_amount) ?? 0,
        totalAmount: total,
        paidAmount: paid,
        unpaidAmount: total - paid,
        partnerConfirmed: header.partner_confirmed,
        disputeReason: header.dispute_reason,
        remark: header.remark,
        calculatedAt: iso(header.calculated_at),
        confirmedAt: iso(header.confirmed_at),
        approvedAt: iso(header.approved_at),
        gate,
        reopenBlockedReason: settlementReopenBlockReason({
          status: header.status,
          hasInvoice: invoice !== null && invoice.status !== 'CANCELLED',
          paidAmount: paid,
          periodClosed: closed,
        }),
        periodClosed: closed,
        details: detailRows,
        charges: chargeRows,
        adjustments: adjustmentRows,
        payments: paymentRows,
        invoice: invoice ? invoiceRowOf(invoice, header) : null,
        history,
        surchargeTypes: surchargeTypes.map(
          (s): SurchargeTypeOption => ({
            surchargeTypeId: String(s.surcharge_type_id),
            surchargeCode: s.surcharge_code,
            surchargeName: s.surcharge_name,
            chargeMethod: s.charge_method,
            defaultAmount: num(s.default_amount),
            defaultUnitRate: num(s.default_unit_rate),
            defaultRatePct: num(s.default_rate_pct),
            isTaxable: s.is_taxable,
            requireEvidence: s.require_evidence,
            requireApproval: s.require_approval,
          }),
        ),
      };
    });
  }

  // ===================================================================
  // 공용
  // ===================================================================

  /**
   * 헤더 금액을 다시 만든다.
   *
   * **이 함수가 헤더 금액을 만드는 유일한 곳이다.** 명세 · 부대비 · 조정
   * 어디를 건드려도 마지막에 이것을 부른다.
   *
   * 자동 산출된 부대비는 이미 명세 줄의 공급가에 들어 있으므로 다시 세지
   * 않는다. 승인 안 난 부대비와 조정도 세지 않는다 — 결재 전 금액이 청구서에
   * 미리 실리면 결재가 반려됐을 때 되돌릴 방법이 없다.
   *
   * 공급가를 먼저 세우고 부가세를 그 위에서 만든다. `ck_settlement_amount`
   * 가 `total = supply + tax` 를 강제하므로 합계에서 역산하면 1원이 어긋나
   * UPDATE 자체가 죽는다.
   */
  async recomputeTotals(
    tx: TxClient,
    tenantId: bigint,
    settlementId: bigint,
    userId: bigint,
  ): Promise<void> {
    const [details, charges, adjustments, paid] = await Promise.all([
      tx.settlement_detail.findMany({
        where: { tenant_id: tenantId, settlement_id: settlementId },
        select: {
          base_amount: true,
          surcharge_amount: true,
          fuel_surcharge_amount: true,
          discount_amount: true,
          supply_amount: true,
          tax_amount: true,
        },
      }),
      tx.settlement_charge.findMany({
        where: {
          tenant_id: tenantId,
          settlement_id: settlementId,
          is_auto_calculated: false,
          approval_status: 'APPROVED',
        },
        select: { amount: true, is_taxable: true },
      }),
      tx.settlement_adjustment.findMany({
        where: { tenant_id: tenantId, settlement_id: settlementId, status: 'APPROVED' },
        select: { supply_amount: true, tax_amount: true },
      }),
      tx.payment_record.aggregate({
        where: { tenant_id: tenantId, settlement_id: settlementId },
        _sum: { payment_amount: true },
        _max: { created_at: true },
      }),
    ]);

    const detailSupply = sum(details.map((d) => num(d.supply_amount) ?? 0));
    const detailTax = sum(details.map((d) => num(d.tax_amount) ?? 0));

    const manualCharge = sum(charges.map((c) => num(c.amount) ?? 0));
    const manualChargeTax = sum(
      charges.map((c) => (c.is_taxable ? Math.round((num(c.amount) ?? 0) * VAT_RATE) : 0)),
    );

    const adjustmentSupply = sum(adjustments.map((a) => num(a.supply_amount) ?? 0));
    const adjustmentTax = sum(adjustments.map((a) => num(a.tax_amount) ?? 0));

    const supply = Math.round(detailSupply + manualCharge + adjustmentSupply);
    const tax = Math.round(detailTax + manualChargeTax + adjustmentTax);
    const total = supply + tax;
    const paidAmount = num(paid._sum.payment_amount) ?? 0;

    await tx.settlement.update({
      where: { settlement_id: settlementId },
      data: {
        detail_count: details.length,
        base_amount: sum(details.map((d) => num(d.base_amount) ?? 0)),
        surcharge_amount: sum(details.map((d) => num(d.surcharge_amount) ?? 0)) + manualCharge,
        fuel_surcharge_amount: sum(details.map((d) => num(d.fuel_surcharge_amount) ?? 0)),
        discount_amount: sum(details.map((d) => num(d.discount_amount) ?? 0)),
        adjustment_amount: adjustmentSupply + adjustmentTax,
        supply_amount: supply,
        tax_amount: tax,
        total_amount: total,
        paid_amount: paidAmount,
        unpaid_amount: total - paidAmount,
        updated_by: userId,
      },
    });
  }

  /** 취소된 정산이 물고 있던 실적을 놓아 준다 */
  private async releaseActuals(
    tx: TxClient,
    tenantId: bigint,
    header: { settlement_id: bigint; settlement_type: string },
    userId: bigint,
  ): Promise<void> {
    const where =
      header.settlement_type === 'BILLING'
        ? { tenant_id: tenantId, billing_settlement_id: header.settlement_id }
        : { tenant_id: tenantId, payment_settlement_id: header.settlement_id };

    await tx.transport_actual.updateMany({
      where,
      data:
        header.settlement_type === 'BILLING'
          ? { billing_settled: false, billing_settlement_id: null, updated_by: userId }
          : { payment_settled: false, payment_settlement_id: null, updated_by: userId },
    });
    // 명세는 지운다. 남겨 두면 다음 「정산 만들기」가 그 오더를 다시 못 집는다.
    await tx.settlement_detail.deleteMany({
      where: { tenant_id: tenantId, settlement_id: header.settlement_id },
    });
  }

  private async gateOf(tx: TxClient, tenantId: bigint, header: SettlementHeader) {
    const [details, charges, adjustments, invoice, closed] = await Promise.all([
      tx.settlement_detail.findMany({
        where: { tenant_id: tenantId, settlement_id: header.settlement_id },
        select: { rate_detail_id: true, is_manual: true },
      }),
      tx.settlement_charge.count({
        where: {
          tenant_id: tenantId,
          settlement_id: header.settlement_id,
          is_auto_calculated: false,
          approval_status: { in: ['DRAFT', 'REQUESTED'] },
        },
      }),
      tx.settlement_adjustment.count({
        where: {
          tenant_id: tenantId,
          settlement_id: header.settlement_id,
          status: { in: ['DRAFT', 'REQUESTED'] },
        },
      }),
      tx.tax_invoice.findFirst({
        where: { tenant_id: tenantId, settlement_id: header.settlement_id, status: { not: 'CANCELLED' } },
        select: { tax_invoice_id: true },
      }),
      this.closedPeriod(tx, tenantId, header.settlement_type, header.settlement_year_month),
    ]);

    return evaluateSettlementGate({
      status: header.status,
      detailCount: details.length,
      uncalculatedCount: details.filter((d) => d.rate_detail_id === null).length,
      manualCount: details.filter((d) => d.is_manual).length,
      pendingChargeCount: charges,
      pendingAdjustmentCount: adjustments,
      hasDispute: Boolean(header.dispute_reason),
      partnerConfirmed: header.partner_confirmed,
      totalAmount: num(header.total_amount) ?? 0,
      paidAmount: num(header.paid_amount) ?? 0,
      periodClosed: closed,
      hasInvoice: invoice !== null,
      hasBusinessNo: Boolean(header.partner_business_no),
    });
  }

  async mustFind(tx: TxClient, tenantId: bigint, settlementId: string): Promise<SettlementHeader> {
    let id: bigint;
    try {
      id = BigInt(settlementId);
    } catch {
      throw AppError.notFound('SETTLEMENT_NOT_FOUND', '정산을 찾을 수 없습니다.');
    }
    const row = await tx.settlement.findFirst({
      where: { tenant_id: tenantId, settlement_id: id, deleted_at: null },
    });
    if (!row) throw AppError.notFound('SETTLEMENT_NOT_FOUND', '정산을 찾을 수 없습니다.');
    return row as SettlementHeader;
  }

  /**
   * 이 달이 마감됐는가.
   *
   * 거래처별 마감(`partner_id`)과 전체 마감(NULL)이 둘 다 가능한 스키마지만,
   * 화면은 전체 마감만 쓴다. 거래처별로 마감을 열어 두면 "8월이 닫혔나" 라는
   * 질문에 스무 개의 답이 생긴다.
   */
  async closedPeriod(
    tx: TxClient,
    tenantId: bigint,
    type: string,
    yearMonth: string,
  ): Promise<boolean> {
    const row = await tx.settlement_close.findFirst({
      where: {
        tenant_id: tenantId,
        settlement_type: type as never,
        close_year_month: yearMonth,
        status: 'CLOSED',
      },
      select: { settlement_close_id: true },
    });
    return row !== null;
  }
}

// ---------------------------------------------------------------------

type SettlementHeader = {
  settlement_id: bigint;
  settlement_no: string;
  settlement_type: string;
  status: string;
  partner_id: bigint;
  partner_name: string;
  partner_business_no: string | null;
  contract_id: bigint | null;
  settlement_year_month: string;
  period_from: Date;
  period_to: Date;
  closing_date: Date | null;
  issue_date: Date | null;
  payment_due_date: Date | null;
  detail_count: number;
  base_amount: unknown;
  surcharge_amount: unknown;
  fuel_surcharge_amount: unknown;
  discount_amount: unknown;
  adjustment_amount: unknown;
  supply_amount: unknown;
  tax_amount: unknown;
  total_amount: unknown;
  paid_amount: unknown;
  partner_confirmed: boolean;
  dispute_reason: string | null;
  remark: string | null;
  calculated_at: Date | null;
  confirmed_at: Date | null;
  confirmed_by: bigint | null;
  approved_at: Date | null;
  approved_by: bigint | null;
  cancelled_at: Date | null;
  cancelled_by: bigint | null;
  cancel_reason: string | null;
  created_at: Date;
};

interface GenerateGroup {
  partnerId: bigint;
  rows: GenerateRow[];
}

interface GenerateRow {
  kind: 'BILLING' | 'PAYMENT';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actual: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order?: any;
}

/** 정산번호는 DB 가 채번한다. 앱에서 만들면 동시 요청에 같은 번호가 나온다 */
async function nextNo(tx: TxClient, tenantId: bigint): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ no: string }>>`
    SELECT ntms.fn_next_no(${tenantId}::BIGINT, 'SETTLEMENT'::VARCHAR) AS no
  `;
  const no = rows[0]?.no;
  if (!no) throw AppError.badRequest('NUMBERING_FAILED', '정산번호를 만들지 못했습니다.');
  return no;
}

/** 여러 정산의 하위 행 수를 한 번에 센다 */
async function groupCount(
  tx: TxClient,
  table: 'settlement_charge' | 'settlement_adjustment' | 'settlement_detail',
  ids: bigint[],
  tenantId: bigint,
  extra: Record<string, unknown>,
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = tx[table] as any;
  const rows = await client.groupBy({
    by: ['settlement_id'],
    where: { tenant_id: tenantId, settlement_id: { in: ids }, ...extra },
    _count: { _all: true },
  });
  return new Map(
    (rows as Array<{ settlement_id: bigint; _count: { _all: number } }>).map((r) => [
      String(r.settlement_id),
      r._count._all,
    ]),
  );
}

/** calculation_detail 에서 산출 계단만 꺼낸다 */
function stepsOf(detail: unknown): RateStep[] {
  if (!detail || typeof detail !== 'object') return [];
  const steps = (detail as { steps?: unknown }).steps;
  return Array.isArray(steps) ? (steps as RateStep[]) : [];
}

function sortItems(items: SettlementListItem[], sort: string): SettlementListItem[] {
  const [key, dir] = sort.split(':');
  const sign = dir === 'asc' ? 1 : -1;

  const value = (i: SettlementListItem): number => {
    switch (key) {
      case 'amount':
        return i.totalAmount;
      case 'unpaid':
        return i.unpaidAmount;
      case 'overdue':
        return i.overdueDays ?? -1;
      case 'partner':
        return 0;
      default:
        return Number(i.settlementId);
    }
  };

  return [...items].sort((a, b) => {
    if (key === 'partner') {
      const d = a.partnerName.localeCompare(b.partnerName, 'ko') * sign;
      if (d !== 0) return d;
    }
    const d = (value(a) - value(b)) * sign;
    return d !== 0 ? d : Number(b.settlementId) - Number(a.settlementId);
  });
}

function reasonOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('마감된 정산 기간')) {
    return '마감된 정산 기간입니다. 마감을 풀어야 정산을 만들 수 있습니다.';
  }
  if (message.includes('ck_settlement_amount')) {
    return '금액 합계가 맞지 않습니다. 운임을 다시 산출해 주세요.';
  }
  return '정산을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

