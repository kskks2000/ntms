'use client';

import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABEL,
  locationFormSchema,
  type LocationFormInput,
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
 * 상하차지 등록 · 수정.
 *
 * 이 폼은 주소록이 아니다. 여기 적는 숫자가 그대로 편성 엔진의 입력이
 * 된다 — 운영시간이 시간창을, 표준 작업시간이 정차 시간을, 좌표가 구간
 * 거리를 정한다. 그래서 각 묶음에 "무엇을 정하는 값인지" 를 적어 둔다.
 */
const BLANK: LocationFormInput = {
  locationCode: '',
  locationName: '',
  locationType: 'WAREHOUSE',
  zoneId: '',
  partnerId: '',
  address1: '',
  address2: '',
  latitude: '',
  longitude: '',
  geoVerified: false,
  tel: '',
  managerName: '',
  openTime: '',
  closeTime: '',
  standardLoadMin: '',
  standardUnloadMin: '',
  dockCount: '',
  hasForklift: false,
  requireReservation: false,
  isPickupAvailable: true,
  isDeliveryAvailable: true,
  remark: '',
  isActive: true,
};

export function LocationForm({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { form, options, loading, submitting, deleting, formError, submit, remove, isEdit } =
    useMasterForm<LocationFormInput>({
      resource: 'locations',
      id,
      open,
      schema: locationFormSchema,
      blank: BLANK as never,
      // 거점이 바뀌면 라우트 목록의 구간 이름도 따라 바뀐다
      listKeys: ['master-locations', 'master-routes'],
      entityLabel: '거점',
      onSaved: onClose,
    });

  const { register, watch, formState } = form;
  const e = formState.errors;
  const lat = watch('latitude');

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? '거점 수정' : '거점 등록'}
      subtitle={
        loading ? '불러오는 중…' : '여기 적는 시간과 좌표가 그대로 편성에 쓰입니다.'
      }
      width="lg"
      submitting={submitting}
      deleting={deleting}
      // 등록 중에는 지울 것이 없다
      onDelete={isEdit ? remove : undefined}
      error={formError}
      onSubmit={submit}
      submitLabel={isEdit ? '저장' : '등록'}
    >
      <FormSection title="기본">
        <TextField
          label="코드"
          required
          placeholder="LC-PJDC"
          error={e.locationCode?.message}
          {...register('locationCode')}
        />
        <TextField
          label="거점명"
          required
          error={e.locationName?.message}
          {...register('locationName')}
        />
        <SelectField
          label="유형"
          options={toEnumOptions(LOCATION_TYPES, LOCATION_TYPE_LABEL)}
          hint="유형에 따라 운영 조건이 크게 다릅니다"
          error={e.locationType?.message}
          {...register('locationType')}
        />
        <SelectField
          label="권역"
          placeholder="미지정"
          options={toSelectOptions(options?.zones)}
          error={e.zoneId?.message}
          {...register('zoneId')}
        />
        <FormFull>
          <SelectField
            label="소유 거래처"
            placeholder="자사"
            hint="화주나 수하처의 거점이면 그 회사를 고릅니다"
            options={toSelectOptions(options?.partners)}
            error={e.partnerId?.message}
            {...register('partnerId')}
          />
        </FormFull>
      </FormSection>

      <FormSection
        title="위치"
        description="좌표가 없거나 검증되지 않으면 구간 거리가 틀어집니다."
      >
        <FormFull>
          <TextField
            label="주소"
            required
            error={e.address1?.message}
            {...register('address1')}
          />
        </FormFull>
        <FormFull>
          <TextField
            label="상세 주소"
            error={e.address2?.message}
            {...register('address2')}
          />
        </FormFull>
        <TextField
          label="위도"
          placeholder="37.7"
          inputMode="decimal"
          error={e.latitude?.message}
          {...register('latitude')}
        />
        <TextField
          label="경도"
          placeholder="126.75"
          inputMode="decimal"
          error={e.longitude?.message}
          {...register('longitude')}
        />
        <FormFull>
          <Checkbox
            label="좌표 확인함"
            description={
              lat === '' || lat === null
                ? '좌표를 넣어야 켤 수 있습니다'
                : '지도에서 실제 위치와 맞는지 확인했다는 뜻입니다'
            }
            {...register('geoVerified')}
          />
        </FormFull>
      </FormSection>

      <FormSection
        title="운영시간"
        description="편성이 이 시간 안에서만 상·하차를 잡습니다. 24시간이면 00:00–23:59."
      >
        <TextField
          label="여는 시각"
          type="time"
          error={e.openTime?.message}
          {...register('openTime')}
        />
        <TextField
          label="닫는 시각"
          type="time"
          error={e.closeTime?.message}
          {...register('closeTime')}
        />
      </FormSection>

      <FormSection
        title="작업 조건"
        description="표준 작업시간이 트립의 정차 시간이 됩니다."
      >
        <TextField
          label="표준 상차시간"
          hint="분"
          inputMode="numeric"
          error={e.standardLoadMin?.message}
          {...register('standardLoadMin')}
        />
        <TextField
          label="표준 하차시간"
          hint="분"
          inputMode="numeric"
          error={e.standardUnloadMin?.message}
          {...register('standardUnloadMin')}
        />
        <TextField
          label="도크 수"
          inputMode="numeric"
          error={e.dockCount?.message}
          {...register('dockCount')}
        />
        <TextField label="대표 전화" error={e.tel?.message} {...register('tel')} />
        <TextField
          label="담당자"
          error={e.managerName?.message}
          {...register('managerName')}
        />
        <FormFull>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Checkbox label="지게차 있음" {...register('hasForklift')} />
            <Checkbox
              label="예약 필수"
              description="사전 예약 없이 들어갈 수 없음"
              {...register('requireReservation')}
            />
            <Checkbox label="상차 가능" {...register('isPickupAvailable')} />
            <Checkbox label="하차 가능" {...register('isDeliveryAvailable')} />
          </div>
        </FormFull>
      </FormSection>

      <FormSection title="기타" columns={1}>
        <TextareaField
          label="비고"
          placeholder="게이트 통과증 필요, 야간 반입 불가 …"
          error={e.remark?.message}
          {...register('remark')}
        />
        <Checkbox
          label="사용중"
          description="끄면 새 오더에서 고를 수 없습니다"
          {...register('isActive')}
        />
      </FormSection>
    </MasterFormDrawer>
  );
}
