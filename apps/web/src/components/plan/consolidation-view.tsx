'use client';

import {
  Check,
  ChevronRight,
  Layers,
  Package,
  Plus,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  TEMPERATURE_ZONE_LABEL,
  TRIP_TYPE_LABEL,
  type ConsolidationPage,
  type MasterOptions,
  type PoolOrder,
  type TripView,
  type VehicleCapacity,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { useToast } from '@/components/ui/toast';
import { LoadProfile, LoadVerdictLine } from '@/components/plan/load-profile';
import { cn } from '@/lib/cn';

/**
 * 편성 · 상차조합.
 *
 * 오더 풀에서 몇 건을 골라 한 대에 묶는 화면이다. 배차실의 오전이 여기서
 * 간다.
 *
 * ## 왼쪽은 후보, 오른쪽은 결정
 *
 * 왼쪽 풀에서 고르고 오른쪽에 담는다. 담는 순간 **적재 곡선이 다시
 * 그려진다** — 그 조합이 실리는지는 담아 봐야 알고, 담아 본 뒤 바로
 * 알아야 한다.
 *
 * 드래그를 쓰지 않았다. 하루 수십 건을 다루는 화면에서 드래그는 정확도가
 * 떨어지고 키보드로 할 수 없다. 체크해서 담는 방식이 여러 건을 한 번에
 * 옮기기에도 낫다.
 */
export function ConsolidationView() {
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [openTrip, setOpenTrip] = useState<string | null>(null);

  const key = `/plan/consolidation?date=${date}`;
  const page = useApiQuery<ConsolidationPage>(['consolidation', key], key, { staleTime: 0 });
  const capacities = useApiQuery<VehicleCapacity[]>(
    ['vehicle-capacities'],
    '/orders/vehicle-capacities',
    { staleTime: 5 * 60_000 },
  );

  const pool = page.data?.pool ?? [];
  const trips = page.data?.trips ?? [];

  const chosen = useMemo(() => pool.filter((o) => picked.has(o.orderId)), [pool, picked]);
  const chosenTotals = useMemo(
    () =>
      chosen.reduce(
        (a, o) => ({
          w: a.w + o.weightKg,
          v: a.v + o.volumeCbm,
          p: a.p + o.palletQty,
        }),
        { w: 0, v: 0, p: 0 },
      ),
    [chosen],
  );

  const invalidate = [['consolidation'], ['orders'], ['allocations']];

  const createTrip = useApiMutation<{ id: string; tripNo: string }, unknown>(
    () => ({ path: '/plan/trips', method: 'POST' }),
    {
      invalidate,
      onSuccess: (r) => {
        toast.success('트립을 만들었습니다', `${r.tripNo} · 오더 ${chosen.length}건`);
        setPicked(new Set());
        setOpenTrip(r.id);
      },
    },
  );

  const addToTrip = useApiMutation<{ id: string }, { tripId: string; orderIds: string[] }>(
    (b) => ({ path: `/plan/trips/${b.tripId}`, method: 'PATCH' }),
    {
      invalidate,
      onSuccess: () => {
        toast.success('트립에 담았습니다');
        setPicked(new Set());
      },
    },
  );

  const setVehicle = useApiMutation<
    { id: string },
    { tripId: string; requiredVehicleTypeId: string | null }
  >((b) => ({ path: `/plan/trips/${b.tripId}`, method: 'PATCH' }), {
    invalidate,
    onSuccess: () => toast.success('차종을 바꿨습니다'),
  });

  const confirmTrip = useApiMutation<{ id: string }, { tripId: string }>(
    (b) => ({ path: `/plan/trips/${b.tripId}/confirm`, method: 'POST' }),
    {
      invalidate,
      onSuccess: () => toast.success('편성을 확정했습니다', '운송사 배정으로 넘어갑니다'),
    },
  );

  const dropTrip = useApiMutation<{ id: string; released: number }, { tripId: string }>(
    (b) => ({ path: `/plan/trips/${b.tripId}`, method: 'DELETE' }),
    {
      invalidate,
      onSuccess: (r) =>
        toast.success('편성을 풀었습니다', `오더 ${r.released}건이 풀로 돌아갔습니다`),
    },
  );

  const fail = (label: string) => (err: unknown) =>
    toast.danger(label, err instanceof ApiRequestError ? err.message : undefined);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title="편성 · 상차조합"
        description="오더를 골라 한 대에 묶습니다. 담을 때마다 실리는지 바로 보여 드립니다."
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
          <Stat label="미편성 오더" value={pool.length} unit="건" />
          <Stat
            label="미편성 물량"
            value={Math.round(pool.reduce((a, o) => a + o.weightKg, 0) / 100) / 10}
            unit="t"
          />
          <Stat label="작성중 트립" value={trips.length} unit="건" />
          <Stat
            label="고른 오더"
            value={chosen.length}
            unit="건"
            hint={chosen.length > 0 ? `${Math.round(chosenTotals.w / 100) / 10}t` : undefined}
            tone={chosen.length > 0 ? 'accent' : 'default'}
          />
        </StatRow>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          {/* ============ 왼쪽 · 오더 풀 ============ */}
          <div className="min-w-0">
            <Panel
              title="미편성 오더"
              subtitle={`${pool.length}건 · 체크해서 오른쪽으로 담습니다`}
              bodyClassName="max-h-[38rem] overflow-y-auto"
            >
              {pool.length === 0 ? (
                <EmptyState
                  icon={<Package size={24} strokeWidth={1.5} />}
                  title="묶을 오더가 없습니다"
                  description="접수된 오더가 모두 편성됐습니다."
                />
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {pool.map((o) => (
                    <PoolRow
                      key={o.orderId}
                      order={o}
                      checked={picked.has(o.orderId)}
                      onToggle={() => toggle(o.orderId)}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            {/* 고른 것을 어디로 보낼지 — 고르기 전에는 자리를 차지하지 않는다 */}
            {chosen.length > 0 && (
              <div className="mt-3 rounded-card border border-line-strong bg-surface-card p-4">
                <p className="text-label font-semibold text-content-primary">
                  고른 오더 {chosen.length}건
                </p>
                <p className="tabular mt-0.5 text-caption text-content-tertiary">
                  {chosenTotals.w.toLocaleString('ko-KR')}kg ·{' '}
                  {chosenTotals.v.toLocaleString('ko-KR')}CBM ·{' '}
                  {chosenTotals.p.toLocaleString('ko-KR')}PLT
                </p>

                <div className="mt-3 space-y-2.5">
                  <SelectField
                    label="차종"
                    placeholder="나중에 정함"
                    options={(capacities.data ?? []).map((c) => ({
                      value: c.id,
                      label: c.name,
                      note: c.maxWeightKg
                        ? `${(c.maxWeightKg / 1000).toLocaleString('ko-KR')}t`
                        : null,
                    }))}
                    value={vehicleTypeId}
                    onChange={(e) => setVehicleTypeId(e.target.value)}
                  />
                  <Button
                    block
                    loading={createTrip.isPending}
                    loadingLabel="만드는 중"
                    onClick={() =>
                      createTrip
                        .mutateAsync({
                          planDate: date,
                          requiredVehicleTypeId: vehicleTypeId || null,
                          orderIds: chosen.map((o) => o.orderId),
                        })
                        .catch(fail('트립을 만들지 못했습니다'))
                    }
                    leadingIcon={<Layers size={15} strokeWidth={1.75} aria-hidden="true" />}
                  >
                    새 트립으로 묶기
                  </Button>

                  {trips.length > 0 && (
                    <div className="border-t border-line-subtle pt-2.5">
                      <p className="mb-1.5 text-caption text-content-tertiary">
                        또는 만들어 둔 트립에 담기
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {trips.map((t) => (
                          <button
                            key={t.tripId}
                            type="button"
                            onClick={() =>
                              addToTrip
                                .mutateAsync({
                                  tripId: t.tripId,
                                  orderIds: [
                                    ...t.orders.map((o) => o.orderId),
                                    ...chosen.map((o) => o.orderId),
                                  ],
                                })
                                .catch(fail('담지 못했습니다'))
                            }
                            className="tabular rounded-md border border-line-field bg-surface-card px-2 py-1 text-caption text-content-secondary transition-colors hover:bg-surface-sunken"
                          >
                            <Plus
                              size={11}
                              strokeWidth={2}
                              aria-hidden="true"
                              className="mr-0.5 inline"
                            />
                            {t.tripNo.slice(-4)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ============ 오른쪽 · 트립 ============ */}
          <div className="min-w-0 space-y-4">
            {trips.length === 0 ? (
              <Panel>
                <EmptyState
                  icon={<Layers size={26} strokeWidth={1.5} />}
                  title="아직 만든 트립이 없습니다"
                  description="왼쪽에서 오더를 고르고 '새 트립으로 묶기' 를 누르면 여기에 나타납니다."
                />
              </Panel>
            ) : (
              trips.map((t) => (
                <TripCard
                  key={t.tripId}
                  trip={t}
                  capacities={capacities.data ?? []}
                  expanded={openTrip === t.tripId}
                  onToggle={() => setOpenTrip(openTrip === t.tripId ? null : t.tripId)}
                  onVehicleChange={(id) =>
                    setVehicle
                      .mutateAsync({ tripId: t.tripId, requiredVehicleTypeId: id || null })
                      .catch(fail('차종을 바꾸지 못했습니다'))
                  }
                  onRemoveOrder={(orderId) =>
                    addToTrip
                      .mutateAsync({
                        tripId: t.tripId,
                        orderIds: t.orders
                          .filter((o) => o.orderId !== orderId)
                          .map((o) => o.orderId),
                      })
                      .catch(fail('빼지 못했습니다'))
                  }
                  onConfirm={() =>
                    confirmTrip
                      .mutateAsync({ tripId: t.tripId })
                      .catch(fail('확정하지 못했습니다'))
                  }
                  onDrop={() =>
                    dropTrip.mutateAsync({ tripId: t.tripId }).catch(fail('풀지 못했습니다'))
                  }
                  busy={confirmTrip.isPending || dropTrip.isPending || addToTrip.isPending}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------

function PoolRow({
  order,
  checked,
  onToggle,
}: {
  order: PoolOrder;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={cn(
          'flex cursor-pointer gap-2.5 px-3 py-2.5 transition-colors',
          checked ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/60',
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-jade-600))]"
          aria-label={`${order.orderNo} 고르기`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="tabular truncate text-caption text-content-tertiary">
              {order.orderNo.slice(-6)}
            </span>
            <span className="truncate text-label text-content-primary">{order.shipperName}</span>
          </span>

          <span className="mt-0.5 flex items-center gap-1 text-caption text-content-secondary">
            <span className="truncate">{order.fromLocationName}</span>
            <ChevronRight
              size={11}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-content-tertiary"
            />
            <span className="truncate">{order.toLocationName}</span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
            <span className="tabular text-content-primary">
              {(order.weightKg / 1000).toLocaleString('ko-KR')}t
            </span>
            {order.palletQty > 0 && (
              <span className="tabular text-content-tertiary">{order.palletQty}PLT</span>
            )}
            {order.pickupTimeFrom && (
              <span className="tabular text-content-tertiary">
                {order.pickupTimeFrom}–{order.pickupTimeTo ?? ''}
              </span>
            )}
            {order.temperatureZone !== 'AMBIENT' && (
              <span className="rounded-sm bg-surface-card px-1 text-content-accent">
                {TEMPERATURE_ZONE_LABEL[order.temperatureZone]}
              </span>
            )}
            {order.isExclusive && (
              <span className="rounded-sm bg-status-warning-surface px-1 text-status-warning">
                독차
              </span>
            )}
          </span>
        </span>
      </label>
    </li>
  );
}

function TripCard({
  trip,
  capacities,
  expanded,
  onToggle,
  onVehicleChange,
  onRemoveOrder,
  onConfirm,
  onDrop,
  busy,
}: {
  trip: TripView;
  capacities: VehicleCapacity[];
  expanded: boolean;
  onToggle: () => void;
  onVehicleChange: (id: string) => void;
  onRemoveOrder: (orderId: string) => void;
  onConfirm: () => void;
  onDrop: () => void;
  busy: boolean;
}) {
  const over = trip.profile.firstOverSeq !== null;

  return (
    <Panel className={cn(over && 'border-status-danger/35')}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <ChevronRight
            size={15}
            strokeWidth={2}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-content-tertiary transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className="tabular text-lead font-medium text-content-primary">
            {trip.tripNo}
          </span>
          <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-caption text-content-secondary">
            {TRIP_TYPE_LABEL[trip.tripType] ?? trip.tripType}
          </span>
        </button>

        <span className="tabular text-caption text-content-tertiary">
          오더 {trip.orderCount}건 · 정차 {trip.stops.length}곳
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="sr-only">{trip.tripNo} 차종</span>
            <select
              value={trip.requiredVehicleTypeId ?? ''}
              onChange={(e) => onVehicleChange(e.target.value)}
              className="field-text h-8 rounded-md border border-line-field bg-surface-field px-2 text-caption text-content-primary"
            >
              <option value="">차종 미정</option>
              {capacities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDrop}
            className="text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
            leadingIcon={<Unlink size={14} strokeWidth={1.75} aria-hidden="true" />}
          >
            편성 풀기
          </Button>
          <Button
            size="sm"
            disabled={busy || over || trip.orderCount === 0}
            onClick={onConfirm}
            leadingIcon={<Check size={14} strokeWidth={2} aria-hidden="true" />}
          >
            편성 확정
          </Button>
        </div>
      </header>

      {/* 시그니처 — 적재 곡선 */}
      <div className="px-4 pb-3 pt-4">
        <LoadProfile
          stops={trip.stops}
          capacityKg={trip.capacity.maxWeightKg}
          compact={!expanded}
        />
        <div className="mt-2.5">
          <LoadVerdictLine
            peakWeightKg={trip.profile.peakWeightKg}
            peakRate={trip.profile.peakRate}
            firstOverSeq={trip.profile.firstOverSeq}
            overBy={trip.profile.overBy}
            capacityKg={trip.capacity.maxWeightKg}
            stops={trip.stops}
          />
        </div>
      </div>

      {expanded && (
        <div className="grid gap-0 border-t border-line-subtle lg:grid-cols-2">
          {/* 정차 순서 */}
          <div className="min-w-0 px-4 py-3">
            <h4 className="mb-2 text-label font-semibold text-content-primary">정차 순서</h4>
            <ol className="space-y-1.5">
              {trip.stops.map((s) => (
                <li key={s.stopSeq} className="flex items-baseline gap-2">
                  <span className="tabular w-4 shrink-0 text-caption text-content-tertiary">
                    {s.stopSeq}
                  </span>
                  <span
                    className={cn(
                      'w-8 shrink-0 text-caption',
                      s.stopType === 'PICKUP'
                        ? 'text-content-accent'
                        : 'text-content-tertiary',
                    )}
                  >
                    {s.stopType === 'PICKUP' ? '상차' : '하차'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-label text-content-primary">
                    {s.locationName}
                  </span>
                  {s.timeWindowFrom && (
                    <span className="tabular shrink-0 text-caption text-content-tertiary">
                      {s.timeWindowFrom}–{s.timeWindowTo ?? ''}
                    </span>
                  )}
                  <span
                    className={cn(
                      'tabular w-16 shrink-0 text-right text-caption',
                      s.over ? 'font-medium text-status-danger' : 'text-content-secondary',
                    )}
                  >
                    {s.cumulativeWeightKg.toLocaleString('ko-KR')}kg
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* 실린 오더 */}
          <div className="min-w-0 border-t border-line-subtle px-4 py-3 lg:border-l lg:border-t-0">
            <h4 className="mb-2 text-label font-semibold text-content-primary">실린 오더</h4>
            <ul className="space-y-1.5">
              {trip.orders.map((o) => (
                <li key={o.orderId} className="flex items-center gap-2">
                  <span className="tabular shrink-0 text-caption text-content-tertiary">
                    {o.orderNo.slice(-6)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-label text-content-primary">
                    {o.shipperName}
                  </span>
                  <span className="tabular shrink-0 text-caption text-content-secondary">
                    {(o.weightKg / 1000).toLocaleString('ko-KR')}t
                  </span>
                  <button
                    type="button"
                    disabled={busy || trip.orderCount <= 1}
                    onClick={() => onRemoveOrder(o.orderId)}
                    aria-label={`${o.orderNo} 트립에서 빼기`}
                    title={
                      trip.orderCount <= 1
                        ? '마지막 오더는 뺄 수 없습니다. 편성을 푸세요'
                        : '트립에서 빼기'
                    }
                    className="shrink-0 rounded p-1 text-content-tertiary transition-colors hover:bg-status-danger-surface hover:text-status-danger disabled:opacity-30"
                  >
                    <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}
