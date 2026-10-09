import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { personalMemories, personalMemorySettings } from '@lazy-armor/database';
import { rankPersonalMemories, type MemoryContextSnapshot, type MemorySettings, type PersonalMemory } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, inArray, lt, or, gt, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../common/cursor-pagination';
import { AuditService } from '../audit/audit.service';
import type { CreateMemoryDto, EditMemoryDto, MemorySettingsDto } from './dto';

type Transaction = Pick<InjectedDatabase, 'select' | 'insert' | 'update'>;

@Injectable()
export class MemoryService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async settings(userId: string): Promise<MemorySettings> {
    const row = (await this.db.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)))[0];
    return { enabled: row?.enabled ?? false, version: row?.version ?? 0 };
  }
  private async lockSettings(tx: Transaction, userId: string) {
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
    const content = normalizeContent(input);
    return this.db.transaction(async tx => {
      const settings = await this.lockSettings(tx, userId);
      const prior = (await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.requestId, input.requestId))))[0];
      if (prior) {
        if (prior.status !== 'ACTIVE' || prior.type !== input.type || prior.title !== content.title || prior.content !== content.content || (prior.expiresAt?.getTime() ?? null) !== (content.expiresAt?.getTime() ?? null)) throw new ConflictException('MEMORY_REQUEST_IDENTITY_CHANGED');
        return toMemory(prior);
      }
      if (!settings.enabled) throw new ConflictException('MEMORY_USAGE_DISABLED');
      const now = new Date(), id = newId();
      const value = { id, userId, requestId: input.requestId, type: input.type, ...content, sourceKind: 'USER_INPUT', status: 'ACTIVE', version: 1, confirmedAt: now, createdAt: now, updatedAt: now };
      await tx.insert(personalMemories).values(value);
      await this.auditChange(tx, userId, id, 'MEMORY_SAVED', { type: input.type, version: 1, sourceKind: 'USER_INPUT' });
      return toMemory(value);
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
      const patch = { ...content, type: input.type, version: row.version + 1, confirmedAt: new Date(), updatedAt: new Date() };
      await tx.update(personalMemories).set(patch).where(eq(personalMemories.id, id));
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
      return { enabled: true, settingsVersion: settings.version, items: rankPersonalMemories(intent, rows.map(toMemory)) };
    });
  }
  async contextCurrent(userId: string, snapshot: MemoryContextSnapshot) {
    if (!snapshot.items.length) return true;
    return this.db.transaction(async tx => {
      const settings = (await tx.select().from(personalMemorySettings).where(eq(personalMemorySettings.userId, userId)))[0];
      if (!settings?.enabled || settings.version !== snapshot.settingsVersion) return false;
      const rows = await tx.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'), inArray(personalMemories.id, snapshot.items.map(item => item.id))));
      return snapshot.items.every(ref => rows.some(row => row.id === ref.id && row.version === ref.version && (!row.expiresAt || row.expiresAt.getTime() > Date.now())));
    });
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
  return { id: row.id, type: row.type as PersonalMemory['type'], title: row.title!, content: row.content!, sourceKind: 'USER_INPUT',
    version: row.version, confirmedAt: row.confirmedAt.toISOString(), createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null };
}
