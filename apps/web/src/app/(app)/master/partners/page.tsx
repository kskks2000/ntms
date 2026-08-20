'use client';

import { Contact } from 'lucide-react';
import type { PartnerListItem } from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { partnerColumns } from '@/components/master/partner-columns';
import { PartnerForm } from '@/components/master/forms/partner-form';

/**
 * 거래처 — 화주 · 운송사 · 수하처를 통틀어 본다.
 * 한 회사가 화주이면서 운송사인 경우가 실제로 흔해서, 역할을 배지로 겹쳐 보인다.
 */
export default function PartnersPage() {
  return (
    <MasterPage<PartnerListItem>
      eyebrow="Master"
      title="거래처"
      description="화주 · 운송사 · 수하처를 통틀어 봅니다. 한 회사가 여러 역할을 겸할 수 있습니다."
      endpoint="/master/partners"
      queryKey="master-partners"
      columns={partnerColumns}
      getRowKey={(p) => p.partnerId}
      filters={[
        { value: 'SHIPPER', label: '화주' },
        { value: 'CARRIER', label: '운송사' },
        { value: 'CONSIGNEE', label: '수하처' },
        { value: 'VENDOR', label: '매입처' },
      ]}
      filterLabel="역할"
      searchPlaceholder="거래처명 · 코드 · 사업자번호"
      emptyIcon={<Contact size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 거래처가 없습니다"
      emptyDescription="거래처를 등록하면 화주 · 운송사 · 수하처로 지정할 수 있습니다."
      createLabel="거래처 등록"
      renderForm={({ open, id, onClose }) => (
        <PartnerForm
          open={open}
          id={id}
          preset="none"
          labels={{ entity: '거래처', nameLabel: '거래처명' }}
          onClose={onClose}
        />
      )}
    />
  );
}
