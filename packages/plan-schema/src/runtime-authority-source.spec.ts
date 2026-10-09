import { describe, expect, it } from 'vitest';
import { assertRuntimeAuthorityBinding, runtimeAuthoritySourceSchema, confirmedUserEventSyncContractSchema } from './runtime-authority-source';
const userId = '10000000-0000-4000-8000-000000000001';
const planId = '10000000-0000-4000-8000-000000000002';
const planVersionId = '10000000-0000-4000-8000-000000000003';
describe('Runtime controlled authority sources', () => {
  it('preserves full Plan identity and rejects an incomplete or swapped Plan source', () => {
    const plan = { kind: 'PLAN' as const, ownerId: userId, planId, planVersionId };
    expect(assertRuntimeAuthorityBinding(plan, { userId, planId, planVersionId })).toEqual(plan);
    expect(() => assertRuntimeAuthorityBinding(plan, { userId, planId, planVersionId: planId })).toThrow();
    expect(runtimeAuthoritySourceSchema.safeParse({ kind: 'PLAN', ownerId: userId, planId }).success).toBe(false);
  });
  it('requires independently frozen confirmation identity for USER_EVENT_SYNC', () => {
    const sync = { kind: 'USER_EVENT_SYNC' as const, ownerId: userId, requestId: planId, userEventId: planVersionId, userEventVersion: 1, contractHash: 'a'.repeat(64) };
    expect(assertRuntimeAuthorityBinding(sync, { userId, planId: null, planVersionId: null })).toEqual(sync);
    expect(() => assertRuntimeAuthorityBinding(sync, { userId, planId, planVersionId })).toThrow('RUNTIME_AUTHORITY_SOURCE_CONFLICT');
    expect(runtimeAuthoritySourceSchema.safeParse({ ...sync, approved: true }).success).toBe(false);
    expect(runtimeAuthoritySourceSchema.safeParse({ ...sync, contractHash: null }).success).toBe(false);
  });
});

describe('Frozen external change authority', () => {
  const create = {schema:'user-event-sync-confirmation.v1',requestId:planId,ownerId:userId,userEventId:planVersionId,userEventVersion:2,proposalMessageId:'10000000-0000-4000-8000-000000000004',userEvent:{title:'去医院',dueAt:'2026-10-08T15:00:00+08:00',reminderAt:'2026-10-08T14:45:00+08:00',timezone:'Asia/Shanghai'},intent:{kind:'EXTERNAL_CALENDAR_SYNC',policy:'CONFIRM_CHANGES',destination:'PHONE_CALENDAR',durationMinutes:30}};
  const mutation = {...create,schema:'user-event-sync-confirmation.v2',operation:'UPDATE',externalIdentity:{previousRequestId:'10000000-0000-4000-8000-000000000005',targetId:planId,trustedDeviceId:planVersionId,calendarId:'1',externalEventId:'19',operationMarker:'lazyarmor-operation:'+'a'.repeat(64),verificationRef:'verification:'+planId,syncedUserEventVersion:1}};
  it('preserves historical create bytes without adding defaults or mutation authority', () => {
    expect(confirmedUserEventSyncContractSchema.parse(create)).toEqual(create);
    expect(confirmedUserEventSyncContractSchema.safeParse({...create,operation:'DELETE'}).success).toBe(false);
  });
  it('requires verified exact external scope and a newer confirmed internal version', () => {
    expect(confirmedUserEventSyncContractSchema.parse(mutation)).toEqual(mutation);
    for(const externalIdentity of [{...mutation.externalIdentity,externalEventId:'*'},{...mutation.externalIdentity,calendarId:'9007199254740992'},{...mutation.externalIdentity,operationMarker:'arbitrary'},{...mutation.externalIdentity,syncedUserEventVersion:2},{...mutation.externalIdentity,previousRequestId:planId}]) {
      expect(confirmedUserEventSyncContractSchema.safeParse({...mutation,externalIdentity}).success).toBe(false);
    }
    expect(confirmedUserEventSyncContractSchema.safeParse({...mutation,externalIdentity:undefined}).success).toBe(false);
  });
  it('keeps delete explicit and rejects completion as an external mutation', () => {
    expect(confirmedUserEventSyncContractSchema.safeParse({...mutation,operation:'DELETE'}).success).toBe(true);
    expect(confirmedUserEventSyncContractSchema.safeParse({...mutation,operation:'COMPLETE'}).success).toBe(false);
    expect(confirmedUserEventSyncContractSchema.safeParse({...mutation,approved:true}).success).toBe(false);
  });
});
