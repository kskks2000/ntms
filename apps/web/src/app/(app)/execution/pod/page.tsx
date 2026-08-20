'use client';

import { AlertTriangle, CircleCheck, FileWarning, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import {
  POD_RESULT_LABEL,
  POD_TYPE_LABEL,
  type MissingPodRow,
  type PodPage as PodPageData,
  type PodRow,
} from '@ntms/shared';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, Panel, Skeleton, Stat, StatRow } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { cn } from '@/lib/cn';

/**
 * 인수증(POD).
 *
 * ## 본론은 쌓인 서류가 아니라 빠진 서류다
 *
 * 인수증 화면을 "받은 것 목록"으로 만들면 매일 늘어나는 표가 되고, 아무도
 * 열지 않는다. 실제로 이 화면을 여는 이유는 하나다 — **인수증이 없으면
 * 청구를 못 닫는다.** 끝난 지 오래인데 아직 없는 건이 곧 돈이 묶인 건이다.
 *
 * 그래서 미도착 표가 위에 오고, 경과 시간이 긴 순으로 선다. 막대는 24시간을
 * 한 칸으로 본다 — 하루를 넘긴 것과 세 시간 지난 것은 성격이 다른 일이다.
 */
export default function PodPage() {
  const [from, setFrom] = useState(() => toDateInput(daysAgo(7)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [confirmed, setConfirmed] = useState<string>('');

  const query = useApiQuery<PodPageData>(
    ['execution', 'pods', from, to, confirmed],
    `/execution/pods?from=${from}&to=${to}${confirmed ? `&confirmed=${confirmed}` : ''}`,
  );
  const data = query.data;

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="인수증(POD)"
        description={
          data
            ? `수집률 ${data.summary.collectionRate ?? '—'}% · 미도착 ${data.summary.missing}건`
            : '화물을 받았다는 증거를 모으고 확인합니다.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="시작일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <span className="text-content-tertiary">—</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-label="종료일"
              className="field-text h-10 rounded-md border border-line-field bg-surface-field px-3 text-content-primary"
            />
            <Button
              variant="secondary"
              onClick={() => void query.refetch()}
              loading={query.isFetching}
              loadingLabel="새로 불러오는 중"
              leadingIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              새로고침
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {data && data.summary.missing > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-status-warning/25 bg-status-warning-surface px-3.5 py-3"
          >
            <FileWarning
              size={18}
              strokeWidth={1.75}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-status-warning"
            />
            <p className="text-body text-content-secondary">
              <span className="font-semibold text-status-warning">
                인수증이 아직 없는 오더 {data.summary.missing}건
              </span>{' '}
              — 인수증이 없으면 청구를 닫을 수 없습니다. 오래 묵은 것부터 기사나
              운송사에 요청하세요.
            </p>
          </div>
        )}

        <StatRow>
          <Stat
            label="수집률"
            value={data?.summary.collectionRate ?? '—'}
            unit="%"
            hint="완료 오더 대비"
            tone={(data?.summary.collectionRate ?? 100) < 90 ? 'warning' : 'default'}
          />
          <Stat label="수집" value={data?.summary.collected ?? '—'} unit="건" />
          <Stat
            label="확인 완료"
            value={data?.summary.confirmed ?? '—'}
            unit="건"
            hint="정산에 넘길 수 있는 상태"
          />
          <Stat
            label="이상 인수"
            value={data?.summary.abnormal ?? '—'}
            unit="건"
            tone={(data?.summary.abnormal ?? 0) > 0 ? 'danger' : 'default'}
          />
          <Stat
            label="미도착"
            value={data?.summary.missing ?? '—'}
            unit="건"
            tone={(data?.summary.missing ?? 0) > 0 ? 'warning' : 'default'}
          />
        </StatRow>

        <Panel
          title="아직 안 들어온 인수증"
          subtitle="막대 한 칸은 하루입니다. 오래 묵은 것이 위로 옵니다"
        >
          {query.isLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {data && data.missing.length === 0 && (
            <EmptyState
              icon={<CircleCheck size={24} strokeWidth={1.5} />}
              title="빠진 인수증이 없습니다"
              description="이 기간에 완료된 오더는 모두 인수증이 붙었습니다."
            />
          )}
          {data && data.missing.length > 0 && <MissingTable rows={data.missing} />}
        </Panel>

        <Panel
          title="수집된 인수증"
          subtitle={data ? `${data.rows.length}건` : undefined}
          action={<ConfirmFilter value={confirmed} onChange={setConfirmed} />}
        >
          {query.isLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {query.isError && (
            <EmptyState
              icon={<AlertTriangle size={24} strokeWidth={1.5} />}
              title="인수증을 불러오지 못했습니다"
              description={query.error.payload.message}
              action={
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  다시 시도
                </Button>
              }
            />
          )}

          {data && data.rows.length === 0 && !query.isLoading && (
            <EmptyState
              icon={<ShieldCheck size={24} strokeWidth={1.5} />}
              title="해당하는 인수증이 없습니다"
              description="기간이나 확인 상태를 바꿔 보세요."
            />
          )}

          {data && data.rows.length > 0 && (
            <PodTable rows={data.rows} onDone={() => void query.refetch()} />
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * 미도착 표.
 *
 * 경과 시간을 숫자로만 적으면 "17시간" 과 "63시간" 이 같은 무게로 읽힌다.
 * 하루를 한 칸으로 끊은 막대를 옆에 두면 며칠째인지가 세지 않아도 보인다.
 */
function MissingTable({ rows }: { rows: MissingPodRow[] }) {
  const max = Math.max(...rows.map((r) => r.agingHours ?? 0), 24);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line-subtle">
            <Th>오더</Th>
            <Th>화주</Th>
            <Th>도착지</Th>
            <Th>차량 · 기사</Th>
            <Th>운송사</Th>
            <Th className="w-52">경과</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hours = r.agingHours ?? 0;
            const overdue = hours >= 24;
            return (
              <tr
                key={`${r.executionId}-${r.orderId}`}
                className="border-b border-line-subtle last:border-0"
              >
                <Td>
                  <span className="tabular text-content-primary">{r.orderNo}</span>
                  <span className="tabular ml-2 text-caption text-content-tertiary">
                    {r.tripNo}
                  </span>
                </Td>
                <Td>{r.shipperName}</Td>
                <Td>{r.toLocationName}</Td>
                <Td>
                  <span className="tabular">{r.vehicleNo ?? '—'}</span>
                  <span className="ml-2 text-content-tertiary">{r.driverName ?? ''}</span>
                </Td>
                <Td>{r.carrierName}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <AgingBar hours={hours} max={max} />
                    <span
                      className={cn(
                        'tabular shrink-0 text-caption',
                        overdue ? 'font-medium text-status-danger' : 'text-content-secondary',
                      )}
                    >
                      {formatAging(r.agingHours)}
                    </span>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 하루를 한 칸으로. 칸 경계가 보여야 "이틀째" 가 세지 않고 읽힌다 */
function AgingBar({ hours, max }: { hours: number; max: number }) {
  const days = Math.max(1, Math.ceil(max / 24));
  const pct = Math.min(100, (hours / (days * 24)) * 100);

  return (
    <div
      className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-sunken"
      role="img"
      aria-label={`${formatAging(hours)} 경과`}
    >
      <div
        className={cn(
          'h-full rounded-full',
          hours >= 48 ? 'bg-status-danger' : hours >= 24 ? 'bg-status-warning' : 'bg-accent/60',
        )}
        style={{ width: `${pct}%` }}
      />
      {Array.from({ length: days - 1 }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-surface-card"
          style={{ left: `${((i + 1) / days) * 100}%` }}
        />
      ))}
    </div>
  );
}

function PodTable({ rows, onDone }: { rows: PodRow[]; onDone: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line-subtle">
            <Th>인수증</Th>
            <Th>오더 · 화주</Th>
            <Th>도착지</Th>
            <Th>인수인</Th>
            <Th>인수 시각</Th>
            <Th>결과</Th>
            <Th className="text-right">확인</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PodTableRow key={r.podId} row={r} onDone={onDone} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PodTableRow({ row, onDone }: { row: PodRow; onDone: () => void }) {
  const toast = useToast();
  const confirm = useApiMutation<{ podId: string }, { confirm: boolean; disputeReason: string | null }>(
    () => ({ path: `/execution/pods/${row.podId}/confirm`, method: 'PATCH' }),
    {
      invalidate: [['execution']],
      onSuccess: (_r, body) => {
        toast.success(
          body.confirm ? '인수증을 확인했습니다' : '확인을 되돌렸습니다',
          body.confirm ? '정산에 넘길 수 있습니다.' : `사유 · ${body.disputeReason}`,
        );
        onDone();
      },
    },
  );

  const abnormal = row.podResult !== 'NORMAL';

  return (
    <tr className="border-b border-line-subtle last:border-0">
      <Td>
        <span className="tabular text-content-primary">{row.podNo ?? '—'}</span>
        <span className="ml-2 text-caption text-content-tertiary">
          {POD_TYPE_LABEL[row.podType] ?? row.podType}
        </span>
        {/* 지오펜스 검증은 "정말 그 자리에서 받았나" 에 대한 유일한 기계
            증거다. 분쟁이 나면 이 표시가 근거가 되므로 조용히 숨기지 않는다 */}
        {row.isGeofenceVerified && (
          <span
            className="ml-1.5 inline-flex items-center text-status-success"
            title="도착지 반경 안에서 받았습니다"
          >
            <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">위치 검증됨</span>
          </span>
        )}
      </Td>
      <Td>
        <span className="tabular text-content-primary">{row.orderNo}</span>
        <span className="ml-2 text-content-tertiary">{row.shipperName}</span>
      </Td>
      <Td>{row.toLocationName}</Td>
      <Td>{row.receiverName ?? '—'}</Td>
      <Td className="tabular">{formatDateTime(row.deliveredAt)}</Td>
      <Td>
        <span className={cn(abnormal ? 'font-medium text-status-danger' : 'text-content-secondary')}>
          {POD_RESULT_LABEL[row.podResult] ?? row.podResult}
        </span>
        {row.abnormalReason && (
          <span className="ml-1.5 text-caption text-content-tertiary">{row.abnormalReason}</span>
        )}
      </Td>
      <Td className="text-right">
        {row.isConfirmed ? (
          <button
            type="button"
            disabled={confirm.isPending}
            onClick={() => {
              const reason = window.prompt('확인을 되돌리는 사유를 적어주세요');
              if (!reason?.trim()) return;
              confirm.mutate({ confirm: false, disputeReason: reason.trim() });
            }}
            className="tabular text-caption text-content-tertiary hover:text-content-primary hover:underline"
          >
            {/* 확인 시각이 없으면 인수 시각으로 때우지 않는다. 둘은 다른
                시각이고, 대신 채워 넣으면 "언제 확인했나" 를 영영 못 묻는다 */}
            확인{row.confirmedAt ? ` ${formatDateTime(row.confirmedAt)}` : ''} · 되돌리기
          </button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            loading={confirm.isPending}
            loadingLabel="확인하는 중"
            onClick={() => confirm.mutate({ confirm: true, disputeReason: null })}
          >
            확인
          </Button>
        )}
      </Td>
    </tr>
  );
}

function ConfirmFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [
    { key: '', label: '전체' },
    { key: 'N', label: '미확인' },
    { key: 'Y', label: '확인' },
  ];
  return (
    <div role="group" aria-label="확인 상태" className="flex rounded-md border border-line-field p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-[3px] px-2.5 py-1 text-caption transition-colors duration-fast',
            value === o.key
              ? 'bg-action text-action-text'
              : 'text-content-secondary hover:text-content-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn('eyebrow-ko px-4 py-2.5 font-medium text-content-tertiary', className)}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-2.5 text-label text-content-secondary', className)}>{children}</td>;
}

function formatAging(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours}시간`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h === 0 ? `${d}일` : `${d}일 ${h}시간`;
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
