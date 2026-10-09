import { RuntimeSourceContinuationService } from './runtime-source-continuation.service';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import {assertExecutionOwner} from './execution-owner-context';
import { RuntimeAuthorityService } from './runtime-authority.service';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {AuditService} from '../audit/audit.service';
import { actionAdapterBindings, approvalRequests, capabilityInvocations, deviceTasks, executionSteps, executions, invocationRuntimeLinks, localCapabilityStates, runtimeTargets, sideEffectOperations, trustedDevices, reconciliationCases } from '@lazy-armor/database';
import { ANDROID_CALENDAR_WRITE_POLICY, ANDROID_CALENDAR_UPDATE_POLICY, ANDROID_CALENDAR_DELETE_POLICY, prepareAndroidCalendarUpdate, prepareAndroidCalendarDelete, nativeCalendarGrant, capabilityInvocationSchema, canonicalStringify, catalogHash, prepareAndroidCalendarCreate, verificationContractHash, type CapabilityInvocation, type VerificationContract } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { createHash,createPrivateKey,createPublicKey,createECDH,sign } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CapabilityInvocationsService } from '../capability-invocations/capability-invocations.service';
import { ActionAdapter } from './action-adapter.service';
import { ExecutionStepStateService } from './execution-step-state.service';
import { VerificationService } from './verification.service';
import { SideEffectOperationsService } from './side-effect/side-effect-operations.service';
import { OutboxWorker } from './side-effect/outbox-worker.service';
import type { SideEffectPrepareInput } from './side-effect/side-effect-coordinator.service';

type Tx = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
const sha = (text:string) => createHash('sha256').update(text).digest('hex');
function envelope(row: typeof capabilityInvocations.$inferSelect): CapabilityInvocation {
  const {id,userId,actionIntentId,targetManifestHash,invocationHash,createdAt,...fields}=row;
  return capabilityInvocationSchema.parse({...fields,invocationId:id,createdAt:createdAt.toISOString()});
}

/** Native dispatch adapter over the existing Execution/Operation/DeviceTask authorities. */
@Injectable()
export class NativeCalendarRuntimeService {
  constructor(@Inject(DATABASE) private readonly db:InjectedDatabase, private readonly invocations:CapabilityInvocationsService,
    private readonly adapter:ActionAdapter,private readonly operations:SideEffectOperationsService,
    private readonly steps:ExecutionStepStateService,private readonly verification:VerificationService,private readonly modules:ModuleRef,private readonly config:ConfigService,private readonly audit:AuditService) {}
  private signingKey() {
    const seed=createHash('sha256').update('native-device-dispatch-v1:'+this.config.getOrThrow<string>('JWT_SECRET')).digest();
    const ec=createECDH('prime256v1');ec.setPrivateKey(seed);const publicBytes=ec.getPublicKey();
    return createPrivateKey({format:'jwk',key:{kty:'EC',crv:'P-256',d:seed.toString('base64url'),x:publicBytes.subarray(1,33).toString('base64url'),y:publicBytes.subarray(33).toString('base64url')}});
  }
  publicSigningKey() {return createPublicKey(this.signingKey()).export({format:'der',type:'spki'}).toString('base64');}
  async executionTicket(tx:Tx,userId:string,task:typeof deviceTasks.$inferSelect) {
    const row=await this.assertTask(tx,userId,task);
    const approval=(await tx.select().from(approvalRequests).where(and(eq(approvalRequests.id,String(task.payloadJson.approvalRef)),eq(approvalRequests.userId,userId))).for('update'))[0];
    const lookupOnly=task.payloadJson.lookupOnly===true;
    if(!approval||approval.status!=='approved'||(!lookupOnly&&approval.expiresAt<=new Date())||approval.executionStepId!==task.payloadJson.executionStepId)throw new ForbiddenException('Native dispatch approval expired or changed');
    const payload=Buffer.from(canonicalStringify({version:'1',userId,taskId:task.id,claimToken:task.claimToken,targetId:row.targetId,
      authorityEpoch:row.authorityEpoch,expiresAt:task.leaseExpiresAt!.toISOString(),approvalRef:approval.id,
      verificationContractHash:row.verificationContractRef,lookupOnly,invocationJson:canonicalStringify(envelope(row))}));
    return {payload:payload.toString('base64'),signature:sign('sha256',payload,this.signingKey()).toString('base64')};
  }

