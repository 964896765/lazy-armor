import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { connections, connectors, executionSteps, reconciliationCases, sideEffectOperations, verificationEvidence, verificationPolicies } from '@lazy-armor/database';
import { catalogHash, CONNECTOR_RESPONSE_POLICY, evaluateVerification, verificationPolicyHash, type RuntimeResultState, type VerificationMethod, type VerificationPolicy } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { AuditService } from '../audit/audit.service';
import { VerificationPolicyRegistry } from './verification-policy-registry.service';

export type VerificationTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
type Operation = typeof sideEffectOperations.$inferSelect;

@Injectable()
export class VerificationService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly registry: VerificationPolicyRegistry,
    private readonly sanitizer: SnapshotSanitizer, private readonly audit: AuditService) {}

  async ensurePolicy(policy: VerificationPolicy, tx: VerificationTransaction) {
    const definitionHash = verificationPolicyHash(policy);
    await tx.insert(verificationPolicies).values({ id: newId(), policyKey: policy.key, revision: policy.revision,
      definitionJson: policy as unknown as Record<string, unknown>, definitionHash, createdAt: new Date() })
      .onDuplicateKeyUpdate({ set: { policyKey: policy.key } });
    const row = (await tx.select().from(verificationPolicies).where(and(eq(verificationPolicies.policyKey, policy.key), eq(verificationPolicies.revision, policy.revision))).limit(1))[0];
    if (!row || row.definitionHash !== definitionHash || catalogHash(row.definitionJson) !== definitionHash) throw new ConflictException('Stored verification policy revision changed');
    return row;
  }

  async record(operation: Operation, policy: VerificationPolicy, method: VerificationMethod, data: Record<string, unknown>, evidenceKey: string,
    tx: VerificationTransaction, caseId: string | null = null): Promise<RuntimeResultState> {
    const resultState = evaluateVerification(policy, method, data);
    const storedPolicy = await this.ensurePolicy(policy, tx);
    const step = (await tx.select({ intentId: executionSteps.actionIntentId }).from(executionSteps).where(eq(executionSteps.id, operation.executionStepId)).limit(1))[0];
    // Evaluate original fields, persist only sanitized evidence. Hash includes the typed conclusion and immutable policy identity.
    const evidenceJson = this.sanitizer.sanitize(data);
    const evidenceHash = catalogHash({ policyHash: storedPolicy.definitionHash, method, resultState, evidenceJson });
    await tx.insert(verificationEvidence).values({ id: newId(), userId: operation.userId, operationId: operation.id, caseId,
      actionIntentId: step?.intentId ?? null, policyId: storedPolicy.id, method, resultState, evidenceKey, evidenceJson, evidenceHash, verifiedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { evidenceKey } });
    const prior = (await tx.select().from(verificationEvidence).where(and(eq(verificationEvidence.operationId, operation.id), eq(verificationEvidence.evidenceKey, evidenceKey))).limit(1))[0];
    if (!prior || prior.evidenceHash !== evidenceHash || prior.resultState !== resultState) throw new ConflictException('Verification evidence identity reused with different contents');
    await this.audit.append({ actorType: 'worker', actorUserId: null, userId: operation.userId, executionId: operation.executionId,
      executionStepId: operation.executionStepId, sideEffectOperationId: operation.id, action: 'VERIFICATION_EVIDENCE_RECORDED', resourceType: 'verification_evidence', resourceId: prior.id,
      correlationId: operation.correlationId, after: { resultState, evidenceHash, policyKey: policy.key, revision: policy.revision }, source: 'side_effect', result: resultState === 'SUCCEEDED' ? 'success' : 'unknown' }, tx);
    return resultState;
  }

  async recordResponse(operation: Operation, ok: boolean, data: Record<string, unknown>, key: string, tx: VerificationTransaction) {
    return this.record(operation, CONNECTOR_RESPONSE_POLICY, 'PROVIDER_RESPONSE', { ok, data }, key, tx);
  }

  async openUnknown(operation: Operation, reasonCode: string, tx: VerificationTransaction) {
    const connector = operation.connectionId ? (await tx.select({ key: connectors.key }).from(connections).innerJoin(connectors, eq(connectors.id, connections.connectorId))
      .where(and(eq(connections.id, operation.connectionId), eq(connections.userId, operation.userId))).limit(1))[0] : null;
    const policy = this.registry.select(connector?.key ?? null, operation.capabilityKey);
    const stored = await this.ensurePolicy(policy, tx);
    const now = new Date();
    await tx.insert(reconciliationCases).values({ id: newId(), userId: operation.userId, executionId: operation.executionId,
      executionStepId: operation.executionStepId, operationId: operation.id, policyId: stored.id,
      policySnapshotJson: policy as unknown as Record<string, unknown>, policyHash: stored.definitionHash,
      status: policy.methods.includes('OPERATION_LOOKUP') ? 'OPEN' : 'NEEDS_USER', resultState: 'OUTCOME_UNKNOWN', attemptCount: 0,
      nextAttemptAt: now, expiresAt: new Date(now.getTime() + policy.expiresAfterMs), createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { operationId: operation.id } });
    const row = (await tx.select().from(reconciliationCases).where(eq(reconciliationCases.operationId, operation.id)).limit(1))[0];
    if (!row || row.policyHash !== stored.definitionHash) throw new ConflictException('Reconciliation policy binding changed');
    await this.record(operation, policy, 'PROVIDER_RESPONSE', { reasonCode, outcomeUnknown: true }, 'initial-unknown', tx, row.id);
    await this.audit.append({ actorType: 'worker', actorUserId: null, userId: operation.userId, executionId: operation.executionId,
      sideEffectOperationId: operation.id, action: 'RECONCILIATION_CASE_OPENED', resourceType: 'reconciliation_case', resourceId: row.id,
      correlationId: operation.correlationId, after: { status: row.status, resultState: row.resultState, policyHash: row.policyHash }, source: 'side_effect', result: 'unknown' }, tx);
    return row;
  }
}
