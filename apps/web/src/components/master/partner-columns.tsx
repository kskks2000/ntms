import { PARTNER_ROLE_LABEL, type PartnerListItem } from '@ntms/shared';
import type { Column } from '@/components/tms/data-table';
import { cn } from '@/lib/cn';

/**
 * 화주 · 운송사 · 거래처는 business_partner 한 테이블이다.
 * 그런데 **묻는 것이 다르다.**
 *
 *   화주    이번 달 얼마나 맡겼나 · 언제 받나(마감·지급조건)
 *   운송사  차를 몇 대 대나 · 배정을 얼마나 받아주나
 *   거래처  이 회사가 우리와 무슨 관계인가(역할)
 *
 * 그래서 테이블은 하나로 두되 컬럼은 세 벌로 나눈다. 한 벌로 합치면
 * 어느 화면에서도 필요 없는 열이 절반을 차지한다.
 */

const GRADE_TONE: Record<string, string> = {
  S: 'border-status-success/30 bg-status-success-surface text-status-success',
  A: 'border-line-strong bg-surface-sunken text-content-secondary',
  B: 'border-line-strong bg-surface-sunken text-content-secondary',
  C: 'border-status-warning/30 bg-status-warning-surface text-status-warning',
  D: 'border-status-danger/30 bg-status-danger-surface text-status-danger',
};

export function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-content-tertiary">—</span>;
  return (
    <span
      title={`거래처 등급 ${grade}`}
      className={cn(
        'tabular inline-flex h-5 w-5 items-center justify-center rounded-sm border text-caption font-medium',
        GRADE_TONE[grade] ?? GRADE_TONE.A,
      )}
    >
      {grade}
    </span>
  );
}

function nameCell(p: PartnerListItem) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn('truncate', !p.isActive && 'text-content-tertiary line-through')}>
        {p.partnerName}
      </span>
      {p.businessNo && (
        <span className="tabular text-caption text-content-tertiary">
          {formatBizNo(p.businessNo)}
        </span>
      )}
    </span>
  );
}

function contactCell(p: PartnerListItem) {
  if (!p.managerName && !p.tel) return <span className="text-content-tertiary">—</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{p.managerName ?? '—'}</span>
      <span className="tabular text-caption text-content-tertiary">
        {p.managerTel ?? p.tel ?? ''}
      </span>
    </span>
  );
}

/** 화주 — 물동량과 정산 조건 */
export const shipperColumns: Column<PartnerListItem>[] = [
  { key: 'code', header: '코드', render: (p) => <span className="tabular">{p.partnerCode}</span> },
  { key: 'name', header: '화주명', render: nameCell },
  { key: 'grade', header: '등급', align: 'center', render: (p) => <GradeBadge grade={p.grade} /> },
  { key: 'contact', header: '담당자', render: contactCell },
  {
    key: 'orders',
    header: '이번 달 오더',
    numeric: true,
    render: (p) =>
      p.orderCount === undefined ? (
        '—'
      ) : (
        <span className="flex flex-col items-end">
          <span>{p.orderCount.toLocaleString('ko-KR')}건</span>
          <span className="text-caption text-content-tertiary">
            {Math.round((p.orderWeightKg ?? 0) / 1000).toLocaleString('ko-KR')}t
          </span>
        </span>
      ),
  },
  {
    key: 'settlement',
    header: '정산조건',
    render: (p) => (
      <span className="text-content-secondary">
        {p.settlementCycle === 'MONTHLY' ? '월정산' : (p.settlementCycle ?? '—')}
        {p.closingDay !== null && (
          <span className="tabular text-content-tertiary"> · {p.closingDay}일 마감</span>
        )}
        {p.paymentTermsDays !== null && (
          <span className="tabular text-content-tertiary"> · {p.paymentTermsDays}일</span>
        )}
      </span>
    ),
  },
  {
    key: 'credit',
    header: '여신한도',
    numeric: true,
    render: (p) => (p.creditLimit === null ? '—' : formatKrwShort(p.creditLimit)),
  },
];

