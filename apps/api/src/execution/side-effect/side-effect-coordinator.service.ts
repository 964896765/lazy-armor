import { Inject, Injectable } from '@nestjs/common';
import { ConnectorRegistry, resolveSideEffectContract, type SideEffectContract } from '@lazy-armor/connector-sdk';
import { ACTION_DEFINITIONS, type NormalizedAction, type RiskLevel } from '@lazy-armor/plan-schema';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { AuditService } from '../../audit/audit.service';
import { SnapshotSanitizer } from '../../common/snapshot-sanitizer.service';
import { ExecutionRuntimeError } from '../execution.types';
import { ExecutionEventService } from '../execution-event.service';
import { ExecutionStepStateService } from '../execution-step-state.service';
import { RuntimeConnectionGuard } from '../runtime-connection-guard.service';
import { OutboxService } from './outbox.service';
import { SideEffectOperationsService } from './side-effect-operations.service';

export interface SideEffectPrepareInput {
  execution: { id: string; userId: string; planId: string; planVersionId: string; requestId: string; triggerPayloadJson: Record<string, unknown> };
  step: { id: string; planActionId: string; stepOrder: number; actionType: string; connectionId: string | null; requiredCapability: string | null; inputFingerprint: string };
  action: NormalizedAction;
  effectiveRisk: RiskLevel;
}

@Injectable()
export class SideEffectCoordinator {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly registry: ConnectorRegistry,
    private readonly guard: RuntimeConnectionGuard,
    private readonly operations: SideEffectOperationsService,
    private readonly outbox: OutboxService,
    private readonly stepStates: ExecutionStepStateService,
    private readonly events: ExecutionEventService,
    private readonly audit: AuditService,
    private readonly sanitizer: SnapshotSanitizer,
  ) {}

  // §15/§43：R3/R4 外部副作用、或 ActionDefinition 声明 externalEffect、或 Capability 声明 sideEffect 都进入 Side Effect Pipeline。
  isSideEffectAction(action: NormalizedAction, effectiveRisk: RiskLevel, contract: SideEffectContract | null): boolean {
    return ACTION_DEFINITIONS[action.actionType].externalEffect === true || effectiveRisk === 'R3' || effectiveRisk === 'R4' || Boolean(contract?.sideEffect);
  }

  // 未声明能力的未知 Provider 一律最保守；R0/R1/R2 内部动作返回 null。
  async contractFor(connectorKey: string | null, capabilityKey: string | null): Promise<SideEffectContract | null> {
    if (!connectorKey || !capabilityKey) return null;
    const capability = this.registry.capability(connectorKey, capabilityKey);
    return capability ? resolveSideEffectContract(capability) : null;
  }

  // §16/§19：业务写入 + Operation + Outbox + Audit 同一 MySQL 事务；第三方调用绝不在此事务内。
  async prepare(input: SideEffectPrepareInput): Promise<{ prepared: true; operationId: string }> {
    const { execution, step, action, effectiveRisk } = input;
    // §17 Runtime Security Recheck：批准后仍然重新过 Permission Guard，Approval 永远不能覆盖 Permission Guard。
    let connectorKey: string | null = null;
    if (step.connectionId && step.requiredCapability) {
      const checked = await this.guard.assertUsable(execution.userId, step.connectionId, step.requiredCapability);
      connectorKey = checked.connectorKey;
    } else if (effectiveRisk === 'R3' || effectiveRisk === 'R4') {
      // 有审批、但无法安全定位 Connector：不派发。
      throw new ExecutionRuntimeError('SAFETY_GATE_REQUIRES_IDEMPOTENCY', 'Side effect requires a bound Connection and Capability before dispatch');
    }
    const contract = await this.contractFor(connectorKey, step.requiredCapability);
    const platformKey = this.operations.keyFor({
      userId: execution.userId, executionId: execution.id, executionStepId: step.id,
      planId: execution.planId, planVersionId: execution.planVersionId, planActionId: step.planActionId, actionType: step.actionType,
      connectorId: null, connectionId: step.connectionId, capabilityKey: step.requiredCapability, inputFingerprint: step.inputFingerprint,
    });
    // Provider 支持官方幂等键时，所有 Retry 继续使用同一个 Provider key。
    const providerIdempotencyKey = contract?.supportsIdempotencyKey === true ? platformKey.slice(0, contract?.idempotencyKeyMaxLength ?? 128) : null;
    const correlationId = execution.requestId;
    let operationId = '';
    let outboxMessageId = '';
    try {
      await this.db.transaction(async (tx) => {
        const prepared = await this.operations.prepare({
          userId: execution.userId, executionId: execution.id, executionStepId: step.id,
          planId: execution.planId, planVersionId: execution.planVersionId, planActionId: step.planActionId,
          actionType: step.actionType, connectorId: null, connectionId: step.connectionId, capabilityKey: step.requiredCapability,
          inputFingerprint: step.inputFingerprint,
          requestSnapshot: { actionType: step.actionType, stepOrder: step.stepOrder, config: action.config, effectiveRisk },
          correlationId, causationId: step.id, providerIdempotencyKey, requestId: `${execution.id}:${step.stepOrder}`,
        }, tx);
        operationId = prepared.id;
        outboxMessageId = await this.outbox.enqueue({
          aggregateType: 'side_effect_operation', aggregateId: prepared.id, userId: execution.userId,
          eventType: 'side_effect.dispatch', destination: 'connector.execute',
          payload: { operationId: prepared.id, executionStepId: step.id, executionId: execution.id, userId: execution.userId },
          dedupeKey: `side-effect:${prepared.id}`, correlationId, causationId: prepared.id,
        }, tx);
        await this.stepStates.transition(step.id, 'waiting_dispatch', { dispatchStatus: 'prepared' }, tx);
        await this.audit.append({
          actorType: 'worker', actorUserId: null, action: 'SIDE_EFFECT_PREPARED', resourceType: 'side_effect_operation', resourceId: prepared.id,
          userId: execution.userId, executionId: execution.id, executionStepId: step.id, sideEffectOperationId: prepared.id, outboxMessageId,
          requestId: `${execution.id}:${step.stepOrder}`, correlationId, causationId: step.id,
          after: { actionType: step.actionType, effectiveRisk, idempotencyKey: prepared.idempotencyKey },
          changeSummary: this.sanitizer.sanitizeText(`Side effect prepared for ${step.actionType} (op ${prepared.id})`),
          source: 'execution_worker', result: 'pending',
        }, tx);
      });
    } catch (error) {
      // §31 Security Gate：同 key 不同 payload 的冲突必须留下审计，且绝不覆盖旧 payload。
      if (error instanceof ExecutionRuntimeError && error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
        await this.audit.append({
          actorType: 'worker', actorUserId: null, action: 'SIDE_EFFECT_IDEMPOTENCY_CONFLICT', resourceType: 'side_effect_operation',
          userId: execution.userId, executionId: execution.id, executionStepId: step.id,
          requestId: `${execution.id}:${step.stepOrder}`, correlationId, causationId: step.id,
          after: { actionType: step.actionType, effectiveRisk },
          changeSummary: 'Idempotency key conflict: same key reused with a different input fingerprint; rejected',
          source: 'execution_worker', result: 'blocked', reasonCode: 'IDEMPOTENCY_KEY_CONFLICT',
        });
      }
      throw error;
    }
    await this.events.append(execution.id, 'side_effect_prepared', { operationId, outboxMessageId }, step.id);
    return { prepared: true, operationId };
  }
}
