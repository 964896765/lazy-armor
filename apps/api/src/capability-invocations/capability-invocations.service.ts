import { ModuleRef } from '@nestjs/core';
import { RuntimeAuthorityService } from '../execution/runtime-authority.service';
import type { RuntimeAuthoritySource } from '@lazy-armor/plan-schema';
import {CapabilityResolverService} from '../capability-resolver/capability-resolver.service';
import {runtimeTargetActionBindingSchema,runtimeTargetCandidateId,type ActionResolutionContract} from '@lazy-armor/plan-schema';
import {ConflictException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {actionIntents,actionAdapterBindings,capabilityInvocations,invocationRuntimeLinks,runtimeTargets,capabilityResolutionDecisions,executions,capabilityAliases} from '@lazy-armor/database';
import {canonicalCapabilityId,canonicalStringify,sameCapabilityIdentity,capabilityInvocationSchema,type CapabilityInvocation} from '@lazy-armor/plan-schema';
import {newId} from '@lazy-armor/shared';
import {createHash} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {DATABASE,type InjectedDatabase} from '../common/database.module';
import {RuntimeTargetsService} from '../runtime-targets/runtime-targets.service';
type Tx=Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
const hash=(x:unknown)=>createHash('sha256').update(canonicalStringify(x)).digest('hex');
@Injectable()
export class CapabilityInvocationsService {
 constructor(@Inject(DATABASE) private readonly db:InjectedDatabase,private readonly targets:RuntimeTargetsService,private readonly resolver:CapabilityResolverService,private readonly modules:ModuleRef){}
 // Called only by existing server-owned dispatch, in the same transaction as the ActionIntent.
 async bindExecution(tx:Tx,userId:string,intentId:string){
  const intent=(await tx.select().from(actionIntents).where(and(eq(actionIntents.id,intentId),eq(actionIntents.userId,userId))).for('update'))[0];if(!intent)throw new NotFoundException('ActionIntent not found');
  const binding=(await tx.select().from(actionAdapterBindings).where(eq(actionAdapterBindings.actionIntentId,intentId)))[0];
  const registeredAlias=intent.capabilityKey?(await tx.select().from(capabilityAliases).where(eq(capabilityAliases.alias,intent.capabilityKey)))[0]:null;
  const capabilityId=canonicalCapabilityId(intent.capabilityKey??'')??registeredAlias?.canonicalId;
  // Legacy unclassified actions retain existing authority chain until explicitly onboarded.
  if(!capabilityId||!binding?.capabilityResolutionDecisionId)return null;
  const nativeRaw=(binding.resolutionContractJson as unknown as ActionResolutionContract)?.runtimeTargetBinding;
  const native=nativeRaw?runtimeTargetActionBindingSchema.parse(nativeRaw):null;
  if(!binding.connectionId&&!native)return null;
  if(native&&(binding.connectionId||binding.connectorId||!['calendar.event.create','calendar.event.update','calendar.event.delete'].includes(capabilityId)))throw new ConflictException('NATIVE_BINDING_SEMANTICS_MISMATCH');
  const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),native?eq(runtimeTargets.id,native.targetId):eq(runtimeTargets.backingRef,binding.connectionId!))).for('update'))[0];if(!target)throw new ConflictException('Registered RuntimeTarget required');if(target.health==='UNAVAILABLE')throw new ConflictException('TARGET_UNAVAILABLE');
  if(native&&(target.targetType!=='ANDROID_DEVICE'||target.backingRef!==native.trustedDeviceId||target.authorityEpoch!==native.authorityEpoch||target.manifestHash!==native.targetManifestHash))throw new ConflictException('STALE_NATIVE_BINDING');
  const resolution=(await tx.select().from(capabilityResolutionDecisions).where(and(eq(capabilityResolutionDecisions.id,binding.capabilityResolutionDecisionId),eq(capabilityResolutionDecisions.userId,userId))))[0];
  const requirement=resolution?.inputJson.requirement as {capabilityKey?:string;operation?:string}|undefined;
  if(!resolution||resolution.planVersionId!==intent.planVersionId||resolution.decisionJson.status!=='RESOLVED'||hash(resolution.decisionJson)!==resolution.decisionHash||!(sameCapabilityIdentity(requirement?.capabilityKey??'',capabilityId)||requirement?.capabilityKey===intent.capabilityKey)||requirement?.operation!=='execute'||resolution.decisionJson.selectedCandidateId!==(native?runtimeTargetCandidateId(native,capabilityId):binding.connectionId+':'+binding.capabilityKey))throw new ConflictException('INVOCATION_RESOLUTION_MISMATCH');
  const execution=(await tx.select().from(executions).where(and(eq(executions.id,intent.executionId),eq(executions.userId,userId))))[0];if(!execution||!execution.resolvedRiskSnapshotJson||!binding.verificationContractHash)throw new ConflictException('Canonical Risk and Verification binding required');
  const source=execution.authoritySourceJson;
  if(!execution.planId||!execution.planVersionId){
    await this.modules.get(RuntimeAuthorityService,{strict:false}).assertCurrent(tx,source as RuntimeAuthoritySource,{userId,planId:execution.planId,planVersionId:execution.planVersionId});
    if(hash(resolution.inputJson.authoritySource)!==hash(source)||hash((binding.resolutionContractJson as Record<string,unknown>).authoritySource)!==hash(source))throw new ConflictException('INVOCATION_AUTHORITY_SOURCE_MISMATCH');
  }
  const envelope:CapabilityInvocation={invocationId:newId(),planId:intent.planId,planVersionId:intent.planVersionId,executionId:intent.executionId,capabilityId,targetId:target.id,authorityEpoch:target.authorityEpoch,arguments:intent.payloadJson as Record<string,unknown>,resourceScope:{resourceType:intent.resourceType,connectionId:binding.connectionId,sourceCapabilityKey:intent.capabilityKey,...(source?{authoritySource:source}:{})},timeoutMs:30000,idempotencyKey:intent.sideEffectKey??`intent:${intentId}`,resolutionDecisionRef:resolution.id,riskSnapshotRef:`execution:${execution.id}`,approvalRef:null,verificationContractRef:binding.verificationContractHash,createdAt:new Date().toISOString()};capabilityInvocationSchema.parse(envelope);
  const invocationHash=hash({...envelope,invocationId:undefined,createdAt:undefined,userId,actionIntentId:intentId,targetManifestHash:target.manifestHash});
  const prior=(await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.idempotencyKey,envelope.idempotencyKey))))[0];if(prior){if(prior.invocationHash!==invocationHash)throw new ConflictException('INVOCATION_IDEMPOTENCY_CONFLICT');return prior.id;}
  const {invocationId,createdAt,...fields}=envelope;
  await tx.insert(capabilityInvocations).values({...fields,id:invocationId,userId,actionIntentId:intentId,targetManifestHash:target.manifestHash,invocationHash,createdAt:new Date(createdAt)});
  await tx.insert(invocationRuntimeLinks).values({id:newId(),invocationId,runtimeKind:'EXECUTION',runtimeRef:intent.executionId,createdAt:new Date(createdAt)});return invocationId;
 }
 async bindNativeCalendar(tx:Tx,userId:string,deviceId:string,taskId:string,payload:Record<string,unknown>){
  const {plan,resolution}=await this.resolver.resolveNativeCalendar(tx,userId,deviceId,taskId,payload);
  const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),eq(runtimeTargets.targetType,'ANDROID_DEVICE'),eq(runtimeTargets.backingRef,deviceId))).for('update'))[0];
  if(!target||target.health==='UNAVAILABLE')throw new ConflictException('Registered Android RuntimeTarget required');
  const envelope:CapabilityInvocation={invocationId:newId(),planId:plan.id,planVersionId:resolution.planVersionId,executionId:null,capabilityId:'calendar.event.read',targetId:target.id,authorityEpoch:target.authorityEpoch,arguments:{scopeStart:payload.scopeStart,scopeEnd:payload.scopeEnd},resourceScope:{sourceId:payload.sourceId,demandIds:payload.demandIds,deviceTaskId:taskId},timeoutMs:30000,idempotencyKey:`device-task:${taskId}`,resolutionDecisionRef:resolution.id,riskSnapshotRef:null,approvalRef:null,verificationContractRef:'android-calendar-read-v1',createdAt:new Date().toISOString()};
  capabilityInvocationSchema.parse(envelope);
  const {invocationId,createdAt,...fields}=envelope;
  const stored={...fields,userId,actionIntentId:null,targetManifestHash:target.manifestHash};
  const invocationHash=hash(stored);
  const prior=(await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.idempotencyKey,envelope.idempotencyKey))))[0];
  if(prior){if(prior.invocationHash!==invocationHash)throw new ConflictException('INVOCATION_IDEMPOTENCY_CONFLICT');return prior.id;}
  await tx.insert(capabilityInvocations).values({...stored,id:invocationId,invocationHash,createdAt:new Date(createdAt)});
  await tx.insert(invocationRuntimeLinks).values({id:newId(),invocationId,runtimeKind:'DEVICE_TASK',runtimeRef:taskId,createdAt:new Date(createdAt)});
  return invocationId;
 }
 async bindNativeNotification(tx:Tx,userId:string,deviceId:string,taskId:string,payload:Record<string,unknown>){
  const {plan,resolution}=await this.resolver.resolveNativeNotification(tx,userId,deviceId,taskId,payload);
  const origin=payload.planNotificationRead as {targetId:string;authorityEpoch:number};
  const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),eq(runtimeTargets.id,origin.targetId),eq(runtimeTargets.targetType,'ANDROID_DEVICE'),eq(runtimeTargets.backingRef,deviceId))).for('update'))[0];
  if(!target||target.health==='UNAVAILABLE'||target.authorityEpoch!==origin.authorityEpoch)throw new ConflictException('STALE_PLAN_NOTIFICATION_AUTHORITY');
  const envelope:CapabilityInvocation={invocationId:newId(),planId:plan.id,planVersionId:resolution.planVersionId,executionId:null,capabilityId:'app.notification.read',targetId:target.id,authorityEpoch:target.authorityEpoch,arguments:{sourcePackage:payload.sourcePackage,scopeStart:payload.scopeStart,scopeEnd:payload.scopeEnd},resourceScope:{sourceId:payload.sourceId,deviceTaskId:taskId,planNotificationRead:payload.planNotificationRead},timeoutMs:30000,idempotencyKey:`device-task:${taskId}`,resolutionDecisionRef:resolution.id,riskSnapshotRef:null,approvalRef:null,verificationContractRef:'android-notification-read-v1',createdAt:new Date().toISOString()};
  capabilityInvocationSchema.parse(envelope);
  const {invocationId,createdAt,...fields}=envelope,stored={...fields,userId,actionIntentId:null,targetManifestHash:target.manifestHash},invocationHash=hash(stored);
  const prior=(await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.idempotencyKey,envelope.idempotencyKey))))[0];
  if(prior){if(prior.invocationHash!==invocationHash)throw new ConflictException('INVOCATION_IDEMPOTENCY_CONFLICT');return prior.id;}
  await tx.insert(capabilityInvocations).values({...stored,id:invocationId,invocationHash,createdAt:new Date(createdAt)});
  await tx.insert(invocationRuntimeLinks).values({id:newId(),invocationId,runtimeKind:'DEVICE_TASK',runtimeRef:taskId,createdAt:new Date(createdAt)});return invocationId;
 }
 async assertDeviceTaskCurrent(tx:Tx,userId:string,taskId:string,deviceId:string,payload:Record<string,unknown>){
  const link=(await tx.select().from(invocationRuntimeLinks).where(and(eq(invocationRuntimeLinks.runtimeKind,'DEVICE_TASK'),eq(invocationRuntimeLinks.runtimeRef,taskId))))[0];
  if(!link){if(payload.planWakeup||payload.planNotificationRead)throw new ConflictException('PLAN_TASK_INVOCATION_REQUIRED');return null;} // Pre-confirmation reads retain the existing native acquisition chain.
  const row=(await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.id,link.invocationId),eq(capabilityInvocations.userId,userId))))[0];
  if(!row)throw new ConflictException('INVOCATION_NOT_FOUND');
  const {id,createdAt,invocationHash,...fields}=row;
  if(hash(fields)!==invocationHash)throw new ConflictException('INVOCATION_INTEGRITY_ERROR');
  const {resolution}=payload.planNotificationRead?await this.resolver.resolveNativeNotification(tx,userId,deviceId,taskId,payload):await this.resolver.resolveNativeCalendar(tx,userId,deviceId,taskId,payload);
  if(resolution.id!==row.resolutionDecisionRef)throw new ConflictException('NATIVE_RESOLUTION_MISMATCH');
  const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.id,row.targetId),eq(runtimeTargets.userId,userId))).for('update'))[0];
  if(!target||target.authorityEpoch!==row.authorityEpoch||target.manifestHash!==row.targetManifestHash||target.health==='UNAVAILABLE')throw new ConflictException('STALE_NATIVE_AUTHORITY');
  return row;
 }
 async assertActionCurrent(userId:string,intentId:string){const row=(await this.db.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.actionIntentId,intentId))))[0];if(row)await this.assertCurrent(userId,row.id);}
 async list(userId:string){return this.db.select().from(capabilityInvocations).where(eq(capabilityInvocations.userId,userId));}
 async get(userId:string,id:string){const row=(await this.db.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.id,id))))[0];if(!row)throw new NotFoundException('Invocation not found');return row;}
 async assertCurrent(userId:string,id:string){const row=await this.get(userId,id);const {id:storedId,createdAt,invocationHash,...fields}=row;if(hash(fields)!==invocationHash)throw new ConflictException('INVOCATION_INTEGRITY_ERROR');await this.targets.assertCurrent(userId,row.targetId,row.authorityEpoch,row.targetManifestHash);if(!row.planId||!row.planVersionId)await this.db.transaction(tx=>this.modules.get(RuntimeAuthorityService,{strict:false}).assertCurrent(tx,row.resourceScope.authoritySource as RuntimeAuthoritySource,{userId,planId:row.planId,planVersionId:row.planVersionId}));return row;}
}
