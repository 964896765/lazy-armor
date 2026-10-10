import { RuntimeAuthorityService, compileUserEventSyncDefinition } from './runtime-authority.service';
import { userEventSyncRequests } from '@lazy-armor/database';
import { confirmedUserEventSyncContractSchema, type RuntimeAuthoritySource, type PlanDefinition } from '@lazy-armor/plan-schema';
import {CapabilityInvocationsService} from '../capability-invocations/capability-invocations.service';
import {RuntimeTargetsService} from '../runtime-targets/runtime-targets.service';
import {actionMatchesResolution} from '@lazy-armor/plan-schema';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {ModuleRef} from '@nestjs/core';
import { conversationOnceRequests, actionIntents, actionAdapterBindings, connectors, executionSteps, executions, planActions, planTriggers, plans, strategyRuntimeBindings, strategyRuntimeWakeups,planCreationContracts,localCapabilityStates,trustedDevices } from '@lazy-armor/database';
import { ACTION_ADAPTER_REVISION, TERMINAL_FOLLOW_UP_RULES, buildActionIntent, catalogHash, definitionHash,
  requiresTerminalHandoffProof, riskMaximum, terminalFollowUpRule, buildVerificationContract, verificationContractHash,
  actionResolutionContractHash,localCapabilityAvailability,sameCapabilityIdentity, type ActionResolutionContract, type ContextRiskSignal, type RiskLevel } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { RuntimeTaskScheduler } from '../agent/tasks/task-scheduler.service';
import { materializeTaskGraph } from '../agent/tasks/task-runtime';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionPolicyService } from './execution-policy.service';
import { ExecutionStateService } from './execution-state.service';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { RiskEngine } from '../risk/risk-engine.service';
import { SafetyPolicyService } from '../risk/safety-policy.service';
import { RISK_SCORE } from '../risk/risk.types';
import { CapabilityResolverService } from '../capability-resolver/capability-resolver.service';
import { TerminalHandoffGuard, type TerminalHandoffProof } from '../strategy-runtime/terminal-handoff-guard.service';
import { TruthHandoffGuard, type HandoffTransaction, type TruthHandoffProof } from '../strategy-runtime/truth-handoff-guard.service';
import { VerificationPolicyRegistry } from './verification-policy-registry.service';
import { isGithubDigestDefinition } from '@lazy-armor/plan-schema';

export function requiresServerOwnedTerminalHandoff(actions: readonly { config: Record<string, unknown> }[]): boolean {
  return actions.some((action) => action.config.templateKey==='notification.shipment-watch.v1'||requiresTerminalHandoffProof(action.config)
    || TERMINAL_FOLLOW_UP_RULES.some((rule) => action.config.templateKey === rule.key));
}

