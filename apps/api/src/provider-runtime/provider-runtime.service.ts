import { ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConnectorError, ProviderConnectorBridge, ProviderRuntimeError, providerDefinitionHash,
  validateOfficialEvidenceRevision, validateProviderCapabilityManifest, validateProviderRuntimePolicy,
  type ConnectorRequest, type OfficialEvidenceRevision, type ProviderAdapter, type ProviderCapabilityManifest,
  type ProviderOperation, type ProviderRuntimeHost, type ProviderRuntimePolicy, type ProviderHealth,
  type ProviderVerificationPolicy, type VerificationResult } from '@lazy-armor/connector-sdk';
import { connectionCapabilityGrants, connections, connectors, credentialRefs, providerCapabilityEvidence,
  providerCapabilityHealth, providerCapabilityManifests, providerRuntimePolicies, verificationPolicies, sideEffectOperations } from '@lazy-armor/database';
import { catalogHash, evaluateVerification, verificationPolicyHash } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CREDENTIAL_PROVIDER, CredentialProviderError, type CredentialProvider } from '../credentials/credential-provider';
import { VerificationPolicyRegistry } from '../execution/verification-policy-registry.service';
import { ActionAdapter } from '../execution/action-adapter.service';
import { SideEffectOperationsService } from '../execution/side-effect/side-effect-operations.service';
import { ConnectorRateLimitCoordinator } from '../infrastructure/connector-rate-limit-coordinator.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../provider-capabilities/provider-capability-registry.service';

