import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { canonicalStringify, skillCapabilitySchema, skillMethodRefsSchema, skillRepositoryImportSchema, type ConversationMethodProjection, type SkillMethodRef, type SkillRepositoryProjection, type SkillRevisionHistory } from '@lazy-armor/plan-schema';
import { plans, planVersions, skillRepositories, skillEntries, skillEntryRevisions, planSkillReferences, users } from '@lazy-armor/database';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../common/cursor-pagination';
import { AuditService } from '../audit/audit.service';

type Store = Pick<InjectedDatabase, 'select' | 'insert'>;
const digest = (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex');

@Injectable()
export class SkillRepositoriesService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async import(userId: string, raw: unknown) {
    const parsed = skillRepositoryImportSchema.safeParse(raw);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(raw), 'utf8') > 120000) throw new BadRequestException('Invalid or oversized skill repository package');
    const input = parsed.data;
    const hash = digest(input);
    const id = await this.db.transaction(async tx => {
      // Serialize imports per owner: simultaneous request replay has one identity.
      const owner = (await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update'))[0];
      if (!owner) throw new NotFoundException('Owner not found');
      const prior = (await tx.select().from(skillRepositories).where(and(eq(skillRepositories.userId, userId), eq(skillRepositories.requestId, input.requestId))).limit(1))[0];
      if (prior) { if (prior.importHash !== hash) throw new ConflictException('SKILL_IMPORT_REQUEST_REUSED'); return prior.id; }
      const id = newId(), now = new Date();
      await tx.insert(skillRepositories).values({ id, userId, requestId: input.requestId, importHash: hash, name: input.name,
        sourceType: input.sourceType, sourceUrl: input.sourceUrl ?? null, enabled: false, status: 'ACTIVE', version: 1, createdAt: now, updatedAt: now });
      for (const manifest of input.entries) {
        const entryId = newId(), revisionId = newId();
        await tx.insert(skillEntries).values({ id: entryId, repositoryId: id, name: manifest.name, currentRevisionId: revisionId, createdAt: now });
        await tx.insert(skillEntryRevisions).values({ id: revisionId, entryId, version: manifest.version, contentHash: digest(manifest), manifestJson: manifest, createdAt: now });
      }
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'SKILL_REPOSITORY_IMPORTED', resourceType: 'skill_repository', resourceId: id,
        source: 'api', result: 'success', after: { importHash: hash, sourceType: input.sourceType, entryCount: input.entries.length, enabled: false },
        changeSummary: 'User imported declarative method guidance; import does not enable planning or execution' }, tx);
      return id;
    });
    return this.get(userId, id);
  }

  async list(userId: string, query: CursorPageDto) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.select().from(skillRepositories).where(and(eq(skillRepositories.userId, userId), eq(skillRepositories.status, 'ACTIVE'),
      ...(cursor ? [or(lt(skillRepositories.createdAt, cursor.createdAt), and(eq(skillRepositories.createdAt, cursor.createdAt), lt(skillRepositories.id, cursor.id)))!] : [])))
      .orderBy(desc(skillRepositories.createdAt), desc(skillRepositories.id)).limit(query.limit + 1);
    const page = pageResult(rows, query.limit);
    return { items: await Promise.all(page.items.map(row => this.get(userId, row.id))), nextCursor: page.nextCursor };
  }

  async get(userId: string, id: string): Promise<SkillRepositoryProjection> {
    const repo = (await this.db.select().from(skillRepositories).where(and(eq(skillRepositories.id, id), eq(skillRepositories.userId, userId))).limit(1))[0];
    if (!repo) throw new NotFoundException('Skill repository not found');
    const entries = await this.db.select({ entry: skillEntries, revision: skillEntryRevisions }).from(skillEntries)
      .innerJoin(skillEntryRevisions, and(eq(skillEntryRevisions.id, skillEntries.currentRevisionId), eq(skillEntryRevisions.entryId, skillEntries.id)))
      .where(eq(skillEntries.repositoryId, id)).orderBy(desc(skillEntries.createdAt), desc(skillEntries.id));
    return { id: repo.id, name: repo.name, sourceType: repo.sourceType, sourceUrl: repo.sourceUrl, provenance: 'USER_IMPORTED', enabled: repo.enabled,
      status: repo.status, version: repo.version, entries: entries.map(({ entry, revision }) => {
        const manifest = skillCapabilitySchema.parse(revision.manifestJson);
        if (digest(manifest) !== revision.contentHash) throw new ConflictException('SKILL_REVISION_INTEGRITY_MISMATCH');
        return { id: entry.id, revisionId: revision.id, contentHash: revision.contentHash, manifest };
      }), executionAuthorized: false };
  }

  async change(userId: string, id: string, version: number, enabled: boolean, archive = false) {
    await this.db.transaction(async tx => {
      const repo = (await tx.select().from(skillRepositories).where(and(eq(skillRepositories.id, id), eq(skillRepositories.userId, userId))).for('update'))[0];
      if (!repo) throw new NotFoundException('Skill repository not found');
      if (repo.version !== version || repo.status !== 'ACTIVE') throw new ConflictException('SKILL_REPOSITORY_CHANGED');
      await tx.update(skillRepositories).set({ version: version + 1, enabled: archive ? false : enabled, status: archive ? 'ARCHIVED' : 'ACTIVE', updatedAt: new Date() }).where(eq(skillRepositories.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: archive ? 'SKILL_REPOSITORY_ARCHIVED' : 'SKILL_REPOSITORY_PLANNING_CHANGED',
        resourceType: 'skill_repository', resourceId: id, source: 'api', result: 'success', after: { version: version + 1, enabled: archive ? false : enabled },
        changeSummary: 'User changed method guidance availability; frozen Plan references and Runtime authority retained' }, tx);
    });
    return this.get(userId, id);
  }

  async history(userId: string, repositoryId: string, entryId: string, query: CursorPageDto): Promise<SkillRevisionHistory> {
    const cursor = decodeCursor(query.cursor);
    return this.db.transaction(async tx => {
      const row = (await tx.select({ repo: skillRepositories, entry: skillEntries }).from(skillRepositories)
        .innerJoin(skillEntries, eq(skillEntries.repositoryId, skillRepositories.id))
        .where(and(eq(skillRepositories.userId, userId), eq(skillRepositories.id, repositoryId), eq(skillEntries.id, entryId))).limit(1))[0];
      if (!row) throw new NotFoundException('Skill entry not found');
      const rows = await tx.select().from(skillEntryRevisions).where(and(eq(skillEntryRevisions.entryId, entryId),
        ...(cursor ? [or(lt(skillEntryRevisions.createdAt, cursor.createdAt),
          and(eq(skillEntryRevisions.createdAt, cursor.createdAt), lt(skillEntryRevisions.id, cursor.id)))!] : [])))
        .orderBy(desc(skillEntryRevisions.createdAt), desc(skillEntryRevisions.id)).limit(query.limit + 1);
      const page = pageResult(rows, query.limit);
      return { repositoryId, repositoryVersion: row.repo.version, repositoryStatus: row.repo.status, entryId,
        currentRevisionId: row.entry.currentRevisionId, nextCursor: page.nextCursor, executionAuthorized: false,
        items: page.items.map(revision => {
          const parsed = skillCapabilitySchema.safeParse(revision.manifestJson);
          if (!parsed.success || digest(parsed.data) !== revision.contentHash || parsed.data.version !== revision.version || parsed.data.name !== row.entry.name)
            throw new ConflictException('SKILL_REVISION_INTEGRITY_MISMATCH');
          return { id: revision.id, version: revision.version, contentHash: revision.contentHash, manifest: parsed.data,
            createdAt: revision.createdAt.toISOString(), current: revision.id === row.entry.currentRevisionId };
        }) };
    });
  }

  async revise(userId: string, repositoryId: string, entryId: string, version: number, raw: unknown) {
    const parsed = skillCapabilitySchema.safeParse(raw);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(raw), 'utf8') > 120000) throw new BadRequestException('Invalid or oversized skill manifest');
    const manifest = parsed.data;
    await this.db.transaction(async tx => {
      const repo = (await tx.select().from(skillRepositories).where(and(eq(skillRepositories.id, repositoryId), eq(skillRepositories.userId, userId))).for('update'))[0];
      if (!repo) throw new NotFoundException('Skill repository not found');
      const entry = (await tx.select().from(skillEntries).where(and(eq(skillEntries.id, entryId), eq(skillEntries.repositoryId, repositoryId))).limit(1))[0];
      if (!entry) throw new NotFoundException('Skill entry not found');
      if (repo.status !== 'ACTIVE' || entry.name !== manifest.name) throw new ConflictException('SKILL_REPOSITORY_CHANGED');
      const existing = (await tx.select().from(skillEntryRevisions).where(and(eq(skillEntryRevisions.entryId, entryId), eq(skillEntryRevisions.version, manifest.version))).limit(1))[0];
      if (existing) {
        if (existing.contentHash !== digest(manifest)) throw new ConflictException('SKILL_VERSION_IMMUTABLE');
        if (entry.currentRevisionId !== existing.id) throw new ConflictException('SKILL_REVISION_SUPERSEDED');
        return; // Identical upload replay does not create a new revision/version.
      }
      if (repo.version !== version) throw new ConflictException('SKILL_REPOSITORY_CHANGED');
      const id = newId();
      await tx.insert(skillEntryRevisions).values({ id, entryId, version: manifest.version, contentHash: digest(manifest), manifestJson: manifest, createdAt: new Date() });
      await tx.update(skillEntries).set({ currentRevisionId: id }).where(eq(skillEntries.id, entryId));
      await tx.update(skillRepositories).set({ version: version + 1, updatedAt: new Date() }).where(eq(skillRepositories.id, repositoryId));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'SKILL_ENTRY_REVISED', resourceType: 'skill_entry', resourceId: entryId,
        source: 'api', result: 'success', after: { revisionId: id, version: manifest.version, contentHash: digest(manifest) }, changeSummary: 'Appended immutable method revision; prior Plan references remain pinned' }, tx);
    });
    return this.get(userId, repositoryId);
  }

  /** Bounded retrieval of opted-in, owned guidance. Never a trusted instruction channel. */
  async context(userId: string, intent: string, domain: string | null) {
    const rows = await this.db.select({ repo: skillRepositories, entry: skillEntries, revision: skillEntryRevisions }).from(skillRepositories)
      .innerJoin(skillEntries, eq(skillEntries.repositoryId, skillRepositories.id))
      .innerJoin(skillEntryRevisions, and(eq(skillEntryRevisions.id, skillEntries.currentRevisionId), eq(skillEntryRevisions.entryId, skillEntries.id)))
      .where(and(eq(skillRepositories.userId, userId), eq(skillRepositories.enabled, true), eq(skillRepositories.status, 'ACTIVE')))
      .orderBy(desc(skillRepositories.updatedAt), desc(skillEntries.id)).limit(60).catch(error => {
        // Rolling deployment before this additive migration retains the original Planner.
        // A missing store supplies zero guidance; all other failures remain errors.
        if ((error as { cause?: { code?: string }; code?: string }).cause?.code === 'ER_NO_SUCH_TABLE' ||
          (error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return [];
        throw error;
      });
    return rows.flatMap(({ repo, entry, revision }) => {
      const parsed = skillCapabilitySchema.safeParse(revision.manifestJson);
      if (!parsed.success || digest(parsed.data) !== revision.contentHash) return [];
      const manifest = parsed.data;
      if (manifest.domain !== domain && !intent.toLowerCase().includes(manifest.name.toLowerCase()) && !intent.includes(manifest.description)) return [];
      const ref: SkillMethodRef = { repositoryId: repo.id, repositoryVersion: repo.version, entryId: entry.id, revisionId: revision.id, contentHash: revision.contentHash };
      return [{ ref, manifest }];
    }).slice(0, 3);
  }

  async refsCurrent(store: Store, userId: string, refs: SkillMethodRef[]) {
    for (const ref of [...refs].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId))) {
      const row = (await store.select({ repo: skillRepositories, entry: skillEntries, revision: skillEntryRevisions }).from(skillRepositories)
        .innerJoin(skillEntries, eq(skillEntries.repositoryId, skillRepositories.id))
        .innerJoin(skillEntryRevisions, eq(skillEntryRevisions.entryId, skillEntries.id))
        .where(and(eq(skillRepositories.userId, userId), eq(skillRepositories.id, ref.repositoryId), eq(skillEntries.id, ref.entryId), eq(skillEntryRevisions.id, ref.revisionId))).for('update'))[0];
      if (!row || row.repo.status !== 'ACTIVE' || !row.repo.enabled || row.repo.version !== ref.repositoryVersion || row.entry.currentRevisionId !== ref.revisionId ||
        row.revision.contentHash !== ref.contentHash || digest(row.revision.manifestJson) !== ref.contentHash) return false;
    }
    return true;
  }

  async contextCurrent(userId: string, refs: SkillMethodRef[]) {
    return this.db.transaction(tx => this.refsCurrent(tx, userId, refs));
  }

  /** Explicit choices keep their exact identity; never silently substitute a new revision. */
  async selectedContext(userId: string, raw: unknown) {
    const parsed = skillMethodRefsSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid method selection');
    return this.db.transaction(async tx => {
      if (!await this.refsCurrent(tx, userId, parsed.data)) throw new ConflictException('SKILL_CONTEXT_CHANGED');
      const methods = [];
      for (const ref of parsed.data) {
        const revision = (await tx.select().from(skillEntryRevisions).where(eq(skillEntryRevisions.id, ref.revisionId)))[0];
        methods.push({ ref, manifest: skillCapabilitySchema.parse(revision.manifestJson) });
      }
      return methods;
    });
  }

  async projectSelections(userId: string, refs: SkillMethodRef[]): Promise<ConversationMethodProjection[]> {
    const items: ConversationMethodProjection[] = [];
    for (const ref of skillMethodRefsSchema.parse(refs)) {
      const row = (await this.db.select({ repo: skillRepositories, entry: skillEntries, revision: skillEntryRevisions }).from(skillRepositories)
        .innerJoin(skillEntries, eq(skillEntries.repositoryId, skillRepositories.id))
        .innerJoin(skillEntryRevisions, eq(skillEntryRevisions.entryId, skillEntries.id))
        .where(and(eq(skillRepositories.userId, userId), eq(skillRepositories.id, ref.repositoryId),
          eq(skillEntries.id, ref.entryId), eq(skillEntryRevisions.id, ref.revisionId))).limit(1))[0];
      if (!row || row.revision.contentHash !== ref.contentHash || digest(row.revision.manifestJson) !== ref.contentHash) {
        items.push({ ref, name: '原方法', version: '', repositoryName: '', state: 'UNAVAILABLE', executionAuthorized: false });
        continue;
      }
      const manifest = skillCapabilitySchema.parse(row.revision.manifestJson);
      items.push({ ref, name: manifest.name, version: manifest.version, repositoryName: row.repo.name,
        state: row.repo.status !== 'ACTIVE' || !row.repo.enabled ? 'UNAVAILABLE'
          : row.repo.version !== ref.repositoryVersion || row.entry.currentRevisionId !== ref.revisionId ? 'CHANGED' : 'CURRENT',
        executionAuthorized: false });
    }
    return items;
  }

  async forPlan(userId: string, planId: string) {
    const owner = (await this.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1))[0];
    if (!owner) throw new NotFoundException('Plan not found');
    const versionId = owner.activeVersionId ?? owner.currentVersionId;
    if (!versionId) return [];
    const rows = await this.db.select({ ref: planSkillReferences, revision: skillEntryRevisions, repository: skillRepositories }).from(planSkillReferences)
      .innerJoin(skillEntryRevisions, eq(skillEntryRevisions.id, planSkillReferences.revisionId))
      .innerJoin(skillEntries, eq(skillEntries.id, skillEntryRevisions.entryId))
      .innerJoin(skillRepositories, eq(skillRepositories.id, skillEntries.repositoryId))
      .where(and(eq(planSkillReferences.userId, userId), eq(planSkillReferences.planVersionId, versionId), eq(skillRepositories.userId, userId)));
    return rows.map(({ ref, revision, repository }) => {
      if (ref.contentHash !== revision.contentHash || digest(revision.manifestJson) !== ref.contentHash) throw new ConflictException('SKILL_REVISION_INTEGRITY_MISMATCH');
      return { ...ref, name: String(revision.manifestJson.name), version: revision.version, repositoryName: repository.name,
        sourceUrl: repository.sourceUrl, repositoryStatus: repository.status, executionAuthorized: false };
    });
  }

  async freeze(store: Store, userId: string, planVersionId: string, refs: SkillMethodRef[]) {
    const owner = (await store.select({ id: planVersions.id }).from(planVersions).innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(and(eq(planVersions.id, planVersionId), eq(plans.userId, userId))).limit(1))[0];
    if (!owner) throw new NotFoundException('Plan version not found');
    if (!await this.refsCurrent(store, userId, refs)) throw new ConflictException('SKILL_CONTEXT_CHANGED');
    for (const ref of refs) await store.insert(planSkillReferences).values({ id: newId(), userId, planVersionId, revisionId: ref.revisionId,
      contentHash: ref.contentHash, repositoryVersion: ref.repositoryVersion, createdAt: new Date() });
  }
}
