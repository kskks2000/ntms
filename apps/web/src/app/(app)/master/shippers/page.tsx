'use client';

import { Building2 } from 'lucide-react';
import type { PartnerListItem } from '@ntms/shared';
import { MasterPage } from '@/components/master/master-page';
import { shipperColumns } from '@/components/master/partner-columns';

/** 화주 — 물동량을 맡기는 쪽. 이번 달 얼마나 맡겼는지가 첫 질문이다 */
export default function ShippersPage() {
  return (
    <MasterPage<PartnerListItem>
      eyebrow="Master"
      title="화주"
      description="운송을 맡기는 거래처입니다. 이번 달 물동량과 정산 조건을 함께 봅니다."
      endpoint="/master/partners"
      fixedFilter="SHIPPER"
      queryKey="master-shippers"
      columns={shipperColumns}
      getRowKey={(p) => p.partnerId}
      searchPlaceholder="화주명 · 코드 · 사업자번호"
      emptyIcon={<Building2 size={26} strokeWidth={1.5} />}
      emptyTitle="등록된 화주가 없습니다"
      emptyDescription="화주를 등록하면 오더를 접수하고 매출 정산을 걸 수 있습니다."
      createLabel="화주 등록"
    />
  );
}
