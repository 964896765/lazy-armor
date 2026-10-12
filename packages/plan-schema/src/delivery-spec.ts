import { z } from 'zod';
import { goalBriefRefSchema } from './goal-brief';

/** A bounded report delivery promise. Does not grant resource access or execution. */
export const deliverySpecSchema = z.object({
  schemaVersion: z.literal('delivery-spec.v1'),
  kind: z.literal('REPORT'),
  goalBriefRef: goalBriefRefSchema,
  title: z.string().trim().min(1).max(200),
  sections: z.array(z.string().trim().min(1).max(100)).min(1).max(12),
  acceptance: z.array(z.enum(['REPORT_SECTIONS', 'SOURCE_PROVENANCE', 'ASSUMPTIONS_DISCLOSED', 'CALCULATIONS_CHECKED', 'USER_REVIEW'])).min(1).max(5),
  limitations: z.array(z.string().trim().min(1).max(500)).max(8),
  executionAuthorized: z.literal(false),
}).strict();
export type DeliverySpec = z.infer<typeof deliverySpecSchema>;
