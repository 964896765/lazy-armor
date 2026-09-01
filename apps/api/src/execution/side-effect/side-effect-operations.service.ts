import { Inject, Injectable } from '@nestjs/common';
import { executionSteps, executions, planActions, sideEffectOperations } from '@lazy-armor/database';
import { canonicalStringify } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { SnapshotSanitizer } from '../../common/snapshot-sanitizer.service';
import { ExecutionRuntimeError } from '../execution.types';
import type { DispatchStatus } from '../execution.types';
import { deriveIdempotencyKey } from './idempotency';

export interface PrepareOperationInput {
  userId: string;
  executionId: string;
  executionStepId: string;
  planId: string;
  planVersionId: string;
  planActionId: string;
  actionType: string;
  connectorId: string | null;
  connectionId: string | null;
  capabilityKey: string | null;
  inputFingerprint: string;
  requestSnapshot: Record<string, unknown>;
  correlationId: string;
  causationId: string | null;
  providerIdempotencyKey: string | null;
  requestId: string;
}

export type OperationExecutor = Pick<InjectedDatabase, 'select' | 'insert' | 'update'>;

@Injectable()
export class SideEffectOperationsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly sanitizer: SnapshotSanitizer) {}

  keyFor(input: Omit<PrepareOperationInput, 'requestSnapshot' | 'providerIdempotencyKey' | 'requestId' | 'correlationId' | 'causationId'>): string {
    return deriveIdempotencyKey(input);
  }

  async prepare(input: PrepareOperationInput, executor: OperationExecutor = this.db): Promise<{ id: string; idempotencyKey: string; conflict: boolean }> {
    const idempotencyKey = deriveIdempotencyKey({
      userId: input.userId, executionId: input.executionId, executionStepId: input.executionStepId,
      planVersionId: input.planVersionId, planActionId: input.planActionId, actionType: input.actionType,
      connectionId: input.connectionId, capabilityKey: input.capabilityKey,
    });
    const prior = (await executor.select().from(sideEffectOperations)
      .where(and(eq(sideEffectOperations.userId, input.userId), eq(sideEffectOperations.idempotencyKey, idempotencyKey))).limit(1))[0];
    if (prior) {
      // Same key + different payload：必须拒绝，绝不覆盖。
      if (prior.inputFingerprint !== input.inputFingerprint) {
        throw new ExecutionRuntimeError('IDEMPOTENCY_KEY_CONFLICT', 'Same idempotency key cannot be reused with different payloads');
      }
      return { id: prior.id, idempotencyKey, conflict: false };
    }
    const now = new Date();
    const id = newId();
    await executor.insert(sideEffectOperations).values({
      id, userId: input.userId, executionId: input.executionId, executionStepId: input.executionStepId,
      planId: input.planId, planVersionId: input.planVersionId, planActionId: input.planActionId,
      actionType: input.actionType, connectorId: input.connectorId, connectionId: input.connectionId, capabilityKey: input.capabilityKey,
      idempotencyKey, inputFingerprint: input.inputFingerprint,
      requestSnapshotJson: this.sanitizer.sanitize(input.requestSnapshot),
      status: 'prepared', providerOperationId: null, providerIdempotencyKey: input.providerIdempotencyKey,
      attemptCount: 0, resultSnapshotJson: null, resultHash: null, errorCode: null, errorMessage: null,
      correlationId: input.correlationId, causationId: input.causationId,
      createdAt: now, startedAt: null, finishedAt: null, updatedAt: now,
    });
    return { id, idempotencyKey, conflict: true };
  }

  async get(id: string, executor: OperationExecutor = this.db) {
    return (await executor.select().from(sideEffectOperations).where(eq(sideEffectOperations.id, id)).limit(1))[0] ?? null;
  }

  async getByStep(executionStepId: string, executor: OperationExecutor = this.db) {
    return (await executor.select().from(sideEffectOperations).where(eq(sideEffectOperations.executionStepId, executionStepId)).limit(1))[0] ?? null;
  }

  async mark(id: string, patch: Partial<typeof sideEffectOperations.$inferInsert>, executor: OperationExecutor = this.db) {
    await executor.update(sideEffectOperations).set({ ...patch, updatedAt: new Date() }).where(eq(sideEffectOperations.id, id));
  }

  // 供 Outbox Worker 重建真实请求：输入来自已 sanitize 的 execution trigger payload 与 plan action config。
  async rebuildRequest(executionStepId: string, executor: OperationExecutor = this.db) {
    const [step] = await executor.select({ executionId: executionSteps.executionId, stepOrder: executionSteps.stepOrder, planActionId: executionSteps.planActionId }).from(executionSteps).where(eq(executionSteps.id, executionStepId)).limit(1);
    if (!step) throw new ExecutionRuntimeError('EXECUTION_STEP_NOT_FOUND', 'ExecutionStep no longer exists');
    const [execution] = await executor.select({ triggerPayloadJson: executions.triggerPayloadJson }).from(executions).where(eq(executions.id, step.executionId)).limit(1);
    const [action] = await executor.select({ configJson: planActions.configJson }).from(planActions).where(eq(planActions.id, step.planActionId)).limit(1);
    return {
      executionId: step.executionId,
      stepOrder: step.stepOrder,
      triggerPayload: execution?.triggerPayloadJson ?? {},
      actionConfig: action?.configJson ?? {},
      requestId: `${step.executionId}:${step.stepOrder}`,
    };
  }

  hashResult(result: unknown): string {
    return createHash('sha256').update(canonicalStringify(this.sanitizer.sanitize(result))).digest('hex');
  }
}
