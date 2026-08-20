'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  FREIGHT_TERMS_LABEL,
  ORDER_PRIORITY_LABEL,
  ORDER_TYPE_FORM_LABEL,
  TEMPERATURE_ZONE_LABEL,
  orderFormSchema,
  type MasterOptions,
  type OrderDetail,
  type OrderFormInput,
  type VehicleCapacity,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { PageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/tms/panels';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { TextareaField } from '@/components/ui/textarea-field';
import { useToast } from '@/components/ui/toast';
import { LoadVerdict } from '@/components/order/load-verdict';
import { TimeSpine } from '@/components/order/time-spine';
import { cn } from '@/lib/cn';

/**
 * 오더 등록 · 수정.
 *
 * ## 마법사(wizard)를 쓰지 않은 이유
 *
 * 접수 담당자는 하루에 수십 건을 친다. 단계를 나누면 건마다 클릭이 늘고,
 * 무엇보다 **뒤 단계의 값이 앞 단계 판단을 바꾸는** 경우가 많다 — 품목
 * 중량을 넣고 나서야 요구 차종이 틀렸다는 걸 안다. 전부 한 화면에 두고
 * Tab 으로 훑을 수 있어야 한다.
 *
 * ## 왼쪽은 입력, 오른쪽은 검산
 *
 * 오른쪽 판은 따라다니며(sticky) 지금 친 값이 **성립하는지**를 계속
 * 답한다. 저장 버튼을 누른 뒤에 알려 주는 것과, 치는 동안 알려 주는 것은
 * 같은 정보라도 값이 다르다.
 */
const BLANK: OrderFormInput = {
  orderType: 'DELIVERY',
  orderDate: new Date().toISOString().slice(0, 10),
  externalOrderNo: '',
  shipperId: '',
  consigneeId: '',
  fromLocationId: '',
  fromLocationName: '',
  fromAddress1: '',
  fromAddress2: '',
  fromContactName: '',
  fromContactTel: '',
  toLocationId: '',
  toLocationName: '',
  toAddress1: '',
  toAddress2: '',
  toContactName: '',
  toContactTel: '',
  pickupDate: '',
  pickupTimeFrom: '',
  pickupTimeTo: '',
  deliveryDate: '',
  deliveryTimeFrom: '',
  deliveryTimeTo: '',
  isTimeCritical: false,
  requiredVehicleTypeId: '',
  temperatureZone: 'AMBIENT',
  isHazardous: false,
  isExclusive: false,
  freightTerms: 'CREDIT',
  priority: 'NORMAL',
  referenceNo1: '',
  specialInstruction: '',
  remark: '',
  items: [{ itemName: '', itemCode: '', qty: '1', uomCode: 'EA', weightKg: '', volumeCbm: '', palletQty: '', remark: '' }],
};

export function OrderForm({ orderId }: { orderId?: string }) {
  const isEdit = Boolean(orderId);
  const router = useRouter();
  const toast = useToast();

  const options = useApiQuery<MasterOptions>(['master-options'], '/master/options', {
    staleTime: 5 * 60_000,
  });
  const capacities = useApiQuery<VehicleCapacity[]>(
    ['vehicle-capacities'],
    '/orders/vehicle-capacities',
    { staleTime: 5 * 60_000 },
  );
  const detail = useApiQuery<OrderDetail>(
    ['order-detail', orderId ?? ''],
    `/orders/${orderId ?? ''}`,
    { enabled: isEdit, staleTime: 0, gcTime: 0 },
  );

  const form = useForm<OrderFormInput>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: BLANK,
    mode: 'onBlur',
  });
  const { register, control, watch, setValue, reset, handleSubmit, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const e = formState.errors;

  // 선택 목록이 온 뒤에 채운다 — <select> 는 목록에 없는 값을 담지 못한다
  const detailData = detail.data;
  const optionsData = options.data;
  useEffect(() => {
    if (!optionsData || !isEdit || !detailData) return;
    reset({
      ...BLANK,
      ...Object.fromEntries(
        Object.entries(detailData).map(([k, v]) => [k, v === null ? '' : v]),
      ),
      items:
        detailData.items.length > 0
          ? detailData.items.map((i) => ({
              itemName: i.itemName,
              itemCode: i.itemCode ?? '',
              qty: String(i.qty),
              uomCode: i.uomCode ?? 'EA',
              weightKg: String(i.weightKg),
              volumeCbm: String(i.volumeCbm),
              palletQty: i.palletQty === null ? '' : String(i.palletQty),
              remark: i.remark ?? '',
            }))
          : BLANK.items,
    } as OrderFormInput);
  }, [optionsData, detailData, isEdit, reset]);

  const save = useApiMutation<{ id: string; orderNo: string | null }, OrderFormInput>(
    () => ({ path: isEdit ? `/orders/${orderId}` : '/orders', method: isEdit ? 'PATCH' : 'POST' }),
    {
      invalidate: [['orders'], ['order-detail']],
      onSuccess: (r) => {
        toast.success(
          isEdit ? '오더를 저장했습니다' : `오더를 등록했습니다`,
          r.orderNo ? `오더번호 ${r.orderNo}` : undefined,
        );
        router.push(`/plan/orders/${r.id}`);
      },
    },
  );

  // --- 검산에 쓰는 값 ------------------------------------------------
  /*
    필드 배열은 useWatch 로 본다.

    useForm().watch('items') 는 스칼라 칸에서는 잘 도는데 useFieldArray 가
    관리하는 배열에서는 처음 값에 머문다 — 품목 중량을 쳐도 합계와 적재
    판정이 0 인 채로 남는 증상이 이것이었다. 배열은 fieldArray 가 따로
    들고 있어서, 그쪽을 직접 구독해야 한다.
  */
  const items = useWatch({ control, name: 'items' });
  const load = useMemo(() => {
    const n = (v: unknown) => {
      const x = Number(String(v ?? '').replace(/,/g, ''));
      return Number.isFinite(x) ? x : 0;
    };
    return (items ?? []).reduce(
      (acc, it) => ({
        weightKg: acc.weightKg + n(it?.weightKg),
        volumeCbm: acc.volumeCbm + n(it?.volumeCbm),
        palletQty: acc.palletQty + n(it?.palletQty),
        qty: acc.qty + n(it?.qty),
      }),
      { weightKg: 0, volumeCbm: 0, palletQty: 0, qty: 0 },
    );
  }, [items]);

  const fromLocationId = watch('fromLocationId');
  const toLocationId = watch('toLocationId');
  const temperatureZone = watch('temperatureZone');
  const requiredVehicleTypeId = watch('requiredVehicleTypeId');

  // 구간 소요시간은 라우트 마스터가 안다. 거점을 둘 다 고른 뒤에만 묻는다.
  const route = useApiQuery<{ distanceKm: number | null; durationMinutes: number | null }>(
    ['order-route', fromLocationId ?? '', toLocationId ?? ''],
    `/orders/route?from=${fromLocationId ?? ''}&to=${toLocationId ?? ''}`,
    { enabled: Boolean(fromLocationId && toLocationId), staleTime: 5 * 60_000 },
  );

  const spine = {
    pickupDate: emptyToNull(watch('pickupDate')),
    pickupFrom: emptyToNull(watch('pickupTimeFrom')),
    pickupTo: emptyToNull(watch('pickupTimeTo')),
    deliveryDate: emptyToNull(watch('deliveryDate')),
    deliveryFrom: emptyToNull(watch('deliveryTimeFrom')),
    deliveryTo: emptyToNull(watch('deliveryTimeTo')),
    transitMinutes: route.data?.durationMinutes ?? null,
  };

  /** 거점을 고르면 이름·주소를 그대로 끌어온다. 두 번 치게 하지 않는다 */
  const applyLocation = (side: 'from' | 'to', locationId: string) => {
    const loc = (optionsData?.locations ?? []).find((l) => l.id === locationId);
    if (!loc) return;
    setValue(`${side}LocationName`, loc.name, { shouldValidate: true });
    // 주소는 목록에 없으므로 이름만 채우고 주소는 사용자가 확인하게 둔다.
    // (거점 상세를 또 부르면 고를 때마다 요청이 난다)
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      if (!(error instanceof ApiRequestError)) {
        toast.danger('저장하지 못했습니다', '잠시 후 다시 시도해 주세요.');
        return;
      }
      let attached = false;
      for (const [name, messages] of Object.entries(error.fields ?? {})) {
        const message = messages[0];
        if (!message) continue;
        form.setError(name as never, { type: 'server', message });
        attached = true;
      }
      if (!attached) toast.danger('저장하지 못했습니다', error.message);
    }
  });

  const shipperOptions = (optionsData?.shippers ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    note: s.code,
  }));
  const consigneeOptions = (optionsData?.partners ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    note: s.code,
  }));
  const locationOptions = (optionsData?.locations ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    note: l.group ?? l.code,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Plan"
        title={isEdit ? '오더 수정' : '오더 등록'}
        description={
          isEdit
            ? '편성 전까지는 내용을 고칠 수 있습니다.'
            : '화주 요청 한 건을 편성할 수 있는 오더로 만듭니다.'
        }
        actions={
          <Link
            href={isEdit ? `/plan/orders/${orderId}` : '/plan/orders'}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line-field bg-surface-card px-4 text-body font-medium text-content-primary transition-colors hover:bg-surface-sunken"
          >
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            {isEdit ? '상세로' : '오더 목록'}
          </Link>
        }
      />

      <form onSubmit={onSubmit} noValidate className="px-6 py-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          {/* ================= 왼쪽 · 입력 ================= */}
          <div className="min-w-0 space-y-5">
            <Panel title="기본">
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
                <SelectField
                  label="오더 유형"
                  options={Object.entries(ORDER_TYPE_FORM_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  error={e.orderType?.message}
                  {...register('orderType')}
                />
                <TextField
                  label="오더일"
                  type="date"
                  required
                  error={e.orderDate?.message}
                  {...register('orderDate')}
                />
                <TextField
                  label="화주 참조번호"
                  hint="화주 쪽 전표번호"
                  error={e.externalOrderNo?.message}
                  {...register('externalOrderNo')}
                />
                <SelectField
                  label="화주"
                  required
                  placeholder="고르세요"
                  options={shipperOptions}
                  error={e.shipperId?.message}
                  {...register('shipperId')}
                />
                <SelectField
                  label="수하처"
                  placeholder="지정 안 함"
                  options={consigneeOptions}
                  error={e.consigneeId?.message}
                  {...register('consigneeId')}
                />
                <SelectField
                  label="중요도"
                  options={Object.entries(ORDER_PRIORITY_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  error={e.priority?.message}
                  {...register('priority')}
                />
              </div>
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              <StopPanel
                side="from"
                title="상차지"
                subtitle="짐을 싣는 곳"
                locationOptions={locationOptions}
                register={register}
                errors={{
                  locationId: e.fromLocationId?.message,
                  name: e.fromLocationName?.message,
                  address1: e.fromAddress1?.message,
                  address2: e.fromAddress2?.message,
                  contactName: e.fromContactName?.message,
                  contactTel: e.fromContactTel?.message,
                }}
                onLocationChange={(id) => applyLocation('from', id)}
              />
              <StopPanel
                side="to"
                title="하차지"
                subtitle="짐을 내리는 곳"
                locationOptions={locationOptions}
                register={register}
                errors={{
                  locationId: e.toLocationId?.message,
                  name: e.toLocationName?.message,
                  address1: e.toAddress1?.message,
                  address2: e.toAddress2?.message,
                  contactName: e.toContactName?.message,
                  contactTel: e.toContactTel?.message,
                }}
                onLocationChange={(id) => applyLocation('to', id)}
              />
            </div>

            <Panel
              title="일정"
              subtitle="시간창은 오른쪽 시간 축에서 성립 여부를 바로 확인할 수 있습니다"
            >
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
                <fieldset className="min-w-0">
                  <legend className="mb-2 text-label font-semibold text-content-primary">
                    상차
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField
                      label="날짜"
                      type="date"
                      error={e.pickupDate?.message}
                      {...register('pickupDate')}
                    />
                    <TextField
                      label="시작"
                      type="time"
                      error={e.pickupTimeFrom?.message}
                      {...register('pickupTimeFrom')}
                    />
                    <TextField
                      label="마감"
                      type="time"
                      error={e.pickupTimeTo?.message}
                      {...register('pickupTimeTo')}
                    />
                  </div>
                </fieldset>

                <fieldset className="min-w-0">
                  <legend className="mb-2 text-label font-semibold text-content-primary">
                    하차
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField
                      label="날짜"
                      type="date"
                      error={e.deliveryDate?.message}
                      {...register('deliveryDate')}
                    />
                    <TextField
                      label="시작"
                      type="time"
                      error={e.deliveryTimeFrom?.message}
                      {...register('deliveryTimeFrom')}
                    />
                    <TextField
                      label="마감"
                      type="time"
                      error={e.deliveryTimeTo?.message}
                      {...register('deliveryTimeTo')}
                    />
                  </div>
                </fieldset>

                <div className="sm:col-span-2">
                  <Checkbox
                    label="시간 엄수"
                    description="이 시간창을 못 지키면 화주와 합의가 필요한 건입니다"
                    {...register('isTimeCritical')}
                  />
                </div>
              </div>
            </Panel>

            <Panel
              title="품목"
              subtitle="여기 합계가 오더의 총 물량이 됩니다"
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    append({
                      itemName: '',
                      itemCode: '',
                      qty: '1',
                      uomCode: 'EA',
                      weightKg: '',
                      volumeCbm: '',
                      palletQty: '',
                      remark: '',
                    } as never)
                  }
                  leadingIcon={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
                >
                  품목 추가
                </Button>
              }
              bodyClassName="overflow-x-auto"
            >
              <table className="w-full border-collapse text-label">
                <thead>
                  <tr className="border-b border-line-subtle text-caption text-content-tertiary">
                    <th scope="col" className="w-8 px-2 py-2 text-left font-medium">
                      #
                    </th>
                    <th scope="col" className="px-2 py-2 text-left font-medium">
                      품명
                    </th>
                    <th scope="col" className="w-24 px-2 py-2 text-left font-medium">
                      품목코드
                    </th>
                    <th scope="col" className="w-20 px-2 py-2 text-right font-medium">
                      수량
                    </th>
                    <th scope="col" className="w-16 px-2 py-2 text-left font-medium">
                      단위
                    </th>
                    <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                      중량 kg
                    </th>
                    <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                      부피 CBM
                    </th>
                    <th scope="col" className="w-20 px-2 py-2 text-right font-medium">
                      파렛트
                    </th>
                    <th scope="col" className="w-10 px-2 py-2">
                      <span className="sr-only">줄 삭제</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, i) => (
                    <tr key={field.id} className="border-b border-line-subtle last:border-0">
                      <td className="tabular px-2 py-1.5 text-caption text-content-tertiary">
                        {i + 1}
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          {...register(`items.${i}.itemName` as const)}
                          aria-label={`${i + 1}번째 품명`}
                          error={e.items?.[i]?.itemName?.message}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          {...register(`items.${i}.itemCode` as const)}
                          aria-label={`${i + 1}번째 품목코드`}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          numeric
                          inputMode="decimal"
                          {...register(`items.${i}.qty` as const)}
                          aria-label={`${i + 1}번째 수량`}
                          error={e.items?.[i]?.qty?.message}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          {...register(`items.${i}.uomCode` as const)}
                          aria-label={`${i + 1}번째 단위`}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          numeric
                          inputMode="decimal"
                          {...register(`items.${i}.weightKg` as const)}
                          aria-label={`${i + 1}번째 중량`}
                          error={e.items?.[i]?.weightKg?.message}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          numeric
                          inputMode="decimal"
                          {...register(`items.${i}.volumeCbm` as const)}
                          aria-label={`${i + 1}번째 부피`}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <Cell
                          numeric
                          inputMode="decimal"
                          {...register(`items.${i}.palletQty` as const)}
                          aria-label={`${i + 1}번째 파렛트`}
                        />
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <button
                          type="button"
                          aria-label={`${i + 1}번째 품목 삭제`}
                          disabled={fields.length === 1}
                          onClick={() => remove(i)}
                          className="rounded p-1.5 text-content-tertiary transition-colors hover:bg-status-danger-surface hover:text-status-danger disabled:opacity-30"
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong bg-surface-sunken/60 text-caption">
                    <td />
                    <td className="px-2 py-2 font-medium text-content-secondary">합계</td>
                    <td />
                    <td className="tabular px-2 py-2 text-right">
                      {load.qty.toLocaleString('ko-KR')}
                    </td>
                    <td />
                    <td className="tabular px-2 py-2 text-right font-medium">
                      {load.weightKg.toLocaleString('ko-KR')}
                    </td>
                    <td className="tabular px-2 py-2 text-right">
                      {load.volumeCbm.toLocaleString('ko-KR')}
                    </td>
                    <td className="tabular px-2 py-2 text-right">
                      {load.palletQty.toLocaleString('ko-KR')}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              {typeof e.items?.message === 'string' && (
                <p role="alert" className="px-4 py-2 text-caption text-status-danger">
                  {e.items.message}
                </p>
              )}
            </Panel>

            <Panel title="운송 조건">
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
                <SelectField
                  label="온도대"
                  options={Object.entries(TEMPERATURE_ZONE_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  hint="냉동 화물을 상온으로 두면 차종이 잘못 잡힙니다"
                  error={e.temperatureZone?.message}
                  {...register('temperatureZone')}
                />
                <SelectField
                  label="요구 차종"
                  placeholder="편성이 고르게 둠"
                  options={(capacities.data ?? []).map((c) => ({
                    value: c.id,
                    label: c.name,
                    note: c.maxWeightKg ? `${(c.maxWeightKg / 1000).toLocaleString('ko-KR')}t` : null,
                  }))}
                  error={e.requiredVehicleTypeId?.message}
                  {...register('requiredVehicleTypeId')}
                />
                <SelectField
                  label="운임 조건"
                  options={Object.entries(FREIGHT_TERMS_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  error={e.freightTerms?.message}
                  {...register('freightTerms')}
                />
                <div className="sm:col-span-3">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Checkbox
                      label="위험물"
                      description="위험물 운송 자격이 있는 차만 배차됩니다"
                      {...register('isHazardous')}
                    />
                    <Checkbox
                      label="독차"
                      description="다른 오더와 합적하지 않습니다"
                      {...register('isExclusive')}
                    />
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <TextField
                    label="관리번호"
                    hint="사내에서 이 건을 부르는 번호"
                    error={e.referenceNo1?.message}
                    {...register('referenceNo1')}
                  />
                </div>
                <div className="sm:col-span-3">
                  <TextareaField
                    label="특기사항"
                    placeholder="기사에게 전달할 내용 — 게이트 통과증 필요, 지게차 없음 …"
                    error={e.specialInstruction?.message}
                    {...register('specialInstruction')}
                  />
                </div>
                <div className="sm:col-span-3">
                  <TextareaField
                    label="비고"
                    rows={2}
                    error={e.remark?.message}
                    {...register('remark')}
                  />
                </div>
              </div>
            </Panel>
          </div>

          {/* ================= 오른쪽 · 검산판 ================= */}
          <aside className="min-w-0">
            <div className="space-y-4 xl:sticky xl:top-6">
              <Panel title="시간 축" subtitle="이 오더가 시간상 성립하는가">
                <div className="px-4 py-4">
                  <TimeSpine input={spine} />
                  {route.data?.distanceKm !== undefined && route.data?.distanceKm !== null && (
                    <p className="tabular mt-2.5 text-caption text-content-tertiary">
                      구간 {route.data.distanceKm.toLocaleString('ko-KR')} km
                    </p>
                  )}
                </div>
              </Panel>

              <Panel title="적재 판정" subtitle="이 짐을 실을 수 있는 차종">
                <div className="px-4 py-4">
                  <LoadVerdict
                    load={{ ...load, temperatureZone: temperatureZone ?? 'AMBIENT' }}
                    types={capacities.data ?? []}
                    requiredTypeId={requiredVehicleTypeId || null}
                    onPick={(id) =>
                      setValue('requiredVehicleTypeId', id === requiredVehicleTypeId ? '' : id, {
                        shouldDirty: true,
                      })
                    }
                  />
                </div>
              </Panel>

              <div className="flex items-center gap-2">
                <Link
                  href={isEdit ? `/plan/orders/${orderId}` : '/plan/orders'}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-line-field bg-surface-card text-body font-medium text-content-primary transition-colors hover:bg-surface-sunken"
                >
                  취소
                </Link>
                <Button
                  type="submit"
                  block
                  loading={save.isPending}
                  loadingLabel="저장하는 중"
                  className="flex-1"
                >
                  {isEdit ? '저장' : '오더 등록'}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------

/**
 * 상차지 · 하차지 한 벌.
 *
 * 거점 마스터에서 고르거나 직접 칠 수 있게 둔다. 화주가 처음 보내는
 * 주소는 마스터에 없는 경우가 많고, 그때마다 거점을 먼저 등록하라고 하면
 * 접수가 멈춘다.
 */
function StopPanel({
  side,
  title,
  subtitle,
  locationOptions,
  register,
  errors,
  onLocationChange,
}: {
  side: 'from' | 'to';
  title: string;
  subtitle: string;
  locationOptions: { value: string; label: string; note?: string | null }[];
  register: ReturnType<typeof useForm<OrderFormInput>>['register'];
  errors: Record<string, string | undefined>;
  onLocationChange: (id: string) => void;
}) {
  const loc = register(`${side}LocationId` as const);
  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="grid gap-4 px-4 py-4">
        <SelectField
          label="거점"
          placeholder="마스터에 없음 (직접 입력)"
          hint="고르면 이름이 채워집니다"
          options={locationOptions}
          error={errors.locationId}
          {...loc}
          onChange={(ev) => {
            void loc.onChange(ev);
            onLocationChange(ev.target.value);
          }}
        />
        <TextField
          label={`${title}명`}
          required
          error={errors.name}
          {...register(`${side}LocationName` as const)}
        />
        <TextField
          label="주소"
          required
          error={errors.address1}
          {...register(`${side}Address1` as const)}
        />
        <TextField
          label="상세 주소"
          error={errors.address2}
          {...register(`${side}Address2` as const)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="담당자"
            error={errors.contactName}
            {...register(`${side}ContactName` as const)}
          />
          <TextField
            label="연락처"
            error={errors.contactTel}
            {...register(`${side}ContactTel` as const)}
          />
        </div>
      </div>
    </Panel>
  );
}

/** 표 안의 입력 칸. 열 머리가 라벨을 대신하고, 낭독기에는 줄 번호까지 읽어 준다 */
function Cell({
  error,
  numeric,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: string; numeric?: boolean }) {
  return (
    <input
      {...props}
      title={error}
      aria-invalid={error ? true : undefined}
      className={cn(
        'field-text h-8 w-full rounded border bg-surface-field px-2 text-label text-content-primary',
        'placeholder:text-content-tertiary/60',
        numeric && 'tabular text-right',
        error ? 'border-status-danger' : 'border-line-field',
        className,
      )}
    />
  );
}

function emptyToNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}
