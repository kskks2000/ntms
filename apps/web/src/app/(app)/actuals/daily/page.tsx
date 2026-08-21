'use client';

import { AlertTriangle, RefreshCw, Truck } from 'lucide-react';
import { useState } from 'react';
import type { DriverDayRow, OperationDaily, VehicleDayRow } from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { DayBand, DayBandLegend, LoadedBar, formatMinutes } from '@/components/actual/day-band';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 운행일보.
 *
 * ## 하루를 한 줄로 펴고, 돈을 번 시간만 채운다
 *
 * 운행일보를 "총 주행 몇 km" 표로 만들면 아무도 안 연다. 관리자가 이 화면을
 * 여는 이유는 **하루 중 얼마가 돈을 벌었나** 를 보기 위해서다 — 실차로 달린
 * 시간과 서 있던 시간의 비율.
 *
 * 그래서 차량마다 24시간짜리 띠를 한 줄씩 준다. 띠가 짧으면 일이 없었던
 * 것이고, 노란 칸이 길면 어딘가에서 오래 서 있었던 것이다. 숫자를 세지 않고
 * 스무 대를 훑을 수 있어야 한다.
 *
 * 휴차한 차도 줄을 남긴다. 굴린 차만 표에 있으면 가동률의 분모가 사라지고,
 * 왜 안 굴렸는지가 화면에서 통째로 빠진다.
 */
export default function OperationDailyPage() {
  const toast = useToast();
  const [date, setDate] = useState(() => toDateInput(new Date()));

  const query = useApiQuery<OperationDaily>(['actuals', 'daily', date], `/actuals/daily?date=${date}`);
  const data = query.data;

  const rebuild = useApiMutation<{ dates: string[] }, { from: string; to: string }>(
    () => ({ path: '/actuals/rebuild', method: 'POST' }),
    {
      invalidate: [['actuals']],
      onSuccess: () => {
        toast.success('운행일보를 다시 만들었습니다', '확정된 실적을 기준으로 집계했습니다.');
        void query.refetch();
      },
    },
  );

  const empty = data && data.vehicles.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Actuals"
        title="운행일보"
        description="차량 하루가 무엇으로 채워졌는지 봅니다. 주행·대기·공회전·휴게, 그리고 실차와 공차."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              max={toDateInput(new Date())}
              onChange={(e) => setDate(e.target.value)}
              aria-label="운행일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <Button
              variant="secondary"
              loading={rebuild.isPending}
              loadingLabel="집계하는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
              onClick={() => rebuild.mutate({ from: date, to: date })}
            >
              다시 만들기
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {data && data.summary.violationCount > 0 && (
          <Alert tone="warning" title={`연속운전·휴게 위반 ${data.summary.violationCount}건`}>
            화물자동차 운수사업법은 4시간 연속 운전 뒤 30분 이상 휴게를 요구합니다. 아래
            기사 근무 표에서 위반 건이 맨 위에 있습니다. 배차를 나눌 수 있는지 먼저 확인하세요.
          </Alert>
        )}

        <StatRow>
          <Stat
            label="가동률"
            value={data?.summary.utilizationRate ?? '—'}
            unit="%"
            hint={data ? `${data.summary.vehicleOperated} / ${data.summary.vehicleTotal}대` : undefined}
          />
          <Stat
            label="총 주행"
            value={data ? Math.round(data.summary.totalDistanceKm).toLocaleString('ko-KR') : '—'}
            unit="km"
            hint={data ? `실차 ${Math.round(data.summary.loadedDistanceKm).toLocaleString('ko-KR')}km` : undefined}
          />
          <Stat
            label="공차율"
            value={data?.summary.emptyRate ?? '—'}
            unit="%"
            hint="계기판 대비 노선 밖"
            tone={(data?.summary.emptyRate ?? 0) >= 30 ? 'warning' : 'default'}
          />
          <Stat
            label="평균 가동시간"
            value={data?.summary.avgOperatingMinutes ? formatMinutes(data.summary.avgOperatingMinutes) : '—'}
            unit=""
            hint="굴린 차 기준"
          />
          <Stat label="평균 적재율" value={data?.summary.avgLoadingRate ?? '—'} unit="%" />
          <Stat
            label="법규 위반"
            value={data?.summary.violationCount ?? '—'}
            unit="건"
            tone={(data?.summary.violationCount ?? 0) > 0 ? 'danger' : 'default'}
          />
        </StatRow>

        <Panel
          title="차량 하루"
          subtitle={
            data?.builtAt
              ? `${formatDateTime(data.builtAt)} 집계 · 굴린 차가 위, 휴차는 아래`
              : '굴린 차가 위, 휴차는 아래'
          }
        >
          {query.isLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {empty && (
            <EmptyState
              icon={<Truck size={24} strokeWidth={1.5} />}
              title="이 날짜의 운행일보가 아직 없습니다"
              description="운행일보는 실적에서 만들어집니다. 실적을 먼저 만들고 확정한 뒤 「다시 만들기」를 누르세요."
              action={
                <Button
                  variant="secondary"
                  loading={rebuild.isPending}
                  loadingLabel="집계하는 중"
                  onClick={() => rebuild.mutate({ from: date, to: date })}
                >
                  지금 만들기
                </Button>
              }
            />
          )}

          {data && data.vehicles.length > 0 && (
            <>
              <ul className="divide-y divide-line-subtle">
                {data.vehicles.map((v) => (
                  <VehicleRow key={v.vehicleId} row={v} />
                ))}
              </ul>
              <div className="border-t border-line-subtle px-4 py-3">
                <DayBandLegend />
              </div>
            </>
          )}
        </Panel>

        {data && data.drivers.length > 0 && <DriversPanel rows={data.drivers} />}
      </div>
    </>
  );
}

