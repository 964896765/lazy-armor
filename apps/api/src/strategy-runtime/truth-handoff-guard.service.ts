import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  plans, planVersions, strategyRuntimeBindings, strategyRuntimeDecisions, strategyRuntimeWakeups,
  truthFactDependencies, truthRecords, truthRecordVersions,planCreationContracts,truthProvenance,sourceObservations,localCapabilityStates,trustedDevices,deviceAppConnections,appReadSessions,appReadSessionEvents,mobileNotificationReceipts,candidateFacts,
} from '@lazy-armor/database';
import { catalogHash, realityValueHash,localCapabilityAvailability,normalizeLocalSourceId,notificationWatchAuthoringSchema, type CompiledStrategyRuntime } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { lockNotificationReceiptSource, type NotificationReceiptSourceProof } from './notification-receipt-source.guard';

export type HandoffTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

/**
 * Common truth-boundary proof. It never stores the fact value; the execution
 * context is hydrated server-side from truthVersionId, never from this proof.
 */
export interface TruthHandoffProof {
  schema: 'truth-handoff.v1';
  wakeupId: string;
  bindingId: string;
  decisionId: string;
  decisionHash: string;
  planVersionId: string;
  definitionHash: string;
  runtimeHash: string;
  truthRecordId: string;
  truthVersionId: string;
  truthValueHash: string;
  factKey: string;
  resourceType: string;
  subjectKey: string;
  observedAt: string;
  evidenceHash: string;
  notificationSourceProof?: NotificationReceiptSourceProof & { receiptId: string; observationId: string; payloadHash: string };
}

const TRUTH_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Authorization-only common truth boundary. Terminal handoff composes this with
 * the OAuth / Connection / Grant / Credential / Health chain; mobile/internal
 * handoff uses it directly without fabricating an OAuth provider.
 */
