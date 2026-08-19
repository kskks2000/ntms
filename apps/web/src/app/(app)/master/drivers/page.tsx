'use client';

import { IdCard } from 'lucide-react';
import { DRIVER_STATUS_LABEL, type DriverListItem } from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { ValidityMeter } from '@/components/master/validity-meter';
import { StatusChip } from '@/components/tms/status-chip';
import type { Column } from '@/components/tms/data-table';
import { cn } from '@/lib/cn';

/**
 * 기사.
 *
 * 차량과 같은 원칙이다 — 면허와 화물운송 종사자격이 살아 있어야 배차할 수
 * 있다. 정시율은 배차 후보를 고를 때 실제로 보는 숫자라 함께 둔다.
 */
const columns: Column<DriverListItem>[] = [
  {
    key: 'code',
    header: '코드',
    render: (d) => <span className="tabular">{d.driverCode}</span>,
  },
  {
    key: 'name',
    header: '성명',
    render: (d) => (
      <span
        className={cn(
          'font-medium',
          !d.isActive && 'text-content-tertiary line-through',
        )}
      >
        {d.driverName}
      </span>
    ),
  },
  { key: 'carrier', header: '운송사', render: (d) => d.carrierName ?? '자차' },
  {
    key: 'mobile',
    header: '연락처',
    render: (d) => <span className="tabular">{d.mobile ?? '—'}</span>,
  },
  {
    key: 'license',
    header: '운전면허',
    width: '9.5rem',
    render: (d) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-caption text-content-tertiary">
          {d.licenseType ?? '종류 미등록'}
        </span>
        <ValidityMeter validity={d.license} />
      </span>
    ),
  },
  {
    key: 'cargo',
    header: '화물자격',
    width: '9rem',
    render: (d) => <ValidityMeter validity={d.cargoQualification} />,
  },
  {
    key: 'ontime',
    header: '정시율',
    numeric: true,
    render: (d) =>
      d.onTimeRate === null ? (
        '—'
      ) : (
        // 소수점은 없는 정밀도를 있는 것처럼 보이게 한다. 배차할 때 보는 건
        // 96 이냐 92 냐지 96.41 이냐 96.38 이냐가 아니다.
        <span className={cn(d.onTimeRate < 93 && 'font-medium text-status-warning')}>
          {Math.round(d.onTimeRate)}%
        </span>
      ),
  },
  {
    key: 'score',
    header: '평가',
    numeric: true,
    render: (d) => (d.evaluationScore === null ? '—' : d.evaluationScore.toFixed(1)),
  },
  {
    key: 'accident',
    header: '사고',
    numeric: true,
    render: (d) => (
      <span className={cn(d.accidentCount > 0 && 'font-medium text-status-danger')}>
        {d.accidentCount}
      </span>
    ),
  },
  {
    key: 'status',
    header: '상태',
    render: (d) => (
      <StatusChip
        label={DRIVER_STATUS_LABEL[d.status] ?? d.status}
        phase={
          d.status === 'ACTIVE'
            ? 'planned'
            : d.status === 'RESIGNED' || d.status === 'SUSPENDED'
              ? 'problem'
              : 'done'
        }
      />
    ),
  },
];

export default function DriversPage() {
  return (
    <MasterPage<DriverListItem>
      eyebrow="Master"
      title="기사"
      description="배차 대상 기사입니다. 면허와 화물운송 종사자격이 살아 있어야 배차할 수 있습니다."
      endpoint="/master/drivers"
      queryKey="master-drivers"
      columns={columns}
      getRowKey={(d) => d.driverId}
      filters={[
        { value: 'ACTIVE', label: '재직' },
        { value: 'LEAVE', label: '휴직' },
        { value: 'SUSPENDED', label: '정지' },
        { value: 'RESIGNED', label: '퇴사' },
      ]}
      filterLabel="재직 상태"
      searchPlaceholder="성명 · 코드 · 연락처"
      emptyIcon={<IdCard size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 기사가 없습니다"
      emptyDescription="기사를 등록해야 배차 지시를 보낼 수 있습니다."
      createLabel="기사 등록"
    />
  );
}
