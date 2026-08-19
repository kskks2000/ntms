'use client';

import { MapPin } from 'lucide-react';
import { LOCATION_TYPE_LABEL, type LocationListItem, type ZoneSummary } from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { Panel } from '@/components/tms/panels';
import type { Column } from '@/components/tms/data-table';
import { cn } from '@/lib/cn';

/**
 * 상하차지 · 권역.
 *
 * 주소록이 아니다. 이 화면의 숫자들은 그대로 편성 엔진의 입력이 된다 —
 * 운영시간이 시간창을 정하고, 표준 상/하차 시간이 정차 시간을 정하고,
 * 좌표가 구간 거리를 정한다. **좌표가 검증되지 않은 거점**은 거리 계산이
 * 통째로 틀어지므로 요약에서 따로 센다.
 */
const columns: Column<LocationListItem>[] = [
  {
    key: 'code',
    header: '코드',
    render: (l) => <span className="tabular">{l.locationCode}</span>,
  },
  {
    key: 'name',
    header: '거점명',
    render: (l) => (
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'truncate font-medium',
            !l.isActive && 'text-content-tertiary line-through',
          )}
        >
          {l.locationName}
        </span>
        <span className="truncate text-caption text-content-tertiary">{l.address}</span>
      </span>
    ),
  },
  {
    key: 'type',
    header: '유형',
    render: (l) => (
      <span className="text-content-secondary">
        {LOCATION_TYPE_LABEL[l.locationType] ?? l.locationType}
      </span>
    ),
  },
  {
    key: 'zone',
    header: '권역',
    render: (l) => l.zoneName ?? <span className="text-content-tertiary">미지정</span>,
  },
  {
    key: 'hours',
    header: '운영시간',
    render: (l) =>
      l.openTime ? (
        <span className="tabular text-content-secondary">
          {l.openTime}–{l.closeTime ?? ''}
        </span>
      ) : (
        <span className="text-content-tertiary">미등록</span>
      ),
  },
  {
    key: 'service',
    header: '상/하차 표준',
    numeric: true,
    render: (l) => (
      <span className="tabular">
        {l.standardLoadMin ?? '—'} / {l.standardUnloadMin ?? '—'}분
      </span>
    ),
  },
  {
    key: 'dock',
    header: '도크',
    numeric: true,
    render: (l) => (l.dockCount === null ? '—' : l.dockCount),
  },
  {
    key: 'facility',
    header: '설비 · 조건',
    render: (l) => (
      <span className="flex flex-wrap gap-1">
        {l.hasForklift && <Tag>지게차</Tag>}
        {l.requireReservation && <Tag tone="warning">예약필수</Tag>}
        {!l.geoVerified && <Tag tone="danger">좌표 미검증</Tag>}
        {!l.hasForklift && !l.requireReservation && l.geoVerified && (
          <span className="text-content-tertiary">—</span>
        )}
      </span>
    ),
  },
  {
    key: 'orders',
    header: '오더',
    numeric: true,
    render: (l) => l.orderCount.toLocaleString('ko-KR'),
  },
];

function Tag({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-caption',
        tone === 'warning'
          ? 'border-status-warning/30 bg-status-warning-surface text-status-warning'
          : tone === 'danger'
            ? 'border-status-danger/30 bg-status-danger-surface text-status-danger'
            : 'border-line-subtle bg-surface-sunken text-content-secondary',
      )}
    >
      {children}
    </span>
  );
}

export default function LocationsPage() {
  return (
    <MasterPage<LocationListItem>
      eyebrow="Master"
      title="상하차지 · 권역"
      description="상차·하차가 일어나는 거점입니다. 운영시간과 표준 작업시간이 그대로 편성에 쓰입니다."
      endpoint="/master/locations"
      queryKey="master-locations"
      columns={columns}
      getRowKey={(l) => l.locationId}
      searchPlaceholder="거점명 · 코드 · 주소"
      emptyIcon={<MapPin size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 거점이 없습니다"
      emptyDescription="상하차지를 등록해야 오더의 구간과 거리를 잡을 수 있습니다."
      createLabel="거점 등록"
      aside={(data) => {
        const zones = (data as unknown as { zones?: ZoneSummary[] } | undefined)?.zones;
        return (
          <Panel title="권역" subtitle={zones ? `${zones.length}개` : undefined}>
            {zones && zones.length > 0 ? (
              <ul className="divide-y divide-line-subtle">
                {zones.map((z) => (
                  <li
                    key={z.zoneId}
                    className="flex items-baseline gap-2 px-4 py-2.5"
                  >
                    <span className="tabular text-caption text-content-tertiary">
                      {z.zoneCode}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body text-content-primary">
                      {z.zoneName}
                    </span>
                    <span className="tabular shrink-0 text-caption text-content-secondary">
                      {z.locationCount}곳
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-caption text-content-tertiary">
                등록된 권역이 없습니다
              </p>
            )}
          </Panel>
        );
      }}
    />
  );
}