// Extension host only: no direct execution endpoint, second credential store or Runner.
@Injectable()
export class ProviderRuntimeService implements ProviderRuntimeHost, OnModuleInit {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly manifests: ProviderCapabilityRegistryService, private readonly permissions: PermissionsService,
    private readonly usability: CapabilityUsabilityService, private readonly rates: ConnectorRateLimitCoordinator,
    private readonly quotas: RateLimiterService, private readonly verification: VerificationPolicyRegistry,
    private readonly actions: ActionAdapter, private readonly operations: SideEffectOperationsService) {}
  async onModuleInit() {
    for (const row of [...await this.list()].reverse()) this.installVerification(row.definitionJson as unknown as ProviderRuntimePolicy);
  }
  list() { return this.db.select().from(providerRuntimePolicies).orderBy(desc(providerRuntimePolicies.revision)); }
  async get(providerKey: string, revision?: number) {
    const row = (await this.db.select().from(providerRuntimePolicies).where(revision === undefined
      ? eq(providerRuntimePolicies.providerKey, providerKey)
      : and(eq(providerRuntimePolicies.providerKey, providerKey), eq(providerRuntimePolicies.revision, revision)))
      .orderBy(desc(providerRuntimePolicies.revision)).limit(1))[0];
    if (!row) throw new NotFoundException('Provider runtime policy not found');
    return row;
  }
  bridge(adapter: ProviderAdapter, manifest: ProviderCapabilityManifest, policy: ProviderRuntimePolicy) {
    return new ProviderConnectorBridge(adapter, manifest, policy, this);
  }
  private installVerification(policy: ProviderRuntimePolicy) {
    for (const item of policy.verificationPolicies) this.verification.register(item);
  }
  verifyEvidence(policy: ProviderVerificationPolicy, result: VerificationResult) {
    const conclusion = evaluateVerification(policy, result.method, result.evidence);
    return conclusion === result.state ? conclusion : 'OUTCOME_UNKNOWN';
  }
  async publish(input: { manifest: ProviderCapabilityManifest; evidence: OfficialEvidenceRevision; policy: ProviderRuntimePolicy }) {
    // Capture before the first await; callers cannot mutate a validated revision.
    const bundle = structuredClone(input);
    const { manifestHash: declaredHash, ...raw } = bundle.manifest as ProviderCapabilityManifest & { manifestHash?: string };
    const manifest = validateProviderCapabilityManifest(raw);
    if (declaredHash && declaredHash !== manifest.manifestHash) throw new ConflictException('Manifest digest mismatch');
    const { evidence, policy } = bundle;
    validateOfficialEvidenceRevision(evidence); validateProviderRuntimePolicy(policy, manifest);
    const evidenceHash = providerDefinitionHash(evidence); const policyHash = providerDefinitionHash(policy);
    if (evidence.providerKey !== manifest.providerKey || policy.evidence.key !== evidence.key
      || policy.evidence.revision !== evidence.revision || policy.evidence.hash !== evidenceHash) throw new ConflictException('Evidence binding mismatch');
    const known = new Map(this.verification.list().map((item) => [item.key + '@' + item.revision, item.definitionHash]));
    for (const item of policy.verificationPolicies) {
      if (!item.key.startsWith(manifest.providerKey + '.')) throw new ConflictException('Verification identity must be provider scoped');
      const hash = verificationPolicyHash(item);
      if (known.has(item.key + '@' + item.revision) && known.get(item.key + '@' + item.revision) !== hash) throw new ConflictException('Verification revision is immutable');
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const saved = await this.db.transaction(async (tx) => {
          const history = await tx.select().from(providerCapabilityManifests).where(eq(providerCapabilityManifests.providerKey, manifest.providerKey)).for('update');
          const priorManifest = history.find((item) => item.revision === manifest.revision);
          if (priorManifest && priorManifest.manifestHash !== manifest.manifestHash) throw new ConflictException('Manifest revision is immutable');
          if (history.some((item) => item.revision > manifest.revision)) throw new ConflictException('Manifest revision cannot move backwards');
          const manifestId = priorManifest?.id ?? newId(); const now = new Date();
          for (const item of policy.verificationPolicies) {
            const definitionHash = verificationPolicyHash(item);
            await tx.insert(verificationPolicies).values({ id: newId(), policyKey: item.key, revision: item.revision,
              definitionHash, definitionJson: item as unknown as Record<string, unknown>, createdAt: now })
              .onDuplicateKeyUpdate({ set: { policyKey: item.key } });
            const stored = (await tx.select().from(verificationPolicies).where(and(eq(verificationPolicies.policyKey, item.key), eq(verificationPolicies.revision, item.revision))))[0]!;
            if (stored.definitionHash !== definitionHash || catalogHash(stored.definitionJson) !== definitionHash) throw new ConflictException('Verification revision is immutable');
          }
          if (!priorManifest) {
            await tx.update(providerCapabilityManifests).set({ status: 'SUPERSEDED', supersededAt: now })
              .where(and(eq(providerCapabilityManifests.providerKey, manifest.providerKey), eq(providerCapabilityManifests.status, 'ACTIVE')));
            await tx.insert(providerCapabilityManifests).values({ id: manifestId, providerKey: manifest.providerKey,
              schemaVersion: manifest.schemaVersion, revision: manifest.revision, manifestHash: manifest.manifestHash,
              status: 'ACTIVE', manifestJson: manifest as unknown as Record<string, unknown>, createdAt: now });
          }
          const evidenceWhere = and(eq(providerCapabilityEvidence.providerKey, manifest.providerKey), eq(providerCapabilityEvidence.evidenceKey, evidence.key), eq(providerCapabilityEvidence.revision, evidence.revision));
          let priorEvidence = (await tx.select().from(providerCapabilityEvidence).where(evidenceWhere).for('update'))[0];
          if (priorEvidence && priorEvidence.evidenceHash !== evidenceHash) throw new ConflictException('Evidence revision is immutable');
          if (!priorEvidence) {
            await tx.insert(providerCapabilityEvidence).values({ id: newId(), manifestId, capabilityKey: null,
              providerKey: manifest.providerKey, evidenceKey: evidence.key, revision: evidence.revision, evidenceHash,
              evidenceKind: evidence.kind, reviewStatus: evidence.status, uri: evidence.uri, summary: evidence.summary,
              verifiedAt: evidence.reviewedAt ? new Date(evidence.reviewedAt) : null,
              definitionJson: evidence as unknown as Record<string, unknown>, createdAt: now });
            priorEvidence = (await tx.select().from(providerCapabilityEvidence).where(evidenceWhere))[0]!;
          }
          const policies = await tx.select().from(providerRuntimePolicies).where(eq(providerRuntimePolicies.providerKey, manifest.providerKey)).for('update');
          const prior = policies.find((item) => item.revision === policy.revision);
          if (prior && (prior.definitionHash !== policyHash || prior.manifestId !== manifestId || prior.evidenceId !== priorEvidence.id)) throw new ConflictException('Runtime policy revision is immutable');
          if (policies.some((item) => item.revision > policy.revision)) throw new ConflictException('Policy revision cannot move backwards');
          if (prior) return prior;
          const id = newId();
          await tx.insert(providerRuntimePolicies).values({ id, providerKey: manifest.providerKey, revision: policy.revision,
            manifestId, evidenceId: priorEvidence.id, definitionHash: policyHash,
            definitionJson: policy as unknown as Record<string, unknown>, createdAt: now });
          return (await tx.select().from(providerRuntimePolicies).where(eq(providerRuntimePolicies.id, id)))[0]!;
        });
        // Concurrent publishers may have moved forward. Install the DB's latest, never a stale caller copy.
        const active = (await this.db.select().from(providerCapabilityManifests).where(and(eq(providerCapabilityManifests.providerKey, manifest.providerKey), eq(providerCapabilityManifests.status, 'ACTIVE'))))[0];
        const current = this.manifests.list().find((item) => item.providerKey === manifest.providerKey);
        if (active && (!current || active.revision >= current.revision)) this.manifests.installRevision(active.manifestJson as unknown as ProviderCapabilityManifest);
        this.installVerification((await this.get(manifest.providerKey)).definitionJson as unknown as ProviderRuntimePolicy);
        return saved;
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        // Retry only rolled-back metadata transactions; no external I/O occurs here.
        if (attempt >= 3 || !['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY'].includes(cause.code ?? cause.cause?.code ?? '')) throw error;
      }
    }
  }
  private async owned(request: ConnectorRequest) {
    if (!request.userId || !request.connectionId) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const row = (await this.db.select({ id: connections.id, providerKey: connectors.key, status: connections.status,
      expiresAt: connections.expiresAt, credentialRef: credentialRefs.ref, credentialVersion: credentialRefs.currentVersion,
      credentialStatus: credentialRefs.status, credentialExpiresAt: credentialRefs.expiresAt })
      .from(connections).innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .leftJoin(credentialRefs, eq(connections.credentialRefId, credentialRefs.id))
      .where(and(eq(connections.id, request.connectionId), eq(connections.userId, request.userId))).limit(1))[0];
    if (!row || (request.connectorKey && request.connectorKey !== row.providerKey)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return row;
  }
  async resolveCredential(request: ConnectorRequest) {
    const row = await this.owned(request);
    if (!row.credentialRef) {
      if (request.credentials?.ref || request.credentials?.data) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      return {};
    }
    if (request.credentials?.ref && request.credentials.ref !== row.credentialRef) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    if (request.credentials?.version && request.credentials.version !== row.credentialVersion) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    try { return await this.credentials.get(row.credentialRef, row.credentialVersion ?? undefined); }
    catch (error) { throw new ProviderRuntimeError(error instanceof CredentialProviderError && error.code === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : 'AUTH_REVOKED', 'BEFORE_DISPATCH'); }
  }
  async beforeOperation(policy: ProviderRuntimePolicy, request: ConnectorRequest, operation: ProviderOperation) {
    const row = await this.owned(request);
    if (row.providerKey !== policy.providerKey || row.status === 'revoked') throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    if (row.credentialRef && row.credentialStatus !== 'active') throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
    if (row.credentialExpiresAt && row.credentialExpiresAt <= new Date()) throw new ProviderRuntimeError('AUTH_EXPIRED', 'BEFORE_DISPATCH');
    if (row.expiresAt && row.expiresAt <= new Date()) throw new ProviderRuntimeError('AUTH_EXPIRED', 'BEFORE_DISPATCH');
    const definition = await this.assertPolicyActive(policy);
    const internal = definition.sourceModes.every((mode) => ['MANUAL', 'OS_API'].includes(mode));
    const reviewed = (value: string | undefined) => value === 'VERIFIED' || (internal && value === 'NOT_REQUIRED');
    if (operation !== 'health') {
      if (!reviewed(definition.capabilities.find((item) => item.key === request.capability)?.reviewStatus)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
      if (operation === 'execute' || operation === 'subscribe' || operation === 'lookup') {
        if (!request.idempotencyKey) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
        const bound = (await this.db.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.userId, request.userId!),
          eq(sideEffectOperations.connectionId, row.id), eq(sideEffectOperations.capabilityKey, request.capability), eq(sideEffectOperations.idempotencyKey, request.idempotencyKey))).limit(1))[0];
        const allowed = operation === 'lookup' ? ['outcome_unknown', 'succeeded', 'executing'].includes(bound?.status ?? '') : bound?.status === 'executing';
        if (!bound || !allowed) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
        const rebuilt = await this.operations.rebuildRequest(bound.executionStepId);
        if (rebuilt.executionId !== bound.executionId || catalogHash(request.input) !== catalogHash({ context: rebuilt.triggerPayload, config: rebuilt.actionConfig })) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
        if (operation !== 'lookup') {
          try { await this.actions.assertOperation(bound.executionId, bound.executionStepId); }
          catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
        }
      }
      try { await this.permissions.assertGranted(request.userId!, row.id, request.capability); }
      catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
      const grant = (await this.db.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, row.id), eq(connectionCapabilityGrants.capabilityKey, request.capability))))[0];
      if (!grant || grant.providerKey !== policy.providerKey || grant.status !== 'GRANTED' || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= new Date())) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
      const view = await this.usability.resolveConnection(request.userId!, row.id);
      if (!view.capabilities.find((item) => item.key === request.capability)?.usable) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
      const health = (await this.db.select().from(providerCapabilityHealth).where(and(eq(providerCapabilityHealth.connectionId, row.id), eq(providerCapabilityHealth.capabilityKey, request.capability))))[0];
      const now = Date.now();
      if (!health || health.providerKey !== policy.providerKey || health.status !== 'HEALTHY' || health.checkedAt.getTime() > now
        || now - health.checkedAt.getTime() > policy.health.validForSeconds * 1000 || !health.validUntil || health.validUntil.getTime() <= now) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
    }
    try { await this.rates.acquire({ provider: 'runtime:' + policy.providerKey, connectionId: 'runtime:' + row.id,
      providerLimit: policy.rateLimit.providerRequests, connectionLimit: policy.rateLimit.connectionRequests, windowSeconds: policy.rateLimit.windowSeconds }); }
    catch (error) { if (error instanceof ConnectorError && error.code === 'RATE_LIMITED') throw new ProviderRuntimeError('RATE_LIMITED', 'BEFORE_DISPATCH', error.retryAfterMs); throw error; }
    const units = operation === 'health' ? 1 : policy.quota.capabilityUnits[request.capability];
    if (!units) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    for (const [key, limit] of [['provider:' + policy.providerKey, policy.quota.providerUnits], ['connection:' + row.id, policy.quota.connectionUnits]] as const) {
      const budget = await this.quotas.consume('provider-runtime:quota:' + key, limit, policy.quota.windowSeconds, units);
      if (!budget.allowed) throw new ProviderRuntimeError('QUOTA_EXCEEDED', 'BEFORE_DISPATCH', budget.retryAfterSeconds * 1000);
    }
  }
  async assertPolicyActive(policy: ProviderRuntimePolicy): Promise<ProviderCapabilityManifest> {
    let saved: Awaited<ReturnType<ProviderRuntimeService['get']>>;
    try { saved = await this.get(policy.providerKey); }
    catch (error) { if (error instanceof NotFoundException) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH'); throw error; }
    if (saved.revision !== policy.revision || saved.definitionHash !== providerDefinitionHash(policy)
      || providerDefinitionHash(saved.definitionJson) !== saved.definitionHash) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
    const evidence = (await this.db.select().from(providerCapabilityEvidence).where(eq(providerCapabilityEvidence.id, saved.evidenceId)))[0];
    const manifest = (await this.db.select().from(providerCapabilityManifests).where(eq(providerCapabilityManifests.id, saved.manifestId)))[0];
    const definition = manifest?.manifestJson as unknown as ProviderCapabilityManifest | undefined;
    const internal = definition?.sourceModes.every((mode) => ['MANUAL', 'OS_API'].includes(mode));
    const reviewed = (value: string | undefined) => value === 'VERIFIED' || (internal && value === 'NOT_REQUIRED');
    const { manifestHash: storedHash, ...rawManifest } = (definition ?? {}) as ProviderCapabilityManifest & { manifestHash?: string };
    if (!manifest || manifest.status !== 'ACTIVE' || !reviewed(evidence?.reviewStatus) || !reviewed(definition?.providerReview)
      || (!internal && evidence?.evidenceKind !== 'OFFICIAL_DOC')
      || evidence?.evidenceHash !== policy.evidence.hash || providerDefinitionHash(evidence?.definitionJson) !== evidence.evidenceHash
      || storedHash !== manifest.manifestHash || validateProviderCapabilityManifest(rawManifest as ProviderCapabilityManifest).manifestHash !== manifest.manifestHash)
      throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
    return definition!;
  }
  async connectionView(userId: string, connectionId: string) {
    const view = await this.usability.resolveConnection(userId, connectionId);
    const policies = await this.db.select().from(providerRuntimePolicies).where(eq(providerRuntimePolicies.providerKey, view.providerKey)).orderBy(desc(providerRuntimePolicies.revision)).limit(1);
    return { ...view, runtimePolicy: policies[0] ?? null, runtimeRegistered: policies.length > 0 };
  }
  async recordHealth(policy: ProviderRuntimePolicy, request: ConnectorRequest, health: ProviderHealth) {
    const row = await this.owned(request); const now = new Date();
    const statuses: Record<string, string> = { healthy: 'HEALTHY', degraded: 'DEGRADED', unhealthy: 'UNHEALTHY',
      reauthorization_required: 'REAUTHORIZATION_REQUIRED', rate_limited: 'RATE_LIMITED', provider_unavailable: 'PROVIDER_UNAVAILABLE' };
    const status = statuses[health.status] ?? 'UNKNOWN';
    const manifest = this.manifests.get(policy.providerKey);
    await this.db.transaction(async (tx) => {
      const locked = (await tx.select({ status: connections.status }).from(connections).where(and(eq(connections.id, row.id), eq(connections.userId, request.userId!))).for('update'))[0];
      if (!locked || locked.status === 'revoked' || row.providerKey !== policy.providerKey) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH');
      for (const capability of manifest.capabilities) {
        await tx.insert(providerCapabilityHealth).values({ id: newId(), connectionId: row.id, providerKey: policy.providerKey,
          capabilityKey: capability.key, status, reasonCode: null, detail: null, checkedAt: now,
          validUntil: new Date(now.getTime() + policy.health.validForSeconds * 1000), createdAt: now, updatedAt: now })
          .onDuplicateKeyUpdate({ set: { status, reasonCode: null, detail: null, checkedAt: now,
            validUntil: new Date(now.getTime() + policy.health.validForSeconds * 1000), updatedAt: now } });
      }
    });
  }
}
