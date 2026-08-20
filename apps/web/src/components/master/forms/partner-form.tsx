'use client';

import {
  PARTNER_GRADES,
  SETTLEMENT_CYCLES,
  SETTLEMENT_CYCLE_LABEL,
  partnerFormSchema,
  type PartnerFormInput,
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
import { toEnumOptions, useMasterForm } from '@/components/master/use-master-form';

/**
 * 거래처 등록 · 수정.
 *
 * 화주 · 운송사 · 거래처 세 화면이 이 폼 하나를 쓴다. business_partner 가
 * 한 테이블이므로 폼도 하나여야 한다 — 화면별로 폼을 나누면 화주 화면에서
 * 등록한 회사에는 운송사 칸이 비어 있고, 나중에 그 회사가 차를 대기
 * 시작하면 어느 화면에서 고쳐야 할지 알 수 없게 된다.
 *
 * 대신 **어느 화면에서 열었는지에 따라 역할을 미리 켜 둔다.** 화주 목록에서
 * "화주 등록" 을 눌렀는데 역할을 다시 골라야 하면 한 번 더 묻는 셈이다.
 */
const GRADE_LABEL: Record<string, string> = {
  S: 'S — 최우수',
  A: 'A — 우수',
  B: 'B — 보통',
  C: 'C — 주의',
  D: 'D — 거래제한',
};

/** 등록 시 켜 둘 역할. 화주 화면에서 열면 화주로 시작한다 */
export type PartnerRolePreset = 'shipper' | 'carrier' | 'none';

const BLANK: PartnerFormInput = {
  partnerCode: '',
  partnerName: '',
  isShipper: false,
  isCarrier: false,
  isConsignee: false,
  isVendor: false,
  businessNo: '',
  ceoName: '',
  grade: null,
  tel: '',
  email: '',
  address1: '',
  managerName: '',
  managerTel: '',
  settlementCycle: 'MONTHLY',
  closingDay: '',
  paymentTermsDays: '',
  creditLimit: '',
  remark: '',
  isActive: true,
};

export function PartnerForm({
  open,
  id,
  preset,
  labels,
  onClose,
}: {
  open: boolean;
  id: string | null;
  preset: PartnerRolePreset;
  /** 화면마다 부르는 이름이 다르다 — 화주 · 운송사 · 거래처 */
  labels: { entity: string; nameLabel: string };
  onClose: () => void;
}) {
  const { form, loading, submitting, deleting, formError, submit, remove, isEdit } =
    useMasterForm<PartnerFormInput>({
      resource: 'partners',
      id,
      open,
      schema: partnerFormSchema,
      blank: {
        ...BLANK,
        isShipper: preset === 'shipper',
        isCarrier: preset === 'carrier',
      } as never,
      // 한 회사를 고치면 세 목록이 같이 달라진다
      listKeys: ['master-shippers', 'master-carriers', 'master-partners'],
      entityLabel: labels.entity,
      onSaved: onClose,
    });

  const { register, formState } = form;
  const e = formState.errors;

  return (
    <MasterFormDrawer
      open={open}
      onClose={onClose}
      title={isEdit ? `${labels.entity} 수정` : `${labels.entity} 등록`}
      subtitle={
        loading
          ? '불러오는 중…'
          : '한 회사가 여러 역할을 겸할 수 있습니다. 해당하는 역할을 모두 고르세요.'
      }
      width="md"
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
          hint="영문 대문자 · 숫자 · - _"
          placeholder="SH-1005"
          error={e.partnerCode?.message}
          {...register('partnerCode')}
        />
        <TextField
          label={labels.nameLabel}
          required
          error={e.partnerName?.message}
          {...register('partnerName')}
        />
        <TextField
          label="사업자등록번호"
          hint="하이픈은 넣어도 됩니다"
          placeholder="123-45-67890"
          error={e.businessNo?.message}
          {...register('businessNo')}
        />
        <TextField label="대표자" error={e.ceoName?.message} {...register('ceoName')} />
      </FormSection>

      <FormSection
        title="역할"
        description="역할이 하나도 없으면 어느 목록에도 나타나지 않습니다."
        columns={1}
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Checkbox
            label="화주"
            description="운송을 맡기는 쪽"
            error={e.isShipper?.message}
            {...register('isShipper')}
          />
          <Checkbox label="운송사" description="차를 대는 쪽" {...register('isCarrier')} />
          <Checkbox label="수하처" description="화물을 받는 쪽" {...register('isConsignee')} />
          <Checkbox
            label="매입처"
            description="유류 · 정비 등 원가"
            {...register('isVendor')}
          />
        </div>
      </FormSection>

      <FormSection title="연락">
        <SelectField
          label="등급"
          placeholder="미지정"
          options={toEnumOptions(PARTNER_GRADES, GRADE_LABEL)}
          error={e.grade?.message}
          {...register('grade')}
        />
        <TextField label="대표 전화" error={e.tel?.message} {...register('tel')} />
        <TextField label="담당자" error={e.managerName?.message} {...register('managerName')} />
        <TextField
          label="담당자 연락처"
          error={e.managerTel?.message}
          {...register('managerTel')}
        />
        <FormFull>
          <TextField label="이메일" type="email" error={e.email?.message} {...register('email')} />
        </FormFull>
        <FormFull>
          <TextField label="주소" error={e.address1?.message} {...register('address1')} />
        </FormFull>
      </FormSection>

      <FormSection
        title="정산 조건"
        description="청구서를 언제 끊고 언제 주고받는지입니다. 정산 화면이 이 값을 씁니다."
      >
        <SelectField
          label="정산 주기"
          options={toEnumOptions(SETTLEMENT_CYCLES, SETTLEMENT_CYCLE_LABEL)}
          error={e.settlementCycle?.message}
          {...register('settlementCycle')}
        />
        <TextField
          label="마감일"
          hint="1~31. 말일은 31"
          inputMode="numeric"
          error={e.closingDay?.message}
          {...register('closingDay')}
        />
        <TextField
          label="유예일"
          hint="마감 후 지급까지의 일수"
          inputMode="numeric"
          error={e.paymentTermsDays?.message}
          {...register('paymentTermsDays')}
        />
        <TextField
          label="여신한도"
          hint="원. 화주에게만 씁니다"
          inputMode="numeric"
          error={e.creditLimit?.message}
          {...register('creditLimit')}
        />
      </FormSection>

      <FormSection title="기타" columns={1}>
        <TextareaField
          label="비고"
          placeholder="다른 칸에 담기지 않는 사정을 적습니다"
          error={e.remark?.message}
          {...register('remark')}
        />
        <Checkbox
          label="사용중"
          description="끄면 새 오더와 배정에서 고를 수 없습니다"
          {...register('isActive')}
        />
      </FormSection>
    </MasterFormDrawer>
  );
}
