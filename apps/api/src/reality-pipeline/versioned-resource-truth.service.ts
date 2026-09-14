import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validateProviderCapabilityManifest, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { candidateFacts, connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, connectors,
  credentialRefs, providerCapabilityHealth, providerCapabilityManifests, sourceObservations, truthProvenance, truthRecords, truthRecordVersions, users, webhookReceipts } from '@lazy-armor/database';
import { candidateDedupeKey, parseAndNormalizeObservation, realityValueHash, versionedFactIdentity, type JsonValue } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { StrategyRuntimeService } from '../strategy-runtime/strategy-runtime.service';

export interface ResourceReadProof {
  capabilityKey: string; credentialVersion: number; requestId: string; acquiredAt: string;
  acquisitionLease?: { receiptId: string; leaseToken: string };
}

// Additive generic projection into the EXISTING Truth tables. No new store or Engine.
// Only server-acquired read proofs may enter this path; consumer confirmation cannot manufacture one.
@Injectable()
export class VersionedResourceTruthService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService,
    private readonly strategy: StrategyRuntimeService) {}

  async confirm(userId: string, candidateId: string, proof: ResourceReadProof, retry = 0): Promise<string> {
    const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (!proof || !Number.isSafeInteger(proof.credentialVersion) || proof.credentialVersion < 1
      || typeof proof.requestId !== 'string' || !/^[A-Za-z0-9:_.-]{1,255}$/.test(proof.requestId)
      || typeof proof.capabilityKey !== 'string' || !Number.isFinite(Date.parse(proof.acquiredAt))
      || (proof.acquisitionLease !== undefined && (!proof.acquisitionLease || typeof proof.acquisitionLease.receiptId !== 'string'
        || !uuid.test(proof.acquisitionLease.receiptId) || typeof proof.acquisitionLease.leaseToken !== 'string' || !uuid.test(proof.acquisitionLease.leaseToken)))) {
      throw new ForbiddenException('A server-acquired resource read proof is required');
    }
    const acquiredAt = new Date(proof.acquiredAt);
    const first = (await this.db.select().from(candidateFacts).where(and(eq(candidateFacts.id, candidateId), eq(candidateFacts.userId, userId))).limit(1))[0];
    if (!first) throw new NotFoundException('Candidate fact not found');
    const observation = (await this.db.select().from(sourceObservations).where(and(eq(sourceObservations.id, first.observationId), eq(sourceObservations.userId, userId))).limit(1))[0];
    if (!observation?.connectionId || observation.parserKey !== 'generic.repository-resource.v2' || observation.sourceMode !== 'OFFICIAL_API') {
      throw new ForbiddenException('Versioned resource requires an authenticated API acquisition');
    }
    try { return await this.db.transaction(async (tx) => {
      const now = new Date();
      if (acquiredAt.getTime() > now.getTime() + 300_000) throw new ConflictException('Read acquisition clock is invalid');
      // Lock the authorization fence before publication. Revoke/permission/credential
      // rotation must either commit first (and reject us) or wait until this append commits.
      const owned = (await tx.select({ connection: connections, providerKey: connectors.key, userStatus: users.status }).from(connections)
        .innerJoin(connectors, eq(connectors.id, connections.connectorId)).innerJoin(users, eq(users.id, connections.userId))
        .where(and(eq(connections.id, observation.connectionId!), eq(connections.userId, userId))).limit(1).for('update'))[0];
      if (!owned || owned.userStatus !== 'active' || owned.providerKey !== observation.providerKey
        || !['connected', 'degraded', 'provider_error'].includes(owned.connection.status)
        || (owned.connection.expiresAt && owned.connection.expiresAt <= now) || !owned.connection.credentialRefId) {
        throw new ForbiddenException('Resource connection is not available');
      }
      const permission = (await tx.select({ permission: connectionPermissions, capability: connectorCapabilities }).from(connectionPermissions)
        .innerJoin(connectorCapabilities, eq(connectorCapabilities.id, connectionPermissions.connectorCapabilityId))
        .where(and(eq(connectionPermissions.connectionId, observation.connectionId!), eq(connectorCapabilities.key, proof.capabilityKey)))
        .limit(1).for('update'))[0];
      const grant = (await tx.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, observation.connectionId!),
        eq(connectionCapabilityGrants.capabilityKey, proof.capabilityKey))).limit(1).for('update'))[0];
      const credential = (await tx.select().from(credentialRefs).where(eq(credentialRefs.id, owned.connection.credentialRefId)).limit(1).for('update'))[0];
      const health = (await tx.select().from(providerCapabilityHealth).where(and(eq(providerCapabilityHealth.connectionId, observation.connectionId!),
        eq(providerCapabilityHealth.capabilityKey, proof.capabilityKey))).limit(1).for('update'))[0];
      if (!permission || permission.capability.connectorId !== owned.connection.connectorId || permission.capability.operation !== 'read'
        || permission.permission.granted !== 1 || permission.permission.revokedAt || (permission.permission.expiresAt && permission.permission.expiresAt <= now)
        || !grant || grant.providerKey !== owned.providerKey || grant.status !== 'GRANTED' || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now)
        || !credential || credential.status !== 'active' || credential.currentVersion !== proof.credentialVersion
        || (credential.expiresAt && credential.expiresAt <= now) || !health || health.providerKey !== owned.providerKey
        || health.status !== 'HEALTHY' || health.checkedAt > now || !health.validUntil || health.validUntil <= now) {
        throw new ForbiddenException('Resource authorization changed before publication');
      }
      const sourceReadFence = { connectionId: observation.connectionId, credentialRefId: credential.id,
        credentialVersion: credential.currentVersion, capabilityKey: proof.capabilityKey };
      let assertAcquisitionCurrent: (() => void) | undefined;
      if (proof.acquisitionLease) {
        // Close the precheck→publication race. Holding the receipt row until
        // append commits serializes confirmation BEFORE any successor claim.
        // Normal direct API reads have no lease and preserve the previous path.
        const receipt = (await tx.select().from(webhookReceipts).where(and(eq(webhookReceipts.id, proof.acquisitionLease.receiptId),
          eq(webhookReceipts.connectionId, observation.connectionId!))).limit(1).for('update'))[0];
        const leaseToken = proof.acquisitionLease.leaseToken;
        assertAcquisitionCurrent = () => {
          const leaseNow = new Date(); // Recompute after EVERY publication lock barrier.
          if ((owned.connection.expiresAt && owned.connection.expiresAt <= leaseNow)
            || (permission.permission.expiresAt && permission.permission.expiresAt <= leaseNow)
            || (grant.expiresAt && grant.expiresAt <= leaseNow)
            || (credential.expiresAt && credential.expiresAt <= leaseNow)) {
            throw new ForbiddenException('Resource authorization expired while waiting for publication locks');
          }
          if (!receipt || receipt.acquisitionProviderKey !== owned.providerKey || receipt.acquisitionStatus !== 'PROCESSING'
            || receipt.acquisitionLeaseToken !== leaseToken || !receipt.acquisitionLeaseUntil || receipt.acquisitionLeaseUntil <= leaseNow
            || !receipt.expiresAt || receipt.expiresAt <= leaseNow || receipt.purgedAt || receipt.payloadSnapshotJson?.capability !== proof.capabilityKey
            || receipt.acquisitionResultJson?.hintHash !== realityValueHash(receipt.payloadSnapshotJson) || health.validUntil! <= leaseNow) {
            throw new ConflictException('Acquisition authorization lease changed before Truth publication');
          }
        };
        assertAcquisitionCurrent();
      }
      const candidate = (await tx.select().from(candidateFacts).where(and(eq(candidateFacts.id, candidateId), eq(candidateFacts.userId, userId))).limit(1).for('update'))[0]!;
      let draft;
      try { draft = parseAndNormalizeObservation({ providerKey: observation.providerKey, connectionId: observation.connectionId,
        sourceMode: 'OFFICIAL_API', parserKey: 'generic.repository-resource.v2', resourceHint: observation.resourceHint,
        externalEventKey: observation.externalEventKey, observedAt: observation.observedAt.toISOString(),
        payload: observation.payloadJson as Record<string, JsonValue>, evidenceHash: observation.evidenceHash })[0]; }
      catch { throw new ConflictException('Versioned source integrity check failed'); }
      if (candidate.normalizerKey !== 'repository-resource.v2' || candidate.conflictPolicyKey !== 'latest_verified_then_observed.v2'
        || candidate.freshnessPolicyKey !== 'repository.resource.v2' || candidate.compatibilityResourceKey
        || observation.payloadHash !== realityValueHash(observation.payloadJson) || candidate.dedupeKey !== candidateDedupeKey(userId, draft)
        || candidate.resourceType !== draft.resourceType || candidate.resourceKey !== draft.resourceKey
        || candidate.subjectKey !== draft.subjectKey || candidate.factKey !== draft.factKey
        || candidate.valueHash !== realityValueHash(candidate.valueJson) || candidate.valueHash !== realityValueHash(draft.value)) throw new ConflictException('Versioned candidate integrity check failed');
      const manifestRow = (await tx.select().from(providerCapabilityManifests).where(and(eq(providerCapabilityManifests.providerKey, owned.providerKey),
        eq(providerCapabilityManifests.status, 'ACTIVE'))).limit(1).for('update'))[0];
      if (!manifestRow) throw new ForbiddenException('Resource manifest is not active');
      const { manifestHash: embedded, ...raw } = manifestRow.manifestJson as unknown as ProviderCapabilityManifest & { manifestHash?: string };
      let manifest;
      try { manifest = validateProviderCapabilityManifest(raw); } catch { throw new ForbiddenException('Resource manifest integrity check failed'); }
      const declared = manifest.capabilities.find((capability) => capability.key === proof.capabilityKey);
      if (embedded !== manifestRow.manifestHash || manifest.manifestHash !== manifestRow.manifestHash || manifest.providerReview !== 'VERIFIED'
        || !declared || declared.operation !== 'read' || declared.officialAvailability !== 'AVAILABLE' || declared.reviewStatus !== 'VERIFIED'
        || !['BETA', 'PRODUCTION'].includes(declared.implementationStatus) || declared.explicitDenials.length
        || !declared.dataBoundary.resources.includes(candidate.resourceType)
        || !declared.oauthScopes.every((scope) => grant.grantedScopesJson.includes(scope))) throw new ForbiddenException('Resource data boundary is not available');
      const identity = versionedFactIdentity(userId, observation.connectionId!, candidate);
      let record = (await tx.select().from(truthRecords).where(eq(truthRecords.factIdentityHash, identity)).limit(1).for('update'))[0];
      let previous: typeof truthRecordVersions.$inferSelect | undefined;
      if (record) {
        if (record.userId !== userId || record.resourceKey !== candidate.resourceType || record.subjectKey !== candidate.subjectKey
          || record.status !== 'verified' || !record.currentVersionId) throw new ConflictException('Versioned Truth is blocked or incomplete');
        previous = (await tx.select().from(truthRecordVersions).where(and(eq(truthRecordVersions.id, record.currentVersionId),
          eq(truthRecordVersions.truthRecordId, record.id))).limit(1))[0];
        if (!previous || previous.valueHash !== realityValueHash(previous.valueJson) || previous.valueJson.factKey !== candidate.factKey
          || previous.valueJson.resourceKey !== candidate.resourceKey) throw new ConflictException('Truth version integrity check failed');
      }
      assertAcquisitionCurrent?.(); // Candidate/manifest/Truth locks may also have waited.
      if (candidate.status === 'SUPERSEDED' && record && candidate.truthRecordId === record.id) return record.id;
      if (!['PENDING', 'VERIFIED'].includes(candidate.status) || (candidate.status === 'VERIFIED' && candidate.truthRecordId !== record?.id)) {
        throw new ConflictException('Versioned candidate has already been decided');
      }
      const epoch = resourceEpoch(candidate.valueJson);
      if (epoch > acquiredAt.getTime() + 300_000) throw new ConflictException('Provider update time is invalid');
      const oldValue = previous?.valueJson.value as Record<string, unknown> | undefined;
      const oldEpoch = previous ? resourceEpoch(oldValue!) : null;
      const audit = async (action: string, result: 'success' | 'blocked', details: Record<string, unknown>) => this.audit.append({
        actorType: 'system', action, resourceType: 'truth_record', resourceId: record!.id, userId, correlationId: proof.requestId,
        causationId: observation.id, after: { factIdentityHash: identity, candidateId, credentialVersion: proof.credentialVersion,
          evidenceHash: observation.evidenceHash, acquiredAt: acquiredAt.toISOString(), ...details },
        changeSummary: `${action}: ${candidate.factKey}`, source: 'api', result,
      }, tx);
      if (record && previous && realityValueHash(oldValue) === candidate.valueHash) {
        if (acquiredAt > record.verifiedAt) {
          await tx.update(truthRecords).set({ verifiedAt: acquiredAt, sourceReadFenceJson: sourceReadFence, updatedAt: now }).where(eq(truthRecords.id, record.id));
          await audit('GENERIC_TRUTH_REVALIDATED', 'success', { truthRecordVersionId: previous.id });
        }
        assertAcquisitionCurrent?.(); // Roll back if waiting for Audit consumed the deadline.
        return record.id; // No value mutation, new version or false CHANGED wakeup.
      }
      if (record && previous && oldEpoch !== null && epoch <= oldEpoch) {
        if (candidate.status === 'VERIFIED') return record.id; // A replay of an already accepted old version never rolls back current.
        const conflict = epoch === oldEpoch;
        await tx.update(candidateFacts).set({ status: conflict ? 'CONFLICT' : 'SUPERSEDED', truthRecordId: record.id, decidedAt: now }).where(eq(candidateFacts.id, candidateId));
        if (conflict) await tx.update(truthRecords).set({ status: 'conflicted', updatedAt: now }).where(eq(truthRecords.id, record.id));
        await audit(conflict ? 'GENERIC_TRUTH_CONFLICT_BLOCKED' : 'GENERIC_TRUTH_CANDIDATE_SUPERSEDED', 'blocked', { currentVersionId: previous.id, incomingEpoch: epoch, currentEpoch: oldEpoch });
        assertAcquisitionCurrent?.();
        return record.id;
      }
      if (!record) {
        const id = newId();
        await tx.insert(truthRecords).values({ id, userId, resourceKey: candidate.resourceType, subjectKey: candidate.subjectKey,
          factIdentityHash: identity, status: 'verified', currentVersionId: null, sourceReceiptId: null, verifiedBy: 'authenticated_provider_read',
          verifiedAt: acquiredAt, revokedAt: null, createdAt: now, updatedAt: now });
        record = (await tx.select().from(truthRecords).where(eq(truthRecords.id, id)).limit(1))[0]!;
      }
      const versionId = newId(); const number = (previous?.versionNumber ?? 0) + 1;
      const value = { resourceType: candidate.resourceType, resourceKey: candidate.resourceKey, subjectKey: candidate.subjectKey, factKey: candidate.factKey,
        value: candidate.valueJson, observedAt: observation.observedAt.toISOString(), occurredAt: observation.occurredAt?.toISOString() ?? null,
        confidence: candidate.confidence / 100, realityLevel: 'VERIFIED' };
      await tx.insert(truthRecordVersions).values({ id: versionId, truthRecordId: record.id, versionNumber: number, valueJson: value,
        valueHash: realityValueHash(value), evidenceHash: observation.evidenceHash, verificationMethod: 'READ_BACK', createdAt: now });
      await tx.insert(truthProvenance).values({ id: newId(), truthRecordVersionId: versionId, candidateFactId: candidateId,
        observationId: observation.id, providerKey: observation.providerKey, sourceMode: observation.sourceMode,
        evidenceHash: observation.evidenceHash, observedAt: observation.observedAt, createdAt: now });
      await tx.update(truthRecords).set({ currentVersionId: versionId, sourceReadFenceJson: sourceReadFence, verifiedAt: acquiredAt > record.verifiedAt ? acquiredAt : record.verifiedAt, updatedAt: now }).where(eq(truthRecords.id, record.id));
      await tx.update(candidateFacts).set({ status: 'VERIFIED', truthRecordId: record.id, decidedAt: now }).where(eq(candidateFacts.id, candidateId));
      await this.strategy.enqueueTruthChange(userId, { truthRecordVersionId: versionId, factKey: candidate.factKey,
        resourceType: candidate.resourceType, subjectKey: candidate.subjectKey }, tx);
      await audit('GENERIC_TRUTH_VERSION_APPENDED', 'success', { truthRecordVersionId: versionId, versionNumber: number });
      assertAcquisitionCurrent?.(); // Last fence BEFORE commit; all appends roll back together.
      return record.id;
    }); } catch (error) {
      if (retry < 3 && concurrencyError(error)) return this.confirm(userId, candidateId, proof, retry + 1);
      throw error;
    }
  }
}

function resourceEpoch(value: Record<string, unknown>) {
  const result = Date.parse(value.updatedAt as string);
  if (!Number.isFinite(result)) throw new ConflictException('Resource version ordering evidence is missing');
  return result;
}
function concurrencyError(error: unknown) { let current = error; for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
  const item = current as { code?: string; cause?: unknown }; if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(item.code ?? '')) return true; current = item.cause;
} return false; }
