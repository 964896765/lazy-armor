import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { templateLifecycleVersions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { getPlanTemplateByKey, type PlanTemplateManifest } from './template-registry';

export type TemplateLifecycleStatus = 'draft' | 'review' | 'published' | 'deprecated' | 'suspended';
export type TemplateLifecycleAction = 'submit-review' | 'publish' | 'deprecate' | 'suspend';

const TRANSITIONS: Record<TemplateLifecycleAction, { from: TemplateLifecycleStatus[]; to: TemplateLifecycleStatus }> = {
  'submit-review': { from: ['draft'], to: 'review' },
  publish: { from: ['review', 'suspended'], to: 'published' },
  deprecate: { from: ['published'], to: 'deprecated' },
  suspend: { from: ['review', 'published', 'deprecated'], to: 'suspended' },
};

@Injectable()
export class TemplateLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
  ) {}

  async statesFor(manifests: PlanTemplateManifest[]) {
    if (manifests.length === 0) return new Map<string, TemplateLifecycleStatus>();
    const rows = await this.db.select({
      templateKey: templateLifecycleVersions.templateKey,
      templateVersion: templateLifecycleVersions.templateVersion,
      status: templateLifecycleVersions.status,
    }).from(templateLifecycleVersions)
      .where(inArray(templateLifecycleVersions.templateKey, manifests.map((item) => item.key)));
    const overlays = new Map(rows.map((row) => [this.identity(row.templateKey, row.templateVersion), row.status as TemplateLifecycleStatus]));
    return new Map(manifests.map((manifest) => [manifest.key, overlays.get(this.identity(manifest.key, manifest.templateVersion)) ?? manifest.status]));
  }

  async get(key: string) {
    const manifest = getPlanTemplateByKey(key);
    if (!manifest) throw new NotFoundException('Template not found');
    const rows = await this.db.select().from(templateLifecycleVersions)
      .where(and(
        eq(templateLifecycleVersions.templateKey, key),
        eq(templateLifecycleVersions.templateVersion, manifest.templateVersion),
      )).limit(1);
    return rows[0] ? this.serialize(rows[0]) : {
      templateKey: key,
      templateVersion: manifest.templateVersion,
      status: manifest.status as TemplateLifecycleStatus,
      revision: 0,
      reason: null,
      submittedAt: null,
      publishedAt: null,
      deprecatedAt: null,
      suspendedAt: null,
    };
  }

  async assertInstallable(key: string) {
    const state = await this.get(key);
    if (state.status !== 'published') {
      throw new ConflictException({
        code: 'TEMPLATE_NOT_INSTALLABLE',
        message: state.status === 'deprecated' ? '这个模板已停止推荐，暂不能新安装。' : '这个模板当前暂不能安装。',
      });
    }
  }

  async transition(actorUserId: string, key: string, action: TemplateLifecycleAction, reason?: string) {
    const manifest = getPlanTemplateByKey(key);
    if (!manifest) throw new NotFoundException('Template not found');
    const transition = TRANSITIONS[action];
    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx.insert(templateLifecycleVersions).values({
        id: newId(), templateKey: key, templateVersion: manifest.templateVersion,
        status: manifest.status, revision: 1, reason: null, updatedByUserId: actorUserId,
        submittedAt: null, publishedAt: manifest.status === 'published' ? now : null,
        deprecatedAt: null, suspendedAt: null, createdAt: now, updatedAt: now,
      }).onDuplicateKeyUpdate({ set: { templateKey: key } });
      const rows = await tx.select().from(templateLifecycleVersions)
        .where(and(
          eq(templateLifecycleVersions.templateKey, key),
          eq(templateLifecycleVersions.templateVersion, manifest.templateVersion),
        )).limit(1).for('update');
      const current = rows[0];
      if (!current) throw new NotFoundException('Template lifecycle is unavailable');
      const currentStatus = current.status as TemplateLifecycleStatus;
      if (!transition.from.includes(currentStatus)) {
        throw new ConflictException('Template cannot move from ' + currentStatus + ' via ' + action);
      }
      const timestamps = this.timestampsFor(transition.to, now);
      await tx.update(templateLifecycleVersions).set({
        status: transition.to,
        revision: sql`${templateLifecycleVersions.revision} + 1`,
        reason: reason?.trim() || null,
        updatedByUserId: actorUserId,
        ...timestamps,
        updatedAt: now,
      }).where(eq(templateLifecycleVersions.id, current.id));
      await this.audit.append({
        actorType: 'admin', actorUserId, action: 'TEMPLATE_LIFECYCLE_CHANGED',
        resourceType: 'template', resourceId: key, userId: actorUserId,
        source: 'api', result: 'success',
        before: { status: currentStatus, revision: current.revision },
        after: { status: transition.to, revision: current.revision + 1, reason: reason?.trim() || null },
        changeSummary: 'Template ' + key + '@' + manifest.templateVersion + ' moved from ' + currentStatus + ' to ' + transition.to,
      }, tx);
      return {
        templateKey: key,
        templateVersion: manifest.templateVersion,
        status: transition.to,
        revision: current.revision + 1,
        reason: reason?.trim() || null,
      };
    });
  }

  private timestampsFor(status: TemplateLifecycleStatus, now: Date) {
    if (status === 'review') return { submittedAt: now };
    if (status === 'published') return { publishedAt: now };
    if (status === 'deprecated') return { deprecatedAt: now };
    if (status === 'suspended') return { suspendedAt: now };
    return {};
  }

  private identity(key: string, version: string) { return key + '@' + version; }

  private serialize(row: typeof templateLifecycleVersions.$inferSelect) {
    return {
      templateKey: row.templateKey,
      templateVersion: row.templateVersion,
      status: row.status as TemplateLifecycleStatus,
      revision: row.revision,
      reason: row.reason,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
    };
  }
}
