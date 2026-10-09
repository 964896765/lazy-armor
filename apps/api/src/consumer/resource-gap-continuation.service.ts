import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { consumerConversations, consumerMessages, deviceTasks, deviceHeartbeats, localCapabilityStates, deviceAppConnections, mobileNotificationReceipts, truthRecords, truthRecordVersions, trustedDevices, runtimeTargets } from '@lazy-armor/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { newId } from '@lazy-armor/shared';
import { localCapabilityAvailability, realityValueHash } from '@lazy-armor/plan-schema';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { DeviceTasksService } from '../device-tasks/device-tasks.service';
import { AuditService } from '../audit/audit.service';
import { notificationFactQuerySchema, type NotificationFactQuery } from './notification-fact-query.contract';
import type { RealityExecutor } from '../reality-pipeline/reality-pipeline.service';
import { lockNotificationReceiptSource, type NotificationReceiptSourceProof } from '../strategy-runtime/notification-receipt-source.guard';

type Gap = {schema:'resource-gap-continuation.v1';ownerId:string;conversationVersion:number;userMessageId:string;goalHash:string;query:NotificationFactQuery;status:string;reasons:string[];attempt?:number;failedReadRefs?:string[];supersededReadRefs?:string[];taskId?:string;connectionId?:string;trustedDeviceId?:string;targetId?:string;authorityEpoch?:number;sourceVersion?:string;scopeStart?:number;scopeEnd?:number;nextAction?:{label:string;path:string}};
type SourceBinding = NonNullable<Awaited<ReturnType<FactDemandResolverService['resolveNotificationQuery']>>['selected']>;
type Task = typeof deviceTasks.$inferSelect;
type Receipt = typeof mobileNotificationReceipts.$inferSelect;
type PreparedTruth = {receiptId:string;truthId:string;versionId:string;valueHash:string;postedAt:string;value:Record<string,unknown>};
const MAX_READ_ATTEMPTS=3;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

/** Durable read continuation attached to its original Message authority.
 * No new scheduler, Plan, execution authority or client-supplied executable object.
 */
@Injectable()
export class ResourceGapContinuationService {
  constructor(@Inject(DATABASE) private readonly db:InjectedDatabase, @Inject(forwardRef(()=>FactDemandResolverService)) private readonly resolver:FactDemandResolverService, private readonly modules:ModuleRef, private readonly audit:AuditService) {}

