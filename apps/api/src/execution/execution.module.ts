import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { ContentModule } from '../content/content.module';
import { DailySummaryModule } from '../daily-summary/daily-summary.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { HouseholdModule } from '../household/household.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { PlansModule } from '../plans/plans.module';
import { ActionExecutor } from './action-executor.service';
import { ConditionEvaluator } from './condition-evaluator.service';
import { ExecutionDispatchService } from './execution-dispatch.service';
import { ExecutionEventService } from './execution-event.service';
import { ExecutionPolicyService } from './execution-policy.service';
import { ExecutionLeaseService } from './execution-lease.service';
import { ExecutionResultResolver } from './execution-result-resolver.service';
import { ExecutionQueueReconciler } from './execution-queue-reconciler.service';
import { ExecutionRunner } from './execution-runner.service';
import { ExecutionStateService } from './execution-state.service';
import { ExecutionStepStateService } from './execution-step-state.service';
import { ExecutionWorker } from './execution-worker.service';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { FallbackExecutor } from './fallback-executor.service';
import { RuntimeConnectionGuard } from './runtime-connection-guard.service';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { SourceResolver } from './source-resolver.service';
import { RiskModule } from '../risk/risk.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExecutionApprovalGate } from './execution-approval-gate.service';
import { CredentialsModule } from '../credentials/credentials.module';
import { OutboxService } from './side-effect/outbox.service';
import { OutboxWorker } from './side-effect/outbox-worker.service';
import { SideEffectCoordinator } from './side-effect/side-effect-coordinator.service';
import { SideEffectOperationsService } from './side-effect/side-effect-operations.service';

export const EXECUTION_WORKER = 'EXECUTION_WORKER';
export const EXECUTION_RECONCILER = 'EXECUTION_RECONCILER';
export const EXECUTION_STATE_SERVICE = 'EXECUTION_STATE_SERVICE';
export const EXECUTION_POLICY_SERVICE = 'EXECUTION_POLICY_SERVICE';
export const FALLBACK_EXECUTOR = 'FALLBACK_EXECUTOR';
export const OUTBOX_WORKER = 'OUTBOX_WORKER';
export const SIDE_EFFECT_COORDINATOR = 'SIDE_EFFECT_COORDINATOR';
export const SIDE_EFFECT_OPERATIONS_SERVICE = 'SIDE_EFFECT_OPERATIONS_SERVICE';
export const OUTBOX_SERVICE = 'OUTBOX_SERVICE';

@Module({
  imports: [PlansModule, ConnectorsModule, RiskModule, NotificationsModule, AuditModule, CredentialsModule, BillingModule, ContentModule, DailySummaryModule, LogisticsModule, HouseholdModule],
  controllers: [ExecutionsController],
  providers: [
    SnapshotSanitizer,
    ExecutionEventService,
    ExecutionStateService,
    ExecutionStepStateService,
    ExecutionPolicyService,
    ExecutionResultResolver,
    ConditionEvaluator,
    RuntimeConnectionGuard,
    SourceResolver,
    ActionExecutor,
    FallbackExecutor,
    ExecutionDispatchService,
    ExecutionsService,
    ExecutionRunner,
    ExecutionLeaseService,
    ExecutionWorker,
    ExecutionQueueReconciler,
    ExecutionApprovalGate,
    SideEffectOperationsService,
    OutboxService,
    SideEffectCoordinator,
    OutboxWorker,
    { provide: EXECUTION_WORKER, useExisting: ExecutionWorker },
    { provide: EXECUTION_RECONCILER, useExisting: ExecutionQueueReconciler },
    { provide: EXECUTION_STATE_SERVICE, useExisting: ExecutionStateService },
    { provide: EXECUTION_POLICY_SERVICE, useExisting: ExecutionPolicyService },
    { provide: FALLBACK_EXECUTOR, useExisting: FallbackExecutor },
    { provide: OUTBOX_WORKER, useExisting: OutboxWorker },
    { provide: SIDE_EFFECT_COORDINATOR, useExisting: SideEffectCoordinator },
    { provide: SIDE_EFFECT_OPERATIONS_SERVICE, useExisting: SideEffectOperationsService },
    { provide: OUTBOX_SERVICE, useExisting: OutboxService },
  ],
  exports: [ExecutionDispatchService, ExecutionsService, ExecutionWorker, ExecutionQueueReconciler, ExecutionApprovalGate, ExecutionStateService, ExecutionStepStateService, ExecutionEventService, ExecutionPolicyService, FallbackExecutor, ExecutionResultResolver, RuntimeConnectionGuard, ConditionEvaluator, SnapshotSanitizer, SideEffectOperationsService, OutboxService, SideEffectCoordinator, OutboxWorker, EXECUTION_WORKER, EXECUTION_RECONCILER, EXECUTION_STATE_SERVICE, EXECUTION_POLICY_SERVICE, FALLBACK_EXECUTOR, OUTBOX_WORKER, SIDE_EFFECT_COORDINATOR, SIDE_EFFECT_OPERATIONS_SERVICE, OUTBOX_SERVICE],
})
export class ExecutionModule {}