@Injectable()
export class TruthHandoffGuard {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async lockTruth(userId: string, planId: string, wakeupId: string, tx: HandoffTransaction, expected?: TruthHandoffProof) {
    let boundary = 'PLAN';
    const reject = (): never => { throw new ForbiddenException({ code: 'TRUTH_HANDOFF_NOT_AUTHORIZED', message: `Truth handoff denied: ${boundary}` }); };
    const plan = (await tx.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1).for('update'))[0];
    if (!plan || plan.status !== 'active' || !plan.activeVersionId) return reject();
    boundary = 'WAKEUP_BINDING';
    const wakeup = (await tx.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId), eq(strategyRuntimeWakeups.planVersionId, plan.activeVersionId))).limit(1).for('update'))[0];
    const binding = wakeup && (await tx.select().from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.id, wakeup.bindingId), eq(strategyRuntimeBindings.userId, userId), eq(strategyRuntimeBindings.planVersionId, plan.activeVersionId))).limit(1))[0];
    if (!wakeup || !binding || (wakeup.triggerMode !== 'FACT_CHANGED' && wakeup.triggerMode !== 'SCHEDULE')) return reject();
    boundary = 'PLAN_VERSION_INTEGRITY';
    const version = (await tx.select().from(planVersions).where(eq(planVersions.id, plan.activeVersionId)).limit(1))[0];
    const runtime = binding.runtimeJson as unknown as CompiledStrategyRuntime;
    if (!version || binding.runtimeHash !== runtime.runtimeHash) return reject();
    boundary = 'DEPENDENCY_DECISION_INTEGRITY';
    const dependency = runtime.dependencies.find((item) => item.factKey === wakeup.factKey && item.resourceType === wakeup.resourceType);
    const index = dependency && (await tx.select().from(truthFactDependencies).where(and(
      eq(truthFactDependencies.bindingId, binding.id),
      eq(truthFactDependencies.userId, userId),
      eq(truthFactDependencies.planVersionId, version.id),
      eq(truthFactDependencies.factKey, wakeup.factKey),
      eq(truthFactDependencies.resourceType, wakeup.resourceType),
      eq(truthFactDependencies.scope, dependency.scope),
      ...(dependency.scope === 'EXACT_SUBJECT' ? [eq(truthFactDependencies.subjectKey, wakeup.subjectKey)] : []),
    )).limit(1))[0];
    const decision = (await tx.select().from(strategyRuntimeDecisions).where(and(eq(strategyRuntimeDecisions.wakeupId, wakeupId), eq(strategyRuntimeDecisions.bindingId, binding.id), eq(strategyRuntimeDecisions.userId, userId))).limit(1))[0];
    if (!index || !decision || decision.result !== 'READY_FOR_PLAN_ENGINE' || decision.conditionDecisionJson.result !== true) return reject();
    boundary = 'CURRENT_TRUTH';
    const truth = (await tx.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecordVersions)
      .innerJoin(truthRecords, and(eq(truthRecords.id, truthRecordVersions.truthRecordId), eq(truthRecords.userId, userId)))
      .where(eq(truthRecordVersions.id, wakeup.truthRecordVersionId)).limit(1).for('update'))[0];
    if (!truth || truth.record.status !== 'verified' || truth.record.revokedAt || truth.record.currentVersionId !== truth.version.id || truth.record.subjectKey !== wakeup.subjectKey || truth.version.valueHash !== realityValueHash(truth.version.valueJson)) return reject();
    boundary='FROZEN_SOURCE';
    let notificationSourceProof: TruthHandoffProof['notificationSourceProof'];
    const sourceContract=(await tx.select().from(planCreationContracts).where(and(eq(planCreationContracts.userId,userId),eq(planCreationContracts.planVersionId,version.id))).limit(1).for('update'))[0];
    if(sourceContract){
      const facts=sourceContract.factDemandsJson as Array<{demandId:string;factKey:string}>;
      const selections=sourceContract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null;selectedSource?:{kind?:string;connectionId?:string|null;trustedDeviceId?:string|null;deviceAppConnectionId?:string|null;truthRecordId?:string|null;truthVersionId?:string|null}}>;
      const selected=selections.find(source=>(source.factKey??facts.find(fact=>fact.demandId===source.demandId)?.factKey)===wakeup.factKey);
      if(!selected?.selectedSourceId||!selected.selectedSource)return reject();
      const evidence=(await tx.select({provenance:truthProvenance,observation:sourceObservations}).from(truthProvenance).leftJoin(sourceObservations,and(eq(sourceObservations.id,truthProvenance.observationId),eq(sourceObservations.userId,userId))).where(eq(truthProvenance.truthRecordVersionId,truth.version.id)).limit(1))[0];
      const source=selected.selectedSource;
      if(source.kind==='NATIVE_DEVICE'){
        const nativeId=evidence?.observation?.payloadJson.nativeSourceId;
        if(typeof nativeId!=='string'||normalizeLocalSourceId(nativeId)!==selected.selectedSourceId||!source.trustedDeviceId)return reject();
        const device=(await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id,source.trustedDeviceId),eq(trustedDevices.userId,userId))).limit(1).for('update'))[0];
        const grant=(await tx.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.trustedDeviceId,source.trustedDeviceId),eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.capability,'calendar.read'))).limit(1).for('update'))[0];
        if(!device||device.status!=='active'||device.revokedAt||!grant||localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE')return reject();
      }else if(source.kind==='PROVIDER_CONNECTION'){
        if(!source.connectionId||evidence?.observation?.connectionId!==source.connectionId)return reject();
      }else if(source.kind==='INTERNAL_FACT'||source.kind==='MANUAL_INPUT'){
        if(source.truthRecordId!==truth.record.id||source.truthVersionId!==truth.version.id)return reject();
      }else if(source.kind==='TRUSTED_DEVICE'){
        if(!source.trustedDeviceId||!source.deviceAppConnectionId||!evidence?.observation)return reject();
        const goal=sourceContract.goalJson as {constraints?:{recipeKey?:string;notificationWatchJson?:string}};
        if(goal.constraints?.recipeKey==='notification.shipment-watch.v1'){
          boundary='NOTIFICATION_RECEIPT_PROVENANCE';
          let parameters;
          try{parameters=notificationWatchAuthoringSchema.parse(JSON.parse(goal.constraints.notificationWatchJson??''));}catch{return reject();}
          if(parameters.connectionId!==source.deviceAppConnectionId||parameters.trustedDeviceId!==source.trustedDeviceId||selected.selectedSourceId!==`device-app:${parameters.connectionId}`||wakeup.factKey!=='shipment.status'||wakeup.resourceType!=='shipment'||!truth.record.sourceReceiptId)return reject();
          const receipt=(await tx.select().from(mobileNotificationReceipts).where(and(eq(mobileNotificationReceipts.id,truth.record.sourceReceiptId),eq(mobileNotificationReceipts.userId,userId),eq(mobileNotificationReceipts.deviceAppConnectionId,parameters.connectionId))).limit(1).for('update'))[0];
          const observation=evidence.observation,provenance=evidence.provenance;
          const candidate=(await tx.select().from(candidateFacts).where(and(eq(candidateFacts.id,provenance.candidateFactId),eq(candidateFacts.userId,userId),eq(candidateFacts.observationId,observation.id),eq(candidateFacts.truthRecordId,truth.record.id))).limit(1).for('update'))[0];
          if(!receipt||receipt.sourcePackage!==parameters.sourcePackage||receipt.status!=='verified'||!receipt.verifiedAt||receipt.postedAt.getTime()>Date.now()+5000||Date.now()-receipt.postedAt.getTime()>parameters.lookbackHours*3600000||receipt.snapshotJson.candidateKind!=='shipment_candidate'||receipt.snapshotJson.candidateResource!=='shipment'||receipt.snapshotJson.parserVersion!=='generic-notification-v1'||truth.record.subjectKey!==receipt.id||truth.record.verifiedBy!=='user_confirmation'||truth.version.verificationMethod!=='user_confirmation_after_device_key_proof'
            ||observation.sourceMode!=='NOTIFICATION'||observation.providerKey!==receipt.sourcePackage||observation.externalEventKey!==receipt.id||observation.status!=='NORMALIZED'||observation.payloadJson.subjectKey!==receipt.id||observation.payloadJson.status!==receipt.snapshotJson.candidateStatus||observation.payloadHash!==realityValueHash(observation.payloadJson)
            ||provenance.sourceMode!==observation.sourceMode||provenance.providerKey!==observation.providerKey||provenance.evidenceHash!==observation.evidenceHash||truth.version.evidenceHash!==observation.evidenceHash
            ||!candidate||candidate.status!=='VERIFIED'||candidate.subjectKey!==receipt.id||candidate.factKey!==wakeup.factKey||candidate.resourceType!==wakeup.resourceType||candidate.valueHash!==realityValueHash(candidate.valueJson)||candidate.valueJson.status!==receipt.snapshotJson.candidateStatus||extractFactValue(truth.version.valueJson).status!==candidate.valueJson.status)return reject();
          const expectedEvidenceHash=createHash('sha256').update(JSON.stringify({receiptId:receipt.id,payloadHash:receipt.payloadHash,candidateResource:'shipment',parserVersion:'generic-notification-v1'})).digest('hex');
          if(expectedEvidenceHash!==observation.evidenceHash)return reject();
          boundary='NOTIFICATION_SOURCE_AUTHORITY';
          let currentSource;
          try{currentSource=await lockNotificationReceiptSource(tx,userId,receipt,expected?.notificationSourceProof?.reobservation);}catch{return reject();}
          if(currentSource.trustedDeviceId!==parameters.trustedDeviceId||currentSource.sourcePackage!==parameters.sourcePackage)return reject();
          notificationSourceProof={...currentSource,receiptId:receipt.id,observationId:observation.id,payloadHash:receipt.payloadHash};
        }else{
        const session=(await tx.select({id:appReadSessions.id}).from(appReadSessions).innerJoin(appReadSessionEvents,and(eq(appReadSessionEvents.sessionId,appReadSessions.id),eq(appReadSessionEvents.observationId,evidence.observation.id),eq(appReadSessionEvents.userId,userId))).where(and(eq(appReadSessions.userId,userId),eq(appReadSessions.deviceAppConnectionId,source.deviceAppConnectionId))).limit(1))[0];
        const device=(await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id,source.trustedDeviceId),eq(trustedDevices.userId,userId))).limit(1).for('update'))[0];
        const app=(await tx.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.id,source.deviceAppConnectionId),eq(deviceAppConnections.userId,userId),eq(deviceAppConnections.trustedDeviceId,source.trustedDeviceId))).limit(1).for('update'))[0];
        const grant=(await tx.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,source.trustedDeviceId),eq(localCapabilityStates.capability,'notification.read'))).limit(1).for('update'))[0];
        if(!session||!device||device.status!=='active'||device.revokedAt||app?.enabled!==1||!app.modesJson.includes('notification_read')||!grant||localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE')return reject();
        }
      }else return reject();
    }
    const valueJson = truth.version.valueJson as Record<string, unknown>;
    const proof: TruthHandoffProof = {
      schema: 'truth-handoff.v1', wakeupId, bindingId: binding.id, decisionId: decision.id, decisionHash: decision.decisionHash,
      planVersionId: version.id, definitionHash: version.definitionHash, runtimeHash: runtime.runtimeHash,
      truthRecordId: truth.record.id, truthVersionId: truth.version.id, truthValueHash: truth.version.valueHash,
      factKey: wakeup.factKey, resourceType: wakeup.resourceType, subjectKey: wakeup.subjectKey,
      observedAt: typeof valueJson.observedAt === 'string' ? valueJson.observedAt : truth.record.verifiedAt.toISOString(),
      evidenceHash: truth.version.evidenceHash,
      ...(notificationSourceProof?{notificationSourceProof}:{}),
    };
    if (expected && catalogHash(expected) !== catalogHash(proof)) return reject();
    const assertCurrent = () => {
      boundary = 'FRESHNESS_DEADLINE'; const now = new Date();
      if (truth.record.verifiedAt > now || now.getTime() - truth.record.verifiedAt.getTime() > TRUTH_HANDOFF_MAX_AGE_MS) reject();
    };
    assertCurrent();
    return { proof, assertCurrent, truthVersionId: truth.version.id, factKey: wakeup.factKey, resourceType: wakeup.resourceType, subjectKey: wakeup.subjectKey };
  }

  /** Execution pre-start revalidation repeats the frozen source boundary as well as Truth. */
  async revalidateTruth(userId: string, proof: TruthHandoffProof): Promise<Record<string, unknown>> {
    return this.db.transaction(async tx=>{
      const version=(await tx.select({planId:planVersions.planId}).from(planVersions).innerJoin(plans,and(eq(plans.id,planVersions.planId),eq(plans.userId,userId))).where(eq(planVersions.id,proof.planVersionId)).limit(1))[0];
      if(!version)throw new ForbiddenException({code:'TRUTH_HANDOFF_NOT_AUTHORIZED',message:'Truth handoff Plan ownership changed'});
      const locked=await this.lockTruth(userId,version.planId,proof.wakeupId,tx,proof);
      const truth=(await tx.select().from(truthRecordVersions).where(eq(truthRecordVersions.id,locked.truthVersionId)).limit(1))[0];
      locked.assertCurrent();
      return truth.valueJson as Record<string,unknown>;
    });
  }
}

/** Extracts the semantic fact value from a Truth version value (compatibility or canonical shape). */
export function extractFactValue(valueJson: Record<string, unknown>): Record<string, unknown> {
  const inner = valueJson && typeof valueJson === 'object' && !Array.isArray(valueJson) ? valueJson : {};
  if (inner.value && typeof inner.value === 'object' && !Array.isArray(inner.value)) return inner.value as Record<string, unknown>;
  const { resource, resourceType, resourceKey, subjectKey, factKey, observedAt, occurredAt, confidence, realityLevel, ...factValue } = inner;
  return factValue as Record<string, unknown>;
}
