import {RuntimeResultsService} from '../capability-invocations/runtime-results.service';
import { ResourceGapContinuationService } from '../consumer/resource-gap-continuation.service';
import { PersistentNotificationPlanService } from '../consumer/persistent-notification-plan.service';
import {ModuleRef} from '@nestjs/core';
import {NativeCalendarRuntimeService} from '../execution/native-calendar-runtime.service';
import {CapabilityInvocationsService} from '../capability-invocations/capability-invocations.service';
import {RuntimeTargetsService} from '../runtime-targets/runtime-targets.service';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {LocalAcquisitionService} from '../consumer/local-acquisition.service';
import {LocalAcquisitionDto} from '../consumer/local-acquisition.dto';
import {localCapabilityAvailability} from '@lazy-armor/plan-schema';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { localCapabilityStates,auditLogs, candidateFacts, deviceAppConnections, deviceHeartbeats, deviceTasks, readEvidence, sourceObservations, truthRecords } from '@lazy-armor/database';
import { realityValueHash, type JsonValue, type ParserKey, type SourceMode, type SourceObservationInput } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RealityPipelineService, type RealityExecutor } from '../reality-pipeline/reality-pipeline.service';
import { StructuredReadService, StructuredReadSourceInvalidError } from '../structured-read/structured-read.service';
import { resolveAppReadProfile } from '../structured-read/app-read-profiles';
import { TrustedDevicesService } from '../trusted-devices/trusted-devices.service';

const LEASE_TTL_MS = process.env.NODE_ENV === 'test' ? 10_000 : 30_000;
const ONLINE_WINDOW_MS = process.env.NODE_ENV === 'test' ? 5_000 : 30_000;

interface DeviceTaskRealitySpec { parserKey: ParserKey; resourceHint: string; factKey: string; sourceMode: SourceMode; }

const DEVICE_TASK_REALITY_SPEC: Record<string, DeviceTaskRealitySpec> = {
  OBSERVE_DEVICE_STATUS: { parserKey: 'generic.device-status.v1', resourceHint: 'DeviceStatus', factKey: 'device_status.status.state', sourceMode: 'INTERNAL' },
  READ_CONSUMABLE: { parserKey: 'generic.consumable-remaining.v1', resourceHint: 'device.consumable', factKey: 'device.consumable.remaining_days', sourceMode: 'INTERNAL' },
  READ_HOUSEHOLD_SUPPLY: { parserKey: 'generic.household-supply.v1', resourceHint: 'household.supply', factKey: 'household.supply.remaining_days', sourceMode: 'INTERNAL' },
};

const AWAITING_DEVICE_EVIDENCE_TASK_TYPES = new Set(['APP_READ_SESSION']);
const STRUCTURED_READ_TASK_TYPES = new Set(['APP_STRUCTURED_READ', 'SCREEN_CAPTURE_FOR_READ']);

// 服务器允许的 DeviceTask 类型注册表：enqueue 与 complete 都必须校验。
// 未注册类型在入队时拒绝，在 complete 时不得置 SUCCEEDED。
const ALLOWED_DEVICE_TASK_TYPES = new Set<string>([
  'NATIVE_CALENDAR_READ',
  'NATIVE_NOTIFICATION_READ',
  ...Object.keys(DEVICE_TASK_REALITY_SPEC),
  ...STRUCTURED_READ_TASK_TYPES,
  ...AWAITING_DEVICE_EVIDENCE_TASK_TYPES,
]);

type DeviceTaskReality =
  | {acquisitionId:string;acquisitionState:string;truthRecordIds:string[]}
  | { observationId: string; candidateId: string | null; truth: Awaited<ReturnType<RealityPipelineService['confirmCandidate']>> | null }
  | { observationId: string; candidateIds: string[]; truthRecordIds: string[] };

/** Ownership was lost (recovered / reclaimed / lease expired) before the terminal transition. */
export class StaleClaimError extends ConflictException {
  constructor() { super('Device task claim is no longer active'); }
}

