import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { consumerConversations, consumerMessages, memoryCandidates } from '@lazy-armor/database';
import { catalogHash, groundedMemorySuggestions, type MemoryCandidate, type MemorySuggestion } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { decodeCursor, pageResult } from '../common/cursor-pagination';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from './memory.service';
import type { ConfirmMemoryCandidateDto, ListMemoryCandidatesDto } from './dto';

type Tx = Pick<InjectedDatabase, 'select' | 'insert' | 'update'>;
@Injectable()
export class MemoryCandidatesService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly memories: MemoryService, private readonly audit: AuditService) {}

  /** Bind validated suggestions to the actual user message, never attachments or AI text. */
  async register(tx: Tx, userId: string, conversationId: string, proposalMessageId: string, requestId: string,
    bundle: { settingsVersion: number; modelId: string; suggestions: MemorySuggestion[] }) {
    const settings = await this.memories.lockSettings(tx, userId);
    if (!settings.enabled || settings.version !== bundle.settingsVersion) return;
    const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
    const proposal = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, proposalMessageId), eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.requestId, requestId), eq(consumerMessages.role, 'assistant'))))[0];
    if (!conversation || !proposal) throw new ConflictException('MEMORY_CANDIDATE_SOURCE_MISSING');
    const source = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.requestId, requestId), eq(consumerMessages.role, 'user'))))[0];
    if (!source) throw new ConflictException('MEMORY_CANDIDATE_SOURCE_MISSING');
    const suggestions = groundedMemorySuggestions(source.content, bundle.suggestions);
    for (const [index, suggestion] of suggestions.entries()) {
      const now = new Date(), id = newId();
      await tx.insert(memoryCandidates).values({ id, userId, conversationId, sourceMessageId: source.id, proposalMessageId,
        proposalOrder: index, settingsVersion: settings.version, ...suggestion, sourceContentHash: catalogHash(source.content),
        proposalHash: catalogHash(suggestion), modelId: bundle.modelId.slice(0, 120), status: 'PENDING', version: 1,
        createdAt: now, updatedAt: now });
      await this.audit.append({ actorType: 'system', userId, action: 'MEMORY_CANDIDATE_PROPOSED', resourceType: 'memory_candidate', resourceId: id,
        after: { sourceMessageId: source.id, proposalMessageId, proposalHash: catalogHash(suggestion), settingsVersion: settings.version, modelId: bundle.modelId.slice(0, 120) }, source: 'api', result: 'pending' }, tx);
    }
  }
  async list(userId: string, query: ListMemoryCandidatesDto) {
    const conversation = (await this.db.select().from(consumerConversations).where(and(eq(consumerConversations.id, query.conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))))[0];
    if (!conversation) throw new NotFoundException('Conversation not found');
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.select().from(memoryCandidates).where(and(eq(memoryCandidates.userId, userId), eq(memoryCandidates.conversationId, query.conversationId),
      cursor ? or(lt(memoryCandidates.createdAt, cursor.createdAt), and(eq(memoryCandidates.createdAt, cursor.createdAt), lt(memoryCandidates.id, cursor.id))) : undefined))
      .orderBy(desc(memoryCandidates.createdAt), desc(memoryCandidates.id)).limit(query.limit + 1);
    const page = pageResult(rows, query.limit);
    return { items: page.items.map(projectCandidate), nextCursor: page.nextCursor };
  }
  async get(userId: string, id: string) {
    const row = await this.owned(userId, id);
    await this.assertSource(this.db, userId, row);
    return projectCandidate(row);
  }
  async confirm(userId: string, id: string, input: ConfirmMemoryCandidateDto) {
    if (!input.confirmed) throw new BadRequestException('MEMORY_EXPLICIT_CONFIRMATION_REQUIRED');
    const confirmationHash = catalogHash({ type: input.type, title: input.title.trim(), content: input.content.trim(), expiresAt: input.expiresAt ?? null });
    return this.db.transaction(async tx => {
      const settings = await this.memories.lockSettings(tx, userId);
      const row = await this.owned(userId, id, tx, true);
      if (row.status === 'CONFIRMED') {
        if (input.version !== 1 || row.confirmationHash !== confirmationHash) throw new ConflictException('MEMORY_CANDIDATE_CONFIRMATION_CHANGED');
        return { memoryId: row.memoryId!, confirmedMemoryVersion: row.confirmedMemoryVersion!, candidateVersion: row.version };
      }
      if (row.status !== 'PENDING' || row.version !== input.version || !settings.enabled || settings.version !== row.settingsVersion) throw new ConflictException('MEMORY_CANDIDATE_UNAVAILABLE');
      await this.assertSource(tx, userId, row, true);
      const sourceRef = { conversationId: row.conversationId, messageId: row.sourceMessageId, candidateId: row.id, modelId: row.modelId };
      const memory = await this.memories.saveConfirmed(tx, userId, { ...input, requestId: `memory-candidate:${id}` }, sourceRef);
      await tx.update(memoryCandidates).set({ status: 'CONFIRMED', version: 2, title: null, quote: null, confirmationHash, memoryId: memory.id, confirmedMemoryVersion: memory.version, updatedAt: new Date() }).where(eq(memoryCandidates.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'MEMORY_CANDIDATE_CONFIRMED', resourceType: 'memory_candidate', resourceId: id,
        after: { memoryId: memory.id, memoryVersion: memory.version, sourceMessageId: row.sourceMessageId, proposalHash: row.proposalHash }, source: 'api', result: 'success' }, tx);
      return { memoryId: memory.id, confirmedMemoryVersion: memory.version, candidateVersion: 2 };
    });
  }
  async dismiss(userId: string, id: string, version: number) {
    return this.db.transaction(async tx => {
      await this.memories.lockSettings(tx, userId);
      const row = await this.owned(userId, id, tx, true);
      if (row.status === 'DISMISSED' && version === 1) return { dismissed: true };
      if (row.status !== 'PENDING' || row.version !== version) throw new ConflictException('MEMORY_CANDIDATE_UNAVAILABLE');
      await tx.update(memoryCandidates).set({ status: 'DISMISSED', version: 2, title: null, quote: null, updatedAt: new Date() }).where(eq(memoryCandidates.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'MEMORY_CANDIDATE_DISMISSED', resourceType: 'memory_candidate', resourceId: id, source: 'api', result: 'success' }, tx);
      return { dismissed: true };
    });
  }
  private async owned(userId: string, id: string, tx: Tx = this.db, lock = false) {
    const query = tx.select().from(memoryCandidates).where(and(eq(memoryCandidates.id, id), eq(memoryCandidates.userId, userId))).limit(1);
    const row = (await (lock ? query.for('update') : query))[0];
    if (!row) throw new NotFoundException('Memory candidate not found');
    return row;
  }
  private async assertSource(tx: Tx, userId: string, row: typeof memoryCandidates.$inferSelect, lock = false) {
    const query = tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, row.conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt)));
    const conversation = (await (lock ? query.for('update') : query))[0];
    if (!conversation) throw new NotFoundException('Memory source unavailable');
    const source = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, row.sourceMessageId), eq(consumerMessages.conversationId, conversation.id), eq(consumerMessages.role, 'user'))))[0];
    if (!source || catalogHash(source.content) !== row.sourceContentHash) throw new ConflictException('MEMORY_CANDIDATE_SOURCE_CHANGED');
    if (row.status === 'PENDING' && (!row.quote || !row.title || !source.content.includes(row.quote) ||
      catalogHash({ type: row.type, title: row.title, quote: row.quote }) !== row.proposalHash)) throw new ConflictException('MEMORY_CANDIDATE_PROPOSAL_CHANGED');
  }
}
function projectCandidate(row: typeof memoryCandidates.$inferSelect): MemoryCandidate {
  return { id: row.id, version: row.version, status: row.status as MemoryCandidate['status'], conversationId: row.conversationId,
    sourceMessageId: row.sourceMessageId, proposalMessageId: row.proposalMessageId, type: row.type as MemoryCandidate['type'],
    title: row.title, quote: row.quote, modelId: row.modelId, createdAt: row.createdAt.toISOString(), memoryId: row.memoryId, confirmedMemoryVersion: row.confirmedMemoryVersion };
}
