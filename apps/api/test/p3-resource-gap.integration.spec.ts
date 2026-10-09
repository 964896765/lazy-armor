import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LOCAL_CAPABILITY_CATALOG, realityValueHash } from '@lazy-armor/plan-schema';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { ResourceGapContinuationService } from '../src/consumer/resource-gap-continuation.service';
import { FactDemandResolverService } from '../src/fact-demands/fact-demand-resolver.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

/** Isolated signed collector fixture. These are protocol tests, never phone evidence. */
describe.sequential('P3 original Goal notification ResourceGap continuation',{timeout:120000},()=>{
  let app:INestApplication,pool:Pool,owner:Session,other:Session,trustedId:string,sessionId:string,connectionId:string,gaps:ResourceGapContinuationService;
  const unique='p3-'+Date.now(),deviceId='edge-'+unique,sourcePackage='com.jingdong.app.mall';
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const model={modelId:()=> 'fixture-notification-query',capability:()=>({modelId:'fixture-notification-query',supportsStructuredCompletion:true,supportsToolSelection:false,maxContextTokens:16000}),complete:async()=>({result:'ANSWER',factQuery:{factKey:'shipment.status',sourcePackage,lookbackHours:168},intentSummary:'看看京东快递通知',explanation:'需要读取真实通知',domain:null,scenarioKey:null,scenarioRevision:null,strategyKey:null,requiredFacts:[],selectedTruthRefs:[],requiredCapabilities:[],selectedSkillIds:[],toolRequirements:[],draftDefinition:null,missingRequirements:[],warnings:[],riskHints:[]})};
  function proof(path:string,body:unknown,context={sessionId,keys}){const requestId=randomBytes(32).toString('hex'),signedAt=new Date().toISOString(),payloadHash=hash(JSON.stringify(body));return {'x-device-session':context.sessionId,'x-device-request-id':requestId,'x-device-signed-at':signedAt,'x-device-payload-hash':payloadHash,'x-device-signature':sign('sha256',Buffer.from(`lazy-armor-device-request-v1|${context.sessionId}|${requestId}|POST|${path}|${payloadHash}|${signedAt}`),context.keys.privateKey).toString('base64')};}
  function signed(path:string,body:unknown){return request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set(proof(path,body)).send(body);}
  async function manifest(permission:'GRANTED'|'DENIED',grant=true,health='HEALTHY'){const body={manifestVersion:'android-local-v4',capabilities:LOCAL_CAPABILITY_CATALOG.map(s=>({key:s.key,userGrant:s.key==='notification.read'?grant:false,systemPermission:s.key==='notification.read'?permission:'UNKNOWN',health:s.key==='notification.read'?health:'HEALTHY',checkedAt:Date.now()}))};await signed('/consumer/local-capabilities',body).expect(201);await signed('/device-tasks/heartbeat',{onlineState:'online'}).expect(201);}
  async function draft(){const c=(await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'TEMPORARY'}).expect(201)).body;const r=(await request(app.getHttpServer()).post(`/api/conversations/${c.id}/messages`).set(auth(owner.token)).send({version:c.version,requestId:randomUUID(),content:'帮我看看最近京东有没有需要处理的快递'}).expect(201)).body;const m=r.messages.find((m:any)=>m.role==='assistant');expect(m.structuredPayload.resourceGap).toMatchObject({status:'WAITING_RESOURCE',ownerId:owner.userId});return {conversationId:c.id,messageId:m.id,version:r.version};}
  async function gap(id:string){return (await gaps.get(owner.userId,id)).message.structuredPayload!.resourceGap as any;}
  async function read(id:string,items:Record<string,unknown>[]){await gaps.resume(owner.userId,id);const state=await gap(id);const task=(await signed('/device-tasks/'+state.taskId+'/claim',{}).expect(201)).body;const contentJson=JSON.stringify(items),result={manifestVersion:'android-local-v1',capability:'notification.read',state:items.length?'VERIFIED_PRESENT':'VERIFIED_EMPTY',observedAt:Date.now(),scopeStart:task.payload.scopeStart,scopeEnd:task.payload.scopeEnd,itemCount:items.length,items,contentJson,contentHash:hash(contentJson)};return {task,body:{claimToken:task.claimToken,result}};}
  function shipmentItems(label:string){return [{eventId:hash(label+'-shipment-'+unique),contentHash:hash(label+'-notification-'+unique),sourcePackage,postedAt:Date.now()-5000,capturedAt:Date.now(),hasTitle:true,hasText:true,candidateKind:'shipment_candidate',candidateResource:'shipment',candidateConfidence:75,amountMinor:null,currency:null,candidateStatus:'IN_TRANSIT',parserVersion:'generic-notification-v1',status:'received_unclassified'}];}
  async function confirm(items:Record<string,unknown>[]){
    const pending=(await request(app.getHttpServer()).get('/api/device-app-connections/notification-receipts').set(auth(owner.token)).expect(200)).body;
    const receipt=pending.find((p:any)=>p.connectionId===connectionId);
    const [rows]=await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM mobile_notification_receipts WHERE device_app_connection_id=UUID_TO_BIN(?) AND event_id=?',[connectionId,items[0].eventId]);
    expect(receipt).toBeTruthy();
    return (await request(app.getHttpServer()).post(`/api/device-app-connections/${connectionId}/notification-receipts/${rows[0].id}/verify`).set(auth(owner.token)).send({confirmed:true}).expect(201)).body.truthRecord;
  }
  async function results(conversationId:string,id:string){const c=(await request(app.getHttpServer()).get('/api/conversations/'+conversationId).set(auth(owner.token)).expect(200)).body;return c.messages.filter((m:any)=>m.structuredPayload?.resourceGapRef===id);}
  async function taskSnapshot(id:string){const [rows]=await pool.query<RowDataPacket[]>('SELECT status,result_json result,result_hash resultHash,error_code errorCode FROM device_tasks WHERE id=UUID_TO_BIN(?)',[id]);return rows[0];}
  async function sourceModes(modes:string[]){await request(app.getHttpServer()).patch('/api/device-app-connections/'+connectionId).set(auth(owner.token)).send({modes}).expect(200);}
  beforeAll(async()=>{
    ({app,pool}=await bootP2App(unique,[{token:AGENT_MODEL,value:model}]));gaps=app.get(ResourceGapContinuationService);owner=await register(app,unique+'@example.com','P3 owner');other=await register(app,unique+'-other@example.com','Other');
    const publicKeySpki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
    const challenge=(await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({deviceId,keyId:unique,publicKeySpki,publicKeyFingerprint:createHash('sha256').update(Buffer.from(publicKeySpki,'base64')).digest('hex')}).expect(201)).body;
    // Fingerprint hashes DER bytes, not their UTF-8 string representation.
    const signature=sign('sha256',Buffer.from(challenge.payload),keys.privateKey).toString('base64');
    const device=(await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.challengeId}/verify`).set(auth(owner.token)).send({signature}).expect(201)).body;trustedId=device.id;sessionId=device.deviceSession.id;
    connectionId=(await signed('/device-app-connections',{trustedDeviceId:trustedId,deviceId,packageName:sourcePackage,displayName:'JD signed test collector',launchable:true,discoveryFingerprint:hash(unique),modes:['open_app','notification_read']}).expect(201)).body.id;
  });
  afterAll(async()=>{await pool?.end();await app?.close();});
  afterEach(()=>vi.restoreAllMocks());
  it('retains the original query without Plan or Task when system permission is unavailable',async()=>{
    await manifest('DENIED');const d=await draft();await gaps.resume(owner.userId,d.messageId);expect(await gap(d.messageId)).toMatchObject({status:'WAITING_RESOURCE',reasons:['NOTIFICATION_ACCESS_REQUIRED']});await expect(gaps.get(other.userId,d.messageId)).rejects.toThrow('资源缺口不存在');
    for(const table of ['plans','capability_invocations','device_tasks']){const [rows]=await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table} WHERE user_id=UUID_TO_BIN(?)`,[owner.userId]);expect(Number(rows[0].n)).toBe(0);}
  });
  it('recomputes after authorization and resumes the same Goal through the existing signed read queue',async()=>{
    await manifest('DENIED');const d=await draft();await gaps.resume(owner.userId,d.messageId);await manifest('GRANTED');
    const items=[{eventId:hash('shipment-'+unique),contentHash:hash('notification-'+unique),sourcePackage,postedAt:Date.now()-5000,capturedAt:Date.now(),hasTitle:true,hasText:true,candidateKind:'shipment_candidate',candidateResource:'shipment',candidateConfidence:75,amountMinor:null,currency:null,candidateStatus:'IN_TRANSIT',parserVersion:'generic-notification-v1',status:'received_unclassified'}];
    const {task,body}=await read(d.messageId,items);
    const rawItems=[{...items[0],rawTitle:'forbidden private title'}],rawJson=JSON.stringify(rawItems);
    await signed('/device-tasks/'+task.id+'/complete',{...body,result:{...body.result,items:rawItems,contentJson:rawJson,contentHash:hash(rawJson)}}).expect(400);
    const otherItems=[{...items[0],sourcePackage:'com.other.app'}],otherJson=JSON.stringify(otherItems);
    await signed('/device-tasks/'+task.id+'/complete',{...body,result:{...body.result,items:otherItems,contentJson:otherJson,contentHash:hash(otherJson)}}).expect(400);
    await signed('/device-tasks/'+task.id+'/complete',body).expect(201);await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('WAITING_FACT_CONFIRMATION');
    const pending=(await request(app.getHttpServer()).get('/api/device-app-connections/notification-receipts').set(auth(owner.token)).expect(200)).body;const receipt=pending.find((p:any)=>p.candidateKind==='shipment_candidate');expect(receipt).toMatchObject({candidateResource:'shipment',candidateStatus:'IN_TRANSIT'});
    await request(app.getHttpServer()).post(`/api/device-app-connections/${connectionId}/notification-receipts/${receipt.id}/verify`).set(auth(owner.token)).send({confirmed:true}).expect(201);
    await gaps.recover();await gaps.recover();expect((await gap(d.messageId)).status).toBe('COMPLETED');await signed('/device-tasks/'+task.id+'/complete',body).expect(201);await gaps.resume(owner.userId,d.messageId);
    const c=(await request(app.getHttpServer()).get('/api/conversations/'+d.conversationId).set(auth(owner.token)).expect(200)).body;const results=c.messages.filter((m:any)=>m.structuredPayload?.resourceGapRef===d.messageId);expect(results).toHaveLength(1);expect(results[0].structuredPayload.truthRefs).toHaveLength(1);expect(results[0].structuredPayload.sourceTaskRef).toBe(task.id);
    const [tasks]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM device_tasks WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.resourceGapMessageId\'))=?',[d.messageId]);expect(Number(tasks[0].n)).toBe(1);
  });
  it('keeps verified empty reads bounded to authorized notifications, without claiming no shipments exist',async()=>{
    await manifest('GRANTED');const d=await draft();const {task,body}=await read(d.messageId,[]);await signed('/device-tasks/'+task.id+'/complete',body).expect(201);await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('COMPLETED');const c=(await request(app.getHttpServer()).get('/api/conversations/'+d.conversationId).set(auth(owner.token))).body;expect(c.messages.at(-1).content).toContain('不能证明没有快递');expect(c.messages.at(-1).structuredPayload.truthRefs).toEqual([]);
  });
  it('preserves a failed read and only permits a bounded new read after resource recovery',async()=>{
    await manifest('GRANTED');const d=await draft();const {task}=await read(d.messageId,[]);
    await signed('/device-tasks/'+task.id+'/fail',{claimToken:task.claimToken,errorCode:'DEVICE_READ_EXECUTION_FAILED'}).expect(201);
    await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('READ_FAILED');
    await gaps.recover();expect((await gap(d.messageId)).taskId).toBe(task.id);
    await manifest('GRANTED',true,'UNAVAILABLE');await gaps.recover();expect(await gap(d.messageId)).toMatchObject({status:'WAITING_RESOURCE',reasons:['NOTIFICATION_COLLECTION_UNAVAILABLE'],taskId:task.id});
    await manifest('GRANTED');await gaps.recover();await gaps.recover();
    const resumed=await gap(d.messageId);expect(resumed).toMatchObject({attempt:2,failedReadRefs:[task.id]});expect(resumed.taskId).not.toBe(task.id);
    const next=await read(d.messageId,[]);await signed('/device-tasks/'+next.task.id+'/complete',next.body).expect(201);await gaps.recover();
    expect((await gap(d.messageId)).status).toBe('COMPLETED');
    const [prior]=await pool.query<RowDataPacket[]>('SELECT status,result_json result FROM device_tasks WHERE id=UUID_TO_BIN(?)',[task.id]);expect(prior[0]).toMatchObject({status:'FAILED',result:null});
    await gaps.recover();const c=(await request(app.getHttpServer()).get('/api/conversations/'+d.conversationId).set(auth(owner.token))).body;
    expect(c.messages.filter((m:any)=>m.structuredPayload?.resourceGapRef===d.messageId)).toHaveLength(1);
  });
  it('fences an original query after a newer user goal and rejects old read completion',async()=>{
    await manifest('GRANTED');const d=await draft();const {task,body}=await read(d.messageId,[]);
    await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/messages`).set(auth(owner.token)).send({version:d.version,requestId:randomUUID(),content:'修改查询范围，先不要读旧需求'}).expect(201);
    await signed('/device-tasks/'+task.id+'/complete',body).expect(409);await gaps.recover();expect((await gap(d.messageId)).status).toBe('SUPERSEDED');
  });
  it('rejects read completion after source permission revocation instead of publishing candidates',async()=>{
    await manifest('GRANTED');const d=await draft();const {task,body}=await read(d.messageId,[]);await manifest('DENIED');await signed('/device-tasks/'+task.id+'/complete',body).expect(409);await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('WAITING_RESOURCE');
    expect((await app.get(FactDemandResolverService).resolveNotificationQuery(owner.userId,sourcePackage)).selected).toBeNull();
  });
  it('rebinds a new source epoch with one bounded read and fences the old holder',async()=>{
    await manifest('GRANTED');const d=await draft();const old=await read(d.messageId,[]);const before=await gap(d.messageId);
    await manifest('GRANTED',false);await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('WAITING_RESOURCE');
    await signed('/device-tasks/'+old.task.id+'/complete',old.body).expect(409);
    await signed('/device-tasks/'+old.task.id+'/heartbeat',{claimToken:old.task.claimToken}).expect(409);await signed('/device-tasks/'+old.task.id+'/fail',{claimToken:old.task.claimToken,errorCode:'STALE_SOURCE_ATTEMPT'}).expect(409);
    await manifest('GRANTED');await gaps.resume(owner.userId,d.messageId);await gaps.resume(owner.userId,d.messageId);
    const nextGap=await gap(d.messageId);expect(nextGap).toMatchObject({attempt:2,userMessageId:before.userMessageId,goalHash:before.goalHash,conversationVersion:before.conversationVersion,supersededReadRefs:[old.task.id]});expect(nextGap.authorityEpoch).toBeGreaterThan(before.authorityEpoch);expect(nextGap.taskId).not.toBe(old.task.id);
    expect(await taskSnapshot(old.task.id)).toMatchObject({status:'CANCELLED',result:null,errorCode:'RESOURCE_GAP_SOURCE_REBOUND'});
    await signed('/device-tasks/'+old.task.id+'/claim',{}).expect(409);await signed('/device-tasks/'+old.task.id+'/complete',old.body).expect(409);await signed('/device-tasks/'+old.task.id+'/heartbeat',{claimToken:old.task.claimToken}).expect(409);await signed('/device-tasks/'+old.task.id+'/fail',{claimToken:old.task.claimToken,errorCode:'STALE_SOURCE_ATTEMPT'}).expect(409);
    const next=await read(d.messageId,[]);expect(next.task.payload.notificationSourceBinding).toMatchObject({schema:'notification-source-binding.v1',deviceAppConnectionId:nextGap.connectionId,trustedDeviceId:nextGap.trustedDeviceId,targetId:nextGap.targetId,authorityEpoch:nextGap.authorityEpoch,sourceVersion:nextGap.sourceVersion,sourcePackage});await signed('/device-tasks/'+next.task.id+'/complete',next.body).expect(201);await gaps.resume(owner.userId,d.messageId);
    expect(await results(d.conversationId,d.messageId)).toHaveLength(1);expect((await gap(d.messageId)).status).toBe('COMPLETED');
  });
  it('rejects publication if the actual source is revoked after Truth preparation, retaining the successful receipt',async()=>{
    await manifest('GRANTED');const d=await draft();const items=shipmentItems('publish-source');const old=await read(d.messageId,items);await signed('/device-tasks/'+old.task.id+'/complete',old.body).expect(201);await confirm(items);const oldSnapshot=await taskSnapshot(old.task.id);
    const original=(gaps as any).publishResult.bind(gaps);
    vi.spyOn(gaps as any,'publishResult').mockImplementationOnce(async(...args:unknown[])=>{await sourceModes(['open_app']);return original(...args);});
    await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('WAITING_RESOURCE');expect(await results(d.conversationId,d.messageId)).toHaveLength(0);expect(await taskSnapshot(old.task.id)).toEqual(oldSnapshot);
    await sourceModes(['open_app','notification_read']);await gaps.resume(owner.userId,d.messageId);await gaps.resume(owner.userId,d.messageId);
    const rebound=await gap(d.messageId);expect(rebound).toMatchObject({attempt:2,supersededReadRefs:[old.task.id]});expect(rebound.taskId).not.toBe(old.task.id);
    await signed('/device-tasks/'+old.task.id+'/complete',old.body).expect(409);
    const fresh=await read(d.messageId,items);await signed('/device-tasks/'+fresh.task.id+'/complete',fresh.body).expect(201);await gaps.resume(owner.userId,d.messageId);
    const answer=await results(d.conversationId,d.messageId);expect(answer).toHaveLength(1);expect(answer[0].structuredPayload.truthRefs).toHaveLength(1);expect(answer[0].structuredPayload.sourceTaskRef).toBe(fresh.task.id);expect(answer[0].structuredPayload.receiptSourceProofs[0].sourceProof.reobservation).toMatchObject({taskId:fresh.task.id});expect(await taskSnapshot(old.task.id)).toEqual(oldSnapshot);
  });
  it('fences a Truth revoked between preparation and publication without changing its history or Task result',async()=>{
    await manifest('GRANTED');const d=await draft();const items=shipmentItems('publish-revoked-truth');const r=await read(d.messageId,items);await signed('/device-tasks/'+r.task.id+'/complete',r.body).expect(201);const truth=await confirm(items);const snapshot=await taskSnapshot(r.task.id);
    const original=(gaps as any).publishResult.bind(gaps);
    vi.spyOn(gaps as any,'publishResult').mockImplementationOnce(async(...args:unknown[])=>{
      // Private isolated *_test fixture: model a concurrent authority revocation.
      await pool.query("UPDATE truth_records SET status='revoked',revoked_at=NOW(6) WHERE id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?)",[truth.id,owner.userId]);
      return original(...args);
    });
    await gaps.resume(owner.userId,d.messageId);expect(await gap(d.messageId)).toMatchObject({status:'WAITING_FACT_CONFIRMATION',reasons:['RESOURCE_GAP_TRUTH_CHANGED']});expect(await results(d.conversationId,d.messageId)).toHaveLength(0);
    await gaps.resume(owner.userId,d.messageId);expect((await gap(d.messageId)).status).toBe('WAITING_FACT_CONFIRMATION');expect(await taskSnapshot(r.task.id)).toEqual(snapshot);
    const [versions]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM truth_record_versions WHERE truth_record_id=UUID_TO_BIN(?)',[truth.id]);expect(Number(versions[0].n)).toBe(1);
  });
  it('does not publish a superseded Truth version and subsequently consumes the exact new version',async()=>{
    await manifest('GRANTED');const d=await draft();const items=shipmentItems('publish-version');const r=await read(d.messageId,items);await signed('/device-tasks/'+r.task.id+'/complete',r.body).expect(201);const truth=await confirm(items);
    const original=(gaps as any).publishResult.bind(gaps),newVersionId=randomUUID();
    vi.spyOn(gaps as any,'publishResult').mockImplementationOnce(async(...args:unknown[])=>{
      const conn=await pool.getConnection();try{await conn.beginTransaction();
        const [rows]=await conn.query<RowDataPacket[]>('SELECT value_json value,evidence_hash evidenceHash FROM truth_record_versions WHERE id=UUID_TO_BIN(?)',[truth.currentVersionId]);
        const value=typeof rows[0].value==='string'?JSON.parse(rows[0].value):rows[0].value;const updated={...value,value:{...value.value,status:'READY_FOR_PICKUP'}};
        await conn.query('INSERT INTO truth_record_versions (id,truth_record_id,version_number,value_json,value_hash,verification_method,evidence_hash,created_at) VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),2,?,?,\'fixture-concurrent-verification\',?,NOW(6))',[newVersionId,truth.id,JSON.stringify(updated),realityValueHash(updated),rows[0].evidenceHash]);
        await conn.query('UPDATE truth_records SET current_version_id=UUID_TO_BIN(?) WHERE id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?)',[newVersionId,truth.id,owner.userId]);await conn.commit();
      }catch(e){await conn.rollback();throw e;}finally{conn.release();}
      return original(...args);
    });
    await gaps.resume(owner.userId,d.messageId);expect(await gap(d.messageId)).toMatchObject({status:'WAITING_FACT_CONFIRMATION',reasons:['RESOURCE_GAP_TRUTH_CHANGED']});expect(await results(d.conversationId,d.messageId)).toHaveLength(0);
    await gaps.resume(owner.userId,d.messageId);const answer=await results(d.conversationId,d.messageId);expect(answer).toHaveLength(1);expect(answer[0].content).toContain('待取件');expect(answer[0].structuredPayload.truthVersions[0]).toMatchObject({truthId:truth.id,versionId:newVersionId});expect(answer[0].structuredPayload.truthVersions[0].versionId).not.toBe(truth.currentVersionId);
    const [versions]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM truth_record_versions WHERE truth_record_id=UUID_TO_BIN(?)',[truth.id]);expect(Number(versions[0].n)).toBe(2);
  });
  it('does not publish prepared Truth into a Conversation whose Goal changed before the commit',async()=>{
    await manifest('GRANTED');const d=await draft();const items=shipmentItems('publish-goal');const r=await read(d.messageId,items);await signed('/device-tasks/'+r.task.id+'/complete',r.body).expect(201);await confirm(items);
    const original=(gaps as any).publishResult.bind(gaps);
    vi.spyOn(gaps as any,'publishResult').mockImplementationOnce(async(...args:unknown[])=>{
      await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/messages`).set(auth(owner.token)).send({version:d.version,requestId:randomUUID(),content:'旧查询先不发布，改看其它事项'}).expect(201);
      return original(...args);
    });
    await expect(gaps.resume(owner.userId,d.messageId)).rejects.toThrow('RESOURCE_GAP_SOURCE_SUPERSEDED');await gaps.recover();expect((await gap(d.messageId)).status).toBe('SUPERSEDED');expect(await results(d.conversationId,d.messageId)).toHaveLength(0);expect(await taskSnapshot(r.task.id)).toMatchObject({status:'SUCCEEDED'});
  });
  it('leaves a completed empty Goal immutable after later source changes',async()=>{
    await manifest('GRANTED');const d=await draft();const r=await read(d.messageId,[]);await signed('/device-tasks/'+r.task.id+'/complete',r.body).expect(201);await gaps.resume(owner.userId,d.messageId);const completed=await gap(d.messageId),snapshot=await taskSnapshot(r.task.id),answer=await results(d.conversationId,d.messageId);
    await sourceModes(['open_app']);await manifest('DENIED');await sourceModes(['open_app','notification_read']);await manifest('GRANTED');await gaps.resume(owner.userId,d.messageId);
    expect(await gap(d.messageId)).toEqual(completed);expect(await taskSnapshot(r.task.id)).toEqual(snapshot);expect(await results(d.conversationId,d.messageId)).toEqual(answer);
  });
  it('bounds authority churn to three read attempts instead of creating an unbounded task loop',async()=>{
    await manifest('GRANTED');const d=await draft();await gaps.resume(owner.userId,d.messageId);
    for(let i=0;i<3;i++){await sourceModes(['open_app']);await gaps.resume(owner.userId,d.messageId);await sourceModes(['open_app','notification_read']);await gaps.resume(owner.userId,d.messageId);await gaps.resume(owner.userId,d.messageId);}
    expect(await gap(d.messageId)).toMatchObject({attempt:3,status:'WAITING_RESOURCE',reasons:['READ_ATTEMPT_LIMIT_REACHED']});
    const [rows]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM device_tasks WHERE user_id=UUID_TO_BIN(?) AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,\'$.resourceGapMessageId\'))=?',[owner.userId,d.messageId]);expect(Number(rows[0].n)).toBe(3);expect(await results(d.conversationId,d.messageId)).toHaveLength(0);
  });
  it('rebinds to a legitimately enrolled replacement device without changing the original Goal authority',async()=>{
    await manifest('GRANTED');const d=await draft();const old=await read(d.messageId,[]),before=await gap(d.messageId);
    const nextKeys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),nextDeviceId='replacement-'+unique,publicKeySpki=nextKeys.publicKey.export({format:'der',type:'spki'}).toString('base64');
    const challenge=(await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({deviceId:nextDeviceId,keyId:unique+'-replacement',publicKeySpki,publicKeyFingerprint:createHash('sha256').update(Buffer.from(publicKeySpki,'base64')).digest('hex')}).expect(201)).body;
    const replacement=(await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.challengeId}/verify`).set(auth(owner.token)).send({signature:sign('sha256',Buffer.from(challenge.payload),nextKeys.privateKey).toString('base64')}).expect(201)).body;
    const context={sessionId:replacement.deviceSession.id,keys:nextKeys};
    const nextSigned=(path:string,body:unknown)=>request(app.getHttpServer()).post('/api'+path).set(auth(owner.token)).set(proof(path,body,context)).send(body);
    const nextSource=(await nextSigned('/device-app-connections',{trustedDeviceId:replacement.id,deviceId:nextDeviceId,packageName:sourcePackage,displayName:'JD replacement signed test collector',launchable:true,discoveryFingerprint:hash(unique+'-replacement-discovery'),modes:['open_app','notification_read']}).expect(201)).body;
    await nextSigned('/consumer/local-capabilities',{manifestVersion:'android-local-v4',capabilities:LOCAL_CAPABILITY_CATALOG.map(s=>({key:s.key,userGrant:s.key==='notification.read',systemPermission:s.key==='notification.read'?'GRANTED':'UNKNOWN',health:'HEALTHY',checkedAt:Date.now()}))}).expect(201);await nextSigned('/device-tasks/heartbeat',{onlineState:'online'}).expect(201);
    expect((await app.get(FactDemandResolverService).resolveNotificationQuery(owner.userId,sourcePackage)).state).toBe('NEEDS_SOURCE_SELECTION');
    await sourceModes(['open_app']);await gaps.resume(owner.userId,d.messageId);await gaps.resume(owner.userId,d.messageId);
    const rebound=await gap(d.messageId);expect(rebound).toMatchObject({attempt:2,connectionId:nextSource.id,trustedDeviceId:replacement.id,userMessageId:before.userMessageId,goalHash:before.goalHash,conversationVersion:before.conversationVersion,supersededReadRefs:[old.task.id]});expect(rebound.targetId).not.toBe(before.targetId);
    await signed('/device-tasks/'+old.task.id+'/complete',old.body).expect(409);
    const task=(await nextSigned('/device-tasks/'+rebound.taskId+'/claim',{}).expect(201)).body;
    await nextSigned('/device-tasks/'+task.id+'/complete',{claimToken:task.claimToken,result:{...old.body.result,observedAt:Date.now(),scopeStart:task.payload.scopeStart,scopeEnd:task.payload.scopeEnd}}).expect(201);await gaps.resume(owner.userId,d.messageId);
    const answer=await results(d.conversationId,d.messageId);expect(answer).toHaveLength(1);expect(answer[0].structuredPayload.sourceTaskRef).toBe(task.id);expect(answer[0].structuredPayload.sourceBinding.trustedDeviceId).toBe(replacement.id);expect(await taskSnapshot(old.task.id)).toMatchObject({status:'CANCELLED',result:null});
  });
});
