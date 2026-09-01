import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry, resolveSideEffectContract, type SideEffectContract } from '@lazy-armor/connector-sdk';
import { executionSteps, executions, outboxMessages, plans, sideEffectOperations } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { AuditService } from '../../audit/audit.service';
import { SnapshotSanitizer } from '../../common/snapshot-sanitizer.service';
import { NotificationService } from '../../notifications/notification.service';
import { ExecutionEventService } from '../execution-event.service';
import { ExecutionPolicyService } from '../execution-policy.service';
import { ExecutionResultResolver } from '../execution-result-resolver.service';
import { ExecutionStateService } from '../execution-state.service';
import { ExecutionStepStateService } from '../execution-step-state.service';
import { RuntimeConnectionGuard } from '../runtime-connection-guard.service';
import { asRuntimeError, ExecutionRuntimeError, EXECUTION_TERMINAL_STATES, type ExecutionStatus } from '../execution.types';
import { QueueService } from '../../infrastructure/queue.service';
import { workerEnabled } from '../../common/app-role';
import { OutboxService } from './outbox.service';
import { SideEffectOperationsService } from './side-effect-operations.service';

const MAX_OUTBOX_ATTEMPTS = 5;
const RETRY_BASE_MS = 200;
const RETRY_MAX_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;
const CLAIM_BATCH = 8;
const WORKER_ID = () => `outbox-${process.pid}`;
// 审批后仍不可覆盖的运行权限阻断码：直接受控失败，绝不无限重试。
const BLOCKING_CODES = new Set(['CONNECTION_REVOKED', 'CONNECTION_EXPIRED', 'CONNECTION_UNAVAILABLE', 'CONNECTION_NOT_OWNED', 'CAPABILITY_NOT_FOUND', 'CAPABILITY_NOT_GRANTED', 'PERMISSION_REVOKED', 'PERMISSION_EXPIRED', 'CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED']);

