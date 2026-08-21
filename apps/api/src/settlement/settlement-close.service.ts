import { Injectable } from '@nestjs/common';
import type { TxClient } from '@ntms/db';
import {
  evaluateCloseGate,
  type SettlementCloseBoard,
  type SettlementCloseInput,
  type SettlementCloseRow,
} from '@ntms/shared';
import { AppError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { iso, isoDate, monthRange, num, startOfToday, sum } from './settlement-util.js';

/**
 * 기간 마감.
 *
 * ## 마감은 선언이 아니라 잠금이다
 *
 * `settlement_close` 가 CLOSED 가 되는 순간 DB 트리거
 * (`trg_actual_close_guard`)가 그 기간의 **실적 변경을 42501 로 막는다.**
 * 앱이 마음을 바꿔도 안 된다. 그래서 마감 버튼은 이 시스템에서 가장 되돌리기
 * 어려운 동작이고, 관문도 가장 깐깐하다.
 *
 * ## 왜 오래된 달부터 닫는가
 *
 * 8월을 열어 둔 채 9월을 닫으면, 9월 마감 뒤에 8월 실적이 바뀌어 8월 정산
 * 금액이 달라진다. 그 차이는 이미 닫힌 9월로는 못 넘어가고 어느 달에도
 * 속하지 않는 금액이 된다. 화면이 가장 오래된 열린 달을 먼저 가리키는 이유다.
 *
 * ## 마감 해제는 감사 대상이다
 *
 * 사유가 필수이고 `reopened_at` · `reopened_by` 가 남는다. 결산이 끝난 달을
 * 다시 여는 것은 회계 쪽에 보고해야 하는 일이다.
 */
@Injectable()
export class SettlementCloseService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(p: AuthPrincipal, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.prisma.run({ tenantId: p.tenantId, userId: p.userId }, fn);
  }

  // ===================================================================
  // 마감판
  // ===================================================================

  async board(
    principal: AuthPrincipal,
    settlementType: 'BILLING' | 'PAYMENT',
    year: number,
  ): Promise<SettlementCloseBoard> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const today = startOfToday();
      const thisMonth = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

      const months = Array.from(
        { length: 12 },
        (_, i) => `${year}${String(i + 1).padStart(2, '0')}`,
      );
      const [yearFrom] = monthRange(months[0]!);
      const [, yearTo] = monthRange(months[11]!);

      const [closes, actuals, settlements, closers] = await Promise.all([
        tx.settlement_close.findMany({
          where: { tenant_id, settlement_type: settlementType as never, close_year_month: { in: months } },
        }),
        /*
          한 해치를 한 번에 읽는다.

          달마다 따로 세면 열두 번의 왕복이고, 각 달의 관문 재료가 넷이라
          마흔여덟 번이 된다. 한 테넌트의 한 해 실적은 수천 행이므로 한 번에
          읽어 메모리에서 접는 편이 훨씬 빠르다.
        */
        tx.transport_actual.findMany({
          where: { tenant_id, actual_date: { gte: yearFrom, lte: yearTo } },
          select: {
            actual_date: true,
            confirm_status: true,
            billing_settled: true,
            payment_settled: true,
            billing_amount: true,
            payment_amount: true,
          },
        }),
        tx.settlement.findMany({
          where: {
            tenant_id,
            settlement_type: settlementType as never,
            settlement_year_month: { in: months },
            deleted_at: null,
            status: { not: 'CANCELLED' },
          },
          select: {
            settlement_year_month: true,
            status: true,
            total_amount: true,
            paid_amount: true,
            dispute_reason: true,
            tax_invoice_id: true,
          },
        }),
        tx.user_account.findMany({
          where: { tenant_id },
          select: { user_id: true, user_name: true },
        }),
      ]);

      const nameOf = (id: bigint | null) =>
        id === null ? null : (closers.find((c) => c.user_id === id)?.user_name ?? null);

      const rows: SettlementCloseRow[] = months.map((ym) => {
        const [from, to] = monthRange(ym);
        const close = closes.find((c) => c.close_year_month === ym) ?? null;

        const monthActuals = actuals.filter((a) => a.actual_date >= from && a.actual_date <= to);
        const settled = (a: (typeof actuals)[number]) =>
          settlementType === 'BILLING' ? a.billing_settled : a.payment_settled;
        const estimate = (a: (typeof actuals)[number]) =>
          num(settlementType === 'BILLING' ? a.billing_amount : a.payment_amount) ?? 0;

        const unconfirmed = monthActuals.filter((a) => a.confirm_status !== 'CONFIRMED' && a.confirm_status !== 'CLOSED');
        const unsettled = monthActuals.filter((a) => a.confirm_status === 'CONFIRMED' && !settled(a));

        const monthSettlements = settlements.filter((s) => s.settlement_year_month === ym);
        const unpaid = monthSettlements.filter(
          (s) =>
            ['INVOICED', 'PARTIALLY_PAID'].includes(s.status) &&
            (num(s.total_amount) ?? 0) - (num(s.paid_amount) ?? 0) > 0,
        );

        const gate = evaluateCloseGate({
          yearMonth: ym,
          unconfirmedActualCount: unconfirmed.length,
          unsettledActualCount: unsettled.length,
          unsettledAmount: sum(unsettled.map(estimate)),
          openSettlementCount: monthSettlements.filter((s) =>
            ['DRAFT', 'CALCULATED', 'REVIEWING', 'CONFIRMED'].includes(s.status),
          ).length,
          disputeCount: monthSettlements.filter((s) => Boolean(s.dispute_reason)).length,
          uninvoicedCount: monthSettlements.filter(
            (s) => s.status === 'APPROVED' && s.tax_invoice_id === null,
          ).length,
          unpaidAmount: sum(
            unpaid.map((s) => (num(s.total_amount) ?? 0) - (num(s.paid_amount) ?? 0)),
          ),
          unpaidCount: unpaid.length,
          alreadyClosed: close?.status === 'CLOSED',
          future: ym > thisMonth,
        });

        return {
          settlementCloseId: close === null ? null : String(close.settlement_close_id),
          settlementType,
          yearMonth: ym,
          periodFrom: isoDate(from),
          periodTo: isoDate(to),
          status: close?.status ?? 'OPEN',
          hasActivity: monthActuals.length > 0 || monthSettlements.length > 0,
          totalCount: close ? close.total_count : monthSettlements.length,
          totalAmount: close
            ? (num(close.total_amount) ?? 0)
            : sum(monthSettlements.map((s) => num(s.total_amount) ?? 0)),
          closedAt: iso(close?.closed_at ?? null),
          closedByName: nameOf(close?.closed_by ?? null),
          reopenedAt: iso(close?.reopened_at ?? null),
          reopenReason: close?.reopen_reason ?? null,
          gate,
        };
      });

      // 내역이 있는 달만 가리킨다. 빈 달을 가리키면 담당자가 아무것도 없는
      // 달을 열어 보고 "왜 여기부터냐" 를 묻게 된다.
      const oldestOpen =
        rows.find((r) => r.status !== 'CLOSED' && r.hasActivity && r.yearMonth <= thisMonth)
          ?.yearMonth ?? null;

      return { year, months: rows, oldestOpen };
    });
  }

  // ===================================================================
  // 마감 · 해제
  // ===================================================================

  async close(
    principal: AuthPrincipal,
    dto: SettlementCloseInput,
  ): Promise<{ settlementCloseId: string; yearMonth: string; totalCount: number; totalAmount: number }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const [from, to] = monthRange(dto.yearMonth);

      const board = await this.board(principal, dto.settlementType, Number(dto.yearMonth.slice(0, 4)));
      const row = board.months.find((m) => m.yearMonth === dto.yearMonth);
      if (!row) throw AppError.notFound('CLOSE_MONTH_NOT_FOUND', '그 달을 찾을 수 없습니다.');
      if (!row.gate.canClose) {
        throw AppError.conflict(
          'CLOSE_GATE_BLOCKED',
          row.gate.blockedReason ?? '지금은 마감할 수 없습니다.',
        );
      }

      /*
        오래된 달부터 닫는다.

        앞 달이 열려 있는데 뒤 달을 닫으면, 나중에 앞 달 실적이 바뀌었을 때
        그 차이가 갈 곳이 없어진다.
      */
      const olderOpen = board.months.find(
        (m) => m.yearMonth < dto.yearMonth && m.status !== 'CLOSED' && m.hasActivity,
      );
      if (olderOpen) {
        throw AppError.conflict(
          'CLOSE_ORDER',
          `${Number(olderOpen.yearMonth.slice(4))}월이 아직 열려 있습니다. 오래된 달부터 닫아야 합니다.`,
        );
      }

      const settlements = await tx.settlement.findMany({
        where: {
          tenant_id,
          settlement_type: dto.settlementType as never,
          settlement_year_month: dto.yearMonth,
          deleted_at: null,
          status: { not: 'CANCELLED' },
        },
        select: { settlement_id: true, total_amount: true, status: true },
      });

      const existing = await tx.settlement_close.findFirst({
        where: {
          tenant_id,
          settlement_type: dto.settlementType as never,
          close_year_month: dto.yearMonth,
          partner_id: null,
        },
      });

      const data = {
        status: 'CLOSED' as never,
        total_count: settlements.length,
        total_amount: sum(settlements.map((s) => num(s.total_amount) ?? 0)),
        closed_at: new Date(),
        closed_by: principal.userId,
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
        remark: dto.remark,
        updated_by: principal.userId,
      };

      const close = existing
        ? await tx.settlement_close.update({
            where: { settlement_close_id: existing.settlement_close_id },
            data,
          })
        : await tx.settlement_close.create({
            data: {
              tenant_id,
              settlement_type: dto.settlementType as never,
              close_year_month: dto.yearMonth,
              partner_id: null,
              period_from: from,
              period_to: to,
              created_by: principal.userId,
              ...data,
            },
          });

      /*
        완납된 정산만 CLOSED 로 옮긴다.

        미수가 남은 정산까지 CLOSED 로 만들면 수금 대상 목록에서 사라지고,
        그 돈은 아무도 안 쫓게 된다. 마감은 **기간을 잠그는 것**이지 미수를
        없애는 것이 아니다.
      */
      await tx.settlement.updateMany({
        where: {
          tenant_id,
          settlement_id: { in: settlements.filter((s) => s.status === 'PAID').map((s) => s.settlement_id) },
        },
        data: {
          status: 'CLOSED',
          settlement_close_id: close.settlement_close_id,
          updated_by: principal.userId,
        },
      });

      return {
        settlementCloseId: String(close.settlement_close_id),
        yearMonth: dto.yearMonth,
        totalCount: data.total_count,
        totalAmount: data.total_amount,
      };
    });
  }

  async reopen(
    principal: AuthPrincipal,
    closeId: string,
    reason: string,
  ): Promise<{ settlementCloseId: string; status: string }> {
    return this.run(principal, async (tx) => {
      const tenant_id = principal.tenantId;
      const row = await tx.settlement_close.findFirst({
        where: { tenant_id, settlement_close_id: BigInt(closeId) },
      });
      if (!row) throw AppError.notFound('CLOSE_NOT_FOUND', '마감을 찾을 수 없습니다.');
      if (row.status !== 'CLOSED') {
        throw AppError.conflict('CLOSE_NOT_CLOSED', '마감된 기간이 아닙니다.');
      }

      /*
        뒤 달이 닫혀 있으면 이 달을 못 연다.

        8월을 열어 실적을 고치면 8월 정산 금액이 달라지는데, 9월이 이미
        닫혀 있으면 그 차이를 넘길 달이 없다. 최근 달부터 거꾸로 연다.
      */
      const laterClosed = await tx.settlement_close.findFirst({
        where: {
          tenant_id,
          settlement_type: row.settlement_type,
          close_year_month: { gt: row.close_year_month },
          status: 'CLOSED',
        },
        select: { close_year_month: true },
        orderBy: { close_year_month: 'asc' },
      });
      if (laterClosed) {
        throw AppError.conflict(
          'CLOSE_REOPEN_ORDER',
          `${Number(laterClosed.close_year_month.slice(4))}월이 마감돼 있습니다. 최근 달부터 거꾸로 풀어야 합니다.`,
        );
      }

      await tx.settlement_close.update({
        where: { settlement_close_id: row.settlement_close_id },
        data: {
          status: 'REOPENED',
          reopened_at: new Date(),
          reopened_by: principal.userId,
          reopen_reason: reason,
          updated_by: principal.userId,
        },
      });

      // 마감으로 닫혔던 정산을 완납 상태로 되돌린다
      await tx.settlement.updateMany({
        where: { tenant_id, settlement_close_id: row.settlement_close_id, status: 'CLOSED' },
        data: { status: 'PAID', settlement_close_id: null, updated_by: principal.userId },
      });

      return { settlementCloseId: closeId, status: 'REOPENED' };
    });
  }
}