  async prepare(input:SideEffectPrepareInput):Promise<{prepared:true;operationId:string}> {
    await this.adapter.assertOperation(input.execution.id,input.step.id);
    const step=(await this.db.select().from(executionSteps).where(eq(executionSteps.id,input.step.id)))[0];
    const row=step?.actionIntentId&&(await this.db.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,input.execution.userId),eq(capabilityInvocations.actionIntentId,step.actionIntentId))))[0];
    if(!row||!['calendar.event.create','calendar.event.update','calendar.event.delete'].includes(row.capabilityId))throw new ConflictException('Native canonical Invocation required');
    await this.invocations.assertCurrent(input.execution.userId,row.id);
    const config=row.arguments.actionConfig as Record<string,unknown>;
    if(row.capabilityId==='calendar.event.create')prepareAndroidCalendarCreate(config.calendarEvent);
    else if(row.capabilityId==='calendar.event.update')prepareAndroidCalendarUpdate(config.calendarMutation);
    else prepareAndroidCalendarDelete(config.calendarMutation);
    return this.db.transaction(async tx=>{
      const owner=(await tx.select().from(executions).where(eq(executions.id,input.execution.id)).for('update'))[0];
      if(!owner)throw new ConflictException('Execution unavailable');
      assertExecutionOwner(owner);
      const authority=await this.authority(tx,input.execution.userId,row);
      const approval=(await tx.select().from(approvalRequests).where(and(eq(approvalRequests.executionStepId,input.step.id),eq(approvalRequests.userId,input.execution.userId))).for('update'))[0];
      if(!approval||approval.status!=='approved'||approval.expiresAt<=new Date()||approval.inputFingerprint!==input.step.inputFingerprint)throw new ForbiddenException('Explicit current native write approval required');
      const binding=(await tx.select().from(actionAdapterBindings).where(eq(actionAdapterBindings.actionIntentId,row.actionIntentId!)))[0];
      const contract=binding?.verificationContractJson as unknown as VerificationContract;
      if(!contract||verificationContractHash(contract)!==row.verificationContractRef||contract.providerKey!=='android_calendar')throw new ConflictException('Native verification contract mismatch');
      const prepared=await this.operations.prepare({userId:input.execution.userId,executionId:input.execution.id,executionStepId:input.step.id,
        planId:input.execution.planId,planVersionId:input.execution.planVersionId,planActionId:input.step.planActionId,actionType:input.step.actionType,
        connectorId:null,connectionId:null,capabilityKey:row.capabilityId,inputFingerprint:input.step.inputFingerprint,
        requestSnapshot:{invocationId:row.id,targetId:row.targetId,authorityEpoch:row.authorityEpoch,idempotencyKey:row.idempotencyKey,verificationContract:contract},
        providerIdempotencyKey:null,requestId:input.execution.id+':'+input.step.stepOrder,correlationId:input.execution.requestId,causationId:input.step.id},tx);
      const prior=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,row.id)).for('update'))[0];
      if(prior){if(prior.userId!==input.execution.userId||prior.payloadJson.invocationHash!==row.invocationHash)throw new ConflictException('Native task identity conflict');return {prepared:true,operationId:prepared.id};}
      const now=new Date();
      await tx.insert(deviceTasks).values({id:row.id,userId:input.execution.userId,trustedDeviceId:authority.device.id,deviceId:authority.device.deviceId,
        taskType:row.capabilityId==='calendar.event.create'?'NATIVE_CALENDAR_CREATE':'NATIVE_CALENDAR_WRITE',resourceType:'CalendarEvent',factKey:row.capabilityId==='calendar.event.delete'?'calendar_event.presence':'calendar_event.schedule',status:'PENDING',
        payloadJson:{invocation:envelope(row),invocationId:row.id,invocationHash:row.invocationHash,targetId:row.targetId,authorityEpoch:row.authorityEpoch,
          idempotencyKey:row.idempotencyKey,verificationContract:contract,operationId:prepared.id,executionStepId:input.step.id,approvalRef:approval.id},
        claimToken:null,claimedAt:null,leaseExpiresAt:null,resultJson:null,resultHash:null,errorCode:null,completedAt:null,createdAt:now,updatedAt:now});
      await tx.insert(invocationRuntimeLinks).values({id:newId(),invocationId:row.id,runtimeKind:'DEVICE_TASK',runtimeRef:row.id,createdAt:now});
      await this.operations.mark(prepared.id,{status:'queued'},tx);
      await this.steps.transition(input.step.id,'waiting_dispatch',{dispatchStatus:'queued'},tx);
      await this.audit.append({actorType:'worker',userId:input.execution.userId,executionId:input.execution.id,executionStepId:input.step.id,action:'NATIVE_WRITE_TASK_DISPATCHED',resourceType:'device_task',resourceId:row.id,source:'execution_worker',result:'pending',after:{invocationId:row.id,targetId:row.targetId,authorityEpoch:row.authorityEpoch,operationId:prepared.id,approvalRef:approval.id}},tx);
      return {prepared:true,operationId:prepared.id};
    });
  }

  async authority(tx:Tx,userId:string,row:typeof capabilityInvocations.$inferSelect,operation:'WRITE'|'RECONCILE'='WRITE') {
    const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.id,row.targetId),eq(runtimeTargets.userId,userId))).for('update'))[0];
    if(!target||target.targetType!=='ANDROID_DEVICE'||target.authorityEpoch!==row.authorityEpoch||target.manifestHash!==row.targetManifestHash||target.health==='UNAVAILABLE')throw new ConflictException('STALE_NATIVE_AUTHORITY');
    const device=(await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id,target.backingRef),eq(trustedDevices.userId,userId))).for('update'))[0];
    const grant=(await tx.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.trustedDeviceId,target.backingRef),eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.capability,nativeCalendarGrant(row.capabilityId)))).for('update'))[0];
    if(!device||device.status!=='active'||device.revokedAt||!grant||!grant.userGrant||grant.systemPermission!=='GRANTED'||grant.health!=='HEALTHY'||Date.now()-grant.checkedAt.getTime()>300000||grant.checkedAt.getTime()>Date.now()+1000)throw new ForbiddenException('Native write authority unavailable');
    const gate=this.modules.get(RuntimeAuthorityService,{strict:false});
    if(row.planId&&row.planVersionId)await gate.assertPlan(tx,userId,row.planId,row.planVersionId);
    else {
      const execution=row.executionId?(await tx.select().from(executions).where(and(eq(executions.id,row.executionId),eq(executions.userId,userId))).for('update'))[0]:null;
      if(!execution||catalogHash(execution.authoritySourceJson)!==catalogHash(row.resourceScope.authoritySource))throw new ConflictException('NATIVE_AUTHORITY_SOURCE_MISMATCH');
      await gate.assertCurrent(tx,gate.sourceFor(execution),{userId,planId:row.planId,planVersionId:row.planVersionId},operation);
    }
    return {target,device};
  }

  async assertTask(tx:Tx,userId:string,task:typeof deviceTasks.$inferSelect,operation:'WRITE'|'RECONCILE'='WRITE') {
    const row=(await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.id,String(task.payloadJson.invocationId)),eq(capabilityInvocations.userId,userId))))[0];
    if(!row||!['calendar.event.create','calendar.event.update','calendar.event.delete'].includes(row.capabilityId)||task.payloadJson.invocationHash!==row.invocationHash
      ||catalogHash(task.payloadJson.invocation)!==catalogHash(envelope(row))||task.payloadJson.targetId!==row.targetId
      ||task.payloadJson.authorityEpoch!==row.authorityEpoch||task.payloadJson.idempotencyKey!==row.idempotencyKey
      ||verificationContractHash(task.payloadJson.verificationContract as unknown as VerificationContract)!==row.verificationContractRef)throw new ConflictException('Native write task immutable binding mismatch');
    const {id,createdAt,invocationHash,...fields}=row;
    if(sha(canonicalStringify(fields))!==invocationHash)throw new ConflictException('Invocation integrity failure');
    const {device}=await this.authority(tx,userId,row,task.payloadJson.lookupOnly===true?'RECONCILE':operation);
    if(task.trustedDeviceId!==device.id||task.deviceId!==device.deviceId)throw new ForbiddenException('Wrong native device');
    return row;
  }
  async queueLookup(caseId:string,userId:string,operationId:string) {
    return this.db.transaction(async tx=>{
      const check=(await tx.select().from(reconciliationCases).where(and(eq(reconciliationCases.id,caseId),eq(reconciliationCases.userId,userId))).for('update'))[0];
      if(!check||check.operationId!==operationId||check.status!=='RECONCILING'||!check.leaseUntil||check.leaseUntil<=new Date())throw new ConflictException('Native reconciliation case binding unavailable');
      const operation=(await tx.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.id,operationId),eq(sideEffectOperations.userId,userId))).for('update'))[0];
      if(!operation||operation.status!=='outcome_unknown')throw new ConflictException('Native unknown operation required');
      const step=(await tx.select().from(executionSteps).where(eq(executionSteps.id,operation.executionStepId)))[0];
      const invocation=step?.actionIntentId&&(await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.actionIntentId,step.actionIntentId))))[0];
      const original=invocation&&(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,invocation.id),eq(deviceTasks.userId,userId))))[0];
      if(!operation||operation.status!=='outcome_unknown'||!original||!['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(original.taskType))throw new ConflictException('Native reconciliation binding unavailable');
      await this.assertTask(tx,userId,original,'RECONCILE');
      const prior=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,caseId)))[0];
      if(prior)return;
      const now=new Date();
      await tx.insert(deviceTasks).values({id:caseId,userId,trustedDeviceId:original.trustedDeviceId,deviceId:original.deviceId,taskType:original.taskType,
        factKey:original.factKey,resourceType:original.resourceType,payloadJson:{...original.payloadJson,lookupOnly:true,reconciliationCaseId:caseId},
        status:'PENDING',claimToken:null,claimedAt:null,leaseExpiresAt:null,resultJson:null,resultHash:null,errorCode:null,createdAt:now,updatedAt:now,completedAt:null});
      await tx.insert(invocationRuntimeLinks).values({id:newId(),invocationId:String(original.payloadJson.invocationId),runtimeKind:'DEVICE_TASK',runtimeRef:caseId,createdAt:now});
    });
  }

  /** Device signature authenticates the collector; server independently compares read-back fields. */
  async complete(tx:Tx,userId:string,task:typeof deviceTasks.$inferSelect,result:Record<string,unknown>,proofRequestId:string) {
    const row=await this.assertTask(tx,userId,task,'RECONCILE');
    const operation=(await tx.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.id,String(task.payloadJson.operationId)),eq(sideEffectOperations.userId,userId))).for('update'))[0];
    if(!operation||operation.executionId!==row.executionId||operation.executionStepId!==task.payloadJson.executionStepId)throw new ConflictException('Native operation binding mismatch');
    const config=row.arguments.actionConfig as Record<string,unknown>;
    const desired=row.capabilityId==='calendar.event.create'?prepareAndroidCalendarCreate(config.calendarEvent):row.capabilityId==='calendar.event.update'?prepareAndroidCalendarUpdate(config.calendarMutation):prepareAndroidCalendarDelete(config.calendarMutation);
    const operationId=sha(`${userId}:${row.targetId}:${row.idempotencyKey}`);
    const evidence=result.evidence as Record<string,unknown>|undefined;
    const {resultHash,...bytes}=result;
    if(result.invocationId!==row.id||result.targetId!==row.targetId||result.authorityEpoch!==row.authorityEpoch||result.operationId!==operationId||resultHash!==sha(canonicalStringify(bytes)))throw new ConflictException('Native write receipt identity/hash mismatch');
    const deleting=row.capabilityId==='calendar.event.delete';
    const identityMatched=result.state==='SUCCEEDED'&&!!evidence&&typeof result.deviceOperationId==='string'&&/^[1-9][0-9]*$/.test(result.deviceOperationId)
      &&evidence.eventId===result.deviceOperationId&&evidence.calendarId===desired.calendarId;
    const matched=identityMatched && (deleting
      ? 'expectedOperationMarker' in desired && evidence!.eventId===desired.eventId && evidence!.expectedOperationMarker===desired.expectedOperationMarker && evidence!.absent===true && evidence!.observedBeforeMutation===true
      : 'title' in desired && evidence!.title===desired.title && evidence!.startAt===Date.parse(desired.start.dateTime)&&evidence!.endAt===Date.parse(desired.end.dateTime)
        &&evidence!.timeZone===desired.start.timeZone&&evidence!.endTimeZone===desired.end.timeZone
        &&evidence!.operationMarker===`lazyarmor-operation:${operationId}`&&evidence!.deleted===0&&evidence!.allDay===0
        &&(!('eventId' in desired)||evidence!.eventId===desired.eventId));
    const data={...result,verificationEvidence:{matched},deviceProofRef:`signed-request:${proofRequestId}`};
    const caseId=task.payloadJson.lookupOnly===true?String(task.payloadJson.reconciliationCaseId):null;
    if(caseId){
      const check=(await tx.select().from(reconciliationCases).where(and(eq(reconciliationCases.id,caseId),eq(reconciliationCases.userId,userId))).for('update'))[0];
      if(!check||check.operationId!==operation.id||operation.status!=='outcome_unknown')throw new ConflictException('Native read-only reconciliation changed');
    }
    const state=await this.verification.record(operation,deleting?ANDROID_CALENDAR_DELETE_POLICY:row.capabilityId==='calendar.event.update'?ANDROID_CALENDAR_UPDATE_POLICY:ANDROID_CALENDAR_WRITE_POLICY,'OPERATION_LOOKUP',data,`native:${sha(task.id+':'+String(resultHash))}`,tx,caseId);
    const now=new Date();
    // Publish actual read-back facts through the existing Evidence/Candidate/Truth
    // pipeline in the receipt transaction. Neither transport ACK nor API success
    // authorizes a fact; only the independently verified signed device evidence does.
    if(state==='SUCCEEDED') {
      const pipeline=this.modules.get(RealityPipelineService,{strict:false});
      const observation=await pipeline.ingest(userId,{
        sourceMode:'NATIVE_OS',providerKey:'android_calendar',connectionId:null,deviceId:task.deviceId,
        externalEventKey:`calendar-write:${row.id}`,parserKey:deleting?'native.calendar-event-absence.v1':'native.calendar-event.v1',resourceHint:'CalendarEvent',
        payload:deleting?{id:String(evidence!.eventId),calendarId:String(evidence!.calendarId),present:false,invocationId:row.id,targetId:row.targetId,deviceProofRef:`signed-request:${proofRequestId}`}:{id:String(evidence!.eventId),calendarId:String(evidence!.calendarId),title:String(evidence!.title),startAt:Number(evidence!.startAt),endAt:Number(evidence!.endAt),status:'SCHEDULED',allDay:false,invocationId:row.id,targetId:row.targetId,deviceProofRef:`signed-request:${proofRequestId}`},
        evidenceHash:String(resultHash),observedAt:now.toISOString(),
      },0,tx);
      const truthRefs:string[]=[];
      for(const candidate of observation.candidates) {
        const truth=await pipeline.confirmCandidate(userId,candidate.id,{verifiedBy:'device_evidence',verificationMethod:'DEVICE_READ_BACK'},0,tx);
        truthRefs.push(`truth:${truth.id}`);
      }
      Object.assign(data,{observationId:observation.observationId,truthRefs});
      if (!row.planId) await tx.update(deviceTasks).set({payloadJson:{...task.payloadJson,verifiedTruthRefs:truthRefs}}).where(eq(deviceTasks.id,task.id));
    }
    if(caseId){
      await tx.update(reconciliationCases).set({status:state==='SUCCEEDED'?'RESOLVED':'NEEDS_USER',resultState:state,resolvedAt:state==='SUCCEEDED'?now:null,leaseToken:null,leaseUntil:null,updatedAt:now}).where(eq(reconciliationCases.id,caseId));
      await tx.update(deviceTasks).set({status:state==='SUCCEEDED'?'SUCCEEDED':'FAILED',resultJson:result,resultHash:catalogHash(result),completedAt:now,updatedAt:now,errorCode:state==='SUCCEEDED'?null:'OUTCOME_UNKNOWN'}).where(eq(deviceTasks.id,task.id));
      return {executionId:operation.executionId,unknown:true};
    }
    await this.operations.mark(operation.id,{status:state==='SUCCEEDED'?'succeeded':'outcome_unknown',providerOperationId:typeof result.deviceOperationId==='string'?result.deviceOperationId:null,
      resultSnapshotJson:data,resultHash:this.operations.hashResult(data),finishedAt:now,errorCode:state==='SUCCEEDED'?null:'OUTCOME_UNKNOWN'},tx);
    if(state!=='SUCCEEDED')await this.verification.openUnknown(operation,'OUTCOME_UNKNOWN',tx);
    await this.steps.transition(operation.executionStepId,state==='SUCCEEDED'?'succeeded':'failed',{dispatchStatus:state==='SUCCEEDED'?'succeeded':'outcome_unknown',outputSnapshotJson:data,finishedAt:now,errorCode:state==='SUCCEEDED'?null:'OUTCOME_UNKNOWN'},tx);
    await tx.update(deviceTasks).set({status:state==='SUCCEEDED'?'SUCCEEDED':'FAILED',resultJson:result,resultHash:catalogHash(result),completedAt:now,updatedAt:now,errorCode:state==='SUCCEEDED'?null:'OUTCOME_UNKNOWN'}).where(eq(deviceTasks.id,task.id));
    await this.audit.append({actorType:'user',actorUserId:userId,userId,executionId:operation.executionId,executionStepId:operation.executionStepId,action:'NATIVE_WRITE_RECEIPT_VERIFIED',resourceType:'device_task',resourceId:task.id,source:'api',result:state==='SUCCEEDED'?'success':'unknown',after:{invocationId:row.id,operationId:operation.id,resultHash,verificationState:state,deviceProofRef:data.deviceProofRef}},tx);
    return {executionId:operation.executionId,unknown:state!=='SUCCEEDED'};
  }
  async resume(userId:string,executionId:string,unknown:boolean) {
    await this.modules.get(OutboxWorker,{strict:false}).resumeNativeExecution(userId,executionId,unknown);
    await this.modules.get(RuntimeSourceContinuationService,{strict:false}).consume(userId,executionId);
  }
  /** Repair the commit-to-finalization crash gap without ever re-dispatching a write. */
  async expireWrite(tx:Tx,task:typeof deviceTasks.$inferSelect) {
    const operation=(await tx.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.id,String(task.payloadJson.operationId)),eq(sideEffectOperations.userId,task.userId))).for('update'))[0];
    if(!operation||!['executing','retry_wait'].includes(operation.status))throw new ConflictException('Native expired operation binding unavailable');
    const now=new Date();
    // Lease expiry cannot prove whether CalendarProvider committed. This is a
    // server uncertainty decision, never a fabricated signed device receipt.
    await this.operations.mark(operation.id,{status:'outcome_unknown',errorCode:'OUTCOME_UNKNOWN',errorMessage:'Device lease expired after write dispatch; read-only reconciliation required',finishedAt:now},tx);
    await this.verification.openUnknown(operation,'NATIVE_WRITE_LEASE_EXPIRED',tx);
    await this.steps.transition(operation.executionStepId,'failed',{dispatchStatus:'outcome_unknown',errorCode:'OUTCOME_UNKNOWN',finishedAt:now},tx);
    await tx.update(deviceTasks).set({status:'FAILED',claimToken:null,leaseExpiresAt:null,errorCode:'OUTCOME_UNKNOWN',completedAt:now,updatedAt:now}).where(eq(deviceTasks.id,task.id));
    await this.audit.append({actorType:'system',actorUserId:null,userId:task.userId,executionId:operation.executionId,executionStepId:operation.executionStepId,action:'NATIVE_WRITE_LEASE_OUTCOME_UNKNOWN',resourceType:'device_task',resourceId:task.id,source:'outbox_worker',result:'unknown',reasonCode:'NATIVE_WRITE_LEASE_EXPIRED',after:{invocationId:task.payloadJson.invocationId,operationId:operation.id}},tx);
  }
  /** Conservatively recover tasks requeued by the earlier lease implementation. */
  async recoverLegacyExpiredWrites() {
    const rows=await this.db.select({task:deviceTasks}).from(deviceTasks)
      .innerJoin(sideEffectOperations,sql`${sideEffectOperations.id}=UUID_TO_BIN(JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.operationId')))`)
      .where(and(inArray(deviceTasks.taskType,['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE']),eq(deviceTasks.status,'PENDING'),eq(sideEffectOperations.status,'retry_wait'),eq(sideEffectOperations.errorCode,'LEASE_EXPIRED_RECOVERY'))).limit(32);
    for(const {task} of rows){
      if(task.payloadJson.lookupOnly===true)continue;
      await this.db.transaction(async tx=>{
        const current=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,task.id)).for('update'))[0];
        if(current?.status==='PENDING')await this.expireWrite(tx,current);
      });
    }
    return {recovered:rows.length};
  }
  async recoverCommittedResults() {
    const rows=await this.db.select({task:deviceTasks}).from(deviceTasks)
      .innerJoin(sideEffectOperations,sql`${sideEffectOperations.id}=UUID_TO_BIN(JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.operationId')))`)
      .innerJoin(executions,eq(executions.id,sideEffectOperations.executionId))
      .where(and(inArray(deviceTasks.taskType,['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE']),inArray(deviceTasks.status,['SUCCEEDED','FAILED']),
        notInArray(executions.status,['succeeded','failed','partially_succeeded','cancelled','expired']))).limit(32);
    for(const {task} of rows){
      if(task.payloadJson.lookupOnly===true)continue;
      const invocation=task.payloadJson.invocation as {executionId:string};
      await this.resume(task.userId,invocation.executionId,task.errorCode==='OUTCOME_UNKNOWN');
    }
    return {recovered:rows.length};
  }
  async failureReceipt(tx:Tx,userId:string,task:typeof deviceTasks.$inferSelect,reason:string) {
    const row=await this.assertTask(tx,userId,task,'RECONCILE');
    const result={invocationId:row.id,targetId:row.targetId,authorityEpoch:row.authorityEpoch,operationId:sha(`${userId}:${row.targetId}:${row.idempotencyKey}`),state:'OUTCOME_UNKNOWN',reason};
    return {...result,resultHash:sha(canonicalStringify(result))};
  }
}
