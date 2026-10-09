import { z } from 'zod';
import { userEventInputSchema } from './user-event';
import { userEventExternalSyncIntentSchema } from './user-event-sync';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Server-owned reference to authority; never a replacement for permission or verification. */
export const runtimeAuthoritySourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PLAN'), ownerId: z.string().uuid(), planId: z.string().uuid(), planVersionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('USER_EVENT_SYNC'), ownerId: z.string().uuid(), requestId: z.string().uuid(), userEventId: z.string().uuid(), userEventVersion: z.number().int().positive(), contractHash: hash }).strict(),
]);
export type RuntimeAuthoritySource = z.infer<typeof runtimeAuthoritySourceSchema>;

/** Immutable confirmation inputs. Resource selection, approval and Invocation come later. */
const confirmedUserEventSyncCreateContractSchema = z.object({
  schema: z.literal('user-event-sync-confirmation.v1'),
  requestId: z.string().uuid(),
  ownerId: z.string().uuid(),
  userEventId: z.string().uuid(),
  userEventVersion: z.number().int().positive(),
  proposalMessageId: z.string().uuid(),
  userEvent: userEventInputSchema,
  intent: userEventExternalSyncIntentSchema,
  sourceTruthRefs: z.array(z.object({truthId:z.string().uuid(),versionId:z.string().uuid(),valueHash:hash}).strict()).max(30).optional(),
}).strict();
/** A change confirms one proven external identity, never a caller-selected event. */
export const userEventSyncMutationIdentitySchema = z.object({
  previousRequestId: z.string().uuid(),
  targetId: z.string().uuid(),
  trustedDeviceId: z.string().uuid(),
  calendarId: z.string().regex(/^[1-9][0-9]*$/).refine(value => Number.isSafeInteger(Number(value))),
  externalEventId: z.string().regex(/^[1-9][0-9]*$/).refine(value => Number.isSafeInteger(Number(value))),
  operationMarker: z.string().regex(/^lazyarmor-operation:[a-f0-9]{64}$/),
  verificationRef: z.string().regex(/^verification:[0-9a-f-]{36}$/i),
  syncedUserEventVersion: z.number().int().positive(),
}).strict();
const confirmedUserEventSyncMutationContractSchema = confirmedUserEventSyncCreateContractSchema.extend({
  schema: z.literal('user-event-sync-confirmation.v2'),
  operation: z.enum(['UPDATE', 'DELETE']),
  externalIdentity: userEventSyncMutationIdentitySchema,
}).strict().superRefine((value, ctx) => {
  if (value.externalIdentity.previousRequestId === value.requestId || value.externalIdentity.syncedUserEventVersion >= value.userEventVersion) {
    ctx.addIssue({code:'custom',message:'A mutation must confirm a newer internal version against an earlier verified request'});
  }
});
// Keep v1 parsing/canonical bytes unchanged for every historical create request.
export const confirmedUserEventSyncContractSchema = z.union([
  confirmedUserEventSyncCreateContractSchema,
  confirmedUserEventSyncMutationContractSchema,
]);
export type ConfirmedUserEventSyncContract = z.infer<typeof confirmedUserEventSyncContractSchema>;

/** Binding checks shared by dispatch and executor, while historical Plan envelopes remain valid. */
export function assertRuntimeAuthorityBinding(source: RuntimeAuthoritySource, binding: {
  userId: string; planId: string | null; planVersionId: string | null;
}) {
  const parsed = runtimeAuthoritySourceSchema.parse(source);
  if (parsed.ownerId !== binding.userId) throw new Error('RUNTIME_AUTHORITY_OWNER_MISMATCH');
  if (parsed.kind === 'PLAN') {
    if (parsed.planId !== binding.planId || parsed.planVersionId !== binding.planVersionId) throw new Error('RUNTIME_PLAN_AUTHORITY_MISMATCH');
  } else if (binding.planId !== null || binding.planVersionId !== null) {
    throw new Error('RUNTIME_AUTHORITY_SOURCE_CONFLICT');
  }
  return parsed;
}
