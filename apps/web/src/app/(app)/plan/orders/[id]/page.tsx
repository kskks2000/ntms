'use client';

import { use } from 'react';
import { OrderDetailView } from '@/components/order/order-detail-view';

/**
 * 오더 상세.
 *
 * 배차실에서 이 화면을 여는 이유는 대개 하나 — 화주가 전화해서 "그 건
 * 어떻게 됐냐" 고 물었을 때다. 그 질문에 스크롤 없이 답할 수 있어야 한다.
 */
export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <OrderDetailView orderId={id} />;
}
