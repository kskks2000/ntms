import { invoiceDeadline, type SettlementInvoiceRow } from '@ntms/shared';

/**
 * 정산 모듈이 함께 쓰는 자잘한 것들.
 *
 * 서비스 셋(정산 · 원장 · 마감)이 같은 변환을 하므로 여기 모은다. 서비스끼리
 * 서로를 가져오게 두면 순환 참조가 되고, 그때는 어느 쪽이 먼저 초기화되느냐에
 * 따라 `undefined` 가 되는 함수가 생긴다 — 런타임에만 드러나는 종류의 사고다.
 */

/** YYYYMM → [그달 1일 UTC자정, 말일 UTC자정] */
export function monthRange(yearMonth: string): [Date, Date] {
  const y = Number(yearMonth.slice(0, 4));
  const m = Number(yearMonth.slice(4, 6));
  return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 0))];
}

/**
 * 세금계산서 법정 발행기한 — 공급일이 속한 달의 **다음 달 10일**.
 *
 * 부가가치세법이 정한 날이다. 넘기면 가산세가 붙으므로 계산서 화면의 축이
 * "발행했나" 가 아니라 "며칠 남았나" 인 이유가 이것이다.
 */
export function invoiceIssueDate(yearMonth: string): Date {
  const y = Number(yearMonth.slice(0, 4));
  const m = Number(yearMonth.slice(4, 6));
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 10));
}

export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** 오늘 자정(UTC). date 컬럼과 견주려면 시각이 0이어야 한다 */
export function startOfToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 그날 UTC 자정. 로컬 자정으로 만들면 KST 에서 하루 밀린다 */
export function dateOnly(input: string): Date {
  return new Date(`${input}T00:00:00Z`);
}

export interface TaxInvoiceRecord {
  tax_invoice_id: bigint;
  settlement_id: bigint | null;
  invoice_type: string;
  invoice_no: string | null;
  nts_approval_no: string | null;
  issue_date: Date;
  status: string;
  supplier_name: string;
  supplier_business_no: string;
  buyer_name: string;
  buyer_business_no: string;
  supply_amount: unknown;
  tax_amount: unknown;
  total_amount: unknown;
  nts_result_message: string | null;
}

export interface InvoiceSettlementRef {
  settlement_no: string;
  settlement_type: string;
  settlement_year_month: string;
}

/** 계산서 한 장을 화면이 읽는 모양으로 */
export function invoiceRowOf(
  inv: TaxInvoiceRecord,
  settlement: InvoiceSettlementRef | null,
  today?: string,
): SettlementInvoiceRow {
  const ym = settlement?.settlement_year_month ?? null;
  return {
    taxInvoiceId: String(inv.tax_invoice_id),
    invoiceType: inv.invoice_type,
    invoiceNo: inv.invoice_no,
    ntsApprovalNo: inv.nts_approval_no,
    issueDate: isoDate(inv.issue_date),
    status: inv.status,
    supplierName: inv.supplier_name,
    supplierBusinessNo: inv.supplier_business_no,
    buyerName: inv.buyer_name,
    buyerBusinessNo: inv.buyer_business_no,
    supplyAmount: num(inv.supply_amount) ?? 0,
    taxAmount: num(inv.tax_amount) ?? 0,
    totalAmount: num(inv.total_amount) ?? 0,
    ntsResultMessage: inv.nts_result_message,
    settlementId: inv.settlement_id === null ? null : String(inv.settlement_id),
    settlementNo: settlement?.settlement_no ?? null,
    settlementType: settlement?.settlement_type ?? null,
    yearMonth: ym,
    /*
      발행된 계산서는 **발행일**과 견준다. 오늘과 견주면 지난달 것이 전부
      "기한 초과" 로 뜬다 — 제때 낸 것까지. `today` 는 아직 발행 안 된
      줄이 섞여 들어올 때를 위해 남겨 둔다.
    */
    deadline: ym
      ? inv.issue_date
        ? invoiceDeadline(ym, isoDate(inv.issue_date), true)
        : invoiceDeadline(ym, today ?? isoDate(startOfToday()))
      : null,
  };
}

/** 사업자등록번호 표기 — 000-00-00000 */
export function formatBusinessNo(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
}
