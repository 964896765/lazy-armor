import { z } from 'zod';
import { userEventInputSchema, type UserEventView } from './user-event';

/** Proposal only. A resource hint grants neither target identity nor permission. */
export const userEventExternalSyncIntentSchema = z.object({
  kind: z.literal('EXTERNAL_CALENDAR_SYNC'),
  policy: z.literal('CONFIRM_CHANGES'),
  destination: z.literal('PHONE_CALENDAR'),
  durationMinutes: z.number().int().min(1).max(1440),
}).strict();

export const userEventAuthoringSchema = z.object({
  userEvent: userEventInputSchema,
  externalSync: userEventExternalSyncIntentSchema.nullable(),
}).strict();

/** Identity link is separate from the internal personal-item authority. */
export const userEventExternalLinkSchema = z.object({
  schema: z.literal('user-event-external-link.v1'),
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userEventId: z.string().uuid(),
  policy: z.literal('CONFIRM_CHANGES'),
  targetId: z.string().uuid().nullable(),
  capabilityId: z.enum(['calendar.event.create','calendar.event.update','calendar.event.delete']),
  externalResourceType: z.literal('CalendarEvent'),
  externalResourceId: z.string().min(1).max(512).nullable(),
  lastSyncedUserEventVersion: z.number().int().positive().nullable(),
  syncState: z.enum(['REQUESTED', 'WAITING_RESOURCE', 'WAITING_APPROVAL', 'RUNNING', 'OUTCOME_UNKNOWN', 'VERIFIED', 'CHANGE_PENDING', 'CANCEL_PENDING', 'FAILED', 'DELETED']),
  externalState: z.enum(['PRESENT','ABSENT']).optional(),
  lastInvocationId: z.string().uuid().nullable(),
  lastVerificationRef: z.string().min(1).max(512).nullable(),
  lastSyncedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((link, ctx) => {
  const hasProof = link.targetId && link.externalResourceId && link.lastInvocationId
    && link.lastVerificationRef && link.lastSyncedAt && link.lastSyncedUserEventVersion;
  if (['VERIFIED','DELETED'].includes(link.syncState) && !hasProof) {
    ctx.addIssue({ code: 'custom', message: 'Verified link requires committed external identity and verification references' });
  }
  if (link.lastSyncedUserEventVersion !== null && !hasProof) {
    ctx.addIssue({ code: 'custom', message: 'Synced version requires verification references' });
  }
  if (link.externalResourceId !== null && !hasProof) {
    ctx.addIssue({ code: 'custom', message: 'External identity must come from a verified synchronization' });
  }
  if ((link.syncState==='DELETED'||link.externalState==='ABSENT') && (link.capabilityId!=='calendar.event.delete'||!hasProof||link.externalState!=='ABSENT'||link.syncState!=='DELETED')) ctx.addIssue({code:'custom',message:'Deleted external identity requires a separate verified delete proof'});
});
export type UserEventExternalSyncIntent = z.infer<typeof userEventExternalSyncIntentSchema>;
export type UserEventExternalLink = z.infer<typeof userEventExternalLinkSchema>;

/** Decision helper, not a dispatcher. Never convert an uncertain create into another create. */
export function assessUserEventSync(userId: string, event: UserEventView, input: unknown): {
  state: 'NO_CHANGE' | 'CREATE_PROPOSAL' | 'UPDATE_PROPOSAL' | 'CANCEL_PROPOSAL' | 'RECONCILE' | 'WAIT';
  capability: 'calendar.event.create' | 'calendar.event.update' | 'calendar.event.delete' | null;
} {
  const link = userEventExternalLinkSchema.parse(input);
  if (link.userId !== userId || link.userEventId !== event.id) throw new Error('USER_EVENT_SYNC_OWNER_OR_IDENTITY_MISMATCH');
  if (link.lastSyncedUserEventVersion !== null && link.lastSyncedUserEventVersion > event.version) throw new Error('USER_EVENT_SYNC_FUTURE_VERSION');
  if (link.externalState==='ABSENT') return {state:'NO_CHANGE',capability:null};
  if (link.syncState === 'OUTCOME_UNKNOWN') return { state: 'RECONCILE', capability: null };
  // A request in flight must finish or reconcile before a new mutation can be proposed.
  if (['RUNNING', 'WAITING_APPROVAL'].includes(link.syncState)) return { state: 'WAIT', capability: null };
  if (event.status === 'completed') return { state: 'NO_CHANGE', capability: null };
  if (event.status === 'cancelled') return link.externalResourceId
    ? { state: 'CANCEL_PROPOSAL', capability: 'calendar.event.delete' }
    : { state: 'NO_CHANGE', capability: null };
  if (link.lastSyncedUserEventVersion === event.version) return { state: 'NO_CHANGE', capability: null };
  if (link.externalResourceId) return { state: 'UPDATE_PROPOSAL', capability: 'calendar.event.update' };
  return { state: 'CREATE_PROPOSAL', capability: 'calendar.event.create' };
}
