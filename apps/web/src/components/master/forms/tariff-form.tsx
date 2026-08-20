'use client';

import {
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABEL,
  RATE_METHODS,
  RATE_METHOD_LABEL,
  RATE_TARGETS,
  RATE_TARGET_LABEL,
  tariffFormSchema,
  type TariffFormInput,
} from '@ntms/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select-field';
import { TextField } from '@/components/ui/text-field';
import { TextareaField } from '@/components/ui/textarea-field';
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
import { Alert } from '@/components/ui/alert';

/**
 * 단가(운임표) 등록 · 수정.
 *
 * 이 서랍은 운임표의 **머리**만 만든다. 실제 금액을 만드는 것은 요율 상세
 * 한 줄 한 줄이고, 그건 조건 축(거리 구간 · 권역 짝 · 차종)이 산정방식마다
 * 달라 표 형태의 별도 편집기가 필요하다.
 *
 * 그 사실을 숨기지 않고 화면에 적는다. 머리만 만들어 두고 "등록했다" 고
 * 생각하면, 정산에서 금액이 0으로 나오는 이유를 한참 뒤에 찾게 된다.
 */
const BLANK: TariffFormInput = {
  rateTableCode: '',
  rateTableName: '',
  rateTarget: 'BILLING',
  rateMethod: 'DISTANCE',
  partnerId: '',
  applyStartDate: '',
  applyEndDate: '',
  minChargeAmount: '',
  applyFuelSurcharge: false,
  isTaxable: true,
  status: 'DRAFT',
  description: '',
  isActive: true,
};

export function TariffForm({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { form, options, loading, submitting, formError, submit, isEdit } =
    useMasterForm<TariffFormInput>({
      resource: 'tariffs',
      id,
      open,
      schema: tariffFormSchema,
      blank: BLANK as never,
      listKeys: ['master-tariffs'],
      onSaved: onClose,
    });

  const { register, watch, formState } = form;
  const e = formState.errors;
  const target = watch('rateTarget');

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? '운임표 수정' : '운임표 등록'}
      subtitle={loading ? '불러오는 중…' : '청구와 지급 금액이 이 표에서 나옵니다.'}
      width="md"
      submitting={submitting}
      error={formError}
      onSubmit={submit}
      submitLabel={isEdit ? '저장' : '등록'}
    >
      <FormSection title="기본">
        <TextField
          label="코드"
          required
          placeholder="RT-BIL-ZONE"
          error={e.rateTableCode?.message}
          {...register('rateTableCode')}
        />
        <TextField
          label="운임표명"
          required
          error={e.rateTableName?.message}
          {...register('rateTableName')}
        />
        <SelectField
          label="구분"
          options={toEnumOptions(RATE_TARGETS, RATE_TARGET_LABEL)}
          hint="매출은 화주에게 청구, 매입은 운송사에 지급"
          error={e.rateTarget?.message}
          {...register('rateTarget')}
        />
        <SelectField
          label="산정방식"
          options={toEnumOptions(RATE_METHODS, RATE_METHOD_LABEL)}
          hint="요율 상세의 조건 축을 정합니다"
          error={e.rateMethod?.message}
          {...register('rateMethod')}
        />
        <FormFull>
          <SelectField
            label="적용 거래처"
            placeholder="전체 공통"
            hint={
              target === 'BILLING'
                ? '비워 두면 모든 화주에게 적용됩니다'
                : '비워 두면 모든 운송사에게 적용됩니다'
            }
            options={toSelectOptions(
              target === 'BILLING' ? options?.shippers : options?.carriers,
            )}
            error={e.partnerId?.message}
            {...register('partnerId')}
          />
        </FormFull>
      </FormSection>

      <FormSection
        title="적용기간"
        description="기간이 지난 운임표로 계속 청구하는 것이 가장 흔한 사고입니다."
      >
        <TextField
          label="시작일"
          type="date"
          required
          error={e.applyStartDate?.message}
          {...register('applyStartDate')}
        />
        <TextField
          label="종료일"
          type="date"
          hint="비우면 무기한"
          error={e.applyEndDate?.message}
          {...register('applyEndDate')}
        />
      </FormSection>

      <FormSection title="금액 조건">
        <TextField
          label="최소 청구금액"
          hint="원. 계산 결과가 이보다 작으면 이 금액"
          inputMode="numeric"
          error={e.minChargeAmount?.message}
          {...register('minChargeAmount')}
        />
        <SelectField
          label="승인 상태"
          options={toEnumOptions(APPROVAL_STATUSES, APPROVAL_STATUS_LABEL)}
          hint="승인해야 정산에 쓰입니다"
          error={e.status?.message}
          {...register('status')}
        />
        <FormFull>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Checkbox
              label="유류할증 적용"
              description="유가 변동분을 따로 더함"
              {...register('applyFuelSurcharge')}
            />
            <Checkbox label="과세" description="부가세 대상" {...register('isTaxable')} />
          </div>
        </FormFull>
      </FormSection>

      <FormSection title="기타" columns={1}>
        <TextareaField
          label="비고"
          error={e.description?.message}
          {...register('description')}
        />
        <Checkbox label="사용중" {...register('isActive')} />

        {!isEdit && (
          <Alert tone="info" title="요율 상세는 따로 넣어야 합니다">
            지금 만드는 것은 운임표의 머리입니다. 요율 상세를 한 줄도 넣지 않으면 이
            운임표로는 아무 금액도 계산되지 않습니다.
          </Alert>
        )}
      </FormSection>
    </MasterFormDrawer>
  );
}
