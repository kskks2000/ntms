'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, type FieldErrors } from 'react-hook-form';
import {
  RATE_METHOD_LABEL,
  RATE_TARGET_LABEL,
  RATE_UNIT_LABEL,
  axesOf,
  rateDetailBulkSchema,
  type MasterOptions,
  type RateAxis,
  type RateDetailBulkInput,
  type RateDetailPage,
} from '@ntms/shared';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { EmptyState, Panel } from '@/components/tms/panels';
import { cn } from '@/lib/cn';

/**
 * 요율 상세 편집기.
 *
 * 운임표 화면에서 "요율 상세" 를 누르면 여기로 온다. 서랍이 아니라 화면 한
 * 장을 통째로 쓰는 이유는 이것이 **표를 짜는 일**이기 때문이다. 구간을
 * 나누고 단가를 배분하려면 여러 줄이 동시에 보여야 하고, 34rem 짜리 판에
 * 여덟 칸짜리 줄을 넣으면 한 줄이 세 줄로 접힌다.
 *
 * ## 왜 줄마다 저장하지 않나
 *
 * 요율표를 고치는 일은 한 줄만 건드리는 경우가 드물다 — 0~50 / 50~150 을
 * 0~80 / 80~200 으로 다시 자르면 두 줄이 동시에 바뀐다. 줄마다 저장하면 그
 * 중간에 "50~80 구간이 어느 줄에도 안 걸리는" 상태가 실제로 DB 에 남고,
 * 그때 계산되는 오더가 있으면 최소금액으로 떨어진다.
 *
 * 그래서 표 전체를 한 번에 갈아 끼운다. 저장 전까지는 화면 안에서만 바뀐다.
 */

/** 조건 축마다 어떤 칸을 그릴지 */
const AXIS_COLUMNS: Record<RateAxis, { key: string; header: string; width: string }[]> = {
  vehicleType: [{ key: 'vehicleTypeId', header: '차종', width: '11rem' }],
  zonePair: [
    { key: 'fromZoneId', header: '출발권역', width: '9rem' },
    { key: 'toZoneId', header: '도착권역', width: '9rem' },
  ],
  locationPair: [
    { key: 'fromLocationId', header: '출발지', width: '10rem' },
    { key: 'toLocationId', header: '도착지', width: '10rem' },
  ],
  distance: [
    { key: 'distanceFrom', header: '거리 from', width: '6.5rem' },
    { key: 'distanceTo', header: '거리 to', width: '6.5rem' },
  ],
  weight: [
    { key: 'weightFrom', header: '중량 from', width: '6.5rem' },
    { key: 'weightTo', header: '중량 to', width: '6.5rem' },
  ],
  qty: [
    { key: 'qtyFrom', header: '수량 from', width: '6.5rem' },
    { key: 'qtyTo', header: '수량 to', width: '6.5rem' },
  ],
  stopCount: [
    { key: 'stopCountFrom', header: '정차 from', width: '6rem' },
    { key: 'stopCountTo', header: '정차 to', width: '6rem' },
  ],
};

/** 천 단위로 끊어 보일 칸. 구간 값(거리·중량)은 끊지 않는다 — 자릿수가 짧다 */
const MONEY_KEYS = new Set([
  'baseAmount',
  'unitRate',
  'minAmount',
  'maxAmount',
  'extraStopAmount',
  'waitingRateHour',
]);

const BLANK_ROW = {
  vehicleTypeId: '',
  fromZoneId: '',
  toZoneId: '',
  distanceFrom: '',
  distanceTo: '',
  weightFrom: '',
  weightTo: '',
  qtyFrom: '',
  qtyTo: '',
  stopCountFrom: '',
  stopCountTo: '',
  baseAmount: '',
  unitRate: '',
  minAmount: '',
  maxAmount: '',
  extraStopAmount: '',
  waitingFreeMin: '',
  waitingRateHour: '',
  priority: '100',
  remark: '',
};

