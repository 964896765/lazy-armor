import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { resolveCapability, type ResolutionCandidate } from '@lazy-armor/connector-sdk';
import { canonicalStringify } from '@lazy-armor/plan-schema';
import { capabilityResolutionDecisions, connections, connectors, connectionCapabilityGrants, providerCapabilityHealth, plans, planVersions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { ProviderCapabilityRegistryService } from '../provider-capabilities/provider-capability-registry.service';
import type { ResolveCapabilityDto } from './dto';
import { ResolutionEvidenceService } from './resolution-evidence.service';

@Injectable()
export class CapabilityResolverService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly manifests: ProviderCapabilityRegistryService, private readonly audit: AuditService,
    private readonly evidence: ResolutionEvidenceService) {}

  async resolve(userId: string, input: ResolveCapabilityDto) {
    const owned = (await this.db.select({ id: planVersions.id }).from(planVersions)
      .innerJoin(plans, and(eq(plans.id, planVersions.planId), eq(plans.userId, userId)))
      .where(eq(planVersions.id, input.planVersionId)).limit(1))[0];
    if (!owned) throw new NotFoundException('Plan version not found');
    const requestHash = hash(input);
    const prior = await this.findRequest(userId, input.requestKey);
    if (prior) return this.replay(prior, requestHash);
    const candidates = await this.collectCandidates(userId, input, new Date());
    const now = new Date();
    const decision = resolveCapability(input.requirement, candidates, now.toISOString());
    const id = newId();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(capabilityResolutionDecisions).values({ id, userId, planVersionId: input.planVersionId,
          requestKey: input.requestKey, requestHash, decisionHash: hash(decision),
          inputJson: { requirement: input.requirement, candidates }, decisionJson: decision, createdAt: now });
        await this.audit.append({ actorType: 'user', actorUserId: userId, userId,
          action: 'CAPABILITY_RESOLUTION_DECIDED', resourceType: 'capability_resolution', resourceId: id,
          correlationId: input.planVersionId, after: { status: decision.status, decisionHash: hash(decision) },
          changeSummary: 'Persisted capability selection and hard-filter reasons', source: 'api', result: decision.status === 'RESOLVED' ? 'success' : 'blocked' }, tx);
      });
    } catch (error) {
      let cause: unknown = error;
      let duplicate = false;
      for (let i = 0; i < 5 && cause && typeof cause === 'object'; i++) {
        const item = cause as { code?: string; cause?: unknown };
        if (item.code === 'ER_DUP_ENTRY') duplicate = true;
        cause = item.cause;
      }
      if (!duplicate) throw error;
    }
    const saved = await this.findRequest(userId, input.requestKey);
    if (!saved) throw new ConflictException('Resolution not persisted');
    return this.replay(saved, requestHash);
  }

  async get(userId: string, id: string) {
    const row = (await this.db.select().from(capabilityResolutionDecisions)
      .where(and(eq(capabilityResolutionDecisions.id, id), eq(capabilityResolutionDecisions.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Resolution not found');
    return row;
  }

  private findRequest(userId: string, key: string) {
    return this.db.select().from(capabilityResolutionDecisions)
      .where(and(eq(capabilityResolutionDecisions.userId, userId), eq(capabilityResolutionDecisions.requestKey, key)))
      .limit(1).then((rows) => rows[0]);
  }

  private replay(row: typeof capabilityResolutionDecisions.$inferSelect, requestHash: string) {
    if (row.requestHash !== requestHash) throw new ConflictException('Resolution request key reused with different input');
    return row;
  }

  private async collectCandidates(userId: string, input: ResolveCapabilityDto, now: Date): Promise<ResolutionCandidate[]> {
    const rows = await this.db.select({ connection: connections, providerKey: connectors.key }).from(connections)
      .innerJoin(connectors, eq(connectors.id, connections.connectorId)).where(eq(connections.userId, userId));
    const candidates: ResolutionCandidate[] = [];
    for (const row of rows) {
      const manifest = this.manifests.list().find((item) => item.providerKey === row.providerKey);
      if (!manifest) continue;
      const grants = await this.db.select().from(connectionCapabilityGrants).where(eq(connectionCapabilityGrants.connectionId, row.connection.id));
      const health = await this.db.select().from(providerCapabilityHealth).where(eq(providerCapabilityHealth.connectionId, row.connection.id));
      for (const capability of manifest.capabilities.filter((item) => item.key === input.requirement.capabilityKey)) {
        const grant = grants.find((item) => item.capabilityKey === capability.key);
        const check = health.find((item) => item.capabilityKey === capability.key);
        const evidence = await this.evidence.read(row.providerKey, { userId, connectionId: row.connection.id,
          capabilityKey: capability.key, resource: input.requirement.resource, planVersionId: input.planVersionId });
        candidates.push({ id: `${row.connection.id}:${capability.key}`, providerKey: row.providerKey,
          manifestRevision: manifest.revision, manifestHash: manifest.manifestHash, capability,
          connectionReady: row.connection.status === 'connected' && (!row.connection.expiresAt || row.connection.expiresAt > now),
          grantSatisfied: grant?.status === 'GRANTED' && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now)
            && capability.oauthScopes.every((scope) => grant.grantedScopesJson.includes(scope)),
          healthUsable: check?.status === 'HEALTHY' && check.validUntil !== null && check.validUntil > now && check.checkedAt <= now,
          // Account/device/data-freshness evidence is supplied by future verified provider adapters.
          // A health probe alone is not evidence about account type or resource freshness.
          accountSatisfied: capability.accountTypes.length === 0 || evidence?.accountSatisfied === true,
          deviceSatisfied: evidence?.deviceSatisfied === true || (capability.androidPermissions.length === 0 && !capability.sourceModes.some((mode) => ['APP_READ', 'VISION', 'OS_API', 'NOTIFICATION'].includes(mode))),
          explicitlyDenied: manifest.explicitDenials.includes(capability.key) || capability.explicitDenials.includes(capability.key),
          reality: evidence?.reality ?? 'CLAIMED', observedAt: evidence?.observedAt ?? null,
          costMicros: evidence?.costMicros ?? null, latencyMs: evidence?.latencyMs ?? null, reliability: evidence?.reliability ?? null });
      }
    }
    return candidates;
  }
}
function hash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
