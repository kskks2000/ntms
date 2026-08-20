'use client';

import { Check, Handshake, Truck, X } from 'lucide-react';
import { useState } from 'react';
import {
  ALLOCATION_STATUS_LABEL,
  TRIP_STATUS_LABEL,
  TRIP_STATUS_PHASE,
  type AllocationTripView,
  type CarrierCandidate,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/**
 * 운송사 배정.
 *
 * 편성이 끝난 트립을 어느 운송사에 맡길지 정한다.
 *
 * ## 값싼 순으로 줄 세우지 않는다
 *
 * 가장 싼 운송사가 늘 안 받아 주면 그건 후보가 아니다. 배차실이 실제로
 * 보는 것은 **금액 · 수락률 · 댈 수 있는 차** 셋의 조합이고, 그 셋을 한
 * 줄에 놓고 견주는 것이 이 화면의 전부다.
 *
 * 새 시각 장치를 만들지 않았다. 이 화면의 일은 비교이고, 비교에는 잘 만든
 * 표가 가장 낫다 — 편성의 적재 곡선이 이 흐름의 유일한 굵은 장치다.
 */
export function AllocationView() {
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const key = `/plan/allocations?date=${date}`;
  const page = useApiQuery<AllocationTripView[]>(['allocations', key], key, { staleTime: 0 });
  const trips = page.data ?? [];

  const waiting = trips.filter((t) => t.allocation === null);
  const pending = trips.filter((t) => t.allocation?.status === 'REQUESTED');
  const settled = trips.filter((t) => t.allocation?.status === 'ACCEPTED');

  const invalidate = [['allocations'], ['consolidation'], ['orders'], ['dispatch-board']];

  const allocate = useApiMutation<
    { id: string },
    { tripId: string; carrierId: string; rateTableId: string | null; allocatedAmount: number | null }
  >((b) => ({ path: `/plan/trips/${b.tripId}/allocate`, method: 'POST' }), {
    invalidate,
    onSuccess: () => {
      toast.success('배정을 요청했습니다', '운송사 답을 기다립니다');
      setOpenTrip(null);
    },
  });

  const respond = useApiMutation<
    { id: string; status: string },
    { allocationId: string; accept: boolean; reason: string | null }
  >((b) => ({ path: `/plan/allocations/${b.allocationId}/respond`, method: 'POST' }), {
    invalidate,
    onSuccess: (r) => {
      toast.success(r.status === 'ACCEPTED' ? '수락으로 기록했습니다' : '거절로 기록했습니다');
      setRejecting(null);
      setReason('');
    },
  });

  const cancel = useApiMutation<{ id: string }, { allocationId: string; reason: string }>(
    (b) => ({ path: `/plan/allocations/${b.allocationId}/cancel`, method: 'POST' }),
    { invalidate, onSuccess: () => toast.success('배정을 거뒀습니다') },
  );

  const fail = (label: string) => (err: unknown) =>
    toast.danger(label, err instanceof ApiRequestError ? err.message : undefined);

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title="운송사 배정"
        description="편성이 끝난 트립을 운송사에 맡깁니다. 금액 · 수락률 · 댈 수 있는 차를 함께 봅니다."
        actions={
          <label className="flex items-center gap-2 text-caption text-content-tertiary">
            <span>계획일</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="계획일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-2.5 text-label text-content-primary"
            />
          </label>
        }
      />

      <div className="space-y-5 px-6 py-6">
        <StatRow>
          <Stat label="배정 대기" value={waiting.length} unit="건" tone={waiting.length > 0 ? 'accent' : 'default'} />
          <Stat label="답 기다림" value={pending.length} unit="건" tone={pending.length > 0 ? 'warning' : 'default'} />
          <Stat label="배정 완료" value={settled.length} unit="건" />
          <Stat
            label="배정 금액"
            value={Math.round(
              settled.reduce((a, t) => a + (t.allocation?.totalAmount ?? 0), 0) / 10000,
            ).toLocaleString('ko-KR')}
            unit="만원"
          />
        </StatRow>

        {trips.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Handshake size={26} strokeWidth={1.5} />}
              title="배정할 트립이 없습니다"
              description="편성 · 상차조합에서 트립을 확정하면 여기로 넘어옵니다."
            />
          </Panel>
        ) : (
          <div className="space-y-4">
            {trips.map((t) => (
              <TripRow
                key={t.tripId}
                trip={t}
                open={openTrip === t.tripId}
                onToggle={() => setOpenTrip(openTrip === t.tripId ? null : t.tripId)}
                onAllocate={(c) =>
                  allocate
                    .mutateAsync({
                      tripId: t.tripId,
                      carrierId: c.carrierId,
                      rateTableId: c.rateTableId,
                      allocatedAmount: c.contractAmount,
                    })
                    .catch(fail('배정하지 못했습니다'))
                }
                onAccept={() =>
                  respond
                    .mutateAsync({
                      allocationId: t.allocation!.allocationId,
                      accept: true,
                      reason: null,
                    })
                    .catch(fail('기록하지 못했습니다'))
                }
                onRejectStart={() => setRejecting(t.allocation!.allocationId)}
                onCancel={() =>
                  cancel
                    .mutateAsync({
                      allocationId: t.allocation!.allocationId,
                      reason: '배차실에서 거둠',
                    })
                    .catch(fail('거두지 못했습니다'))
                }
                busy={allocate.isPending || respond.isPending || cancel.isPending}
              />
            ))}
          </div>
        )}

        {/* 거절 사유 — 별도 창을 띄우지 않고 화면 안에서 받는다 */}
        {rejecting && (
          <Panel className="border-status-danger/30">
            <div className="flex flex-wrap items-end gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <TextField
                  label="거절 사유"
                  required
                  placeholder="가용 차량 없음 · 단가 협의 필요 …"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  hint="이 사유는 배정 이력에 남습니다"
                />
              </div>
              <Button variant="secondary" onClick={() => setRejecting(null)}>
                그만두기
              </Button>
              <Button
                variant="danger"
                loading={respond.isPending}
                loadingLabel="기록하는 중"
                onClick={() => {
                  if (!reason.trim()) {
                    toast.danger('거절 사유를 입력하세요');
                    return;
                  }
                  respond
                    .mutateAsync({
                      allocationId: rejecting,
                      accept: false,
                      reason: reason.trim(),
                    })
                    .catch(fail('기록하지 못했습니다'));
                }}
              >
                거절로 기록
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------

function TripRow({
  trip,
  open,
  onToggle,
  onAllocate,
  onAccept,
  onRejectStart,
  onCancel,
  busy,
}: {
  trip: AllocationTripView;
  open: boolean;
  onToggle: () => void;
  onAllocate: (c: CarrierCandidate) => void;
  onAccept: () => void;
  onRejectStart: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const a = trip.allocation;

  return (
    <Panel>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
        <span className="tabular text-lead font-medium text-content-primary">{trip.tripNo}</span>
        <StatusChip
          label={TRIP_STATUS_LABEL[trip.status] ?? trip.status}
          phase={TRIP_STATUS_PHASE[trip.status] ?? 'planned'}
        />

        <span className="flex min-w-0 items-center gap-1.5 text-label text-content-secondary">
          <span className="truncate">{trip.fromName}</span>
          <span aria-hidden="true" className="text-content-tertiary">→</span>
          <span className="truncate">{trip.toName}</span>
        </span>

        <span className="tabular text-caption text-content-tertiary">
          오더 {trip.orderCount} · 정차 {trip.stopCount} ·{' '}
          {(trip.totalWeightKg / 1000).toLocaleString('ko-KR')}t
          {trip.plannedDistanceKm !== null &&
            ` · ${trip.plannedDistanceKm.toLocaleString('ko-KR')}km`}
        </span>

        {trip.requiredVehicleTypeName && (
          <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-caption text-content-secondary">
            {trip.requiredVehicleTypeName}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {a ? (
            <>
              <span className="flex items-baseline gap-1.5">
                <span className="text-label text-content-primary">{a.carrierName}</span>
                <span
                  className={cn(
                    'rounded-sm px-1.5 py-0.5 text-caption',
                    a.status === 'ACCEPTED'
                      ? 'bg-status-success-surface text-status-success'
                      : 'bg-status-warning-surface text-status-warning',
                  )}
                >
                  {ALLOCATION_STATUS_LABEL[a.status] ?? a.status}
                </span>
              </span>
              {a.totalAmount !== null && (
                <span className="tabular text-label text-content-secondary">
                  {a.totalAmount.toLocaleString('ko-KR')}원
                </span>
              )}
              {a.status === 'REQUESTED' && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={onAccept}
                    leadingIcon={<Check size={14} strokeWidth={2} aria-hidden="true" />}
                  >
                    수락
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={onRejectStart}
                    leadingIcon={<X size={14} strokeWidth={2} aria-hidden="true" />}
                  >
                    거절
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                    거두기
                  </Button>
                </>
              )}
            </>
          ) : (
            <Button size="sm" onClick={onToggle} aria-expanded={open}>
              {open ? '후보 닫기' : '운송사 고르기'}
            </Button>
          )}
        </div>
      </header>

      {open && !a && <Candidates tripId={trip.tripId} busy={busy} onPick={onAllocate} />}
    </Panel>
  );
}

/**
 * 후보 비교.
 *
 * 숫자를 그냥 늘어놓지 않고 **왜 이 순서인지**를 한 줄로 적는다. 순서만
 * 바꾸고 이유를 안 적으면 사용자는 그 순서를 믿지 못하고, 결국 자기가
 * 다시 훑어본다.
 */
function Candidates({
  tripId,
  busy,
  onPick,
}: {
  tripId: string;
  busy: boolean;
  onPick: (c: CarrierCandidate) => void;
}) {
  const query = useApiQuery<CarrierCandidate[]>(
    ['candidates', tripId],
    `/plan/trips/${tripId}/candidates`,
    { staleTime: 30_000 },
  );

  if (query.isLoading) {
    return (
      <p className="border-t border-line-subtle px-4 py-8 text-center text-caption text-content-tertiary">
        후보를 찾는 중…
      </p>
    );
  }
  const list = query.data ?? [];
  if (list.length === 0) {
    return (
      <div className="border-t border-line-subtle">
        <EmptyState
          icon={<Truck size={24} strokeWidth={1.5} />}
          title="맡길 운송사가 없습니다"
          description="기준정보 · 운송사에 등록하고 차량을 넣으면 여기에 나타납니다."
        />
      </div>
    );
  }

  return (
    <div className="border-t border-line-subtle overflow-x-auto">
      <table className="w-full border-collapse text-label">
        <thead>
          <tr className="border-b border-line-subtle text-caption text-content-tertiary">
            <th scope="col" className="px-4 py-2 text-left font-medium">운송사</th>
            <th scope="col" className="w-28 px-3 py-2 text-right font-medium">계약 운임</th>
            <th scope="col" className="w-20 px-3 py-2 text-right font-medium">수락률</th>
            <th scope="col" className="w-20 px-3 py-2 text-right font-medium">정시율</th>
            <th scope="col" className="w-24 px-3 py-2 text-right font-medium">댈 수 있는 차</th>
            <th scope="col" className="w-20 px-3 py-2 text-right font-medium">오늘 배차</th>
            <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
              <span className="sr-only">배정</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const unable = c.vehicleCount === 0;
            return (
              <tr
                key={c.carrierId}
                className={cn(
                  'border-b border-line-subtle last:border-0',
                  unable && 'opacity-55',
                )}
              >
                <td className="px-4 py-2.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-content-primary">{c.carrierName}</span>
                      {c.grade && (
                        <span className="tabular rounded-sm border border-line-strong bg-surface-sunken px-1 text-[10px] text-content-secondary">
                          {c.grade}
                        </span>
                      )}
                    </span>
                    {c.note && (
                      <span
                        className={cn(
                          'truncate text-caption',
                          unable ? 'text-status-danger' : 'text-content-tertiary',
                        )}
                      >
                        {c.note}
                      </span>
                    )}
                  </span>
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {c.contractAmount === null ? (
                    <span className="text-content-tertiary">운임표 없음</span>
                  ) : (
                    c.contractAmount.toLocaleString('ko-KR')
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {c.acceptRate === null ? (
                    <span className="text-content-tertiary">—</span>
                  ) : (
                    <span
                      className={cn(c.acceptRate < 70 && 'font-medium text-status-warning')}
                    >
                      {c.acceptRate}%
                    </span>
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right text-content-secondary">
                  {c.onTimeRate === null ? '—' : `${c.onTimeRate}%`}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  <span className={cn(unable && 'font-medium text-status-danger')}>
                    {c.vehicleCount}대
                  </span>
                </td>
                <td className="tabular px-3 py-2.5 text-right text-content-secondary">
                  {c.assignedToday}건
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Button
                    size="sm"
                    variant={unable ? 'secondary' : 'primary'}
                    disabled={busy}
                    onClick={() => onPick(c)}
                  >
                    배정
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
