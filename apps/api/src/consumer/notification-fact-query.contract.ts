import { z } from 'zod';

/** AI proposes a bounded read requirement; source selection and authority are server-owned. */
export const notificationFactQuerySchema = z.object({
  factKey: z.literal('shipment.status'),
  sourcePackage: z.string().min(3).max(255).regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/),
  lookbackHours: z.number().int().min(1).max(168),
}).strict();
export type NotificationFactQuery = z.infer<typeof notificationFactQuerySchema>;