export function RateDetailEditor({ tariffId }: { tariffId: string }) {
  const toast = useToast();

  const page = useApiQuery<RateDetailPage>(
    ['rate-details', tariffId],
    `/master/tariffs/${tariffId}/rates`,
    { staleTime: 0 },
  );
  const options = useApiQuery<MasterOptions>(['master-options'], '/master/options', {
    staleTime: 5 * 60_000,
  });

  const form = useForm<RateDetailBulkInput>({
    resolver: zodResolver(rateDetailBulkSchema),
    defaultValues: { rows: [] },
    mode: 'onBlur',
  });
  const { control, register, reset, handleSubmit, formState } = form;
  const { fields, append, remove, insert } = useFieldArray({ control, name: 'rows' });

  /*
    자주 쓰지 않는 칸은 접어 둔다.

    상한 · 대기료 · 비고까지 열로 세우면 표가 가로로 넘쳐, 정작 매일 보는
    기본료와 구간이 화면 밖으로 밀린다. 그렇다고 빼 버리면 DB 에는 있는데
    화면으로는 넣을 수 없는 값이 된다.

    그래서 줄을 펼쳐서 넣는다. useFieldArray 는 줄을 넣고 뺄 때 인덱스가
    통째로 밀리므로, 펼침 상태는 인덱스가 아니라 RHF 가 주는 안정된 id 로
    기억한다 — 그러지 않으면 2번 줄을 펼쳐 둔 채 1번 줄을 지웠을 때 엉뚱한
    줄이 펼쳐진다.
  */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (rowId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });

  const data = page.data;
  const optionRows = options.data;
  useEffect(() => {
    // 선택 목록이 오기 전에 채우면 <select> 가 담지 못한 값을 버린다.
    // 그러면 권역·차종이 전부 "전 권역 / 전 차종" 으로 보인다.
    if (!data || !optionRows) return;
    reset({
      rows: data.rows.map((r) => ({
        ...BLANK_ROW,
        ...Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            v === null || v === undefined
              ? ''
              : MONEY_KEYS.has(k) && typeof v === 'number'
                ? v.toLocaleString('ko-KR')
                : String(v),
          ]),
        ),
      })) as RateDetailBulkInput['rows'],
    });
  }, [data, optionRows, reset]);

  const save = useApiMutation<{ count: number }, RateDetailBulkInput>(
    () => ({ path: `/master/tariffs/${tariffId}/rates`, method: 'PUT' }),
    {
      invalidate: [['rate-details'], ['master-tariffs']],
      onSuccess: (result) => {
        toast.success(`요율 상세 ${result.count}줄을 저장했습니다`);
      },
    },
  );

  const method = data?.tariff.rateMethod ?? 'DISTANCE';
  const axes = useMemo(() => axesOf(method), [method]);
  const unitLabel = RATE_UNIT_LABEL[method] ?? null;
  const conditionCols = useMemo(() => axes.flatMap((a) => AXIS_COLUMNS[a] ?? []), [axes]);
  const locked = (data?.lockedBySettlement ?? 0) > 0;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      toast.danger('저장하지 못했습니다', message);
    }
  });

  /**
   * 금액 칸을 칸 밖으로 나갈 때 천 단위로 끊는다.
   *
   * 치는 동안 끊으면 커서가 튄다 — 쉼표가 끼어들 때마다 글자 수가 늘어
   * 커서 위치가 밀린다. 그래서 blur 에서만 손댄다.
   *
   * 운임표에서 230000 과 2300000 을 눈으로 가르기는 어렵고, 그 차이는
   * 그대로 돈이다. zod 쪽은 쉼표를 떼고 읽으므로 저장에는 영향이 없다.
   */
  const money = (name: `rows.${number}.${string}`) => {
    const field = register(name as never);
    return {
      ...field,
      onBlur: async (e: React.FocusEvent<HTMLInputElement>) => {
        const raw = e.target.value.trim().replace(/,/g, '');
        if (raw !== '' && /^-?\d+(\.\d+)?$/.test(raw)) {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const formatted = n.toLocaleString('ko-KR');
            // 칸을 직접 고친다. setValue 만으로는 uncontrolled 입력의 DOM
            // 값이 그대로 남아, 화면에는 안 끊긴 숫자가 보인다.
            e.target.value = formatted;
            form.setValue(name as never, formatted as never, { shouldDirty: false });
          }
        }
        // RHF 가 이 시점의 값을 읽어 가도록 마지막에 부른다
        await field.onBlur(e);
      },
    };
  };

  /**
   * 접혀 있는 칸에 값이 들어 있는지.
   *
   * 표시가 없으면 "이 줄에는 대기료가 걸려 있다" 는 사실이 펼치기 전까지
   * 보이지 않는다. 금액에 영향을 주는 값이 화면에 없는 채로 남는 셈이다.
   */
  const HIDDEN_KEYS = ['maxAmount', 'waitingFreeMin', 'waitingRateHour', 'remark'] as const;
  const hasHidden = (i: number): boolean =>
    HIDDEN_KEYS.some((k) => {
      const v = form.getValues(`rows.${i}.${k}` as never) as unknown;
      return v !== null && v !== undefined && String(v).trim() !== '';
    });

  const errors = formState.errors as FieldErrors<RateDetailBulkInput>;
  const rowErrors = (i: number, key: string): string | undefined => {
    const row = errors.rows?.[i] as Record<string, { message?: string }> | undefined;
    return row?.[key]?.message;
  };

  if (page.isLoading || options.isLoading) {
    return <Panel><div className="px-4 py-16 text-center text-content-tertiary">불러오는 중…</div></Panel>;
  }
  if (!data) {
    return (
      <Panel>
        <EmptyState
          icon={<Trash2 size={26} strokeWidth={1.5} />}
          title="운임표를 찾을 수 없습니다"
          description="삭제됐거나 접근 권한이 없습니다."
        />
      </Panel>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {/*
        머리 요약. 어느 운임표를 고치고 있는지가 화면 위에 늘 보여야 한다 —
        매출과 매입을 헷갈리면 마진이 통째로 뒤집힌다.
      */}
      <Panel>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
          <Field label="구분">
            <span
              className={cn(
                'rounded-sm border px-1.5 py-0.5 text-caption',
                data.tariff.rateTarget === 'BILLING'
                  ? 'border-status-success/30 bg-status-success-surface text-status-success'
                  : 'border-line-subtle bg-surface-sunken text-content-secondary',
              )}
            >
              {RATE_TARGET_LABEL[data.tariff.rateTarget] ?? data.tariff.rateTarget}
            </span>
          </Field>
          <Field label="산정방식">
            {RATE_METHOD_LABEL[method] ?? method}
          </Field>
          <Field label="적용 거래처">{data.tariff.partnerName ?? '전체 공통'}</Field>
          <Field label="적용기간">
            <span className="tabular">
              {data.tariff.applyStartDate} ~ {data.tariff.applyEndDate ?? '무기한'}
            </span>
          </Field>
          <Field label="최소금액">
            <span className="tabular">
              {data.tariff.minChargeAmount === null
                ? '—'
                : data.tariff.minChargeAmount.toLocaleString('ko-KR')}
            </span>
          </Field>
        </div>
      </Panel>

      {locked && (
        <Alert tone="warning" title="이 운임표는 이미 정산에 쓰였습니다">
          정산 {data.lockedBySettlement}건이 이 요율을 참조하고 있어 줄을 바꿀 수 없습니다.
          요율을 바꾸려면 새 운임표를 만들고 적용기간을 나누세요 — 그래야 지난 청구서가
          어느 요율로 계산됐는지 남습니다.
        </Alert>
      )}

      <Panel
        title="요율 상세"
        subtitle={`${fields.length}줄 · 조건이 겹치면 우선순위가 작은 줄이 이깁니다`}
        action={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={locked}
            onClick={() => append(BLANK_ROW as never)}
            leadingIcon={<Plus size={14} strokeWidth={2} aria-hidden="true" />}
          >
            줄 추가
          </Button>
        }
        bodyClassName="overflow-x-auto"
      >
        {fields.length === 0 ? (
          <EmptyState
            icon={<Plus size={26} strokeWidth={1.5} />}
            title="요율이 한 줄도 없습니다"
            description="줄을 넣어야 이 운임표로 금액이 계산됩니다. 지금은 최소금액만 적용됩니다."
            action={
              <Button type="button" onClick={() => append(BLANK_ROW as never)} disabled={locked}>
                첫 줄 넣기
              </Button>
            }
          />
        ) : (
          <table className="w-full border-collapse text-label">
            <thead>
              <tr className="border-b border-line-subtle text-caption text-content-tertiary">
                <th scope="col" className="w-8 px-1 py-2">
                  <span className="sr-only">자세히</span>
                </th>
                <th scope="col" className="w-10 px-2 py-2 text-left font-medium">
                  #
                </th>
                {conditionCols.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ width: c.width }}
                    className="px-2 py-2 text-left font-medium"
                  >
                    {c.header}
                  </th>
                ))}
                <th scope="col" className="w-28 px-2 py-2 text-right font-medium">
                  기본료
                </th>
                {unitLabel && (
                  <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                    {unitLabel}
                  </th>
                )}
                <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                  최소
                </th>
                <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                  추가정차
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-medium">
                  우선
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-medium">
                  <span className="sr-only">줄 조작</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, i) => (
                <FragmentRow key={field.id}>
                <tr className="border-b border-line-subtle last:border-0">
                  <td className="px-1 py-1.5">
                    <IconButton
                      label={`${i + 1}번째 줄 자세히 ${expanded.has(field.id) ? '접기' : '펼치기'}`}
                      onClick={() => toggleRow(field.id)}
                    >
                      <span className="relative block">
                        {expanded.has(field.id) ? (
                          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                        )}
                        {!expanded.has(field.id) && hasHidden(i) && (
                          <span
                            aria-hidden="true"
                            title="접힌 칸에 값이 있습니다"
                            className="absolute -right-0.5 -top-0.5 block h-1.5 w-1.5 rounded-full bg-content-accent"
                          />
                        )}
                      </span>
                    </IconButton>
                  </td>
                  <td className="px-2 py-1.5 text-caption tabular text-content-tertiary">
                    {i + 1}
                  </td>

                  {conditionCols.map((c) => (
                    <td key={c.key} className="px-1 py-1.5">
                      {c.key === 'vehicleTypeId' ? (
                        <CellSelect
                          {...register(`rows.${i}.vehicleTypeId` as never)}
                          disabled={locked}
                          error={rowErrors(i, c.key)}
                          aria-label={`${i + 1}번째 줄 차종`}
                        >
                          <option value="">전 차종</option>
                          {(options.data?.vehicleTypes ?? []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </CellSelect>
                      ) : c.key === 'fromZoneId' || c.key === 'toZoneId' ? (
                        <CellSelect
                          {...register(`rows.${i}.${c.key}` as never)}
                          disabled={locked}
                          error={rowErrors(i, c.key)}
                          aria-label={`${i + 1}번째 줄 ${c.header}`}
                        >
                          <option value="">전 권역</option>
                          {(options.data?.zones ?? []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </CellSelect>
                      ) : (
                        <CellInput
                          {...register(`rows.${i}.${c.key}` as never)}
                          disabled={locked}
                          error={rowErrors(i, c.key)}
                          inputMode="decimal"
                          placeholder="제한없음"
                          aria-label={`${i + 1}번째 줄 ${c.header}`}
                        />
                      )}
                    </td>
                  ))}

                  <td className="px-1 py-1.5">
                    <CellInput
                      {...money(`rows.${i}.baseAmount`)}
                      disabled={locked}
                      error={rowErrors(i, 'baseAmount')}
                      inputMode="numeric"
                      numeric
                      aria-label={`${i + 1}번째 줄 기본료`}
                    />
                  </td>
                  {unitLabel && (
                    <td className="px-1 py-1.5">
                      <CellInput
                        {...money(`rows.${i}.unitRate`)}
                        disabled={locked}
                        error={rowErrors(i, 'unitRate')}
                        inputMode="numeric"
                        numeric
                        aria-label={`${i + 1}번째 줄 ${unitLabel} 단가`}
                      />
                    </td>
                  )}
                  <td className="px-1 py-1.5">
                    <CellInput
                      {...money(`rows.${i}.minAmount`)}
                      disabled={locked}
                      error={rowErrors(i, 'minAmount')}
                      inputMode="numeric"
                      numeric
                      aria-label={`${i + 1}번째 줄 최소금액`}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <CellInput
                      {...money(`rows.${i}.extraStopAmount`)}
                      disabled={locked}
                      error={rowErrors(i, 'extraStopAmount')}
                      inputMode="numeric"
                      numeric
                      aria-label={`${i + 1}번째 줄 추가정차료`}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <CellInput
                      {...register(`rows.${i}.priority` as never)}
                      disabled={locked}
                      error={rowErrors(i, 'priority')}
                      inputMode="numeric"
                      numeric
                      aria-label={`${i + 1}번째 줄 우선순위`}
                    />
                  </td>

                  <td className="px-1 py-1.5">
                    <div className="flex justify-end gap-0.5">
                      {/*
                        구간을 나눌 때는 바로 위 줄과 조건만 조금 다른 줄이
                        필요하다. 처음부터 다시 채우게 하지 않는다.
                      */}
                      <IconButton
                        label={`${i + 1}번째 줄 복제`}
                        disabled={locked}
                        onClick={() => insert(i + 1, { ...form.getValues(`rows.${i}`) } as never)}
                      >
                        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`${i + 1}번째 줄 삭제`}
                        disabled={locked}
                        danger
                        onClick={() => remove(i)}
                      >
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      </IconButton>
                    </div>
                  </td>
                </tr>

                {expanded.has(field.id) && (
                  <tr className="border-b border-line-subtle bg-surface-sunken/60 last:border-0">
                    <td />
                    {/*
                      펼침 칸 앞의 <td /> 가 펼침 열을 덮는다. 남는 열은
                      # · 조건들 · 기본료 · [단가] · 최소 · 추가정차 · 우선 · 줄조작.
                    */}
                    <td
                      colSpan={conditionCols.length + (unitLabel ? 7 : 6)}
                      className="px-2 py-3"
                    >
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <MiniField label="상한금액" hint="계산 결과가 이보다 크면 이 금액">
                          <CellInput
                            {...money(`rows.${i}.maxAmount`)}
                            disabled={locked}
                            error={rowErrors(i, 'maxAmount')}
                            inputMode="numeric"
                            numeric
                            aria-label={`${i + 1}번째 줄 상한금액`}
                          />
                        </MiniField>
                        <MiniField label="대기 무료" hint="분. 이 시간까지는 대기료 없음">
                          <CellInput
                            {...register(`rows.${i}.waitingFreeMin` as never)}
                            disabled={locked}
                            error={rowErrors(i, 'waitingFreeMin')}
                            inputMode="numeric"
                            numeric
                            aria-label={`${i + 1}번째 줄 대기 무료시간`}
                          />
                        </MiniField>
                        <MiniField label="시간당 대기료" hint="무료시간을 넘긴 뒤">
                          <CellInput
                            {...money(`rows.${i}.waitingRateHour`)}
                            disabled={locked}
                            error={rowErrors(i, 'waitingRateHour')}
                            inputMode="numeric"
                            numeric
                            aria-label={`${i + 1}번째 줄 시간당 대기료`}
                          />
                        </MiniField>
                        <MiniField label="비고">
                          <CellInput
                            {...register(`rows.${i}.remark` as never)}
                            disabled={locked}
                            error={rowErrors(i, 'remark')}
                            placeholder="이 줄을 쓰는 조건을 적습니다"
                            aria-label={`${i + 1}번째 줄 비고`}
                          />
                        </MiniField>
                      </div>
                    </td>
                  </tr>
                )}
                </FragmentRow>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-caption text-content-tertiary">
          저장하면 이 운임표의 요율이 통째로 이 표로 바뀝니다.
        </p>
        <Button
          type="submit"
          disabled={locked}
          loading={save.isPending}
          loadingLabel="저장하는 중"
        >
          요율 저장
        </Button>
      </div>
    </form>
  );
}

/**
 * 한 줄이 두 개의 <tr> 로 나뉘므로 감싸는 조각이 필요하다.
 * <tbody> 안에서는 <div> 로 감쌀 수 없다 — 표 구조가 깨진다.
 */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** 펼친 줄 안의 작은 칸. 표의 열 머리가 없으니 라벨을 직접 단다 */
function MiniField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption text-content-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-caption text-content-tertiary">{hint}</span>}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-caption text-content-tertiary">{label}</span>
      <span className="text-label text-content-primary">{children}</span>
    </span>
  );
}

