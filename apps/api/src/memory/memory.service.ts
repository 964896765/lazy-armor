import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { consumerConversations, consumerMessages, learningCandidates, memoryCandidates, memoryRelations, personalMemories, personalMemorySettings } from '@lazy-armor/database';
import { catalogHash, rankPersonalMemories, type MemoryContextSnapshot, type MemorySettings, type PersonalMemory, type MemoryReference } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, inArray, lt, or, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../common/cursor-pagination';
import { AuditService } from '../audit/audit.service';
import type { CreateMemoryDto, EditMemoryDto, MemorySettingsDto } from './dto';
import { learningMemorySourceCurrent } from './learning-source';
import { reportDecisionSourceCurrent } from './report-decision-source';

type Transaction = Pick<InjectedDatabase, 'select' | 'insert' | 'update'>;

@Injectable()
export class MemoryService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async settings(userId: string): Promise<MemorySettings> {
    const row = (await this.db.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)))[0];
    return { enabled: row?.enabled ?? false, version: row?.version ?? 0 };
  }
  async lockSettings(tx: Transaction, userId: string) {
    const now = new Date();
    await tx.insert(personalMemorySettings).values({ userId, enabled: false, version: 0, createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { userId } });
    return (await tx.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)).for('update'))[0]!;
  }
  async changeSettings(userId: string, input: MemorySettingsDto) {
    return this.db.transaction(async tx => {
      const current = await this.lockSettings(tx, userId);
      if (current.version !== input.version) throw new ConflictException('MEMORY_SETTINGS_VERSION_CHANGED');
      if (current.enabled === input.enabled) return { enabled: current.enabled, version: current.version };
      const version = current.version + 1;
      await tx.update(personalMemorySettings).set({ enabled: input.enabled, version, updatedAt: new Date() }).where(eq(personalMemorySettings.userId, userId));
      if (!input.enabled) await tx.update(memoryCandidates).set({ status: 'UNAVAILABLE', title: null, quote: null, version: 2, updatedAt: new Date() })
        .where(and(eq(memoryCandidates.userId, userId), eq(memoryCandidates.status, 'PENDING')));
      if (!input.enabled) await tx.update(learningCandidates).set({ status: 'UNAVAILABLE', title: null, content: null, sourceJson: {}, version: 2, updatedAt: new Date() })
        .where(and(eq(learningCandidates.userId, userId), eq(learningCandidates.status, 'PENDING')));
      await this.auditChange(tx, userId, userId, 'MEMORY_USAGE_CHANGED', { enabled: input.enabled, version });
      return { enabled: input.enabled, version };
    });
  }
  async list(userId: string, query: CursorPageDto) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'),
      cursor ? or(lt(personalMemories.createdAt, cursor.createdAt), and(eq(personalMemories.createdAt, cursor.createdAt), lt(personalMemories.id, cursor.id))) : undefined))
      .orderBy(desc(personalMemories.createdAt), desc(personalMemories.id)).limit(query.limit + 1);
    const page = pageResult(rows, query.limit);
    return { items: page.items.map(toMemory), nextCursor: page.nextCursor };
  }
  async get(userId: string, id: string) {
    const row = (await this.db.select().from(personalMemories).where(and(eq(personalMemories.id, id), eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'))))[0];
    if (!row) throw new NotFoundException('Memory not found');
    return toMemory(row);
  }
  async create(userId: string, input: CreateMemoryDto) {
    return this.db.transaction(tx => this.saveConfirmed(tx, userId, input));
  }
  /** Internal server-owned entry for reviewed candidates, using the same Memory store. */
  async saveConfirmed(tx: Transaction, userId: string, input: CreateMemoryDto, sourceRef: PersonalMemory['sourceRef'] = null) {
    if (input.requestId.startsWith('memory-candidate:') && (!sourceRef || 'kind' in sourceRef || input.requestId !== `memory-candidate:${sourceRef.candidateId}`)) throw new BadRequestException('MEMORY_SERVER_REQUEST_ID_REQUIRED');
    if (input.requestId.startsWith('learning-candidate:') && (!sourceRef || !('kind' in sourceRef) || sourceRef.kind !== 'VERIFIED_OUTCOME' || input.requestId !== `learning-candidate:${sourceRef.candidateId}`)) throw new BadRequestException('MEMORY_SERVER_REQUEST_ID_REQUIRED');
    if (input.requestId.startsWith('report-decision:') && (!sourceRef || !('kind' in sourceRef) || sourceRef.kind !== 'REPORT_DECISION')) throw new BadRequestException('MEMORY_SERVER_REQUEST_ID_REQUIRED');
    const content = normalizeContent(input);
      const settings = await this.lockSettings(tx, userId);
      const prior = (await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.requestId, input.requestId))))[0];
      if (prior) {
        if (prior.status !== 'ACTIVE' || prior.type !== input.type || prior.title !== content.title || prior.content !== content.content || catalogHash(prior.sourceRefJson ?? null) !== catalogHash(sourceRef) || (prior.expiresAt?.getTime() ?? null) !== (content.expiresAt?.getTime() ?? null)) throw new ConflictException('MEMORY_REQUEST_IDENTITY_CHANGED');
        return toMemory(prior);
      }
      if (!settings.enabled) throw new ConflictException('MEMORY_USAGE_DISABLED');
      const now = new Date(), id = newId();
      const value = { id, userId, requestId: input.requestId, type: input.type, ...content, sourceKind: sourceRef ? ('kind' in sourceRef ? sourceRef.kind === 'REPORT_DECISION' ? 'REPORT_DECISION_CONFIRMED' : 'LEARNING_CONFIRMED' : 'CONVERSATION_CONFIRMED') : 'USER_INPUT',
        sourceRefJson: sourceRef, status: 'ACTIVE', version: 1, confirmedAt: now, createdAt: now, updatedAt: now };
      await tx.insert(personalMemories).values(value);
      await this.auditChange(tx, userId, id, 'MEMORY_SAVED', { type: input.type, version: 1, sourceKind: value.sourceKind, sourceRef });
      return toMemory(value);
  }
  async reference(userId: string, id: string, requestedVersion: number): Promise<MemoryReference> {
    return this.db.transaction(async tx => {
      const row = (await tx.select().from(personalMemories).where(and(eq(personalMemories.id, id), eq(personalMemories.userId, userId))))[0];
      if (!row) throw new NotFoundException('Memory not found');
      const settings = (await tx.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)))[0];
      let state: MemoryReference['state'] = row.status === 'DELETED' ? 'DELETED' : row.version !== requestedVersion ? 'CHANGED'
        : row.expiresAt && row.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : !settings?.enabled ? 'DISABLED' : 'CURRENT';
      const source: MemoryReference['source'] = { kind: row.sourceKind as MemoryReference['source']['kind'], available: row.sourceKind === 'USER_INPUT' && row.status === 'ACTIVE' };
      if (row.sourceRefJson && !('kind' in row.sourceRefJson) && row.status === 'ACTIVE') {
        const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, row.sourceRefJson.conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))))[0];
        const message = conversation && (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, row.sourceRefJson.messageId), eq(consumerMessages.conversationId, conversation.id), eq(consumerMessages.role, 'user'))))[0];
        const proof = message && (await tx.select().from(memoryCandidates).where(and(eq(memoryCandidates.id, row.sourceRefJson.candidateId), eq(memoryCandidates.userId, userId), eq(memoryCandidates.memoryId, id), eq(memoryCandidates.status, 'CONFIRMED'))))[0];
        if (message && proof && catalogHash(message.content) === proof.sourceContentHash) Object.assign(source, { available: true, conversationId: conversation!.id, messageId: message.id, content: message.content.slice(0, 1000) });
      }
      if (row.sourceKind === 'LEARNING_CONFIRMED' && row.status === 'ACTIVE') {
        source.available = await learningMemorySourceCurrent(tx, userId, row.sourceRefJson, row.id);
        if (!source.available && state === 'CURRENT') state = 'SOURCE_UNAVAILABLE';
        if (source.available && row.sourceRefJson && 'kind' in row.sourceRefJson && row.sourceRefJson.kind === 'VERIFIED_OUTCOME') {
          const candidate = (await tx.select().from(learningCandidates).where(eq(learningCandidates.id, row.sourceRefJson.candidateId)))[0]!;
          Object.assign(source, { candidateId: candidate.id, evidenceId: candidate.evidenceId,
            executionId: candidate.sourceJson.executionId, content: '来自原始操作的验证证据；仅证明一次历史结果，个人反馈未经结果验证。' });
        }
      }
      if (row.sourceKind === 'REPORT_DECISION_CONFIRMED' && row.status === 'ACTIVE') {
        source.available = await reportDecisionSourceCurrent(tx, userId, row.sourceRefJson);
        if (!source.available && state === 'CURRENT') state = 'SOURCE_UNAVAILABLE';
        if (source.available && row.sourceRefJson && 'kind' in row.sourceRefJson && row.sourceRefJson.kind === 'REPORT_DECISION') {
          Object.assign(source, { conversationId: row.sourceRefJson.conversationId, messageId: row.sourceRefJson.messageId,
            reportRevision: row.sourceRefJson.reportRevision, content: '本人针对该版本报告明确保存的决定、理由和预期。个人判断不是市场事实或经营结果验证。' });
        }
      }
      return { id, requestedVersion, state, memory: row.status === 'ACTIVE' ? toMemory(row) : null, source };
    });
  }
  async edit(userId: string, id: string, input: EditMemoryDto) {
    return this.db.transaction(async tx => {
      await this.lockSettings(tx, userId);
      const row = (await tx.select().from(personalMemories).where(and(eq(personalMemories.id, id), eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'))).for('update'))[0];
      if (!row) throw new NotFoundException('Memory not found');
      if (row.version !== input.version) throw new ConflictException('MEMORY_VERSION_CHANGED');
      const expiresAt = input.expiresAt === undefined ? row.expiresAt?.toISOString() ?? null : input.expiresAt;
      const content = normalizeContent({ ...input, expiresAt }, Boolean(row.expiresAt && expiresAt && row.expiresAt.getTime() === Date.parse(expiresAt)));
      // A personal rewrite is user input, never an amended verified outcome.
      const patch = { ...content, type: input.type, version: row.version + 1, confirmedAt: new Date(), updatedAt: new Date(),
        ...(['LEARNING_CONFIRMED', 'REPORT_DECISION_CONFIRMED'].includes(row.sourceKind) ? { sourceKind: 'USER_INPUT', sourceRefJson: null } : {}) };
      await tx.update(personalMemories).set(patch).where(eq(personalMemories.id, id));
      await this.invalidateRelations(tx, userId, id);
      await this.auditChange(tx, userId, id, 'MEMORY_EDITED', { type: input.type, version: patch.version });
      return toMemory({ ...row, ...patch });
    });
  }
  async remove(userId: string, id: string, version: number) {
    return this.db.transaction(async tx => {
      await this.lockSettings(tx, userId);
      const row = (await tx.select().from(personalMemories).where(and(eq(personalMemories.id, id), eq(personalMemories.userId, userId))).for('update'))[0];
      if (!row) throw new NotFoundException('Memory not found');
      if (row.status === 'DELETED' && row.version === version + 1) return { deleted: true };
      if (row.status !== 'ACTIVE' || row.version !== version) throw new ConflictException('MEMORY_VERSION_CHANGED');
      // Delete personal content, retain only an idempotency/ownership tombstone. Audit never stores text.
      await tx.update(personalMemories).set({ title: null, content: null, expiresAt: null, status: 'DELETED', version: version + 1, updatedAt: new Date() }).where(eq(personalMemories.id, id));
      await tx.update(learningCandidates).set({ sourceJson: {}, title: null, content: null, updatedAt: new Date() })
        .where(and(eq(learningCandidates.userId, userId), eq(learningCandidates.memoryId, id)));
      await this.invalidateRelations(tx, userId, id);
      await this.auditChange(tx, userId, id, 'MEMORY_DELETED', { version: version + 1 });
      return { deleted: true };
    });
  }
  async context(userId: string, intent: string): Promise<MemoryContextSnapshot> {
    return this.db.transaction(async tx => {
      const settings = (await tx.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)))[0];
      if (!settings?.enabled) return { enabled: false, settingsVersion: settings?.version ?? 0, items: [] };
      const rows = await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'),
        or(isNull(personalMemories.expiresAt), gt(personalMemories.expiresAt, new Date())))).orderBy(desc(personalMemories.confirmedAt), desc(personalMemories.id)).limit(100);
      const owned = rows.map(toMemory), checked = new Map<string, boolean>();
      const usable = async (id: string) => {
        if (!checked.has(id)) {
          const row = rows.find(value => value.id === id);
          checked.set(id, Boolean(row && await this.sourceCurrent(tx, userId, row)));
        }
        return checked.get(id)!;
      };
      const items: PersonalMemory[] = [];
      // Validate only relevant seeds and actually included neighbours; unrelated histories cause no authority I/O.
      for (const memory of rankPersonalMemories(intent, owned, Date.now(), 100)) {
        if (await usable(memory.id)) items.push(memory);
        if (items.length === 6) break;
      }
      const seedIds = items.map(item => item.id);
      const edges = seedIds.length ? await tx.select().from(memoryRelations).where(and(eq(memoryRelations.userId, userId), eq(memoryRelations.status, 'ACTIVE'),
        or(inArray(memoryRelations.fromId, seedIds), inArray(memoryRelations.toId, seedIds)))).orderBy(desc(memoryRelations.createdAt), desc(memoryRelations.id)).limit(40) : [];
      const validEdges = edges.filter(edge => owned.some(item => item.id === edge.fromId && item.version === edge.fromVersion) && owned.some(item => item.id === edge.toId && item.version === edge.toVersion));
      for (const edge of validEdges) {
        for (const id of [edge.fromId, edge.toId]) {
          if (items.length < 8 && !items.some(item => item.id === id) && await usable(id)) items.push(owned.find(item => item.id === id)!);
        }
      }
      const relations = validEdges.filter(edge => items.some(item => item.id === edge.fromId) && items.some(item => item.id === edge.toId)).map(edge => ({
        id: edge.id, version: edge.version, fromId: edge.fromId, fromVersion: edge.fromVersion, toId: edge.toId, toVersion: edge.toVersion,
        relation: edge.relation as import('@lazy-armor/plan-schema').MemoryRelationType, weight: edge.weight,
        fromTitle: owned.find(item => item.id === edge.fromId)!.title, toTitle: owned.find(item => item.id === edge.toId)!.title, createdAt: edge.createdAt.toISOString(),
      }));
      return { enabled: true, settingsVersion: settings.version, items, relations };
    });
  }
  async contextCurrent(userId: string, snapshot: MemoryContextSnapshot) {
    if (!snapshot.enabled) return snapshot.items.length === 0 && !(snapshot.relations?.length);
    return this.db.transaction(async tx => {
      const settings = (await tx.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)))[0];
      if (!settings?.enabled || settings.version !== snapshot.settingsVersion) return false;
      if (!snapshot.items.length) return !(snapshot.relations?.length);
      const rows = await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'), inArray(personalMemories.id, snapshot.items.map(item => item.id))));
      if (!snapshot.items.every(ref => rows.some(row => row.id === ref.id && row.version === ref.version && (!row.expiresAt || row.expiresAt.getTime() > Date.now())))) return false;
      for (const row of rows) if (!await this.sourceCurrent(tx, userId, row)) return false;
      return this.relationsCurrent(tx, userId, snapshot.relations ?? []);
    });
  }
  /** Consumer's final publication fence; settings and referenced versions stay locked until message commit. */
  async refsCurrent(tx: Transaction, userId: string, refs: Array<{ id: string; version: number; settingsVersion: number }>, relationRefs: Array<{ id: string; version: number }> = []) {
    if (!refs.length) return relationRefs.length === 0;
    const settings = await this.lockSettings(tx, userId);
    if (!settings.enabled || refs.some(ref => ref.settingsVersion !== settings.version)) return false;
    const rows = await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), inArray(personalMemories.id, refs.map(ref => ref.id)))).for('update');
    if (!refs.every(ref => rows.some(row => row.id === ref.id && row.status === 'ACTIVE' && row.version === ref.version && (!row.expiresAt || row.expiresAt.getTime() > Date.now())))) return false;
    for (const row of rows) if (!await this.sourceCurrent(tx, userId, row, true)) return false;
    return this.relationsCurrent(tx, userId, relationRefs, true);
  }
  async sourceCurrent(tx: Transaction, userId: string, row: typeof personalMemories.$inferSelect, lock = false) {
    if (row.sourceKind === 'LEARNING_CONFIRMED') return learningMemorySourceCurrent(tx, userId, row.sourceRefJson, row.id, lock);
    if (row.sourceKind === 'REPORT_DECISION_CONFIRMED') return reportDecisionSourceCurrent(tx, userId, row.sourceRefJson, lock);
    return true;
  }
  private async relationsCurrent(tx: Transaction, userId: string, refs: Array<{ id: string; version: number }>, lock = false) {
    if (!refs.length) return true;
    const query = tx.select().from(memoryRelations).where(and(eq(memoryRelations.userId, userId), inArray(memoryRelations.id, refs.map(ref => ref.id))));
    const rows = await (lock ? query.for('update') : query);
    return refs.every(ref => rows.some(row => row.id === ref.id && row.version === ref.version && row.status === 'ACTIVE'));
  }
  private invalidateRelations(tx: Transaction, userId: string, id: string) {
    return tx.update(memoryRelations).set({ status: 'REVOKED', activeIdentity: null, version: sql`${memoryRelations.version} + 1`, updatedAt: new Date() })
      .where(and(eq(memoryRelations.userId, userId), eq(memoryRelations.status, 'ACTIVE'), or(eq(memoryRelations.fromId, id), eq(memoryRelations.toId, id))));
  }
  private auditChange(tx: Transaction, userId: string, id: string, action: string, after: Record<string, unknown>) {
    return this.audit.append({ actorType: 'user', actorUserId: userId, userId, action, resourceType: 'personal_memory', resourceId: id,
      changeSummary: action, after, source: 'api', result: 'success' }, tx);
  }
}
function normalizeContent(input: CreateMemoryDto | EditMemoryDto, preserveExpiry = false) {
  if (!input.confirmed) throw new BadRequestException('MEMORY_EXPLICIT_CONFIRMATION_REQUIRED');
  const title = input.title.trim(), content = input.content.trim();
  if (!title || !content) throw new BadRequestException('MEMORY_CONTENT_REQUIRED');
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || (!preserveExpiry && expiresAt.getTime() <= Date.now()))) throw new BadRequestException('MEMORY_EXPIRY_MUST_BE_FUTURE');
  return { title, content, expiresAt };
}
function toMemory(row: typeof personalMemories.$inferSelect): PersonalMemory {
  return { id: row.id, type: row.type as PersonalMemory['type'], title: row.title!, content: row.content!, sourceKind: row.sourceKind as PersonalMemory['sourceKind'],
    sourceRef: row.sourceRefJson ?? null, version: row.version, confirmedAt: row.confirmedAt.toISOString(), createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null };
}
