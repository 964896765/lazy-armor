import { ConflictException, Inject, Injectable, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry, resolveSideEffectContract } from '@lazy-armor/connector-sdk';
import { executions, executionSteps, reconciliationCases, sideEffectOperations, verificationEvidence, verificationPolicies } from '@lazy-armor/database';
import { catalogHash, verificationPolicyHash, type RuntimeResultState, type VerificationPolicy } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { workerEnabled } from '../common/app-role';
import { AuditService } from '../audit/audit.service';
import { RuntimeConnectionGuard } from './runtime-connection-guard.service';
import { SideEffectOperationsService } from './side-effect/side-effect-operations.service';
import { VerificationService } from './verification.service';

type Case = typeof reconciliationCases.$inferSelect;
@Injectable()
export class ReconciliationService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly registry: ConnectorRegistry,
    private readonly guard: RuntimeConnectionGuard, private readonly operations: SideEffectOperationsService,
    private readonly verification: VerificationService, private readonly audit: AuditService) {}

  async list(userId: string) { return this.db.select().from(reconciliationCases).where(eq(reconciliationCases.userId, userId)).orderBy(desc(reconciliationCases.createdAt)).limit(100); }
  async get(userId: string, id: string) {
    const row = (await this.db.select().from(reconciliationCases).where(and(eq(reconciliationCases.id, id), eq(reconciliationCases.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Reconciliation case not found');
    const evidence = await this.db.select().from(verificationEvidence).where(eq(verificationEvidence.caseId, row.id)).orderBy(asc(verificationEvidence.verifiedAt));
    return { ...row, evidence };
  }
  async requestRecheck(userId: string, id: string) {
    await this.get(userId, id);
    await this.db.transaction(async (tx) => {
      const row = (await tx.select().from(reconciliationCases).where(and(eq(reconciliationCases.id, id), eq(reconciliationCases.userId, userId))).limit(1).for('update'))[0];
      const policy = row.policySnapshotJson as unknown as VerificationPolicy;
      if (row.status === 'RESOLVED') return;
      if (row.status === 'RECONCILING' || row.expiresAt <= new Date() || row.attemptCount >= policy.maxAttempts || !policy.methods.includes('OPERATION_LOOKUP')) throw new ConflictException('Case cannot be rechecked automatically');
      if (verificationPolicyHash(policy) !== row.policyHash) throw new ConflictException('Verification policy integrity failure');
      await tx.update(reconciliationCases).set({ status: 'OPEN', nextAttemptAt: new Date(), updatedAt: new Date() }).where(eq(reconciliationCases.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, executionId: row.executionId, action: 'RECONCILIATION_RECHECK_REQUESTED',
        resourceType: 'reconciliation_case', resourceId: id, correlationId: row.executionId, source: 'api', result: 'unknown' }, tx);
    });
    return this.get(userId, id);
  }

  async claim(batch = 8, leaseMs = 35_000): Promise<Case[]> {
    if (!Number.isInteger(batch) || batch < 1 || batch > 100 || leaseMs < 1 || leaseMs > 60_000) throw new Error('Invalid reconciliation claim bounds');
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.select().from(reconciliationCases).where(and(or(eq(reconciliationCases.status, 'OPEN'), eq(reconciliationCases.status, 'RECONCILING')),
        lte(reconciliationCases.nextAttemptAt, now), or(isNull(reconciliationCases.leaseUntil), lte(reconciliationCases.leaseUntil, now))))
        .orderBy(asc(reconciliationCases.nextAttemptAt)).limit(batch).for('update', { skipLocked: true });
      const claimed: Case[] = [];
      for (const row of rows) {
        const leaseToken = newId(); const leaseUntil = new Date(now.getTime() + leaseMs);
        await tx.update(reconciliationCases).set({ status: 'RECONCILING', leaseToken, leaseUntil, attemptCount: row.attemptCount + 1, updatedAt: now }).where(eq(reconciliationCases.id, row.id));
        claimed.push({ ...row, status: 'RECONCILING', leaseToken, leaseUntil, attemptCount: row.attemptCount + 1 });
      }
      return claimed;
    });
  }

  async process(row: Case) {
    const lease = (await this.db.select().from(reconciliationCases).where(eq(reconciliationCases.id, row.id)).limit(1))[0];
    if (!lease || lease.status !== 'RECONCILING' || lease.leaseToken !== row.leaseToken || !lease.leaseUntil || lease.leaseUntil <= new Date()) return { fenced: true };
    const operation = await this.operations.get(row.operationId);
    if (!operation || operation.userId !== row.userId || operation.executionId !== row.executionId || operation.executionStepId !== row.executionStepId
      || operation.status !== 'outcome_unknown') throw new ConflictException('Case does not match an unknown operation');
    const policy = row.policySnapshotJson as unknown as VerificationPolicy;
    const stored = (await this.db.select().from(verificationPolicies).where(eq(verificationPolicies.id, row.policyId)).limit(1))[0];
    if (!stored || verificationPolicyHash(policy) !== row.policyHash || stored.definitionHash !== row.policyHash || catalogHash(stored.definitionJson) !== row.policyHash) throw new ConflictException('Immutable verification policy invalid');
    let evidence: Record<string, unknown> = { reasonCode: 'RECONCILIATION_EXPIRED' };
    let blocked = row.expiresAt <= new Date() || row.attemptCount > policy.maxAttempts;
    if (!blocked) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!operation.connectionId || !operation.capabilityKey) throw new Error('Unbound operation');
        const checked = await this.guard.assertUsable(row.userId, operation.connectionId, operation.capabilityKey);
        const connector = this.registry.get(checked.connectorKey);
        const capability = this.registry.capability(checked.connectorKey, operation.capabilityKey);
        if (!capability || !connector.lookupOperation || !resolveSideEffectContract(capability).supportsOperationLookup
          || !policy.methods.includes('OPERATION_LOOKUP') || policy.providerKey !== checked.connectorKey || policy.capabilityKey !== operation.capabilityKey) throw new Error('Explicit read-only verification adapter unavailable');
        const rebuilt = await this.operations.rebuildRequest(operation.executionStepId);
        if (rebuilt.executionId !== row.executionId) throw new Error('Operation execution binding changed');
        // Only lookupOperation is invoked. Never execute/read the action again or enqueue the outbox.
        const lookup = connector.lookupOperation({ capability: operation.capabilityKey, input: { context: rebuilt.triggerPayload, config: rebuilt.actionConfig },
          requestId: operation.idempotencyKey, idempotencyKey: operation.idempotencyKey, providerIdempotencyKey: operation.providerIdempotencyKey ?? operation.idempotencyKey,
          operationId: operation.providerOperationId ?? operation.id, userId: row.userId, connectionId: operation.connectionId, connectorKey: checked.connectorKey,
          credentials: { ref: checked.credentialRef ?? undefined, version: checked.credentialVersion ?? undefined, expiresAt: checked.credentialExpiresAt?.toISOString() ?? null } });
        const response = await Promise.race([lookup, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('LOOKUP_TIMEOUT')), policy.timeoutMs); })]);
        evidence = response.ok ? response.data : { reasonCode: 'LOOKUP_NOT_CONFIRMED' };
      } catch { evidence = { reasonCode: 'LOOKUP_UNAVAILABLE_OR_FAILED' }; }
      finally { if (timeout) clearTimeout(timeout); }
    }
    return this.db.transaction(async (tx) => {
      const current = (await tx.select().from(reconciliationCases).where(eq(reconciliationCases.id, row.id)).limit(1).for('update'))[0];
      // A late response from a timed-out/crashed worker cannot commit over a new lease.
      if (!current || current.status !== 'RECONCILING' || current.leaseToken !== row.leaseToken || !current.leaseUntil || current.leaseUntil <= new Date()) return { fenced: true };
      const resultState = await this.verification.record(operation, policy, 'OPERATION_LOOKUP', evidence, 'lookup:' + current.attemptCount, tx, row.id);
      const resolved = resultState !== 'OUTCOME_UNKNOWN';
      blocked = blocked || current.attemptCount >= policy.maxAttempts || current.expiresAt <= new Date();
      const status = resolved ? 'RESOLVED' : blocked ? 'NEEDS_USER' : 'OPEN';
      const now = new Date();
      await tx.update(reconciliationCases).set({ status, resultState, leaseToken: null, leaseUntil: null, resolvedAt: resolved ? now : null,
        nextAttemptAt: new Date(now.getTime() + Math.min(60_000, 1000 * 2 ** current.attemptCount)), updatedAt: now }).where(eq(reconciliationCases.id, row.id));
      await this.audit.append({ actorType: 'worker', actorUserId: null, userId: row.userId, executionId: row.executionId,
        sideEffectOperationId: row.operationId, action: resolved ? 'RECONCILIATION_RESOLVED' : 'RECONCILIATION_PENDING', resourceType: 'reconciliation_case', resourceId: row.id,
        correlationId: operation.correlationId, after: { status, resultState, attempt: current.attemptCount }, source: 'side_effect', result: resolved && resultState === 'SUCCEEDED' ? 'success' : 'unknown' }, tx);
      // Keep the historical operation/execution/PlanVersion/Audit unchanged. Resolution is a separate append-only evidence trail.
      return { status, resultState };
    });
  }

  async executionResult(userId: string, executionId: string) {
    const execution = (await this.db.select().from(executions).where(and(eq(executions.id, executionId), eq(executions.userId, userId))).limit(1))[0];
    if (!execution) throw new NotFoundException('Execution not found');
    const operations = await this.db.select().from(sideEffectOperations).where(eq(sideEffectOperations.executionId, executionId));
    const steps = await this.db.select().from(executionSteps).where(eq(executionSteps.executionId, executionId));
    const cases = await this.db.select().from(reconciliationCases).where(eq(reconciliationCases.executionId, executionId));
    const terminal = ['succeeded', 'partially_succeeded', 'failed', 'cancelled'].includes(execution.status);
    const outcomes: RuntimeResultState[] = steps.map((step) => {
      const operation = operations.find((item) => item.executionStepId === step.id);
      if (!operation) return step.status === 'succeeded' ? 'SUCCEEDED' : ['failed', 'skipped', 'cancelled'].includes(step.status) ? 'FAILED' : 'OUTCOME_UNKNOWN';
      const resolved = cases.find((item) => item.operationId === operation.id && item.status === 'RESOLVED');
      return resolved ? resolved.resultState as RuntimeResultState : operation.status === 'succeeded' ? 'SUCCEEDED'
        : operation.status === 'outcome_unknown' ? 'OUTCOME_UNKNOWN' : ['failed', 'cancelled'].includes(operation.status) ? 'FAILED' : 'OUTCOME_UNKNOWN';
    });
    const resultState: RuntimeResultState | null = outcomes.includes('OUTCOME_UNKNOWN') ? 'OUTCOME_UNKNOWN'
      : outcomes.length && outcomes.every((state) => state === 'SUCCEEDED') ? 'SUCCEEDED'
      : outcomes.includes('SUCCEEDED') || outcomes.includes('PARTIALLY_SUCCEEDED') ? 'PARTIALLY_SUCCEEDED'
      : terminal ? execution.status === 'succeeded' ? 'SUCCEEDED' : execution.status === 'partially_succeeded' ? 'PARTIALLY_SUCCEEDED' : 'FAILED' : null;
    return { executionId, historicalExecutionStatus: execution.status,
      resultState: !terminal && !operations.some((operation) => operation.status === 'outcome_unknown') ? null : resultState, reconciliationCases: cases };
  }
}

@Injectable()
export class ReconciliationWorker implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  constructor(private readonly service: ReconciliationService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('outbox-worker')) return;
    this.timer = setInterval(() => void this.poll().catch(() => undefined), 1000); this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
  async poll() {
    if (this.polling) return { claimed: 0, processed: 0 };
    this.polling = true;
    try {
      const rows = await this.service.claim(); let processed = 0;
      for (const row of rows) { try { await this.service.process(row); processed++; } catch { /* lease takeover retains fail-closed state */ } }
      return { claimed: rows.length, processed };
    } finally { this.polling = false; }
  }
}