  async register(userId:string,messageId:string) {
    await this.db.transaction(async tx=>{
      const candidate=(await tx.select().from(consumerMessages).where(eq(consumerMessages.id,messageId)))[0];
      if (!candidate?.structuredPayload?.factQuery || candidate.role!=='assistant') return;
      const conversation=(await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id,candidate.conversationId),eq(consumerConversations.userId,userId),isNull(consumerConversations.deletedAt))).for('update'))[0];
      const message=(await tx.select().from(consumerMessages).where(eq(consumerMessages.id,messageId)).for('update'))[0];
      if (!message?.structuredPayload?.factQuery || message.role!=='assistant') return;
      if(!conversation || conversation.mode!=='TEMPORARY' || conversation.archivedAt || message.structuredPayload.result!=='ANSWER') throw new ConflictException('FACT_QUERY_CONTEXT_INVALID');
      if(message.structuredPayload.resourceGap) return;
      const original=(await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId,conversation.id),eq(consumerMessages.requestId,message.requestId),eq(consumerMessages.role,'user'))))[0];
      if(!original) throw new ConflictException('FACT_QUERY_GOAL_REQUIRED');
      const query=notificationFactQuerySchema.parse(message.structuredPayload.factQuery);
      const gap:Gap={schema:'resource-gap-continuation.v1',ownerId:userId,conversationVersion:conversation.version,userMessageId:original.id,goalHash:sha(original.content),query,status:'WAITING_RESOURCE',reasons:[],nextAction:{label:'开启通知读取与来源',path:'/connections/notification-sources?returnTo='+encodeURIComponent('/chat?conversationId='+conversation.id)}};
      await tx.update(consumerMessages).set({structuredPayload:{...message.structuredPayload,resourceGap:gap},content:'需要可用的通知读取权限和你选择的应用来源。开启后会自动继续这条查询。'}).where(eq(consumerMessages.id,message.id));
      await this.audit.append({actorType:'system',userId,action:'RESOURCE_GAP_REGISTERED',resourceType:'consumer_message',resourceId:message.id,source:'api',result:'unknown',after:{goalRef:original.id,goalHash:gap.goalHash,query}},tx);
    });
  }

  async get(userId:string,messageId:string) {
    const row=(await this.db.select({message:consumerMessages,conversation:consumerConversations}).from(consumerMessages).innerJoin(consumerConversations,eq(consumerConversations.id,consumerMessages.conversationId)).where(and(eq(consumerMessages.id,messageId),eq(consumerConversations.userId,userId),isNull(consumerConversations.deletedAt))))[0];
    if(!row?.message.structuredPayload?.resourceGap) throw new NotFoundException('资源缺口不存在');
    return row;
  }

  private async current(userId:string,messageId:string,store:RealityExecutor=this.db,locked=false) {
    const messageQuery=store.select().from(consumerMessages).where(eq(consumerMessages.id,messageId));
    const message=(await (locked?messageQuery.for('update'):messageQuery))[0];
    const gap=message?.structuredPayload?.resourceGap as Gap|undefined;
    const conversationQuery=message&&store.select().from(consumerConversations).where(and(eq(consumerConversations.id,message.conversationId),eq(consumerConversations.userId,userId),isNull(consumerConversations.deletedAt)));
    const conversation=conversationQuery&&(await (locked?conversationQuery.for('update'):conversationQuery))[0];
    const originalQuery=gap&&store.select().from(consumerMessages).where(and(eq(consumerMessages.id,gap.userMessageId),eq(consumerMessages.conversationId,message.conversationId),eq(consumerMessages.role,'user')));
    const original=originalQuery&&(await (locked?originalQuery.for('update'):originalQuery))[0];
    if(!gap || gap.ownerId!==userId || !conversation || conversation.archivedAt || conversation.mode!=='TEMPORARY' || conversation.version!==gap.conversationVersion || !original || sha(original.content)!==gap.goalHash) throw new ConflictException('RESOURCE_GAP_SOURCE_SUPERSEDED');
    notificationFactQuerySchema.parse(gap.query);
    if(JSON.stringify(gap.query)!==JSON.stringify(message.structuredPayload?.factQuery))throw new ConflictException('RESOURCE_GAP_REQUIREMENT_CHANGED');
    return {message,gap,conversation,original};
  }

  /** Called inside the existing DeviceTask ownership transaction before claim/commit. */
  async assertTask(store:RealityExecutor,userId:string,task:typeof deviceTasks.$inferSelect) {
    const initial=await this.current(userId,String(task.payloadJson.resourceGapMessageId),store);
    await store.select().from(consumerConversations).where(eq(consumerConversations.id,initial.conversation.id)).for('update');
    const {gap}=await this.current(userId,String(task.payloadJson.resourceGapMessageId),store,true);
    if(!gap.connectionId || gap.taskId!==task.id || gap.trustedDeviceId!==task.trustedDeviceId || gap.connectionId!==task.payloadJson.sourceConnectionId || gap.query.sourcePackage!==task.payloadJson.sourcePackage || task.taskType!=='NATIVE_NOTIFICATION_READ' || task.factKey!=='shipment.status' || task.resourceType!=='shipment' || gap.scopeStart!==task.payloadJson.scopeStart || gap.scopeEnd!==task.payloadJson.scopeEnd) throw new ConflictException('RESOURCE_GAP_TASK_BINDING_MISMATCH');
    await this.assertSource(store,userId,gap);
  }

  /** The same current source gates apply to claim, receipt commit and publication.
   * Locks also prevent revocation from racing the final answer transaction. */
  private async assertSource(store:RealityExecutor,userId:string,gap:Gap) {
    if(!gap.trustedDeviceId || !gap.connectionId || !gap.targetId)throw new ConflictException('RESOURCE_GAP_TASK_BINDING_MISMATCH');
    const device=(await store.select().from(trustedDevices).where(and(eq(trustedDevices.id,gap.trustedDeviceId),eq(trustedDevices.userId,userId))).for('update'))[0];
    if(!device || device.status!=='active' || device.revokedAt)throw new ConflictException('RESOURCE_GAP_DEVICE_REVOKED');
    const app=(await store.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.id,gap.connectionId),eq(deviceAppConnections.userId,userId))).for('update'))[0];
    // Keep device -> grant -> target lock order consistent with manifest updates.
    const grant=(await store.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,gap.trustedDeviceId),eq(localCapabilityStates.capability,'notification.read'))).for('update'))[0];
    const target=(await store.select().from(runtimeTargets).where(and(eq(runtimeTargets.id,gap.targetId),eq(runtimeTargets.userId,userId))).for('update'))[0];
    if(!target || target.targetType!=='ANDROID_DEVICE' || target.backingRef!==gap.trustedDeviceId || target.authorityEpoch!==gap.authorityEpoch || app?.updatedAt.toISOString()!==gap.sourceVersion)throw new ConflictException('RESOURCE_GAP_STALE_SOURCE_AUTHORITY');
    const heartbeat=(await store.select().from(deviceHeartbeats).where(and(eq(deviceHeartbeats.userId,userId),eq(deviceHeartbeats.trustedDeviceId,gap.trustedDeviceId))).for('update'))[0];
    if(!app?.enabled || !app.launchable || app.trustedDeviceId!==gap.trustedDeviceId || app.deviceId!==device.deviceId || app.packageName!==gap.query.sourcePackage || !app.modesJson.includes('notification_read') || !app.lastSeenAt || Date.now()-app.lastSeenAt.getTime()>300_000 || !heartbeat || heartbeat.deviceId!==device.deviceId || heartbeat.onlineState!=='online' || Date.now()-heartbeat.lastHeartbeatAt.getTime()>30_000 || !grant || localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE') throw new ConflictException('RESOURCE_GAP_SOURCE_NOT_AVAILABLE');
  }

  private async update(userId:string,id:string,status:string,reasons:string[],extra:Partial<Gap>={},expectedTaskId?:string) {
    await this.db.transaction(async tx=>{
      const initial=await this.current(userId,id,tx);
      await tx.select().from(consumerConversations).where(eq(consumerConversations.id,initial.conversation.id)).for('update');
      await tx.select().from(consumerMessages).where(eq(consumerMessages.id,id)).for('update');
      const {message,gap}=await this.current(userId,id,tx,true);
      if(['COMPLETED','SUPERSEDED'].includes(gap.status) || (expectedTaskId && gap.taskId!==expectedTaskId)) return;
      if(extra.taskId && gap.taskId) return;
      if(extra.taskId)await this.assertSource(tx,userId,{...gap,...extra});
      await tx.update(consumerMessages).set({structuredPayload:{...message.structuredPayload,resourceGap:{...gap,...extra,status,reasons}}}).where(eq(consumerMessages.id,id));
    });
  }

  async resume(userId:string,id:string):Promise<void> {
    const {gap}=await this.current(userId,id);
    if(['COMPLETED','SUPERSEDED'].includes(gap.status))return;
    const resolution=await this.resolver.resolveNotificationQuery(userId,gap.query.sourcePackage);
    if(!resolution.selected){await this.update(userId,id,resolution.state,resolution.reasons);return;}
    // A source/version change invalidates even a successful, unpublished read.
    // Reserve a different read identity; never mutate the old terminal receipt.
    if(gap.taskId && !this.sameSource(gap,resolution.selected)){
      await this.releaseRead(userId,id,gap.taskId,'SOURCE_AUTHORITY_CHANGED');
      return;
    }
    // A failed read is terminal until an actual unavailable -> available transition.
    // Only this read-only collector can get another bounded attempt; preserve the
    // failed Task and audit history instead of rewriting its terminal state.
    if(gap.status==='READ_FAILED')return;
    if(!gap.taskId){
      // Task identity and the original requirement are fixed before enqueue, so
      // a crash/repeated wakeup repairs the same queue handoff.
      const scopeEnd=Date.now(),taskKey=this.readKey(id,gap),hash=sha(`${userId}:${resolution.selected.trustedDeviceId}:NATIVE_NOTIFICATION_READ:${taskKey}`);
      const taskId=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
      await this.update(userId,id,'READ_PENDING',[],{taskId,...resolution.selected,scopeStart:scopeEnd-gap.query.lookbackHours*3600000,scopeEnd});
      await this.audit.append({actorType:'outbox_worker',userId,action:'RESOURCE_GAP_RESOLVER_RECOMPUTED',resourceType:'consumer_message',resourceId:id,source:'api',result:'success',after:{resolution,taskId}});
      return this.resume(userId,id);
    }
    const existing=(await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.id,gap.taskId),eq(deviceTasks.userId,userId))))[0];
    // Existing historical Tasks keep their exact signed payload. New attempts
    // freeze provenance for a later candidate verification or re-observation.
    const sourceBinding={schema:'notification-source-binding.v1',deviceAppConnectionId:gap.connectionId,trustedDeviceId:gap.trustedDeviceId,targetId:gap.targetId,authorityEpoch:gap.authorityEpoch,sourceVersion:gap.sourceVersion,sourcePackage:gap.query.sourcePackage};
    const payload={resourceGapMessageId:id,sourceConnectionId:gap.connectionId,sourcePackage:gap.query.sourcePackage,scopeStart:gap.scopeStart,scopeEnd:gap.scopeEnd,...(!existing||existing.payloadJson.notificationSourceBinding?{notificationSourceBinding:sourceBinding}:{})};
    const task=await this.modules.get(DeviceTasksService,{strict:false}).enqueue(userId,gap.trustedDeviceId!,'NATIVE_NOTIFICATION_READ','shipment.status','shipment',payload,this.readKey(id,gap));
    const row=(await this.db.select().from(deviceTasks).where(eq(deviceTasks.id,task.id)))[0];
    if(row.status==='FAILED' && gap.status==='WAITING_RESOURCE' && !row.resultJson){
      await this.releaseRead(userId,id,row.id,'RESOURCE_BECAME_AVAILABLE');
      return;
    }
    if(row.status==='FAILED'){await this.update(userId,id,'READ_FAILED',[row.errorCode??'NOTIFICATION_READ_FAILED'],{},row.id);return;}
    if(row.status!=='SUCCEEDED')return;
    const items=Array.isArray(row.resultJson?.items)?row.resultJson.items as Record<string,unknown>[]:[];
    const shipmentItems=items.filter(i=>i.candidateKind==='shipment_candidate');
    const receipts=await this.db.select().from(mobileNotificationReceipts).where(and(eq(mobileNotificationReceipts.userId,userId),eq(mobileNotificationReceipts.deviceAppConnectionId,gap.connectionId!)));
    const matching=receipts.filter(r=>shipmentItems.some(i=>i.eventId===r.eventId));
    if(matching.length!==shipmentItems.length || matching.some(r=>!['verified','rejected_by_user'].includes(r.status))){await this.update(userId,id,'WAITING_FACT_CONFIRMATION',['NOTIFICATION_CANDIDATE_REQUIRES_CONFIRMATION'],{},row.id);return;}
    const facts:PreparedTruth[]=[];
    for(const receipt of matching.filter(r=>r.status==='verified')){
      const proof=(await this.db.select({truth:truthRecords,version:truthRecordVersions}).from(truthRecords).innerJoin(truthRecordVersions,eq(truthRecords.currentVersionId,truthRecordVersions.id)).where(and(eq(truthRecords.userId,userId),eq(truthRecords.sourceReceiptId,receipt.id),eq(truthRecords.status,'verified'),isNull(truthRecords.revokedAt))))[0];
      if(!proof || proof.version.truthRecordId!==proof.truth.id){await this.update(userId,id,'WAITING_FACT_CONFIRMATION',['VERIFIED_TRUTH_REQUIRED'],{},row.id);return;}
      facts.push({receiptId:receipt.id,truthId:proof.truth.id,versionId:proof.version.id,valueHash:proof.version.valueHash,postedAt:receipt.postedAt.toISOString(),value:proof.version.valueJson});
    }
    try{await this.publishResult(userId,id,row,matching,facts);}catch(error){
      if(!(error instanceof ConflictException))throw error;
      if(['RESOURCE_GAP_STALE_SOURCE_AUTHORITY','RESOURCE_GAP_SOURCE_NOT_AVAILABLE','RESOURCE_GAP_DEVICE_REVOKED','RESOURCE_GAP_TRUTH_CHANGED','RESOURCE_GAP_RECEIPT_CHANGED','RESOURCE_GAP_RECEIPT_SOURCE_UNVERIFIED'].includes(error.message)){
        await this.audit.append({actorType:'outbox_worker',userId,action:'RESOURCE_GAP_RESULT_PUBLICATION_FENCED',resourceType:'consumer_message',resourceId:id,source:'api',result:'blocked',reasonCode:error.message,after:{originalGoalRef:gap.userMessageId,taskId:row.id,sourceEpoch:gap.authorityEpoch,sourceVersion:gap.sourceVersion,preparedTruthVersionRefs:facts.map(f=>f.versionId)}});
      }
      if(['RESOURCE_GAP_STALE_SOURCE_AUTHORITY','RESOURCE_GAP_SOURCE_NOT_AVAILABLE','RESOURCE_GAP_DEVICE_REVOKED'].includes(error.message)){
        await this.update(userId,id,'WAITING_RESOURCE',[error.message],{},row.id);return;
      }
      if(['RESOURCE_GAP_TRUTH_CHANGED','RESOURCE_GAP_RECEIPT_CHANGED','RESOURCE_GAP_RECEIPT_SOURCE_UNVERIFIED'].includes(error.message)){
        await this.update(userId,id,'WAITING_FACT_CONFIRMATION',[error.message],{},row.id);return;
      }
      if(error.message==='RESOURCE_GAP_TASK_BINDING_MISMATCH')return; // A concurrent resolver already rebound the Goal.
      throw error;
    }
  }

  private sameSource(gap:Gap,source:SourceBinding) {
    return gap.connectionId===source.connectionId && gap.trustedDeviceId===source.trustedDeviceId && gap.targetId===source.targetId && gap.authorityEpoch===source.authorityEpoch && gap.sourceVersion===source.sourceVersion;
  }

  /** Only the read collector may be rebound. Original Goal/version and every
   * terminal Result remain immutable; an old live read is cancelled and fenced. */
  private async releaseRead(userId:string,id:string,taskId:string,reason:'SOURCE_AUTHORITY_CHANGED'|'RESOURCE_BECAME_AVAILABLE') {
    await this.db.transaction(async tx=>{
      // DeviceTask callbacks already lock task -> conversation. Use that order
      // here as well, so takeover and a late receipt cannot both own the Goal.
      const old=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.userId,userId))).for('update'))[0];
      const initial=await this.current(userId,id,tx);
      await tx.select().from(consumerConversations).where(eq(consumerConversations.id,initial.conversation.id)).for('update');
      await tx.select().from(consumerMessages).where(eq(consumerMessages.id,id)).for('update');
      const {message,gap}=await this.current(userId,id,tx,true);
      if(gap.taskId!==taskId || ['COMPLETED','SUPERSEDED'].includes(gap.status))return;
      if(old && (old.taskType!=='NATIVE_NOTIFICATION_READ'||old.payloadJson.resourceGapMessageId!==id))throw new ConflictException('RESOURCE_GAP_TASK_BINDING_MISMATCH');
      if(reason==='RESOURCE_BECAME_AVAILABLE' && (gap.status!=='WAITING_RESOURCE'||old?.status!=='FAILED'||old.resultJson))return;
      if((gap.attempt??1)>=MAX_READ_ATTEMPTS){
        await tx.update(consumerMessages).set({structuredPayload:{...message.structuredPayload,resourceGap:{...gap,status:'WAITING_RESOURCE',reasons:['READ_ATTEMPT_LIMIT_REACHED']}}}).where(eq(consumerMessages.id,id));
        return;
      }
      const next:Gap={...gap,attempt:(gap.attempt??1)+1,status:'WAITING_RESOURCE',reasons:[]};
      if(old?.status==='FAILED')next.failedReadRefs=[...(gap.failedReadRefs??[]),taskId];
      else next.supersededReadRefs=[...(gap.supersededReadRefs??[]),taskId];
      for(const key of ['taskId','connectionId','trustedDeviceId','targetId','authorityEpoch','sourceVersion','scopeStart','scopeEnd'] as const)delete next[key];
      if(old && ['PENDING','CLAIMED','RUNNING'].includes(old.status)){
        await tx.update(deviceTasks).set({status:'CANCELLED',errorCode:'RESOURCE_GAP_SOURCE_REBOUND',completedAt:new Date(),updatedAt:new Date()}).where(eq(deviceTasks.id,old.id));
      }
      await tx.update(consumerMessages).set({structuredPayload:{...message.structuredPayload,resourceGap:next}}).where(eq(consumerMessages.id,id));
      await this.audit.append({actorType:'outbox_worker',userId,action:reason==='SOURCE_AUTHORITY_CHANGED'?'RESOURCE_GAP_SOURCE_REBOUND':'RESOURCE_GAP_READ_RECOVERY_AUTHORIZED',resourceType:'consumer_message',resourceId:id,source:'api',result:'success',after:{originalGoalRef:gap.userMessageId,priorTaskRef:taskId,priorTaskStatus:old?.status??'NOT_ENQUEUED',priorBinding:{connectionId:gap.connectionId,trustedDeviceId:gap.trustedDeviceId,targetId:gap.targetId,authorityEpoch:gap.authorityEpoch,sourceVersion:gap.sourceVersion},nextAttempt:next.attempt,reason,readOnly:true}},tx);
    });
  }

  /** Preparing an answer does not authorize publication. Recheck the exact
   * committed Task, source gates and every consumed Truth version under locks. */
  private async publishResult(userId:string,id:string,preparedTask:Task,preparedReceipts:Receipt[],facts:PreparedTruth[]) {
    await this.db.transaction(async tx=>{
      const task=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,preparedTask.id),eq(deviceTasks.userId,userId))).for('update'))[0];
      const initial=await this.current(userId,id,tx);
      await tx.select().from(consumerConversations).where(eq(consumerConversations.id,initial.conversation.id)).for('update');
      await tx.select().from(consumerMessages).where(eq(consumerMessages.id,id)).for('update');
      const {message,gap,conversation}=await this.current(userId,id,tx,true);
      if(gap.status==='COMPLETED')return;
      if(!task || task.status!=='SUCCEEDED' || !task.resultJson || task.resultHash!==preparedTask.resultHash || realityValueHash(task.resultJson)!==task.resultHash)throw new ConflictException('RESOURCE_GAP_COMMITTED_READ_REQUIRED');
      await this.assertTask(tx,userId,task);
      const receiptSourceProofs:Array<{receiptId:string;sourceProof:NotificationReceiptSourceProof}>=[];
      for(const prepared of preparedReceipts){
        const receipt=(await tx.select().from(mobileNotificationReceipts).where(and(eq(mobileNotificationReceipts.id,prepared.id),eq(mobileNotificationReceipts.userId,userId),eq(mobileNotificationReceipts.deviceAppConnectionId,gap.connectionId!))).for('update'))[0];
        if(!receipt || receipt.status!==prepared.status || receipt.payloadHash!==prepared.payloadHash || receipt.sourcePackage!==gap.query.sourcePackage || receipt.postedAt.getTime()!==prepared.postedAt.getTime() || realityValueHash(receipt.snapshotJson)!==realityValueHash(prepared.snapshotJson))throw new ConflictException('RESOURCE_GAP_RECEIPT_CHANGED');
        try{
          const sourceProof=await lockNotificationReceiptSource(tx,userId,receipt,{taskId:task.id,resultHash:task.resultHash!});
          receiptSourceProofs.push({receiptId:receipt.id,sourceProof});
        }catch(error){
          if(!(error instanceof ForbiddenException))throw error;
          const response=error.getResponse(),code=typeof response==='object'&&'code' in response?String(response.code):'';
          throw new ConflictException(code==='NOTIFICATION_RECEIPT_SOURCE_BINDING_REQUIRED'?'RESOURCE_GAP_RECEIPT_SOURCE_UNVERIFIED':code==='NOTIFICATION_SOURCE_AUTHORITY_CHANGED'?'RESOURCE_GAP_STALE_SOURCE_AUTHORITY':'RESOURCE_GAP_SOURCE_NOT_AVAILABLE');
        }
      }
      for(const fact of facts){
        const truth=(await tx.select().from(truthRecords).where(and(eq(truthRecords.id,fact.truthId),eq(truthRecords.userId,userId))).for('update'))[0];
        const version=(await tx.select().from(truthRecordVersions).where(and(eq(truthRecordVersions.id,fact.versionId),eq(truthRecordVersions.truthRecordId,fact.truthId))).for('update'))[0];
        if(!truth || truth.status!=='verified' || truth.revokedAt || truth.sourceReceiptId!==fact.receiptId || truth.currentVersionId!==fact.versionId || !version || version.valueHash!==fact.valueHash || realityValueHash(version.valueJson)!==fact.valueHash || realityValueHash(fact.value)!==fact.valueHash)throw new ConflictException('RESOURCE_GAP_TRUTH_CHANGED');
      }
      const label:Record<string,string>={IN_TRANSIT:'运输或派送中',DELIVERED:'通知提示已送达或签收',EXCEPTION:'物流异常，需要核对',READY_FOR_PICKUP:'待取件，需要处理'};
      const lines=facts.map(f=>{const value=(f.value.value??f.value) as Record<string,unknown>;return `${f.postedAt}：${label[String(value.status)]??'已核实的物流通知'}`;});
      const summary=facts.length?`在你授权的应用通知中核实了 ${facts.length} 条物流线索：\n${lines.join('\n')}\n这些是通知中的状态，不代表物流平台当前完整状态。`:'当前授权应用的通知读取范围内，没有已核实的物流线索。这不能证明没有快递。';
      const key='resource-gap:'+id;
      const prior=(await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId,conversation.id),eq(consumerMessages.requestId,key),eq(consumerMessages.role,'assistant'))))[0];
      if(!prior)await tx.insert(consumerMessages).values({id:newId(),conversationId:conversation.id,requestId:key,role:'assistant',content:summary,structuredPayload:{result:'ANSWER',resourceGapRef:id,sourceTaskRef:task.id,truthRefs:facts.map(f=>'truth:'+f.truthId),truthVersions:facts,receiptSourceProofs,sourceBinding:{connectionId:gap.connectionId,trustedDeviceId:gap.trustedDeviceId,targetId:gap.targetId,authorityEpoch:gap.authorityEpoch,sourceVersion:gap.sourceVersion,attempt:gap.attempt??1},readScope:{sourcePackage:gap.query.sourcePackage,start:gap.scopeStart,end:gap.scopeEnd},evidenceState:task.resultJson.state,emptyResultScope:'AUTHORIZED_NOTIFICATION_SOURCE_ONLY'},contextRefs:[{type:'ConversationMessage',id:gap.userMessageId}],createdAt:new Date()});
      await tx.update(consumerMessages).set({structuredPayload:{...message.structuredPayload,resourceGap:{...gap,status:'COMPLETED',reasons:[]}}}).where(eq(consumerMessages.id,id));
      await this.audit.append({actorType:'outbox_worker',userId,action:'RESOURCE_GAP_CONTINUED',resourceType:'consumer_message',resourceId:id,source:'api',result:'success',after:{originalGoalRef:gap.userMessageId,taskId:task.id,truthRefs:facts.map(f=>f.truthId),truthVersionRefs:facts.map(f=>f.versionId),sourceEpoch:gap.authorityEpoch,sourceVersion:gap.sourceVersion,empty:!facts.length}},tx);
    });
  }

  async recover() {
    const rows=await this.db.select({id:consumerMessages.id,userId:consumerConversations.userId}).from(consumerMessages).innerJoin(consumerConversations,eq(consumerConversations.id,consumerMessages.conversationId)).where(and(isNull(consumerConversations.deletedAt),isNull(consumerConversations.archivedAt),sql`JSON_UNQUOTE(JSON_EXTRACT(${consumerMessages.structuredPayload}, '$.resourceGap.status')) IN ('WAITING_RESOURCE','NEEDS_SOURCE_SELECTION','READ_PENDING','WAITING_FACT_CONFIRMATION','READ_FAILED')`)).limit(32);
    for(const row of rows){try{await this.resume(row.userId,row.id);}catch(error){if(error instanceof ConflictException && error.message==='RESOURCE_GAP_SOURCE_SUPERSEDED'){
      await this.db.transaction(async tx=>{
        const candidate=(await tx.select().from(consumerMessages).where(eq(consumerMessages.id,row.id)))[0];
        if(!candidate)return;
        await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id,candidate.conversationId),eq(consumerConversations.userId,row.userId))).for('update');
        const message=(await tx.select().from(consumerMessages).where(eq(consumerMessages.id,row.id)).for('update'))[0];
        const latest=message?.structuredPayload?.resourceGap as Gap|undefined;
        if(!latest || latest.ownerId!==row.userId || latest.status==='COMPLETED')return;
        await tx.update(consumerMessages).set({structuredPayload:{...message.structuredPayload,resourceGap:{...latest,status:'SUPERSEDED',reasons:['ORIGINAL_GOAL_CHANGED']}}}).where(eq(consumerMessages.id,row.id));
      });
    }else if(error instanceof ConflictException && ['RESOURCE_GAP_STALE_SOURCE_AUTHORITY','RESOURCE_GAP_SOURCE_NOT_AVAILABLE','RESOURCE_GAP_DEVICE_REVOKED'].includes(error.message)){
      await this.update(row.userId,row.id,'WAITING_RESOURCE',[error.message]);
    }else throw error;}}
    return {evaluated:rows.length};
  }

  private readKey(id:string,gap:Gap){return 'resource-gap:'+id+((gap.attempt??1)>1?':attempt:'+gap.attempt:'');}
}
