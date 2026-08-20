'use client';

import { Truck } from 'lucide-react';
import type { PartnerListItem } from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { carrierColumns } from '@/components/master/partner-columns';
import { PartnerForm } from '@/components/master/forms/partner-form';

/**
 * 운송사 — 차를 대는 쪽.
 * 배차 담당자가 여기서 찾는 것은 "누가 있나" 가 아니라
 * "지금 이 구간에 차를 댈 수 있나" 다. 그래서 보유 차량과 수락률이 앞에 온다.
 */
export default function CarriersPage() {
  return (
    <MasterPage<PartnerListItem>
      eyebrow="Master"
      title="운송사"
      description="차량을 대는 거래처입니다. 보유 자원과 배정 수락률로 배차 후보를 고릅니다."
      endpoint="/master/partners"
      fixedFilter="CARRIER"
      queryKey="master-carriers"
      columns={carrierColumns}
      getRowKey={(p) => p.partnerId}
      searchPlaceholder="운송사명 · 코드 · 사업자번호"
      emptyIcon={<Truck size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 운송사가 없습니다"
      emptyDescription="운송사를 등록해야 트립을 배정하고 배차할 수 있습니다."
      createLabel="운송사 등록"
      renderForm={({ open, id, onClose }) => (
        <PartnerForm
          open={open}
          id={id}
          preset="carrier"
          labels={{ entity: '운송사', nameLabel: '운송사명' }}
          onClose={onClose}
        />
      )}
    />
  );
}
