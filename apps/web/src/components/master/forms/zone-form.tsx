'use client';

import { zoneFormSchema, type ZoneFormInput } from '@ntms/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { TextField } from '@/components/ui/text-field';
import { FormSection, MasterFormDrawer } from '@/components/master/master-form-drawer';
import { useMasterForm } from '@/components/master/use-master-form';

/**
 * 권역 등록 · 수정.
 *
 * 권역은 거점을 묶는 상자다. 권역별 운임표가 이 묶음을 조건으로 쓰므로,
 * 권역을 바꾸면 그 권역에 걸린 운임이 함께 움직인다.
 *
 * 칸이 네 개뿐이라 서랍도 좁게 연다. 넓은 판에 네 칸만 있으면 오른쪽이
 * 텅 빈 채로 보인다.
 */
const BLANK: ZoneFormInput = {
  zoneCode: '',
  zoneName: '',
  centerLatitude: '',
  centerLongitude: '',
  sortOrder: '',
  isActive: true,
};

export function ZoneForm({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { form, loading, submitting, formError, submit, isEdit } =
    useMasterForm<ZoneFormInput>({
      resource: 'zones',
      id,
      open,
      schema: zoneFormSchema,
      blank: BLANK as never,
      // 권역 이름은 거점 목록의 권역 열에도 실린다
      listKeys: ['master-locations'],
      onSaved: onClose,
    });

  const { register, formState } = form;
  const e = formState.errors;

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? '권역 수정' : '권역 등록'}
      subtitle={loading ? '불러오는 중…' : '거점을 묶는 단위입니다. 권역별 운임이 이 묶음을 씁니다.'}
      width="sm"
      submitting={submitting}
      error={formError}
      onSubmit={submit}
      submitLabel={isEdit ? '저장' : '등록'}
    >
      <FormSection title="기본" columns={1}>
        <TextField
          label="코드"
          required
          placeholder="ZN-CAP"
          error={e.zoneCode?.message}
          {...register('zoneCode')}
        />
        <TextField
          label="권역명"
          required
          placeholder="수도권"
          error={e.zoneName?.message}
          {...register('zoneName')}
        />
      </FormSection>

      <FormSection
        title="중심 좌표"
        description="권역 단위로 거리를 어림잡을 때 씁니다. 비워도 됩니다."
      >
        <TextField
          label="위도"
          inputMode="decimal"
          error={e.centerLatitude?.message}
          {...register('centerLatitude')}
        />
        <TextField
          label="경도"
          inputMode="decimal"
          error={e.centerLongitude?.message}
          {...register('centerLongitude')}
        />
      </FormSection>

      <FormSection title="기타" columns={1}>
        <TextField
          label="정렬 순서"
          hint="작을수록 목록 위에 옵니다"
          inputMode="numeric"
          error={e.sortOrder?.message}
          {...register('sortOrder')}
        />
        <Checkbox label="사용중" {...register('isActive')} />
      </FormSection>
    </MasterFormDrawer>
  );
}
