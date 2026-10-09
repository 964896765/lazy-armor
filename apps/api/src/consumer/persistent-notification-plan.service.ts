import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { auditLogs, deviceAppConnections, deviceTasks,deviceHeartbeats,localCapabilityStates,runtimeTargets, executionSteps, executions, mobileNotificationReceipts, notifications, planCreationContracts, plans, planVersions, strategyRuntimeBindings, strategyRuntimeWakeups, truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { catalogHash, compileNotificationWatchAuthoring, definitionHash,localCapabilityAvailability, notificationWatchAuthoringSchema, realityValueHash, type NotificationWatchAuthoring } from '@lazy-armor/plan-schema';
import { createHash } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';
import { trustedDevices } from '@lazy-armor/database';

type Tx = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
type ReadStore = Pick<InjectedDatabase, 'select'>;
export type PlanNotificationRead = { schema: 'plan-notification-read.v1'; planId: string; planVersionId: string; contractId: string; bindingId: string; connectionId: string; trustedDeviceId: string; targetId: string; authorityEpoch: number; sourceVersion: string; attempt: number; windowKey: string };
const checkpointAction = 'PERSISTENT_NOTIFICATION_RESOURCE_STATE';
// Existing worker ticks recompute this source window. A confirmed watch keeps
// acquiring new reality without creating another scheduler or PlanVersion.
const READ_WINDOW_MS = 5 * 60_000;

/** Adapter on the existing Plan and DeviceTask authorities. No new scheduler or mutable PlanVersion. */
@Injectable()
export class PersistentNotificationPlanService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly modules: ModuleRef, private readonly audit: AuditService) {}

  async sources(userId: string) {
    const rows = await this.db.select({ app: deviceAppConnections, device: trustedDevices }).from(deviceAppConnections)
      .innerJoin(trustedDevices, and(eq(trustedDevices.id, deviceAppConnections.trustedDeviceId), eq(trustedDevices.userId, userId)))
      .where(and(eq(deviceAppConnections.userId, userId), eq(deviceAppConnections.packageName, 'com.jingdong.app.mall'), eq(trustedDevices.status, 'active')));
    return rows.filter(({ app, device }) => !device.revokedAt && app.launchable && app.lastSeenAt && Date.now() - app.lastSeenAt.getTime() <= 300_000)
      .map(({ app, device }) => ({ connectionId: app.id, trustedDeviceId: device.id, sourcePackage: app.packageName }));
  }

  async assertSourceIdentity(userId: string, parameters: NotificationWatchAuthoring, store: ReadStore = this.db) {
    const source = (await store.select({ app: deviceAppConnections, device: trustedDevices }).from(deviceAppConnections)
      .innerJoin(trustedDevices, and(eq(trustedDevices.id, deviceAppConnections.trustedDeviceId), eq(trustedDevices.userId, userId)))
      .where(and(eq(deviceAppConnections.id, parameters.connectionId), eq(deviceAppConnections.userId, userId), eq(trustedDevices.id, parameters.trustedDeviceId))).limit(1))[0];
    if (!source || source.app.packageName !== parameters.sourcePackage || !source.app.launchable || source.device.status !== 'active' || source.device.revokedAt) throw new ConflictException('NOTIFICATION_WATCH_SOURCE_IDENTITY_CHANGED');
    return source;
  }

  /** Used in the DeviceTask row lock, before claim and terminal commit. */
  async assertTask(tx: Pick<Tx,'select'|'insert'|'update'>, userId: string, task: typeof deviceTasks.$inferSelect) {
    const origin = task.payloadJson.planNotificationRead as PlanNotificationRead | undefined;
    if (!origin || origin.schema !== 'plan-notification-read.v1' || task.taskType !== 'NATIVE_NOTIFICATION_READ') throw new ConflictException('PLAN_NOTIFICATION_ORIGIN_REQUIRED');
    const bundle = await this.owned(userId, origin.planVersionId, tx);
    if (!bundle || bundle.plan.id !== origin.planId || bundle.contract.id !== origin.contractId || bundle.binding.id !== origin.bindingId || bundle.parameters.connectionId !== origin.connectionId || bundle.parameters.trustedDeviceId !== origin.trustedDeviceId || task.trustedDeviceId !== origin.trustedDeviceId || task.payloadJson.sourcePackage !== bundle.parameters.sourcePackage || task.payloadJson.sourceId !== 'device-app:' + origin.connectionId) throw new ConflictException('PLAN_NOTIFICATION_ORIGIN_MISMATCH');
    const expected = this.taskId(userId, origin.trustedDeviceId, this.key(origin));
    if (task.id !== expected || !Number.isSafeInteger(origin.attempt) || origin.attempt < 1 || origin.attempt>3||origin.windowKey !== this.windowKey(Number(task.payloadJson.scopeEnd)) || !Number.isSafeInteger(task.payloadJson.scopeStart) || !Number.isSafeInteger(task.payloadJson.scopeEnd) || Number(task.payloadJson.scopeEnd) - Number(task.payloadJson.scopeStart) > bundle.parameters.lookbackHours * 3600000 || Number(task.payloadJson.scopeStart) >= Number(task.payloadJson.scopeEnd)) throw new ConflictException('PLAN_NOTIFICATION_ATTEMPT_MISMATCH');
    const reservation=(await tx.select().from(auditLogs).where(and(eq(auditLogs.userId,userId),eq(auditLogs.resourceId,origin.planVersionId),eq(auditLogs.action,'PERSISTENT_NOTIFICATION_READ_RESERVED'),eq(auditLogs.actorType,'system'),eq(auditLogs.source,'system'),eq(auditLogs.correlationId,expected))).limit(1).for('update'))[0];
    if(!reservation||catalogHash(reservation.afterSnapshotJson)!==catalogHash(task.payloadJson))throw new ConflictException('PLAN_NOTIFICATION_RESERVATION_REQUIRED');
    const device=(await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id,origin.trustedDeviceId),eq(trustedDevices.userId,userId))).for('update'))[0];
    const app=(await tx.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.id,origin.connectionId),eq(deviceAppConnections.userId,userId))).for('update'))[0];
    const grant=(await tx.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,origin.trustedDeviceId),eq(localCapabilityStates.capability,'notification.read'))).for('update'))[0];
    const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.id,origin.targetId),eq(runtimeTargets.userId,userId))).for('update'))[0];
    const heartbeat=(await tx.select().from(deviceHeartbeats).where(and(eq(deviceHeartbeats.userId,userId),eq(deviceHeartbeats.trustedDeviceId,origin.trustedDeviceId))).limit(1))[0];
    if(!device||device.status!=='active'||device.revokedAt||!app||app.trustedDeviceId!==device.id||app.updatedAt.toISOString()!==origin.sourceVersion||!app.enabled||!app.modesJson.includes('notification_read')||!app.launchable||!app.lastSeenAt||Date.now()-app.lastSeenAt.getTime()>300000||!grant||localCapabilityAvailability({key:grant.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},Date.now())!=='AVAILABLE'||!target||target.authorityEpoch!==origin.authorityEpoch||target.backingRef!==device.id||target.health==='UNAVAILABLE'||!heartbeat||heartbeat.deviceId!==device.deviceId||heartbeat.onlineState!=='online'||Date.now()-heartbeat.lastHeartbeatAt.getTime()>30000)throw new ConflictException('STALE_PLAN_NOTIFICATION_AUTHORITY');
    const expectedBinding={schema:'notification-source-binding.v1',deviceAppConnectionId:origin.connectionId,trustedDeviceId:origin.trustedDeviceId,targetId:origin.targetId,authorityEpoch:origin.authorityEpoch,sourceVersion:origin.sourceVersion,sourcePackage:bundle.parameters.sourcePackage};
    if(catalogHash(task.payloadJson.notificationSourceBinding)!==catalogHash(expectedBinding))throw new ConflictException('PLAN_NOTIFICATION_SOURCE_BINDING_MISMATCH');
    return bundle;
  }

  /** Called by the existing execution-worker tick. Resource restoration never recreates a Plan. */
  async recover(userId?: string) {
    const rows = await this.db.select({ versionId: planCreationContracts.planVersionId, userId: plans.userId }).from(planCreationContracts)
      .innerJoin(plans, and(eq(plans.id, planCreationContracts.planId), eq(plans.activeVersionId, planCreationContracts.planVersionId), eq(plans.status, 'active')))
      .where(and(sql`JSON_UNQUOTE(JSON_EXTRACT(${planCreationContracts.goalJson}, '$.constraints.recipeKey')) = 'notification.shipment-watch.v1'`, ...(userId ? [eq(plans.userId, userId)] : []))).limit(32);
    for (const row of rows) {
      try { await this.resume(row.userId, row.versionId); } catch (error) {
        if ((error as { getStatus?: () => number }).getStatus?.() === 409) await this.checkpoint(row.userId, row.versionId, 'WAITING_RESOURCE', ['FROZEN_NOTIFICATION_AUTHORITY_CHANGED']);
        else throw error;
      }
    }
  }

  async resume(userId: string, versionId: string) {
    const bundle = await this.owned(userId, versionId);
    if (!bundle) return;
    const {FactDemandResolverService}=await import('../fact-demands/fact-demand-resolver.service');
    const resolution = await this.modules.get(FactDemandResolverService, { strict: false }).resolveNotificationQuery(userId, bundle.parameters.sourcePackage);
    const tasks = await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.userId, userId), eq(deviceTasks.taskType, 'NATIVE_NOTIFICATION_READ'), sql`JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.planNotificationRead.planVersionId')) = ${versionId}`)).orderBy(desc(deviceTasks.createdAt), desc(deviceTasks.id));
    const latest = tasks[0];
    const windowKey = this.windowKey(Date.now());
    const priorOrigin = latest?.payloadJson.planNotificationRead as PlanNotificationRead | undefined;
    const sameWindow = priorOrigin?.windowKey === windowKey;
    const selected = resolution.selected;
    if (!selected || selected.connectionId !== bundle.parameters.connectionId || selected.trustedDeviceId !== bundle.parameters.trustedDeviceId) {
      await this.checkpoint(userId, versionId, 'WAITING_RESOURCE', selected ? ['FROZEN_SOURCE_CHANGED'] : resolution.reasons, latest?.id); return;
    }
    const state = await this.latestCheckpoint(userId, versionId);
    if(latest?.status==='SUCCEEDED'){
      const origin=latest.payloadJson.planNotificationRead as PlanNotificationRead;
      if((origin.authorityEpoch!==selected.authorityEpoch||origin.sourceVersion!==selected.sourceVersion)&&state?.state!=='WAITING_RESOURCE'){await this.checkpoint(userId,versionId,'WAITING_RESOURCE',['STALE_COMPLETED_READ_AUTHORITY'],latest.id);return;}
    }
    if (latest && ['PENDING', 'CLAIMED', 'RUNNING'].includes(latest.status)) {
      const origin = latest.payloadJson.planNotificationRead as PlanNotificationRead;
      if (origin.authorityEpoch !== selected.authorityEpoch || origin.sourceVersion !== selected.sourceVersion) {
        // Read-only authority loss closes this attempt without changing any Result or Truth.
        await this.db.transaction(async tx => {
          const task = (await tx.select().from(deviceTasks).where(eq(deviceTasks.id, latest.id)).for('update'))[0];
          if (task && ['PENDING', 'CLAIMED', 'RUNNING'].includes(task.status) && !task.resultJson) {
            await tx.update(deviceTasks).set({ status: 'FAILED', errorCode: 'STALE_PLAN_NOTIFICATION_AUTHORITY', completedAt: new Date(), updatedAt: new Date() }).where(eq(deviceTasks.id, task.id));
            await this.audit.append({ actorType: 'system', userId, action: 'PERSISTENT_NOTIFICATION_READ_FENCED', resourceType: 'device_task', resourceId: task.id, correlationId: versionId, source: 'system', result: 'blocked', reasonCode: 'STALE_PLAN_NOTIFICATION_AUTHORITY', changeSummary: 'Expired notification source authority fenced a read attempt; no Result or Truth changed' }, tx);
          }
        });
        await this.checkpoint(userId, versionId, 'WAITING_RESOURCE', ['STALE_PLAN_NOTIFICATION_AUTHORITY'], latest.id); return;
      }
      await this.checkpoint(userId, versionId, 'READ_PENDING', [], latest.id); return;
    }
    if (latest?.status === 'SUCCEEDED' && state?.state !== 'WAITING_RESOURCE' && sameWindow) {
      await this.assessRead(userId, versionId, latest); return;
    }
    if (latest?.status === 'FAILED' && state?.state !== 'WAITING_RESOURCE' && sameWindow) {
      await this.checkpoint(userId, versionId, 'READ_FAILED', [latest.errorCode ?? 'NOTIFICATION_READ_FAILED'], latest.id); return;
    }
    const attempt = sameWindow ? (priorOrigin?.attempt ?? 0) + 1 : 1;
    if(attempt>3){await this.checkpoint(userId,versionId,'READ_FAILED',['NOTIFICATION_READ_ATTEMPT_LIMIT'],latest?.id);return;}
    const origin: PlanNotificationRead = { schema: 'plan-notification-read.v1', planId: bundle.plan.id, planVersionId: versionId, contractId: bundle.contract.id, bindingId: bundle.binding.id, connectionId: selected.connectionId, trustedDeviceId: selected.trustedDeviceId, targetId: selected.targetId, authorityEpoch: selected.authorityEpoch, sourceVersion: selected.sourceVersion, attempt, windowKey };
    const reservation=await this.reserveRead(userId,bundle,origin);
    if(!reservation){await this.checkpoint(userId,versionId,'READ_FAILED',['NOTIFICATION_READ_ATTEMPT_LIMIT'],latest?.id);return;}
    const reservedOrigin=reservation.planNotificationRead as PlanNotificationRead;
    const {DeviceTasksService}=await import('../device-tasks/device-tasks.service');
    const task = await this.modules.get(DeviceTasksService, { strict: false }).enqueue(userId, selected.trustedDeviceId, 'NATIVE_NOTIFICATION_READ', 'shipment.status', 'shipment', reservation, this.key(reservedOrigin));
    await this.checkpoint(userId, versionId, 'READ_PENDING', [], task.id, { attempt: reservedOrigin.attempt, windowKey: reservedOrigin.windowKey, failedReadRefs: tasks.filter(t => t.status === 'FAILED').map(t => t.id) });
  }

  private async assessRead(userId: string, versionId: string, task: typeof deviceTasks.$inferSelect) {
    const result = task.resultJson;
    if (!result || realityValueHash(result) !== task.resultHash) throw new ConflictException('PLAN_NOTIFICATION_READ_RESULT_INVALID');
    const items = Array.isArray(result.items) ? result.items as Array<{ eventId?: string }> : [];
    const origin = task.payloadJson.planNotificationRead as PlanNotificationRead;
    const receipts = await this.db.select().from(mobileNotificationReceipts).where(and(eq(mobileNotificationReceipts.userId, userId), eq(mobileNotificationReceipts.deviceAppConnectionId, origin.connectionId)));
    const relevant = receipts.filter(r => items.some(i => i.eventId === r.eventId));
    const pending = relevant.filter(r => r.status === 'received_unclassified');
    await this.checkpoint(userId, versionId, pending.length ? 'WAITING_FACT_CONFIRMATION' : 'WAITING_FACT_CHANGE', [], task.id, { acquisitionState: result.state, itemCount: result.itemCount, pendingReceiptRefs: pending.map(r => r.id), verifiedReceiptRefs: relevant.filter(r => r.status === 'verified').map(r => r.id), nextBestAction: pending.length ? 'ASK_USER' : 'WAIT' });
  }

  /** Local in-app delivery has real step/notification evidence, not a fabricated external Ledger. */
  async continueLocalResults(userId?: string) {
    const rows = await this.db.select({ execution: executions, wakeup: strategyRuntimeWakeups, contract: planCreationContracts }).from(executions)
      .innerJoin(strategyRuntimeWakeups, eq(strategyRuntimeWakeups.handoffExecutionId, executions.id))
      .innerJoin(planCreationContracts, and(eq(planCreationContracts.planVersionId, executions.planVersionId), eq(planCreationContracts.userId, executions.userId)))
      .where(and(eq(executions.status, 'succeeded'), sql`JSON_UNQUOTE(JSON_EXTRACT(${planCreationContracts.goalJson}, '$.constraints.recipeKey')) = 'notification.shipment-watch.v1'`, ...(userId ? [eq(executions.userId, userId)] : []))).orderBy(asc(executions.finishedAt)).limit(32);
    for (const { execution, wakeup } of rows) await this.db.transaction(async tx => {
      const done = (await tx.select().from(auditLogs).where(and(eq(auditLogs.userId, execution.userId), eq(auditLogs.action, 'PERSISTENT_NOTIFICATION_RESULT_REEVALUATED'), eq(auditLogs.resourceId, execution.id))).limit(1))[0];
      if (done) return;
      const bundle = await this.owned(execution.userId, execution.planVersionId!, tx); if (!bundle) return;
      const proof = execution.resolvedRiskSnapshotJson?.truthHandoffProof as { truthRecordId?: string; truthVersionId?: string; truthValueHash?: string } | undefined;
      const truth = proof && (await tx.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecordVersions).innerJoin(truthRecords, and(eq(truthRecords.id, truthRecordVersions.truthRecordId), eq(truthRecords.userId, execution.userId))).where(eq(truthRecordVersions.id, proof.truthVersionId!)).limit(1))[0];
      const steps = await tx.select().from(executionSteps).where(eq(executionSteps.executionId, execution.id));
      const delivered = await tx.select().from(notifications).where(and(eq(notifications.userId, execution.userId), eq(notifications.executionId, execution.id), eq(notifications.eventType, 'logistics_exception')));
      if (!truth || truth.record.id !== proof!.truthRecordId || truth.record.currentVersionId!==truth.version.id||truth.record.status !== 'verified' || truth.record.revokedAt || truth.version.valueHash !== proof!.truthValueHash || steps.length !== 3 || steps.some(s => s.status !== 'succeeded') || !steps.some(s => s.actionType === 'notify' && s.outputSnapshotJson?.notified === true) || !delivered.length) return;
      await this.audit.append({ actorType: 'system', userId: execution.userId, executionId: execution.id, action: 'PERSISTENT_NOTIFICATION_RESULT_REEVALUATED', resourceType: 'execution', resourceId: execution.id, correlationId: bundle.plan.id, causationId: wakeup.id, source: 'system', result: 'success', after: { planId: bundle.plan.id, planVersionId: execution.planVersionId, state: 'WAITING_FACT_CHANGE', nextBestAction: 'WAIT', truthVersionId: truth.version.id, stepRefs: steps.map(s => s.id), notificationRefs: delivered.map(n => n.id), ledgerBoundary: 'PERSISTED_IN_APP_NOTIFICATION' }, changeSummary: 'Verified source Truth and persisted in-app notification completed this occurrence; original Plan waits for the next source fact' }, tx);
    });
  }

  private async owned(userId: string, versionId: string, store: ReadStore = this.db) {
    if(store!==this.db){const locked=(await store.select().from(plans).where(and(eq(plans.userId,userId),eq(plans.activeVersionId,versionId))).for('update'))[0];if(!locked||locked.status!=='active')return null;}
    const query = store.select({ plan: plans, version: planVersions, contract: planCreationContracts, binding: strategyRuntimeBindings }).from(plans)
      .innerJoin(planVersions, eq(planVersions.id, plans.activeVersionId))
      .innerJoin(planCreationContracts, and(eq(planCreationContracts.planVersionId, planVersions.id), eq(planCreationContracts.userId, userId)))
      .innerJoin(strategyRuntimeBindings, and(eq(strategyRuntimeBindings.planVersionId, planVersions.id), eq(strategyRuntimeBindings.userId, userId)))
      .where(and(eq(plans.userId, userId), eq(plans.status, 'active'), eq(planVersions.id, versionId))).limit(1);
    const row=(await (store===this.db?query:query.for('update')))[0];
    if (!row || (row.contract.goalJson.constraints as Record<string, unknown>)?.recipeKey !== 'notification.shipment-watch.v1') return null;
    const parameters = notificationWatchAuthoringSchema.parse(JSON.parse(String((row.contract.goalJson.constraints as Record<string, unknown>).notificationWatchJson)));
    const compiled = compileNotificationWatchAuthoring(row.contract.scenarioKey, parameters, row.version.name);
    const assembled = await this.modules.get(PlanDefinitionAssembler, { strict: false }).assembleById(userId, row.plan.id, versionId, store);
    if (assembled.computedHash !== row.version.definitionHash || definitionHash(compiled.definition) !== row.version.definitionHash || row.binding.runtimeHash !== compiled.runtime.runtimeHash || catalogHash(row.binding.runtimeJson) !== catalogHash(compiled.runtime)) throw new ConflictException('PLAN_NOTIFICATION_INTEGRITY_MISMATCH');
    await this.assertSourceIdentity(userId, parameters, store);
    return { ...row, parameters };
  }

  private async reserveRead(userId:string,bundle:NonNullable<Awaited<ReturnType<PersistentNotificationPlanService['owned']>>>,proposed:PlanNotificationRead){
    return this.db.transaction(async tx=>{
      const plan=(await tx.select().from(plans).where(and(eq(plans.id,bundle.plan.id),eq(plans.userId,userId))).for('update'))[0];
      if(!plan||plan.status!=='active'||plan.activeVersionId!==proposed.planVersionId)throw new ConflictException('PLAN_NOTIFICATION_VERSION_INACTIVE');
      const previous=(await tx.select().from(auditLogs).where(and(eq(auditLogs.userId,userId),eq(auditLogs.resourceId,proposed.planVersionId),eq(auditLogs.action,'PERSISTENT_NOTIFICATION_READ_RESERVED'))).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)).limit(1).for('update'))[0];
      const previousPayload=previous?.afterSnapshotJson as Record<string,unknown>|undefined,previousOrigin=previousPayload?.planNotificationRead as PlanNotificationRead|undefined;
      const scopeEnd=Date.now(),scopeStart=scopeEnd-bundle.parameters.lookbackHours*3600000,windowKey=this.windowKey(scopeEnd);
      const sameAuthority=previousOrigin?.authorityEpoch===proposed.authorityEpoch&&previousOrigin?.sourceVersion===proposed.sourceVersion;
      if(previousOrigin&&sameAuthority){
        const previousTask=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,this.taskId(userId,previousOrigin.trustedDeviceId,this.key(previousOrigin))),eq(deviceTasks.userId,userId))).limit(1).for('update'))[0];
        if(previousTask&&['PENDING','CLAIMED','RUNNING'].includes(previousTask.status))return previousPayload!;
      }
      // Concurrent worker ticks may hold an older read snapshot. Reuse the
      // reservation when an equivalent window was already durably reserved.
      if(previousOrigin&&previousOrigin.windowKey===windowKey&&sameAuthority&&(proposed.windowKey!==windowKey||previousOrigin.attempt>=proposed.attempt))return previousPayload!;
      const attempt=Math.max(proposed.windowKey===windowKey?proposed.attempt:1,previousOrigin?.windowKey===windowKey?(previousOrigin.attempt+1):1);
      if(attempt>3)return null;
      const origin={...proposed,attempt,windowKey};
      const payload={planNotificationRead:origin,notificationSourceBinding:{schema:'notification-source-binding.v1',deviceAppConnectionId:origin.connectionId,trustedDeviceId:origin.trustedDeviceId,targetId:origin.targetId,authorityEpoch:origin.authorityEpoch,sourceVersion:origin.sourceVersion,sourcePackage:bundle.parameters.sourcePackage},sourcePackage:bundle.parameters.sourcePackage,sourceId:'device-app:'+origin.connectionId,scopeStart,scopeEnd};
      await this.audit.append({actorType:'system',userId,action:'PERSISTENT_NOTIFICATION_READ_RESERVED',resourceType:'plan_version',resourceId:origin.planVersionId,correlationId:this.taskId(userId,origin.trustedDeviceId,this.key(origin)),source:'system',result:'pending',after:payload,changeSummary:'Frozen read scope and attempt identity before existing DeviceTask dispatch'},tx);
      return payload;
    });
  }

  private windowKey(now: number) { return `source-watch:${Math.floor(now / READ_WINDOW_MS)}`; }
  private key(origin: PlanNotificationRead) { return `notification-plan:${origin.planVersionId}:${origin.windowKey}:${origin.attempt}`; }
  private taskId(userId: string, deviceId: string, key: string) { const digest = createHash('sha256').update(`${userId}:${deviceId}:NATIVE_NOTIFICATION_READ:${key}`).digest('hex'); return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`; }
  private async latestCheckpoint(userId: string, versionId: string) { const row = (await this.db.select().from(auditLogs).where(and(eq(auditLogs.userId, userId), eq(auditLogs.action, checkpointAction), eq(auditLogs.resourceId, versionId))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1))[0]; return row?.afterSnapshotJson as { state?: string; reasons?: string[]; taskId?: string } | undefined; }
  private async checkpoint(userId: string, versionId: string, state: string, reasons: string[], taskId?: string, extra: Record<string, unknown> = {}) { const snapshot = { schema: 'plan-notification-gap.v1', planVersionId: versionId, state, reasons, taskId: taskId ?? null, ...extra }; const latest = await this.latestCheckpoint(userId, versionId); if (latest && catalogHash(latest) === catalogHash(snapshot)) return; await this.audit.append({ actorType: 'system', userId, action: checkpointAction, resourceType: 'plan_version', resourceId: versionId, source: 'system', result: state === 'WAITING_RESOURCE' || state === 'READ_FAILED' ? 'blocked' : 'pending', after: snapshot, changeSummary: 'Current availability re-evaluated the original confirmed notification Plan; historical tasks and source contract retained' }); }
}
