'use client';

import {
  ArrowDown,
  ArrowUp,
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
  stopKeyOf,
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
import { NaverMap, type MapMarker } from '@/components/map/naver-map';
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

  /**
   * 정차 순서를 손으로 바꾼다.
   *
   * 기본 순서("다 싣고 다 내린다")는 예측 가능한 출발점일 뿐이다. 실제
   * 동선은 배차 담당자가 안다 — 중간에서 내리고 실으면 적재 곡선이 크게
   * 낮아지는 경우가 흔하다.
   */
  const reorder = useApiMutation<{ id: string }, { tripId: string; stopOrder: string[] }>(
    (b) => ({ path: `/plan/trips/${b.tripId}`, method: 'PATCH' }),
    { invalidate, onSuccess: () => toast.success('정차 순서를 바꿨습니다') },
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
                  onReorder={(order) =>
                    reorder
                      .mutateAsync({ tripId: t.tripId, stopOrder: order })
                      .catch(fail('순서를 바꾸지 못했습니다'))
                  }
                  onConfirm={() =>
                    confirmTrip
                      .mutateAsync({ tripId: t.tripId })
                      .catch(fail('확정하지 못했습니다'))
                  }
                  onDrop={() =>
                    dropTrip.mutateAsync({ tripId: t.tripId }).catch(fail('풀지 못했습니다'))
                  }
                  busy={
                    confirmTrip.isPending ||
                    dropTrip.isPending ||
                    addToTrip.isPending ||
                    reorder.isPending
                  }
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
  onReorder,
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
  onReorder: (stopOrder: string[]) => void;
  onConfirm: () => void;
  onDrop: () => void;
  busy: boolean;
}) {
  const over = trip.profile.firstOverSeq !== null;
  const badOrder = trip.precedence.length > 0;

  /**
   * 한 칸 옮긴 순서를 서버에 보낸다.
   *
   * 드래그 대신 화살표를 쓴다. 한 칸씩 옮기는 일이 대부분이고, 키보드로
   * 할 수 있으며, 정차가 넷뿐인 화면에서 드래그는 정확도만 떨어뜨린다.
   */
  const move = (from: number, to: number) => {
    if (to < 0 || to >= trip.stops.length) return;
    const keys = trip.stops.map(stopKeyOf);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k!);
    onReorder(keys);
  };

  return (
    <Panel className={cn((over || badOrder) && 'border-status-danger/35')}>
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
            disabled={busy || over || badOrder || trip.orderCount === 0}
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
        {badOrder && (
          <p className="mt-2.5 rounded-md border border-status-danger/30 bg-status-danger-surface px-2.5 py-2 text-caption text-status-danger">
            <b>싣기 전에 내리는 순서입니다</b> —{' '}
            {trip.precedence
              .map((v) => `${v.orderNo.slice(-6)} (상차 ${v.pickupSeq || '없음'} · 하차 ${v.deliverySeq})`)
              .join(', ')}
            . 적재량은 낮아 보이지만 기사는 첫 하차지에서 빈 차로 섭니다.
          </p>
        )}

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
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h4 className="text-label font-semibold text-content-primary">정차 순서</h4>
              <span className="tabular text-caption text-content-tertiary">
                {trip.plannedDistanceKm !== null &&
                  `${Math.round(trip.plannedDistanceKm).toLocaleString('ko-KR')}km`}
                {trip.plannedDurationMin !== null &&
                  ` · ${formatMinutes(trip.plannedDurationMin)}`}
              </span>
            </div>

            {trip.missingRouteCount > 0 && (
              <p className="mb-2 text-caption text-status-warning">
                구간 {trip.missingRouteCount}곳의 거리가 라우트에 없어 그 뒤 시각을 세우지
                못했습니다.
              </p>
            )}

            <ol className="space-y-1">
              {trip.stops.map((s, i) => (
                <li
                  key={s.stopSeq}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-1 py-0.5',
                    s.lateMinutes !== null && 'bg-status-danger-surface',
                  )}
                >
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

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-content-primary">
                      {s.locationName}
                    </span>
                    <span className="tabular block text-caption text-content-tertiary">
                      {s.plannedArrivalAt ? clockOf(s.plannedArrivalAt) : '—'}
                      {s.timeWindowFrom && (
                        <span className="ml-1">
                          (창 {s.timeWindowFrom}–{s.timeWindowTo ?? ''})
                        </span>
                      )}
                      {s.lateMinutes !== null && (
                        <span className="ml-1 font-medium text-status-danger">
                          {formatMinutes(s.lateMinutes)} 늦음
                        </span>
                      )}
                      {s.lateMinutes === null && s.waitMinutes !== null && s.waitMinutes > 0 && (
                        <span className="ml-1">{formatMinutes(s.waitMinutes)} 대기</span>
                      )}
                    </span>
                  </span>

                  <span
                    className={cn(
                      'tabular w-16 shrink-0 text-right text-caption',
                      s.over ? 'font-medium text-status-danger' : 'text-content-secondary',
                    )}
                  >
                    {s.cumulativeWeightKg.toLocaleString('ko-KR')}kg
                  </span>

                  <span className="flex shrink-0 gap-0.5">
                    <MoveButton
                      label={`${s.stopSeq}번째 정차 위로`}
                      disabled={busy || i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
                    </MoveButton>
                    <MoveButton
                      label={`${s.stopSeq}번째 정차 아래로`}
                      disabled={busy || i === trip.stops.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
                    </MoveButton>
                  </span>
                </li>
              ))}
            </ol>

            {trip.lateStopCount > 0 && (
              <p className="mt-2 text-caption text-status-danger">
                이 순서로는 {trip.lateStopCount}곳의 시간창을 못 지킵니다. 순서를 바꾸거나
                오더를 나누세요.
              </p>
            )}
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

          {/*
            지도는 순서를 눈으로 확인하는 자리다. 이름만 봐서는 "부산 → 광주
            → 안성" 이 얼마나 돌아가는 동선인지 감이 안 온다.

            좌표가 없는 거점은 마커가 안 찍힌다 — 기준정보에서 좌표를 채우면
            바로 보인다.
          */}
          <div className="min-w-0 border-t border-line-subtle px-4 py-3 lg:col-span-2">
            <h4 className="mb-2 text-label font-semibold text-content-primary">동선</h4>
            <NaverMap
              height={260}
              markers={toMarkers(trip)}
              fallbackHint="지도 키를 넣으면 정차 순서를 지도 위에서 확인할 수 있습니다."
            />
            {trip.stops.some((s) => s.latitude === null) && (
              <p className="mt-2 text-caption text-status-warning">
                좌표가 없는 거점 {trip.stops.filter((s) => s.latitude === null).length}곳은
                지도에 안 찍힙니다. 기준정보 · 상하차지에서 위·경도를 넣으세요.
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * 정차를 지도 마커로.
 *
 * 좌표가 없는 거점은 건너뛴다. 기준정보에서 좌표를 채우면 그 순간부터
 * 지도에 나타난다 — 좌표 미검증 거점이 왜 문제인지가 여기서 눈에 띈다.
 */
function toMarkers(trip: TripView): MapMarker[] {
  const out: MapMarker[] = [];
  for (const s of trip.stops) {
    if (s.latitude === null || s.longitude === null) continue;
    out.push({
      id: String(s.stopSeq),
      latitude: s.latitude,
      longitude: s.longitude,
      label: String(s.stopSeq),
      title: `${s.stopSeq}. ${s.locationName}`,
      tone: s.stopType === 'PICKUP' ? 'pickup' : 'delivery',
    });
  }
  return out;
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-content-tertiary transition-colors hover:bg-surface-sunken hover:text-content-primary disabled:opacity-25"
    >
      {children}
    </button>
  );
}

/** ISO → `HH:MM`. 보는 사람의 시각으로 읽는다 */
function clockOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}
