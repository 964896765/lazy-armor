import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consumerConversations, consumerMessages, createDatabase, recurringItemProfiles, userEventSyncRequests, users } from '@lazy-armor/database';
import { catalogHash, type ConfirmedUserEventSyncContract, type RuntimeAuthoritySource } from '@lazy-armor/plan-schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { RuntimeAuthorityService } from '../src/execution/runtime-authority.service';
import { UserEventSyncRequestsService } from '../src/profiles/user-event-sync-requests.service';
import { AuditService } from '../src/audit/audit.service';
import { SnapshotSanitizer } from '../src/common/snapshot-sanitizer.service';

/** Isolated DB fixtures, not real user authoring or a Golden Flow. */
describe.sequential('multi-source Runtime authority transaction gate', () => {
  let store: ReturnType<typeof createDatabase>, guard: RuntimeAuthorityService;
  const owner = randomUUID(), eventId = randomUUID(), requestId = randomUUID(), proposalId = randomUUID();
  const event = { title: '去医院', dueAt: '2026-10-08T15:00:00+08:00', reminderAt: '2026-10-08T14:45:00+08:00', timezone: 'Asia/Shanghai' };
  const contract: ConfirmedUserEventSyncContract = { schema: 'user-event-sync-confirmation.v1', requestId, ownerId: owner, userEventId: eventId, userEventVersion: 1, proposalMessageId: proposalId, userEvent: event, intent: { kind: 'EXTERNAL_CALENDAR_SYNC', policy: 'CONFIRM_CHANGES', destination: 'PHONE_CALENDAR', durationMinutes: 30 } };
  const source: RuntimeAuthoritySource = { kind: 'USER_EVENT_SYNC', ownerId: owner, requestId, userEventId: eventId, userEventVersion: 1, contractHash: catalogHash(contract) };
  const binding = { userId: owner, planId: null, planVersionId: null };
  const m = { schema: 'user-event.v1', version: 1, ...event, conversationId: randomUUID(), proposalMessageId: proposalId, remindedAt: null, reminderAtEpochMs: Date.parse(event.reminderAt) };
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Authority integration requires an explicit isolated *_test database');
    store = createDatabase(url); guard = new RuntimeAuthorityService(store.db);
    const now = new Date();
    await store.db.insert(users).values({ id: owner, status: 'active', role: 'user', createdAt: now, updatedAt: now });
    await store.db.insert(recurringItemProfiles).values({ id: eventId, userId: owner, domain: 'personal', category: 'USER_EVENT', title: event.title, nextDueAt: new Date(event.dueAt), recurrenceDays: null, remindBeforeDays: 0, status: 'active', sourceType: 'user_event', metadataJson: m, createdAt: now, updatedAt: now });
    await store.db.insert(userEventSyncRequests).values({ id: requestId, userId: owner, userEventId: eventId, userEventVersion: 1, proposalMessageId: proposalId, contractHash: catalogHash(contract), contractJson: contract as unknown as Record<string, unknown>, confirmedAt: now, revokedAt: null });
  });
  afterAll(async () => { await store?.pool.end(); });
  const check = (s = source, b = binding, op: 'WRITE' | 'RECONCILE' = 'WRITE') => store.db.transaction(tx => guard.assertCurrent(tx, s, b, op));
  it('accepts a confirmed immutable USER_EVENT source without any Plan', async () => {
    expect((await check()).contract).toEqual(contract);
  });
  it('rejects mixed Plan identity, another owner and another request version', async () => {
    await expect(check(source, { ...binding, planId: randomUUID() })).rejects.toThrow('RUNTIME_AUTHORITY_BINDING_INVALID');
    await expect(check(source, { ...binding, userId: randomUUID() })).rejects.toThrow('RUNTIME_AUTHORITY_BINDING_INVALID');
    await expect(check({ ...source, userEventVersion: 2 })).rejects.toThrow('SYNC_AUTHORITY_CONTRACT_MISMATCH');
  });
  it('rejects input tampering even when the item version was not advanced', async () => {
    await store.db.update(recurringItemProfiles).set({ title: 'unconfirmed change' }).where(eq(recurringItemProfiles.id, eventId));
    await expect(check()).rejects.toThrow('SYNC_USER_EVENT_SNAPSHOT_MISMATCH');
    await store.db.update(recurringItemProfiles).set({ title: event.title }).where(eq(recurringItemProfiles.id, eventId));
  });
  it('rejects writes after edit/cancel but preserves lookup authority for the original operation', async () => {
    await store.db.update(recurringItemProfiles).set({ status: 'cancelled', metadataJson: { ...m, version: 2 } }).where(eq(recurringItemProfiles.id, eventId));
    await expect(check()).rejects.toThrow('SYNC_AUTHORITY_SUPERSEDED_OR_REVOKED');
    expect((await check(source, binding, 'RECONCILE')).contract?.userEventVersion).toBe(1);
    await store.db.update(userEventSyncRequests).set({ revokedAt: new Date() }).where(eq(userEventSyncRequests.id, requestId));
    await expect(check()).rejects.toThrow('SYNC_AUTHORITY_SUPERSEDED_OR_REVOKED');
    expect((await check(source, binding, 'RECONCILE')).source.kind).toBe('USER_EVENT_SYNC');
  });
  it('rejects a corrupted confirmation hash in both write and read-only recovery paths', async () => {
    await store.db.update(userEventSyncRequests).set({ contractJson: { ...contract, intent: { ...contract.intent, durationMinutes: 60 } } }).where(eq(userEventSyncRequests.id, requestId));
    await expect(check()).rejects.toThrow('SYNC_AUTHORITY_CONTRACT_MISMATCH');
    await expect(check(source, binding, 'RECONCILE')).rejects.toThrow('SYNC_AUTHORITY_CONTRACT_MISMATCH');
  });
  it('persists only a frozen latest proposal and replays the same authority source', async () => {
    const conversationId = randomUUID(), messageId = randomUUID(), itemId = randomUUID(), now = new Date();
    await store.db.insert(consumerConversations).values({ id: conversationId, userId: owner, mode: 'TEMPORARY', title: 'Explicit sync fixture', status: 'USER_EVENT_CONFIRMED', version: 1, createdAt: now, updatedAt: now });
    await store.db.insert(consumerMessages).values({ id: messageId, conversationId, requestId: randomUUID(), role: 'assistant', content: 'Isolated explicit synchronization proposal', structuredPayload: { result: 'USER_EVENT_DRAFT', userEvent: event, externalSync: contract.intent, validationErrors: [] }, contextRefs: [], createdAt: now });
    await store.db.insert(recurringItemProfiles).values({ id: itemId, userId: owner, domain: 'personal', category: 'USER_EVENT', title: event.title, nextDueAt: new Date(event.dueAt), recurrenceDays: null, remindBeforeDays: 0, status: 'active', sourceType: 'user_event', metadataJson: { ...m, conversationId, proposalMessageId: messageId }, createdAt: now, updatedAt: now });
    const service = new UserEventSyncRequestsService(new AuditService(store.db, new SnapshotSanitizer()));
    const confirm = () => store.db.transaction(tx => service.createConfirmed(tx, owner, conversationId, messageId, itemId, 1));
    const result = await confirm();
    expect(await confirm()).toEqual(result);
    const authorized = await store.db.transaction(tx => guard.assertCurrent(tx, result, binding));
    expect(authorized.contract?.userEventId).toBe(itemId);
    await store.db.update(recurringItemProfiles).set({ metadataJson: { ...m, conversationId, proposalMessageId: messageId, version: 2 } }).where(eq(recurringItemProfiles.id, itemId));
    await expect(confirm()).rejects.toThrow('SYNC_CONFIRMATION_AUTHORITY_INVALID');
    await expect(store.db.transaction(tx => guard.assertCurrent(tx, result, binding))).rejects.toThrow('SYNC_AUTHORITY_SUPERSEDED_OR_REVOKED');
    expect((await store.db.transaction(tx => guard.assertCurrent(tx, result, binding, 'RECONCILE'))).contract?.userEventVersion).toBe(1);
  });
});
