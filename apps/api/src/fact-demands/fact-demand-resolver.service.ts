import {LocalAcquisitionService} from '../consumer/local-acquisition.service';
import { ModuleRef } from '@nestjs/core';
import { RuntimeTargetsService } from '../runtime-targets/runtime-targets.service';
import { GoogleCalendarService } from '../providers/calendar/calendar.service';
import { AuditService } from '../audit/audit.service';
import { acquisitionRounds } from '@lazy-armor/database';
import { catalogHash,verificationPolicyHash,type VerificationPolicy } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import {DeviceTasksService} from '../device-tasks/device-tasks.service';
import type {AcquireFactDemandsDto} from './dto';
import {localCapabilityAvailability,LOCAL_RUNTIME_CAPABILITY_MAP,localCapabilitySourceId,normalizeLocalSourceId} from '@lazy-armor/plan-schema';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  deviceAppConnections,localCapabilityStates,deviceTasks,capabilityInvocations,invocationRuntimeLinks,runtimeResults,runtimeTargets,planCreationContracts,mobileNotificationReceipts,
  deviceConsumables,
  deviceHeartbeats,
  trustedDevices,
  appReadSessionEvents,appReadSessions,sourceObservations,
  truthProvenance,
  truthRecords,
  truthRecordVersions,
  reconciliationCases,sideEffectOperations,verificationEvidence,candidateFacts,
} from '@lazy-armor/database';
import {
  evaluateTruthRules,type TruthRule,assessState,nextBestAction,type AcquisitionCoverage,
  scheduledCalendarAuthoringSchema,prepareAndroidCalendarCreate,realityValueHash,
  notificationWatchAuthoringSchema,
  buildFactDemandProjections,
  factDemandRequestForScenario,
  type FactTruthEvidence,
  type RealityLevel,
  type SourceCandidateEvidence,
} from '@lazy-armor/plan-schema';
import { deviceAppCatalogMetadata } from '@lazy-armor/shared';
import { and, eq, isNull, sql, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import type { ResolveFactDemandsDto } from './dto';
import type { RealityExecutor } from '../reality-pipeline/reality-pipeline.service';

/** Internal continuation reference, resolved against committed Reality authority.
 * Neither callers nor executors can supply Truth values or pronounce verification. */
type AcquisitionHandoff = {
  taskId: string; invocationId: string; acquisitionResultId: string; resultHash: string;
  acquisitionId: string; planVersionId: string; sourceId: string; observedAt: Date;
  contentHash: string; scopeStart: Date; scopeEnd: Date;
};

@Injectable()
export class FactDemandResolverService {
  /** Read-only native source recomputation, independent of a persistent Plan. */
  async resolveNotificationQuery(userId: string, sourcePackage: string) {
    await this.moduleRef.get(RuntimeTargetsService,{strict:false}).refresh(userId);
    const apps = await this.db.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.userId,userId),eq(deviceAppConnections.packageName,sourcePackage)));
    const reasons = new Set<string>();
    const usable: Array<{connectionId:string;trustedDeviceId:string;sourcePackage:string;targetId:string;authorityEpoch:number;sourceVersion:string}> = [];
    if (!apps.length) reasons.add('APP_SOURCE_REQUIRED');
    for (const app of apps) {
      if (!app.enabled || !app.launchable || !app.modesJson.includes('notification_read')) { reasons.add('APP_SOURCE_GRANT_REQUIRED'); continue; }
      const device = app.trustedDeviceId && (await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id,app.trustedDeviceId),eq(trustedDevices.userId,userId))))[0];
      if (!device || device.status !== 'active' || device.revokedAt) { reasons.add('TRUSTED_DEVICE_REQUIRED'); continue; }
      const grant = (await this.db.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,device.id),eq(localCapabilityStates.capability,'notification.read'))))[0];
      if (!grant?.userGrant) { reasons.add('NOTIFICATION_GRANT_REQUIRED'); continue; }
      if (grant.systemPermission !== 'GRANTED') { reasons.add('NOTIFICATION_ACCESS_REQUIRED'); continue; }
      if (grant.health === 'UNAVAILABLE') { reasons.add('NOTIFICATION_COLLECTION_UNAVAILABLE'); continue; }
      if (localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE') { reasons.add('FRESH_CAPABILITY_EVIDENCE_REQUIRED'); continue; }
      const heartbeat = (await this.db.select().from(deviceHeartbeats).where(and(eq(deviceHeartbeats.userId,userId),eq(deviceHeartbeats.trustedDeviceId,device.id))))[0];
      if (!heartbeat || heartbeat.onlineState!=='online'||heartbeat.deviceId!==device.deviceId||Date.now()-heartbeat.lastHeartbeatAt.getTime()>30_000) { reasons.add('WAITING_DEVICE'); continue; }
      if (!app.lastSeenAt || Date.now()-app.lastSeenAt.getTime()>300_000) { reasons.add('FRESH_APP_DISCOVERY_REQUIRED'); continue; }
      const target=(await this.db.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),eq(runtimeTargets.targetType,'ANDROID_DEVICE'),eq(runtimeTargets.backingRef,device.id))))[0];
      if(!target){reasons.add('RUNTIME_TARGET_REQUIRED');continue;}
      usable.push({connectionId:app.id,trustedDeviceId:device.id,sourcePackage,targetId:target.id,authorityEpoch:target.authorityEpoch,sourceVersion:app.updatedAt.toISOString()});
    }
    if (usable.length>1) return {state:'NEEDS_SOURCE_SELECTION',reasons:['AMBIGUOUS_NOTIFICATION_DEVICE'],selected:null};
    return {state:usable.length?'RESOLVED':'WAITING_RESOURCE',reasons:usable.length?[]:[...reasons],selected:usable[0]??null};
  }
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly readiness: ReadinessEvidenceService,
    private readonly deviceTasks:DeviceTasksService,
    private readonly acquisition:LocalAcquisitionService,
    private readonly moduleRef:ModuleRef,
    private readonly audit:AuditService,
  ) {}

  /** Reassess the Recipe's output goal from committed read-back Truth, not from
   * executor success. This is completion evidence, never replacement input for
   * the frozen acquisition FactDemand. The next run must acquire its own facts. */
  async reassessCalendarCompletion(userId:string,planVersionId:string,executionId:string,nextRunAt:string|null,store:RealityExecutor=this.db,reconciliationCaseId?:string) {
    const contract=(await store.select().from(planCreationContracts).where(and(eq(planCreationContracts.userId,userId),eq(planCreationContracts.planVersionId,planVersionId))).limit(1))[0];
    const goal=contract?.goalJson as {intent?:string;constraints?:{recipeKey?:string;calendarAuthoringJson?:string}}|undefined;
    if(goal?.intent!=='CREATE_SCHEDULED_CALENDAR_EVENT'||goal.constraints?.recipeKey!=='calendar.scheduled-create.v1')return null;
    const parameters=scheduledCalendarAuthoringSchema.parse(JSON.parse(goal.constraints.calendarAuthoringJson!));
    const expected=prepareAndroidCalendarCreate(parameters.calendarEvent);
    const rows=await store.select({invocation:capabilityInvocations,result:runtimeResults}).from(capabilityInvocations)
      .innerJoin(runtimeResults,and(eq(runtimeResults.invocationId,capabilityInvocations.id),eq(runtimeResults.userId,userId)))
      .where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.planVersionId,planVersionId),eq(capabilityInvocations.executionId,executionId),eq(capabilityInvocations.capabilityId,'calendar.event.create')));
    if(rows.length!==1)throw new ConflictException('POST_WRITE_RESULT_NOT_VERIFIED');
    const {invocation,result}=rows[0]!;
    const resultContent={invocationId:result.invocationId,targetId:result.targetId,authorityEpoch:result.authorityEpoch,payloadRef:result.payloadRef,evidenceRefs:result.evidenceRefs,executionState:result.executionState};
    const actual=prepareAndroidCalendarCreate((invocation.arguments.actionConfig as Record<string,unknown>).calendarEvent);
    if(catalogHash(resultContent)!==result.resultHash||catalogHash(actual)!==catalogHash(expected))throw new ConflictException('POST_WRITE_RESULT_NOT_VERIFIED');
    let task=(await store.select().from(deviceTasks).where(and(eq(deviceTasks.id,reconciliationCaseId??invocation.id),eq(deviceTasks.userId,userId))).limit(1))[0];
    let truthIds=result.evidenceRefs.filter(ref=>ref.startsWith('truth:')).map(ref=>ref.slice(6));
    if(reconciliationCaseId){
      const resolved=(await store.select({case:reconciliationCases,operation:sideEffectOperations}).from(reconciliationCases)
        .innerJoin(sideEffectOperations,eq(sideEffectOperations.id,reconciliationCases.operationId))
        .where(and(eq(reconciliationCases.id,reconciliationCaseId),eq(reconciliationCases.userId,userId),eq(reconciliationCases.executionId,executionId),eq(reconciliationCases.status,'RESOLVED'),eq(reconciliationCases.resultState,'SUCCEEDED'))).limit(1))[0];
      const proof=(await store.select().from(verificationEvidence).where(and(eq(verificationEvidence.caseId,reconciliationCaseId),eq(verificationEvidence.userId,userId),eq(verificationEvidence.resultState,'SUCCEEDED'))).limit(1))[0];
      if(!resolved||!proof||proof.policyId!==resolved.case.policyId||proof.actionIntentId!==invocation.actionIntentId||proof.operationId!==resolved.operation.id||verificationPolicyHash(resolved.case.policySnapshotJson as unknown as VerificationPolicy)!==resolved.case.policyHash||proof.evidenceHash!==catalogHash({policyHash:resolved.case.policyHash,method:proof.method,resultState:proof.resultState,evidenceJson:proof.evidenceJson})||!task||task.payloadJson.lookupOnly!==true||task.payloadJson.invocationId!==invocation.id||task.payloadJson.operationId!==resolved.operation.id||task.status!=='SUCCEEDED'||!task.resultJson||realityValueHash(task.resultJson)!==task.resultHash)throw new ConflictException('POST_WRITE_RECONCILIATION_NOT_VERIFIED');
      const candidates=await store.select({truthId:candidateFacts.truthRecordId}).from(candidateFacts).innerJoin(sourceObservations,eq(sourceObservations.id,candidateFacts.observationId)).where(and(eq(sourceObservations.userId,userId),eq(sourceObservations.externalEventKey,`calendar-write:${invocation.id}`),eq(sourceObservations.evidenceHash,String(task.resultJson.resultHash))));
      truthIds=candidates.map(row=>row.truthId).filter((id):id is string=>id!==null);
    }else if(result.verificationState!=='VERIFIED'||result.executionState!=='SUCCEEDED')throw new ConflictException('POST_WRITE_RESULT_NOT_VERIFIED');
    if(!truthIds.length)throw new ConflictException('POST_WRITE_TRUTH_COMMIT_PENDING');
    const truths=await store.select({record:truthRecords,version:truthRecordVersions,provenance:truthProvenance,observation:sourceObservations})
      .from(truthRecords).innerJoin(truthRecordVersions,eq(truthRecordVersions.id,truthRecords.currentVersionId))
      .innerJoin(truthProvenance,eq(truthProvenance.truthRecordVersionId,truthRecordVersions.id))
      .innerJoin(sourceObservations,and(eq(sourceObservations.id,truthProvenance.observationId),eq(sourceObservations.userId,userId)))
      .where(and(eq(truthRecords.userId,userId),inArray(truthRecords.id,truthIds),eq(truthRecords.status,'verified'),isNull(truthRecords.revokedAt),
        eq(sourceObservations.externalEventKey,`calendar-write:${invocation.id}`),eq(sourceObservations.parserKey,'native.calendar-event.v1')));
    const schedule=truths.find(row=>row.version.valueJson.factKey==='calendar_event.schedule');
    const evidence=task?.resultJson?.evidence as Record<string,unknown>|undefined;
    const value=schedule?.version.valueJson.value as Record<string,unknown>|undefined;
    const start=value?.start as {dateTime?:string}|undefined,end=value?.end as {dateTime?:string}|undefined;
    if(!schedule||!task||task.status!=='SUCCEEDED'||!evidence||!value
      || schedule.observation.payloadJson.invocationId!==invocation.id||schedule.observation.payloadJson.targetId!==invocation.targetId
      || schedule.record.subjectKey!==schedule.version.valueJson.subjectKey
      || schedule.record.subjectKey!==`local:${task.deviceId}:calendar:${expected.calendarId}:${value.eventId}:${Date.parse(expected.start.dateTime)}`
      || schedule.version.verificationMethod!=='DEVICE_READ_BACK'||schedule.version.valueHash!==realityValueHash(schedule.version.valueJson)
      || schedule.version.evidenceHash!==schedule.provenance.evidenceHash||schedule.provenance.evidenceHash!==task.resultJson?.resultHash
      || schedule.observation.evidenceHash!==schedule.provenance.evidenceHash
      || schedule.observation.observedAt.getTime()!==schedule.provenance.observedAt.getTime()
      || value.eventId!==task.resultJson?.deviceOperationId||value.calendarId!==expected.calendarId||value.title!==expected.title||value.allDay!==false
      || Date.parse(start?.dateTime??'')!==Date.parse(expected.start.dateTime)||Date.parse(end?.dateTime??'')!==Date.parse(expected.end.dateTime)
      || value.nativeStatus!=='SCHEDULED'||evidence.eventId!==value.eventId)
      throw new ConflictException('POST_WRITE_TRUTH_GOAL_MISMATCH');
    const coverage:AcquisitionCoverage[]=[{sourceId:`runtime-target:${invocation.targetId}`,factKey:'calendar_event.schedule',state:'VERIFIED_PRESENT',observedAt:schedule.provenance.observedAt.toISOString(),evidenceRefs:[`runtime-result:${result.id}`,`observation:${schedule.observation.id}`,`truth-version:${schedule.version.id}`],reason:'本次创建目标已由真实日历回读事实验证'}];
    const input={coverage,verifiedComplete:true,hasConflict:false,approvalRequired:false,approvalGranted:true,executionAuthorized:false,due:false,thresholdExceeded:null,changed:null,serviceAvailable:false};
    const nextIsFuture=nextRunAt!==null&&Date.parse(nextRunAt)>Date.now();
    return {schema:'scheduled-calendar-reassessment.v1',planVersionId,executionId,recipeKey:parameters.recipeKey,
      evaluatedAt:new Date().toISOString(),completionSubjectKey:schedule.record.subjectKey,
      resultId:result.id,reconciliationCaseId:reconciliationCaseId??null,invocationId:invocation.id,observationRef:schedule.observation.id,truthVersionId:schedule.version.id,
      stateAssessment:assessState(input),nextBestAction:nextBestAction(input),
      // Complete the verified occurrence; the persistent Plan waits for its next
      // trigger, which independently refreshes the original frozen FactDemand.
      replan:nextIsFuture?{nextRunAt,stateAssessment:assessState({...input,verifiedComplete:false}),nextBestAction:nextBestAction({...input,verifiedComplete:false})}:null};
  }

  /** Acquisition dispatch reuses the existing queue; this does not execute a Plan action. */
  async acquire(userId:string,input:AcquireFactDemandsDto,sourcePins?:Readonly<Record<string,string|null>>,acquisitionKey?:string,planWakeup?:{planVersionId:string;triggerId:string;scheduledAt:string;bindingId:string|null}){
    if(input.scopeStart>=input.scopeEnd||input.scopeEnd-input.scopeStart>31*86400000)throw new BadRequestException('读取范围无效');
    const resolved=await this.resolve(userId,{scenarioKey:input.scenarioKey,scenarioRevision:input.scenarioRevision,goal:input.goal,subject:input.subject},sourcePins);
    const dispatched=new Map<string,{sourceId:string;taskId:string;state:string}>();
    const providerAcquisitions=new Map<string,{sourceId:string;acquisitionId:string;state:string}>();
    for(const demand of resolved.demands){
      const source=demand.selectedSource;
      if(source?.kind==='PROVIDER_CONNECTION'&&source.connectionId&&source.capabilityKey==='READ_CALENDAR_EVENT'&&demand.sourceCurrentlyUsable&&!providerAcquisitions.has(source.sourceId)){
        const result=await this.acquireProviderCalendar(userId,source.connectionId,source.sourceId,input,acquisitionKey??newId());
        providerAcquisitions.set(source.sourceId,{sourceId:source.sourceId,acquisitionId:result.id,state:result.state});continue;
      }
      if(!source||source.kind!=='NATIVE_DEVICE'||source.capabilityKey!=='READ_CALENDAR_EVENT'||!demand.sourceCurrentlyUsable||!source.trustedDeviceId)continue;
      if(dispatched.has(source.sourceId))continue;
      const task=await this.deviceTasks.enqueue(userId,source.trustedDeviceId,'NATIVE_CALENDAR_READ','calendar_event.meetings.state','CalendarEvent',{scopeStart:input.scopeStart,scopeEnd:input.scopeEnd,sourceId:source.sourceId,demandIds:resolved.demands.filter(row=>row.selectedSource?.sourceId===source.sourceId).map(row=>row.demandId),...(planWakeup?{planWakeup}:{})},acquisitionKey?`${acquisitionKey}:${source.sourceId}`:undefined);
      dispatched.set(source.sourceId,{sourceId:source.sourceId,taskId:task.id,state:task.status==='SUCCEEDED'&&typeof task.result?.state==='string'?task.result.state:task.status});
    }
    return {authority:'SourceResolver',evaluatedAt:resolved.evaluatedAt,sourceResolverResults:resolved.sourceResolverResults,acquisitionCoverage:resolved.acquisitionCoverage,tasks:[...dispatched.values()],acquisitions:[...providerAcquisitions.values()],state:dispatched.size||providerAcquisitions.size?'ACQUISITION_PENDING':'NO_SUPPORTED_ACQUISITION_DISPATCH'};
  }

  private async acquireProviderCalendar(userId:string,connectionId:string,sourceId:string,input:AcquireFactDemandsDto,key:string){
    const requestId=catalogHash({key,sourceId});
    const existing=(await this.db.select().from(acquisitionRounds).where(and(eq(acquisitionRounds.userId,userId),eq(acquisitionRounds.requestId,requestId))).limit(1))[0];
    if(existing)return {id:existing.id,state:existing.state};
    const id=newId(),now=new Date();
    try{await this.db.insert(acquisitionRounds).values({id,userId,requestId,trustedDeviceId:null,sourceId,capability:'calendar.read',manifestVersion:'google_calendar:canonical-read-v1',state:'UNKNOWN',itemCount:null,contentHash:null,observedAt:null,scopeStart:new Date(input.scopeStart),scopeEnd:new Date(input.scopeEnd),evidenceRefsJson:[`connection:${connectionId}`],reason:'Provider 读取尚未完成',createdAt:now});}
    catch(error){const prior=(await this.db.select().from(acquisitionRounds).where(and(eq(acquisitionRounds.userId,userId),eq(acquisitionRounds.requestId,requestId))).limit(1))[0];if(prior)return {id:prior.id,state:prior.state};throw error;}
    let state='UNAVAILABLE',itemCount:number|null=null,contentHash:string|null=null,refs=[`connection:${connectionId}`],reason='Provider 读取不可用';
    try {
      const provider=this.moduleRef.get(GoogleCalendarService,{strict:false});
      const result=await provider.observe(userId,connectionId,{timeMin:new Date(input.scopeStart).toISOString(),timeMax:new Date(input.scopeEnd).toISOString(),maxItems:50});
      itemCount=result.observations.length;state=result.nextPageToken?'UNKNOWN':itemCount?'VERIFIED_PRESENT':'VERIFIED_EMPTY';contentHash=catalogHash(result);
      refs=[...refs,...result.observations.map(row=>`observation:${row.observationId}`)];reason=result.nextPageToken?'Provider 分页尚未完成，不能判断完整范围':itemCount?'Provider 读取及现有 Truth 确认完成':'Provider 在该范围返回空事件集合';
    }catch(error){if((error as {getStatus?:()=>number}).getStatus?.()===403){state='PERMISSION_REQUIRED';reason='Provider 授权需要处理';}}
    await this.db.transaction(async tx=>{await tx.update(acquisitionRounds).set({state,itemCount,contentHash,observedAt:new Date(),evidenceRefsJson:refs,reason}).where(eq(acquisitionRounds.id,id));await this.audit.append({actorType:'system',userId,action:'PROVIDER_ACQUISITION_RECORDED',resourceType:'acquisition_round',resourceId:id,correlationId:key,source:'scheduler',result:['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)?'success':'blocked',after:{sourceId,state,itemCount,evidenceRefs:refs},changeSummary:'Existing Provider read and Reality Pipeline acquisition recorded'},tx);});
    return {id,state};
  }

  async resolve(userId: string, raw: ResolveFactDemandsDto, sourcePins?: Readonly<Record<string,string|null>>, acquisitionTaskId?: string, truthVersionIds?: readonly string[]) {
    try {
      const { request, contract } = factDemandRequestForScenario(raw);
      const watch=request.goal.constraints.recipeKey==='notification.shipment-watch.v1'?notificationWatchAuthoringSchema.parse(JSON.parse(String(request.goal.constraints.notificationWatchJson))):null;
      if(watch&&(request.scenarioKey!=='daily_life.delivery'||request.goal.intent!=='NOTIFY_ON_DELIVERY_EXCEPTION'||request.subject.subjectKey!=='notification-source:'+watch.connectionId||sourcePins?.['shipment.status']!=='device-app:'+watch.connectionId))throw new ConflictException('Notification watch frozen scope mismatch');
      await this.validateManagedSubject(userId, request.subject.resourceType, request.subject.subjectKey);
      const handoff = acquisitionTaskId ? await this.committedAcquisition(userId, acquisitionTaskId) : undefined;
      const [providerCandidates, deviceCandidates, truths, nativeCandidates,acquisition] = await Promise.all([
        this.providerCandidates(userId, contract.factDemands.flatMap((demand) => demand.acceptedSourceCapabilities),contract.factDemands.flatMap(demand=>demand.acceptedSourceModes)),
        this.deviceCandidates(userId, contract.factDemands.flatMap((demand) => demand.acceptedSourceCapabilities)),
        this.truthEvidence(userId, request.subject.subjectKey, handoff, truthVersionIds,watch?.connectionId),
        this.nativeCandidates(userId,contract.factDemands.flatMap(demand=>demand.acceptedSourceCapabilities)),
        this.acquisition.coverage(userId),
      ]);
      const evaluatedAt = new Date().toISOString();
      const demands=buildFactDemandProjections({request,contract,sources:[...providerCandidates,...deviceCandidates,...nativeCandidates],truths,evaluatedAt,sourcePins,...(watch?{sourceWideSubject:{sourceId:'device-app:'+watch.connectionId}}:{})});
      const acquisitionCoverage:AcquisitionCoverage[]=demands.map(demand=>({sourceId:demand.selectedSourceId??'unresolved:'+demand.demandId,factKey:demand.factKey,state:demand.state==='SATISFIED'?'VERIFIED_PRESENT':demand.state==='CONFLICT'?'CONFLICT':demand.state==='STALE'?'STALE':demand.state==='NEEDS_PERMISSION'?'PERMISSION_REQUIRED':demand.state==='DEVICE_OFFLINE'?'OFFLINE':['PROVIDER_UNHEALTHY','SOURCE_NOT_IMPLEMENTED','NEEDS_SOURCE'].includes(demand.state)?'UNAVAILABLE':'UNKNOWN',observedAt:demand.truthEvidence[0]?.observedAt??null,evidenceRefs:demand.truthEvidence.filter(truth=>truth.verified).map(truth=>'truth-version:'+truth.truthVersionId),reason:demand.state==='SATISFIED'?'已有经过验证的事实':'本轮来源或事实尚需处理'}));
      const rules:TruthRule[]=[];
      if(request.scenarioKey==='work.meetings')rules.push({kind:'TIME',factKey:'calendar_event.meetings.state',field:['start','dateTime'],leadSeconds:0});
      const threshold=request.goal.constraints?.thresholdDays;
      if(request.scenarioKey==='device.consumables'&&typeof threshold==='number'&&Number.isFinite(threshold))rules.push({kind:'THRESHOLD',factKey:'device.consumable.remaining_days',field:['remainingDays'],operator:'LTE',threshold});
      // Assessment must obey the same frozen sources as demand satisfaction.
      const selectedTruthIds=new Set(demands.flatMap(demand=>demand.truthEvidence.map(truth=>truth.truthVersionId)));
      const ruleResults=evaluateTruthRules(truths.filter(truth=>selectedTruthIds.has(truth.truthVersionId)).map(truth=>({factKey:truth.factKey,value:truth.normalizedValue,verified:truth.verified,observedAt:truth.observedAt,evidenceRefs:['truth-version:'+truth.truthVersionId]})),rules,evaluatedAt);
      const assessmentInput={coverage:acquisitionCoverage,verifiedComplete:false,hasConflict:demands.some(d=>d.state==='CONFLICT'),approvalRequired:true,approvalGranted:false,executionAuthorized:false,due:ruleResults.find(row=>row.rule.kind==='TIME')?.matched??null,thresholdExceeded:ruleResults.find(row=>row.rule.kind==='THRESHOLD')?.matched??null,changed:null,serviceAvailable:false};
      return {
        truthHandoffProof: handoff ? {
          schema: 'acquisition-truth-handoff.v1' as const,
          taskId: handoff.taskId, invocationId: handoff.invocationId,
          acquisitionResultId: handoff.acquisitionResultId, resultHash: handoff.resultHash,
          acquisitionId: handoff.acquisitionId, planVersionId: handoff.planVersionId,
          contractHash: contract.definitionHash, subjectKey: request.subject.subjectKey,
          sourceId: handoff.sourceId, observedAt: handoff.observedAt.toISOString(),
          contentHash: handoff.contentHash,
          coverageConfirmed: demands.filter(demand => demand.required).every(demand => demand.state === 'SATISFIED'),
          truths: truths.filter(truth => selectedTruthIds.has(truth.truthVersionId)).map(truth => ({
            factKey: truth.factKey, observationRef: truth.observationId,
            truthRecordId: truth.truthRecordId, truthVersionId: truth.truthVersionId,
            valueHash: truth.valueHash, evidenceHash: truth.evidenceHash,
          })),
        } : null,
        sourceAcquisitionCoverage:acquisition.sources.map(row=>({sourceId:normalizeLocalSourceId(row.sourceId),factKey:'source.snapshot.'+row.capability,state:row.state,observedAt:row.observedAt?.toISOString()??null,scope:{start:row.scopeStart.toISOString(),end:row.scopeEnd.toISOString()},evidenceRefs:row.evidenceRefsJson,reason:row.reason})),
        ruleResults,acquisitionCoverage,stateAssessment:assessState(assessmentInput),nextBestAction:nextBestAction(assessmentInput),
        sourceResolverResults:demands.map(demand=>({factKey:demand.factKey,state:demand.state,selectedSourceId:demand.selectedSource?.sourceId??null,evaluatedAt,candidates:demand.candidateSources})),
        scenario: contract.scenario,
        contractHash: contract.definitionHash,
        goal: request.goal,
        subject: request.subject,
        demands,
        evaluatedAt,
      };
    } catch (error) {
      if (error instanceof ZodError) throw new BadRequestException({ message: 'Invalid FactDemand request', issues: error.issues });
      if (error instanceof Error && /Scenario Contract|Goal intent|ResourceSubject|immutable/.test(error.message)) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async validateManagedSubject(userId: string, resourceType: string, subjectKey: string) {
    if (resourceType !== 'device.consumable') return;
    const prefix = 'device.consumable:';
    const id = subjectKey.startsWith(prefix) ? subjectKey.slice(prefix.length) : '';
    if (!id) throw new BadRequestException('ResourceSubject must reference a managed device consumable');
    const owned = (await this.db.select({ id: deviceConsumables.id }).from(deviceConsumables)
      .where(and(eq(deviceConsumables.id, id), eq(deviceConsumables.userId, userId))).limit(1))[0];
    if (!owned) throw new BadRequestException('ResourceSubject does not belong to the current user');
  }

  private async providerCandidates(userId: string, allowedCapabilities: readonly string[],acceptedModes:readonly string[]): Promise<SourceCandidateEvidence[]> {
    const allowed = new Set(allowedCapabilities);
    const candidates = await this.readiness.projectCapabilityCandidates(userId);
    return candidates.filter((candidate) => allowed.has(candidate.capabilityKey)).map((candidate) => ({
      sourceId: `connection:${candidate.connectionId}:${candidate.capabilityKey}`,
      kind: 'PROVIDER_CONNECTION' as const,
      providerKey: candidate.providerKey,
      connectionId: candidate.connectionId,
      sourceMode: candidate.sourceModes.find(mode=>acceptedModes.includes(mode))??candidate.sourceModes[0]??'UNSUPPORTED',
      supportedSourceModes: candidate.sourceModes,
      capabilityKey: candidate.capabilityKey,
      trustedDeviceId: null,
      deviceAppConnectionId: null,
      truthRecordId: null,
      truthVersionId: null,
      discovered: candidate.dimensions.declared,
      ownedByUser: true,
      implemented: candidate.dimensions.implemented,
      authorized: candidate.dimensions.authorized,
      deviceOnline: true,
      healthy: candidate.dimensions.healthy,
      contractCompatible:candidate.sourceModes.some(mode=>acceptedModes.includes(mode)),
      estimatedLatencyMs: null,
      costClass: 'UNKNOWN',
      evidenceRefs: [`connection:${candidate.connectionId}`, `provider:${candidate.providerKey}`, `capability:${candidate.capabilityKey}`],
      reasonCodes: candidate.reasons,
    }));
  }

  private async deviceCandidates(userId: string, allowedCapabilities: readonly string[]): Promise<SourceCandidateEvidence[]> {
    const rows = await this.db.select({
      id: deviceAppConnections.id,
      nativeGrant:localCapabilityStates,
      packageName: deviceAppConnections.packageName,
      enabled: deviceAppConnections.enabled,
      launchable: deviceAppConnections.launchable,
      modes: deviceAppConnections.modesJson,
      trustedDeviceId: trustedDevices.id,
      deviceStatus: trustedDevices.status,
      revokedAt: trustedDevices.revokedAt,
      onlineState: deviceHeartbeats.onlineState,
      lastHeartbeatAt: deviceHeartbeats.lastHeartbeatAt,
    }).from(deviceAppConnections)
      .innerJoin(trustedDevices, and(eq(deviceAppConnections.trustedDeviceId, trustedDevices.id), eq(trustedDevices.userId, userId)))
      .leftJoin(deviceHeartbeats, and(eq(deviceHeartbeats.trustedDeviceId, trustedDevices.id), eq(deviceHeartbeats.userId, userId)))
      .leftJoin(localCapabilityStates,and(eq(localCapabilityStates.trustedDeviceId,trustedDevices.id),eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.capability,'notification.read')))
      .where(and(eq(deviceAppConnections.userId, userId), isNull(trustedDevices.revokedAt)));
    const now = Date.now();
    const allowed = new Set(allowedCapabilities);
    return rows.map((row) => {
      const metadata = deviceAppCatalogMetadata(row.packageName);
      const capabilityKey = metadata.actionCapabilities.find((key) => allowed.has(key)) ?? null;
      const implemented = row.launchable === 1 && metadata.notificationReadable;
      const authorized = row.enabled === 1 && row.modes.includes('notification_read')&&row.nativeGrant?.userGrant===true&&row.nativeGrant.systemPermission==='GRANTED';
      const nativeHealthy=Boolean(row.nativeGrant&&localCapabilityAvailability({key:row.nativeGrant.capability,userGrant:row.nativeGrant.userGrant,systemPermission:row.nativeGrant.systemPermission as never,health:row.nativeGrant.health as never,checkedAt:row.nativeGrant.checkedAt.getTime()},now)==='AVAILABLE');
      const deviceOnline = row.onlineState === 'online' && Boolean(row.lastHeartbeatAt)
        && now - (row.lastHeartbeatAt?.getTime() ?? 0) <= 30_000;
      return {
        sourceId: `device-app:${row.id}`,
        kind: 'TRUSTED_DEVICE' as const,
        providerKey: row.packageName,
        connectionId: null,
        sourceMode: 'NOTIFICATION',
        capabilityKey,
        trustedDeviceId: row.trustedDeviceId,
        deviceAppConnectionId: row.id,
        truthRecordId: null,
        truthVersionId: null,
        discovered: true,
        ownedByUser: true,
        implemented,
        authorized,
        deviceOnline,
        healthy: row.deviceStatus === 'active'&&nativeHealthy,
        contractCompatible: capabilityKey !== null,
        resolverEvidence:{authority:0.5,freshness:nativeHealthy?1:0,reliability:null,verificationAbility:true,privacyCost:1,cost:0,latencyMs:5000},
        estimatedLatencyMs: 5_000,
        costClass: 'FREE' as const,
        evidenceRefs: [`trusted-device:${row.trustedDeviceId}`, `device-app:${row.id}`, `package:${row.packageName}`],
        reasonCodes: [
          ...(!implemented ? ['DEVICE_SOURCE_NOT_IMPLEMENTED'] : []),
          ...(!authorized ? ['DEVICE_SOURCE_NOT_AUTHORIZED'] : []),
          ...(!deviceOnline ? ['DEVICE_OFFLINE'] : []),
        ],
      };
    });
  }

  private async nativeCandidates(userId:string,allowedCapabilities:readonly string[]):Promise<SourceCandidateEvidence[]>{
    const capabilityMap=LOCAL_RUNTIME_CAPABILITY_MAP;
    const rows=await this.db.select({state:localCapabilityStates}).from(localCapabilityStates).innerJoin(trustedDevices,and(eq(trustedDevices.id,localCapabilityStates.trustedDeviceId),eq(trustedDevices.userId,localCapabilityStates.userId))).where(and(eq(localCapabilityStates.userId,userId),eq(trustedDevices.status,'active'),isNull(trustedDevices.revokedAt))).then(rows=>rows.map(row=>row.state));
    return rows.filter(row=>allowedCapabilities.includes(capabilityMap[row.capability])).map(row=>{
      const fresh=row.checkedAt.getTime()<=Date.now()+1000&&Date.now()-row.checkedAt.getTime()<=300000;
      return {sourceId:localCapabilitySourceId(row.trustedDeviceId,row.capability),kind:'NATIVE_DEVICE',providerKey:'android-native',connectionId:null,sourceMode:'NATIVE_OS',capabilityKey:capabilityMap[row.capability],trustedDeviceId:row.trustedDeviceId,deviceAppConnectionId:null,truthRecordId:null,truthVersionId:null,discovered:true,ownedByUser:true,implemented:['android-local-v2','android-local-v3','android-local-v4'].includes(row.manifestVersion),authorized:row.userGrant&&row.systemPermission==='GRANTED',deviceOnline:fresh,healthy:fresh&&row.health==='HEALTHY',contractCompatible:true,estimatedLatencyMs:null,costClass:'FREE',evidenceRefs:[row.evidenceRef],reasonCodes:[],resolverEvidence:{authority:1,freshness:fresh?1:0,reliability:null,verificationAbility:true,privacyCost:1,cost:0,latencyMs:null}};
    });
  }
  private async committedAcquisition(userId: string, taskId: string): Promise<AcquisitionHandoff> {
    const task = (await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.userId,userId))).limit(1))[0];
    const row = (await this.db.select({invocation:capabilityInvocations,result:runtimeResults,target:runtimeTargets})
      .from(invocationRuntimeLinks)
      .innerJoin(capabilityInvocations,and(eq(capabilityInvocations.id,invocationRuntimeLinks.invocationId),eq(capabilityInvocations.userId,userId)))
      .innerJoin(runtimeResults,and(eq(runtimeResults.invocationId,capabilityInvocations.id),eq(runtimeResults.userId,userId)))
      .innerJoin(runtimeTargets,and(eq(runtimeTargets.id,capabilityInvocations.targetId),eq(runtimeTargets.userId,userId)))
      .where(and(eq(invocationRuntimeLinks.runtimeRef,taskId),eq(invocationRuntimeLinks.runtimeKind,'DEVICE_TASK'))).limit(1))[0];
    if (!task || !row) throw new ConflictException('TRUTH_COMMIT_BARRIER_PENDING');
    return this.validateAcquisitionRow(userId,{task,...row});
  }

  private async validateAcquisitionRow(userId: string, {task,invocation,result,target}: {
    task:typeof deviceTasks.$inferSelect; invocation:typeof capabilityInvocations.$inferSelect;
    result:typeof runtimeResults.$inferSelect; target:typeof runtimeTargets.$inferSelect;
  }): Promise<AcquisitionHandoff> {
    const origin = task.payloadJson.planWakeup as {planVersionId?:string}|undefined;
    const refs = [...new Set(result.evidenceRefs.filter(ref => ref.startsWith('acquisition:')))];
    const receipt = refs.length === 1 ? (await this.db.select().from(acquisitionRounds)
      .where(and(eq(acquisitionRounds.id,refs[0]!.slice(12)),eq(acquisitionRounds.userId,userId))).limit(1))[0] : undefined;
    const resultContent = {invocationId:result.invocationId,targetId:result.targetId,authorityEpoch:result.authorityEpoch,
      payloadRef:result.payloadRef,evidenceRefs:result.evidenceRefs,executionState:result.executionState};
    if (task.status !== 'SUCCEEDED' || task.taskType !== 'NATIVE_CALENDAR_READ' || !origin?.planVersionId
      || invocation.planVersionId !== origin.planVersionId || invocation.capabilityId !== 'calendar.event.read'
      || invocation.resourceScope.deviceTaskId !== task.id || invocation.resourceScope.sourceId !== task.payloadJson.sourceId
      || target.backingRef !== task.trustedDeviceId || target.authorityEpoch !== invocation.authorityEpoch
      || result.authorityEpoch !== invocation.authorityEpoch || result.targetId !== invocation.targetId
      || result.verificationState !== 'VERIFIED' || result.executionState !== 'SUCCEEDED'
      || catalogHash(resultContent) !== result.resultHash
      || result.payloadRef !== `device-task:${task.id}:sha256:${catalogHash(task.resultJson)}`
      || !receipt || !['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(receipt.state)
      || receipt.trustedDeviceId !== task.trustedDeviceId || normalizeLocalSourceId(receipt.sourceId) !== task.payloadJson.sourceId
      || receipt.contentHash !== task.resultJson?.contentHash || !receipt.contentHash || !receipt.observedAt
      || receipt.observedAt.getTime() !== task.resultJson?.observedAt
      || receipt.scopeStart.getTime() !== task.payloadJson.scopeStart || receipt.scopeEnd.getTime() !== task.payloadJson.scopeEnd)
      throw new ConflictException('ACQUISITION_TRUTH_HANDOFF_NOT_AUTHORIZED');
    return {taskId:task.id,invocationId:invocation.id,acquisitionResultId:result.id,resultHash:result.resultHash,
      acquisitionId:receipt.id,planVersionId:origin.planVersionId,sourceId:normalizeLocalSourceId(receipt.sourceId),
      observedAt:receipt.observedAt,contentHash:receipt.contentHash,scopeStart:receipt.scopeStart,scopeEnd:receipt.scopeEnd};
  }

  private async truthEvidence(userId: string, subjectKey: string, handoff?: AcquisitionHandoff, truthVersionIds?: readonly string[],notificationConnectionId?:string): Promise<Array<FactTruthEvidence & {observationId:string|null;evidenceHash:string|null}>> {
    let rows = await this.db.select({
      truthRecordId: truthRecords.id,
      status: truthRecords.status,
      subjectKey: truthRecords.subjectKey,
      truthVersionId: truthRecordVersions.id,
      value: truthRecordVersions.valueJson,
      valueHash: truthRecordVersions.valueHash,
      createdAt: truthRecordVersions.createdAt,
      providerKey: truthProvenance.providerKey,
      sourceMode: truthProvenance.sourceMode,
      deviceAppConnectionId:appReadSessions.deviceAppConnectionId,
      notificationConnectionId:mobileNotificationReceipts.deviceAppConnectionId,
      notificationStatus:mobileNotificationReceipts.status,
      sourceConnectionId:sourceObservations.connectionId,
      nativePayload:sourceObservations.payloadJson,
      observationId:sourceObservations.id,
      evidenceHash:truthProvenance.evidenceHash,
      observedAt: truthProvenance.observedAt,
    }).from(truthRecords)
      .innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .leftJoin(truthProvenance, eq(truthProvenance.truthRecordVersionId, truthRecordVersions.id))
      .leftJoin(sourceObservations,and(eq(sourceObservations.id,truthProvenance.observationId),eq(sourceObservations.userId,userId)))
      .leftJoin(appReadSessionEvents,and(eq(appReadSessionEvents.observationId,sourceObservations.id),eq(appReadSessionEvents.userId,userId)))
      .leftJoin(appReadSessions,and(eq(appReadSessions.id,appReadSessionEvents.sessionId),eq(appReadSessions.userId,userId)))
      .leftJoin(mobileNotificationReceipts,and(eq(mobileNotificationReceipts.id,truthRecords.sourceReceiptId),eq(mobileNotificationReceipts.userId,userId)))
      .where(and(eq(truthRecords.userId, userId),notificationConnectionId?and(eq(mobileNotificationReceipts.deviceAppConnectionId,notificationConnectionId),eq(mobileNotificationReceipts.status,'verified')):eq(truthRecords.subjectKey, subjectKey), isNull(truthRecords.revokedAt),
        ...(handoff ? [
          sql`JSON_UNQUOTE(JSON_EXTRACT(${sourceObservations.payloadJson}, '$.acquisitionId')) = ${handoff.acquisitionId}`,
          sql`JSON_UNQUOTE(JSON_EXTRACT(${sourceObservations.payloadJson}, '$.nativeSourceId')) = ${handoff.sourceId}`,
          eq(truthProvenance.evidenceHash,handoff.contentHash),eq(sourceObservations.evidenceHash,handoff.contentHash),
          eq(truthProvenance.observedAt,handoff.observedAt),eq(sourceObservations.observedAt,handoff.observedAt),
        ] : [])));
    // Pin the handoff's fact version, while retaining other required facts on
    // multi-demand scenarios. Pinning one fact must not erase their coverage.
    if(truthVersionIds){
      const ids=new Set(truthVersionIds);
      const pinnedFacts=new Set(rows.filter(row=>ids.has(row.truthVersionId)).map(row=>row.value.factKey));
      rows=rows.filter(row=>!pinnedFacts.has(row.value.factKey)||ids.has(row.truthVersionId));
    }
    const latestNative=new Map<string,string>();
    for(const row of [...rows].sort((a,b)=>(b.observedAt??b.createdAt).getTime()-(a.observedAt??a.createdAt).getTime()||b.createdAt.getTime()-a.createdAt.getTime()))if(row.sourceMode==='NATIVE_OS'){const key=row.value.factKey+':'+String(row.nativePayload?.nativeSourceId);if(!latestNative.has(key))latestNative.set(key,row.truthVersionId);}
    return rows.flatMap((row) => {
      if(row.sourceMode==='NATIVE_OS'&&latestNative.get(row.value.factKey+':'+String(row.nativePayload?.nativeSourceId))!==row.truthVersionId)return [];
      const factKey = typeof row.value.factKey === 'string' ? row.value.factKey : null;
      if (!factKey) return [];
      const reality = isRealityLevel(row.value.realityLevel) ? row.value.realityLevel : 'CLAIMED';
      return [{
        observationId:row.observationId,evidenceHash:row.evidenceHash,
        normalizedValue:row.value.value??row.value,
        sourceConnectionId:row.sourceConnectionId,
        sourceIds:row.notificationConnectionId&&row.notificationStatus==='verified'?[`device-app:${row.notificationConnectionId}`]:row.deviceAppConnectionId?[`device-app:${row.deviceAppConnectionId}`]:typeof row.nativePayload?.nativeSourceId==='string'?[normalizeLocalSourceId(row.nativePayload.nativeSourceId)]:[],
        truthRecordId: row.truthRecordId,
        truthVersionId: row.truthVersionId,
        factKey,
        subjectKey: row.subjectKey,
        sourceProviderKey: row.providerKey ?? 'unknown',
        sourceMode: row.sourceMode ?? 'INTERNAL',
        valueHash: row.valueHash,
        realityLevel: reality,
        verified: row.status === 'verified',
        observedAt: (row.observedAt ?? row.createdAt).toISOString(),
        createdAt: row.createdAt.toISOString(),
        conflict: row.status === 'conflict' || row.status === 'conflicted',
      } satisfies FactTruthEvidence & {observationId:string|null;evidenceHash:string|null}];
    });
  }
}

function isRealityLevel(value: unknown): value is RealityLevel {
  return value === 'CLAIMED' || value === 'OBSERVED' || value === 'CORROBORATED' || value === 'VERIFIED';
}
