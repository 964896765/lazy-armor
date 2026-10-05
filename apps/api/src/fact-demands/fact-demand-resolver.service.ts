import {LocalAcquisitionService} from '../consumer/local-acquisition.service';
import { ModuleRef } from '@nestjs/core';
import { GoogleCalendarService } from '../providers/calendar/calendar.service';
import { AuditService } from '../audit/audit.service';
import { acquisitionRounds } from '@lazy-armor/database';
import { catalogHash } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import {DeviceTasksService} from '../device-tasks/device-tasks.service';
import type {AcquireFactDemandsDto} from './dto';
import {localCapabilityAvailability,LOCAL_RUNTIME_CAPABILITY_MAP,localCapabilitySourceId,normalizeLocalSourceId} from '@lazy-armor/plan-schema';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  deviceAppConnections,localCapabilityStates,
  deviceConsumables,
  deviceHeartbeats,
  trustedDevices,
  appReadSessionEvents,appReadSessions,sourceObservations,
  truthProvenance,
  truthRecords,
  truthRecordVersions,
} from '@lazy-armor/database';
import {
  evaluateTruthRules,type TruthRule,assessState,nextBestAction,type AcquisitionCoverage,
  buildFactDemandProjections,
  factDemandRequestForScenario,
  type FactTruthEvidence,
  type RealityLevel,
  type SourceCandidateEvidence,
} from '@lazy-armor/plan-schema';
import { deviceAppCatalogMetadata } from '@lazy-armor/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ZodError } from 'zod';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import type { ResolveFactDemandsDto } from './dto';

@Injectable()
export class FactDemandResolverService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly readiness: ReadinessEvidenceService,
    private readonly deviceTasks:DeviceTasksService,
    private readonly acquisition:LocalAcquisitionService,
    private readonly moduleRef:ModuleRef,
    private readonly audit:AuditService,
  ) {}

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

  async resolve(userId: string, raw: ResolveFactDemandsDto, sourcePins?: Readonly<Record<string,string|null>>) {
    try {
      const { request, contract } = factDemandRequestForScenario(raw);
      await this.validateManagedSubject(userId, request.subject.resourceType, request.subject.subjectKey);
      const [providerCandidates, deviceCandidates, truths, nativeCandidates,acquisition] = await Promise.all([
        this.providerCandidates(userId, contract.factDemands.flatMap((demand) => demand.acceptedSourceCapabilities),contract.factDemands.flatMap(demand=>demand.acceptedSourceModes)),
        this.deviceCandidates(userId, contract.factDemands.flatMap((demand) => demand.acceptedSourceCapabilities)),
        this.truthEvidence(userId, request.subject.subjectKey),
        this.nativeCandidates(userId,contract.factDemands.flatMap(demand=>demand.acceptedSourceCapabilities)),
        this.acquisition.coverage(userId),
      ]);
      const evaluatedAt = new Date().toISOString();
      const demands=buildFactDemandProjections({request,contract,sources:[...providerCandidates,...deviceCandidates,...nativeCandidates],truths,evaluatedAt,sourcePins});
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
      return {sourceId:localCapabilitySourceId(row.trustedDeviceId,row.capability),kind:'NATIVE_DEVICE',providerKey:'android-native',connectionId:null,sourceMode:'NATIVE_OS',capabilityKey:capabilityMap[row.capability],trustedDeviceId:row.trustedDeviceId,deviceAppConnectionId:null,truthRecordId:null,truthVersionId:null,discovered:true,ownedByUser:true,implemented:['android-local-v2','android-local-v3'].includes(row.manifestVersion),authorized:row.userGrant&&row.systemPermission==='GRANTED',deviceOnline:fresh,healthy:fresh&&row.health==='HEALTHY',contractCompatible:true,estimatedLatencyMs:null,costClass:'FREE',evidenceRefs:[row.evidenceRef],reasonCodes:[],resolverEvidence:{authority:1,freshness:fresh?1:0,reliability:null,verificationAbility:true,privacyCost:1,cost:0,latencyMs:null}};
    });
  }
  private async truthEvidence(userId: string, subjectKey: string): Promise<FactTruthEvidence[]> {
    const rows = await this.db.select({
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
      sourceConnectionId:sourceObservations.connectionId,
      nativePayload:sourceObservations.payloadJson,
      observedAt: truthProvenance.observedAt,
    }).from(truthRecords)
      .innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .leftJoin(truthProvenance, eq(truthProvenance.truthRecordVersionId, truthRecordVersions.id))
      .leftJoin(sourceObservations,and(eq(sourceObservations.id,truthProvenance.observationId),eq(sourceObservations.userId,userId)))
      .leftJoin(appReadSessionEvents,and(eq(appReadSessionEvents.observationId,sourceObservations.id),eq(appReadSessionEvents.userId,userId)))
      .leftJoin(appReadSessions,and(eq(appReadSessions.id,appReadSessionEvents.sessionId),eq(appReadSessions.userId,userId)))
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.subjectKey, subjectKey), isNull(truthRecords.revokedAt)));
    const latestNative=new Map<string,string>();
    for(const row of [...rows].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()))if(row.sourceMode==='NATIVE_OS'){const key=row.value.factKey+':'+String(row.nativePayload?.nativeSourceId);if(!latestNative.has(key))latestNative.set(key,row.truthVersionId);}
    return rows.flatMap((row) => {
      if(row.sourceMode==='NATIVE_OS'&&latestNative.get(row.value.factKey+':'+String(row.nativePayload?.nativeSourceId))!==row.truthVersionId)return [];
      const factKey = typeof row.value.factKey === 'string' ? row.value.factKey : null;
      if (!factKey) return [];
      const reality = isRealityLevel(row.value.realityLevel) ? row.value.realityLevel : 'CLAIMED';
      return [{
        normalizedValue:row.value.value??row.value,
        sourceConnectionId:row.sourceConnectionId,
        sourceIds:row.deviceAppConnectionId?[`device-app:${row.deviceAppConnectionId}`]:typeof row.nativePayload?.nativeSourceId==='string'?[normalizeLocalSourceId(row.nativePayload.nativeSourceId)]:[],
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
      } satisfies FactTruthEvidence];
    });
  }
}

function isRealityLevel(value: unknown): value is RealityLevel {
  return value === 'CLAIMED' || value === 'OBSERVED' || value === 'CORROBORATED' || value === 'VERIFIED';
}