/**
 * 표 안의 입력 칸.
 *
 * 라벨을 밖에 세우지 않는다 — 열 머리가 그 일을 한다. 대신 aria-label 로
 * "3번째 줄 기본료" 처럼 낭독기에는 줄 번호까지 읽어 준다. 표를 낭독기로
 * 훑을 때 어느 줄인지 모르면 값만 흘러가서 아무 의미가 없다.
 */
const CellInput = function CellInput({
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
        'placeholder:text-content-tertiary/60 disabled:bg-surface-sunken disabled:text-content-tertiary',
        numeric && 'tabular text-right',
        error ? 'border-status-danger' : 'border-line-field',
        className,
      )}
    />
  );
};

const CellSelect = function CellSelect({
  error,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <select
      {...props}
      title={error}
      aria-invalid={error ? true : undefined}
      className={cn(
        'field-text h-8 w-full rounded border bg-surface-field px-1.5 text-label text-content-primary',
        'disabled:bg-surface-sunken disabled:text-content-tertiary',
        error ? 'border-status-danger' : 'border-line-field',
        className,
      )}
    >
      {children}
    </select>
  );
};

function IconButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
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
      className={cn(
        'rounded p-1.5 text-content-tertiary transition-colors disabled:opacity-40',
        danger
          ? 'hover:bg-status-danger-surface hover:text-status-danger'
          : 'hover:bg-surface-sunken hover:text-content-primary',
      )}
    >
      {children}
    </button>
  );
}
