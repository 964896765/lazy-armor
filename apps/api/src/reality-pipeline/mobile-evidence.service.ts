import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { candidateFacts, sourceObservations, truthRecordVersions } from '@lazy-armor/database';
import { mobileCandidateKindForParser } from '@lazy-armor/plan-schema';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

export type MobileEvidenceStatus = 'normalized' | 'candidate_created' | 'truth_verified' | 'rejected';

export interface MobileEvidenceExport {
  sourceType: string;
  packageIdentity: string;
  observedAt: string;
  evidenceHash: string;
  candidateKind: string | null;
  parserId: string;
  resourceHint: string;
  status: MobileEvidenceStatus;
  truth: { id: string; version: number } | null;
}

/**
 * R2-08 sanitized evidence export. It exposes the observable trail
 * (observation → candidate → truth) without leaking raw payload, tokens or
 * credentials. Real-device evidence collection remains AWAITING_DEVICE_EVIDENCE.
 */
@Injectable()
export class MobileEvidenceService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async list(userId: string): Promise<MobileEvidenceExport[]> {
    const rows = await this.db.select({
      sourceMode: sourceObservations.sourceMode,
      providerKey: sourceObservations.providerKey,
      parserKey: sourceObservations.parserKey,
      resourceHint: sourceObservations.resourceHint,
      evidenceHash: sourceObservations.evidenceHash,
      observedAt: sourceObservations.observedAt,
      payloadJson: sourceObservations.payloadJson,
      candidateStatus: candidateFacts.status,
      truthRecordId: candidateFacts.truthRecordId,
    }).from(sourceObservations)
      .leftJoin(candidateFacts, eq(candidateFacts.observationId, sourceObservations.id))
      .where(eq(sourceObservations.userId, userId))
      .orderBy(desc(sourceObservations.observedAt));

    return Promise.all(rows.map(async (row) => {
      let truth: { id: string; version: number } | null = null;
      if (row.truthRecordId) {
        const version = (await this.db.select({ versionNumber: truthRecordVersions.versionNumber })
          .from(truthRecordVersions).where(eq(truthRecordVersions.truthRecordId, row.truthRecordId)).limit(1))[0];
        truth = { id: row.truthRecordId, version: version?.versionNumber ?? 0 };
      }
      const payload = row.payloadJson as Record<string, unknown>;
      return {
        sourceType: row.sourceMode,
        packageIdentity: typeof payload.packageName === 'string' ? payload.packageName : row.providerKey,
        observedAt: row.observedAt.toISOString(),
        evidenceHash: row.evidenceHash,
        candidateKind: mobileCandidateKindForParser(row.parserKey),
        parserId: row.parserKey,
        resourceHint: row.resourceHint,
        status: row.candidateStatus === 'VERIFIED' ? 'truth_verified'
          : row.candidateStatus === 'REJECTED' ? 'rejected'
          : row.candidateStatus === 'PENDING' ? 'candidate_created'
          : 'normalized',
        truth,
      };
    }));
  }
}