@Injectable()
export class OutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly outbox: OutboxService,
    private readonly operations: SideEffectOperationsService,
    private readonly registry: ConnectorRegistry,
    private readonly guard: RuntimeConnectionGuard,
    private readonly stepStates: ExecutionStepStateService,
    private readonly states: ExecutionStateService,
    private readonly resultResolver: ExecutionResultResolver,
    private readonly events: ExecutionEventService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly sanitizer: SnapshotSanitizer,
    private readonly policy: ExecutionPolicyService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('outbox-worker')) return;
    this.timer = setInterval(() => void this.poll().catch(() => undefined), POLL_INTERVAL_MS);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  readiness() { return { ready: Boolean(this.timer), reason: this.timer ? null : 'outbox_worker_not_running' }; }

  // §22：claim 由 FOR UPDATE SKIP LOCKED 保证多个 Worker 只有一个获得执行权。
  async poll() {
    const claimed = await this.outbox.claim(CLAIM_BATCH, WORKER_ID());
    let processed = 0;
    for (const message of claimed) {
      try {
        await this.process(message);
        processed += 1;
      } catch {
        // 单条失败不阻塞其余消息；lease 过期后会被重新 claim。
        await this.releaseForRecovery(message.id).catch(() => undefined);
      }
    }
    return { claimed: claimed.length, processed };
  }

  private async releaseForRecovery(id: string) {
    await this.db.update(outboxMessages).set({ status: 'retry_wait', lockedBy: null, lockExpiresAt: null, nextAttemptAt: new Date(Date.now() + 1_000), updatedAt: new Date() }).where(eq(outboxMessages.id, id));
  }

  async process(message: typeof outboxMessages.$inferSelect) {
    const payload = message.payloadJson as { operationId: string; executionStepId: string; executionId: string; userId: string };
    // §25：Dispatch 前重新校验 payload hash；被篡改的消息立即进入 Dead Letter，绝不出站。
    try {
      await this.outbox.assertPayloadIntegrity(message.id, payload);
    } catch (error) {
      const mapped = asRuntimeError(error);
      await this.outbox.markDead(message.id, mapped.code, this.sanitizer.sanitizeText(mapped));
      await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_PAYLOAD_INTEGRITY_FAILURE', resourceType: 'outbox_message', resourceId: message.id, userId: message.userId, executionId: payload.executionId, executionStepId: payload.executionStepId, outboxMessageId: message.id, correlationId: message.correlationId, causationId: payload.operationId, source: 'outbox_worker', result: 'blocked', reasonCode: mapped.code });
      return;
    }
    const operation = await this.operations.get(payload.operationId);
    if (!operation) {
      await this.outbox.markDead(message.id, 'OPERATION_NOT_FOUND', 'SideEffectOperation no longer exists');
      return;
    }
    // §23 Redelivery：Operation 已成功 → 不创建第二个业务动作，直接 published。
    if (operation.status === 'succeeded') {
      await this.outbox.markPublished(message.id);
      // §63 恢复：DB 已成功但 Execution 尚未 finalize（崩溃），Redelivery 需推进 Execution。
      const execRow = (await this.db.select({ status: executions.status }).from(executions).where(eq(executions.id, payload.executionId)).limit(1))[0];
      if (execRow && !EXECUTION_TERMINAL_STATES.has(execRow.status as ExecutionStatus)) {
        await this.resumeExecution(operation.userId, payload.executionId);
      }
      return;
    }
    // 终态不可重放。
    if (operation.status === 'outcome_unknown' || operation.status === 'cancelled') {
      await this.outbox.markDead(message.id, `OPERATION_${operation.status.toUpperCase()}`, 'Operation reached a terminal state that cannot be redelivered');
      return;
    }
    await this.dispatch(operation, message);
  }

  private async dispatch(operation: typeof sideEffectOperations.$inferSelect, message: typeof outboxMessages.$inferSelect) {
    const payload = message.payloadJson as { operationId: string; executionStepId: string; executionId: string };
    let contract: SideEffectContract | null = null;
    try {
      // §56：Plan 不再 active，不得派发外部副作用。
      const execution = (await this.db.select({ planId: executions.planId, cancellationRequestedAt: executions.cancellationRequestedAt }).from(executions).where(eq(executions.id, payload.executionId)).limit(1))[0];
      const plan = execution ? (await this.db.select({ status: plans.status }).from(plans).where(and(eq(plans.id, execution.planId), eq(plans.userId, operation.userId))).limit(1))[0] : null;
      if (execution?.cancellationRequestedAt) {
        await this.cancelOperation(operation, message, 'CANCELLED_BEFORE_DISPATCH', payload.executionId);
        return;
      }
      if (!plan || plan.status !== 'active') {
        await this.failOperation(operation, message, 'PLAN_NOT_ACTIVE', 'Plan is no longer active');
        return;
      }
      // §17 Runtime Security Recheck：再次检查 Connection/Permission/Credential（Approval 永远不能覆盖 Permission）。
      let connectorKey: string;
      if (operation.connectionId && operation.capabilityKey) {
        const checked = await this.guard.assertUsable(operation.userId, operation.connectionId, operation.capabilityKey);
        connectorKey = checked.connectorKey;
      } else {
        throw new ExecutionRuntimeError('SAFETY_GATE_REQUIRES_IDEMPOTENCY', 'Side effect cannot be dispatched without a bound Connection and Capability');
      }
      // §42/§43：Side Effect Contract 解析；未知能力默认最保守。
      const capability = this.registry.capability(connectorKey, operation.capabilityKey);
      contract = capability ? resolveSideEffectContract(capability) : null;
      const connector = this.registry.get(connectorKey);
      const rebuilt = await this.operations.rebuildRequest(operation.executionStepId);
      await this.events.append(payload.executionId, 'side_effect_dispatch_started', { operationId: operation.id, attempt: operation.attemptCount + 1 }, operation.executionStepId);
      await this.stepStates.transition(operation.executionStepId, 'running', { dispatchStatus: 'executing' });
      await this.operations.mark(operation.id, { status: 'executing', attemptCount: operation.attemptCount + 1, startedAt: operation.startedAt ?? new Date(), errorCode: null, errorMessage: null });
      const result = await connector.execute?.({
        capability: operation.capabilityKey!,
        input: { context: rebuilt.triggerPayload, config: rebuilt.actionConfig },
        requestId: rebuilt.requestId,
        idempotencyKey: operation.idempotencyKey,
        providerIdempotencyKey: operation.providerIdempotencyKey ?? undefined,
        operationId: operation.providerOperationId ?? undefined,
      });
      if (!result) throw new ExecutionRuntimeError('ACTION_RUNTIME_NOT_IMPLEMENTED', 'Connector does not implement execute');
      if (!result.ok) {
        // Provider 明确拒绝：已知失败，不自动盲重试（§13）。
        await this.failOperation(operation, message, 'PROVIDER_REJECTED', 'Provider rejected the side effect operation');
        return;
      }
      await this.succeedOperation(operation, message, result.data, rebuilt.executionId);
    } catch (error) {
      const mapped = asRuntimeError(error);
      // 审批后权限/连接/凭证变化 → 受控失败，绝不无限重试（§53-55）。
      if (BLOCKING_CODES.has(mapped.code)) {
        await this.failOperation(operation, message, mapped.code, this.sanitizer.sanitizeText(mapped));
        return;
      }
      // §14：请求发送后结果未知（timeout/ambiguous）与发送前失败必须区分。
      const ambiguous = ['TIMEOUT', 'NETWORK_ERROR', 'CONNECTOR_TEMPORARY_ERROR', 'INTERNAL_EXECUTION_ERROR'].includes(mapped.code);
      // §43：retrySafety=unsafe 的 Provider 不自动盲重试模糊失败。
      const contractUnsafe = contract?.retrySafety === 'unsafe';
      if (ambiguous && (contractUnsafe || message.attemptCount + 1 >= MAX_OUTBOX_ATTEMPTS)) {
        await this.unknownOutcome(operation, message, mapped, payload.executionId);
        return;
      }
      if (ambiguous) {
        const nextAttemptAt = new Date(Date.now() + Math.min(RETRY_BASE_MS * 2 ** message.attemptCount, RETRY_MAX_MS));
        await this.operations.mark(operation.id, { status: 'retry_wait', errorCode: mapped.code, errorMessage: this.sanitizer.sanitizeText(mapped) });
        await this.outbox.markRetryWait(message.id, mapped.code, this.sanitizer.sanitizeText(mapped), nextAttemptAt);
        await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_DISPATCH_RETRY', resourceType: 'side_effect_operation', resourceId: operation.id, userId: operation.userId, executionId: operation.executionId, executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, outboxMessageId: message.id, correlationId: operation.correlationId, causationId: operation.id, after: { attempt: message.attemptCount + 1, nextAttemptAt: nextAttemptAt.toISOString() }, source: 'outbox_worker', result: 'unknown', reasonCode: mapped.code });
        return;
      }
      // 已知安全失败（发送前失败）：同 key 重试至上限后 dead。
      if (message.attemptCount + 1 >= MAX_OUTBOX_ATTEMPTS) {
        await this.deadLetter(operation, message, mapped, payload.executionId);
        return;
      }
      const nextAttemptAt = new Date(Date.now() + Math.min(RETRY_BASE_MS * 2 ** message.attemptCount, RETRY_MAX_MS));
      await this.operations.mark(operation.id, { status: 'retry_wait', errorCode: mapped.code, errorMessage: this.sanitizer.sanitizeText(mapped) });
      await this.outbox.markRetryWait(message.id, mapped.code, this.sanitizer.sanitizeText(mapped), nextAttemptAt);
    }
  }

  private async cancelOperation(operation: typeof sideEffectOperations.$inferSelect, message: typeof outboxMessages.$inferSelect, code: string, executionId: string) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await this.operations.mark(operation.id, { status: 'cancelled', errorCode: code, errorMessage: 'Cancelled before external dispatch', finishedAt: now }, tx);
      await this.stepStates.transition(operation.executionStepId, 'cancelled', { dispatchStatus: 'cancelled', errorCode: code, errorMessage: 'Cancelled before external dispatch', finishedAt: now }, tx);
      await tx.update(outboxMessages).set({ status: 'cancelled', lockedBy: null, lockExpiresAt: null, lastErrorCode: code, lastErrorMessage: 'Cancelled before external dispatch', updatedAt: now }).where(eq(outboxMessages.id, message.id));
      await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_CANCELLED', resourceType: 'side_effect_operation', resourceId: operation.id, userId: operation.userId, executionId, executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, outboxMessageId: message.id, correlationId: operation.correlationId, causationId: operation.id, source: 'outbox_worker', result: 'blocked', reasonCode: code });
    });
    await this.events.append(executionId, 'side_effect_cancelled', { operationId: operation.id }, operation.executionStepId);
    const steps = await this.db.select({ status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.executionId, executionId));
    const succeeded = steps.filter((step) => step.status === 'succeeded').length;
    await this.states.transition(executionId, succeeded > 0 ? 'partially_succeeded' : 'cancelled', { resultCode: 'CANCELLED_BEFORE_DISPATCH', resultSummary: 'Execution cancelled before external dispatch', finishedAt: now, workerToken: null, heartbeatAt: null, leaseExpiresAt: null });
    await this.queue.removeExecutionJob(executionId).catch(() => undefined);
  }

  private async succeedOperation(operation: typeof sideEffectOperations.$inferSelect, message: typeof outboxMessages.$inferSelect, data: Record<string, unknown>, executionId: string) {
    const now = new Date();
    const providerOperationId = String(data.providerOperationId ?? data.id ?? data.postId ?? data.orderId ?? data.messageId ?? null) || null;
    const resultHash = this.operations.hashResult(data);
    // §52：operation succeeded + step succeeded + outbox published + audit 同一 DB 事务。
    await this.db.transaction(async (tx) => {
      await this.operations.mark(operation.id, { status: 'succeeded', resultSnapshotJson: this.sanitizer.sanitize(data), resultHash, providerOperationId, finishedAt: now }, tx);
      await this.stepStates.transition(operation.executionStepId, 'succeeded', { dispatchStatus: 'succeeded', outputSnapshotJson: this.sanitizer.sanitize(data), finishedAt: now }, tx);
      await tx.update(outboxMessages).set({ status: 'published', publishedAt: now, lockedBy: null, lockExpiresAt: null, updatedAt: now }).where(eq(outboxMessages.id, message.id));
      await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_SUCCEEDED', resourceType: 'side_effect_operation', resourceId: operation.id, userId: operation.userId, executionId, executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, outboxMessageId: message.id, correlationId: operation.correlationId, causationId: operation.id, after: { providerOperationId, resultHash }, changeSummary: 'Side effect succeeded', source: 'outbox_worker', result: 'success' }, tx);
    });
    await this.events.append(executionId, 'side_effect_succeeded', { operationId: operation.id, providerOperationId }, operation.executionStepId);
    await this.resumeExecution(operation.userId, executionId);
  }

  private async failOperation(operation: typeof sideEffectOperations.$inferSelect, message: typeof outboxMessages.$inferSelect, code: string, text: string) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await this.operations.mark(operation.id, { status: 'failed', errorCode: code, errorMessage: text.slice(0, 1000), finishedAt: now }, tx);
      await this.stepStates.transition(operation.executionStepId, 'failed', { dispatchStatus: 'failed', errorCode: code, errorMessage: text.slice(0, 1000), finishedAt: now }, tx);
      await tx.update(outboxMessages).set({ status: 'dead', lockedBy: null, lockExpiresAt: null, lastErrorCode: code, lastErrorMessage: text.slice(0, 1000), updatedAt: now }).where(eq(outboxMessages.id, message.id));
      await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_FAILED', resourceType: 'side_effect_operation', resourceId: operation.id, userId: operation.userId, executionId: operation.executionId, executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, outboxMessageId: message.id, correlationId: operation.correlationId, causationId: operation.id, source: 'outbox_worker', result: 'failure', reasonCode: code });
    });
    await this.events.append(operation.executionId, 'side_effect_failed', { operationId: operation.id, errorCode: code }, operation.executionStepId);
    await this.finalizeExecution(operation.userId, operation.executionId);
  }

  private async unknownOutcome(operation: typeof sideEffectOperations.$inferSelect, message: typeof outboxMessages.$inferSelect, error: ExecutionRuntimeError, executionId: string) {
    const now = new Date();
    // §50：无 Idempotency / 无 Lookup 的 Provider 在请求可能已到达时 → outcome_unknown，禁止盲 Retry。
    await this.db.transaction(async (tx) => {
      await this.operations.mark(operation.id, { status: 'outcome_unknown', errorCode: error.code, errorMessage: this.sanitizer.sanitizeText(error), finishedAt: now }, tx);
      await this.stepStates.transition(operation.executionStepId, 'failed', { dispatchStatus: 'outcome_unknown', errorCode: error.code, errorMessage: '操作结果未知，为避免重复已停止自动重试', finishedAt: now }, tx);
      await tx.update(outboxMessages).set({ status: 'dead', lockedBy: null, lockExpiresAt: null, lastErrorCode: error.code, lastErrorMessage: this.sanitizer.sanitizeText(error), updatedAt: now }).where(eq(outboxMessages.id, message.id));
      await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_OUTCOME_UNKNOWN', resourceType: 'side_effect_operation', resourceId: operation.id, userId: operation.userId, executionId, executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, outboxMessageId: message.id, correlationId: operation.correlationId, causationId: operation.id, source: 'outbox_worker', result: 'unknown', reasonCode: error.code, changeSummary: 'Ambiguous outcome; automatic retry stopped' }, tx);
    });
    await this.notifications.emit({ userId: operation.userId, executionId, executionStepId: operation.executionStepId, priority: 'P0', eventType: 'side_effect_outcome_unknown', dedupeKey: `outcome-unknown:${operation.id}`, title: '操作结果待确认', body: '这一步已向外部服务发出请求，但暂时无法确认最终结果。为了避免重复操作，系统已停止自动重试，需要人工处理。' });
    await this.events.append(executionId, 'side_effect_outcome_unknown', { operationId: operation.id, errorCode: error.code }, operation.executionStepId);
    await this.finalizeExecution(operation.userId, executionId, 'OUTCOME_UNKNOWN');
  }

  private async deadLetter(operation: typeof sideEffectOperations.$inferSelect, message: typeof outboxMessages.$inferSelect, error: ExecutionRuntimeError, executionId: string) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await this.operations.mark(operation.id, { status: 'failed', errorCode: error.code, errorMessage: this.sanitizer.sanitizeText(error), finishedAt: now }, tx);
      await this.stepStates.transition(operation.executionStepId, 'failed', { dispatchStatus: 'failed', errorCode: error.code, errorMessage: this.sanitizer.sanitizeText(error), finishedAt: now }, tx);
      await tx.update(outboxMessages).set({ status: 'dead', lockedBy: null, lockExpiresAt: null, lastErrorCode: error.code, lastErrorMessage: this.sanitizer.sanitizeText(error), updatedAt: now }).where(eq(outboxMessages.id, message.id));
      await this.audit.append({ actorType: 'outbox_worker', actorUserId: null, action: 'SIDE_EFFECT_DEAD_LETTER', resourceType: 'side_effect_operation', resourceId: operation.id, userId: operation.userId, executionId, executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, outboxMessageId: message.id, correlationId: operation.correlationId, causationId: operation.id, source: 'outbox_worker', result: 'failure', reasonCode: error.code });
    });
    await this.notifications.emit({ userId: operation.userId, executionId, executionStepId: operation.executionStepId, priority: 'P1', eventType: 'side_effect_dead_letter', dedupeKey: `dead-letter:${operation.id}`, title: '外部动作连续失败', body: '外部操作多次尝试仍未成功，系统已停止重试，需要人工处理。' });
    await this.events.append(executionId, 'side_effect_dead_letter', { operationId: operation.id, errorCode: error.code }, operation.executionStepId);
    await this.finalizeExecution(operation.userId, executionId, error.code);
  }

  // 外部动作成功后，推进 Execution：仍有剩余步骤则 resume 队列，否则直接聚合终态。
  private async resumeExecution(userId: string, executionId: string) {
    const steps = await this.db.select({ status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.executionId, executionId));
    const aggregate = this.resultResolver.resolve(steps);
    if (aggregate === 'succeeded' || aggregate === 'partially_succeeded') {
      await this.finalizeExecution(userId, executionId);
      return;
    }
    await this.states.transition(executionId, 'queued', { queuedAt: new Date() });
    await this.queue.addExecution(executionId, this.policy.current);
  }

  private async finalizeExecution(userId: string, executionId: string, errorCode?: string) {
    const steps = await this.db.select({ status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.executionId, executionId));
    const aggregate = this.resultResolver.resolve(steps);
    const succeededCount = steps.filter((step) => step.status === 'succeeded').length;
    const terminal = errorCode ? (succeededCount > 0 ? 'partially_succeeded' : 'failed') : aggregate;
    await this.states.transition(executionId, terminal, {
      resultCode: errorCode ?? (terminal === 'succeeded' ? 'EXECUTION_COMPLETED' : 'EXECUTION_PARTIALLY_COMPLETED'),
      resultSummary: errorCode ? 'Execution ended after an external side effect could not be confirmed' : terminal === 'succeeded' ? 'All actions completed successfully' : 'Execution completed with skipped or failed steps',
      errorCode: errorCode ?? null,
      errorMessage: errorCode ? '需要人工处理' : null,
      finishedAt: new Date(), workerToken: null, heartbeatAt: null, leaseExpiresAt: null,
    });
    await this.queue.removeExecutionJob(executionId).catch(() => undefined);
    void userId;
  }
}
