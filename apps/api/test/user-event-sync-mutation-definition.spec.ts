import { describe, expect, it } from 'vitest';
import { confirmedUserEventSyncContractSchema } from '@lazy-armor/plan-schema';
import { compileUserEventSyncDefinition } from '../src/execution/runtime-authority.service';

describe('mutations never become a create invocation', () => {
  it.each(['UPDATE','DELETE'])('compiles %s with exact external scope and fresh approval', operation => {
    const id='10000000-0000-4000-8000-000000000001';
    const contract=confirmedUserEventSyncContractSchema.parse({schema:'user-event-sync-confirmation.v2',requestId:id,ownerId:id,userEventId:id,userEventVersion:2,proposalMessageId:id,userEvent:{title:'去医院',dueAt:'2026-10-08T16:00:00+08:00',reminderAt:'2026-10-08T15:45:00+08:00',timezone:'Asia/Shanghai'},intent:{kind:'EXTERNAL_CALENDAR_SYNC',policy:'CONFIRM_CHANGES',destination:'PHONE_CALENDAR',durationMinutes:30},operation,externalIdentity:{previousRequestId:'10000000-0000-4000-8000-000000000002',targetId:id,trustedDeviceId:id,calendarId:'1',externalEventId:'19',operationMarker:'lazyarmor-operation:'+'a'.repeat(64),verificationRef:'verification:'+id,syncedUserEventVersion:1}});
    const definition=compileUserEventSyncDefinition(contract,'1');
    expect(definition.actions[0].requiredCapability).toBe(operation==='UPDATE'?'calendar.event.update':'calendar.event.delete');
    expect(definition.actions[0].config.calendarEvent).toBeUndefined();
    expect(definition.actions[0].config.calendarMutation).toMatchObject({calendarId:'1',eventId:'19',expectedOperationMarker:'lazyarmor-operation:'+'a'.repeat(64)});
    expect(definition.approvalPolicy).toMatchObject({type:'always'});
    expect(()=>compileUserEventSyncDefinition(contract,'2')).toThrow('SYNC_MUTATION_CALENDAR_SCOPE_MISMATCH');
  });
});