/**
 * 여신한도를 한국식 단위로 줄인다.
 *
 * 5억을 "50,000만" 으로 쓰면 자릿수를 세어야 읽힌다. 억 단위로 끊는 것이
 * 계약서와 결재 문서에서 쓰는 방식이고, 표에서도 한눈에 크기가 비교된다.
 */
function formatKrwShort(amount: number): string {
  const EOK = 100_000_000;
  const MAN = 10_000;
  if (amount >= EOK) {
    const eok = amount / EOK;
    return `${(Number.isInteger(eok) ? eok : Number(eok.toFixed(1))).toLocaleString('ko-KR')}억`;
  }
  if (amount >= MAN) return `${Math.round(amount / MAN).toLocaleString('ko-KR')}만`;
  return amount.toLocaleString('ko-KR');
}

/** 운송사 — 댈 수 있는 자원과 응답 */
export const carrierColumns: Column<PartnerListItem>[] = [
  { key: 'code', header: '코드', render: (p) => <span className="tabular">{p.partnerCode}</span> },
  { key: 'name', header: '운송사명', render: nameCell },
  { key: 'grade', header: '등급', align: 'center', render: (p) => <GradeBadge grade={p.grade} /> },
  { key: 'contact', header: '담당자', render: contactCell },
  {
    key: 'fleet',
    header: '보유 차량',
    numeric: true,
    render: (p) => (p.vehicleCount === undefined ? '—' : `${p.vehicleCount}대`),
  },
  {
    key: 'drivers',
    header: '기사',
    numeric: true,
    render: (p) => (p.driverCount === undefined ? '—' : `${p.driverCount}명`),
  },
  {
    key: 'accept',
    header: '배정 수락률',
    numeric: true,
    render: (p) =>
      p.acceptRate === undefined || p.acceptRate === null ? (
        <span className="text-content-tertiary">요청 없음</span>
      ) : (
        // 수락률이 낮은 운송사는 배정해도 트립이 뜨지 않는다.
        // 배차 담당자가 다음 후보를 고를 때 쓰는 숫자다.
        <span className={cn(p.acceptRate < 70 && 'font-medium text-status-warning')}>
          {p.acceptRate}%
        </span>
      ),
  },
  {
    key: 'settlement',
    header: '지급조건',
    render: (p) => (
      <span className="text-content-secondary">
        {p.settlementCycle === 'MONTHLY' ? '월정산' : (p.settlementCycle ?? '—')}
        {p.paymentTermsDays !== null && (
          <span className="tabular text-content-tertiary"> · {p.paymentTermsDays}일</span>
        )}
      </span>
    ),
  },
];

/** 거래처 — 한 회사가 여러 역할을 겸할 수 있다 */
export const partnerColumns: Column<PartnerListItem>[] = [
  { key: 'code', header: '코드', render: (p) => <span className="tabular">{p.partnerCode}</span> },
  { key: 'name', header: '거래처명', render: nameCell },
  {
    key: 'roles',
    header: '역할',
    render: (p) =>
      p.roles.length === 0 ? (
        <span className="text-content-tertiary">미지정</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {p.roles.map((r) => (
            <span
              key={r}
              className="rounded-sm border border-line-subtle bg-surface-sunken px-1.5 py-0.5 text-caption text-content-secondary"
            >
              {PARTNER_ROLE_LABEL[r]}
            </span>
          ))}
        </span>
      ),
  },
  { key: 'grade', header: '등급', align: 'center', render: (p) => <GradeBadge grade={p.grade} /> },
  { key: 'ceo', header: '대표자', render: (p) => p.ceoName ?? '—' },
  { key: 'contact', header: '담당자', render: contactCell },
  {
    key: 'active',
    header: '상태',
    render: (p) =>
      p.isActive ? (
        <span className="text-content-secondary">사용중</span>
      ) : (
        <span className="text-status-warning">사용중지</span>
      ),
  },
];

/** 123-45-67890 */
function formatBizNo(no: string): string {
  const d = no.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : no;
}
