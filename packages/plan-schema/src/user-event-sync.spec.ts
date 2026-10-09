import { describe, expect, it } from 'vitest';
import { assessUserEventSync, userEventAuthoringSchema, userEventExternalLinkSchema } from './user-event-sync';
import type { UserEventView } from './user-event';

const owner = '10000000-0000-4000-8000-000000000001';
const event: UserEventView = { id: '10000000-0000-4000-8000-000000000002', kind: 'USER_EVENT', title: '去医院', dueAt: '2026-10-08T15:00:00+08:00', reminderAt: '2026-10-08T14:45:00+08:00', timezone: 'Asia/Shanghai', version: 1, status: 'active', remindedAt: null, completedAt: null };
const link = { schema: 'user-event-external-link.v1', id: '10000000-0000-4000-8000-000000000003', userId: owner, userEventId: event.id, policy: 'CONFIRM_CHANGES', targetId: null, capabilityId: 'calendar.event.create', externalResourceType: 'CalendarEvent', externalResourceId: null, lastSyncedUserEventVersion: null, syncState: 'REQUESTED', lastInvocationId: null, lastVerificationRef: null, lastSyncedAt: null };
const verified = { ...link, targetId: '10000000-0000-4000-8000-000000000004', externalResourceId: '18', lastSyncedUserEventVersion: 1, syncState: 'VERIFIED', lastInvocationId: '10000000-0000-4000-8000-000000000005', lastVerificationRef: 'verification:committed', lastSyncedAt: '2026-10-08T06:00:00Z' };

describe('explicit internal-item external synchronization contract', () => {
  it('keeps optional sync separate from internal input and rejects invented authority', () => {
    const { id, kind, status, version, remindedAt, completedAt, ...input } = event;
    expect(userEventAuthoringSchema.parse({ userEvent: input, externalSync: null }).externalSync).toBeNull();
    const externalSync = { kind: 'EXTERNAL_CALENDAR_SYNC', policy: 'CONFIRM_CHANGES', destination: 'PHONE_CALENDAR', durationMinutes: 30 };
    expect(userEventAuthoringSchema.safeParse({ userEvent: input, externalSync }).success).toBe(true);
    expect(userEventAuthoringSchema.safeParse({ userEvent: input, externalSync: { ...externalSync, approved: true } }).success).toBe(false);
    expect(userEventAuthoringSchema.safeParse({ userEvent: input, externalSync: { ...externalSync, durationMinutes: undefined } }).success).toBe(false);
  });
  it('requires committed proof before calling the link verified', () => {
    expect(userEventExternalLinkSchema.safeParse({ ...link, syncState: 'VERIFIED' }).success).toBe(false);
    expect(userEventExternalLinkSchema.safeParse({ ...link, externalResourceId: 'unverified' }).success).toBe(false);
    expect(userEventExternalLinkSchema.safeParse(verified).success).toBe(true);
  });
  it('rejects another owner, another item and a future synced version', () => {
    expect(() => assessUserEventSync('10000000-0000-4000-8000-000000000099', event, link)).toThrow();
    expect(() => assessUserEventSync(owner, event, { ...link, userEventId: link.id })).toThrow();
    expect(() => assessUserEventSync(owner, event, { ...verified, lastSyncedUserEventVersion: 2 })).toThrow();
  });
  it('proposes create once, then update for edited or postponed versions', () => {
    expect(assessUserEventSync(owner, event, link).capability).toBe('calendar.event.create');
    expect(assessUserEventSync(owner, event, verified).state).toBe('NO_CHANGE');
    expect(assessUserEventSync(owner, { ...event, version: 2 }, verified).capability).toBe('calendar.event.update');
  });
  it('does not redispatch uncertain side effects, even after internal cancellation', () => {
    const unknown = { ...link, syncState: 'OUTCOME_UNKNOWN' };
    expect(assessUserEventSync(owner, event, unknown)).toEqual({ state: 'RECONCILE', capability: null });
    expect(assessUserEventSync(owner, { ...event, status: 'cancelled', version: 2 }, unknown).state).toBe('RECONCILE');
    expect(assessUserEventSync(owner, { ...event, version: 2 }, { ...verified, syncState: 'RUNNING' }).state).toBe('WAIT');
  });
  it('completion leaves the external event intact; cancellation only proposes removal', () => {
    expect(assessUserEventSync(owner, { ...event, status: 'completed', version: 2 }, verified).state).toBe('NO_CHANGE');
    expect(assessUserEventSync(owner, { ...event, status: 'cancelled', version: 2 }, verified).capability).toBe('calendar.event.delete');
    expect(assessUserEventSync(owner, { ...event, status: 'cancelled', version: 2 }, link).state).toBe('NO_CHANGE');
  });
});
