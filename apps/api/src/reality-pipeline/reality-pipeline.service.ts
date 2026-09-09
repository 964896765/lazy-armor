import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  REALITY_ADAPTER_REGISTRY, REALITY_POLICY_REGISTRY, candidateDedupeKey, catalogHash, observationIdentity,
  parseAndNormalizeObservation, realityValueHash, type SourceObservationInput,
} from '@lazy-armor/plan-schema';
import {
  candidateFacts, realityAdapterDefinitions, realityPolicyDefinitions, sourceObservations,
  truthProvenance, truthRecords, truthRecordVersions,
} from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { StrategyRuntimeService } from '../strategy-runtime/strategy-runtime.service';

@Injectable()
export class RealityPipelineService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
    private readonly strategyRuntime: StrategyRuntimeService,
  ) {}
  async onModuleInit() { await this.syncRegistry(); }

  async ingest(userId: string, input: SourceObservationInput) {
    const observedAt = validDate(input.observedAt, 'observedAt');
    const occurredAt = input.occurredAt ? validDate(input.occurredAt, 'occurredAt') : null;
    if (!/^[a-f0-9]{64}$/.test(input.evidenceHash)) throw new BadRequestException('evidenceHash must be SHA-256');
    let drafts;
    try { drafts = parseAndNormalizeObservation(input); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Observation parser failed'); }
    const identity = observationIdentity(input.providerKey, input.externalEventKey);
    const payloadHash = realityValueHash(input.payload);
    let observation = (await this.db.select().from(sourceObservations).where(and(eq(sourceObservations.userId, userId), eq(sourceObservations.sourceIdentity, identity))).limit(1))[0];
    let duplicate = Boolean(observation);
    if (observation && observation.payloadHash !== payloadHash) throw new ConflictException('Observation identity cannot be reused with different evidence');
    if (!observation) {
      const id = newId();
      try {
        await this.db.insert(sourceObservations).values({ id, userId, connectionId: input.connectionId ?? null, sourceMode: input.sourceMode, providerKey: input.providerKey, externalEventKey: input.externalEventKey, sourceIdentity: identity, parserKey: input.parserKey, resourceHint: input.resourceHint, payloadHash, evidenceHash: input.evidenceHash, payloadJson: input.payload as Record<string, unknown>, status: 'NORMALIZED', observedAt, occurredAt, receivedAt: new Date() });
        observation = (await this.db.select().from(sourceObservations).where(eq(sourceObservations.id, id)).limit(1))[0];
      } catch (error) {
        if (!isDuplicate(error)) throw error;
        duplicate = true;
        observation = (await this.db.select().from(sourceObservations).where(and(eq(sourceObservations.userId, userId), eq(sourceObservations.sourceIdentity, identity))).limit(1))[0];
        if (!observation || observation.payloadHash !== payloadHash) throw new ConflictException('Observation identity cannot be reused with different evidence');
      }
    }
    if (!observation) throw new ConflictException('Observation could not be materialized');
    const candidates = [];
    for (const draft of drafts) {
      const dedupeKey = candidateDedupeKey(userId, draft);
      let candidate = (await this.db.select().from(candidateFacts).where(and(eq(candidateFacts.userId, userId), eq(candidateFacts.dedupeKey, dedupeKey))).limit(1))[0];
      if (!candidate) {
        const id = newId();
        try {
          await this.db.insert(candidateFacts).values({ id, userId, observationId: observation.id, resourceType: draft.resourceType, resourceKey: draft.resourceKey, subjectKey: draft.subjectKey, factKey: draft.factKey, valueJson: draft.value as Record<string, unknown>, valueHash: realityValueHash(draft.value), dedupeKey, confidence: Math.round(draft.confidence * 100), normalizerKey: draft.normalizerKey, freshnessPolicyKey: draft.freshnessPolicyKey, conflictPolicyKey: draft.conflictPolicyKey, compatibilityResourceKey: draft.compatibilityResourceKey ?? null, status: 'PENDING', truthRecordId: null, decidedAt: null, createdAt: new Date() });
          candidate = (await this.db.select().from(candidateFacts).where(eq(candidateFacts.id, id)).limit(1))[0];
        } catch (error) {
          if (!isDuplicate(error)) throw error;
          candidate = (await this.db.select().from(candidateFacts).where(and(eq(candidateFacts.userId, userId), eq(candidateFacts.dedupeKey, dedupeKey))).limit(1))[0];
        }
      }
      if (!candidate) throw new ConflictException('Candidate could not be materialized');
      candidates.push(this.candidateResponse(candidate));
    }
    return { observationId: observation.id, duplicate, candidates };
  }

  async listPending(userId: string) {
    const rows = await this.db.select().from(candidateFacts).where(and(eq(candidateFacts.userId, userId), eq(candidateFacts.status, 'PENDING'))).orderBy(desc(candidateFacts.createdAt));
    return rows.map((row) => this.candidateResponse(row));
  }

  async listTruth(userId: string) {
    const rows = await this.db.select({ id: truthRecords.id }).from(truthRecords).where(and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'))).orderBy(desc(truthRecords.verifiedAt));
    return Promise.all(rows.map((row) => this.truthResponse(userId, row.id)));
  }

  async confirmCandidate(userId: string, candidateId: string, options: { sourceReceiptId?: string | null; verifiedBy?: string; verificationMethod?: string } = {}, retryCount = 0): Promise<Awaited<ReturnType<RealityPipelineService['truthResponse']>>> {
    const existing = await this.getCandidate(userId, candidateId);
    if (existing.status === 'VERIFIED' && existing.truthRecordId) return this.truthResponse(userId, existing.truthRecordId);
    if (existing.status !== 'PENDING') throw new ConflictException('Candidate has already been decided');
    const observation = (await this.db.select().from(sourceObservations).where(eq(sourceObservations.id, existing.observationId)).limit(1))[0];
    if (!observation) throw new ConflictException('Candidate provenance is incomplete');
    const now = new Date(); const truthId = newId(); const versionId = newId();
    const value = existing.compatibilityResourceKey
      ? { resource: existing.compatibilityResourceKey, ...existing.valueJson, occurredAt: observation.occurredAt?.toISOString() ?? observation.observedAt.toISOString() }
      : { resourceType: existing.resourceType, resourceKey: existing.resourceKey, subjectKey: existing.subjectKey, factKey: existing.factKey, value: existing.valueJson, observedAt: observation.observedAt.toISOString(), occurredAt: observation.occurredAt?.toISOString() ?? null, confidence: existing.confidence / 100, realityLevel: 'VERIFIED' };
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(truthRecords).values({ id: truthId, userId, resourceKey: existing.compatibilityResourceKey ?? existing.resourceType, subjectKey: existing.subjectKey, status: 'verified', currentVersionId: null, sourceReceiptId: options.sourceReceiptId ?? null, verifiedBy: options.verifiedBy ?? 'user_confirmation', verifiedAt: now, revokedAt: null, createdAt: now, updatedAt: now });
        await tx.insert(truthRecordVersions).values({ id: versionId, truthRecordId: truthId, versionNumber: 1, valueJson: value, valueHash: realityValueHash(value), verificationMethod: options.verificationMethod ?? options.verifiedBy ?? 'user_confirmation', evidenceHash: observation.evidenceHash, createdAt: now });
        await tx.insert(truthProvenance).values({ id: newId(), truthRecordVersionId: versionId, candidateFactId: candidateId, observationId: observation.id, providerKey: observation.providerKey, sourceMode: observation.sourceMode, evidenceHash: observation.evidenceHash, observedAt: observation.observedAt, createdAt: now });
        await tx.update(truthRecords).set({ currentVersionId: versionId, updatedAt: now }).where(eq(truthRecords.id, truthId));
        await tx.update(candidateFacts).set({ status: 'VERIFIED', truthRecordId: truthId, decidedAt: now }).where(and(eq(candidateFacts.id, candidateId), eq(candidateFacts.status, 'PENDING')));
        await this.strategyRuntime.enqueueTruthChange(userId, {
          truthRecordVersionId: versionId,
          factKey: existing.factKey,
          resourceType: existing.resourceType,
          subjectKey: existing.subjectKey,
        }, tx);
      });
    } catch (error) {
      if (!isDuplicate(error) && !isDeadlock(error)) throw error;
      const raced = await this.getCandidate(userId, candidateId);
      if (!raced.truthRecordId && isDeadlock(error) && raced.status === 'PENDING' && retryCount < 2) {
        return this.confirmCandidate(userId, candidateId, options, retryCount + 1);
      }
      if (!raced.truthRecordId) throw new ConflictException('Candidate confirmation conflicted; retry safely');
      return this.truthResponse(userId, raced.truthRecordId);
    }
    await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'GENERIC_TRUTH_VERIFIED', resourceType: 'truth_record', resourceId: truthId, userId, correlationId: observation.id, changeSummary: `Verified ${existing.factKey} through the generic reality pipeline`, source: 'api', result: 'success' });
    return this.truthResponse(userId, truthId);
  }

  async rejectCandidate(userId: string, candidateId: string) {
    const candidate = await this.getCandidate(userId, candidateId);
    if (candidate.status !== 'PENDING') throw new ConflictException('Candidate has already been decided');
    const now = new Date();
    await this.db.update(candidateFacts).set({ status: 'REJECTED', decidedAt: now }).where(and(eq(candidateFacts.id, candidateId), eq(candidateFacts.userId, userId), eq(candidateFacts.status, 'PENDING')));
    return { id: candidateId, status: 'REJECTED', decidedAt: now.toISOString() };
  }

  async truthResponse(userId: string, truthId: string) {
    const row = (await this.db.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecords).innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id)).where(and(eq(truthRecords.id, truthId), eq(truthRecords.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Truth record not found');
    const provenance = await this.db.select().from(truthProvenance).where(eq(truthProvenance.truthRecordVersionId, row.version.id));
    return { id: row.record.id, resourceKey: row.record.resourceKey, status: row.record.status, sourceReceiptId: row.record.sourceReceiptId, verifiedBy: row.record.verifiedBy, verifiedAt: row.record.verifiedAt.toISOString(), currentVersionId: row.record.currentVersionId, currentVersion: { versionNumber: row.version.versionNumber, value: row.version.valueJson, valueHash: row.version.valueHash, evidenceHash: row.version.evidenceHash }, provenance: provenance.map((item) => ({ providerKey: item.providerKey, sourceMode: item.sourceMode, evidenceHash: item.evidenceHash, observedAt: item.observedAt.toISOString() })) };
  }

  private async getCandidate(userId: string, id: string) {
    const row = (await this.db.select().from(candidateFacts).where(and(eq(candidateFacts.id, id), eq(candidateFacts.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Candidate fact not found'); return row;
  }
  private candidateResponse(row: typeof candidateFacts.$inferSelect) { return { id: row.id, observationId: row.observationId, resourceType: row.resourceType, resourceKey: row.resourceKey, subjectKey: row.subjectKey, factKey: row.factKey, value: row.valueJson, confidence: row.confidence / 100, status: row.status, truthRecordId: row.truthRecordId, freshnessPolicyKey: row.freshnessPolicyKey, conflictPolicyKey: row.conflictPolicyKey }; }

  private async syncRegistry() {
    for (const item of REALITY_ADAPTER_REGISTRY) {
      const hash = catalogHash(item); const old = (await this.db.select({ hash: realityAdapterDefinitions.definitionHash }).from(realityAdapterDefinitions).where(and(eq(realityAdapterDefinitions.adapterKey, item.key), eq(realityAdapterDefinitions.revision, item.revision))).limit(1))[0];
      if (old) { if (old.hash !== hash) throw new Error(`Reality adapter revision is immutable: ${item.key}@${item.revision}`); continue; }
      await this.db.insert(realityAdapterDefinitions).values({ id: newId(), adapterKey: item.key, adapterKind: item.kind, revision: item.revision, definitionHash: hash, status: item.status, definitionJson: item, createdAt: new Date() });
    }
    for (const item of REALITY_POLICY_REGISTRY) {
      const hash = catalogHash(item); const old = (await this.db.select({ hash: realityPolicyDefinitions.definitionHash }).from(realityPolicyDefinitions).where(and(eq(realityPolicyDefinitions.policyKey, item.key), eq(realityPolicyDefinitions.revision, item.revision))).limit(1))[0];
      if (old) { if (old.hash !== hash) throw new Error(`Reality policy revision is immutable: ${item.key}@${item.revision}`); continue; }
      await this.db.insert(realityPolicyDefinitions).values({ id: newId(), policyKey: item.key, policyKind: item.kind, revision: item.revision, definitionHash: hash, status: 'ACTIVE', definitionJson: item as unknown as Record<string, unknown>, createdAt: new Date() });
    }
  }
}

function validDate(value: string, field: string) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} must be ISO date`); return date; }
function isDuplicate(error: unknown) { let current = error; for (let i = 0; i < 5 && current && typeof current === 'object'; i += 1) { const candidate = current as { code?: string; cause?: unknown }; if (candidate.code === 'ER_DUP_ENTRY') return true; current = candidate.cause; } return false; }
function isDeadlock(error: unknown) { let current = error; for (let i = 0; i < 5 && current && typeof current === 'object'; i += 1) { const candidate = current as { code?: string; cause?: unknown }; if (candidate.code === 'ER_LOCK_DEADLOCK') return true; current = candidate.cause; } return false; }
