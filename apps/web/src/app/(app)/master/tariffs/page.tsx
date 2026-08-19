'use client';

import { Receipt } from 'lucide-react';
import {
  APPROVAL_STATUS_LABEL,
  RATE_METHOD_LABEL,
  RATE_TARGET_LABEL,
  type TariffListItem,
} from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { ValidityMeter } from '@/components/master/validity-meter';
import { StatusChip } from '@/components/tms/status-chip';
import type { Column } from '@/components/tms/data-table';
import { cn } from '@/lib/cn';

/**
 * 단가 (운임표).
 *
 * 정산 금액이 여기서 나온다. 두 가지가 잘못되기 쉽다 —
 *   1. 적용기간이 지난 운임표로 계속 청구한다
 *   2. 요율 상세를 한 줄도 안 넣은 채 승인만 해 둔다
 *
 * 그래서 적용기간을 차량 보험과 **같은 게이지**로 보이고, 상세 건수를
 * 컬럼으로 세운다. 상세가 0이면 이 운임표로는 아무 금액도 계산되지 않는다.
 */
const columns: Column<TariffListItem>[] = [
  {
    key: 'code',
    header: '코드',
    render: (t) => <span className="tabular">{t.rateTableCode}</span>,
  },
  {
    key: 'name',
    header: '운임표명',
    render: (t) => (
      <span
        className={cn(
          'truncate font-medium',
          !t.isActive && 'text-content-tertiary line-through',
        )}
      >
        {t.rateTableName}
      </span>
    ),
  },
  {
    key: 'target',
    header: '구분',
    render: (t) => (
      // 매출과 매입을 헷갈리면 마진이 뒤집힌다. 색으로도 갈라 둔다.
      <span
        className={cn(
          'whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-caption',
          t.rateTarget === 'BILLING'
            ? 'border-status-success/30 bg-status-success-surface text-status-success'
            : 'border-line-subtle bg-surface-sunken text-content-secondary',
        )}
      >
        {RATE_TARGET_LABEL[t.rateTarget] ?? t.rateTarget}
      </span>
    ),
  },
  {
    key: 'method',
    header: '산정방식',
    render: (t) => (
      <span className="text-content-secondary">
        {RATE_METHOD_LABEL[t.rateMethod] ?? t.rateMethod}
      </span>
    ),
  },
  {
    key: 'partner',
    header: '적용 거래처',
    render: (t) =>
      t.partnerName ?? <span className="text-content-tertiary">전체 공통</span>,
  },
  {
    key: 'period',
    header: '적용기간',
    width: '10rem',
    render: (t) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="tabular text-caption text-content-tertiary">
          {t.applyStartDate} ~
        </span>
        {t.apply.until === null ? (
          <span className="text-caption text-content-secondary">무기한</span>
        ) : (
          <ValidityMeter validity={t.apply} />
        )}
      </span>
    ),
  },
  {
    key: 'details',
    header: '요율 상세',
    numeric: true,
    render: (t) =>
      t.detailCount === 0 ? (
        <span
          className="font-medium text-status-warning"
          title="상세가 없으면 이 운임표로는 금액이 계산되지 않습니다"
        >
          없음
        </span>
      ) : (
        t.detailCount.toLocaleString('ko-KR') + '건'
      ),
  },
  {
    key: 'min',
    header: '최소금액',
    numeric: true,
    render: (t) =>
      t.minChargeAmount === null ? '—' : t.minChargeAmount.toLocaleString('ko-KR'),
  },
  {
    key: 'options',
    header: '옵션',
    render: (t) => (
      <span className="flex flex-wrap gap-1 text-caption text-content-secondary">
        {t.applyFuelSurcharge && <span>유류할증</span>}
        {t.isTaxable && <span>과세</span>}
        {!t.applyFuelSurcharge && !t.isTaxable && (
          <span className="text-content-tertiary">—</span>
        )}
      </span>
    ),
  },
  {
    key: 'status',
    header: '승인',
    render: (t) => (
      <StatusChip
        label={APPROVAL_STATUS_LABEL[t.status] ?? t.status}
        phase={
          t.status === 'APPROVED'
            ? 'done'
            : t.status === 'REJECTED' || t.status === 'CANCELLED'
              ? 'problem'
              : 'planned'
        }
      />
    ),
  },
];

export default function TariffsPage() {
  return (
    <MasterPage<TariffListItem>
      eyebrow="Master"
      title="단가 (운임표)"
      description="청구와 지급 금액이 이 표에서 나옵니다. 적용기간과 요율 상세를 함께 확인하세요."
      endpoint="/master/tariffs"
      queryKey="master-tariffs"
      columns={columns}
      getRowKey={(t) => t.rateTableId}
      filters={[
        { value: 'BILLING', label: '매출(청구)' },
        { value: 'PAYMENT', label: '매입(지급)' },
      ]}
      filterLabel="구분"
      searchPlaceholder="운임표명 · 코드"
      emptyIcon={<Receipt size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 운임표가 없습니다"
      emptyDescription="운임표를 등록해야 오더 금액과 정산 금액을 계산할 수 있습니다."
      createLabel="운임표 등록"
      extraStats={(d) => {
        if (!d) return null;
        const empty = d.items.filter((t) => t.detailCount === 0).length;
        return (
          <div className="min-w-0 px-4 py-3.5">
            <p className="truncate text-caption text-content-tertiary">요율 상세 없음</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span
                className={cn(
                  'tabular text-[1.5rem] font-medium leading-none',
                  empty > 0 ? 'text-status-warning' : 'text-content-primary',
                )}
              >
                {empty}
              </span>
              <span className="text-caption text-content-tertiary">건</span>
            </p>
            <p className="mt-1 truncate text-caption text-content-tertiary">
              금액이 계산되지 않음
            </p>
          </div>
        );
      }}
    />
  );
}
