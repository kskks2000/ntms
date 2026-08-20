'use client';

import {
  OWNERSHIP_LABEL,
  OWNERSHIP_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_STATUS_LABEL,
  vehicleFormSchema,
  type VehicleFormInput,
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
 * 차량 등록 · 수정.
 *
 * 목록에서 이 서랍을 여는 가장 흔한 이유는 **보험이나 검사 만료가 걸려서**
 * 다. 그래서 만료 묶음을 스펙보다 위에 두지는 않되(등록할 때는 차종이
 * 먼저다) 한 화면 안에서 굴리지 않고 닿을 수 있는 자리에 둔다.
 */
const BLANK: VehicleFormInput = {
  vehicleNo: '',
  vehicleTypeId: '',
  ownershipType: 'OWNED',
  carrierId: '',
  defaultDriverId: '',
  baseLocationId: '',
  status: 'AVAILABLE',
  insuranceCompany: '',
  insurancePolicyNo: '',
  insuranceExpireDate: '',
  inspectionDate: '',
  nextInspectionDate: '',
  odometerKm: '',
  remark: '',
  isActive: true,
};

export function VehicleForm({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { form, options, loading, submitting, deleting, formError, submit, remove, isEdit } =
    useMasterForm<VehicleFormInput>({
      resource: 'vehicles',
      id,
      open,
      schema: vehicleFormSchema,
      blank: BLANK as never,
      listKeys: ['master-vehicles'],
      entityLabel: '차량',
      onSaved: onClose,
    });

  const { register, formState } = form;
  const e = formState.errors;

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? '차량 수정' : '차량 등록'}
      subtitle={loading ? '불러오는 중…' : '보험과 검사가 살아 있어야 배차할 수 있습니다.'}
      width="md"
      submitting={submitting}
      deleting={deleting}
      // 등록 중에는 지울 것이 없다
      onDelete={isEdit ? remove : undefined}
      error={formError}
      onSubmit={submit}
      submitLabel={isEdit ? '저장' : '등록'}
    >
      <FormSection title="차량">
        <TextField
          label="차량번호"
          required
          placeholder="12가 3456"
          error={e.vehicleNo?.message}
          {...register('vehicleNo')}
        />
        <SelectField
          label="차종"
          required
          placeholder="고르세요"
          hint="적재 가능 중량과 파렛트 수가 여기서 정해집니다"
          options={toSelectOptions(options?.vehicleTypes)}
          error={e.vehicleTypeId?.message}
          {...register('vehicleTypeId')}
        />
        <SelectField
          label="소유 형태"
          options={toEnumOptions(OWNERSHIP_TYPES, OWNERSHIP_LABEL)}
          error={e.ownershipType?.message}
          {...register('ownershipType')}
        />
        <SelectField
          label="상태"
          options={toEnumOptions(VEHICLE_STATUSES, VEHICLE_STATUS_LABEL)}
          error={e.status?.message}
          {...register('status')}
        />
      </FormSection>

      <FormSection title="소속 · 배치">
        <SelectField
          label="운송사"
          placeholder="자차 (운송사 없음)"
          options={toSelectOptions(options?.carriers)}
          error={e.carrierId?.message}
          {...register('carrierId')}
        />
        <SelectField
          label="기본 기사"
          placeholder="미지정"
          hint="재직 중인 기사만 나옵니다"
          options={toSelectOptions(options?.drivers)}
          error={e.defaultDriverId?.message}
          {...register('defaultDriverId')}
        />
        <FormFull>
          <SelectField
            label="차고지"
            placeholder="미지정"
            options={toSelectOptions(options?.locations)}
            error={e.baseLocationId?.message}
            {...register('baseLocationId')}
          />
        </FormFull>
      </FormSection>

      <FormSection
        title="보험"
        description="만료일이 지나면 배차 대상에서 빼야 합니다."
      >
        <TextField
          label="보험사"
          error={e.insuranceCompany?.message}
          {...register('insuranceCompany')}
        />
        <TextField
          label="증권번호"
          error={e.insurancePolicyNo?.message}
          {...register('insurancePolicyNo')}
        />
        <FormFull>
          <TextField
            label="보험 만료일"
            type="date"
            error={e.insuranceExpireDate?.message}
            {...register('insuranceExpireDate')}
          />
        </FormFull>
      </FormSection>

      <FormSection title="검사 · 주행">
        <TextField
          label="최근 검사일"
          type="date"
          error={e.inspectionDate?.message}
          {...register('inspectionDate')}
        />
        <TextField
          label="다음 검사일"
          type="date"
          error={e.nextInspectionDate?.message}
          {...register('nextInspectionDate')}
        />
        <TextField
          label="주행거리"
          hint="km"
          inputMode="numeric"
          error={e.odometerKm?.message}
          {...register('odometerKm')}
        />
      </FormSection>

      <FormSection title="기타" columns={1}>
        <TextareaField label="비고" error={e.remark?.message} {...register('remark')} />
        <Checkbox
          label="사용중"
          description="끄면 배차 후보에서 빠집니다"
          {...register('isActive')}
        />
      </FormSection>
    </MasterFormDrawer>
  );
}
