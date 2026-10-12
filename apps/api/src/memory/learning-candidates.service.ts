import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { learningCandidates, verificationEvidence } from '@lazy-armor/database';
import { catalogHash, LEARNING_LIMITATIONS, learningSourceSchema, learningSummary, type LearningCandidate } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gt, lt, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../common/cursor-pagination';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from './memory.service';
import { readLearningSource, type LearningTransaction } from './learning-source';
import type { ConfirmLearningCandidateDto } from './dto';

type Row = typeof learningCandidates.$inferSelect;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Bounded evidence suggestions, separate from user-message extraction and permanent Memory. */
@Injectable()
export class LearningCandidatesService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly memories: MemoryService, private readonly audit: AuditService) {}
  async refresh(userId: string) {
    return this.db.transaction(async tx => {
      const settings = await this.memories.lockSettings(tx, userId);
      if (!settings.enabled) throw new ConflictException('MEMORY_USAGE_DISABLED');
      await tx.update(learningCandidates).set({ status: 'EXPIRED', title: null, content: null, sourceJson: {}, version: 2, updatedAt: new Date() })
        .where(and(eq(learningCandidates.userId, userId), eq(learningCandidates.status, 'PENDING'), lt(learningCandidates.expiresAt, new Date())));
      const evidence = await tx.select().from(verificationEvidence).where(and(eq(verificationEvidence.userId, userId),
        gt(verificationEvidence.verifiedAt, new Date(Date.now() - MAX_AGE_MS)))).orderBy(desc(verificationEvidence.verifiedAt), desc(verificationEvidence.id)).limit(50);
      let created = 0;
      for (const item of evidence) {
        const prior = (await tx.select().from(learningCandidates).where(and(eq(learningCandidates.userId, userId), eq(learningCandidates.evidenceId, item.id))))[0];
        if (prior) continue;
        const source = await readLearningSource(tx, userId, item.id, true);
        if (!source) continue;
        const id = newId(), now = new Date(), title = '一次已核验操作的结果', content = learningSummary(source);
        await tx.insert(learningCandidates).values({ id, userId, evidenceId: item.id, settingsVersion: settings.version,
          sourceJson: source, sourceHash: catalogHash(source), proposalHash: catalogHash({ title, content }), title, content,
          status: 'PENDING', version: 1, expiresAt: new Date(Date.parse(source.verifiedAt) + MAX_AGE_MS), createdAt: now, updatedAt: now });
        await this.record(tx, userId, id, 'LEARNING_CANDIDATE_PROPOSED', { evidenceId: item.id, sourceHash: catalogHash(source), sampleCount: 1 });
        created++;
      }
      return { created, scanned: evidence.length };
    });
  }
  async list(userId: string, input: CursorPageDto) {
    const cursor = decodeCursor(input.cursor);
    const rows = await this.db.select().from(learningCandidates).where(and(eq(learningCandidates.userId, userId),
      cursor ? or(lt(learningCandidates.createdAt, cursor.createdAt), and(eq(learningCandidates.createdAt, cursor.createdAt), lt(learningCandidates.id, cursor.id))) : undefined))
      .orderBy(desc(learningCandidates.createdAt), desc(learningCandidates.id)).limit(input.limit + 1);
    const page = pageResult(rows, input.limit);
    return { items: await Promise.all(page.items.map(row => this.project(userId, row))), nextCursor: page.nextCursor };
  }
  async get(userId: string, id: string) { return this.project(userId, await this.owned(this.db, userId, id)); }
  async confirm(userId: string, id: string, input: ConfirmLearningCandidateDto) {
    if (!input.confirmed) throw new BadRequestException('MEMORY_EXPLICIT_CONFIRMATION_REQUIRED');
    const feedback = input.feedback?.trim() ?? '';
    const confirmationHash = catalogHash({ version: input.version, confirmed: true, feedback });
    return this.db.transaction(async tx => {
      const settings = await this.memories.lockSettings(tx, userId), row = await this.owned(tx, userId, id, true);
      if (row.status === 'CONFIRMED') {
        if (input.version !== 1 || row.confirmationHash !== confirmationHash) throw new ConflictException('LEARNING_CONFIRMATION_CHANGED');
        return { memoryId: row.memoryId!, confirmedMemoryVersion: row.confirmedMemoryVersion!, candidateVersion: row.version };
      }
      if (row.status !== 'PENDING' || row.version !== input.version || row.expiresAt <= new Date() || !settings.enabled || row.settingsVersion !== settings.version)
        throw new ConflictException('LEARNING_CANDIDATE_UNAVAILABLE');
      const source = await readLearningSource(tx, userId, row.evidenceId, true);
      if (!source || catalogHash(source) !== row.sourceHash || catalogHash(row.sourceJson) !== row.sourceHash ||
        !row.title || !row.content || learningSummary(source) !== row.content || catalogHash({ title: row.title, content: row.content }) !== row.proposalHash)
        throw new ConflictException('LEARNING_SOURCE_CHANGED');
      const memory = await this.memories.saveConfirmed(tx, userId, { type: 'HISTORY', title: row.title,
        content: row.content + (feedback ? `\n本人反馈（个人判断，未经结果验证）：${feedback}` : ''),
        confirmed: true, requestId: `learning-candidate:${id}`, expiresAt: row.expiresAt.toISOString() },
        { kind: 'VERIFIED_OUTCOME', candidateId: row.id, evidenceId: row.evidenceId });
      await tx.update(learningCandidates).set({ status: 'CONFIRMED', version: 2, title: null, content: null, confirmationHash,
        memoryId: memory.id, confirmedMemoryVersion: memory.version, updatedAt: new Date() }).where(eq(learningCandidates.id, id));
      await this.record(tx, userId, id, 'LEARNING_CANDIDATE_CONFIRMED', { memoryId: memory.id, memoryVersion: memory.version, evidenceId: row.evidenceId });
      return { memoryId: memory.id, confirmedMemoryVersion: memory.version, candidateVersion: 2 };
    });
  }
  async dismiss(userId: string, id: string, version: number) {
    return this.db.transaction(async tx => {
      await this.memories.lockSettings(tx, userId);
      const row = await this.owned(tx, userId, id, true);
      if (row.status === 'DISMISSED' && version === 1) return { dismissed: true };
      if (row.status !== 'PENDING' || version !== row.version) throw new ConflictException('LEARNING_CANDIDATE_UNAVAILABLE');
      await tx.update(learningCandidates).set({ status: 'DISMISSED', version: 2, title: null, content: null, sourceJson: {}, updatedAt: new Date() }).where(eq(learningCandidates.id, id));
      await this.record(tx, userId, id, 'LEARNING_CANDIDATE_DISMISSED', {});
      return { dismissed: true };
    });
  }
  private async owned(tx: LearningTransaction, userId: string, id: string, lock = false) {
    const query = tx.select().from(learningCandidates).where(and(eq(learningCandidates.id, id), eq(learningCandidates.userId, userId)));
    const row = (await (lock ? query.for('update') : query))[0];
    if (!row) throw new NotFoundException('Learning candidate not found');
    return row;
  }
  private async project(userId: string, row: Row): Promise<LearningCandidate> {
    let status = row.status as LearningCandidate['status'];
    const source = learningSourceSchema.safeParse(row.sourceJson), settings = await this.memories.settings(userId);
    if (status === 'PENDING') {
      if (row.expiresAt <= new Date()) status = 'EXPIRED';
      else if (!settings.enabled || row.settingsVersion !== settings.version || !source.success || catalogHash(source.data) !== row.sourceHash) status = 'UNAVAILABLE';
      else {
        const current = await readLearningSource(this.db, userId, row.evidenceId);
        if (!current || catalogHash(current) !== row.sourceHash || !row.title || !row.content || learningSummary(current) !== row.content ||
          catalogHash({ title: row.title, content: row.content }) !== row.proposalHash) status = 'UNAVAILABLE';
      }
    }
    const visible = status === 'PENDING';
    return { id: row.id, version: row.version, status, title: visible ? row.title : null, content: visible ? row.content : null,
      source: visible && source.success ? source.data : null, sampleCount: 1, limitations: LEARNING_LIMITATIONS,
      createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), memoryId: row.memoryId, confirmedMemoryVersion: row.confirmedMemoryVersion };
  }
  private record(tx: LearningTransaction, userId: string, id: string, action: string, after: Record<string, unknown>) {
    return this.audit.append({ actorType: 'user', actorUserId: userId, userId, action, resourceType: 'learning_candidate',
      resourceId: id, after, source: 'api', result: 'success' }, tx);
  }
}
