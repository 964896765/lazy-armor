import {FactDemandResolverService} from '../src/fact-demands/fact-demand-resolver.service';
import { TerminalHandoffService } from '../src/strategy-runtime/terminal-handoff.service';
import {AGENT_MODEL} from '../src/ai-adapter/agent-planner.service';
import type {AgentModelAdapter,AgentModelOutput} from '../src/ai-adapter/agent-model-adapter';
import type {INestApplication} from '@nestjs/common';
import type {Pool,RowDataPacket} from 'mysql2/promise';
import {createHash,generateKeyPairSync,sign,verify,createPublicKey,randomBytes,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {canonicalStringify,LOCAL_CAPABILITY_CATALOG} from '@lazy-armor/plan-schema';
import {auth,bootP2App,register,activatePlan,type Session} from './p2-test-helpers';
import {DeviceTasksService} from '../src/device-tasks/device-tasks.service';
import {NativeCalendarRuntimeService} from '../src/execution/native-calendar-runtime.service';
import {ReconciliationService} from '../src/execution/reconciliation.service';
import {CapabilityResolverService} from '../src/capability-resolver/capability-resolver.service';
import type {ExecutionWorker} from '../src/execution/execution-worker.service';

const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonicalStringify(value)).digest('hex');
describe.sequential('native calendar write isolated signed collector contract, NOT real phone evidence',{timeout:120000},()=>{
 let app:INestApplication,pool:Pool,owner:Session,worker:ExecutionWorker,deviceId:string,sessionId:string;
 const unique=Date.now()+'-'+Math.random().toString(16).slice(2),keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 let scheduledPlanId:string,scheduledVersionId:string,scheduledFirst:Date,scheduledItem:any,postWriteExecutionId:string;
 const event={calendarId:'1',title:'Isolated approved calendar contract',start:{dateTime:'2026-10-07T09:00:00+08:00',timeZone:'Asia/Shanghai'},end:{dateTime:'2026-10-07T10:00:00+08:00',timeZone:'Asia/Shanghai'},attendees:[],sendUpdates:'none'};
 beforeAll(async()=>{
  ({app,pool,worker}=await bootP2App('native-write-'+unique));owner=await register(app,'native-write-'+unique+'@example.test','Isolated native write');
  const publicKeySpki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
  const challenge=await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({deviceId:'write-contract-'+unique,keyId:'write-key-'+unique,publicKeySpki,publicKeyFingerprint:createHash('sha256').update(Buffer.from(publicKeySpki,'base64')).digest('hex')}).expect(201);
  const enrolled=await request(app.getHttpServer()).post('/api/trusted-devices/challenges/'+challenge.body.challengeId+'/verify').set(auth(owner.token)).send({signature:sign('sha256',Buffer.from(challenge.body.payload),keys.privateKey).toString('base64')}).expect(201);
  deviceId=enrolled.body.id;sessionId=enrolled.body.deviceSession.id;
  const manifest={manifestVersion:'android-local-v4',capabilities:LOCAL_CAPABILITY_CATALOG.map(c=>({key:c.key,userGrant:true,systemPermission:'GRANTED',health:'HEALTHY',checkedAt:Date.now()}))};
  await signedPost('/consumer/local-capabilities',manifest);
  // Isolated test only: exercise dispatch before enabling the production mobile manifest.
  await pool.query("UPDATE local_capability_states SET health='HEALTHY' WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.create'",[deviceId]);
  await request(app.getHttpServer()).get('/api/runtime-targets').set(auth(owner.token)).expect(200);
 });
 afterAll(async()=>{await app?.close();await pool?.end();});
 function headers(path:string,body:unknown){const requestId=randomBytes(32).toString('hex'),signedAt=new Date().toISOString(),payloadHash=hash(JSON.stringify(body));return {'x-device-session':sessionId,'x-device-request-id':requestId,'x-device-signed-at':signedAt,'x-device-payload-hash':payloadHash,'x-device-signature':sign('sha256',Buffer.from(`lazy-armor-device-request-v1|${sessionId}|${requestId}|POST|${path}|${payloadHash}|${signedAt}`),keys.privateKey).toString('base64')};}
 async function signedPost(path:string,body:unknown,status=201){return request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set(headers(path,body)).send(body).expect(status);}
 async function prepare(suffix:string){
  const plan=await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({name:'Native contract '+suffix,domain:'general',automationLevel:'L2',approvalPolicy:{type:'always'},sources:[{sourceType:'manual',config:{},sortOrder:0}],triggers:suffix.startsWith('continuation')?[{triggerType:'schedule',config:{cronExpression:'* * * * *',timezone:'Asia/Shanghai'},sortOrder:0}]:[{triggerType:'manual',config:{},sortOrder:0}],conditions:[],actions:[{actionType:'publish',requiredCapability:'calendar.event.create',config:{visibility:'private',calendarEvent:event},stepOrder:0}]}).expect(response=>expect(response.status,JSON.stringify(response.body)).toBe(201));
  await activatePlan(app,owner.token,plan.body.id);
  const [rows]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(active_version_id) versionId FROM plans WHERE id=UUID_TO_BIN(?)',[plan.body.id]);
  const resolution=await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send({planVersionId:rows[0].versionId,requestKey:unique+suffix,requirement:{schemaVersion:'1',capabilityKey:'calendar.event.create',resource:'CalendarEvent',operation:'execute',fields:['title','start','end','calendarId'],purpose:'user_authorized_calendar_automation',minimumReality:'OBSERVED',maxAgeSeconds:300,maxRisk:'R3',maxCostMicros:0,preferredProviders:[],preferredSourceModes:['OS_API']}}).expect(201);
  expect(resolution.body.decisionJson.status).toBe('RESOLVED');
  const run=await request(app.getHttpServer()).post('/api/plans/'+plan.body.id+'/resolved-executions').set(auth(owner.token)).send({requestId:unique+suffix,triggerPayload:{},resolutionDecisionIds:[resolution.body.id]}).expect(201);
  await worker.processExecution(run.body.id);
  const detail=await request(app.getHttpServer()).get('/api/executions/'+run.body.id).set(auth(owner.token)).expect(200);
  expect(detail.body.status).toBe('waiting_approval');
  expect(detail.body.approvals[0].actionSummary).toBe('将在日历创建事项（风险 R3）');
  await worker.processExecution(run.body.id);
  const duplicate=await request(app.getHttpServer()).get('/api/executions/'+run.body.id).set(auth(owner.token)).expect(200);
  expect(duplicate.body.status).toBe('waiting_approval');expect(duplicate.body.approvals).toHaveLength(1);
  const denied=app.get(DeviceTasksService).enqueue(owner.userId,deviceId,'NATIVE_CALENDAR_CREATE','calendar.event','CalendarEvent',{});
  await expect(denied).rejects.toThrow();
  const [pending]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[run.body.id]);expect(pending[0].n).toBe(0);
  const [beforeApproval]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM capability_invocations WHERE execution_id=UUID_TO_BIN(?)',[run.body.id]);
  expect(beforeApproval).toHaveLength(1);
  await request(app.getHttpServer()).post('/api/approvals/'+detail.body.approvals[0].id+'/approve').set(auth(owner.token)).send({}).expect(201);
  await worker.processExecution(run.body.id);
  const [tasks]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.invocation.executionId\'))=?',[run.body.id]);expect(tasks).toHaveLength(1);
  const claimed=await signedPost('/device-tasks/'+tasks[0].id+'/claim',{});
  expect(claimed.body.payload.invocationId).toBe(beforeApproval[0].id);
  const native=app.get(NativeCalendarRuntimeService),ticket=claimed.body.dispatchAuthorization;
  expect(verify('sha256',Buffer.from(ticket.payload,'base64'),createPublicKey({key:Buffer.from(native.publicSigningKey(),'base64'),type:'spki',format:'der'}),Buffer.from(ticket.signature,'base64'))).toBe(true);
  return {runId:run.body.id,task:claimed.body};
 }
 function receipt(task:any,matched=true){
  const expectedEvent=task.payload.invocation.arguments.actionConfig.calendarEvent;
  const inv=task.payload.invocation,operationId=hash(`${owner.userId}:${inv.targetId}:${inv.idempotencyKey}`);
  const eventId=String(parseInt(hash(task.id).slice(0,8),16)+1);
  const value={invocationId:inv.invocationId,targetId:inv.targetId,authorityEpoch:inv.authorityEpoch,operationId,deviceOperationId:eventId,state:'SUCCEEDED',matched:true,evidence:{eventId,calendarId:'1',title:matched?expectedEvent.title:'Changed externally',startAt:Date.parse(expectedEvent.start.dateTime),endAt:Date.parse(expectedEvent.end.dateTime),timeZone:expectedEvent.start.timeZone,endTimeZone:expectedEvent.end.timeZone,operationMarker:'lazyarmor-operation:'+operationId,deleted:0,allDay:0}};
  return {...value,resultHash:hash(value)};
 }
 it('freezes a model parameter proposal through normal conversation confirmation and gates its first scheduled time',async()=>{
  // Isolated signed native evidence and model parameters; not phone acceptance.
  const now=Date.now(),item={id:'9001',calendarId:'1',title:'Existing scope contract',startAt:now+7200000,endAt:now+7800000,status:'SCHEDULED'};
  const contentJson=JSON.stringify([item]);
  await signedPost('/consumer/local-acquisition',{manifestVersion:'android-local-v1',capability:'calendar.read',state:'VERIFIED_PRESENT',observedAt:now,scopeStart:now-10000,scopeEnd:now+86400000,itemCount:1,items:[item],contentJson,contentHash:hash(contentJson)});
  const subjectKey=`local:${deviceId}:calendar:1:9001:${item.startAt}`,first=new Date(Math.ceil((now+3600000)/60000)*60000);
  const parameters={recipeKey:'calendar.scheduled-create.v1' as const,firstRunAt:first.toISOString(),timezone:'Asia/Shanghai',recurrence:'DAILY' as const,observationSubjectKey:subjectKey,calendarEvent:{...event,start:{dateTime:new Date(first.getTime()+3600000).toISOString(),timeZone:'Asia/Shanghai'},end:{dateTime:new Date(first.getTime()+4200000).toISOString(),timeZone:'Asia/Shanghai'}}};
  const output:AgentModelOutput={result:'PLAN_DRAFT',intentSummary:'Isolated scheduled authoring summary: observe real scope, request approval, create calendar event and read back. '.repeat(3),domain:'work',scenarioKey:'work.meetings',scenarioRevision:1,strategyKey:'PERIODIC_SUMMARY',requiredFacts:[],selectedTruthRefs:[],requiredCapabilities:[],selectedSkillIds:[],toolRequirements:[],draftDefinition:null,scheduledCalendar:parameters,explanation:'Confirm scheduled Calendar draft',missingRequirements:[],warnings:[],riskHints:[]};
  const model=vi.spyOn(app.get<AgentModelAdapter>(AGENT_MODEL),'complete').mockResolvedValueOnce(output);
  const c=(await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'PLAN'}).expect(201)).body;
  let proposed:any;
  try{proposed=(await request(app.getHttpServer()).post(`/api/conversations/${c.id}/messages`).set(auth(owner.token)).send({version:0,requestId:'calendar-recipe-'+unique,content:'每日定时创建本机日历事项'}).expect(201)).body;}finally{model.mockRestore();}
  expect(proposed.messages.at(-1).structuredPayload).toMatchObject({result:'PLAN_DRAFT',validationErrors:[],proposal:{requiredCapabilities:expect.arrayContaining(['calendar.event.create'])}});
  expect(proposed.creationDraft.subject.subjectKey).toBe(subjectKey);
  expect(proposed.creationDraft.sourceChoices).toHaveLength(1);
  const confirmed=(await request(app.getHttpServer()).post(`/api/conversations/${c.id}/confirm-plan`).set(auth(owner.token)).send({version:proposed.version,confirmed:true}).expect(201)).body;
  const [contracts]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(c.plan_version_id) versionId,c.goal_json goal,c.source_selection_json sources,b.runtime_json runtime FROM plan_creation_contracts c JOIN strategy_runtime_bindings b ON b.plan_version_id=c.plan_version_id WHERE c.plan_id=UUID_TO_BIN(?)',[confirmed.planId]);
  scheduledPlanId=confirmed.planId;scheduledVersionId=contracts[0].versionId.toLowerCase();scheduledFirst=first;scheduledItem=item;
  expect(contracts).toHaveLength(1);expect(contracts[0].goal.intent).toBe('CREATE_SCHEDULED_CALENDAR_EVENT');expect(contracts[0].sources).toHaveLength(1);
  expect(contracts[0].runtime).toMatchObject({actionMode:'EXECUTE',approvalPolicy:'ALWAYS_FOR_EXTERNAL',verificationPolicy:'READ_BACK'});
  await activatePlan(app,owner.token,confirmed.planId);
  expect((await app.get(TerminalHandoffService).wakeScheduledPlans(owner.userId,new Date(first.getTime()-86400000))).some(row=>row.planId===confirmed.planId)).toBe(false);
  await request(app.getHttpServer()).post('/api/plans/'+confirmed.planId+'/status').set(auth(owner.token)).send({status:'paused'}).expect(201);
  expect((await app.get(TerminalHandoffService).wakeScheduledPlans(owner.userId,first)).some(row=>row.planId===confirmed.planId)).toBe(false);
 });
 it('recovers a source-unavailable observed slot after the due minute without duplicating acquisition',async()=>{
  // Isolated DB clock fixture; never counted as real scheduled acceptance.
  const handoff=app.get(TerminalHandoffService);
  await request(app.getHttpServer()).post('/api/plans/'+scheduledPlanId+'/status').set(auth(owner.token)).send({status:'active'}).expect(201);
  await pool.query("UPDATE local_capability_states SET system_permission='DENIED' WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.read'",[deviceId]);
  try {
    expect((await handoff.wakeScheduledPlans(owner.userId,scheduledFirst)).find(row=>row.planId===scheduledPlanId)?.state).toBe('NO_SUPPORTED_ACQUISITION_DISPATCH');
  } finally {
    await pool.query("UPDATE local_capability_states SET system_permission='GRANTED' WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.read'",[deviceId]);
  }
  // Append an isolated scheduler clock fixture; never mutate append-only Audit.
  await pool.query("INSERT INTO audit_logs(id,actor_type,action,resource_type,resource_id,user_id,correlation_id,after_snapshot_json,source,result,created_at) SELECT UUID_TO_BIN(?),actor_type,action,resource_type,resource_id,user_id,correlation_id,after_snapshot_json,source,result,? FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND resource_id=? AND action='AUTOMATIC_PLAN_ACQUISITION_WAKEUP' AND JSON_UNQUOTE(JSON_EXTRACT(after_snapshot_json,'$.state'))='NO_SUPPORTED_ACQUISITION_DISPATCH' LIMIT 1",[randomUUID(),scheduledFirst,owner.userId,scheduledVersionId]);
  const restored=await handoff.wakeScheduledPlans(owner.userId,new Date(scheduledFirst.getTime()+120000));
  const actual=restored.find(row=>row.planId===scheduledPlanId);
  expect(actual?.state).toBe('ACQUISITION_PENDING');expect(actual?.taskIds).toHaveLength(1);
  const replay=await handoff.wakeScheduledPlans(owner.userId,new Date(scheduledFirst.getTime()+180000));
  expect(replay.some(row=>row.planId===scheduledPlanId)).toBe(false);
  const [tasks]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.planWakeup.planVersionId'))=?",[scheduledVersionId]);
  expect(tasks[0].n).toBe(1);
  await request(app.getHttpServer()).post('/api/plans/'+scheduledPlanId+'/status').set(auth(owner.token)).send({status:'paused'}).expect(201);
 });
 it('reassesses scheduled write output Truth and replans the same persistent Plan before ACK',async()=>{
  // Every receipt/time advance below is isolated contract evidence, not real acceptance.
  await request(app.getHttpServer()).post('/api/plans/'+scheduledPlanId+'/status').set(auth(owner.token)).send({status:'active'}).expect(201);
  const handoff=app.get(TerminalHandoffService);
  const wakes=await handoff.wakeScheduledPlans(owner.userId,scheduledFirst);
  const taskId=wakes.find(row=>row.planId===scheduledPlanId)!.taskIds[0]!;
  const readTask=await app.get(DeviceTasksService).get(owner.userId,deviceId,'write-contract-'+unique,taskId);
  const claimed=(await signedPost('/device-tasks/'+taskId+'/claim',{})).body;
  const contentJson=JSON.stringify([scheduledItem]);
  await signedPost('/device-tasks/'+taskId+'/complete',{claimToken:claimed.claimToken,result:{manifestVersion:'android-local-v1',capability:'calendar.read',state:'VERIFIED_PRESENT',observedAt:Date.now(),scopeStart:readTask.payload.scopeStart,scopeEnd:readTask.payload.scopeEnd,itemCount:1,items:[scheduledItem],contentJson,contentHash:hash(contentJson)}});
  await handoff.resumeScheduledAcquisitions(owner.userId);
  const [audits]=await pool.query<RowDataPacket[]>("SELECT after_snapshot_json snapshot FROM audit_logs WHERE action='AUTOMATIC_PLAN_ACQUISITION_ASSESSED' AND resource_id=?",[taskId]);
  // Real DB contract only: source acquisition is fresh, but write permission is revoked.
  await pool.query("UPDATE local_capability_states SET system_permission='DENIED' WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.create'",[deviceId]);
  try {
    expect((await handoff.handoff(owner.userId,audits[0].snapshot.wakeupId)).status).toBe('WAITING_RESOURCE');
    const todos=(await request(app.getHttpServer()).get('/api/todos').set(auth(owner.token)).expect(200)).body;
    expect(todos).toEqual(expect.arrayContaining([expect.objectContaining({id:'resource-wait:'+audits[0].snapshot.wakeupId,planId:scheduledPlanId,type:'EXCEPTION',status:'OPEN',executionId:null})]));
    const work=(await request(app.getHttpServer()).get('/api/consumer/work-items').set(auth(owner.token)).expect(200)).body;
    expect(work.planAssessments.find((row:any)=>row.planId===scheduledPlanId)).toMatchObject({assessment:{state:'BLOCKED'},nextBestAction:'CONNECT_RESOURCE'});
    await request(app.getHttpServer()).post('/api/plans/'+scheduledPlanId+'/status').set(auth(owner.token)).send({status:'paused'}).expect(201);
    expect((await request(app.getHttpServer()).get('/api/todos').set(auth(owner.token)).expect(200)).body.some((todo:any)=>todo.id==='resource-wait:'+audits[0].snapshot.wakeupId)).toBe(false);
    await request(app.getHttpServer()).post('/api/plans/'+scheduledPlanId+'/status').set(auth(owner.token)).send({status:'active'}).expect(201);
  } finally {
    await pool.query("UPDATE local_capability_states SET system_permission='GRANTED' WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.create'",[deviceId]);
  }
  // Use a distinct retry slot without ageing the isolated device heartbeat.
  // Keep the real Resolver, permissions and same wakeup; do not mock a decision.
  const resolver=app.get(CapabilityResolverService),resolve=resolver.resolve.bind(resolver);
  const retry=vi.spyOn(resolver,'resolve').mockImplementation((userId,input)=>resolve(userId,{...input,requestKey:hash(input.requestKey+':recovered-slot')}));
  let dispatched;
  try { dispatched=await handoff.handoff(owner.userId,audits[0].snapshot.wakeupId); }
  finally { retry.mockRestore(); }
  expect((await request(app.getHttpServer()).get('/api/todos').set(auth(owner.token)).expect(200)).body.some((todo:any)=>todo.id==='resource-wait:'+audits[0].snapshot.wakeupId)).toBe(false);
  postWriteExecutionId=dispatched.executionId!;
  await worker.processExecution(postWriteExecutionId);
  const detail=(await request(app.getHttpServer()).get('/api/executions/'+postWriteExecutionId).set(auth(owner.token)).expect(200)).body;
  await request(app.getHttpServer()).post('/api/approvals/'+detail.approvals[0].id+'/approve').set(auth(owner.token)).send({}).expect(201);
  await worker.processExecution(postWriteExecutionId);
  const [tasks]=await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM device_tasks WHERE task_type='NATIVE_CALENDAR_CREATE' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.invocation.executionId'))=?",[postWriteExecutionId]);
  const write=(await signedPost('/device-tasks/'+tasks[0].id+'/claim',{})).body;
  await signedPost('/device-tasks/'+write.id+'/complete',{claimToken:write.claimToken,result:receipt(write)});
  await handoff.resumeCompletedPlans(owner.userId);await handoff.resumeCompletedPlans(owner.userId);
  const [assessments]=await pool.query<RowDataPacket[]>("SELECT after_snapshot_json snapshot FROM audit_logs WHERE action='PERSISTENT_PLAN_POST_WRITE_ASSESSED' AND resource_id=?",[postWriteExecutionId]);
  expect(assessments).toHaveLength(1);const assessment=assessments[0].snapshot;
  expect(assessment).toMatchObject({planVersionId:scheduledVersionId,stateAssessment:{state:'COMPLETE'},nextBestAction:'COMPLETE',replan:{stateAssessment:{state:'READY'},nextBestAction:'WAIT'}});
  expect(assessment.truthVersionId).toBeTruthy();expect(assessment.completionSubjectKey).not.toBe(assessment.inputTruthHandoffProof.subjectKey);
  const [ledgers]=await pool.query<RowDataPacket[]>('SELECT r.ack_at ackAt FROM runtime_results r JOIN capability_invocations i ON i.id=r.invocation_id WHERE i.execution_id=UUID_TO_BIN(?)',[postWriteExecutionId]);
  expect(ledgers[0].ackAt).toBeNull();
 });
 it('fails closed if the post-write Reality subject does not match its verified output scope',async()=>{
  const [rows]=await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(r.id) id,r.subject_key subject FROM truth_records r JOIN truth_record_versions v ON v.id=r.current_version_id JOIN truth_provenance p ON p.truth_record_version_id=v.id JOIN source_observations o ON o.id=p.observation_id WHERE JSON_UNQUOTE(JSON_EXTRACT(o.payload_json,'$.invocationId')) IN (SELECT LOWER(BIN_TO_UUID(id)) FROM capability_invocations WHERE execution_id=UUID_TO_BIN(?)) AND JSON_UNQUOTE(JSON_EXTRACT(v.value_json,'$.factKey'))='calendar_event.schedule'",[postWriteExecutionId]);
  await pool.query("UPDATE truth_records SET subject_key='foreign-output-scope' WHERE id=UUID_TO_BIN(?)",[rows[0].id]);
  try{await expect(app.get(FactDemandResolverService).reassessCalendarCompletion(owner.userId,scheduledVersionId,postWriteExecutionId,new Date(Date.now()+3600000).toISOString())).rejects.toThrow('POST_WRITE_TRUTH_GOAL_MISMATCH');}
  finally{await pool.query('UPDATE truth_records SET subject_key=? WHERE id=UUID_TO_BIN(?)',[rows[0].subject,rows[0].id]);}
 });
 it('does not infer goal completion from an unverified Result Ledger',async()=>{
  await pool.query("UPDATE runtime_results r JOIN capability_invocations i ON i.id=r.invocation_id SET r.verification_state='OUTCOME_UNKNOWN' WHERE i.execution_id=UUID_TO_BIN(?)",[postWriteExecutionId]);
  try{await expect(app.get(FactDemandResolverService).reassessCalendarCompletion(owner.userId,scheduledVersionId,postWriteExecutionId,null)).rejects.toThrow('POST_WRITE_RESULT_NOT_VERIFIED');}
  finally{await pool.query("UPDATE runtime_results r JOIN capability_invocations i ON i.id=r.invocation_id SET r.verification_state='VERIFIED' WHERE i.execution_id=UUID_TO_BIN(?)",[postWriteExecutionId]);}
 });
 it.each(['active','paused','replaced'])('recovers one durable Plan continuation independently of ACK with Plan %s',async(planState)=>{
  const {task,runId}=await prepare('continuation-'+planState);
  await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task)});
  const [run]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(plan_id) planId,BIN_TO_UUID(plan_version_id) versionId FROM executions WHERE id=UUID_TO_BIN(?)',[runId]);
  const [truth]=await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(c.truth_record_id) id,BIN_TO_UUID(t.current_version_id) versionId FROM candidate_facts c JOIN truth_records t ON t.id=c.truth_record_id JOIN source_observations o ON o.id=c.observation_id WHERE o.external_event_key=? LIMIT 1",['calendar-write:'+task.payload.invocationId]);
  const bindingId=randomUUID(),wakeupId=randomUUID();
  // Isolated continuation fixture only; never counted as a scheduled phone Golden Flow.
  await pool.query("INSERT INTO strategy_runtime_bindings(id,user_id,plan_version_id,scenario_key,scenario_revision,strategy_key,strategy_revision,schema_version,runtime_hash,runtime_json,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'work.meetings',1,'PERIODIC_SUMMARY',1,'1',?,JSON_OBJECT(),NOW(6))",[bindingId,owner.userId,run[0].versionId,'0'.repeat(64)]);
  await pool.query("INSERT INTO strategy_runtime_wakeups(id,binding_id,user_id,plan_version_id,truth_record_version_id,wakeup_key,fact_key,resource_type,subject_key,trigger_mode,status,handoff_status,handoff_execution_id,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'calendar_event.schedule','CalendarEvent','isolated','SCHEDULE','READY_FOR_PLAN_ENGINE','DISPATCHED',UUID_TO_BIN(?),NOW(6))",[wakeupId,bindingId,owner.userId,run[0].versionId,truth[0].versionId,hash(wakeupId),runId]);
  if(planState==='paused')await request(app.getHttpServer()).post('/api/plans/'+run[0].planId+'/status').set(auth(owner.token)).send({status:'paused'}).expect(201);
  if(planState==='replaced'){
   const next=await request(app.getHttpServer()).post('/api/plans/'+run[0].planId+'/versions').set(auth(owner.token)).send({name:'Changed next-round calendar contract',domain:'general',automationLevel:'L2',approvalPolicy:{type:'always'},sources:[{sourceType:'manual',config:{},sortOrder:0}],triggers:[{triggerType:'schedule',config:{cronExpression:'*/5 * * * *',timezone:'Asia/Shanghai'},sortOrder:0}],conditions:[],actions:[{actionType:'publish',requiredCapability:'calendar.event.create',config:{visibility:'private',calendarEvent:{...event,title:'New immutable version'}},stepOrder:0}]}).expect(201);
   await request(app.getHttpServer()).post('/api/plans/'+run[0].planId+'/versions/'+next.body.versionNumber+'/apply').set(auth(owner.token)).send({}).expect(201);
   const [versions]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(e.plan_version_id) executionVersion,BIN_TO_UUID(p.active_version_id) activeVersion FROM executions e JOIN plans p ON p.id=e.plan_id WHERE e.id=UUID_TO_BIN(?)',[runId]);
   expect(versions[0].executionVersion.toLowerCase()).toBe(run[0].versionId.toLowerCase());
   expect(versions[0].activeVersion.toLowerCase()).toBe(next.body.id.toLowerCase());
  }
  await app.get(TerminalHandoffService).resumeCompletedPlans(owner.userId);
  await app.get(TerminalHandoffService).resumeCompletedPlans(owner.userId);
  const [records]=await pool.query<RowDataPacket[]>("SELECT after_snapshot_json afterJson FROM audit_logs WHERE action='PERSISTENT_PLAN_RESULT_REEVALUATED' AND resource_id=?",[runId]);
  expect(records).toHaveLength(1);
  const after=typeof records[0].afterJson==='string'?JSON.parse(records[0].afterJson):records[0].afterJson;
  expect(after.state).toBe(planState!=='active'?'INACTIVE_VERSION':'WAITING_NEXT_SCHEDULE');
  if(planState!=='active')expect(after.nextRunAt).toBeNull();else {expect(after.nextBestAction).toBe('WAIT');expect(Date.parse(after.nextRunAt)).toBeGreaterThan(Date.now()-1000);}
  const [ledger]=await pool.query<RowDataPacket[]>('SELECT ack_at ackAt FROM runtime_results WHERE invocation_id=UUID_TO_BIN(?)',[task.payload.invocationId]);expect(ledger[0].ackAt).toBeNull();
 });
 it('requires approval, fixes signed dispatch identity and atomically records verified write plus repeat receipt and ACK',async()=>{
  const {task,runId}=await prepare('success');
  await signedPost('/device-tasks/'+task.id+'/heartbeat',{claimToken:task.claimToken});
  const bytes=receipt(task);await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:bytes});
  await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:bytes});
  const [observed]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM source_observations WHERE user_id=UUID_TO_BIN(?) AND external_event_key=?",[owner.userId,'calendar-write:'+task.payload.invocationId]);
  expect(observed[0].n).toBe(1);
  const [published]=await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM candidate_facts c JOIN source_observations o ON o.id=c.observation_id WHERE o.user_id=UUID_TO_BIN(?) AND o.external_event_key=? AND c.status='VERIFIED'",[owner.userId,'calendar-write:'+task.payload.invocationId]);
  expect(published[0].n).toBe(2);
  const ledger=await request(app.getHttpServer()).get('/api/runtime-results').set(auth(owner.token)).expect(200);
  const result=ledger.body.find((r:any)=>r.invocationId===task.payload.invocationId);expect(result).toMatchObject({executionState:'SUCCEEDED',verificationState:'VERIFIED'});
  const first=await request(app.getHttpServer()).post('/api/runtime-results/'+result.id+'/deliver').set(auth(owner.token)).send({}).expect(201);
  // Lost delivery/ACK response: redeliver immutable bytes, then repeat the ACK.
  const second=await request(app.getHttpServer()).post('/api/runtime-results/'+result.id+'/deliver').set(auth(owner.token)).send({}).expect(201);
  expect(second.body.resultHash).toBe(first.body.resultHash);expect(second.body.ackToken).toBe(first.body.ackToken);
  const ack={ackToken:second.body.ackToken,resultHash:result.resultHash,authorityEpoch:result.authorityEpoch};
  await request(app.getHttpServer()).post('/api/runtime-results/'+result.id+'/ack').set(auth(owner.token)).send(ack).expect(201);
  await request(app.getHttpServer()).post('/api/runtime-results/'+result.id+'/ack').set(auth(owner.token)).send(ack).expect(201);
  await signedPost('/device-tasks/'+task.id+'/heartbeat',{claimToken:task.claimToken},409);
  const after=await request(app.getHttpServer()).get('/api/runtime-results').set(auth(owner.token)).expect(200);
  expect(after.body.filter((r:any)=>r.invocationId===task.payload.invocationId)).toHaveLength(1);
  expect(after.body.find((r:any)=>r.id===result.id)).toMatchObject({resultHash:result.resultHash,executionState:'SUCCEEDED',verificationState:'VERIFIED',deliveryState:'RESULT_ACKNOWLEDGED'});
  const [ops]=await pool.query<RowDataPacket[]>('SELECT status,provider_operation_id,result_hash FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)',[runId]);expect(ops).toHaveLength(1);expect(ops[0]).toMatchObject({status:'succeeded',provider_operation_id:bytes.deviceOperationId});expect(ops[0].result_hash).toMatch(/^[a-f0-9]{64}$/);
  const [run]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(plan_id) planId,BIN_TO_UUID(plan_version_id) versionId FROM executions WHERE id=UUID_TO_BIN(?)',[runId]);
  const projection=await request(app.getHttpServer()).get('/api/plans/'+run[0].planId+'/control-projection').set(auth(owner.token)).expect(200);
  expect(projection.body).toMatchObject({state:'AVAILABLE',planVersionId:run[0].versionId,manualRunAllowed:false});
  expect(projection.body.records.find((r:any)=>r.id===runId)).toMatchObject({verificationState:'VERIFIED',capabilityIds:['calendar.event.create']});
  expect(projection.body.resources).toEqual(expect.arrayContaining([expect.objectContaining({capabilityId:'calendar.event.create',targetId:task.payload.targetId,verificationState:'VERIFIED'})]));
  expect(projection.body.origin.skillVersion).toBeNull();
  const other=await register(app,'plan-control-other-'+unique+'@example.test','Other owner');
  await request(app.getHttpServer()).get('/api/plans/'+run[0].planId+'/control-projection').set(auth(other.token)).expect(404);
  const [afterProjection]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)',[runId]);expect(afterProjection[0].n).toBe(1);
 });
 it('does not trust matched=true and queues read-only reconciliation for mismatched read-back',async()=>{
  const {task,runId}=await prepare('unknown');await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task,false)});
  const [unverifiedFacts]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM source_observations WHERE user_id=UUID_TO_BIN(?) AND external_event_key=?',[owner.userId,'calendar-write:'+task.payload.invocationId]);expect(unverifiedFacts[0].n).toBe(0);
  const ledger=await request(app.getHttpServer()).get('/api/runtime-results').set(auth(owner.token)).expect(200);expect(ledger.body.find((r:any)=>r.invocationId===task.payload.invocationId)).toMatchObject({executionState:'OUTCOME_UNKNOWN',verificationState:'OUTCOME_UNKNOWN'});
  const [unknownRun]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(plan_id) planId FROM capability_invocations WHERE id=UUID_TO_BIN(?)',[task.payload.invocationId]);
  const unknownProjection=await request(app.getHttpServer()).get('/api/plans/'+unknownRun[0].planId+'/control-projection').set(auth(owner.token)).expect(200);
  expect(unknownProjection.body.manualRunAllowed).toBe(false);
  expect(unknownProjection.body.records[0].verificationState).toBe('OUTCOME_UNKNOWN');
  const loopPath='/api/plans/'+unknownRun[0].planId+'/agent-loop';
  const beforeLoop=await request(app.getHttpServer()).get(loopPath).set(auth(owner.token)).expect(200);
  expect(beforeLoop.body).toMatchObject({state:'RECONCILING',reflection:{executionId:runId,recordedStatus:'failed',outcome:'UNKNOWN'}});
  const beforeLoopHistory=(await request(app.getHttpServer()).get(loopPath+'/history').set(auth(owner.token)).expect(200)).body;
  expect(beforeLoopHistory.items.find((item:any)=>item.executionId===runId&&item.kind==='RUN')).toMatchObject({state:'failed',reflection:{outcome:'UNKNOWN'}});
  const [beforeHistory]=await pool.query<RowDataPacket[]>('SELECT status,error_code errorCode FROM executions WHERE id=UUID_TO_BIN(?)',[runId]);
  const [cases]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM reconciliation_cases WHERE operation_id=UUID_TO_BIN(?)',[task.payload.operationId]);
  const reconciler=app.get(ReconciliationService);const check=(await reconciler.claim(100)).find(row=>row.id===cases[0].id)!;await reconciler.process(check);
  const lookup=await signedPost('/device-tasks/'+cases[0].id+'/claim',{});
  expect(JSON.parse(Buffer.from(lookup.body.dispatchAuthorization.payload,'base64').toString()).lookupOnly).toBe(true);
  await signedPost('/device-tasks/'+cases[0].id+'/complete',{claimToken:lookup.body.claimToken,result:receipt(lookup.body)});
  expect(await reconciler.get(owner.userId,cases[0].id)).toMatchObject({status:'RESOLVED',resultState:'SUCCEEDED'});
  const afterLoop=await request(app.getHttpServer()).get(loopPath).set(auth(owner.token)).expect(200);
  expect(afterLoop.body).toMatchObject({state:'WAITING',planVersionId:beforeLoop.body.planVersionId,
   reflection:{executionId:runId,recordedStatus:'failed',outcome:'VERIFIED',verifiedResultCount:1}});
  const afterLoopHistory=(await request(app.getHttpServer()).get(loopPath+'/history').set(auth(owner.token)).expect(200)).body;
  expect(afterLoopHistory.items.find((item:any)=>item.executionId===runId&&item.kind==='RUN')).toMatchObject({state:'failed',reflection:{outcome:'VERIFIED',verifiedResultCount:1}});
  expect(JSON.stringify(afterLoopHistory)).not.toMatch(/evidenceRefs|actionIntentId|operationId|evidenceJson|initial-unknown/);
  const [afterHistory]=await pool.query<RowDataPacket[]>('SELECT status,error_code errorCode FROM executions WHERE id=UUID_TO_BIN(?)',[runId]);
  expect(afterHistory).toEqual(beforeHistory);
  const afterLedger=await request(app.getHttpServer()).get('/api/runtime-results').set(auth(owner.token)).expect(200);
  expect(afterLedger.body.find((r:any)=>r.invocationId===task.payload.invocationId)).toMatchObject({executionState:'OUTCOME_UNKNOWN',verificationState:'OUTCOME_UNKNOWN'});
 });
 it('recovers the committed receipt after process loss before ledger finalization without redispatch',async()=>{
  const {task,runId}=await prepare('commit-gap');
  const native=app.get(NativeCalendarRuntimeService);
  const resume=vi.spyOn(native,'resume').mockRejectedValueOnce(new Error('isolated crash after receipt commit'));
  try{
   await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task)},500);
  }finally{resume.mockRestore();}
  await native.recoverCommittedResults();
  await native.recoverCommittedResults();
  const ledger=await request(app.getHttpServer()).get('/api/runtime-results').set(auth(owner.token)).expect(200);
  expect(ledger.body.filter((r:any)=>r.invocationId===task.payload.invocationId)).toHaveLength(1);
  expect(ledger.body.find((r:any)=>r.invocationId===task.payload.invocationId)).toMatchObject({executionState:'SUCCEEDED',verificationState:'VERIFIED'});
  const [ops]=await pool.query<RowDataPacket[]>('SELECT status,attempt_count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)',[runId]);
  expect(ops).toHaveLength(1);expect(ops[0]).toMatchObject({status:'succeeded',attempt_count:1});
 });
 it('does not mark an UNKNOWN Task successful from a resolved Case lacking matching Verification Evidence',async()=>{
  const {task,runId}=await prepare('task-no-verification');
  await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task,false)});
  const [graphs]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM agent_task_graphs WHERE execution_id=UUID_TO_BIN(?)',[runId]);
  expect(graphs).toHaveLength(1);
  // Deliberately inconsistent metadata in this isolated fixture; no successful proof is appended.
  await pool.query("UPDATE reconciliation_cases SET status='RESOLVED',result_state='SUCCEEDED' WHERE user_id=UUID_TO_BIN(?) AND execution_id=UUID_TO_BIN(?) AND status='OPEN'",[owner.userId,runId]);
  const graph=await request(app.getHttpServer()).get('/api/task-graphs/'+graphs[0].id).set(auth(owner.token)).expect(200);
  expect(graph.body).toMatchObject({status:'UNKNOWN',recordedStatus:'UNKNOWN'});
  expect(graph.body.tasks.every((item:any)=>item.status==='UNKNOWN'&&item.recordedStatus==='UNKNOWN')).toBe(true);
  const [run]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(plan_id) planId FROM executions WHERE id=UUID_TO_BIN(?)',[runId]);
  const loopPath='/api/plans/'+run[0].planId+'/agent-loop';
  expect((await request(app.getHttpServer()).get(loopPath).set(auth(owner.token)).expect(200)).body.reflection.outcome).toBe('UNKNOWN');
  const history=(await request(app.getHttpServer()).get(loopPath+'/history').set(auth(owner.token)).expect(200)).body;
  expect(history.items.find((item:any)=>item.kind==='RUN'&&item.executionId===runId).reflection.outcome).toBe('UNKNOWN');
 });
 it('fences tampered bindings and revoked grants at dispatch renewal',async()=>{
  const {task}=await prepare('fences');
  await pool.query("UPDATE device_tasks SET payload_json=JSON_SET(payload_json,'$.authorityEpoch',999) WHERE id=UUID_TO_BIN(?)",[task.id]);
  await signedPost('/device-tasks/'+task.id+'/heartbeat',{claimToken:task.claimToken},409);
  await pool.query('UPDATE device_tasks SET payload_json=? WHERE id=UUID_TO_BIN(?)',[JSON.stringify(task.payload),task.id]);
  await pool.query("UPDATE local_capability_states SET user_grant=0 WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.create'",[deviceId]);
  await signedPost('/device-tasks/'+task.id+'/heartbeat',{claimToken:task.claimToken},403);
  await pool.query("UPDATE local_capability_states SET user_grant=1 WHERE trusted_device_id=UUID_TO_BIN(?) AND capability='calendar.create'",[deviceId]);
 });
 it('moves an expired dispatched write to uncertainty without reclaiming its side effect',async()=>{
  const {task}=await prepare('recovery');
  await pool.query('UPDATE device_tasks SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)',[task.id]);
  await app.get(DeviceTasksService).recoverExpired();
  await app.get(DeviceTasksService).recoverExpired();
  await signedPost('/device-tasks/'+task.id+'/claim',{},409);
  const [rows]=await pool.query<RowDataPacket[]>('SELECT status,error_code errorCode FROM device_tasks WHERE id=UUID_TO_BIN(?)',[task.id]);
  expect(rows[0]).toMatchObject({status:'FAILED',errorCode:'OUTCOME_UNKNOWN'});
  const [cases]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id,status,result_state resultState FROM reconciliation_cases WHERE operation_id=UUID_TO_BIN(?)',[task.payload.operationId]);
  expect(cases).toHaveLength(1);expect(cases[0]).toMatchObject({status:'OPEN',resultState:'OUTCOME_UNKNOWN'});
  const reconciler=app.get(ReconciliationService);
  const check=(await reconciler.claim(100)).find(row=>row.id===cases[0].id)!;
  await reconciler.process(check);
  const lookup=await signedPost('/device-tasks/'+cases[0].id+'/claim',{});
  expect(lookup.body.payload.lookupOnly).toBe(true);
  expect(lookup.body.payload.invocationId).toBe(task.payload.invocationId);
  await signedPost('/device-tasks/'+cases[0].id+'/complete',{claimToken:lookup.body.claimToken,result:receipt(lookup.body)});
  expect(await reconciler.get(owner.userId,cases[0].id)).toMatchObject({status:'RESOLVED',resultState:'SUCCEEDED'});
  const [original]=await pool.query<RowDataPacket[]>('SELECT status,result_hash resultHash FROM device_tasks WHERE id=UUID_TO_BIN(?)',[task.id]);
  expect(original[0]).toMatchObject({status:'FAILED',resultHash:null});
  await pool.query('UPDATE runtime_targets SET authority_epoch=authority_epoch+1 WHERE id=UUID_TO_BIN(?)',[task.payload.targetId]);
  await signedPost('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:receipt(task)},409);
 });
 it('rejects another signed claim while the native write lease is active',async()=>{
  const {task}=await prepare('duplicate-active-claim');
  await signedPost('/device-tasks/'+task.id+'/claim',{},409);
 });
});
