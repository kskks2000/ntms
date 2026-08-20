'use client';

import {
  DRIVER_STATUSES,
  DRIVER_STATUS_LABEL,
  driverFormSchema,
  type DriverFormInput,
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

/**
 * 기사 등록 · 수정.
 *
 * 정시율 · 평가 · 사고 건수는 여기에 없다. 그 값들은 사람이 적는 것이
 * 아니라 운송실행에서 쌓이는 실적이다. 폼에 두면 손으로 고칠 수 있게 되고,
 * 그 순간 배차 후보를 고르는 기준이 실적이 아니라 의견이 된다.
 */
const BLANK: DriverFormInput = {
  driverCode: '',
  driverName: '',
  carrierId: '',
  mobile: '',
  licenseNo: '',
  licenseType: '',
  licenseExpireDate: '',
  cargoQualificationNo: '',
  cargoQualificationExpireDate: '',
  hireDate: '',
  status: 'ACTIVE',
  remark: '',
  isActive: true,
};

/** 화물차 기사가 실제로 갖는 면허 */
const LICENSE_TYPES = ['1종 대형', '1종 보통', '1종 특수(트레일러)', '2종 보통'];

export function DriverForm({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { form, options, loading, submitting, formError, submit, isEdit } =
    useMasterForm<DriverFormInput>({
      resource: 'drivers',
      id,
      open,
      schema: driverFormSchema,
      blank: BLANK as never,
      listKeys: ['master-drivers'],
      onSaved: onClose,
    });

  const { register, watch, formState } = form;
  const e = formState.errors;
  const status = watch('status');

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? '기사 수정' : '기사 등록'}
      subtitle={
        loading ? '불러오는 중…' : '면허와 화물운송 종사자격이 살아 있어야 배차할 수 있습니다.'
      }
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
          placeholder="DR-4025"
          error={e.driverCode?.message}
          {...register('driverCode')}
        />
        <TextField
          label="성명"
          required
          error={e.driverName?.message}
          {...register('driverName')}
        />
        <SelectField
          label="운송사"
          placeholder="자차 (직영)"
          options={toSelectOptions(options?.carriers)}
          error={e.carrierId?.message}
          {...register('carrierId')}
        />
        <TextField
          label="연락처"
          placeholder="010-0000-0000"
          error={e.mobile?.message}
          {...register('mobile')}
        />
      </FormSection>

      <FormSection title="운전면허">
        <SelectField
          label="면허 종류"
          placeholder="미등록"
          options={LICENSE_TYPES.map((t) => ({ value: t, label: t }))}
          error={e.licenseType?.message}
          {...register('licenseType')}
        />
        <TextField label="면허번호" error={e.licenseNo?.message} {...register('licenseNo')} />
        <FormFull>
          <TextField
            label="면허 만료일"
            type="date"
            error={e.licenseExpireDate?.message}
            {...register('licenseExpireDate')}
          />
        </FormFull>
      </FormSection>

      <FormSection
        title="화물운송 종사자격"
        description="사업용 화물차를 몰려면 이 자격이 있어야 합니다."
      >
        <TextField
          label="자격증번호"
          error={e.cargoQualificationNo?.message}
          {...register('cargoQualificationNo')}
        />
        <TextField
          label="자격 만료일"
          type="date"
          error={e.cargoQualificationExpireDate?.message}
          {...register('cargoQualificationExpireDate')}
        />
      </FormSection>

      <FormSection title="재직">
        <TextField
          label="입사일"
          type="date"
          error={e.hireDate?.message}
          {...register('hireDate')}
        />
        <SelectField
          label="재직 상태"
          options={toEnumOptions(DRIVER_STATUSES, DRIVER_STATUS_LABEL)}
          error={e.status?.message}
          {...register('status')}
        />
        <FormFull>
          <TextareaField label="비고" error={e.remark?.message} {...register('remark')} />
        </FormFull>
        <FormFull>
          {/*
            재직이 아니면 사용여부를 만질 수 없다. 퇴사로 바꿔 놓고 "사용중"
            을 켜 두면 목록에는 퇴사인데 배차 후보에는 뜨는 상태가 된다.
            서버도 같은 규칙을 건다.
          */}
          <Checkbox
            label="배차 후보로 씀"
            description={
              status === 'ACTIVE'
                ? '끄면 배차 후보에서 빠집니다'
                : '재직 상태가 아니므로 자동으로 꺼집니다'
            }
            disabled={status !== 'ACTIVE'}
            {...register('isActive')}
          />
        </FormFull>
      </FormSection>
    </MasterFormDrawer>
  );
}
