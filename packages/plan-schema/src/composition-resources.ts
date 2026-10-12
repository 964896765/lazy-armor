import { z } from 'zod';

export const reportReadCapabilitySchema = z.enum(['READ_PUBLIC_HTTP_JSON', 'READ_PUBLIC_WEB_RESEARCH']);
/** Select existing connections, never provide authority, permissions or tool implementations. */
export const compositionResourceSelectionSchema = z.object({
  methodId: z.uuid(), capabilityKey: reportReadCapabilitySchema, connectionId: z.uuid(),
}).strict();
export const compositionResourceSelectionsSchema = z.array(compositionResourceSelectionSchema).max(6).superRefine((items, ctx) => {
  if (new Set(items.map(item => `${item.methodId}:${item.capabilityKey}`)).size !== items.length)
    ctx.addIssue({ code: 'custom', message: 'Choose one connection for each method capability' });
});
export const compositionReadBindingSchema = compositionResourceSelectionSchema.extend({
  authorityHash: z.string().regex(/^[a-f0-9]{64}$/), observedAt: z.iso.datetime(),
}).strict();
export const compositionReadBindingsSchema = z.array(compositionReadBindingSchema).max(6).superRefine((items, ctx) => {
  if (new Set(items.map(item => `${item.methodId}:${item.capabilityKey}`)).size !== items.length)
    ctx.addIssue({ code: 'custom', message: 'Each method capability binds once' });
  for (const item of items) if (items.some(other => other.connectionId === item.connectionId && other.capabilityKey === item.capabilityKey && other.authorityHash !== item.authorityHash))
    ctx.addIssue({ code: 'custom', message: 'Shared connections must retain one authority identity' });
});
export const compositionResourceOptionsSchema = z.object({
  conversationId: z.uuid(), conversationVersion: z.number().int().nonnegative(), executionAuthorized: z.literal(false),
  requirements: z.array(z.object({ methodId: z.uuid(), capabilityKey: reportReadCapabilitySchema,
    candidates: z.array(z.object({ connectionId: z.uuid(), name: z.string().max(200) }).strict()).max(20),
  }).strict()).max(6),
}).strict();
export type CompositionResourceSelection = z.infer<typeof compositionResourceSelectionSchema>;
export type CompositionReadBinding = z.infer<typeof compositionReadBindingSchema>;
export type CompositionResourceOptions = z.infer<typeof compositionResourceOptionsSchema>;
