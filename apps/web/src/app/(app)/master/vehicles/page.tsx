'use client';

import { Truck } from 'lucide-react';
import {
  OWNERSHIP_LABEL,
  VEHICLE_STATUS_LABEL,
  validityLevel,
  type VehicleListItem,
} from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { ValidityMeter } from '@/components/master/validity-meter';
import { StatusChip } from '@/components/tms/status-chip';
import type { Column } from '@/components/tms/data-table';
import { cn } from '@/lib/cn';

/**
 * 차량.
 *
 * 스펙(톤급 · 적재량)은 편성이 알아서 맞춘다. 사람이 이 화면에서 확인해야
 * 하는 것은 **지금 이 차에 배차해도 되는가** 이고, 그걸 막는 것은 대개
 * 스펙이 아니라 보험 · 검사 만료다. 그래서 만료 두 칸을 오른쪽 끝이 아니라
 * 눈에 걸리는 자리에 둔다.
 */
const columns: Column<VehicleListItem>[] = [
  {
    key: 'no',
    header: '차량번호',
    render: (v) => (
      <span
        className={cn(
          'tabular font-medium',
          !v.isActive && 'text-content-tertiary line-through',
        )}
      >
        {v.vehicleNo}
      </span>
    ),
  },
  {
    key: 'type',
    header: '차종',
    render: (v) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{v.vehicleTypeName}</span>
        <span className="tabular text-caption text-content-tertiary">
          {v.maxWeightKg === null
            ? '—'
            : (v.maxWeightKg / 1000).toLocaleString('ko-KR') + 't'}
          {v.maxPalletQty ? ' · ' + v.maxPalletQty + 'PLT' : ''}
        </span>
      </span>
    ),
  },
  {
    key: 'ownership',
    header: '소유',
    render: (v) => (
      <span className="text-content-secondary">
        {OWNERSHIP_LABEL[v.ownershipType] ?? v.ownershipType}
      </span>
    ),
  },
  { key: 'carrier', header: '운송사', render: (v) => v.carrierName ?? '자차' },
  {
    key: 'driver',
    header: '기본 기사',
    render: (v) =>
      v.defaultDriverName ?? <span className="text-content-tertiary">미지정</span>,
  },
  {
    key: 'status',
    header: '상태',
    render: (v) => (
      <StatusChip
        label={VEHICLE_STATUS_LABEL[v.status] ?? v.status}
        phase={
          v.status === 'IN_USE'
            ? 'active'
            : v.status === 'MAINTENANCE' || v.status === 'DISPOSED'
              ? 'problem'
              : 'planned'
        }
      />
    ),
  },
  {
    key: 'insurance',
    header: '보험',
    width: '9rem',
    render: (v) => <ValidityMeter validity={v.insurance} />,
  },
  {
    key: 'inspection',
    header: '검사',
    width: '9rem',
    render: (v) => <ValidityMeter validity={v.inspection} />,
  },
  {
    key: 'odo',
    header: '주행거리',
    numeric: true,
    render: (v) =>
      v.odometerKm === null
        ? '—'
        : Math.round(v.odometerKm).toLocaleString('ko-KR') + ' km',
  },
];

export default function VehiclesPage() {
  return (
    <MasterPage<VehicleListItem>
      eyebrow="Master"
      title="차량"
      description="배차 대상 차량입니다. 보험·검사 만료가 임박한 차는 배차 전에 정리하세요."
      endpoint="/master/vehicles"
      queryKey="master-vehicles"
      columns={columns}
      getRowKey={(v) => v.vehicleId}
      filters={[
        { value: 'AVAILABLE', label: '가용' },
        { value: 'IN_USE', label: '운행중' },
        { value: 'MAINTENANCE', label: '정비중' },
        { value: 'IDLE', label: '유휴' },
      ]}
      filterLabel="차량 상태"
      searchPlaceholder="차량번호 · 운송사"
      emptyIcon={<Truck size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 차량이 없습니다"
      emptyDescription="차량을 등록해야 트립에 배차할 수 있습니다."
      createLabel="차량 등록"
      extraStats={(d) => {
        if (!d) return null;
        // 이미 지난 것은 "임박" 과 성격이 다르다. 임박은 준비하면 되지만
        // 만료는 지금 배차하면 안 되는 차다.
        const expired = d.items.filter(
          (v) =>
            validityLevel(v.insurance) === 'expired' ||
            validityLevel(v.inspection) === 'expired',
        ).length;
        return (
          <div className="min-w-0 px-4 py-3.5">
            <p className="truncate text-caption text-content-tertiary">이 쪽에서 만료</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span
                className={cn(
                  'tabular text-[1.5rem] font-medium leading-none',
                  expired > 0 ? 'text-status-danger' : 'text-content-primary',
                )}
              >
                {expired}
              </span>
              <span className="text-caption text-content-tertiary">대</span>
            </p>
            <p className="mt-1 truncate text-caption text-content-tertiary">
              보험 또는 검사
            </p>
          </div>
        );
      }}
    />
  );
}
