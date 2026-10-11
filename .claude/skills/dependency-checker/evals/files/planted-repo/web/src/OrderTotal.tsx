import { useState } from 'react';
import { OrderSchema, type Order } from '@acme/shared';

export function OrderTotal({ raw }: { raw: unknown }) {
  const [order] = useState<Order>(() => OrderSchema.parse(raw));
  return <span>{order.total} {order.currency}</span>;
}
