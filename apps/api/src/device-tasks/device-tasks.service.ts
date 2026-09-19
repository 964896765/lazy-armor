import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { deviceAppConnections, deviceHeartbeats, deviceTasks } from '@lazy-armor/database';
import { realityValueHash, type JsonValue, type ParserKey, type SourceMode, type SourceObservationInput } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import { StructuredReadService } from '../structured-read/structured-read.service';
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
  ...Object.keys(DEVICE_TASK_REALITY_SPEC),
  ...STRUCTURED_READ_TASK_TYPES,
  ...AWAITING_DEVICE_EVIDENCE_TASK_TYPES,
]);

type DeviceTaskReality =
  | { observationId: string; candidateId: string | null; truth: Awaited<ReturnType<RealityPipelineService['confirmCandidate']>> | null }
  | { observationId: string; candidateIds: string[]; truthRecordIds: string[] };

@Injectable()
export class DeviceTasksService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
    private readonly pipeline: RealityPipelineService,
    private readonly trustedDevices: TrustedDevicesService,
    @Inject(forwardRef(() => StructuredReadService)) private readonly structuredRead: StructuredReadService,
  ) {}

  async enqueue(userId: string, trustedDeviceId: string, taskType: string, factKey: string, resourceType: string, payload: Record<string, unknown>) {
    if (!ALLOWED_DEVICE_TASK_TYPES.has(taskType)) throw new BadRequestException(`Unsupported device task type: ${taskType}`);
    const device = await this.trustedDevices.assertActive(userId, trustedDeviceId);
    const status = AWAITING_DEVICE_EVIDENCE_TASK_TYPES.has(taskType) ? 'AWAITING_DEVICE_EVIDENCE' : 'PENDING';
    const now = new Date();
    const id = newId();
    await this.db.insert(deviceTasks).values({
      id, userId, trustedDeviceId: device.id, deviceId: device.deviceId, taskType, factKey, resourceType,
      payloadJson: payload, status, claimToken: null, claimedAt: null, leaseExpiresAt: null,
      resultJson: null, resultHash: null, errorCode: null, createdAt: now, updatedAt: now, completedAt: null,
    });
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
      return this.toResponse((await tx.select().from(deviceTasks).where(eq(deviceTasks.id, taskId)).limit(1))[0]!, { revealClaimToken: true });
    });
  }

  async heartbeat(userId: string, trustedDeviceId: string, deviceId: string, taskId: string, claimToken: string) {
    const task = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
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

  async complete(userId: string, trustedDeviceId: string, deviceId: string, taskId: string, claimToken: string, result: Record<string, unknown>) {
    const task = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
    this.assertClaim(task, claimToken);
    if (task.status !== 'CLAIMED' && task.status !== 'RUNNING') throw new ConflictException('Device task is not running');
    const resultHash = realityValueHash(result);
    if (!ALLOWED_DEVICE_TASK_TYPES.has(task.taskType)) {
      await this.markVerificationFailed(task, result, resultHash, 'UNSUPPORTED_TASK_TYPE');
      throw new BadRequestException('Unsupported device task type');
    }
    const spec = DEVICE_TASK_REALITY_SPEC[task.taskType];
    let reality: DeviceTaskReality | null = null;
    if (STRUCTURED_READ_TASK_TYPES.has(task.taskType)) {
      try {
        reality = await this.structuredRead.ingestDeviceResult(userId, task, result);
      } catch {
        await this.markVerificationFailed(task, result, resultHash);
        throw new BadRequestException('Device task result failed structured read verification');
      }
    } else if (spec) {
      try {
        reality = await this.recordEvidence(userId, task, spec, result, resultHash);
      } catch {
        await this.markVerificationFailed(task, result, resultHash);
        throw new BadRequestException('Device task result failed verification');
      }
    }
    if (!hasVerifiedReality(reality)) {
      await this.markVerificationFailed(task, result, resultHash);
      throw new BadRequestException('Device task result produced no verified reality');
    }
    const now = new Date();
    const [updated] = await this.db.update(deviceTasks).set({ status: 'SUCCEEDED', resultJson: result, resultHash, errorCode: null, completedAt: now, updatedAt: now })
      .where(and(
        eq(deviceTasks.id, taskId), eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, trustedDeviceId), eq(deviceTasks.deviceId, deviceId),
        eq(deviceTasks.claimToken, claimToken), inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), gte(deviceTasks.leaseExpiresAt, now),
      ));
    if (updated.affectedRows !== 1) throw new ConflictException('Device task claim is no longer active');
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'DEVICE_TASK_SUCCEEDED', resourceType: 'device_task', resourceId: taskId,
      userId, correlationId: taskId, changeSummary: 'Edge device task completed with verified evidence', source: 'api', result: 'success',
    });
    const updatedRow = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
    return { ...this.toResponse(updatedRow, { revealClaimToken: true }), reality };
  }

  async fail(userId: string, trustedDeviceId: string, deviceId: string, taskId: string, claimToken: string, errorCode: string) {
    const task = await this.getRowForDevice(userId, trustedDeviceId, deviceId, taskId);
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
    const [result] = await this.db.update(deviceTasks).set({ status: 'PENDING', claimToken: null, claimedAt: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), lt(deviceTasks.leaseExpiresAt, now)));
    return { recovered: result.affectedRows };
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

  private async markVerificationFailed(task: typeof deviceTasks.$inferSelect, result: Record<string, unknown>, resultHash: string, errorCode = 'RESULT_VERIFICATION_FAILED') {
    if (!task.claimToken) return;
    const now = new Date();
    const [updated] = await this.db.update(deviceTasks).set({ status: 'FAILED', resultJson: result, resultHash, errorCode, completedAt: now, updatedAt: now })
      .where(and(
        eq(deviceTasks.id, task.id), eq(deviceTasks.userId, task.userId), eq(deviceTasks.trustedDeviceId, task.trustedDeviceId), eq(deviceTasks.deviceId, task.deviceId),
        eq(deviceTasks.claimToken, task.claimToken), inArray(deviceTasks.status, ['CLAIMED', 'RUNNING']), gte(deviceTasks.leaseExpiresAt, now),
      ));
    if (updated.affectedRows !== 1) return;
    await this.audit.append({
      actorType: 'system', actorUserId: null, action: 'DEVICE_TASK_FAILED', resourceType: 'device_task', resourceId: task.id,
      userId: task.userId, correlationId: task.id, reasonCode: errorCode, changeSummary: 'Device task result failed reality pipeline verification', source: 'api', result: 'failure',
    });
  }

  private async recordEvidence(userId: string, task: typeof deviceTasks.$inferSelect, spec: DeviceTaskRealitySpec, result: Record<string, unknown>, resultHash: string) {
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
    const observed = await this.pipeline.ingest(userId, input);
    const candidate = observed.candidates[0];
    if (!candidate) return { observationId: observed.observationId, candidateId: null, truth: null };
    const truth = await this.pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'device_evidence', verificationMethod: 'DEVICE_READ_BACK' });
    return { observationId: observed.observationId, candidateId: candidate.id, truth };
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
  if ('candidateId' in reality) return reality.candidateId !== null;
  return reality.candidateIds.length > 0 || reality.truthRecordIds.length > 0;
}
