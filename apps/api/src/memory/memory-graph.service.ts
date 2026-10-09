import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { memoryRelations, personalMemories } from '@lazy-armor/database';
import { catalogHash, type MemoryRelation } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, inArray, isNull, lt, or, gt } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../common/cursor-pagination';
import { AuditService } from '../audit/audit.service';
import { MemoryService } from './memory.service';
import type { CreateMemoryRelationDto } from './dto';

@Injectable()
export class MemoryGraphService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly memories: MemoryService, private readonly audit: AuditService) {}
  async list(userId: string, id: string, input: CursorPageDto) {
    await this.memories.get(userId, id);
    return this.db.transaction(async tx => {
      const current = (await tx.select().from(personalMemories).where(and(eq(personalMemories.id, id), eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'))))[0];
      if (!current) throw new NotFoundException('Memory not found');
      if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) return { items: [], nextCursor: null };
      const cursor = decodeCursor(input.cursor);
      const rows = await tx.select().from(memoryRelations).where(and(eq(memoryRelations.userId, userId), eq(memoryRelations.status, 'ACTIVE'),
        or(and(eq(memoryRelations.fromId, id), eq(memoryRelations.fromVersion, current.version)), and(eq(memoryRelations.toId, id), eq(memoryRelations.toVersion, current.version))),
        cursor ? or(lt(memoryRelations.createdAt, cursor.createdAt), and(eq(memoryRelations.createdAt, cursor.createdAt), lt(memoryRelations.id, cursor.id))) : undefined))
        .orderBy(desc(memoryRelations.createdAt), desc(memoryRelations.id)).limit(input.limit + 1);
      const page = pageResult(rows, input.limit);
      const ids = [...new Set(page.items.flatMap(row => [row.fromId, row.toId]))];
      const memories = ids.length ? await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'), inArray(personalMemories.id, ids), or(isNull(personalMemories.expiresAt), gt(personalMemories.expiresAt, new Date())))) : [];
      return { items: page.items.flatMap(row => {
        const from = memories.find(m => m.id === row.fromId && m.version === row.fromVersion), to = memories.find(m => m.id === row.toId && m.version === row.toVersion);
        return from && to ? [projectRelation(row, from.title!, to.title!)] : [];
      }), nextCursor: page.nextCursor };
    });
  }
  async create(userId: string, fromId: string, input: CreateMemoryRelationDto) {
    if (!input.confirmed) throw new BadRequestException('MEMORY_RELATION_CONFIRMATION_REQUIRED');
    if (fromId === input.toId) throw new BadRequestException('MEMORY_RELATION_SELF_REFERENCE');
    return this.db.transaction(async tx => {
      const settings = await this.memories.lockSettings(tx, userId);
      const prior = (await tx.select().from(memoryRelations).where(and(eq(memoryRelations.userId, userId), eq(memoryRelations.requestId, input.requestId))))[0];
      if (prior) {
        if (prior.status !== 'ACTIVE' || prior.fromId !== fromId || prior.fromVersion !== input.fromVersion || prior.toId !== input.toId || prior.toVersion !== input.toVersion || prior.relation !== input.relation) throw new ConflictException('MEMORY_RELATION_REQUEST_CHANGED');
        return { id: prior.id, version: prior.version };
      }
      if (!settings.enabled) throw new ConflictException('MEMORY_USAGE_DISABLED');
      const endpoints = await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'), inArray(personalMemories.id, [fromId, input.toId]))).for('update');
      if (endpoints.length !== 2) throw new NotFoundException('Memory endpoint not found');
      if (endpoints.some(row => row.version !== (row.id === fromId ? input.fromVersion : input.toVersion) || (row.expiresAt && row.expiresAt.getTime() <= Date.now()))) throw new ConflictException('MEMORY_VERSION_CHANGED');
      const activeIdentity = catalogHash({ userId, fromId, fromVersion: input.fromVersion, toId: input.toId, toVersion: input.toVersion, relation: input.relation });
      const duplicate = (await tx.select().from(memoryRelations).where(eq(memoryRelations.activeIdentity, activeIdentity)))[0];
      if (duplicate) throw new ConflictException('MEMORY_RELATION_ALREADY_RECORDED');
      const id = newId(), now = new Date();
      await tx.insert(memoryRelations).values({ id, userId, requestId: input.requestId, fromId, fromVersion: input.fromVersion, toId: input.toId, toVersion: input.toVersion, relation: input.relation, weight: 1, activeIdentity, status: 'ACTIVE', version: 1, createdAt: now, updatedAt: now });
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'MEMORY_RELATION_CONFIRMED', resourceType: 'memory_relation', resourceId: id,
        after: { fromId, fromVersion: input.fromVersion, toId: input.toId, toVersion: input.toVersion, relation: input.relation, version: 1 }, source: 'api', result: 'success' }, tx);
      return { id, version: 1 };
    });
  }
  async remove(userId: string, id: string, version: number) {
    return this.db.transaction(async tx => {
      await this.memories.lockSettings(tx, userId);
      const row = (await tx.select().from(memoryRelations).where(and(eq(memoryRelations.id, id), eq(memoryRelations.userId, userId))).for('update'))[0];
      if (!row) throw new NotFoundException('Memory relation not found');
      if (row.status === 'REVOKED' && row.version === version + 1) return { removed: true };
      if (row.status !== 'ACTIVE' || row.version !== version) throw new ConflictException('MEMORY_RELATION_VERSION_CHANGED');
      await tx.update(memoryRelations).set({ status: 'REVOKED', activeIdentity: null, version: version + 1, updatedAt: new Date() }).where(eq(memoryRelations.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'MEMORY_RELATION_REMOVED', resourceType: 'memory_relation', resourceId: id, source: 'api', result: 'success' }, tx);
      return { removed: true };
    });
  }
}
export function projectRelation(row: typeof memoryRelations.$inferSelect, fromTitle: string, toTitle: string): MemoryRelation {
  return { id: row.id, version: row.version, fromId: row.fromId, fromVersion: row.fromVersion, toId: row.toId, toVersion: row.toVersion,
    relation: row.relation as MemoryRelation['relation'], weight: row.weight, fromTitle, toTitle, createdAt: row.createdAt.toISOString() };
}
