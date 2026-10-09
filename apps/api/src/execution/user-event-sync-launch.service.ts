import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { executions, truthRecords, truthRecordVersions, truthProvenance, recurringItemProfiles, capabilityInvocations, runtimeResults, userEventSyncRequests, consumerMessages, consumerConversations, verificationEvidence, runtimeTargets } from '@lazy-armor/database';
import { catalogHash, confirmedUserEventSyncContractSchema, userEventExternalLinkSchema, userEventInputSchema } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { RuntimeAuthorityService } from './runtime-authority.service';
import { AuditService } from '../audit/audit.service';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ExecutionDispatchService } from './execution-dispatch.service';

/** Legal confirmed intent -> existing dispatcher. Caller cannot supply a target or calendar ID. */
@Injectable()
export class UserEventSyncLaunchService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly dispatch: ExecutionDispatchService, private readonly authority:RuntimeAuthorityService, private readonly audit:AuditService) {}
  /** Server-derived change proposal. The client supplies only the internal version. */
  async proposeMutation(userId:string,userEventId:string,previousRequestId:string,version:number) {
    return this.db.transaction(async tx=>{
      const event=(await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id,userEventId),eq(recurringItemProfiles.userId,userId),eq(recurringItemProfiles.sourceType,'user_event'))).for('update'))[0];
      if(!event)throw new NotFoundException('内部事项不存在');
      const m=event.metadataJson;
      if(m?.schema!=='user-event.v1'||m.version!==version||!['active','cancelled'].includes(event.status))throw new ConflictException('SYNC_CHANGE_VERSION_OR_LIFECYCLE_INVALID');
      const previous=(await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id,previousRequestId),eq(userEventSyncRequests.userId,userId),eq(userEventSyncRequests.userEventId,userEventId))))[0];
      const link=userEventExternalLinkSchema.safeParse(previous?.resultProjectionJson?.link);
      if(!previous||!link.success||!link.data.externalResourceId||link.data.externalState==='ABSENT'||!link.data.lastVerificationRef||!link.data.targetId||!link.data.lastSyncedUserEventVersion||version<=link.data.lastSyncedUserEventVersion)throw new ConflictException('SYNC_CHANGE_VERIFIED_LINK_REQUIRED');
      const requests=await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.userId,userId),eq(userEventSyncRequests.userEventId,userEventId)));
      if(requests.some(r=>r.id!==previousRequestId&&!r.revokedAt&&(!r.resultProjectionJson||r.userEventVersion>previous.userEventVersion)))throw new ConflictException('SYNC_CHANGE_PREVIOUS_REQUEST_NOT_CURRENT_OR_IN_FLIGHT');
      const conversation=(await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id,String(m.conversationId)),eq(consumerConversations.userId,userId),isNull(consumerConversations.deletedAt))))[0];
      if(!conversation)throw new ConflictException('SYNC_CHANGE_CONVERSATION_UNAVAILABLE');
      const requestKey=`sync-change:${previousRequestId}:${version}`;
      const existing=(await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId,conversation.id),eq(consumerMessages.requestId,requestKey),eq(consumerMessages.role,'assistant'))))[0];
      if(existing)return {messageId:existing.id,version,operation:existing.structuredPayload?.operation,executionAuthorized:false};
      const proof=(await tx.select().from(verificationEvidence).where(and(eq(verificationEvidence.id,link.data.lastVerificationRef.slice(13)),eq(verificationEvidence.userId,userId),eq(verificationEvidence.resultState,'SUCCEEDED'))))[0];
      const evidence=proof?.evidenceJson.evidence as Record<string,unknown>|undefined;
      const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.id,link.data.targetId),eq(runtimeTargets.userId,userId))))[0];
      if(!target||target.targetType!=='ANDROID_DEVICE'||!evidence)throw new ConflictException('SYNC_CHANGE_REALITY_PROOF_UNAVAILABLE');
      const priorContract=confirmedUserEventSyncContractSchema.parse(previous.contractJson);
      const messageId=newId(),operation=event.status==='cancelled'?'DELETE':'UPDATE';
      const contract=confirmedUserEventSyncContractSchema.parse({schema:'user-event-sync-confirmation.v2',requestId:newId(),ownerId:userId,userEventId,userEventVersion:version,proposalMessageId:messageId,userEvent:userEventInputSchema.parse({title:event.title,dueAt:m.dueAt,reminderAt:m.reminderAt,timezone:m.timezone}),intent:priorContract.intent,operation,externalIdentity:{previousRequestId,targetId:target.id,trustedDeviceId:target.backingRef,calendarId:evidence.calendarId,externalEventId:link.data.externalResourceId,operationMarker:evidence.operationMarker,verificationRef:link.data.lastVerificationRef,syncedUserEventVersion:link.data.lastSyncedUserEventVersion}});
      await tx.insert(consumerMessages).values({id:messageId,conversationId:conversation.id,requestId:requestKey,role:'assistant',content:operation==='DELETE'?'建议删除已关联的手机日历事项；内部事项保持已取消。':'建议将当前事项内容更新到已关联的手机日历事项。',structuredPayload:{result:'USER_EVENT_SYNC_CHANGE_DRAFT',operation,contractCandidate:contract,executionAuthorized:false},contextRefs:[],createdAt:new Date()});
      return {messageId,version,operation,executionAuthorized:false};
    });
  }
  async confirmMutation(userId:string,userEventId:string,input:{version:number;messageId:string;confirmed:boolean}) {
    if(!input.confirmed)throw new ConflictException('SYNC_CHANGE_CONFIRMATION_REQUIRED');
    return this.db.transaction(async tx=>{
      const event=(await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id,userEventId),eq(recurringItemProfiles.userId,userId),eq(recurringItemProfiles.sourceType,'user_event'))).for('update'))[0];
      if(!event)throw new NotFoundException('内部事项不存在');
      const conversation=(await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id,String(event.metadataJson?.conversationId)),eq(consumerConversations.userId,userId),isNull(consumerConversations.deletedAt))))[0];
      if(!conversation)throw new ConflictException('SYNC_CHANGE_CONVERSATION_UNAVAILABLE');
      const message=(await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id,input.messageId),eq(consumerMessages.conversationId,String(event.metadataJson?.conversationId)),eq(consumerMessages.role,'assistant'))))[0];
      if(message?.structuredPayload?.result!=='USER_EVENT_SYNC_CHANGE_DRAFT')throw new ConflictException('SYNC_CHANGE_PROPOSAL_REQUIRED');
      const contract=confirmedUserEventSyncContractSchema.parse(message.structuredPayload.contractCandidate);
      if(contract.schema!=='user-event-sync-confirmation.v2'||contract.ownerId!==userId||contract.userEventId!==userEventId||contract.proposalMessageId!==message.id||contract.userEventVersion!==input.version)throw new ConflictException('SYNC_CHANGE_PROPOSAL_BINDING_MISMATCH');
      const hash=catalogHash(contract);
      const previous=(await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id,contract.requestId),eq(userEventSyncRequests.userId,userId))))[0];
      if(previous) {
        if(previous.contractHash!==hash)throw new ConflictException('SYNC_CHANGE_REPLAY_CONFLICT');
        return {requestId:previous.id,confirmedVersion:previous.userEventVersion,executionAuthorized:false};
      }
      const competing=await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.userId,userId),eq(userEventSyncRequests.userEventId,userEventId),isNull(userEventSyncRequests.revokedAt)));
      if(competing.some(r=>r.id!==contract.externalIdentity.previousRequestId&&(!r.resultProjectionJson||r.userEventVersion>=contract.userEventVersion)))throw new ConflictException('SYNC_CHANGE_SUPERSEDED_OR_IN_FLIGHT');
      await tx.insert(userEventSyncRequests).values({id:contract.requestId,userId,userEventId,userEventVersion:contract.userEventVersion,proposalMessageId:message.id,contractHash:hash,contractJson:contract as unknown as Record<string,unknown>,confirmedAt:new Date(),revokedAt:null});
      const source={kind:'USER_EVENT_SYNC' as const,ownerId:userId,requestId:contract.requestId,userEventId,userEventVersion:contract.userEventVersion,contractHash:hash};
      await this.authority.assertCurrent(tx,source,{userId,planId:null,planVersionId:null});
      await this.audit.append({actorType:'user',actorUserId:userId,userId,action:'USER_EVENT_SYNC_CHANGE_CONFIRMED',resourceType:'user_event_sync_request',resourceId:contract.requestId,source:'api',result:'success',after:{operation:contract.operation,userEventVersion:contract.userEventVersion,contractHash:hash},changeSummary:'Confirmed exact external mutation; separate current risk/approval remains required'},tx);
      return {requestId:contract.requestId,confirmedVersion:contract.userEventVersion,executionAuthorized:false};
    });
  }
  async start(userId: string, userEventId: string, requestId: string) {
    const request=(await this.db.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id,requestId),eq(userEventSyncRequests.userId,userId),eq(userEventSyncRequests.userEventId,userEventId))))[0];
    if (!request) throw new NotFoundException('Confirmed sync request not found');
    const prior=(await this.db.select().from(executions).where(and(eq(executions.userId,userId),eq(executions.requestId,`user-event-sync:${requestId}`))))[0];
    if (prior) return {requestId,executionId:prior.id,status:prior.status};
    const contract=confirmedUserEventSyncContractSchema.parse(request.contractJson);
    if (catalogHash(contract)!==request.contractHash) throw new ConflictException('SYNC_CONFIRMATION_INTEGRITY_ERROR');
    if(contract.schema==='user-event-sync-confirmation.v2') {
      const execution=await this.dispatch.dispatchUserEventSync(userId,requestId,contract.externalIdentity.calendarId,contract.externalIdentity.trustedDeviceId);
      return {requestId,executionId:execution.id,status:execution.status};
    }
    if (!contract.sourceTruthRefs?.length) return {requestId,executionId:null,status:'WAITING_RESOURCE',reason:'需要读取手机日历并确认来源身份'};
    const scopes=new Map<string,{deviceId:string;calendarId:string}>();
    for (const ref of contract.sourceTruthRefs) {
      const rows=await this.db.select({record:truthRecords,version:truthRecordVersions}).from(truthRecords)
        .innerJoin(truthRecordVersions,eq(truthRecordVersions.truthRecordId,truthRecords.id))
        .where(and(eq(truthRecords.id,ref.truthId),eq(truthRecords.userId,userId),eq(truthRecordVersions.id,ref.versionId)));
      const row=rows[0];
      if (!row || row.record.status !== 'verified' || row.record.revokedAt || row.version.valueHash!==ref.valueHash || catalogHash(row.version.valueJson)!==ref.valueHash) throw new ConflictException('SYNC_CONFIRMED_SOURCE_CHANGED');
      const match=/^local:([0-9a-f-]{36}):calendar:([1-9][0-9]*):/i.exec(row.record.subjectKey);
      if (!match) continue;
      const provenance=(await this.db.select().from(truthProvenance).where(and(eq(truthProvenance.truthRecordVersionId,ref.versionId),eq(truthProvenance.sourceMode,'NATIVE_OS'))))[0];
      if (!provenance || Date.now()-provenance.observedAt.getTime()>300000 || provenance.observedAt.getTime()>Date.now()+5000) return {requestId,executionId:null,status:'WAITING_RESOURCE',reason:'确认引用的手机日历读取证据已过期，需要重新读取并确认'};
      scopes.set(match[1]+':'+match[2],{deviceId:match[1],calendarId:match[2]});
    }
    if (scopes.size!==1) return {requestId,executionId:null,status:'WAITING_RESOURCE',reason:'需要确认唯一手机和日历范围'};
    if (Date.parse(contract.userEvent.dueAt)<=Date.now()) return {requestId,executionId:null,status:'WAITING_RESOURCE',reason:'事项时间已过，需要重新确认时间'};
    const scope=[...scopes.values()][0];
    const execution=await this.dispatch.dispatchUserEventSync(userId,requestId,scope.calendarId,scope.deviceId);
    return {requestId,executionId:execution.id,status:execution.status};
  }
  /** Read-only product projection; historical execution/Ledger and link versions stay immutable. */
  async summaries(userId: string, userEventId: string) {
    const event=(await this.db.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id,userEventId),eq(recurringItemProfiles.userId,userId),eq(recurringItemProfiles.sourceType,'user_event'))))[0];
    if (!event) throw new NotFoundException('内部事项不存在');
    const currentVersion=Number(event.metadataJson?.version);
    if (event.metadataJson?.schema!=='user-event.v1' || !Number.isInteger(currentVersion) || currentVersion<1) throw new ConflictException('USER_EVENT_VERSION_INVALID');
    const requests=await this.db.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.userId,userId),eq(userEventSyncRequests.userEventId,userEventId))).orderBy(desc(userEventSyncRequests.confirmedAt));
    const visible=requests.filter((r,index)=>index===0||!requests.slice(0,index).some(newer=>newer.resultProjectionJson?.link));
    return Promise.all(visible.map(async request=>{
      const projection=request.resultProjectionJson;
      const deleting=confirmedUserEventSyncContractSchema.parse(request.contractJson).schema==='user-event-sync-confirmation.v2' && request.contractJson.operation==='DELETE';
      const link=projection?.link ? userEventExternalLinkSchema.parse(projection.link) : null;
      if (link && (link.userId!==userId || link.userEventId!==userEventId || link.lastSyncedUserEventVersion!==request.userEventVersion)) throw new ConflictException('SYNC_LINK_IDENTITY_MISMATCH');
      const run=(await this.db.select().from(executions).where(and(eq(executions.userId,userId),eq(executions.requestId,`user-event-sync:${request.id}`))))[0];
      const result=run ? (await this.db.select({state:runtimeResults.verificationState}).from(runtimeResults).innerJoin(capabilityInvocations,eq(capabilityInvocations.id,runtimeResults.invocationId)).where(and(eq(capabilityInvocations.executionId,run.id),eq(runtimeResults.userId,userId))))[0] : null;
      let state='WAITING_RESOURCE',message='内部事项已创建；手机日历同步还在等待可用资源。';
      if (link?.externalResourceId) {
        state=link.externalState==='ABSENT'?'EXTERNAL_DELETED':event.status==='completed'?'INTERNAL_COMPLETED':event.status==='cancelled'?'CANCEL_PENDING':currentVersion!==link.lastSyncedUserEventVersion?'CHANGE_PENDING':'VERIFIED';
        message=state==='EXTERNAL_DELETED'?'手机日历事项已删除并回读确认不存在；内部事项保持已取消。':state==='INTERNAL_COMPLETED'?'内部事项已完成；手机日历保留上次已核对的内容，不会自动删除。':state==='CANCEL_PENDING'?'内部提醒已取消，手机日历事项仍保留；外部删除需另行确认，不会自动删除。':state==='CHANGE_PENDING'?'内部事项已更改，手机日历仍是上次确认的内容；外部更新需另行确认，不会自动更新。':'手机日历事项已同步并回读核对。';
      } else if (result?.state==='OUTCOME_UNKNOWN') {
        state='OUTCOME_UNKNOWN';message='手机日历结果待核对，系统只回查，不重复执行外部操作。';
      } else if ((event.status==='cancelled' && !deleting) || request.revokedAt) {
        state='CANCELLED';message='内部提醒已取消，尚未完成手机日历同步。';
      } else if (currentVersion!==request.userEventVersion) {
        state='CHANGE_PENDING';message='事项已更改，旧同步确认不再授权写入；需要重新确认当前内容。';
      } else if (run?.status==='waiting_approval') {
        state='WAITING_APPROVAL';message='等待你确认日历写入；确认事项草稿不等于批准外部执行。';
      } else if (run && ['created','queued','running','waiting_dispatch','retry_wait'].includes(run.status)) {
        state='RUNNING';message='正在同步到手机日历，完成后会重新读取核对。';
      } else if (run && ['failed','cancelled','expired'].includes(run.status)) {
        state='FAILED';message='手机日历同步未完成，内部事项和提醒仍保留。';
      }
      return {requestId:request.id,state,title:'手机日历同步',message,confirmedVersion:request.userEventVersion,currentVersion,syncedVersion:link?.lastSyncedUserEventVersion??null,syncedAt:link?.lastSyncedAt??null,externalEventId:link?.externalResourceId??null,changeProposal:request.id===requests[0]?.id&&link?.externalResourceId&&['CHANGE_PENDING','CANCEL_PENDING'].includes(state)?{kind:state==='CANCEL_PENDING'?'CANCEL_EXTERNAL':'UPDATE_EXTERNAL',version:currentVersion,requiresApproval:true,executionAuthorized:false,availability:'REQUIRES_RESOURCE_AND_APPROVAL'}:null};
    }));
  }
  async recover() {
    const rows=await this.db.select({request:userEventSyncRequests}).from(userEventSyncRequests)
      .leftJoin(executions,and(eq(executions.userId,userEventSyncRequests.userId),sql`${executions.requestId}=CONCAT('user-event-sync:',BIN_TO_UUID(${userEventSyncRequests.id}))`))
      .innerJoin(recurringItemProfiles,and(eq(recurringItemProfiles.id,userEventSyncRequests.userEventId),eq(recurringItemProfiles.userId,userEventSyncRequests.userId),eq(recurringItemProfiles.sourceType,'user_event')))
      .where(and(isNull(executions.id),isNull(userEventSyncRequests.revokedAt),sql`${recurringItemProfiles.status} IN ('active','cancelled')`,sql`(JSON_UNQUOTE(JSON_EXTRACT(${userEventSyncRequests.contractJson}, '$.schema')) = 'user-event-sync-confirmation.v2' OR (${recurringItemProfiles.status} = 'active' AND ${recurringItemProfiles.nextDueAt} > ${new Date()}))`,sql`JSON_EXTRACT(${recurringItemProfiles.metadataJson}, '$.version') = ${userEventSyncRequests.userEventVersion}`,sql`(JSON_UNQUOTE(JSON_EXTRACT(${userEventSyncRequests.contractJson}, '$.schema')) = 'user-event-sync-confirmation.v2' OR JSON_LENGTH(JSON_EXTRACT(${userEventSyncRequests.contractJson}, '$.sourceTruthRefs')) > 0)`)).orderBy(desc(userEventSyncRequests.confirmedAt)).limit(32);
    let launched=0;
    for(const {request} of rows) {
      try { if ((await this.start(request.userId,request.userEventId,request.id)).executionId) launched++; }
      catch { /* Superseded, revoked or unavailable sources cannot dispatch; internal items remain intact. */ }
    }
    return {launched};
  }
}