function VehicleRow({ row }: { row: VehicleDayRow }) {
  return (
    <li className={cn('px-4 py-3', !row.isOperated && 'bg-surface-sunken/50')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-40 shrink-0">
          <span className="tabular block text-label font-medium text-content-primary">
            {row.vehicleNo}
            {row.hasWorkViolation && (
              <span
                title="이 차의 기사에게 연속운전·휴게 위반이 있습니다"
                className="ml-1.5 inline-flex text-status-danger"
              >
                <AlertTriangle size={12} strokeWidth={2.25} aria-hidden="true" />
                <span className="sr-only">법규 위반</span>
              </span>
            )}
          </span>
          <span className="block truncate text-caption text-content-tertiary">
            {row.vehicleTypeName ?? '—'} · {row.driverName ?? '기사 미배정'}
          </span>
        </span>

        <span className="min-w-[16rem] flex-1">
          <DayBand row={row} />
          <span className="mt-1 flex flex-wrap items-center gap-x-3 text-caption text-content-tertiary">
            {row.isOperated ? (
              <>
                <span className="tabular">
                  {formatTime(row.firstStartAt)}–{formatTime(row.lastEndAt)}
                </span>
                <span>가동 {formatMinutes(row.operatingMinutes)}</span>
                {row.waitingMinutes > 0 && (
                  <span className={cn(row.waitingMinutes >= 60 && 'font-medium text-status-warning')}>
                    대기 {formatMinutes(row.waitingMinutes)}
                  </span>
                )}
              </>
            ) : (
              <span>{row.nonOperationReason ?? '미가동'}</span>
            )}
          </span>
        </span>

        <span className="w-36 shrink-0">
          <LoadedBar loaded={row.loadedDistanceKm} total={row.totalDistanceKm} />
          <span className="tabular mt-1 block text-caption text-content-tertiary">
            {Math.round(row.totalDistanceKm).toLocaleString('ko-KR')} km
          </span>
        </span>

        <span className="tabular w-24 shrink-0 text-right text-caption text-content-secondary">
          <span className="block">{row.tripCount}트립 · {row.orderCount}오더</span>
          <span className="block text-content-tertiary">
            {row.avgLoadingRate === null ? '적재율 —' : `적재율 ${row.avgLoadingRate.toFixed(0)}%`}
          </span>
        </span>

        <span className="tabular w-28 shrink-0 text-right">
          <span className="block text-label text-content-primary">
            {row.profitAmount === null ? '—' : `${Math.round(row.profitAmount / 10_000).toLocaleString('ko-KR')}만`}
          </span>
          <span className="block text-caption text-content-tertiary">
            {row.fuelEfficiency === null ? '연비 —' : `${row.fuelEfficiency.toFixed(1)} km/L`}
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * 기사 근무.
 *
 * 이 표의 목적은 정산이 아니라 **법규**다. 그래서 위반이 맨 위로 오고, 위반이
 * 없으면 표가 조용하다. 연속운전 시간을 숫자로만 적으면 240분이 넘었는지
 * 매번 세야 하므로, 넘긴 줄만 색으로 갈라 둔다.
 */
function DriversPanel({ rows }: { rows: DriverDayRow[] }) {
  return (
    <Panel title="기사 근무" subtitle="연속운전 4시간 · 휴게 30분 기준. 위반이 위에 옵니다">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-left">
          <caption className="sr-only">기사별 근무시간과 법규 준수</caption>
          <thead>
            <tr className="border-b border-line-subtle">
              <th scope="col" className="eyebrow-ko px-4 py-2.5 font-medium text-content-tertiary">
                기사 · 차량
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 font-medium text-content-tertiary">
                근무
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 text-right font-medium text-content-tertiary">
                총 근무
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 text-right font-medium text-content-tertiary">
                주행
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 text-right font-medium text-content-tertiary">
                최장 연속운전
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 text-right font-medium text-content-tertiary">
                휴게
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 text-right font-medium text-content-tertiary">
                야간
              </th>
              <th scope="col" className="eyebrow-ko px-4 py-2.5 font-medium text-content-tertiary">
                판정
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const violated = d.isContinuousViolation || d.isRestViolation;
              return (
                <tr key={d.driverId} className="border-b border-line-subtle last:border-0">
                  <td className="px-4 py-2.5 text-label">
                    <span className="text-content-primary">{d.driverName}</span>
                    <span className="tabular ml-2 text-caption text-content-tertiary">
                      {d.vehicleNo ?? '—'}
                    </span>
                  </td>
                  <td className="tabular px-4 py-2.5 text-label text-content-secondary">
                    {formatTime(d.workStartAt)}–{formatTime(d.workEndAt)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                    {formatMinutes(d.totalWorkMinutes)}
                    {d.overtimeMinutes > 0 && (
                      <span className="ml-1 text-caption text-content-tertiary">
                        (+{formatMinutes(d.overtimeMinutes)})
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-label text-content-secondary">
                    {formatMinutes(d.drivingMinutes)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-label">
                    <span
                      className={cn(
                        d.isContinuousViolation
                          ? 'font-medium text-status-danger'
                          : 'text-content-secondary',
                      )}
                    >
                      {d.maxContinuousDrivingMin === null
                        ? '—'
                        : formatMinutes(d.maxContinuousDrivingMin)}
                    </span>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-label">
                    <span
                      className={cn(
                        d.isRestViolation ? 'font-medium text-status-danger' : 'text-content-secondary',
                      )}
                    >
                      {formatMinutes(d.restMinutes)}
                    </span>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-label text-content-tertiary">
                    {d.nightWorkMinutes === 0 ? '—' : formatMinutes(d.nightWorkMinutes)}
                  </td>
                  <td className="px-4 py-2.5 text-label">
                    {violated ? (
                      <span className="inline-flex items-center gap-1 rounded-sm border border-status-danger/25 bg-status-danger-surface px-1.5 py-px text-caption font-medium text-status-danger">
                        <AlertTriangle size={11} strokeWidth={2.25} aria-hidden="true" />
                        {d.isContinuousViolation ? '연속운전' : '휴게 부족'}
                      </span>
                    ) : (
                      <span className="text-caption text-content-tertiary">준수</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
