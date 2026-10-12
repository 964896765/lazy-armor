import { connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, credentialRefs,
  executions, executionSteps, learningCandidates, plans, planVersions, reconciliationCases, sideEffectOperations,
  verificationEvidence, verificationPolicies } from '@lazy-armor/database';
import { catalogHash, learningSourceSchema, type LearningSource, type PersonalMemory } from '@lazy-armor/plan-schema';
import { and, desc, eq } from 'drizzle-orm';
import type { InjectedDatabase } from '../common/database.module';

export type LearningTransaction = Pick<InjectedDatabase, 'select' | 'insert' | 'update'>;

/** Read original authority; never synthesizes verification, retries effects or changes policy. */
export async function readLearningSource(tx: LearningTransaction, userId: string, evidenceId: string, lock = false): Promise<LearningSource | null> {
  const one = async <T>(query: { for(strength: 'update'): PromiseLike<T[]> } & PromiseLike<T[]>) =>
    (await (lock ? query.for('update') : query))[0];
  const evidence = await one(tx.select().from(verificationEvidence).where(and(eq(verificationEvidence.id, evidenceId), eq(verificationEvidence.userId, userId))));
  if (!evidence || evidence.verifiedAt > new Date() || !['SUCCEEDED', 'FAILED', 'PARTIALLY_SUCCEEDED'].includes(evidence.resultState)) return null;
  const operation = await one(tx.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.id, evidence.operationId), eq(sideEffectOperations.userId, userId))));
  // First slice supports connection-backed Plan operations, whose grant revocation can be fenced here.
  // Native/user-event/read-only histories need their own existing authority adapters before inclusion.
  if (!operation || !operation.connectionId) return null;
  const execution = await one(tx.select().from(executions).where(and(eq(executions.id, operation.executionId), eq(executions.userId, userId))));
  const step = await one(tx.select().from(executionSteps).where(eq(executionSteps.id, operation.executionStepId)));
  const policy = await one(tx.select().from(verificationPolicies).where(eq(verificationPolicies.id, evidence.policyId)));
  if (!execution || !step || !operation.planId || !operation.planVersionId || step.executionId !== execution.id || step.actionIntentId !== evidence.actionIntentId || step.actionType !== operation.actionType ||
    step.planActionId !== operation.planActionId || step.connectionId !== operation.connectionId ||
    execution.planVersionId !== operation.planVersionId || execution.planId !== operation.planId || !policy ||
    catalogHash(policy.definitionJson) !== policy.definitionHash ||
    catalogHash({ policyHash: policy.definitionHash, method: evidence.method, resultState: evidence.resultState, evidenceJson: evidence.evidenceJson }) !== evidence.evidenceHash) return null;
  const latest = await one(tx.select().from(verificationEvidence).where(eq(verificationEvidence.operationId, operation.id))
    .orderBy(desc(verificationEvidence.verifiedAt), desc(verificationEvidence.id)).limit(1));
  if (latest?.id !== evidence.id) return null;
  const reconciliation = await one(tx.select().from(reconciliationCases).where(eq(reconciliationCases.operationId, operation.id)));
  if (reconciliation) {
    if (reconciliation.userId !== userId || reconciliation.status !== 'RESOLVED' || reconciliation.resultState !== evidence.resultState ||
      evidence.caseId !== reconciliation.id || reconciliation.executionId !== execution.id || reconciliation.executionStepId !== step.id ||
      reconciliation.policyId !== policy.id || reconciliation.policyHash !== policy.definitionHash || catalogHash(reconciliation.policySnapshotJson) !== policy.definitionHash) return null;
  } else if (evidence.caseId || evidence.resultState === 'PARTIALLY_SUCCEEDED' || operation.status !== (evidence.resultState === 'SUCCEEDED' ? 'succeeded' : 'failed')) return null;
  let scope = '已核验操作';
  if (operation.planVersionId) {
    const version = await one(tx.select().from(planVersions).where(eq(planVersions.id, operation.planVersionId)));
    const plan = version && await one(tx.select().from(plans).where(and(eq(plans.id, version.planId), eq(plans.userId, userId))));
    if (!version || !plan || version.planId !== operation.planId || version.definitionHash !== execution.definitionHash) return null;
    scope = version.name;
  }
  let connection: LearningSource['connection'] = null;
  if (operation.connectionId) {
    const row = await one(tx.select().from(connections).where(and(eq(connections.id, operation.connectionId), eq(connections.userId, userId))));
    if (!row || row.status === 'revoked' || row.status === 'disconnected' || (row.expiresAt && row.expiresAt <= new Date()) ||
      (operation.connectorId && row.connectorId !== operation.connectorId) || !operation.capabilityKey) return null;
    if (row.credentialRefId) {
      const credential = await one(tx.select().from(credentialRefs).where(eq(credentialRefs.id, row.credentialRefId)));
      if (!credential || credential.status !== 'active' || (credential.expiresAt && credential.expiresAt <= new Date())) return null;
    }
    const capability = await one(tx.select().from(connectorCapabilities).where(and(eq(connectorCapabilities.connectorId, row.connectorId), eq(connectorCapabilities.key, operation.capabilityKey))));
    const permission = capability && await one(tx.select().from(connectionPermissions).where(and(eq(connectionPermissions.connectionId, row.id), eq(connectionPermissions.connectorCapabilityId, capability.id))));
    if (!permission || permission.granted !== 1 || permission.revokedAt || (permission.expiresAt && permission.expiresAt <= new Date())) return null;
    const grant = await one(tx.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, row.id), eq(connectionCapabilityGrants.capabilityKey, operation.capabilityKey))));
    if (grant && (grant.status !== 'GRANTED' || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= new Date()))) return null;
    connection = { id: row.id, credentialRefId: row.credentialRefId, permissionId: permission.id,
      grantedAt: permission.grantedAt?.toISOString() ?? null, expiresAt: permission.expiresAt?.toISOString() ?? null,
      providerGrantHash: grant ? catalogHash({ id: grant.id, status: grant.status, grantedAt: grant.grantedAt?.toISOString() ?? null,
        expiresAt: grant.expiresAt?.toISOString() ?? null, scopes: grant.grantedScopesJson }) : null };
  }
  const parsed = learningSourceSchema.safeParse({ executionId: execution.id, executionStepId: step.id, operationId: operation.id,
    evidenceId: evidence.id, planVersionId: operation.planVersionId, actionIntentId: step.actionIntentId, policyId: policy.id,
    policyHash: policy.definitionHash, evidenceHash: evidence.evidenceHash, requestHash: catalogHash(operation.requestSnapshotJson),
    inputFingerprint: operation.inputFingerprint, definitionHash: execution.definitionHash, method: evidence.method, outcome: evidence.resultState, actionType: operation.actionType,
    scope, verifiedAt: evidence.verifiedAt.toISOString(), connection });
  return parsed.success ? parsed.data : null;
}

export async function learningMemorySourceCurrent(tx: LearningTransaction, userId: string, ref: PersonalMemory['sourceRef'], memoryId: string, lock = false) {
  if (!ref || !('kind' in ref) || ref.kind !== 'VERIFIED_OUTCOME') return false;
  const query = tx.select().from(learningCandidates).where(and(eq(learningCandidates.id, ref.candidateId), eq(learningCandidates.userId, userId),
    eq(learningCandidates.memoryId, memoryId), eq(learningCandidates.status, 'CONFIRMED'), eq(learningCandidates.evidenceId, ref.evidenceId)));
  const candidate = (await (lock ? query.for('update') : query))[0];
  if (!candidate || candidate.expiresAt <= new Date() || catalogHash(candidate.sourceJson) !== candidate.sourceHash) return false;
  const current = await readLearningSource(tx, userId, ref.evidenceId, lock);
  return Boolean(current && catalogHash(current) === candidate.sourceHash);
}
