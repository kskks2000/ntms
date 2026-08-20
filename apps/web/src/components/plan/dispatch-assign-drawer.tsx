'use client';

import { AlertTriangle, Truck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

interface DispatchCandidates {
  carrierId: string | null;
  vehicles: {
    vehicleId: string;
    vehicleNo: string;
    vehicleTypeName: string;
    defaultDriverId: string | null;
    defaultDriverName: string | null;
    busy: boolean;
  }[];
  drivers: {
    driverId: string;
    driverCode: string;
    driverName: string;
    onTimeRate: number | null;
    busy: boolean;
  }[];
}

/**
 * 배차 지시 — 트립에 차와 기사를 붙인다.
 *
 * ## 왜 후보를 좁혀서 보여주나
 *
 * 이 트립을 맡은 **운송사의 차**만, 그리고 **요구 차종에 맞는 차**만
 * 보인다. 전체 차량 목록에서 고르게 하면 남의 운송사 차를 지정하는 실수가
 * 실제로 난다 — 그건 배차가 아니라 사고다.
 *
 * 같은 날 이미 다른 트립에 물린 차·기사는 회색으로 두되 **지우지는
 * 않는다.** 겹치는 것을 알면서도 붙여야 하는 날이 있고, 그때 목록에서
 * 아예 사라져 있으면 사람은 시스템이 고장 났다고 생각한다. 대신 서버가
 * 마지막에 한 번 더 막는다.
 */
export function DispatchAssignDrawer({
  tripId,
  tripNo,
  onClose,
  onDone,
}: {
  tripId: string;
  tripNo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');

  const query = useApiQuery<DispatchCandidates>(
    ['dispatch-candidates', tripId],
    `/plan/trips/${tripId}/dispatch-candidates`,
    { staleTime: 0 },
  );

  const assign = useApiMutation<{ id: string }, { vehicleId: string; driverId: string }>(
    () => ({ path: `/plan/trips/${tripId}/dispatch`, method: 'POST' }),
    {
      invalidate: [['dispatch-board'], ['allocations'], ['orders'], ['consolidation']],
      onSuccess: () => {
        toast.success('배차했습니다', `${tripNo}`);
        onDone();
      },
    },
  );

  // 차를 고르면 그 차의 기본 기사를 함께 채운다. 대개 그 조합으로 나가고,
  // 다르면 바꾸면 된다.
  const vehicles = query.data?.vehicles ?? [];
  useEffect(() => {
    if (!vehicleId) return;
    const v = vehicles.find((x) => x.vehicleId === vehicleId);
    if (v?.defaultDriverId) setDriverId(v.defaultDriverId);
  }, [vehicleId, vehicles]);

  // Esc 로 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !assign.isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assign.isPending, onClose]);

  const drivers = query.data?.drivers ?? [];
  const noCarrier = query.data && query.data.carrierId === null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="닫기"
        onClick={() => !assign.isPending && onClose()}
        className="absolute inset-0 cursor-default bg-black/25 backdrop-blur-[1px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${tripNo} 배차 지시`}
        className="relative flex h-full w-full max-w-[30rem] flex-col bg-surface-card shadow-2xl motion-safe:animate-[ntms-drawer-in_180ms_ease-out]"
      >
        <header className="flex items-start gap-3 border-b border-line-subtle px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="tabular truncate text-lead font-medium text-content-primary">
              {tripNo}
            </h2>
            <p className="mt-0.5 text-caption text-content-tertiary">
              이 트립을 맡은 운송사의 차와 기사만 나옵니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={assign.isPending}
            aria-label="닫기"
            className="-mr-2 -mt-1 rounded-md p-2 text-content-tertiary transition-colors hover:bg-surface-sunken hover:text-content-primary disabled:opacity-40"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {query.isLoading && (
            <p className="py-10 text-center text-caption text-content-tertiary">
              후보를 찾는 중…
            </p>
          )}

          {noCarrier && (
            <p className="mb-5 flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning-surface px-3 py-2.5 text-caption text-status-warning">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                아직 운송사가 수락한 배정이 없습니다. 배정을 먼저 마쳐야 배차할 수 있습니다.
              </span>
            </p>
          )}

          <Section title="차량" count={vehicles.length}>
            {vehicles.length === 0 ? (
              <p className="py-6 text-center text-caption text-content-tertiary">
                이 운송사에 요구 차종의 차가 없습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {vehicles.map((v) => (
                  <li key={v.vehicleId}>
                    <PickRow
                      active={vehicleId === v.vehicleId}
                      busy={v.busy}
                      onClick={() => setVehicleId(v.vehicleId)}
                      title={v.vehicleNo}
                      note={v.vehicleTypeName}
                      trailing={v.defaultDriverName ?? undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="기사" count={drivers.length}>
            {drivers.length === 0 ? (
              <p className="py-6 text-center text-caption text-content-tertiary">
                이 운송사에 재직 중인 기사가 없습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {drivers.map((d) => (
                  <li key={d.driverId}>
                    <PickRow
                      active={driverId === d.driverId}
                      busy={d.busy}
                      onClick={() => setDriverId(d.driverId)}
                      title={d.driverName}
                      note={d.driverCode}
                      trailing={d.onTimeRate === null ? undefined : `정시 ${Math.round(d.onTimeRate)}%`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <footer className="flex items-center gap-2 border-t border-line-subtle bg-surface-sunken/50 px-6 py-3.5">
          <p className="min-w-0 flex-1 text-caption text-content-tertiary">
            회색은 같은 날 다른 트립에 물린 것입니다.
          </p>
          <Button variant="secondary" onClick={onClose} disabled={assign.isPending}>
            취소
          </Button>
          <Button
            // 운송사 수락 전에는 아예 누를 수 없다. 배너로 알려 주고도
            // 단추를 열어 두면, 눌러 보고 나서야 안 된다는 걸 알게 된다.
            disabled={!vehicleId || !driverId || noCarrier === true}
            loading={assign.isPending}
            loadingLabel="배차하는 중"
            onClick={() =>
              assign.mutateAsync({ vehicleId, driverId }).catch((err: unknown) => {
                toast.danger(
                  '배차하지 못했습니다',
                  err instanceof ApiRequestError ? err.message : undefined,
                );
              })
            }
            leadingIcon={<Truck size={15} strokeWidth={1.75} aria-hidden="true" />}
          >
            배차 지시
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-line-subtle pt-5 first:mt-0 first:border-0 first:pt-0">
      <h3 className="mb-2.5 text-label font-semibold text-content-primary">
        {title}
        <span className="tabular ml-1.5 font-normal text-content-tertiary">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function PickRow({
  active,
  busy,
  onClick,
  title,
  note,
  trailing,
}: {
  active: boolean;
  busy: boolean;
  onClick: () => void;
  title: string;
  note: string;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
        active
          ? 'border-action bg-surface-sunken'
          : 'border-transparent hover:bg-surface-sunken',
        busy && !active && 'opacity-50',
      )}
    >
      <span className="tabular min-w-0 flex-1 truncate text-label text-content-primary">
        {title}
      </span>
      <span className="shrink-0 text-caption text-content-tertiary">{note}</span>
      {busy && (
        <span className="shrink-0 rounded-sm bg-status-warning-surface px-1.5 py-0.5 text-caption text-status-warning">
          배차됨
        </span>
      )}
      {!busy && trailing && (
        <span className="shrink-0 text-caption text-content-secondary">{trailing}</span>
      )}
    </button>
  );
}
