import { ModuleRef } from '@nestjs/core';
import { RuntimeAuthorityService } from '../execution/runtime-authority.service';
import type { RuntimeAuthoritySource } from '@lazy-armor/plan-schema';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { resolveCapability, candidateCapability, type ResolutionCandidate } from '@lazy-armor/connector-sdk';
import { runtimeTargetCandidateId, type RuntimeTargetActionBinding } from '@lazy-armor/plan-schema';
import { canonicalStringify,canonicalCapabilityId,sameCapabilityIdentity,capabilityIdentity,localCapabilitySourceId,normalizeLocalSourceId,localCapabilityAvailability } from '@lazy-armor/plan-schema';
import { runtimeTargets, planActions, capabilityResolutionDecisions, connections, connectors, connectionCapabilityGrants, providerCapabilityHealth, plans, planVersions,planCreationContracts,planTriggers,localCapabilityStates,trustedDevices,deviceTasks } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { createHash } from 'node:crypto';
import { capabilityAvailability } from '../provider-capabilities/capability-availability';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { ProviderCapabilityRegistryService } from '../provider-capabilities/provider-capability-registry.service';
import type { ResolveCapabilityDto } from './dto';
import { ResolutionEvidenceService } from './resolution-evidence.service';
import { RuntimeTargetsService } from '../runtime-targets/runtime-targets.service';