@Injectable()
export class ExecutionDispatchService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly invocations:CapabilityInvocationsService,
    private readonly targets:RuntimeTargetsService,
    private readonly assembler: PlanDefinitionAssembler,
    private readonly queue: RuntimeTaskScheduler,
    private readonly policy: ExecutionPolicyService,
    private readonly states: ExecutionStateService,
    private readonly events: ExecutionEventService,
    private readonly sanitizer: SnapshotSanitizer,
    private readonly riskEngine: RiskEngine,
    private readonly safetyPolicies: SafetyPolicyService,
    private readonly audit: AuditService,
    private readonly resolver: CapabilityResolverService,
    private readonly terminalGuard: TerminalHandoffGuard,
    private readonly truthGuard: TruthHandoffGuard,
    private readonly moduleRef:ModuleRef,
    private readonly verificationPolicies: VerificationPolicyRegistry,
    private readonly authority: RuntimeAuthorityService,
  ) {}

  async dispatchManual(userId: string, planId: string, requestId: string, triggerPayload: Record<string, unknown>, resolutionDecisionIds?: string[], expectedVersionId?: string) {
    if (requestId.startsWith('strategy:') || requestId.startsWith('github-schedule:')) throw new ConflictException('Scheduled execution identity is server-owned');
    return this.dispatch(userId, planId, requestId, triggerPayload, resolutionDecisionIds, undefined, expectedVersionId);
  }

  async dispatchGithubSchedule(userId: string, planId: string, versionId: string, triggerId: string, scheduledAt: Date) {
    return this.dispatch(userId, planId, `github-schedule:${versionId}:${triggerId}:${scheduledAt.toISOString()}`, {}, undefined, undefined, versionId, undefined, undefined,
      { triggerId, scheduledAt: scheduledAt.toISOString() });
  }

  async dispatchStrategy(userId: string, planId: string, wakeupId: string) {
    // Replay the durable execution before resolving again: a completed side effect
    // must not depend on today's resource freshness or create a second invocation.
    const requestId = `strategy:${wakeupId}`;
    if (await this.findDuplicate(userId, requestId)) return this.dispatch(userId, planId, requestId, {}, undefined, wakeupId);
    const wakeup = (await this.db.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.id,wakeupId),eq(strategyRuntimeWakeups.userId,userId))).limit(1))[0];
    if (!wakeup) throw new NotFoundException('Strategy wakeup not found');
    const actions = await this.db.select().from(planActions).where(eq(planActions.planVersionId,wakeup.planVersionId)).orderBy(asc(planActions.stepOrder));
    const resolutions: string[] = [];
    for (const action of actions.filter(action=>sameCapabilityIdentity(action.requiredCapability??'', 'calendar.event.create'))) {
      const resolved = await this.resolver.resolve(userId, {
        planVersionId:wakeup.planVersionId,requestKey:`${requestId}:resolve:${action.id}:${new Date().toISOString().slice(0,16)}`,
        requirement:{schemaVersion:'1',capabilityKey:'calendar.event.create',resource:'CalendarEvent',operation:'execute',fields:['title','start','end','calendarId'],purpose:'user_authorized_calendar_automation',minimumReality:'OBSERVED',maxAgeSeconds:300,maxRisk:'R3',maxCostMicros:0,preferredProviders:[],preferredSourceModes:[]},
      });
      if (resolved.decisionJson.status !== 'RESOLVED') throw new ConflictException({code:'WAITING_RESOURCE',message:'Scheduled capability requires an available authorized target'});
      resolutions.push(resolved.id);
    }
    return this.dispatch(userId, planId, requestId, {}, resolutions.length ? resolutions : undefined, wakeupId, wakeup.planVersionId);
  }
  async dispatchActionProposal(userId: string, taskId: string, resolutionDecisionIds: string[]) {
    const task = (await this.db.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.id, taskId), eq(conversationOnceRequests.userId, userId))).limit(1))[0];
    if (!task?.proposalMessageId) throw new ConflictException('Confirmed ActionProposal request required');
    const actions = await this.db.select().from(planActions).where(eq(planActions.planVersionId, task.planVersionId));
    for (const action of actions) if (!action.connectionId) await this.resolver.resolveLocalNotification(userId, task.planVersionId, `once:${task.id}:local:${action.id}`);
    return this.dispatch(userId, task.planId, `once:${task.id}`, task.triggerPayload, resolutionDecisionIds, undefined, task.planVersionId, task.id);
  }

  /** Server-owned confirmed source enters the same dispatch, never an ONCE Calendar Plan. */
  async dispatchUserEventSync(userId: string, syncRequestId: string, calendarId: string, expectedTrustedDeviceId?: string) {
    const request = (await this.db.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id,syncRequestId),eq(userEventSyncRequests.userId,userId))))[0];
    if (!request) throw new NotFoundException('Confirmed sync request not found');
    const contract = confirmedUserEventSyncContractSchema.parse(request.contractJson);
    const source: RuntimeAuthoritySource = {kind:'USER_EVENT_SYNC',ownerId:userId,requestId:request.id,userEventId:request.userEventId,userEventVersion:request.userEventVersion,contractHash:request.contractHash};
    const definition = compileUserEventSyncDefinition(contract,calendarId);
    const requestId = `user-event-sync:${syncRequestId}`;
    const prior = await this.findDuplicate(userId,requestId);
    if (prior) {
      if (prior.planId || prior.planVersionId || catalogHash(prior.authoritySourceJson)!==catalogHash(source) || prior.definitionHash!==definitionHash(definition)) throw new ConflictException('Authority execution replay identity mismatch');
      return this.replayResolved(prior,null);
    }
    const targetSnapshot=await this.targets.refresh(userId);
    const capability=definition.actions[0].requiredCapability!;
    const fields=contract.schema==='user-event-sync-confirmation.v1'?['title','start','end','calendarId']:contract.operation==='DELETE'?['calendarId','eventId']:['title','start','end','calendarId','eventId'];
    const availabilityRevision=catalogHash(targetSnapshot.map(target=>({id:target.targetId,epoch:target.authorityEpoch,manifest:target.manifestHash,health:target.health,online:target.onlineState})).sort((a,b)=>a.id.localeCompare(b.id)));
    const resolutionRevision=catalogHash({minute:new Date().toISOString().slice(0,16),availabilityRevision}).slice(0,32);
    const resolution = await this.resolver.resolveForSource(userId,source,`${requestId}:resolve:${resolutionRevision}`,{schemaVersion:'1',capabilityKey:capability,resource:'CalendarEvent',operation:'execute',fields,purpose:'user_authorized_calendar_automation',minimumReality:'OBSERVED',maxAgeSeconds:300,maxRisk:'R3',maxCostMicros:0,preferredProviders:['android_calendar'],preferredSourceModes:['OS_API']});
    if (resolution.decisionJson.status !== 'RESOLVED') throw new ConflictException({code:'WAITING_RESOURCE',message:'Confirmed sync requires an available authorized resource'});
    if (expectedTrustedDeviceId) {
      const checked=await this.resolver.revalidate(userId,resolution.id);
      if (checked.candidate.runtimeTargetBinding?.trustedDeviceId !== expectedTrustedDeviceId) throw new ConflictException('SYNC_SOURCE_TARGET_DEVICE_MISMATCH');
      if (contract.schema==='user-event-sync-confirmation.v2' && checked.candidate.runtimeTargetBinding?.targetId!==contract.externalIdentity.targetId) throw new ConflictException('SYNC_MUTATION_TARGET_MISMATCH');
    }
    return this.dispatch(userId,null,requestId,{},[resolution.id],undefined,undefined,undefined,{source,definition});
  }

  private async dispatch(userId: string, planId: string | null, requestId: string, triggerPayload: Record<string, unknown>, resolutionDecisionIds?: string[], wakeupId?: string, expectedVersionId?: string, onceTaskId?: string, sourceBundle?: {source:RuntimeAuthoritySource;definition:PlanDefinition}, githubSchedule?: { triggerId: string; scheduledAt: string }) {
    const resolvedDispatchInputHash = resolutionDecisionIds ? catalogHash({ planId, requestId, ...(sourceBundle ? {authoritySource:sourceBundle.source} : {}), triggerPayload: this.sanitizer.sanitize(triggerPayload), resolutionDecisionIds: [...resolutionDecisionIds].sort() }) : null;
    const duplicate = await this.findDuplicate(userId, requestId);
    if (duplicate) {
      if (sourceBundle && (catalogHash(duplicate.authoritySourceJson)!==catalogHash(sourceBundle.source)||duplicate.definitionHash!==definitionHash(sourceBundle.definition))) throw new ConflictException('Authority replay identity mismatch');
      if (duplicate.planId !== planId || (expectedVersionId && duplicate.planVersionId !== expectedVersionId)) throw new ConflictException('Execution request identity does not match the selected plan version');
      if (wakeupId && (duplicate.planId !== planId || strategyProofWakeupId(duplicate.resolvedRiskSnapshotJson) !== wakeupId)) throw new ConflictException('Strategy execution identity conflict');
      return this.replayResolved(duplicate, resolvedDispatchInputHash);
    }
    if(resolutionDecisionIds?.length)await this.targets.refresh(userId);
    const resolutions = resolutionDecisionIds ? await Promise.all(resolutionDecisionIds.map((resolutionId) => this.resolver.revalidate(userId, resolutionId))) : [];
    if (new Set(resolutionDecisionIds).size !== (resolutionDecisionIds?.length ?? 0)) throw new ConflictException('Duplicate resolution decision');
    const id = newId();
    const now = new Date();
    let triggerSnapshot = this.sanitizer.sanitize(triggerPayload);
    let terminalHandoffProof: TerminalHandoffProof | undefined;
    let truthHandoffProof: TruthHandoffProof | undefined;
    let pinnedVersionId: string | null = null;
    try {
      await this.db.transaction(async (tx) => {
        if (sourceBundle) {
          if (planId || wakeupId || onceTaskId || expectedVersionId) throw new ConflictException('Authority source cannot carry Plan dispatch authority');
          await this.authority.assertCurrent(tx,sourceBundle.source,{userId,planId:null,planVersionId:null});
        } else {
          if (!planId) throw new ConflictException('Plan authority required');
        const planRows = await tx.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1).for('update');
        const plan = planRows[0];
        if (!plan) throw new NotFoundException('Plan not found');
        if (plan.executionScope === 'ONCE') {
          const task = onceTaskId ? (await tx.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.id, onceTaskId), eq(conversationOnceRequests.userId, userId))).for('update'))[0] : null;
          if (!task?.proposalMessageId || task.planId !== planId || task.planVersionId !== plan.currentVersionId || requestId !== `once:${task.id}` || plan.status !== 'draft') throw new ConflictException('One-time execution requires the frozen confirmed proposal');
          pinnedVersionId = task.planVersionId;
        } else {
          if (onceTaskId || plan.status !== 'active') throw new ConflictException('Only active plans can create Executions');
          if (!plan.activeVersionId) throw new ConflictException('Plan has no active version');
          pinnedVersionId = plan.activeVersionId;
        }
        if (expectedVersionId && pinnedVersionId !== expectedVersionId) throw new ConflictException('Plan version changed after confirmation; select the current version again');
        const sourceContract=(await tx.select().from(planCreationContracts).where(and(eq(planCreationContracts.userId,userId),eq(planCreationContracts.planVersionId,pinnedVersionId))).limit(1).for('update'))[0];
        if(sourceContract){
          const facts=sourceContract.factDemandsJson as Array<{demandId:string;factKey:string}>;
          const selected=sourceContract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null}>;
          const pins=Object.fromEntries(selected.map(source=>[source.factKey??facts.find(fact=>fact.demandId===source.demandId)?.factKey??source.demandId,source.selectedSourceId]));
          const {FactDemandResolverService}=await import('../fact-demands/fact-demand-resolver.service');
          const current=await this.moduleRef.get(FactDemandResolverService,{strict:false}).resolve(userId,{scenarioKey:sourceContract.scenarioKey,scenarioRevision:sourceContract.scenarioRevision,goal:sourceContract.goalJson as never,subject:sourceContract.subjectJson as never},pins);
          if(current.contractHash!==sourceContract.contractHash||current.demands.some(demand=>demand.required&&(!demand.sourceCurrentlyUsable||demand.state!=='SATISFIED')))throw new ConflictException('Frozen plan sources or required Truth need reconfirmation');
          for(const demand of current.demands.filter(demand=>demand.required)){
            const source=demand.selectedSource;
            if(source?.kind!=='NATIVE_DEVICE'&&source?.kind!=='TRUSTED_DEVICE')continue;
            if(!source.trustedDeviceId)throw new ConflictException('Frozen device source unavailable');
            const device=(await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id,source.trustedDeviceId),eq(trustedDevices.userId,userId))).limit(1).for('update'))[0];
            const capability=source.kind==='NATIVE_DEVICE'?'calendar.read':'notification.read';
            const grant=(await tx.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,source.trustedDeviceId),eq(localCapabilityStates.capability,capability))).limit(1).for('update'))[0];
            if(!device||device.status!=='active'||device.revokedAt||!grant||localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE')throw new ConflictException('Frozen device grant changed before execution');
          }
          await this.audit.append({actorType:'system',userId,action:'PLAN_FROZEN_SOURCES_REVALIDATED',resourceType:'plan_version',resourceId:pinnedVersionId,correlationId:id,source:'system',result:'success',after:{contractId:sourceContract.id,sourcePins:pins,truthVersionIds:current.demands.flatMap(demand=>demand.truthEvidence.filter(truth=>truth.verified).map(truth=>truth.truthVersionId))},changeSummary:'Existing dispatch revalidated frozen sources and required Truth before canonical Risk and Execution'},tx);
        }
        }
        const handoff = wakeupId && planId ? await this.resolveHandoff(userId, planId, wakeupId, tx) : undefined;
        if (handoff) {
          if ('triggerPayload' in handoff) {
            terminalHandoffProof = handoff.proof as TerminalHandoffProof;
            triggerSnapshot = this.sanitizer.sanitize((handoff as { triggerPayload: Record<string, unknown> }).triggerPayload);
          } else {
            truthHandoffProof = handoff.proof as TruthHandoffProof;
          }
        }
        if (resolutions.some((resolution) => resolution.row.planVersionId !== pinnedVersionId || resolution.requirement.operation !== 'execute')) throw new ConflictException('Resolution must authorize an execute capability on the active PlanVersion');
        const assembled = sourceBundle ? {definition:sourceBundle.definition,computedHash:definitionHash(sourceBundle.definition),version:{definitionHash:definitionHash(sourceBundle.definition)}} : (planId && pinnedVersionId ? await this.assembler.assembleById(userId, planId, pinnedVersionId, tx) : null);
        if (!assembled) throw new ConflictException('Runtime authority definition required');
        if (githubSchedule) {
          const trigger = (await tx.select().from(planTriggers).where(and(eq(planTriggers.id, githubSchedule.triggerId), eq(planTriggers.planVersionId, pinnedVersionId!))))[0];
          if (!isGithubDigestDefinition(assembled.definition) || trigger?.triggerType !== 'schedule' || trigger.configJson.cronExpression !== '0 9 * * *' || trigger.configJson.timezone !== 'Asia/Shanghai') throw new ConflictException('Invalid GitHub schedule');
          triggerSnapshot = { dispatchOrigin: 'SCHEDULE', scheduledAt: githubSchedule.scheduledAt, triggerId: githubSchedule.triggerId };
        }
        if (onceTaskId && (assembled.definition.triggers.some(trigger => trigger.triggerType !== 'manual') || assembled.definition.approvalPolicy?.type !== 'always')) throw new ConflictException('One-time proposal must retain manual trigger and per-run approval');
        if (assembled.computedHash !== assembled.version.definitionHash) throw new ConflictException('PLAN_DEFINITION_INTEGRITY_ERROR');
        const requiresHandoff = requiresServerOwnedTerminalHandoff(assembled.definition.actions);
        if (!handoff && requiresHandoff) {
          throw new ConflictException('Registered terminal actions require a server-owned Truth handoff');
        }
        const actionRows = sourceBundle ? assembled.definition.actions.map(action=>({id:null,actionType:action.actionType,stepOrder:action.stepOrder,connectorId:null,connectionId:null,requiredCapability:action.requiredCapability,riskLevel:'R3',configJson:action.config})) : (pinnedVersionId ? await tx.select().from(planActions).where(eq(planActions.planVersionId, pinnedVersionId)).orderBy(asc(planActions.stepOrder)) : []);
        if (actionRows.length !== assembled.definition.actions.length) throw new ConflictException('PLAN_DEFINITION_INTEGRITY_ERROR');
        if (resolutions.some((resolution) => !actionRows.some((action) => actionMatchesResolution(action,resolution.candidate)))) throw new ConflictException('Resolution is not used by this PlanVersion');
        const riskSnapshots = await Promise.all(assembled.definition.actions.map((action, index) => this.riskEngine.evaluate(action, actionRows[index]!.riskLevel as RiskLevel, triggerSnapshot, actionRows[index]!.connectorId, tx, pinnedVersionId,
          resolutions.find((item) => actionMatchesResolution(actionRows[index]!,item.candidate))?.candidate.capability.riskLevel ?? 'R0')));
        for (const [index, snapshot] of riskSnapshots.entries()) {
          const row = actionRows[index]!;
          const resolution = resolutions.find((item) => actionMatchesResolution(row,item.candidate));
          if (resolution && RISK_SCORE[snapshot.effectiveRisk] > RISK_SCORE[resolution.requirement.maxRisk]) throw new ConflictException('Action context exceeds the resolved maximum risk');
        }
        const risk = riskSnapshots.reduce<RiskLevel>((highest, snapshot) => RISK_SCORE[snapshot.effectiveRisk] > RISK_SCORE[highest] ? snapshot.effectiveRisk : highest, 'R0');
        const approvalPolicy = this.safetyPolicies.resolveFromDefinition(assembled.definition.approvalPolicy);
        await tx.insert(executions).values({
          id, userId, planId, planVersionId: pinnedVersionId, ...(sourceBundle?{authoritySourceJson:sourceBundle.source as unknown as Record<string,unknown>,definitionSnapshotJson:sourceBundle.definition as unknown as Record<string,unknown>} : {}), definitionHash: definitionHash(assembled.definition), requestId,
          retryOfExecutionId: null, triggerType: 'manual', triggerPayloadJson: triggerSnapshot, status: 'created',
          declaredRiskLevel: risk, approvalStatus: 'not_requested', executionPolicyVersion: this.policy.current.version,
          resolvedRetryPolicyJson: this.policy.retry as unknown as Record<string, unknown>, resolvedFallbackPolicyJson: this.policy.fallback as unknown as Record<string, unknown>,
          riskPolicyVersion: riskSnapshots[0]?.policyVersion ?? 'p0-6-risk-v1',
          resolvedRiskSnapshotJson: this.sanitizer.sanitize({ steps: riskSnapshots, actionIntentSchemaVersion: '1', ...(resolvedDispatchInputHash ? { resolvedDispatchInputHash } : {}), ...(terminalHandoffProof ? { terminalHandoffProof } : {}), ...(truthHandoffProof ? { truthHandoffProof } : {}) }) as Record<string, unknown>,
          resolvedApprovalPolicyJson: approvalPolicy as unknown as Record<string, unknown>,
          resultCode: null, resultSummary: null, errorCode: null, errorMessage: null, cancellationRequestedAt: null,
          queuedAt: null, startedAt: null, finishedAt: null, workerToken: null, heartbeatAt: null, leaseExpiresAt: null, createdAt: now, updatedAt: now,
        });
        for (const [index, action] of assembled.definition.actions.entries()) {
          const row = actionRows[index];
          const riskSnapshot = riskSnapshots[index];
          if (!row || !riskSnapshot || row.stepOrder !== action.stepOrder || row.actionType !== action.actionType) throw new ConflictException('PLAN_DEFINITION_INTEGRITY_ERROR');
          const intentId = newId();
          const resolution = resolutions.find((item) => sameCapabilityIdentity(item.requirement.capabilityKey,row.requiredCapability??'') && actionMatchesResolution(row,item.candidate));
          if (!row.connectionId && row.requiredCapability && !resolution) throw new ConflictException('RuntimeTarget action requires an explicit current resolution');
          if (resolutionDecisionIds && row.requiredCapability && !resolution) throw new ConflictException('Resolved action must match its immutable Connection and Capability');
          if (resolution && typeof action.config.resource === 'string' && resolution.requirement.resource !== action.config.resource) throw new ConflictException('Resolution resource does not match action semantics');
          const intent = buildActionIntent({ intentId, planVersionId: pinnedVersionId, planActionId: row.id, actionType: action.actionType,
            capabilityKey: row.requiredCapability, resourceType: resolution?.requirement.resource ?? (typeof action.config.resource === 'string' ? action.config.resource : action.actionType),
            target: { ...(sourceBundle?{authoritySource:sourceBundle.source}:{}), connectorId: row.connectorId, connectionId: row.connectionId, capabilityResolutionDecisionId: resolution?.row.id ?? null, capabilityResolutionDecisionHash: resolution?.row.decisionHash ?? null,
              ...(resolution?.candidate.runtimeTargetBinding ? {runtimeTargetBinding:resolution.candidate.runtimeTargetBinding} : {}) },
            payload: { actionConfig: action.config, triggerPayload: triggerSnapshot }, desiredOutcome: 'Complete ' + action.actionType + ' and record its result',
            sideEffectKey: 'execution:' + id + ':action:' + (row.id ?? row.stepOrder), providerRiskFloor: riskSnapshot.capabilityRisk ?? 'R0',
            scenarioRiskFloor: riskSnapshot.scenarioRisk ?? 'R0', actionRisk: riskMaximum(riskSnapshot.registryRisk, riskSnapshot.declaredRisk),
            contextSignals: riskSnapshot.factors.map((factor) => ({ code: factorCode(factor), floor: riskSnapshot.dynamicRisk })) });
          if (intent.effectiveRisk !== riskSnapshot.effectiveRisk) throw new ConflictException('ACTION_INTENT_RISK_MISMATCH');
          await tx.insert(actionIntents).values({ id: intentId, userId, planId, planVersionId: pinnedVersionId, planActionId: row.id, executionId: id,
            schemaVersion: intent.schemaVersion, actionType: intent.actionType, capabilityKey: intent.capabilityKey, resourceType: intent.resourceType,
            targetJson: intent.target, payloadJson: intent.payload, payloadHash: intent.payloadHash, desiredOutcome: intent.desiredOutcome,
            sideEffectKey: intent.sideEffectKey, providerRiskFloor: intent.providerRiskFloor, scenarioRiskFloor: intent.scenarioRiskFloor,
            actionRisk: intent.actionRisk, contextRiskElevation: intent.contextRiskElevation, effectiveRiskLevel: intent.effectiveRisk,
            contextSignalsJson: intent.contextSignals as unknown as Record<string, unknown>[], intentHash: intent.intentHash, status: 'BOUND_TO_EXECUTION', createdAt: now });
          const resolvedConnector = row.connectorId
            ? (await tx.select({ key: connectors.key }).from(connectors).where(eq(connectors.id, row.connectorId)).limit(1))[0]
            : null;
          const providerKey = resolution?.candidate.runtimeTargetBinding ? 'android_calendar' : resolvedConnector?.key ?? action.connectorKey;
          const verificationPolicy = this.verificationPolicies.select(providerKey, row.requiredCapability);
          const verificationContract = buildVerificationContract(providerKey, row.requiredCapability, verificationPolicy);
          const frozenVerificationHash = verificationContractHash(verificationContract);
          const resolutionContract: ActionResolutionContract = {
            ...(resolution?.candidate.runtimeTargetBinding ? {runtimeTargetBinding:resolution.candidate.runtimeTargetBinding} : {}),
            ...(sourceBundle?{authoritySource:sourceBundle.source}:{}),
            version: '1', planVersionId: pinnedVersionId, actionIntentId: intentId, actionIntentHash: intent.intentHash,
            adapterRevision: ACTION_ADAPTER_REVISION, adapterKey: 'existing-runner:' + action.actionType,
            connectorId: row.connectorId, connectionId: row.connectionId, capabilityKey: row.requiredCapability,
            capabilityResolutionDecisionId: resolution?.row.id ?? null,
            capabilityResolutionDecisionHash: resolution?.row.decisionHash ?? null,
            riskInputFingerprint: riskSnapshot.inputFingerprint, effectiveRisk: riskSnapshot.effectiveRisk,
            verificationContractHash: frozenVerificationHash,
          };
          const frozenResolutionHash = actionResolutionContractHash(resolutionContract);
          const adapter = { actionIntentId: intentId, adapterRevision: ACTION_ADAPTER_REVISION,
            adapterKey: 'existing-runner:' + action.actionType, connectorId: row.connectorId, connectionId: row.connectionId, capabilityKey: row.requiredCapability,
            capabilityResolutionDecisionId: resolution?.row.id ?? null, capabilityResolutionDecisionHash: resolution?.row.decisionHash ?? null,
            resolutionContractHash: frozenResolutionHash, verificationContractHash: frozenVerificationHash };
          await tx.insert(actionAdapterBindings).values({ id: newId(), ...adapter,
            resolutionContractJson: resolutionContract as unknown as Record<string, unknown>,
            verificationPolicyKey: verificationPolicy.key, verificationPolicyRevision: verificationPolicy.revision,
            verificationPolicyHash: verificationContract.policyHash,
            verificationContractJson: verificationContract as unknown as Record<string, unknown>,
            bindingHash: catalogHash(adapter), status: 'BOUND', createdAt: now });
          if(resolution)await this.invocations.bindExecution(tx,userId,intentId);
          await tx.insert(executionSteps).values({
            id: newId(), executionId: id, planActionId: row.id, actionIntentId: intentId, stepOrder: row.stepOrder, actionType: row.actionType,
            connectorId: row.connectorId, connectionId: row.connectionId, requiredCapability: row.requiredCapability,
            declaredRiskLevel: row.riskLevel, effectiveRiskLevel: riskSnapshot.effectiveRisk,
            riskSnapshotJson: this.sanitizer.sanitize(riskSnapshot) as Record<string, unknown>, inputFingerprint: riskSnapshot.inputFingerprint,
            approvalGateStatus: RISK_SCORE[riskSnapshot.effectiveRisk] >= RISK_SCORE.R2 ? 'not_requested' : 'not_required',
            status: 'pending', attemptCount: 0, retryCount: 0,
            inputSnapshotJson: this.sanitizer.sanitize({ triggerPayload: triggerSnapshot, actionConfig: action.config }), outputSnapshotJson: null,
            nextRetryAt: null, startedAt: null, finishedAt: null, errorCode: null, errorMessage: null, fallbackResultJson: null,
            createdAt: now, updatedAt: now,
          });
        }
        await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'EXECUTION_CREATED', resourceType: 'execution', resourceId: id, userId, executionId: id, requestId, correlationId: requestId, changeSummary: planId ? `Execution created for plan ${planId}` : `Execution created for controlled USER_EVENT_SYNC source`, source: 'api', result: 'success' }, tx);
        await materializeTaskGraph(tx, id);
        if (handoff) await tx.update(strategyRuntimeWakeups).set({ handoffStatus: 'DISPATCHED', handoffExecutionId: id, handoffReason: null })
          .where(and(eq(strategyRuntimeWakeups.id, wakeupId!), eq(strategyRuntimeWakeups.userId, userId)));
        handoff?.assertCurrent(); // Final deadline barrier; the Execution and ActionIntents roll back together.
      });
    } catch (error) {
      const raced = await this.findDuplicate(userId, requestId);
      if (raced) {
        if (sourceBundle && (catalogHash(raced.authoritySourceJson)!==catalogHash(sourceBundle.source)||raced.definitionHash!==definitionHash(sourceBundle.definition))) throw new ConflictException('Authority replay identity mismatch');
        if (raced.planId !== planId || (expectedVersionId && raced.planVersionId !== expectedVersionId)) throw new ConflictException('Execution request identity does not match the selected plan version');
        if (wakeupId && (raced.planId !== planId || strategyProofWakeupId(raced.resolvedRiskSnapshotJson) !== wakeupId)) throw new ConflictException('Strategy execution identity conflict');
        return this.replayResolved(raced, resolvedDispatchInputHash);
      }
      throw error;
    }
    await this.events.append(id, 'execution_created', { triggerType: githubSchedule ? 'schedule' : 'manual', planVersionId: pinnedVersionId });
    try {
      await this.enqueue(id);
    } catch (error) {
      await this.events.append(id, 'queue_enqueue_failed', { message: this.sanitizer.sanitizeText(error) });
    }
    return this.getRow(userId, id);
  }

  private async resolveHandoff(userId: string, planId: string, wakeupId: string, tx: HandoffTransaction) {
    const row = (await tx.select({ binding: strategyRuntimeBindings }).from(strategyRuntimeWakeups)
      .innerJoin(strategyRuntimeBindings, eq(strategyRuntimeBindings.id, strategyRuntimeWakeups.bindingId))
      .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId))).limit(1))[0];
    const isTerminal = row ? Boolean(terminalFollowUpRule(row.binding.scenarioKey, row.binding.scenarioRevision)) : false;
    return isTerminal
      ? this.terminalGuard.lock(userId, planId, wakeupId, tx)
      : this.truthGuard.lockTruth(userId, planId, wakeupId, tx);
  }

  async enqueue(executionId: string) {
    await this.queue.enqueueExecution(executionId);
    const rows = await this.db.select({ status: executions.status }).from(executions).where(eq(executions.id, executionId)).limit(1);
    if (rows[0]?.status === 'created' || rows[0]?.status === 'retry_wait') {
      await this.states.transition(executionId, 'queued', { queuedAt: new Date() });
    }
    await this.events.append(executionId, 'execution_queued', { jobId: executionId });
  }

  private async findDuplicate(userId: string, requestId: string) {
    const rows = await this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.requestId, requestId))).limit(1);
    return rows[0] ?? null;
  }

  private replayResolved(row: typeof executions.$inferSelect, inputHash: string | null) {
    if (inputHash && row.resolvedRiskSnapshotJson?.resolvedDispatchInputHash !== inputHash) throw new ConflictException('Resolved execution request key reused with different input');
    return row;
  }

  private async getRow(userId: string, id: string) {
    const rows = await this.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Execution not found');
    return rows[0];
  }
}

function factorCode(factor: string): ContextRiskSignal['code'] {
  const codes: Record<string, ContextRiskSignal['code']> = { sensitive_or_account_permission: 'ACCOUNT_PERMISSION_CHANGE', public_visibility: 'PUBLIC_VISIBILITY',
    irreversible: 'IRREVERSIBLE', large_batch: 'LARGE_BATCH', high_amount: 'HIGH_AMOUNT', monetary_action: 'MONETARY_ACTION' };
  return codes[factor] ?? 'SENSITIVE_DATA';
}

/** Both existing authenticated handoff paths share the same replay fence. */
export function strategyProofWakeupId(snapshot: Record<string, unknown> | null): string | undefined {
  const terminal=snapshot?.terminalHandoffProof as TerminalHandoffProof|undefined;
  const truth=snapshot?.truthHandoffProof as TruthHandoffProof|undefined;
  if(terminal&&truth&&terminal.wakeupId!==truth.wakeupId)return undefined;
  return terminal?.wakeupId??truth?.wakeupId;
}
