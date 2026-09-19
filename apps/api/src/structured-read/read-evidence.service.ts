import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { readEvidence } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { RealityExecutor } from '../reality-pipeline/reality-pipeline.service';
import type { ReadEvidenceStatus, StructuredReadEvidence, StructuredReadMethod } from '@lazy-armor/plan-schema';

/**
 * R6 Read Evidence. One record per Structured Read request; it closes the R2
 * evidence-status debt with a full status machine:
 *
 * CAPTURED -> STRUCTURED_READ | VISION_FALLBACK -> NORMALIZED -> CANDIDATE_CREATED
 *          -> TRUTH_VERIFIED | NEEDS_CONFIRMATION | BLOCKED | REJECTED
 *
 * Only hashes and identities are stored; raw document text, full table cells,
 * screenshots and Vision prompts are never persisted here. Audit records who /
 * from where / which resource / which capability / the outcome, without copying
 * the original content.
 */
const TRANSITIONS: Readonly<Record<ReadEvidenceStatus, ReadonlySet<ReadEvidenceStatus>>> = {
  CAPTURED: new Set(['STRUCTURED_READ', 'VISION_FALLBACK', 'BLOCKED']),
  STRUCTURED_READ: new Set(['NORMALIZED', 'BLOCKED', 'REJECTED']),
  VISION_FALLBACK: new Set(['NORMALIZED', 'BLOCKED', 'REJECTED']),
  NORMALIZED: new Set(['CANDIDATE_CREATED', 'NEEDS_CONFIRMATION', 'BLOCKED', 'REJECTED']),
  CANDIDATE_CREATED: new Set(['TRUTH_VERIFIED', 'NEEDS_CONFIRMATION', 'BLOCKED', 'REJECTED']),
  TRUTH_VERIFIED: new Set([]),
  NEEDS_CONFIRMATION: new Set(['TRUTH_VERIFIED', 'REJECTED']),
  BLOCKED: new Set([]),
  REJECTED: new Set([]),
};

export interface ReadEvidenceRecord {
  id: string;
  requestId: string;
  sourceType: string;
  resourceType: string;
  resourceId: string | null;
  readMethod: string;
  parserId: string;
  contentHash: string;
  evidenceHash: string;
  sourceIdentity: string | null;
  resourceIdentity: string | null;
  status: ReadEvidenceStatus;
  confidence: number;
  observationId: string | null;
  candidateIds: string[];
  truthRecordIds: string[];
  blockedReason: string | null;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ReadEvidenceService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async create(userId: string, evidence: StructuredReadEvidence, readMethod: StructuredReadMethod, executor?: RealityExecutor): Promise<ReadEvidenceRecord> {
    const db = executor ?? this.db;
    const now = new Date();
    const id = newId();
    await db.insert(readEvidence).values({
      id, userId, requestId: evidence.requestId, sourceType: evidence.sourceType, resourceType: evidence.resourceType,
      resourceId: evidence.resourceId || null, readMethod, parserId: evidence.parserId,
      contentHash: evidence.contentHash, evidenceHash: evidence.evidenceHash,
      sourceIdentity: evidence.sourceIdentity || null, resourceIdentity: evidence.resourceIdentity || null,
      status: 'CAPTURED', confidence: Math.round(evidence.confidence * 100),
      observationId: null, candidateIdsJson: [], truthRecordIdsJson: [], blockedReason: null,
      warningsJson: evidence.warnings.slice(0, 20), createdAt: now, updatedAt: now,
    });
    await this.audit.append({
      actorType: 'system', actorUserId: null, action: 'STRUCTURED_READ_CAPTURED', resourceType: 'read_evidence', resourceId: id,
      userId, correlationId: evidence.requestId,
      changeSummary: `Captured ${evidence.sourceType} structured read via ${readMethod} (${evidence.resourceType})`,
      source: 'api', result: 'success',
    }, executor);
    return this.toResponse((await db.select().from(readEvidence).where(eq(readEvidence.id, id)).limit(1))[0]!);
  }

  async advance(
    userId: string,
    id: string,
    status: ReadEvidenceStatus,
    options: { observationId?: string | null; candidateIds?: string[]; truthRecordIds?: string[]; blockedReason?: string | null } = {},
    executor?: RealityExecutor,
  ): Promise<ReadEvidenceRecord> {
    const db = executor ?? this.db;
    const row = await this.getRow(userId, id, executor);
    const current = row.status as ReadEvidenceStatus;
    if (!TRANSITIONS[current].has(status)) throw new ConflictException(`Invalid read evidence transition ${current} -> ${status}`);
    await db.update(readEvidence).set({
      status,
      ...(options.observationId !== undefined ? { observationId: options.observationId } : {}),
      ...(options.candidateIds !== undefined ? { candidateIdsJson: options.candidateIds } : {}),
      ...(options.truthRecordIds !== undefined ? { truthRecordIdsJson: options.truthRecordIds } : {}),
      ...(options.blockedReason !== undefined ? { blockedReason: options.blockedReason } : {}),
      updatedAt: new Date(),
    }).where(and(eq(readEvidence.id, id), eq(readEvidence.userId, userId)));
    const updated = await this.getRow(userId, id, executor);
    await this.audit.append({
      actorType: 'system', actorUserId: null, action: 'STRUCTURED_READ_EVIDENCE_ADVANCED', resourceType: 'read_evidence', resourceId: id,
      userId, correlationId: updated.requestId, changeSummary: `${current} -> ${status}`,
      ...(options.blockedReason ? { reasonCode: options.blockedReason } : {}), source: 'api',
      result: status === 'BLOCKED' || status === 'REJECTED' ? 'blocked' : 'success',
    }, executor);
    return this.toResponse(updated);
  }

  async get(userId: string, id: string): Promise<ReadEvidenceRecord> {
    return this.toResponse(await this.getRow(userId, id));
  }

  async list(userId: string): Promise<ReadEvidenceRecord[]> {
    const rows = await this.db.select().from(readEvidence).where(eq(readEvidence.userId, userId)).orderBy(desc(readEvidence.createdAt));
    return rows.map((row) => this.toResponse(row));
  }

  private async getRow(userId: string, id: string, executor?: RealityExecutor) {
    const db = executor ?? this.db;
    const row = (await db.select().from(readEvidence).where(and(eq(readEvidence.id, id), eq(readEvidence.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Read evidence not found');
    return row;
  }

  private toResponse(row: typeof readEvidence.$inferSelect): ReadEvidenceRecord {
    return {
      id: row.id,
      requestId: row.requestId,
      sourceType: row.sourceType,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      readMethod: row.readMethod,
      parserId: row.parserId,
      contentHash: row.contentHash,
      evidenceHash: row.evidenceHash,
      sourceIdentity: row.sourceIdentity,
      resourceIdentity: row.resourceIdentity,
      status: row.status as ReadEvidenceStatus,
      confidence: row.confidence / 100,
      observationId: row.observationId,
      candidateIds: row.candidateIdsJson ?? [],
      truthRecordIds: row.truthRecordIdsJson ?? [],
      blockedReason: row.blockedReason,
      warnings: row.warningsJson ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
