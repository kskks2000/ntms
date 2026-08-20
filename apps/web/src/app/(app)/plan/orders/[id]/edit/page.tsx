'use client';

import { use } from 'react';
import { OrderForm } from '@/components/order/order-form';

/** 오더 수정 — 편성 전까지만 열려 있다. 그 뒤로는 서버가 막는다 */
export default function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <OrderForm orderId={id} />;
}