@Injectable()
export class DeviceTasksService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly modules:ModuleRef,
    private readonly audit: AuditService,
    private readonly invocations: CapabilityInvocationsService,
    private readonly runtimeResults: RuntimeResultsService,
    private readonly targets: RuntimeTargetsService,
    private readonly acquisition:LocalAcquisitionService,
    private readonly pipeline: RealityPipelineService,
    private readonly trustedDevices: TrustedDevicesService,
    @Inject(forwardRef(() => StructuredReadService)) private readonly structuredRead: StructuredReadService,
  ) {}

  async enqueue(userId: string, trustedDeviceId: string, taskType: string, factKey: string, resourceType: string, payload: Record<string, unknown>, acquisitionKey?:string) {
    if (!ALLOWED_DEVICE_TASK_TYPES.has(taskType)) throw new BadRequestException(`Unsupported device task type: ${taskType}`);
    const device = await this.trustedDevices.assertActive(userId, trustedDeviceId);
    if(taskType==='NATIVE_CALENDAR_READ'){
      if(factKey!=='calendar_event.meetings.state'||resourceType!=='CalendarEvent'||typeof payload.scopeStart!=='number'||typeof payload.scopeEnd!=='number'||!Number.isFinite(payload.scopeStart)||!Number.isFinite(payload.scopeEnd)||payload.scopeEnd<=payload.scopeStart||payload.scopeEnd-payload.scopeStart>31*86400000)throw new BadRequestException('Invalid native calendar task scope');
      const grant=(await this.db.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,trustedDeviceId),eq(localCapabilityStates.capability,'calendar.read'))).limit(1))[0];
      if(!grant||localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE')throw new ForbiddenException('Native calendar capability is not available');
    }
    const status = AWAITING_DEVICE_EVIDENCE_TASK_TYPES.has(taskType) ? 'AWAITING_DEVICE_EVIDENCE' : 'PENDING';
    const now = new Date();
    const keyHash=acquisitionKey?createHash('sha256').update(`${userId}:${trustedDeviceId}:${taskType}:${acquisitionKey}`).digest('hex'):null;
    const id = keyHash?`${keyHash.slice(0,8)}-${keyHash.slice(8,12)}-5${keyHash.slice(13,16)}-8${keyHash.slice(17,20)}-${keyHash.slice(20,32)}`:newId();
    if(acquisitionKey){const prior=(await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.id,id),eq(deviceTasks.userId,userId))).limit(1))[0];if(prior){if(realityValueHash(prior.payloadJson)!==realityValueHash(payload))throw new ConflictException('Acquisition request payload changed');return this.toResponse(prior);}}
    if((taskType==='NATIVE_CALENDAR_READ'&&payload.planWakeup)||(taskType==='NATIVE_NOTIFICATION_READ'&&payload.planNotificationRead))await this.targets.refresh(userId);
    try { await this.db.transaction(async tx=>{await tx.insert(deviceTasks).values({
      id, userId, trustedDeviceId: device.id, deviceId: device.deviceId, taskType, factKey, resourceType,
      payloadJson: payload, status, claimToken: null, claimedAt: null, leaseExpiresAt: null,
      resultJson: null, resultHash: null, errorCode: null, createdAt: now, updatedAt: now, completedAt: null,
    });if(taskType==='NATIVE_CALENDAR_READ'&&payload.planWakeup)await this.invocations.bindNativeCalendar(tx,userId,trustedDeviceId,id,payload);
    if(taskType==='NATIVE_NOTIFICATION_READ'&&payload.planNotificationRead)await this.invocations.bindNativeNotification(tx,userId,trustedDeviceId,id,payload);
    }); } catch(error) { if(!acquisitionKey)throw error;const prior=(await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.id,id),eq(deviceTasks.userId,userId))).limit(1))[0];if(!prior||realityValueHash(prior.payloadJson)!==realityValueHash(payload))throw error;return this.toResponse(prior); }
    await this.audit.append({
      actorType: 'system', actorUserId: null, action: 'DEVICE_TASK_ENQUEUED', resourceType: 'device_task', resourceId: id,
      userId, correlationId: id, changeSummary: `Enqueued ${taskType} edge device task`, source: 'api', result: 'success',
    });
    return this.toResponse(await this.getRowForDevice(userId, device.id, device.deviceId, id));
  }

  async claim(userId: string, trustedDeviceId: string, deviceId: string, taskId: string) {
    return this.db.transaction(async (tx) => {
      const row = (await tx.select().from(deviceTasks)
        .where(and(eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId)))
        .limit(1).for('update'))[0];
      if (!row) throw new NotFoundException('Device task not found');
      await this.assertNotificationSource(tx,userId,row);
      if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(row.taskType))await this.modules.get(NativeCalendarRuntimeService,{strict:false}).assertTask(tx,userId,row);
      else await this.invocations.assertDeviceTaskCurrent(tx,userId,taskId,trustedDeviceId,row.payloadJson);
      const now = new Date();
      const leaseActive = Boolean(row.claimToken && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime());
      if ((row.status === 'CLAIMED' || row.status === 'RUNNING') && leaseActive) throw new ConflictException('Device task is already claimed');
      if (row.status !== 'PENDING' && row.status !== 'CLAIMED' && row.status !== 'RUNNING') throw new ConflictException('Device task is not claimable');
      const claimToken = sha256(newId());
      const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
      await tx.update(deviceTasks).set({ status: 'CLAIMED', claimToken, claimedAt: now, leaseExpiresAt, updatedAt: now }).where(and(eq(deviceTasks.id, taskId), eq(deviceTasks.status, row.status)));
      await this.audit.append({
        actorType: 'user', actorUserId: userId, action: 'DEVICE_TASK_CLAIMED', resourceType: 'device_task', resourceId: taskId,
        userId, correlationId: taskId, changeSummary: 'Edge device claimed a pending task', source: 'api', result: 'success',
      }, tx);
      const claimed=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,taskId)))[0]!;
      if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(claimed.taskType)&&claimed.payloadJson.lookupOnly!==true){
        const {sideEffectOperations}=await import('@lazy-armor/database');
        const op=(await tx.select().from(sideEffectOperations).where(eq(sideEffectOperations.id,String(claimed.payloadJson.operationId))).for('update'))[0];
        if(!op||!['queued','executing','retry_wait'].includes(op.status))throw new ConflictException('Native operation is no longer dispatchable');
        await tx.update(sideEffectOperations).set({status:'executing',attemptCount:op.attemptCount+1,startedAt:op.startedAt??now,updatedAt:now}).where(eq(sideEffectOperations.id,op.id));
      }
      const response=this.toResponse(claimed,{revealClaimToken:true});
      if(claimed.taskType==='APP_STRUCTURED_READ')return {...response,dispatchAuthorization:await this.modules.get(StructuredReadService,{strict:false}).observationTicket(tx,userId,claimed)};
      return ['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(claimed.taskType)?{...response,dispatchAuthorization:await this.modules.get(NativeCalendarRuntimeService,{strict:false}).executionTicket(tx,userId,claimed)}:response;
    });
  }

  async heartbeat(userId: string, trustedDeviceId: string, deviceId: string, taskId: string, claimToken: string) {
    const task = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
    if(task.taskType==='APP_STRUCTURED_READ')return this.db.transaction(async tx=>{
      const row=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.userId,userId),eq(deviceTasks.trustedDeviceId,trustedDeviceId),eq(deviceTasks.deviceId,deviceId))).for('update'))[0];
      if(!row)throw new NotFoundException('Device task not found');
      this.assertClaim(row,claimToken);
      if(!['CLAIMED','RUNNING'].includes(row.status))throw new ConflictException('Device task is not running');
      const leaseExpiresAt=new Date(Date.now()+LEASE_TTL_MS),active={...row,status:'RUNNING',leaseExpiresAt};
      const dispatchAuthorization=await this.modules.get(StructuredReadService,{strict:false}).observationTicket(tx,userId,active);
      await tx.update(deviceTasks).set({status:'RUNNING',leaseExpiresAt,updatedAt:new Date()}).where(eq(deviceTasks.id,taskId));
      return {id:taskId,claimToken,leaseExpiresAt:leaseExpiresAt.toISOString(),dispatchAuthorization};
    });
    if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(task.taskType)){
      return this.db.transaction(async tx=>{
        const row=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,taskId)).for('update'))[0];
        this.assertClaim(row,claimToken);
        if(!['CLAIMED','RUNNING'].includes(row.status))throw new ConflictException('Native task not running');
        const leaseExpiresAt=new Date(Date.now()+LEASE_TTL_MS);
        await tx.update(deviceTasks).set({status:'RUNNING',leaseExpiresAt,updatedAt:new Date()}).where(eq(deviceTasks.id,taskId));
        const active={...row,status:'RUNNING',leaseExpiresAt};
        return {id:taskId,claimToken,leaseExpiresAt:leaseExpiresAt.toISOString(),dispatchAuthorization:await this.modules.get(NativeCalendarRuntimeService,{strict:false}).executionTicket(tx,userId,active)};
      });
    }
    if(task.taskType==='NATIVE_NOTIFICATION_READ')return this.db.transaction(async tx=>{
      const row=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.userId,userId),eq(deviceTasks.trustedDeviceId,trustedDeviceId),eq(deviceTasks.deviceId,deviceId))).limit(1).for('update'))[0];
      if(!row)throw new NotFoundException('Device task not found');
      await this.assertNotificationSource(tx,userId,row);
      await this.invocations.assertDeviceTaskCurrent(tx,userId,taskId,trustedDeviceId,row.payloadJson);
      this.assertClaim(row,claimToken);
      if(!['CLAIMED','RUNNING'].includes(row.status))throw new ConflictException('Device task is not running');
      const now=new Date(),leaseExpiresAt=new Date(now.getTime()+LEASE_TTL_MS);
      const [updated]=await tx.update(deviceTasks).set({leaseExpiresAt,updatedAt:now}).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.claimToken,claimToken),inArray(deviceTasks.status,['CLAIMED','RUNNING']),gte(deviceTasks.leaseExpiresAt,now)));
      if(updated.affectedRows!==1)throw new ConflictException('Device task lease is no longer active');
      return {id:taskId,claimToken,leaseExpiresAt:leaseExpiresAt.toISOString()};
    });
    this.assertClaim(task, claimToken);
    if (task.status !== 'CLAIMED' && task.status !== 'RUNNING') throw new ConflictException('Device task is not running');
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
    const [updated] = await this.db.update(deviceTasks).set({ leaseExpiresAt, updatedAt: now }).where(and(
      eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId),
      eq(deviceTasks.claimToken, claimToken), inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), gte(deviceTasks.leaseExpiresAt, now),
    ));
    if (updated.affectedRows !== 1) throw new ConflictException('Device task lease is no longer active');
    return { id: taskId, claimToken, leaseExpiresAt: leaseExpiresAt.toISOString() };
  }

  async complete(userId: string, trustedDeviceId: string, deviceId: string, taskId: string, claimToken: string, result: Record<string, unknown>,proofRequestId?:string) {
    const native=await this.getRowForDevice(userId,trustedDeviceId,deviceId,taskId);
    if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(native.taskType)) {
      if(!proofRequestId)throw new ForbiddenException('Signed native write receipt required');
      const runtime=this.modules.get(NativeCalendarRuntimeService,{strict:false});
      const outcome=await this.db.transaction(async tx=>{
        const task=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,taskId)).for('update'))[0];
        await runtime.assertTask(tx,userId,task,'RECONCILE');
        if(['SUCCEEDED','FAILED'].includes(task.status)){
          if(task.claimToken!==claimToken||task.resultHash!==realityValueHash(result))throw new ConflictException('Native terminal receipt mismatch');
          return {executionId:String((task.payloadJson.invocation as {executionId:string}).executionId),unknown:task.status!=='SUCCEEDED'};
        }
        this.assertClaim(task,claimToken);
        if(!['CLAIMED','RUNNING'].includes(task.status))throw new ConflictException('Native task not running');
        return runtime.complete(tx,userId,task,result,proofRequestId);
      });
      await runtime.resume(userId,outcome.executionId,outcome.unknown);
      return this.toResponse(await this.getRowForDevice(userId,trustedDeviceId,deviceId,taskId),{revealClaimToken:true});
    }
    const resultHash = realityValueHash(result);
    const outcome = await this.db.transaction(async (tx) => {
      // Atomic ownership boundary: lock the task row so recoverExpired/claim
      // cannot mutate it until this whole Reality-confirm + CAS block commits.
      const task = (await tx.select().from(deviceTasks)
        .where(and(eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId)))
        .limit(1).for('update'))[0];
      if (!task) throw new NotFoundException('Device task not found');
      await this.assertNotificationSource(tx,userId,task);
      await this.invocations.assertDeviceTaskCurrent(tx,userId,taskId,trustedDeviceId,task.payloadJson);
      if ((task.status === 'SUCCEEDED' || (task.taskType === 'APP_STRUCTURED_READ' && task.status === 'FAILED' && task.errorCode === 'NEEDS_CONFIRMATION')) && (['NATIVE_CALENDAR_READ','NATIVE_NOTIFICATION_READ'].includes(task.taskType) || STRUCTURED_READ_TASK_TYPES.has(task.taskType))) {
        await this.trustedDevices.assertActive(userId, trustedDeviceId, deviceId);
        if (task.taskType === 'NATIVE_CALENDAR_READ' && !proofRequestId) throw new ForbiddenException('Signed native read proof is required');
        if (task.claimToken !== claimToken || task.resultHash !== resultHash || realityValueHash(task.resultJson) !== resultHash) throw new ConflictException('Completed device task receipt does not match');
        // Transport replay only: retain the verified terminal record, no ingestion.
        return { success: { ...this.toResponse(task, { revealClaimToken: true }), replayed: true } } as const;
      }
      this.assertClaim(task, claimToken);
      if (task.status !== 'CLAIMED' && task.status !== 'RUNNING') throw new ConflictException('Device task is not running');
      if (!ALLOWED_DEVICE_TASK_TYPES.has(task.taskType)) {
        await this.markVerificationFailed(tx, task, result, resultHash, 'UNSUPPORTED_TASK_TYPE');
        return { failure: new BadRequestException('Unsupported device task type') } as const;
      }
      const spec = DEVICE_TASK_REALITY_SPEC[task.taskType];
      let reality: DeviceTaskReality | null = null;
      if(['NATIVE_CALENDAR_READ','NATIVE_NOTIFICATION_READ'].includes(task.taskType)){
        if(!proofRequestId)throw new ForbiddenException('Signed native read proof is required');
        const input=plainToInstance(LocalAcquisitionDto,result);
        if((await validate(input,{whitelist:true,forbidNonWhitelisted:true})).length)throw new BadRequestException('Invalid native acquisition evidence');
        const capability=task.taskType==='NATIVE_NOTIFICATION_READ'?'notification.read':'calendar.read';
        if(input.capability!==capability||input.scopeStart!==task.payloadJson.scopeStart||input.scopeEnd!==task.payloadJson.scopeEnd)throw new BadRequestException('Native read scope does not match task');
        if(task.taskType==='NATIVE_NOTIFICATION_READ'){
          const fields=new Set(['eventId','contentHash','sourcePackage','postedAt','capturedAt','hasTitle','hasText','candidateKind','candidateResource','candidateConfidence','amountMinor','currency','candidateStatus','parserVersion','status']);
          if(input.items?.some(i=>!i || typeof i!=='object' || Array.isArray(i) || i.sourcePackage!==task.payloadJson.sourcePackage || Object.keys(i).some(k=>!fields.has(k)) || typeof i.capturedAt!=='number' || !Number.isFinite(i.capturedAt) || typeof i.postedAt!=='number' || !Number.isFinite(i.postedAt) || i.postedAt<input.scopeStart || i.postedAt>=input.scopeEnd))throw new BadRequestException('Native notification source, minimized fields or time scope does not match frozen query');
        }
        const receipt=await this.acquisition.receive(userId,trustedDeviceId,proofRequestId,input,tx);
        reality={acquisitionId:receipt.id,acquisitionState:receipt.state,truthRecordIds:'truthIds' in receipt?receipt.truthIds:[]};
      } else if (STRUCTURED_READ_TASK_TYPES.has(task.taskType)) {
        try {
          reality = await this.structuredRead.ingestDeviceResult(userId, task, result, tx, claimToken);
        } catch (error) {
          if (error instanceof StaleClaimError || error instanceof StructuredReadSourceInvalidError) throw error;
          await this.markVerificationFailed(tx, task, result, resultHash);
          return { failure: new BadRequestException('Device task result failed structured read verification') } as const;
        }
      } else if (spec) {
        try {
          reality = await this.recordEvidence(userId, task, spec, result, resultHash, tx, claimToken);
        } catch (error) {
          if (error instanceof StaleClaimError) throw error;
          await this.markVerificationFailed(tx, task, result, resultHash);
          return { failure: new BadRequestException('Device task result failed verification') } as const;
        }
      }
      // Notification acquisition verifies collection, not the semantic candidate.
      // Its original Goal stays WAITING_FACT_CONFIRMATION until formal Truth exists.
      const verifiedNotificationRead=task.taskType==='NATIVE_NOTIFICATION_READ' && reality && 'acquisitionId' in reality && ['VERIFIED_EMPTY','VERIFIED_PRESENT'].includes(reality.acquisitionState);
      if (task.taskType === 'APP_STRUCTURED_READ' && reality && 'candidateIds' in reality && reality.candidateIds.length > 0 && reality.truthRecordIds.length === 0) {
        await this.assertOwnershipCurrent(tx, task, claimToken);
        // Preserve the existing unverified terminal state, but acknowledge collected
        // evidence so the runner does not repeat the read while the user verifies it.
        await this.markVerificationFailed(tx, task, result, resultHash, 'NEEDS_CONFIRMATION');
        const pending = (await tx.select().from(deviceTasks).where(eq(deviceTasks.id, taskId)).limit(1))[0]!;
        return { success: { ...this.toResponse(pending, { revealClaimToken: true }), reality } } as const;
      }
      if (!hasVerifiedReality(reality) && !verifiedNotificationRead) {
        await this.markVerificationFailed(tx, task, result, resultHash, deviceTaskVerificationError(reality));
        return { failure: new BadRequestException('Device task result produced no verified reality') } as const;
      }
      // Re-validate ownership on the still-locked row right before the terminal CAS.
      await this.assertOwnershipCurrent(tx, task, claimToken);
      const now = new Date();
      const [updated] = await tx.update(deviceTasks).set({ status: 'SUCCEEDED', resultJson: result, resultHash, errorCode: null, completedAt: now, updatedAt: now })
        .where(and(
          eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId),
          eq(deviceTasks.claimToken, claimToken), inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), gte(deviceTasks.leaseExpiresAt, now),
        ));
      if (updated.affectedRows !== 1) throw new ConflictException('Device task claim is no longer active');
      await this.audit.append({
        actorType: 'user', actorUserId: userId, action: 'DEVICE_TASK_SUCCEEDED', resourceType: 'device_task', resourceId: taskId,
        userId, correlationId: taskId, changeSummary: 'Edge device task completed with verified evidence', source: 'api', result: 'success',
      }, tx);
      if(task.taskType==='NATIVE_CALENDAR_READ'&&reality&&'acquisitionId' in reality)await this.runtimeResults.captureNativeCalendar(tx,userId,taskId,reality.acquisitionId);
      if(task.taskType==='NATIVE_NOTIFICATION_READ'&&task.payloadJson.planNotificationRead&&reality&&'acquisitionId' in reality)await this.runtimeResults.captureNativeNotification(tx,userId,taskId,reality.acquisitionId);
      const updatedRow = (await tx.select().from(deviceTasks).where(eq(deviceTasks.id, taskId)).limit(1))[0]!;
      return { success: { ...this.toResponse(updatedRow, { revealClaimToken: true }), reality } } as const;
    });
    if ('failure' in outcome) throw outcome.failure;
    return outcome.success;
  }

  async fail(userId: string, trustedDeviceId: string, deviceId: string, taskId: string, claimToken: string, errorCode: string,proofRequestId?:string) {
    const task = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
    if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(task.taskType)){
      if(!proofRequestId)throw new ForbiddenException('Signed native failure receipt required');
      const runtime=this.modules.get(NativeCalendarRuntimeService,{strict:false});
      const receipt=await this.db.transaction(tx=>runtime.failureReceipt(tx,userId,task,errorCode));
      return this.complete(userId,trustedDeviceId,deviceId,taskId,claimToken,receipt,proofRequestId);
    }
    if(task.taskType==='NATIVE_NOTIFICATION_READ')return this.db.transaction(async tx=>{
      const row=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.userId,userId),eq(deviceTasks.trustedDeviceId,trustedDeviceId),eq(deviceTasks.deviceId,deviceId))).limit(1).for('update'))[0];
      if(!row)throw new NotFoundException('Device task not found');
      await this.assertNotificationSource(tx,userId,row);
      await this.invocations.assertDeviceTaskCurrent(tx,userId,taskId,trustedDeviceId,row.payloadJson);
      this.assertClaim(row,claimToken);
      if(!['CLAIMED','RUNNING'].includes(row.status))throw new ConflictException('Device task is not running');
      const now=new Date();
      const [updated]=await tx.update(deviceTasks).set({status:'FAILED',errorCode,completedAt:now,updatedAt:now}).where(and(eq(deviceTasks.id,taskId),eq(deviceTasks.claimToken,claimToken),inArray(deviceTasks.status,['CLAIMED','RUNNING']),gte(deviceTasks.leaseExpiresAt,now)));
      if(updated.affectedRows!==1)throw new ConflictException('Device task claim is no longer active');
      await this.audit.append({actorType:'user',actorUserId:userId,action:'DEVICE_TASK_FAILED',resourceType:'device_task',resourceId:taskId,userId,correlationId:taskId,reasonCode:errorCode,changeSummary:'Edge device reported task failure',source:'api',result:'failure'},tx);
      const failed=(await tx.select().from(deviceTasks).where(eq(deviceTasks.id,taskId)).limit(1))[0]!;
      return this.toResponse(failed,{revealClaimToken:true});
    });
    this.assertClaim(task, claimToken);
    if (task.status !== 'CLAIMED' && task.status !== 'RUNNING') throw new ConflictException('Device task is not running');
    const now = new Date();
    const [updated] = await this.db.update(deviceTasks).set({ status: 'FAILED', errorCode, completedAt: now, updatedAt: now })
      .where(and(
        eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId),
        eq(deviceTasks.claimToken, claimToken), inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), gte(deviceTasks.leaseExpiresAt, now),
      ));
    if (updated.affectedRows !== 1) throw new ConflictException('Device task claim is no longer active');
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'DEVICE_TASK_FAILED', resourceType: 'device_task', resourceId: taskId,
      userId, correlationId: taskId, reasonCode: errorCode, changeSummary: 'Edge device reported task failure', source: 'api', result: 'failure',
    });
    return this.toResponse(await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId), { revealClaimToken: true });
  }

  async recoverExpired() {
    const now = new Date();
    return this.db.transaction(async tx=>{
      const rows=await tx.select().from(deviceTasks).where(and(inArray(deviceTasks.status,['CLAIMED','RUNNING']),lt(deviceTasks.leaseExpiresAt,now))).for('update');
      for(const row of rows){
        if(['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(row.taskType)&&row.payloadJson.lookupOnly!==true){
          await this.modules.get(NativeCalendarRuntimeService,{strict:false}).expireWrite(tx,row);
          continue;
        }
        await tx.update(deviceTasks).set({status:'PENDING',claimToken:null,claimedAt:null,leaseExpiresAt:null,updatedAt:now}).where(eq(deviceTasks.id,row.id));
      }
      return {recovered:rows.length};
    });
  }

  async heartbeatDevice(userId: string, trustedDeviceId: string, deviceId: string, onlineState: 'online' | 'offline' | 'unknown') {
    await this.trustedDevices.assertActive(userId, trustedDeviceId, deviceId);
    const now = new Date();
    const existing = (await this.db.select().from(deviceHeartbeats)
      .where(and(eq(deviceHeartbeats.userId, userId), eq(deviceHeartbeats.trustedDeviceId, trustedDeviceId))).limit(1))[0];
    if (existing) {
      await this.db.update(deviceHeartbeats).set({ onlineState, deviceId, lastHeartbeatAt: now }).where(eq(deviceHeartbeats.id, existing.id));
    } else {
      await this.db.insert(deviceHeartbeats).values({ id: newId(), userId, trustedDeviceId, deviceId, onlineState, lastHeartbeatAt: now, createdAt: now });
    }
    await this.db.update(deviceAppConnections).set({ lastSeenAt: now })
      .where(and(eq(deviceAppConnections.userId, userId), eq(deviceAppConnections.trustedDeviceId, trustedDeviceId)));
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'DEVICE_HEARTBEAT_RECORDED', resourceType: 'device_heartbeat', resourceId: trustedDeviceId,
      userId, correlationId: trustedDeviceId, changeSummary: 'Recorded edge device heartbeat and online state', source: 'api', result: 'success',
    });
    return { trustedDeviceId, deviceId, onlineState, lastHeartbeatAt: now.toISOString(), online: true };
  }

  async heartbeatState(userId: string, trustedDeviceId: string) {
    const row = (await this.db.select().from(deviceHeartbeats)
      .where(and(eq(deviceHeartbeats.userId, userId), eq(deviceHeartbeats.trustedDeviceId, trustedDeviceId))).limit(1))[0];
    if (!row) return { onlineState: 'unknown' as const, lastHeartbeatAt: null, online: false };
    const online = Date.now() - row.lastHeartbeatAt.getTime() <= ONLINE_WINDOW_MS;
    return { onlineState: online ? ('online' as const) : ('offline' as const), lastHeartbeatAt: row.lastHeartbeatAt.toISOString(), online };
  }

  async list(userId: string, trustedDeviceId: string, deviceId: string) {
    const rows = await this.db.select().from(deviceTasks)
      .where(and(eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId)))
      .orderBy(desc(deviceTasks.createdAt));
    return rows.map((row) => this.toResponse(row, { revealClaimToken: true }));
  }

  async get(userId: string, trustedDeviceId: string, deviceId: string, taskId: string) {
    return this.toResponse(await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId), { revealClaimToken: true });
  }

  /** Redacted, device-scoped read model. Never returns task payload, result or claim token. */
  async evidence(userId: string, trustedDeviceId: string, deviceId: string, taskId: string) {
    const task = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
    const payload = task.payloadJson as Record<string, unknown>;
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : task.id;
    const structured = STRUCTURED_READ_TASK_TYPES.has(task.taskType);
    const eventKey = structured ? `structured-read:${requestId}` : `device-task:${task.id}`;
    const observations = await this.db.select({ id: sourceObservations.id, status: sourceObservations.status, observedAt: sourceObservations.observedAt })
      .from(sourceObservations).where(and(eq(sourceObservations.userId, userId), eq(sourceObservations.providerKey, 'edge-device'), eq(sourceObservations.externalEventKey, eventKey)));
    const observationIds = observations.map((item) => item.id);
    const candidates = observationIds.length ? await this.db.select({ id: candidateFacts.id, observationId: candidateFacts.observationId, status: candidateFacts.status, truthRecordId: candidateFacts.truthRecordId })
      .from(candidateFacts).where(and(eq(candidateFacts.userId, userId), inArray(candidateFacts.observationId, observationIds))) : [];
    const truthIds = [...new Set(candidates.flatMap((item) => item.truthRecordId ? [item.truthRecordId] : []))];
    const truths = truthIds.length ? await this.db.select({ id: truthRecords.id, status: truthRecords.status, revokedAt: truthRecords.revokedAt })
      .from(truthRecords).where(and(eq(truthRecords.userId, userId), inArray(truthRecords.id, truthIds))) : [];
    const reads = structured ? await this.db.select({ id: readEvidence.id, status: readEvidence.status, blockedReason: readEvidence.blockedReason })
      .from(readEvidence).where(and(eq(readEvidence.userId, userId), eq(readEvidence.requestId, requestId))) : [];
    const claimEvents = await this.db.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.userId, userId), eq(auditLogs.resourceType, 'device_task'), eq(auditLogs.resourceId, task.id), eq(auditLogs.action, 'DEVICE_TASK_CLAIMED'),
    ));
    const heartbeat = (await this.db.select({ onlineState: deviceHeartbeats.onlineState, lastHeartbeatAt: deviceHeartbeats.lastHeartbeatAt })
      .from(deviceHeartbeats).where(and(eq(deviceHeartbeats.userId, userId), eq(deviceHeartbeats.trustedDeviceId, trustedDeviceId))).limit(1))[0];
    const deviceOnline = Boolean(heartbeat && Date.now() - heartbeat.lastHeartbeatAt.getTime() <= ONLINE_WINDOW_MS);
    return {
      ...(structured ? { readScope: { foregroundOnly: true, boundedSession: true,
        fields: Array.isArray(task.payloadJson.requestedFields) ? task.payloadJson.requestedFields.filter((field): field is string => typeof field === 'string' && !!resolveAppReadProfile(String(task.payloadJson.packageName ?? ''))?.allowedSelectors.includes(field)) : [] } } : {}),
      task: { id: task.id, taskType: task.taskType, resourceType: task.resourceType, factKey: task.factKey, status: task.status,
        errorCode: task.errorCode, attemptCount: claimEvents.length, claimedAt: task.claimedAt?.toISOString() ?? null,
        leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null, resultHash: task.resultHash,
        createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(), completedAt: task.completedAt?.toISOString() ?? null,
        deviceOnline, deviceHeartbeatAt: heartbeat?.lastHeartbeatAt.toISOString() ?? null },
      observations: observations.map((item) => ({ id: item.id, status: item.status, observedAt: item.observedAt.toISOString() })),
      candidates: candidates.map((item) => ({ id: item.id, observationId: item.observationId, status: item.status })),
      truths: truths.map((item) => ({ id: item.id, status: item.status, current: item.status === 'verified' && !item.revokedAt })),
      readEvidence: reads.map((item) => ({ id: item.id, status: item.status, blockedReason: item.blockedReason })),
    };
  }

  private async assertNotificationSource(tx:RealityExecutor,userId:string,task:typeof deviceTasks.$inferSelect) {
    if(task.taskType!=='NATIVE_NOTIFICATION_READ')return;
    if(task.payloadJson.planNotificationRead)await this.modules.get(PersistentNotificationPlanService,{strict:false}).assertTask(tx,userId,task);
    else await this.modules.get(ResourceGapContinuationService,{strict:false}).assertTask(tx,userId,task);
  }

  private async markVerificationFailed(tx: RealityExecutor, task: typeof deviceTasks.$inferSelect, result: Record<string, unknown>, resultHash: string, errorCode = 'RESULT_VERIFICATION_FAILED') {
    if (!task.claimToken) return;
    const now = new Date();
    const [updated] = await tx.update(deviceTasks).set({ status: 'FAILED', resultJson: result, resultHash, errorCode, completedAt: now, updatedAt: now })
      .where(and(
        eq(deviceTasks.id, task.id), eq(deviceTasks.userId, task.userId), eq(deviceTasks.trustedDeviceId, task.trustedDeviceId), eq(deviceTasks.deviceId, task.deviceId),
        eq(deviceTasks.claimToken, task.claimToken), inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), gte(deviceTasks.leaseExpiresAt, now),
      ));
    if (updated.affectedRows !== 1) return;
    await this.audit.append({
      actorType: 'system', actorUserId: null, action: errorCode === 'NEEDS_CONFIRMATION' ? 'DEVICE_TASK_EVIDENCE_AWAITING_CONFIRMATION' : 'DEVICE_TASK_FAILED', resourceType: 'device_task', resourceId: task.id,
      userId: task.userId, correlationId: task.id, reasonCode: errorCode, changeSummary: errorCode === 'NEEDS_CONFIRMATION' ? 'Captured page observation; user verification is still required' : 'Device task result failed reality pipeline verification', source: 'api', result: errorCode === 'NEEDS_CONFIRMATION' ? 'pending' : 'failure',
    }, tx);
  }

  private async recordEvidence(userId: string, task: typeof deviceTasks.$inferSelect, spec: DeviceTaskRealitySpec, result: Record<string, unknown>, resultHash: string, tx: RealityExecutor, claimToken: string) {
    const input: SourceObservationInput = {
      sourceMode: spec.sourceMode,
      providerKey: 'edge-device',
      connectionId: null,
      externalEventKey: `device-task:${task.id}`,
      parserKey: spec.parserKey,
      resourceHint: spec.resourceHint,
      payload: { ...result } as Record<string, JsonValue>,
      evidenceHash: resultHash,
      observedAt: new Date().toISOString(),
    };
    const observed = await this.pipeline.ingest(userId, input, 0, tx);
    const candidate = observed.candidates[0];
    if (!candidate) return { observationId: observed.observationId, candidateId: null, truth: null };
    // Ownership must still be valid immediately before VERIFIED Truth lands.
    await this.assertOwnershipCurrent(tx, task, claimToken);
    const truth = await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'device_evidence', verificationMethod: 'DEVICE_READ_BACK' }, 0, tx);
    return { observationId: observed.observationId, candidateId: candidate.id, truth };
  }

  private async assertOwnershipCurrent(tx: RealityExecutor, task: typeof deviceTasks.$inferSelect, claimToken: string) {
    const current = (await tx.select().from(deviceTasks).where(eq(deviceTasks.id, task.id)).limit(1).for('update'))[0];
    if (!current || !current.claimToken || current.claimToken !== claimToken) throw new StaleClaimError();
    if (!current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= Date.now()) throw new StaleClaimError();
    if (current.status !== 'CLAIMED' && current.status !== 'RUNNING') throw new StaleClaimError();
  }

  private assertClaim(task: typeof deviceTasks.$inferSelect, claimToken: string) {
    if (!task.claimToken || task.claimToken !== claimToken) throw new ForbiddenException('Device task claim token is invalid');
    if (!task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= Date.now()) throw new ConflictException('Device task lease has expired');
  }

  private async getRowForDevice(userId: string, trustedDeviceId: string, deviceId: string, taskId: string) {
    const rows = await this.db.select().from(deviceTasks)
      .where(and(eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Device task not found');
    return rows[0];
  }

  private toResponse(row: typeof deviceTasks.$inferSelect, options: { revealClaimToken?: boolean } = {}) {
    return {
      id: row.id,
      userId: row.userId,
      trustedDeviceId: row.trustedDeviceId,
      deviceId: row.deviceId,
      taskType: row.taskType,
      factKey: row.factKey,
      resourceType: row.resourceType,
      payload: row.payloadJson,
      status: row.status,
      // claimToken 只对本设备签名的响应暴露，避免跨设备泄露。
      claimToken: options.revealClaimToken ? row.claimToken : null,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      result: row.resultJson,
      resultHash: row.resultHash,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}

function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }

function hasVerifiedReality(reality: DeviceTaskReality | null): boolean {
  if (!reality) return false;
  if('acquisitionId' in reality)return reality.acquisitionState==='VERIFIED_EMPTY'||reality.acquisitionState==='VERIFIED_PRESENT'&&reality.truthRecordIds.length>0;
  // recordEvidence path confirms a single candidate into Truth; a non-null
  // candidateId is only returned once `confirmCandidate` has materialized Truth.
  if ('candidateId' in reality) return reality.candidateId !== null;
  // Structured Read path: SUCCEEDED is only valid when verified Truth landed.
  // candidateIds alone means NEEDS_CONFIRMATION, never verified.
  return reality.truthRecordIds.length > 0;
}

function deviceTaskVerificationError(reality: DeviceTaskReality | null): string {
  if(reality&&'acquisitionId' in reality)return 'NATIVE_ACQUISITION_'+reality.acquisitionState;
  if (reality && 'candidateIds' in reality && reality.candidateIds.length > 0 && reality.truthRecordIds.length === 0) {
    return 'NEEDS_CONFIRMATION';
  }
  return 'RESULT_VERIFICATION_FAILED';
}
