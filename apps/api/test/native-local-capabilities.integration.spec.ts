import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it,vi } from 'vitest';
import {FactDemandResolverService} from '../src/fact-demands/fact-demand-resolver.service';
import {DeviceTasksService} from '../src/device-tasks/device-tasks.service';
import {PlansService} from '../src/plans/plans.service';
import {CreationDraftsService} from '../src/creation-drafts/creation-drafts.service';
import {DATABASE,type InjectedDatabase} from '../src/common/database.module';
import {TerminalHandoffService} from '../src/strategy-runtime/terminal-handoff.service';
import {StrategyRuntimeService} from '../src/strategy-runtime/strategy-runtime.service';
import {ExecutionDispatchService} from '../src/execution/execution-dispatch.service';
import { scenarioContractV2ByKey,LOCAL_CAPABILITY_CATALOG,compileScenarioPlan } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

describe.sequential('signed native resource authority', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let calendarSubject:string;
  let trustedDeviceId: string;
  let deviceSessionId: string;
  let frozenPlanId:string;

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deviceId = `edge-${unique}`;
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`native-capabilities-${unique}`));
    owner = await register(app, `r4-device-owner-${unique}@example.com`, 'R4 Device Owner');

    const challenge = await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({
      deviceId, keyId: `key-${unique}`, publicKeySpki, publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex'),
    }).expect(201);
    const proof = sign('sha256', Buffer.from(challenge.body.payload as string, 'utf8'), keyPair.privateKey).toString('base64');
    const verified = await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.body.challengeId}/verify`).set(auth(owner.token)).send({ signature: proof }).expect(201);
    trustedDeviceId = verified.body.id as string;
    deviceSessionId = verified.body.deviceSession.id as string;
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  function signedHeaders(body: unknown, method: string, path: string) {
    return deviceHeaders(deviceSessionId, keyPair.privateKey, body, method, path);
  }

  function deviceHeaders(sessionId: string, privateKey: KeyObject, body: unknown, method: string, path: string) {
    const requestId = randomBytes(32).toString('hex');
    const signedAt = new Date().toISOString();
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const message = `lazy-armor-device-request-v1|${sessionId}|${requestId}|${method}|${path}|${payloadHash}|${signedAt}`;
    return {
      'x-device-session': sessionId, 'x-device-request-id': requestId, 'x-device-signed-at': signedAt,
      'x-device-payload-hash': payloadHash, 'x-device-signature': sign('sha256', Buffer.from(message, 'utf8'), privateKey).toString('base64'),
    };
  }


  async function manifest(enabled:boolean){
    const body={manifestVersion:'android-local-v2',capabilities:LOCAL_CAPABILITY_CATALOG.map(spec=>({key:spec.key,userGrant:enabled,systemPermission:'GRANTED',health:'HEALTHY',checkedAt:Date.now()}))};
    await request(app.getHttpServer()).post('/api/consumer/local-capabilities').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-capabilities')).send(body).expect(201);
  }
  async function resources(){return (await request(app.getHttpServer()).get('/api/consumer/resources').set(auth(owner.token)).set(signedHeaders({},'GET','/consumer/resources')).expect(200)).body;}
  function emptyRead(){const now=Date.now();return {manifestVersion:'android-local-v1',capability:'calendar.read',state:'VERIFIED_EMPTY',observedAt:now,scopeStart:now-10000,scopeEnd:now+10000,itemCount:0,items:[],contentJson:'[]',contentHash:hash('[]')};}
  it('requires user grant even when OS permission and health are healthy',async()=>{
    await manifest(false);const rows=await resources();expect(rows.find((r:any)=>r.capabilityState?.key==='calendar.read').capabilityState.availability).toBe('DISABLED');
    const body=emptyRead();await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-acquisition')).send(body).expect(400);
  });
  it('keeps unimplemented capabilities unavailable despite a signed healthy claim',async()=>{
    await manifest(true);const rows=await resources();expect(rows.find((r:any)=>r.capabilityState?.key==='calendar.read').kind).toBe('LOCAL');expect(rows.find((r:any)=>r.capabilityState?.key==='calendar.read').capabilityState.availability).toBe('AVAILABLE');expect(rows.find((r:any)=>r.capabilityState?.key==='sms.read').capabilityState.availability).toBe('PLATFORM_RESTRICTED');
  });
  it('fails closed for singleton device status reads and accepts signed typed evidence',async()=>{
    await manifest(true);
    for(const capability of ['network.status','battery.status']){
      const empty={...emptyRead(),capability};await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(empty,'POST','/consumer/local-acquisition')).send(empty).expect(400);
      const item=capability==='network.status'?{connected:true,internetValidated:false}:{level:80,scale:100,status:2};const items=[item],contentJson=JSON.stringify(items);const body={...empty,items,contentJson,contentHash:hash(contentJson),state:'VERIFIED_PRESENT',itemCount:1};
      await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-acquisition')).send(body).expect(201);
      const badItems=[capability==='network.status'?{connected:'yes',internetValidated:true}:{level:110,scale:100,status:2}],badJson=JSON.stringify(badItems);const bad={...body,items:badItems,contentJson:badJson,contentHash:hash(badJson)};
      await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(bad,'POST','/consumer/local-acquisition')).send(bad).expect(400);
    }
  });
  it('rejects mismatched content hashes and records a genuine empty scope separately',async()=>{
    const body=emptyRead();const bad={...body,contentHash:'0'.repeat(64)};
    await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(bad,'POST','/consumer/local-acquisition')).send(bad).expect(400);
    const result=await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-acquisition')).send(body).expect(201);expect(result.body.state).toBe('VERIFIED_EMPTY');expect(result.body.itemCount).toBe(0);
  });

  it('publishes native calendar evidence through the existing Truth pipeline',async()=>{
    const now=Date.now();const items=[{id:'event-1',calendarId:'calendar-1',startAt:now+3600000,endAt:now+7200000,title:'Isolated native integration event',status:'SCHEDULED'}];const contentJson=JSON.stringify(items);
    const body={...emptyRead(),state:'VERIFIED_PRESENT',scopeEnd:now+86400000,itemCount:1,items,contentJson,contentHash:hash(contentJson)};
    const result=await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-acquisition')).send(body).expect(201);
    calendarSubject=`local:${trustedDeviceId}:calendar:calendar-1:event-1:${now+3600000}`;expect(result.body.truthIds).toHaveLength(2);expect(result.body.sourceId).toBe(`local:${trustedDeviceId}:READ_CALENDAR_EVENT`);
    const day=new Date(items[0].startAt).toISOString().slice(0,10);
    const timeline=await request(app.getHttpServer()).get(`/api/timeline?date=${day}&timezone=UTC`).set(auth(owner.token)).expect(200);
    expect(timeline.body.filter((row:any)=>row.kind==='CALENDAR_EVENT'&&row.title===items[0].title)).toHaveLength(1);
  });

  it('projects native all-day dates once in the consumer timezone',async()=>{
    const now=Date.now();const begin=new Date(now);begin.setUTCDate(begin.getUTCDate()+1);begin.setUTCHours(0,0,0,0);
    const items=[{id:'all-day-event',calendarId:'calendar-1',startAt:begin.getTime(),endAt:begin.getTime()+86400000,title:'Isolated all-day date integration',status:'SCHEDULED',allDay:true}];const contentJson=JSON.stringify(items);
    const body={...emptyRead(),state:'VERIFIED_PRESENT',scopeEnd:now+2*86400000,itemCount:1,items,contentJson,contentHash:hash(contentJson)};
    await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-acquisition')).send(body).expect(201);
    const day=begin.toISOString().slice(0,10);
    const timeline=await request(app.getHttpServer()).get(`/api/timeline?date=${day}&timezone=Asia%2FShanghai`).set(auth(owner.token)).expect(200);
    const events=timeline.body.filter((row:any)=>row.kind==='CALENDAR_EVENT'&&row.title===items[0].title);expect(events).toHaveLength(1);expect(events[0]).toMatchObject({allDay:true,scheduledAt:new Date(begin.getTime()-8*3600000).toISOString()});
  });

  it('runs a signed native calendar task on the existing DeviceTask transport',async()=>{
    await manifest(true);const result=emptyRead();const service=app.get(DeviceTasksService);
    const task=await service.enqueue(owner.userId,trustedDeviceId,'NATIVE_CALENDAR_READ','calendar_event.meetings.state','CalendarEvent',{scopeStart:result.scopeStart,scopeEnd:result.scopeEnd});
    const claimPath=`/device-tasks/${task.id}/claim`;
    const claimed=await request(app.getHttpServer()).post('/api'+claimPath).set(auth(owner.token)).set(signedHeaders({},'POST',claimPath)).send({}).expect(201);
    const body={claimToken:claimed.body.claimToken,result};const path=`/device-tasks/${task.id}/complete`;
    const response=await request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set(signedHeaders(body,'POST',path)).send(body).expect(201);
    expect(response.body.status).toBe('SUCCEEDED');expect(response.body.reality.acquisitionState).toBe('VERIFIED_EMPTY');expect(response.body.reality.truthRecordIds).toHaveLength(0);
  });
  it('does not publish native task evidence outside its assigned scope',async()=>{
    await manifest(true);const result=emptyRead();const service=app.get(DeviceTasksService);
    const task=await service.enqueue(owner.userId,trustedDeviceId,'NATIVE_CALENDAR_READ','calendar_event.meetings.state','CalendarEvent',{scopeStart:result.scopeStart,scopeEnd:result.scopeEnd});
    const claimPath=`/device-tasks/${task.id}/claim`;
    const claimed=await request(app.getHttpServer()).post('/api'+claimPath).set(auth(owner.token)).set(signedHeaders({},'POST',claimPath)).send({}).expect(201);
    const body={claimToken:claimed.body.claimToken,result:{...result,scopeEnd:result.scopeEnd+1}};const path=`/device-tasks/${task.id}/complete`;
    await request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set(signedHeaders(body,'POST',path)).send(body).expect(400);
    expect((await service.get(owner.userId,trustedDeviceId,deviceId,task.id)).status).toBe('CLAIMED');
  });

  it('keeps a permission failure separate from an empty native result',async()=>{
    await manifest(true);const scope=emptyRead();const service=app.get(DeviceTasksService);
    const task=await service.enqueue(owner.userId,trustedDeviceId,'NATIVE_CALENDAR_READ','calendar_event.meetings.state','CalendarEvent',{scopeStart:scope.scopeStart,scopeEnd:scope.scopeEnd});
    const claimPath=`/device-tasks/${task.id}/claim`;
    const claimed=await request(app.getHttpServer()).post('/api'+claimPath).set(auth(owner.token)).set(signedHeaders({},'POST',claimPath)).send({}).expect(201);
    const result={manifestVersion:'android-local-v1',capability:'calendar.read',state:'PERMISSION_REQUIRED',observedAt:Date.now(),scopeStart:scope.scopeStart,scopeEnd:scope.scopeEnd,reason:'需要系统权限'};
    const body={claimToken:claimed.body.claimToken,result};const path=`/device-tasks/${task.id}/complete`;
    await request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set(signedHeaders(body,'POST',path)).send(body).expect(400);
    const stored=await service.get(owner.userId,trustedDeviceId,deviceId,task.id);expect(stored.status).toBe('FAILED');expect(stored.errorCode).toBe('NATIVE_ACQUISITION_PERMISSION_REQUIRED');
  });

  it('resolves native facts, saves source selection on the same draft and dispatches acquisition',async()=>{
    await manifest(true);const contract=scenarioContractV2ByKey('work.meetings')!;
    const goal={intent:'REMIND_CALENDAR_EVENT',description:'Isolated source choice integration'};
    const subject={resourceType:contract.goal.requiredSubjectTypes[0],subjectKey:calendarSubject};
    const input={scenarioKey:contract.scenario.key,scenarioRevision:contract.scenario.revision,goal,subject};
    const resolved=await request(app.getHttpServer()).post('/api/runtime/fact-demands/resolve').set(auth(owner.token)).send(input).expect(201);
    const demand=resolved.body.demands.find((row:any)=>row.selectedSource?.kind==='NATIVE_DEVICE');expect(demand).toBeDefined();
    const created=await request(app.getHttpServer()).post('/api/creation-drafts').set(auth(owner.token)).send({...input,stage:3}).expect(201);
    const selected=await request(app.getHttpServer()).post(`/api/creation-drafts/${created.body.draftId}/sources`).set(auth(owner.token)).send({version:created.body.version,sourceChoices:[{demandId:demand.demandId,sourceId:demand.selectedSourceId}]}).expect(201);
    expect(selected.body.draftId).toBe(created.body.draftId);expect(selected.body.sourceChoices[0].selection.kind).toBe('NATIVE_DEVICE');expect(selected.body.version).toBe(created.body.version+1);
    // Isolated test: exercise the actual freezing transaction, not a mobile status guess.
    await pool.query("UPDATE creation_drafts SET state='COMPLETED' WHERE draft_id=UUID_TO_BIN(?)",[created.body.draftId]);
    const compiled=compileScenarioPlan({scenarioKey:input.scenarioKey,scenarioRevision:input.scenarioRevision,subjectKey:subject.subjectKey,name:'Frozen native calendar test',mode:'DRAFT',readiness:{manualInputAvailable:true,observationPipelineAvailable:true,executionPipelineAvailable:true}});
    const frozen=await app.get<InjectedDatabase>(DATABASE).transaction(async tx=>{
      const plan=await app.get(PlansService).createInTransaction(owner.userId,compiled.definition,tx);
      const sourceContract=await app.get(CreationDraftsService).freezeConversationSources(owner.userId,created.body.draftId,plan,tx);
      return {plan,sourceContract};
    });
    frozenPlanId=frozen.plan.planId;
    expect(frozen.sourceContract?.sourceSelections.find(row=>row.demandId===demand.demandId)?.selectedSourceId).toBe(demand.selectedSourceId);
    const [frozenRows]=await pool.query('SELECT BIN_TO_UUID(plan_version_id) planVersionId,source_selection_json selections FROM plan_creation_contracts WHERE id=UUID_TO_BIN(?)',[frozen.sourceContract!.contractId]) as [Array<{planVersionId:string;selections:any[]}>,unknown];
    expect(frozenRows[0]?.planVersionId.toLowerCase()).toBe(frozen.plan.planVersionId.toLowerCase());
    expect(frozenRows[0]?.selections[0].selectedSourceId).toBe(demand.selectedSourceId);
    await app.get(StrategyRuntimeService).bind(owner.userId,{planVersionId:frozen.plan.planVersionId,scenarioKey:input.scenarioKey,scenarioRevision:input.scenarioRevision,subjectKey:subject.subjectKey});
    // Only the isolated integration database uses this activation to test scheduling transport.
    await pool.query("UPDATE plans SET status='active',active_version_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?)",[frozen.plan.planVersionId,frozen.plan.planId]);
    await pool.query("INSERT INTO plan_triggers(id,plan_version_id,trigger_type,config_json,sort_order,created_at) VALUES(UUID_TO_BIN(UUID()),UUID_TO_BIN(?),'schedule',JSON_OBJECT('cronExpression','* * * * *','timezone','Asia/Shanghai'),99,UTC_TIMESTAMP(6))",[frozen.plan.planVersionId]);
    const handoff=app.get(TerminalHandoffService),slot=new Date();
    const acquisitionSpy=vi.spyOn(app.get(FactDemandResolverService),'acquire');
    const firstWake=await handoff.wakeScheduledPlans(owner.userId,slot);
    for(const call of acquisitionSpy.mock.results)await expect(call.value).resolves.toBeDefined();
    acquisitionSpy.mockRestore();
    const secondWake=await handoff.wakeScheduledPlans(owner.userId,slot);
    expect(firstWake.find(row=>row.planId===frozen.plan.planId)?.failureStage).toBeUndefined();
    expect(firstWake.find(row=>row.planId===frozen.plan.planId)).toMatchObject({state:'ACQUISITION_PENDING'});
    expect(firstWake.find(row=>row.planId===frozen.plan.planId)?.taskIds).toHaveLength(1);
    expect(secondWake.find(row=>row.planId===frozen.plan.planId)?.taskIds).toEqual(firstWake.find(row=>row.planId===frozen.plan.planId)?.taskIds);
    const automaticTaskId=firstWake.find(row=>row.planId===frozen.plan.planId)!.taskIds[0]!;
    const automaticTask=await app.get(DeviceTasksService).get(owner.userId,trustedDeviceId,deviceId,automaticTaskId);
    const claimPath=`/device-tasks/${automaticTaskId}/claim`;
    const claimed=await request(app.getHttpServer()).post('/api'+claimPath).set(auth(owner.token)).set(signedHeaders({},'POST',claimPath)).send({}).expect(201);
    const empty={...emptyRead(),scopeStart:automaticTask.payload.scopeStart,scopeEnd:automaticTask.payload.scopeEnd};
    const completed={claimToken:claimed.body.claimToken,result:empty};const completePath=`/device-tasks/${automaticTaskId}/complete`;
    await request(app.getHttpServer()).post('/api'+completePath).set(auth(owner.token)).set(signedHeaders(completed,'POST',completePath)).send(completed).expect(201);
    await handoff.resumeScheduledAcquisitions(owner.userId);await handoff.resumeScheduledAcquisitions(owner.userId);
    const [assessmentAudits]=await pool.query("SELECT after_snapshot_json snapshot FROM audit_logs WHERE action='AUTOMATIC_PLAN_ACQUISITION_ASSESSED' AND resource_id=?",[automaticTaskId]) as [Array<{snapshot:any}>,unknown];
    expect(assessmentAudits).toHaveLength(1);expect(assessmentAudits[0]?.snapshot.wakeupId).toBeNull();
    expect(assessmentAudits[0]?.snapshot.acquisitionCoverage.some((row:any)=>row.state==='VERIFIED_EMPTY')).toBe(true);
    await request(app.getHttpServer()).post(`/api/creation-drafts/${created.body.draftId}/sources`).set(auth(owner.token)).send({version:created.body.version,sourceChoices:[{demandId:demand.demandId,sourceId:demand.selectedSourceId}]}).expect(409);
    const scope=emptyRead();const dispatched=await request(app.getHttpServer()).post('/api/runtime/fact-demands/acquire').set(auth(owner.token)).send({...input,scopeStart:scope.scopeStart,scopeEnd:scope.scopeEnd}).expect(201);expect(dispatched.body.tasks).toHaveLength(1);expect(dispatched.body.tasks[0].sourceId).toBe(demand.selectedSourceId);
  });
  it('binds single-file evidence to owned Artifact bytes without inventing semantic Truth',async()=>{
    await manifest(true);
    await pool.query("UPDATE local_capability_states SET system_permission='ON_DEMAND',health='UNKNOWN' WHERE user_id=UUID_TO_BIN(?) AND trusted_device_id=UUID_TO_BIN(?) AND capability='files.read'",[owner.userId,trustedDeviceId]);
    const artifact=(await request(app.getHttpServer()).post('/api/artifacts').set(auth(owner.token)).send({fileName:'isolated-contract-test.txt',mimeType:'text/plain',contentBase64:Buffer.from('Isolated Artifact contract test, not phone evidence').toString('base64'),requestId:'artifact-contract-'+unique}).expect(201)).body;
    const observedAt=Date.now();
    const items=[{artifactId:artifact.id,sourceSha256:artifact.sourceSha256,acquisitionMethod:'ANDROID_DOCUMENT_PICKER',userConfirmed:true,operationPermission:'GRANTED',readSucceeded:true,receivedAt:observedAt}];
    const body={manifestVersion:'android-artifact-v1',capability:'files.read',state:'VERIFIED_PRESENT',observedAt,scopeStart:observedAt-1000,scopeEnd:observedAt+1000,itemCount:1,items,contentJson:JSON.stringify(items),contentHash:hash(JSON.stringify(items))};
    const result=await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(body,'POST','/consumer/local-acquisition')).send(body).expect(201);
    expect(result.body.evidenceRefsJson).toContain('artifact:'+artifact.id);expect(result.body.truthIds).toEqual([]);
    const invalidItems=[{...items[0],sourceSha256:'b'.repeat(64)}];
    const invalid={...body,items:invalidItems,contentJson:JSON.stringify(invalidItems),contentHash:hash(JSON.stringify(invalidItems))};
    await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(invalid,'POST','/consumer/local-acquisition')).send(invalid).expect(400);
    const share={...body,capability:'share.read'};
    await request(app.getHttpServer()).post('/api/consumer/local-acquisition').set(auth(owner.token)).set(signedHeaders(share,'POST','/consumer/local-acquisition')).send(share).expect(400);
  });
  it('removes revoked devices from resource candidates',async()=>{
    await request(app.getHttpServer()).post(`/api/trusted-devices/${trustedDeviceId}/revoke`).set(auth(owner.token)).send({}).expect(201);
    const result=await request(app.getHttpServer()).get('/api/consumer/resources').set(auth(owner.token)).expect(200);expect(result.body.some((row:any)=>row.resourceId?.startsWith(`local:${trustedDeviceId}:`))).toBe(false);
    await expect(app.get(ExecutionDispatchService).dispatchManual(owner.userId,frozenPlanId,'revoked-frozen-source-'+unique,{})).rejects.toThrow('Frozen plan sources');
  });
});
