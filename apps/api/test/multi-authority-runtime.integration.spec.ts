import { UserEventSyncLaunchService } from '../src/execution/user-event-sync-launch.service';
import { RuntimeSourceContinuationService } from '../src/execution/runtime-source-continuation.service';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { consumerConversations, consumerMessages, type Database } from '@lazy-armor/database';
import { canonicalStringify, LOCAL_CAPABILITY_CATALOG } from '@lazy-armor/plan-schema';
import { DATABASE } from '../src/common/database.module';
import { UserEventsService } from '../src/profiles/user-events.service';
import { UserEventSyncRequestsService } from '../src/profiles/user-event-sync-requests.service';
import { ExecutionDispatchService } from '../src/execution/execution-dispatch.service';
import { TaskGraphsService } from '../src/agent/tasks/task-graphs.service';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import { DeviceTasksService } from '../src/device-tasks/device-tasks.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value)).digest('hex');

/** Production Runtime with an isolated confirmed-authority fixture and signed collector.
 * This proves protocol behavior, not a real AI/phone/CalendarProvider side effect. */
describe.sequential('same Runtime, Plan and confirmed USER_EVENT authorities', {timeout:120000}, () => {
  let app: INestApplication, pool: Pool, db: Database, owner: Session, deviceId: string, sessionId: string;
  let worker: Awaited<ReturnType<typeof bootP2App>>['worker'];
  const unique = randomUUID(), keys = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
  beforeAll(async () => {
    process.env.TEST_APPROVAL_TTL_MS = '900000';
    const boot = await bootP2App('multi-authority-'+unique); ({app,pool,worker}=boot); db=app.get(DATABASE);
    owner=await register(app,unique+'@example.test','Multi-authority contract');
    const publicKeySpki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
    const challenge=await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({deviceId:'source-'+unique,keyId:'source-key-'+unique,publicKeySpki,publicKeyFingerprint:createHash('sha256').update(Buffer.from(publicKeySpki,'base64')).digest('hex')}).expect(201);
    const enrolled=await request(app.getHttpServer()).post('/api/trusted-devices/challenges/'+challenge.body.challengeId+'/verify').set(auth(owner.token)).send({signature:sign('sha256',Buffer.from(challenge.body.payload),keys.privateKey).toString('base64')}).expect(201);
    deviceId=enrolled.body.id;sessionId=enrolled.body.deviceSession.id;
  });
  afterAll(async () => { await app?.close();await pool?.end(); });
  async function signedPost(path:string,body:unknown,status=201) {
    const id=randomBytes(32).toString('hex'),at=new Date().toISOString(),payloadHash=hash(JSON.stringify(body));
    const signature=sign('sha256',Buffer.from(`lazy-armor-device-request-v1|${sessionId}|${id}|POST|${path}|${payloadHash}|${at}`),keys.privateKey).toString('base64');
    return request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set({'x-device-session':sessionId,'x-device-request-id':id,'x-device-signed-at':at,'x-device-payload-hash':payloadHash,'x-device-signature':signature}).send(body).expect(status);
  }
  async function freshDevice() {
    await signedPost('/consumer/local-capabilities',{manifestVersion:'android-local-v4',capabilities:LOCAL_CAPABILITY_CATALOG.map(c=>({key:c.key,userGrant:true,systemPermission:'GRANTED',health:'HEALTHY',checkedAt:Date.now()}))});
    // Existing isolated capability fixture; never applied to the real deployment.
    await pool.query("UPDATE local_capability_states SET health='HEALTHY' WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.create'",[deviceId]);
  }
  async function confirmed(withNativeSource=false) {
    await freshDevice();
    const conversationId=randomUUID(),messageId=randomUUID(),now=new Date();
    const event={title:'Authority source '+messageId,dueAt:new Date(Date.now()+7200000).toISOString(),reminderAt:new Date(Date.now()+7100000).toISOString(),timezone:'UTC'};
    const intent={kind:'EXTERNAL_CALENDAR_SYNC',policy:'CONFIRM_CHANGES',destination:'PHONE_CALENDAR',durationMinutes:30};
    let sourceTruthRefs: string[] = [], sourceTruthVersions: Array<{truthId:string;versionId:string}> = [];
    if (withNativeSource) {
      // Existing signed native source protocol; isolated collector fixture, not a phone read.
      const items=[{id:'source-event',calendarId:'1',title:'Source appointment',startAt:Date.now()+7200000,endAt:Date.now()+9000000,status:'SCHEDULED',allDay:false}];
      const contentJson=JSON.stringify(items);
      const read=(await signedPost('/consumer/local-acquisition',{manifestVersion:'android-local-v1',capability:'calendar.read',state:'VERIFIED_PRESENT',observedAt:Date.now(),scopeStart:Date.now(),scopeEnd:Date.now()+86400000,itemCount:1,items,contentJson,contentHash:hash(contentJson)})).body;
      sourceTruthRefs=read.truthIds;
      const [versions]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) truthId,BIN_TO_UUID(current_version_id) versionId FROM truth_records WHERE user_id=UUID_TO_BIN(?)',[owner.userId]);
      sourceTruthVersions=versions.filter(v=>sourceTruthRefs.includes(v.truthId)).map(v=>({truthId:v.truthId,versionId:v.versionId}));
    }
    // Fixture authoring only. Creation and confirmation use the production authority methods.
    await db.insert(consumerConversations).values({id:conversationId,userId:owner.userId,mode:'TEMPORARY',title:event.title,status:'USER_EVENT_CONFIRMED',version:1,createdAt:now,updatedAt:now});
    await db.insert(consumerMessages).values({id:messageId,conversationId,requestId:randomUUID(),role:'assistant',content:'Isolated explicit synchronization proposal',structuredPayload:{result:'USER_EVENT_DRAFT',userEvent:event,externalSync:intent,sourceTruthRefs,sourceTruthVersions,validationErrors:[]},contextRefs:[],createdAt:now});
    const source=await db.transaction(async tx=>{
      await app.get(UserEventsService).createConfirmed(tx,owner.userId,messageId,conversationId,event);
      return app.get(UserEventSyncRequestsService).createConfirmed(tx,owner.userId,conversationId,messageId,messageId,1);
    });
    if(source.kind!=='USER_EVENT_SYNC')throw new Error('Sync fixture authority mismatch');
    return {source,eventId:messageId,event};
  }
  async function dispatch() {
    const fixture=await confirmed();
    const run=await app.get(ExecutionDispatchService).dispatchUserEventSync(owner.userId,fixture.source.requestId,'1');
    expect(run.planId).toBeNull();expect(run.planVersionId).toBeNull();expect(run.authoritySourceJson).toEqual(fixture.source);
    await worker.processExecution(run.id);
    const detail=(await request(app.getHttpServer()).get('/api/executions/'+run.id).set(auth(owner.token)).expect(200)).body;
    expect(detail.status).toBe('waiting_approval');expect(detail.approvals).toHaveLength(1);expect(detail.steps[0].planActionId).toBeNull();
    return {...fixture,run,detail};
  }
  async function approve(f:Awaited<ReturnType<typeof dispatch>>) {
    await request(app.getHttpServer()).post('/api/approvals/'+f.detail.approvals[0].id+'/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(f.run.id);
    const [tasks]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[f.run.id]);
    expect(tasks).toHaveLength(1);
    const claimed=(await signedPost('/device-tasks/'+tasks[0].id+'/claim',{})).body;
    expect(claimed.payload.invocation.planId).toBeNull();expect(claimed.payload.invocation.planVersionId).toBeNull();
    expect(claimed.payload.invocation.resourceScope.authoritySource).toEqual(f.source);
    return claimed;
  }
  function receipt(task:any) {
    const inv=task.payload.invocation,e=inv.arguments.actionConfig.calendarEvent??inv.arguments.actionConfig.calendarMutation,operationId=hash(`${owner.userId}:${inv.targetId}:${inv.idempotencyKey}`),eventId=e.eventId??String(parseInt(hash(inv.invocationId).slice(0,8),16)+1);
    if(inv.capabilityId==='calendar.event.delete') {
      const value={invocationId:inv.invocationId,targetId:inv.targetId,authorityEpoch:inv.authorityEpoch,operationId,deviceOperationId:eventId,state:'SUCCEEDED',matched:true,evidence:{eventId,calendarId:e.calendarId,expectedOperationMarker:e.expectedOperationMarker,absent:true,observedBeforeMutation:true}};
      return {...value,resultHash:hash(value)};
    }
    const value={invocationId:inv.invocationId,targetId:inv.targetId,authorityEpoch:inv.authorityEpoch,operationId,deviceOperationId:eventId,state:'SUCCEEDED',matched:true,evidence:{eventId,calendarId:'1',title:e.title,startAt:Date.parse(e.start.dateTime),endAt:Date.parse(e.end.dateTime),timeZone:e.start.timeZone,endTimeZone:e.end.timeZone,operationMarker:'lazyarmor-operation:'+operationId,deleted:0,allDay:0}};
    return {...value,resultHash:hash(value)};
  }
  it('registers the new absence adapter concurrently without overwriting an immutable revision',async()=>{
    // Isolated catalog fixture only; never delete or edit deployment registry rows.
    await pool.query("DELETE FROM reality_adapter_definitions WHERE adapter_key='native.calendar-event-absence.v1' AND revision=1");
    const pipeline=app.get(RealityPipelineService);
    await Promise.all([pipeline.onModuleInit(),pipeline.onModuleInit(),pipeline.onModuleInit()]);
    const [rows]=await pool.query<RowDataPacket[]>("SELECT definition_hash hash FROM reality_adapter_definitions WHERE adapter_key='native.calendar-event-absence.v1' AND revision=1");
    expect(rows).toHaveLength(1);
    const before=rows[0].hash;await pipeline.onModuleInit();
    const [after]=await pool.query<RowDataPacket[]>("SELECT definition_hash hash FROM reality_adapter_definitions WHERE adapter_key='native.calendar-event-absence.v1' AND revision=1");
    expect(after[0].hash).toBe(before);
  });
  it('launches a confirmed source only from its frozen signed-native Truth/device scope and waits for separate approval',async()=>{
    const f=await confirmed(true);
    const launch=app.get(UserEventSyncLaunchService);
    expect((await launch.recover()).launched).toBeGreaterThanOrEqual(1);
    const started=await launch.start(owner.userId,f.eventId,f.source.requestId);
    expect(started.executionId).toBeTruthy();
    await worker.processExecution(started.executionId!);
    const detail=(await request(app.getHttpServer()).get('/api/executions/'+started.executionId).set(auth(owner.token)).expect(200)).body;
    expect(detail.status).toBe('waiting_approval');
    expect((await launch.start(owner.userId,f.eventId,f.source.requestId)).executionId).toBe(started.executionId);
    const [tasks]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[started.executionId]);expect(Number(tasks[0].n)).toBe(0);
    await app.get(UserEventsService).change(owner.userId,f.eventId,{version:1,action:'CANCEL'});
  });
  it('confirms exact update/delete identities through the shared Runtime, isolates permission failure and reconciles unknown update without replacing history',async()=>{
    const f=await dispatch(),originalTask=await approve(f);
    await signedPost('/device-tasks/'+originalTask.id+'/complete',{claimToken:originalTask.claimToken,result:receipt(originalTask)});
    const launcher=app.get(UserEventSyncLaunchService);
    const originalLink=(await launcher.summaries(owner.userId,f.eventId))[0];
    const changed=await app.get(UserEventsService).change(owner.userId,f.eventId,{version:1,action:'EDIT',event:{...f.event,title:'Explicit update v2',dueAt:new Date(Date.parse(f.event.dueAt)+3600000).toISOString()}});
    const proposal=await launcher.proposeMutation(owner.userId,f.eventId,f.source.requestId,2);
    expect(proposal).toMatchObject({operation:'UPDATE',executionAuthorized:false});
    await expect(launcher.confirmMutation(owner.userId,f.eventId,{version:2,messageId:proposal.messageId,confirmed:false})).rejects.toThrow('SYNC_CHANGE_CONFIRMATION_REQUIRED');
    const confirmed=await launcher.confirmMutation(owner.userId,f.eventId,{version:2,messageId:proposal.messageId,confirmed:true});
    expect(await launcher.confirmMutation(owner.userId,f.eventId,{version:2,messageId:proposal.messageId,confirmed:true})).toEqual(confirmed);
    await signedPost('/consumer/local-capabilities',{manifestVersion:'android-local-v4',capabilities:LOCAL_CAPABILITY_CATALOG.map(c=>({key:c.key,userGrant:c.key!=='calendar.update',systemPermission:'GRANTED',health:'HEALTHY',checkedAt:Date.now()}))});
    await expect(launcher.start(owner.userId,f.eventId,confirmed.requestId)).rejects.toThrow('Confirmed sync requires an available authorized resource');
    expect(await app.get(UserEventsService).get(owner.userId,f.eventId)).toEqual(changed);
    await freshDevice();
    const update=await launcher.start(owner.userId,f.eventId,confirmed.requestId);
    await worker.processExecution(update.executionId!);
    const detail=(await request(app.getHttpServer()).get('/api/executions/'+update.executionId).set(auth(owner.token)).expect(200)).body;
    expect(detail.status).toBe('waiting_approval');
    await request(app.getHttpServer()).post('/api/approvals/'+detail.approvals[0].id+'/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(update.executionId!);
    const [rows]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[update.executionId]);
    expect(rows).toHaveLength(1);
    const task=(await signedPost('/device-tasks/'+rows[0].id+'/claim',{})).body;
    expect(task.taskType).toBe('NATIVE_CALENDAR_WRITE');expect(task.payload.invocation.capabilityId).toBe('calendar.event.update');
    expect(task.payload.invocation.arguments.actionConfig.calendarMutation.eventId).toBe(originalLink.externalEventId);
    await pool.query('UPDATE device_tasks SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[task.id]);
    await app.get(DeviceTasksService).recoverExpired();
    const reconciler=app.get(ReconciliationService),c=(await reconciler.list(owner.userId)).find(c=>c.executionId===update.executionId)!;
    await reconciler.process((await reconciler.claim(100)).find(row=>row.id===c.id)!);
    const lookup=(await signedPost('/device-tasks/'+c.id+'/claim',{})).body;
    expect(lookup.payload.lookupOnly).toBe(true);
    await signedPost('/device-tasks/'+c.id+'/complete',{claimToken:lookup.claimToken,result:receipt(lookup)});
    expect((await launcher.summaries(owner.userId,f.eventId))[0]).toMatchObject({state:'VERIFIED',syncedVersion:2,externalEventId:originalLink.externalEventId});
    const [unknown]=await pool.query<RowDataPacket[]>('SELECT verification_state state FROM runtime_results WHERE invocation_id=UUID_TO_BIN(?)',[task.payload.invocationId]);expect(unknown[0].state).toBe('OUTCOME_UNKNOWN');
    const [graphs]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM agent_task_graphs WHERE execution_id=UUID_TO_BIN(?)',[update.executionId]);
    expect(graphs).toHaveLength(1);
    const graph=await app.get(TaskGraphsService).get(owner.userId,graphs[0].id);
    expect(graph).toMatchObject({planId:null,planVersionId:null,recordedStatus:'UNKNOWN',status:'SUCCESS'});
    expect(graph.tasks[1]).toMatchObject({recordedStatus:'UNKNOWN',status:'SUCCESS'});
    const [unknownAfterProjection]=await pool.query<RowDataPacket[]>('SELECT verification_state state FROM runtime_results WHERE invocation_id=UUID_TO_BIN(?)',[task.payload.invocationId]);
    expect(unknownAfterProjection[0].state).toBe('OUTCOME_UNKNOWN');
    await app.get(UserEventsService).change(owner.userId,f.eventId,{version:2,action:'CANCEL'});
    const deleteProposal=await launcher.proposeMutation(owner.userId,f.eventId,confirmed.requestId,3);
    expect(deleteProposal.operation).toBe('DELETE');
    const deletion=await launcher.confirmMutation(owner.userId,f.eventId,{version:3,messageId:deleteProposal.messageId,confirmed:true});
    const deleteRun=await launcher.start(owner.userId,f.eventId,deletion.requestId);
    await worker.processExecution(deleteRun.executionId!);
    const deleteDetail=(await request(app.getHttpServer()).get('/api/executions/'+deleteRun.executionId).set(auth(owner.token)).expect(200)).body;
    await request(app.getHttpServer()).post('/api/approvals/'+deleteDetail.approvals[0].id+'/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(deleteRun.executionId!);
    const [deleteTasks]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[deleteRun.executionId]);
    const deleting=(await signedPost('/device-tasks/'+deleteTasks[0].id+'/claim',{})).body;
    await pool.query('UPDATE device_tasks SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[deleting.id]);
    await app.get(DeviceTasksService).recoverExpired();
    const deleteCase=(await reconciler.list(owner.userId)).find(c=>c.executionId===deleteRun.executionId)!;
    await reconciler.process((await reconciler.claim(100)).find(row=>row.id===deleteCase.id)!);
    const deleteLookup=(await signedPost('/device-tasks/'+deleteCase.id+'/claim',{})).body;
    expect(deleteLookup.payload.lookupOnly).toBe(true);
    await signedPost('/device-tasks/'+deleteCase.id+'/complete',{claimToken:deleteLookup.claimToken,result:receipt(deleteLookup)});
    expect((await launcher.summaries(owner.userId,f.eventId))[0]).toMatchObject({state:'EXTERNAL_DELETED',syncedVersion:3,externalEventId:originalLink.externalEventId});
    expect((await app.get(UserEventsService).get(owner.userId,f.eventId)).status).toBe('cancelled');
    const [history]=await pool.query<RowDataPacket[]>('SELECT result_projection_json projection FROM user_event_sync_requests WHERE id=UUID_TO_BIN(?)',[f.source.requestId]);
    expect(history[0].projection.link.lastSyncedUserEventVersion).toBe(1);
    const [deleteUnknown]=await pool.query<RowDataPacket[]>('SELECT verification_state state FROM runtime_results WHERE invocation_id=UUID_TO_BIN(?)',[deleting.payload.invocationId]);expect(deleteUnknown[0].state).toBe('OUTCOME_UNKNOWN');
  });
  it('completion retains verified external identity without proposing update or delete',async()=>{
    const f=await dispatch(),task=await approve(f);
    await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task)});
    await app.get(UserEventsService).change(owner.userId,f.eventId,{version:1,action:'COMPLETE'});
    // A retained terminal receipt must not turn internal completion into a
    // pending external update, or change the version proved by Verification.
    await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task)});
    const [history]=await pool.query<RowDataPacket[]>('SELECT result_projection_json projection FROM user_event_sync_requests WHERE id=UUID_TO_BIN(?)',[f.source.requestId]);
    expect(history[0].projection.link).toMatchObject({syncState:'VERIFIED',lastSyncedUserEventVersion:1,lastInvocationId:task.payload.invocationId});
    expect(await app.get(RuntimeSourceContinuationService).consume(owner.userId,f.run.id)).toBe(false);
    const launcher=app.get(UserEventSyncLaunchService);
    expect((await launcher.summaries(owner.userId,f.eventId))[0]).toMatchObject({state:'INTERNAL_COMPLETED',syncedVersion:1,currentVersion:2,changeProposal:null});
    await expect(launcher.proposeMutation(owner.userId,f.eventId,f.source.requestId,2)).rejects.toThrow('SYNC_CHANGE_VERSION_OR_LIFECYCLE_INVALID');
  });
  it('executes through existing Risk/Approval/Invocation/DeviceTask/Verification/Ledger without creating any Plan',async()=>{
    const f=await dispatch(),task=await approve(f);
    const result=receipt(task);
    await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result});
    const final=(await request(app.getHttpServer()).get('/api/executions/'+f.run.id).set(auth(owner.token)).expect(200)).body;
    expect(final.status).toBe('succeeded');
    const [links]=await pool.query<RowDataPacket[]>('SELECT result_projection_json projection FROM user_event_sync_requests WHERE id=UUID_TO_BIN(?)',[f.source.requestId]);
    expect(links[0].projection.link).toMatchObject({syncState:'VERIFIED',lastSyncedUserEventVersion:1,lastInvocationId:task.payload.invocationId});
    const continuation=app.get(RuntimeSourceContinuationService);
    expect(await continuation.consume(owner.userId,f.run.id)).toBe(false);
    // Isolated crash-gap fixture: committed proof survives, source projection has not committed.
    await pool.query('UPDATE user_event_sync_requests SET result_projection_json=NULL WHERE id=UUID_TO_BIN(?)',[f.source.requestId]);
    expect((await continuation.recover()).recovered).toBeGreaterThanOrEqual(1);
    expect(await continuation.consume(owner.userId,f.run.id)).toBe(false);
    const [ledger]=await pool.query<RowDataPacket[]>('SELECT r.verification_state state FROM runtime_results r JOIN capability_invocations i ON i.id=r.invocation_id WHERE i.execution_id=UUID_TO_BIN(?)',[f.run.id]);
    expect(ledger).toHaveLength(1);expect(ledger[0].state).toBe('VERIFIED');
    expect((await app.get(ExecutionDispatchService).dispatchUserEventSync(owner.userId,f.source.requestId,'1')).id).toBe(f.run.id);
    await expect(app.get(ExecutionDispatchService).dispatchUserEventSync(owner.userId,f.source.requestId,'2')).rejects.toThrow('Authority execution replay identity mismatch');
    for(const table of ['plans','plan_versions']) {
      const sql=table==='plans'?'SELECT COUNT(*) n FROM plans WHERE user_id=UUID_TO_BIN(?)':'SELECT COUNT(*) n FROM plan_versions v JOIN plans p ON p.id=v.plan_id WHERE p.user_id=UUID_TO_BIN(?)';
      const [rows]=await pool.query<RowDataPacket[]>(sql,[owner.userId]);expect(Number(rows[0].n)).toBe(0);
    }
    expect((await app.get(UserEventsService).get(owner.userId,f.eventId)).status).toBe('active');
    const summaries=app.get(UserEventSyncLaunchService);
    expect((await summaries.summaries(owner.userId,f.eventId))[0]).toMatchObject({state:'VERIFIED',syncedVersion:1});
    await expect(summaries.summaries(randomUUID(),f.eventId)).rejects.toThrow('内部事项不存在');
    await app.get(UserEventsService).change(owner.userId,f.eventId,{version:1,action:'EDIT',event:{...f.event,title:'Updated after verified sync'}});
    expect((await summaries.summaries(owner.userId,f.eventId))[0]).toMatchObject({state:'CHANGE_PENDING',syncedVersion:1,currentVersion:2,changeProposal:{executionAuthorized:false,availability:'REQUIRES_RESOURCE_AND_APPROVAL'}});
  });
  it('superseded source cannot approve or dispatch a stale write; the internal item remains editable',async()=>{
    const f=await dispatch();
    await app.get(UserEventsService).change(owner.userId,f.eventId,{version:1,action:'EDIT',event:{...f.event,title:'Updated personal item'}});
    await request(app.getHttpServer()).post('/api/approvals/'+f.detail.approvals[0].id+'/approve').set(auth(owner.token)).send({}).expect(409);
    const [tasks]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[f.run.id]);expect(Number(tasks[0].n)).toBe(0);
    expect((await app.get(UserEventsService).get(owner.userId,f.eventId)).version).toBe(2);
  });
  it('expired dispatched source write is reconciled lookup-only after cancellation, with immutable unknown Ledger and one Invocation',async()=>{
    const f=await dispatch(),task=await approve(f);
    await pool.query('UPDATE device_tasks SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[task.id]);
    await app.get(DeviceTasksService).recoverExpired();
    await app.get(UserEventsService).change(owner.userId,f.eventId,{version:1,action:'CANCEL'});
    const reconciler=app.get(ReconciliationService),cases=await reconciler.list(owner.userId),c=cases.find(c=>c.executionId===f.run.id)!;
    expect(c.resultState).toBe('OUTCOME_UNKNOWN');
    const claimed=(await reconciler.claim(100)).find(row=>row.id===c.id)!;
    await reconciler.process(claimed);
    const lookup=(await signedPost('/device-tasks/'+c.id+'/claim',{})).body;
    expect(lookup.payload.lookupOnly).toBe(true);expect(lookup.payload.invocationId).toBe(task.payload.invocationId);
    await signedPost('/device-tasks/'+c.id+'/complete',{claimToken:lookup.claimToken,result:receipt(lookup)});
    expect(await reconciler.get(owner.userId,c.id)).toMatchObject({status:'RESOLVED',resultState:'SUCCEEDED'});
    const [original]=await pool.query<RowDataPacket[]>('SELECT verification_state state FROM runtime_results WHERE invocation_id=UUID_TO_BIN(?)',[task.payload.invocationId]);expect(original[0].state).toBe('OUTCOME_UNKNOWN');
    const [invocations]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM capability_invocations WHERE execution_id=UUID_TO_BIN(?)',[f.run.id]);expect(Number(invocations[0].n)).toBe(1);
    expect((await app.get(UserEventsService).get(owner.userId,f.eventId)).status).toBe('cancelled');
    const [links]=await pool.query<RowDataPacket[]>('SELECT result_projection_json projection FROM user_event_sync_requests WHERE id=UUID_TO_BIN(?)',[f.source.requestId]);
    expect(links[0].projection.link).toMatchObject({syncState:'CANCEL_PENDING',lastSyncedUserEventVersion:1});
    expect(links[0].projection.reconciliationCaseId).toBe(c.id);
    expect((await app.get(UserEventSyncLaunchService).summaries(owner.userId,f.eventId))[0]).toMatchObject({state:'CANCEL_PENDING',syncedVersion:1,changeProposal:{executionAuthorized:false}});
    expect((await app.get(ExecutionDispatchService).dispatchUserEventSync(owner.userId,f.source.requestId,'1')).id).toBe(f.run.id);
  });
});
