'use client';

import {
  ArrowLeft,
  Ban,
  Pencil,
  ThermometerSnowflake,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CHANGE_SOURCE_LABEL,
  FREIGHT_TERMS_LABEL,
  ORDER_PRIORITY_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_PHASE,
  ORDER_TYPE_FORM_LABEL,
  TEMPERATURE_ZONE_LABEL,
  type OrderDetail,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState, Panel, Stat, StatRow } from '@/components/tms/panels';
import { StatusChip } from '@/components/tms/status-chip';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { TimeSpine } from '@/components/order/time-spine';
import { cn } from '@/lib/cn';

/**
 * 오더 상세.
 *
 * 등록 화면이 "이 오더가 성립하는가" 를 묻는다면, 상세는 **"지금 어디까지
 * 왔나"** 에 답한다. 그래서 같은 시간 축을 쓰되 읽기 전용으로 두고, 대신
 * 상태 이력과 편성된 트립을 함께 놓는다.
 *
 * 배차실에서 이 화면을 여는 이유는 대개 하나다 — 화주가 전화해서 "그 건
 * 어떻게 됐냐" 고 물었을 때. 그 질문에 스크롤 없이 답할 수 있어야 한다.
 */
export function OrderDetailView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const query = useApiQuery<OrderDetail>(['order-detail', orderId], `/orders/${orderId}`, {
    staleTime: 0,
  });
  const o = query.data;

  const cancel = useApiMutation<{ id: string }, { reason: string }>(
    () => ({ path: `/orders/${orderId}/cancel`, method: 'POST' }),
    {
      invalidate: [['orders'], ['order-detail']],
      onSuccess: () => {
        toast.success('오더를 취소했습니다');
        setCancelling(false);
        setReason('');
      },
    },
  );

  if (query.isLoading) {
    return (
      <div className="px-6 py-16 text-center text-content-tertiary">불러오는 중…</div>
    );
  }
  if (!o) {
    return (
      <div className="px-6 py-6">
        <Panel>
          <EmptyState
            icon={<Ban size={26} strokeWidth={1.5} />}
            title="오더를 찾을 수 없습니다"
            description="삭제됐거나 접근 권한이 없습니다."
            action={
              <Link
                href="/plan/orders"
                className="inline-flex h-10 items-center rounded-md border border-line-field bg-surface-card px-4 text-body font-medium"
              >
                오더 목록
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  // 편성된 뒤로는 내용을 바꿀 수 없다. 서버도 같은 규칙을 건다.
  const editable = o.status === 'RECEIVED' || o.status === 'CONFIRMED';

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title={o.orderNo}
        description={`${o.shipperName} · ${ORDER_TYPE_FORM_LABEL[o.orderType] ?? o.orderType}`}
        actions={
          <>
            <Link
              href="/plan/orders"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line-field bg-surface-card px-4 text-body font-medium text-content-primary transition-colors hover:bg-surface-sunken"
            >
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              목록
            </Link>
            {editable && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setCancelling(true)}
                  className="text-status-danger hover:bg-status-danger-surface hover:text-status-danger"
                  leadingIcon={<Ban size={15} strokeWidth={1.75} aria-hidden="true" />}
                >
                  오더 취소
                </Button>
                <Button
                  onClick={() => router.push(`/plan/orders/${orderId}/edit`)}
                  leadingIcon={<Pencil size={15} strokeWidth={1.75} aria-hidden="true" />}
                >
                  수정
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="space-y-5 px-6 py-6">
        {/* 취소 확인 — 별도 창을 띄우지 않고 화면 안에서 묻는다 */}
        {cancelling && (
          <Panel className="border-status-danger/30">
            <div className="flex flex-wrap items-end gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <TextField
                  label="취소 사유"
                  required
                  placeholder="화주 요청으로 취소 · 물량 없음 …"
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                  hint="이력에 남아 나중에 왜 취소됐는지 답할 수 있습니다"
                />
              </div>
              <Button variant="secondary" onClick={() => setCancelling(false)}>
                그만두기
              </Button>
              <Button
                variant="danger"
                loading={cancel.isPending}
                loadingLabel="취소하는 중"
                onClick={() => {
                  if (!reason.trim()) {
                    toast.danger('취소 사유를 입력하세요');
                    return;
                  }
                  cancel.mutateAsync({ reason: reason.trim() }).catch((err: unknown) => {
                    toast.danger(
                      '취소하지 못했습니다',
                      err instanceof ApiRequestError ? err.message : undefined,
                    );
                  });
                }}
              >
                오더 취소
              </Button>
            </div>
          </Panel>
        )}

        {/* 상태 · 물량 한 줄 */}
        <StatRow>
          <div className="min-w-0 px-4 py-3.5">
            <p className="truncate text-caption text-content-tertiary">상태</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusChip
                label={ORDER_STATUS_LABEL[o.status] ?? o.status}
                phase={ORDER_STATUS_PHASE[o.status] ?? 'planned'}
              />
              {o.isTimeCritical && (
                <span className="rounded-sm bg-status-warning-surface px-1.5 py-0.5 text-caption text-status-warning">
                  시간엄수
                </span>
              )}
              {o.isExclusive && (
                <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-caption text-content-secondary">
                  독차
                </span>
              )}
              {o.isHazardous && (
                <span className="rounded-sm bg-status-danger-surface px-1.5 py-0.5 text-caption text-status-danger">
                  위험물
                </span>
              )}
            </p>
          </div>
          <Stat
            label="중량"
            value={o.totalWeightKg.toLocaleString('ko-KR')}
            unit="kg"
            hint={`${o.items.length}개 품목`}
          />
          <Stat
            label="부피 · 파렛트"
            value={o.totalVolumeCbm.toLocaleString('ko-KR')}
            unit="CBM"
            hint={o.totalPalletQty > 0 ? `${o.totalPalletQty} PLT` : undefined}
          />
          <Stat
            label="거리"
            value={o.distanceKm === null ? '—' : o.distanceKm.toLocaleString('ko-KR')}
            unit="km"
          />
          <Stat
            label="예상 운임"
            value={
              o.estimatedAmount === null ? '—' : o.estimatedAmount.toLocaleString('ko-KR')
            }
            unit="원"
          />
        </StatRow>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0 space-y-5">
            {/* 구간 */}
            <Panel title="구간">
              <div className="grid gap-0 sm:grid-cols-2">
                <StopBlock
                  label="상차지"
                  name={o.fromLocationName}
                  address={[o.fromAddress1, o.fromAddress2].filter(Boolean).join(' ')}
                  contactName={o.fromContactName}
                  contactTel={o.fromContactTel}
                  date={o.pickupDate}
                  from={o.pickupTimeFrom}
                  to={o.pickupTimeTo}
                />
                <StopBlock
                  label="하차지"
                  name={o.toLocationName}
                  address={[o.toAddress1, o.toAddress2].filter(Boolean).join(' ')}
                  contactName={o.toContactName}
                  contactTel={o.toContactTel}
                  date={o.deliveryDate}
                  from={o.deliveryTimeFrom}
                  to={o.deliveryTimeTo}
                  bordered
                />
              </div>
            </Panel>

            {/* 품목 */}
            <Panel title="품목" subtitle={`${o.items.length}건`} bodyClassName="overflow-x-auto">
              {o.items.length === 0 ? (
                <p className="px-4 py-8 text-center text-caption text-content-tertiary">
                  품목이 없습니다
                </p>
              ) : (
                <table className="w-full border-collapse text-label">
                  <thead>
                    <tr className="border-b border-line-subtle text-caption text-content-tertiary">
                      <th scope="col" className="w-8 px-3 py-2 text-left font-medium">
                        #
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        품명
                      </th>
                      <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                        수량
                      </th>
                      <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                        중량 kg
                      </th>
                      <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                        부피 CBM
                      </th>
                      <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
                        파렛트
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((it) => (
                      <tr key={it.lineNo} className="border-b border-line-subtle last:border-0">
                        <td className="tabular px-3 py-2 text-caption text-content-tertiary">
                          {it.lineNo}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-content-primary">{it.itemName}</span>
                            {it.itemCode && (
                              <span className="tabular truncate text-caption text-content-tertiary">
                                {it.itemCode}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {it.qty.toLocaleString('ko-KR')}
                          <span className="ml-1 text-caption text-content-tertiary">
                            {it.uomCode}
                          </span>
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {it.weightKg.toLocaleString('ko-KR')}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {it.volumeCbm.toLocaleString('ko-KR')}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {it.palletQty === null ? '—' : it.palletQty.toLocaleString('ko-KR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            {/* 편성 */}
            <Panel title="편성" subtitle="이 오더를 실은 트립">
              {o.trips.length === 0 ? (
                <p className="px-4 py-8 text-center text-caption text-content-tertiary">
                  아직 편성되지 않았습니다. 운송계획 · 편성에서 트립에 묶입니다.
                </p>
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {o.trips.map((t) => (
                    <li key={t.tripId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Truck
                        size={15}
                        strokeWidth={1.75}
                        aria-hidden="true"
                        className="shrink-0 text-content-tertiary"
                      />
                      <span className="tabular text-label font-medium text-content-primary">
                        {t.tripNo}
                      </span>
                      <span className="text-caption text-content-secondary">{t.status}</span>
                      {t.vehicleNo && (
                        <span className="tabular text-caption text-content-secondary">
                          {t.vehicleNo}
                        </span>
                      )}
                      {t.driverName && (
                        <span className="text-caption text-content-secondary">
                          {t.driverName}
                        </span>
                      )}
                      {t.carrierName && (
                        <span className="ml-auto text-caption text-content-tertiary">
                          {t.carrierName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* 오른쪽 — 시간 축 · 조건 · 이력 */}
          <aside className="min-w-0 space-y-4">
            <Panel title="시간 축">
              <div className="px-4 py-4">
                <TimeSpine
                  compact
                  input={{
                    pickupDate: o.pickupDate,
                    pickupFrom: o.pickupTimeFrom,
                    pickupTo: o.pickupTimeTo,
                    deliveryDate: o.deliveryDate,
                    deliveryFrom: o.deliveryTimeFrom,
                    deliveryTo: o.deliveryTimeTo,
                    transitMinutes: o.transitMinutes,
                  }}
                />
              </div>
            </Panel>

            <Panel title="운송 조건">
              <dl className="divide-y divide-line-subtle">
                <Row label="온도대">
                  <span className="flex items-center gap-1.5">
                    {o.temperatureZone !== 'AMBIENT' && (
                      <ThermometerSnowflake
                        size={13}
                        strokeWidth={1.75}
                        aria-hidden="true"
                        className="text-content-accent"
                      />
                    )}
                    {TEMPERATURE_ZONE_LABEL[o.temperatureZone] ?? o.temperatureZone}
                  </span>
                </Row>
                <Row label="요구 차종">
                  {o.requiredVehicleTypeName ?? (
                    <span className="text-content-tertiary">편성이 고름</span>
                  )}
                </Row>
                <Row label="운임 조건">
                  {FREIGHT_TERMS_LABEL[o.freightTerms] ?? o.freightTerms}
                </Row>
                <Row label="중요도">{ORDER_PRIORITY_LABEL[o.priority] ?? o.priority}</Row>
                {o.consigneeName && <Row label="수하처">{o.consigneeName}</Row>}
                {o.externalOrderNo && (
                  <Row label="화주 참조">
                    <span className="tabular">{o.externalOrderNo}</span>
                  </Row>
                )}
                {o.referenceNo1 && (
                  <Row label="관리번호">
                    <span className="tabular">{o.referenceNo1}</span>
                  </Row>
                )}
              </dl>
              {(o.specialInstruction || o.remark) && (
                <div className="space-y-2 border-t border-line-subtle px-4 py-3">
                  {o.specialInstruction && (
                    <p className="text-caption text-content-secondary">
                      <span className="text-content-tertiary">특기사항 </span>
                      {o.specialInstruction}
                    </p>
                  )}
                  {o.remark && (
                    <p className="text-caption text-content-secondary">
                      <span className="text-content-tertiary">비고 </span>
                      {o.remark}
                    </p>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="이력" subtitle="상태가 언제 왜 바뀌었나">
              {o.history.length === 0 ? (
                <p className="px-4 py-6 text-center text-caption text-content-tertiary">
                  이력이 없습니다
                </p>
              ) : (
                <ol className="px-4 py-3">
                  {o.history.map((h, i) => (
                    <li key={h.seqNo} className="relative flex gap-3 pb-3 last:pb-0">
                      {/* 이력은 시간 순서가 정보다. 세로 선으로 그 순서를 잇는다 */}
                      {i < o.history.length - 1 && (
                        <span
                          aria-hidden="true"
                          className="absolute left-[3px] top-3 h-full w-px bg-line-subtle"
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className={cn(
                          'relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full',
                          i === o.history.length - 1
                            ? 'bg-content-accent'
                            : 'bg-line-strong',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-1.5">
                          <span className="text-label text-content-primary">
                            {ORDER_STATUS_LABEL[h.toStatus as never] ?? h.toStatus}
                          </span>
                          <span className="tabular text-caption text-content-tertiary">
                            {formatStamp(h.changedAt)}
                          </span>
                          {h.changeSource && (
                            <span className="text-caption text-content-tertiary">
                              {CHANGE_SOURCE_LABEL[h.changeSource] ?? h.changeSource}
                            </span>
                          )}
                        </span>
                        {h.reason && (
                          <span className="mt-0.5 block text-caption text-content-secondary">
                            {h.reason}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </aside>
        </div>
      </div>
    </>
  );
}

function StopBlock({
  label,
  name,
  address,
  contactName,
  contactTel,
  date,
  from,
  to,
  bordered,
}: {
  label: string;
  name: string;
  address: string;
  contactName: string | null;
  contactTel: string | null;
  date: string | null;
  from: string | null;
  to: string | null;
  bordered?: boolean;
}) {
  return (
    <div className={cn('px-4 py-4', bordered && 'sm:border-l sm:border-line-subtle')}>
      <p className="eyebrow-ko text-content-tertiary">{label}</p>
      <p className="mt-1.5 text-lead font-medium text-content-primary">{name}</p>
      <p className="mt-0.5 text-caption text-content-secondary">{address}</p>

      <p className="tabular mt-3 text-label text-content-primary">
        {date ?? <span className="text-content-tertiary">일자 미정</span>}
        {from && (
          <span className="ml-2 text-content-secondary">
            {from}–{to ?? ''}
          </span>
        )}
      </p>

      {(contactName || contactTel) && (
        <p className="mt-1.5 text-caption text-content-tertiary">
          {contactName}
          {contactName && contactTel && ' · '}
          <span className="tabular">{contactTel}</span>
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <dt className="w-20 shrink-0 text-caption text-content-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 text-label text-content-primary">{children}</dd>
    </div>
  );
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
