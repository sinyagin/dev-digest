import { z } from 'zod';

export const OrderSchema = z.object({
  id: z.string(),
  total: z.number(),
  currency: z.enum(['USD', 'EUR']),
});
export type Order = z.infer<typeof OrderSchema>;