@Injectable()
export class CapabilityResolverService {
  /** Local capabilities are bound to an owned immutable action, never a fake connection. */
  async resolveLocalNotification(userId: string, planVersionId: string, requestKey: string) {
    const owned = (await this.db.select({ id: planVersions.id }).from(planVersions).innerJoin(plans, and(eq(plans.id, planVersions.planId), eq(plans.userId, userId))).where(eq(planVersions.id, planVersionId)).limit(1))[0];
    const action = (await this.db.select().from(planActions).where(eq(planActions.planVersionId, planVersionId)))[0];
    if (!owned || !action || action.actionType !== 'notify' || action.connectionId || action.configJson?.channel !== 'in_app') throw new ConflictException('No local notification capability binding');
    const input = { planVersionId, requestKey, localActionId: action.id, actionHash: hash({ actionType: action.actionType, config: action.configJson }), capability: 'internal.notification.in_app' };
    const requestHash = hash(input); const prior = await this.findRequest(userId, requestKey);
    if (prior) { if (prior.requestHash !== requestHash || hash(prior.decisionJson) !== prior.decisionHash) throw new ConflictException('Local capability binding changed'); return prior; }
    const decision = { status: 'RESOLVED', selectedCandidateId: 'internal.notification.in_app', authority: 'NotificationService', actionId: action.id };
    const row = { id: newId(), userId, planVersionId, requestKey, requestHash, decisionHash: hash(decision), inputJson: input, decisionJson: decision, createdAt: new Date() };
    try { await this.db.transaction(async tx => {
      await tx.insert(capabilityResolutionDecisions).values(row);
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'CAPABILITY_RESOLUTION_DECIDED', resourceType: 'capability_resolution', resourceId: row.id, correlationId: planVersionId, after: decision, source: 'api', result: 'success' }, tx);
    }); } catch (error) {
      let cause: unknown = error; let duplicate = false;
      for (let i = 0; i < 5 && cause && typeof cause === 'object'; i++) { const item = cause as { code?: string; cause?: unknown }; if (item.code === 'ER_DUP_ENTRY') duplicate = true; cause = item.cause; }
      if (!duplicate) throw error;
      const saved = await this.findRequest(userId, requestKey);
      if (!saved || saved.requestHash !== requestHash || hash(saved.decisionJson) !== saved.decisionHash) throw new ConflictException('Local capability binding changed');
      return saved;
    }
    return row;
  }
  /** Frozen SourceResolver selection is authority for native Plan reads; no synthetic Connection. */
  async resolveNativeNotification(tx:Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0],userId:string,deviceId:string,taskId:string,payload:Record<string,unknown>){
    const task=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.userId,userId))).for('update'))[0];
    if(!task||task.trustedDeviceId!==deviceId||hash(task.payloadJson)!==hash(payload))throw new ConflictException('PLAN_NOTIFICATION_TASK_MISMATCH');
    const {PersistentNotificationPlanService}=await import('../consumer/persistent-notification-plan.service');
    const bundle=await this.modules.get(PersistentNotificationPlanService,{strict:false}).assertTask(tx,userId,task);
    const input={planVersionId:bundle.version.id,sourceContractId:bundle.contract.id,sourceSelectionHash:hash(bundle.contract.sourceSelectionJson),taskId,payload,requirement:{capabilityKey:'app.notification.read',operation:'read'}};
    const decision={status:'RESOLVED',selectedCandidateId:String(payload.sourceId),authority:'SourceResolver',sourceContractId:bundle.contract.id};
    const requestKey=`native-notification:${taskId}`;
    const prior=(await tx.select().from(capabilityResolutionDecisions).where(and(eq(capabilityResolutionDecisions.userId,userId),eq(capabilityResolutionDecisions.requestKey,requestKey))))[0];
    if(prior){if(prior.requestHash!==hash(input)||prior.decisionHash!==hash(decision))throw new ConflictException('Native notification resolution changed');return {plan:bundle.plan,resolution:prior};}
    const resolution={id:newId(),userId,planVersionId:bundle.version.id,requestKey,requestHash:hash(input),decisionHash:hash(decision),inputJson:input,decisionJson:decision,createdAt:new Date()};
    await tx.insert(capabilityResolutionDecisions).values(resolution);
    await this.audit.append({actorType:'system',userId,action:'CAPABILITY_RESOLUTION_DECIDED',resourceType:'capability_resolution',resourceId:resolution.id,correlationId:bundle.version.id,source:'system',result:'success',after:decision,changeSummary:'Bound read-only notification acquisition to the confirmed persistent source'},tx);
    return {plan:bundle.plan,resolution};
  }
  async resolveNativeCalendar(tx: Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0], userId: string, deviceId: string, taskId: string, payload: Record<string, unknown>) {
    const wake = payload.planWakeup as {planVersionId?: string; triggerId?: string; scheduledAt?: string} | undefined;
    if (!wake?.planVersionId || !wake.triggerId || !wake.scheduledAt || !Number.isFinite(Date.parse(wake.scheduledAt))) throw new ConflictException('Invalid native Plan wakeup');
    const version = (await tx.select().from(planVersions).where(eq(planVersions.id, wake.planVersionId)))[0];
    const plan = version && (await tx.select().from(plans).where(and(eq(plans.id, version.planId), eq(plans.userId, userId))).for('update'))[0];
    if (!plan || plan.status !== 'active' || plan.activeVersionId !== version!.id) throw new ConflictException('Native read requires owned active PlanVersion');
    const trigger = (await tx.select().from(planTriggers).where(and(eq(planTriggers.id, wake.triggerId), eq(planTriggers.planVersionId, version!.id))))[0];
    const contract = (await tx.select().from(planCreationContracts).where(and(eq(planCreationContracts.planVersionId, version!.id), eq(planCreationContracts.userId, userId))))[0];
    const sourceId = localCapabilitySourceId(deviceId, 'calendar.read');
    const demands = Array.isArray(payload.demandIds) ? payload.demandIds : [];
    if (!trigger || trigger.triggerType !== 'schedule' || !contract || !demands.length || normalizeLocalSourceId(String(payload.sourceId)) !== sourceId
      || !demands.every(id => contract.sourceSelectionJson.some(pin => pin.demandId === id && typeof pin.selectedSourceId === 'string' && normalizeLocalSourceId(pin.selectedSourceId) === sourceId))) throw new ConflictException('Native source does not match frozen selection');
    const device = (await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId))).for('update'))[0];
    const grant = (await tx.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.trustedDeviceId, deviceId), eq(localCapabilityStates.userId, userId), eq(localCapabilityStates.capability, 'calendar.read'))).for('update'))[0];
    if (!device || device.status !== 'active' || !grant || localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now()) !== 'AVAILABLE') throw new ConflictException('Native calendar authority unavailable');
    const input = {planVersionId: version!.id, sourceContractId: contract.id, sourceSelectionHash: hash(contract.sourceSelectionJson), sourceId, taskId, payload, requirement: {capabilityKey:'calendar.event.read',operation:'read'}};
    const decision = {status:'RESOLVED',selectedCandidateId:sourceId,authority:'SourceResolver',sourceContractId:contract.id};
    const requestKey = `native-calendar:${taskId}`;
    const prior = (await tx.select().from(capabilityResolutionDecisions).where(and(eq(capabilityResolutionDecisions.userId,userId),eq(capabilityResolutionDecisions.requestKey,requestKey))))[0];
    if (prior) { if (prior.requestHash !== hash(input) || prior.decisionHash !== hash(decision)) throw new ConflictException('Native resolution changed'); return {plan, resolution:prior}; }
    const resolution = {id:newId(),userId,planVersionId:version!.id,requestKey,requestHash:hash(input),decisionHash:hash(decision),inputJson:input,decisionJson:decision,createdAt:new Date()};
    await tx.insert(capabilityResolutionDecisions).values(resolution);
    await this.audit.append({actorType:'system',userId,action:'CAPABILITY_RESOLUTION_DECIDED',resourceType:'capability_resolution',resourceId:resolution.id,correlationId:version!.id,source:'scheduler',result:'success',after:decision,changeSummary:'Bound native read to existing frozen SourceResolver choice'},tx);
    return {plan,resolution};
  }
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly manifests: ProviderCapabilityRegistryService, private readonly audit: AuditService,
    private readonly evidence: ResolutionEvidenceService, private readonly targets:RuntimeTargetsService, private readonly modules: ModuleRef) {}

  async resolve(userId: string, input: ResolveCapabilityDto) {
    const owned = (await this.db.select({ id: planVersions.id }).from(planVersions)
      .innerJoin(plans, and(eq(plans.id, planVersions.planId), eq(plans.userId, userId)))
      .where(eq(planVersions.id, input.planVersionId)).limit(1))[0];
    if (!owned) throw new NotFoundException('Plan version not found');
    return this.resolveInput(userId, input);
  }

  async resolveForSource(userId: string, source: RuntimeAuthoritySource, requestKey: string, requirement: ResolveCapabilityDto['requirement']) {
    if (source.kind !== 'USER_EVENT_SYNC') throw new ConflictException('Controlled non-Plan source required');
    await this.db.transaction(tx => this.modules.get(RuntimeAuthorityService, {strict:false}).assertCurrent(tx, source, {userId, planId:null, planVersionId:null}));
    return this.resolveInput(userId, {planVersionId:null, authoritySource:source, requestKey, requirement});
  }

  private async resolveInput(userId: string, input: ResolutionInput) {
    const requestHash = hash(input);
    const prior = await this.findRequest(userId, input.requestKey);
    if (prior) return this.replay(prior, requestHash);
    const candidates = await this.collectCandidates(userId, input, new Date());
    const now = new Date();
    const decision = resolveCapability({...input.requirement,capabilityKey:canonicalCapabilityId(input.requirement.capabilityKey)??input.requirement.capabilityKey}, candidates.map(c=>({...c,capability:{...c.capability,key:canonicalCapabilityId(c.capability.key)??c.capability.key}})), now.toISOString());
    const id = newId();
    try {
      await this.db.transaction(async (tx) => {
        if(input.authoritySource) await this.modules.get(RuntimeAuthorityService,{strict:false}).assertCurrent(tx,input.authoritySource,{userId,planId:null,planVersionId:null});
        await tx.insert(capabilityResolutionDecisions).values({ id, userId, planVersionId: input.planVersionId,
          requestKey: input.requestKey, requestHash, decisionHash: hash(decision),
          inputJson: { requirement: input.requirement, candidates, ...(input.authoritySource ? {authoritySource:input.authoritySource} : {}) }, decisionJson: decision, createdAt: now });
        await this.audit.append({ actorType: 'user', actorUserId: userId, userId,
          action: 'CAPABILITY_RESOLUTION_DECIDED', resourceType: 'capability_resolution', resourceId: id,
          correlationId: input.planVersionId ?? (input.authoritySource?.kind==='USER_EVENT_SYNC'?input.authoritySource.requestId:undefined), after: { status: decision.status, decisionHash: hash(decision) },
          changeSummary: 'Persisted capability selection and hard-filter reasons', source: 'api', result: decision.status === 'RESOLVED' ? 'success' : 'blocked' }, tx);
      });
    } catch (error) {
      let cause: unknown = error;
      let duplicate = false;
      for (let i = 0; i < 5 && cause && typeof cause === 'object'; i++) {
        const item = cause as { code?: string; cause?: unknown };
        if (item.code === 'ER_DUP_ENTRY') duplicate = true;
        cause = item.cause;
      }
      if (!duplicate) throw error;
    }
    const saved = await this.findRequest(userId, input.requestKey);
    if (!saved) throw new ConflictException('Resolution not persisted');
    return this.replay(saved, requestHash);
  }

  async get(userId: string, id: string) {
    const row = (await this.db.select().from(capabilityResolutionDecisions)
      .where(and(eq(capabilityResolutionDecisions.id, id), eq(capabilityResolutionDecisions.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Resolution not found');
    return row;
  }

  async revalidate(userId: string, id: string) {
    const row = await this.get(userId, id);
    if (hash(row.decisionJson) !== row.decisionHash) throw new ConflictException('Resolution decision integrity check failed');
    const original = row.decisionJson;
    if (original.status !== 'RESOLVED' || typeof original.selectedCandidateId !== 'string') throw new ConflictException('Resolution is not usable');
    const requirement = row.inputJson.requirement as ResolveCapabilityDto['requirement'];
    const authoritySource = row.inputJson.authoritySource as RuntimeAuthoritySource | undefined;
    if (!row.planVersionId) {
      if (!authoritySource) throw new ConflictException('Resolution authority source required');
      await this.db.transaction(tx=>this.modules.get(RuntimeAuthorityService,{strict:false}).assertCurrent(tx,authoritySource,{userId,planId:null,planVersionId:null}));
    }
    if (hash({ planVersionId: row.planVersionId, requestKey: row.requestKey, requirement, ...(authoritySource ? {authoritySource} : {}) }) !== row.requestHash) throw new ConflictException('Resolution input integrity check failed');
    const candidates = await this.collectCandidates(userId, { planVersionId: row.planVersionId, requestKey: row.requestKey, requirement, ...(authoritySource ? {authoritySource} : {}) }, new Date());
    const decision = resolveCapability({...requirement,capabilityKey:canonicalCapabilityId(requirement.capabilityKey)??requirement.capabilityKey}, candidates.map(c=>({...c,capability:{...c.capability,key:canonicalCapabilityId(c.capability.key)??c.capability.key}})), new Date().toISOString());
    const eligibility = decision.candidates.find((candidate) => candidate.candidateId === original.selectedCandidateId);
    const candidate = candidates.find((candidate) => candidate.id === original.selectedCandidateId);
    const originalCandidate = (row.inputJson.candidates as ResolutionCandidate[]).find((candidate) => candidate.id === original.selectedCandidateId);
    const frozenCandidates = Array.isArray(original.candidates) ? original.candidates as Array<{ candidateId: string; manifestHash: string; manifestRevision: number }> : [];
    const frozenDecisionCandidate = frozenCandidates.find((item) => item.candidateId === original.selectedCandidateId);
    if (!eligibility?.eligible || !candidate || !originalCandidate || candidate.manifestHash !== originalCandidate.manifestHash
      || candidate.manifestRevision !== originalCandidate.manifestRevision || !frozenDecisionCandidate
      || candidate.manifestHash !== frozenDecisionCandidate.manifestHash || candidate.manifestRevision !== frozenDecisionCandidate.manifestRevision) throw new ConflictException('Selected capability is no longer usable; explicit re-resolution required');
    return { row, requirement, candidate };
  }

  private findRequest(userId: string, key: string) {
    return this.db.select().from(capabilityResolutionDecisions)
      .where(and(eq(capabilityResolutionDecisions.userId, userId), eq(capabilityResolutionDecisions.requestKey, key)))
      .limit(1).then((rows) => rows[0]);
  }

  private replay(row: typeof capabilityResolutionDecisions.$inferSelect, requestHash: string) {
    if (row.requestHash !== requestHash) throw new ConflictException('Resolution request key reused with different input');
    return row;
  }

  private async collectCandidates(userId: string, input: ResolutionInput, now: Date): Promise<Array<ResolutionCandidate & {runtimeTargetBinding?: RuntimeTargetActionBinding}>> {
    const rows = await this.db.select({ connection: connections, providerKey: connectors.key }).from(connections)
      .innerJoin(connectors, eq(connectors.id, connections.connectorId)).where(eq(connections.userId, userId));
    const candidates: Array<ResolutionCandidate & {runtimeTargetBinding?: RuntimeTargetActionBinding}> = [];
    const nativeCapability=canonicalCapabilityId(input.requirement.capabilityKey);
    if (nativeCapability && ['calendar.event.create','calendar.event.update','calendar.event.delete'].includes(nativeCapability)) {
      await this.targets.refresh(userId);
      const targets = await this.db.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),eq(runtimeTargets.targetType,'ANDROID_DEVICE')));
      for (const target of targets) {
        const device = (await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id,target.backingRef),eq(trustedDevices.userId,userId))))[0];
        const grant = (await this.db.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.trustedDeviceId,target.backingRef),eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.capability,'calendar.'+nativeCapability.slice('calendar.event.'.length)))))[0];
        const binding: RuntimeTargetActionBinding = {targetType:'ANDROID_DEVICE',targetId:target.id,trustedDeviceId:target.backingRef,authorityEpoch:target.authorityEpoch,targetManifestHash:target.manifestHash};
        candidates.push({id:runtimeTargetCandidateId(binding,nativeCapability),providerKey:'android_calendar',runtimeTargetBinding:binding,
          manifestRevision:1,manifestHash:hash(binding),capability:{...candidateCapability({key:nativeCapability,name:'Android Calendar '+nativeCapability.slice('calendar.event.'.length),resource:'CalendarEvent',operation:'execute',riskLevel:'R3',sourceModes:['OS_API']}),
            officialAvailability:'AVAILABLE',implementationStatus:'PRODUCTION',reviewStatus:'NOT_REQUIRED',androidPermissions:['android.permission.READ_CALENDAR','android.permission.WRITE_CALENDAR'],
            dataBoundary:{resources:['CalendarEvent'],readableFields:nativeCapability==='calendar.event.create'?['title','start','end','calendarId']:['title','start','end','calendarId','eventId'],writableFields:nativeCapability==='calendar.event.create'?['title','start','end','calendarId']:['title','start','end','calendarId','eventId'],purpose:['user_authorized_calendar_automation']},
            verificationMethods:['OPERATION_LOOKUP'],sideEffectContract:{sideEffect:true,supportsIdempotencyKey:false,supportsOperationLookup:true,retrySafety:'unsafe'}},
          connectionReady:!!device&&device.status==='active'&&!device.revokedAt&&target.health!=='UNAVAILABLE',grantSatisfied:!!grant&&grant.userGrant&&grant.systemPermission==='GRANTED',
          healthUsable:!!grant&&grant.health==='HEALTHY'&&grant.checkedAt<=now&&now.getTime()-grant.checkedAt.getTime()<=60000,
          accountSatisfied:true,deviceSatisfied:!!device&&device.status==='active',explicitlyDenied:false,reality:grant?.evidenceRef?'OBSERVED':'CLAIMED',
          observedAt:grant?.checkedAt.toISOString()??null,costMicros:0,latencyMs:null,reliability:null});
      }
    }
    for (const row of rows) {
      const manifest = this.manifests.list().find((item) => item.providerKey === row.providerKey);
      if (!manifest) continue;
      const grants = await this.db.select().from(connectionCapabilityGrants).where(eq(connectionCapabilityGrants.connectionId, row.connection.id));
      const health = await this.db.select().from(providerCapabilityHealth).where(eq(providerCapabilityHealth.connectionId, row.connection.id));
      for (const capability of manifest.capabilities.filter((item) => sameCapabilityIdentity(item.key,input.requirement.capabilityKey))) {
        const grant = grants.find((item) => item.capabilityKey === capability.key);
        const check = health.find((item) => item.capabilityKey === capability.key);
        const availability = capabilityAvailability({ providerKey: row.providerKey, connection: row.connection, scopes: capability.oauthScopes, grant, health: check, now });
        const evidence = await this.evidence.read(row.providerKey, { userId, connectionId: row.connection.id,
          capabilityKey: capability.key, resource: input.requirement.resource, planVersionId: input.planVersionId });
        candidates.push({ id: `${row.connection.id}:${capability.key}`, providerKey: row.providerKey,
          manifestRevision: manifest.revision, manifestHash: manifest.manifestHash, capability, ...capabilityIdentity(capability.key),
          connectionReady: availability.connectionReady, grantSatisfied: availability.grantSatisfied, healthUsable: availability.healthUsable,
          // Account/device/data-freshness evidence is supplied by future verified provider adapters.
          // A health probe alone is not evidence about account type or resource freshness.
          accountSatisfied: capability.accountTypes.length === 0 || evidence?.accountSatisfied === true,
          deviceSatisfied: evidence?.deviceSatisfied === true || (capability.androidPermissions.length === 0 && !capability.sourceModes.some((mode) => ['APP_READ', 'VISION', 'OS_API', 'NOTIFICATION'].includes(mode))),
          explicitlyDenied: manifest.explicitDenials.includes(capability.key) || capability.explicitDenials.length > 0,
          reality: evidence?.reality ?? 'CLAIMED', observedAt: evidence?.observedAt ?? null,
          costMicros: evidence?.costMicros ?? null, latencyMs: evidence?.latencyMs ?? null, reliability: evidence?.reliability ?? null });
      }
    }
    return candidates;
  }
}
function hash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }

type ResolutionInput = Omit<ResolveCapabilityDto,'planVersionId'> & {planVersionId:string|null;authoritySource?:RuntimeAuthoritySource};
