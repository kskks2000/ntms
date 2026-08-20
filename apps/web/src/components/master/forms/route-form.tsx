'use client';

import { useMemo } from 'react';
import {
  ROUTE_SOURCES,
  ROUTE_SOURCE_LABEL,
  routeFormSchema,
  type RouteFormInput,
} from '@ntms/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import {
  FormFull,
  FormSection,
  MasterFormDrawer,
} from '@/components/master/master-form-drawer';
import {
  toEnumOptions,
  toSelectOptions,
  useMasterForm,
} from '@/components/master/use-master-form';
import { cn } from '@/lib/cn';

/**
 * 라우트 등록 · 수정.
 *
 * 거리와 소요시간을 손으로 넣는 화면에서 가장 흔한 실수는 **단위를 헷갈리는
 * 것**이다. 소요시간에 시간을 넣고 분이라고 저장하면 평균속도가 4km/h 가
 * 되는데, 표에서는 그저 작은 숫자로만 보인다.
 *
 * 그래서 입력하는 동안 평균속도를 계산해 바로 옆에 보인다. 상식 밖이면
 * 저장하기 전에 걸린다.
 */
const BLANK: RouteFormInput = {
  fromLocationId: '',
  toLocationId: '',
  distanceKm: '',
  durationMinutes: '',
  tollFee: '',
  source: 'MANUAL',
  isActive: true,
};

const SPEED_MIN = 20;
const SPEED_MAX = 110;

export function RouteForm({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { form, options, loading, submitting, deleting, formError, submit, remove, isEdit } =
    useMasterForm<RouteFormInput>({
      resource: 'routes',
      id,
      open,
      schema: routeFormSchema,
      blank: BLANK as never,
      listKeys: ['master-routes'],
      entityLabel: '구간',
      onSaved: onClose,
    });

  const { register, watch, formState } = form;
  const e = formState.errors;

  const km = watch('distanceKm');
  const min = watch('durationMinutes');

  const speed = useMemo(() => {
    const d = Number(String(km ?? '').replace(/,/g, ''));
    const m = Number(String(min ?? '').replace(/,/g, ''));
    if (!Number.isFinite(d) || !Number.isFinite(m) || d <= 0 || m <= 0) return null;
    return Math.round((d / (m / 60)) * 10) / 10;
  }, [km, min]);

  const odd = speed !== null && (speed < SPEED_MIN || speed > SPEED_MAX);

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? '구간 수정' : '구간 등록'}
      subtitle={
        loading ? '불러오는 중…' : '운임과 도착예정 시각이 이 값에서 나옵니다.'
      }
      width="sm"
      submitting={submitting}
      deleting={deleting}
      // 등록 중에는 지울 것이 없다
      onDelete={isEdit ? remove : undefined}
      error={formError}
      onSubmit={submit}
      submitLabel={isEdit ? '저장' : '등록'}
    >
      <FormSection title="구간" columns={1}>
        <SelectField
          label="출발지"
          required
          placeholder="고르세요"
          options={toSelectOptions(options?.locations)}
          error={e.fromLocationId?.message}
          {...register('fromLocationId')}
        />
        <SelectField
          label="도착지"
          required
          placeholder="고르세요"
          hint="반대 방향은 따로 등록해야 복로 운임이 잡힙니다"
          options={toSelectOptions(options?.locations)}
          error={e.toLocationId?.message}
          {...register('toLocationId')}
        />
      </FormSection>

      <FormSection title="거리 · 시간">
        <TextField
          label="거리"
          required
          hint="km"
          inputMode="decimal"
          error={e.distanceKm?.message}
          {...register('distanceKm')}
        />
        <TextField
          label="소요시간"
          hint="분 단위입니다"
          inputMode="numeric"
          error={e.durationMinutes?.message}
          {...register('durationMinutes')}
        />

        <FormFull>
          {/*
            검산 칸. 저장 뒤 표에서 발견하는 것보다 여기서 걸리는 편이 낫다.
          */}
          <div
            className={cn(
              'flex items-baseline justify-between rounded-md border px-3 py-2.5',
              odd
                ? 'border-status-warning/30 bg-status-warning-surface'
                : 'border-line-subtle bg-surface-sunken',
            )}
          >
            <span className="text-label text-content-secondary">평균속도</span>
            {speed === null ? (
              <span className="text-caption text-content-tertiary">
                거리와 소요시간을 넣으면 계산합니다
              </span>
            ) : (
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'tabular text-body font-medium',
                    odd ? 'text-status-warning' : 'text-content-primary',
                  )}
                >
                  {speed} km/h
                </span>
                {odd && (
                  <span className="text-caption text-status-warning">
                    거리나 단위를 확인하세요
                  </span>
                )}
              </span>
            )}
          </div>
        </FormFull>

        <TextField
          label="통행료"
          hint="원"
          inputMode="numeric"
          error={e.tollFee?.message}
          {...register('tollFee')}
        />
        <SelectField
          label="출처"
          options={toEnumOptions(ROUTE_SOURCES, ROUTE_SOURCE_LABEL)}
          error={e.source?.message}
          {...register('source')}
        />
      </FormSection>

      <FormSection title="기타" columns={1}>
        <Checkbox
          label="사용중"
          description="끄면 이 구간으로 거리를 계산하지 않습니다"
          {...register('isActive')}
        />
      </FormSection>
    </MasterFormDrawer>
  );
}
