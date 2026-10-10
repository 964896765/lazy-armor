import { Inject, Injectable } from '@nestjs/common';
import { auditLogs, connectionPermissions, connectionCapabilityGrants, connections, credentialRefs, providerCapabilityHealth, executions, executionSteps, plans, planTriggers } from '@lazy-armor/database';
import { githubDigestSchema, githubTrendingSchema, isGithubDigestDefinition } from '@lazy-armor/plan-schema';
import { and, desc, eq, ne } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ConnectionsService } from '../connections/connections.service';
import type { ConsumerReadSource } from '../connections/consumer-read-source.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { WEB_READ } from '../connectors/public-web.connector';
import { GithubDigestModelService } from './github-digest-model.service';
import { ExecutionRuntimeError } from './execution.types';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';

@Injectable()
export class GithubDigestService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly connectionsService: ConnectionsService,
    private readonly model: GithubDigestModelService, private readonly notifications: NotificationService,
    private readonly audit: AuditService, private readonly sanitizer: SnapshotSanitizer, private readonly assembler: PlanDefinitionAssembler) {}
  private async authority(userId: string, executionId: string, context: Record<string, unknown>) {
    const execution = (await this.db.select().from(executions).where(and(eq(executions.id, executionId), eq(executions.userId, userId))))[0];
    const assembled = execution?.planId && execution.planVersionId ? await this.assembler.assembleById(userId, execution.planId, execution.planVersionId) : null;
    const definition = assembled?.definition;
    if (!execution?.planId || !execution.planVersionId || !definition || assembled?.computedHash !== execution.definitionHash || !isGithubDigestDefinition(definition) || execution.cancellationRequestedAt)
      throw new ExecutionRuntimeError('GITHUB_PLAN_INVALID', 'GitHub 汇总需要当前持续计划');
    const plan = (await this.db.select().from(plans).where(and(eq(plans.id, execution.planId), eq(plans.userId, userId))))[0];
    if (plan?.status !== 'active' || plan.activeVersionId !== execution.planVersionId) throw new ExecutionRuntimeError('GITHUB_PLAN_INACTIVE', '计划已暂停或版本已变化');
    const input = context.githubSource as { authority?: ConsumerReadSource; data?: unknown } | undefined;
    if (!input?.authority || input.authority.userId !== userId || input.authority.connectionId !== definition.sources[0]?.connectionId || input.authority.capabilityKey !== WEB_READ)
      throw new ExecutionRuntimeError('GITHUB_SOURCE_INVALID', '汇总需要本次真实读取来源');
    const data = githubTrendingSchema.parse(input.data), age = Date.now() - Date.parse(data.retrievedAt);
    if (age < -5000 || age > 10 * 60000) throw new ExecutionRuntimeError('GITHUB_SOURCE_STALE', '榜单读取已过期，请重新运行');
    await this.connectionsService.assertConsumerReadAuthority(input.authority);
    return { execution, plan, source: input.authority, data };
  }
  async summarize(userId: string, executionId: string, context: Record<string, unknown>) {
    const current = await this.authority(userId, executionId, context);
    const previous = await this.db.select({ output: executionSteps.outputSnapshotJson }).from(executions)
      .innerJoin(executionSteps, and(eq(executionSteps.executionId, executions.id), eq(executionSteps.actionType, 'summarize')))
      .where(and(eq(executions.userId, userId), eq(executions.planId, current.plan.id), eq(executions.planVersionId, current.execution.planVersionId!),
        eq(executions.status, 'succeeded'), ne(executions.id, executionId))).orderBy(desc(executions.finishedAt)).limit(1);
    const baseline = githubDigestSchema.safeParse(previous[0]?.output?.githubDigest);
    const previousRanks = baseline.success ? Object.fromEntries(baseline.data.source.repositories.map(r => [r.fullName, r.rank])) : {};
    const planned = await this.model.plan(userId, current.data, previousRanks);
    await this.authority(userId, executionId, context);
    const written = await this.model.write(userId, planned.value.prompt, current.data, previousRanks);
    await this.authority(userId, executionId, context);
    const githubDigest = githubDigestSchema.parse(this.sanitizer.sanitize({ source: current.data, prompt: planned.value.prompt, modelId: written.modelId,
      overview: written.value.overview, items: written.value.items.map(item => ({ ...item, previousRank: previousRanks[item.fullName] ?? null })),
      baselineAt: baseline.success ? baseline.data.source.retrievedAt : null }));
    const output = { githubDigest, githubReadAuthority: current.source, humanSummary: 'GitHub 日榜前 10 汇总', resultSummary: '已生成全部语言前 10 中文摘要。打开运行记录查看排名、来源和自动提示词。' };
    if (this.sanitizer.sanitize(output).truncated) throw new ExecutionRuntimeError('GITHUB_DIGEST_TOO_LARGE', '摘要超过保存上限');
    return output;
  }
  async notify(userId: string, executionId: string, context: Record<string, unknown>) {
    const current = await this.authority(userId, executionId, context), digest = githubDigestSchema.parse(context.githubDigest);
    if (JSON.stringify(digest.source) !== JSON.stringify(this.sanitizer.sanitize(current.data))) throw new ExecutionRuntimeError('GITHUB_DIGEST_SOURCE_MISMATCH', '摘要与本次读取不一致');
    return this.db.transaction(async tx => {
      // Lock the authority rows used by existing status and permission mutations.
      await tx.select().from(executions).where(eq(executions.id, executionId)).for('update');
      await tx.select().from(plans).where(eq(plans.id, current.plan.id)).for('update');
      await tx.select().from(connectionPermissions).where(eq(connectionPermissions.connectionId, current.source.connectionId)).for('update');
      await tx.select().from(connectionCapabilityGrants).where(eq(connectionCapabilityGrants.connectionId, current.source.connectionId)).for('update');
      const connection = (await tx.select().from(connections).where(eq(connections.id, current.source.connectionId)).for('update'))[0];
      if (connection?.credentialRefId) await tx.select().from(credentialRefs).where(eq(credentialRefs.id, connection.credentialRefId)).for('update');
      await tx.select().from(providerCapabilityHealth).where(eq(providerCapabilityHealth.connectionId, current.source.connectionId)).for('update');
      await this.authority(userId, executionId, context);
      const saved = (await tx.select().from(executionSteps).where(and(eq(executionSteps.executionId, executionId), eq(executionSteps.actionType, 'summarize'), eq(executionSteps.status, 'succeeded'))))[0];
      const persisted = githubDigestSchema.parse(saved?.outputSnapshotJson?.githubDigest);
      if (JSON.stringify(persisted) !== JSON.stringify(digest)) throw new ExecutionRuntimeError('GITHUB_DIGEST_NOT_PERSISTED', '摘要必须来自本次已保存步骤');
      const notification = await this.notifications.emit({ userId, executionId, priority: 'P2', eventType: 'github_trending_digest',
        dedupeKey: `github-digest:${executionId}`, title: 'GitHub 日榜前 10 汇总', body: digest.overview + '\n打开运行记录查看十项摘要、排名与来源。' }, tx);
      if (!notification) throw new ExecutionRuntimeError('GITHUB_NOTIFICATION_FAILED', '站内摘要未保存');
      await this.authority(userId, executionId, context);
      return { notified: true, notificationId: notification.id, resultSummary: 'GitHub 日榜前 10 摘要已保存并发送站内通知。' };
    });
  }
  async recordCompletion(userId: string, executionId: string) {
    await this.db.transaction(async tx => {
      const execution = (await tx.select().from(executions).where(and(eq(executions.id, executionId), eq(executions.userId, userId))).for('update'))[0];
      if (!execution?.planId || !execution.planVersionId || execution.status !== 'succeeded') return;
      const assembled = await this.assembler.assembleById(userId, execution.planId, execution.planVersionId, tx);
      if (assembled.computedHash !== execution.definitionHash || !isGithubDigestDefinition(assembled.definition)) return;
      if ((await tx.select().from(auditLogs).where(and(eq(auditLogs.userId, userId), eq(auditLogs.resourceId, executionId), eq(auditLogs.action, 'GITHUB_DIGEST_RESULT_REEVALUATED'))).limit(1))[0]) return;
      const plan = (await tx.select().from(plans).where(eq(plans.id, execution.planId)).for('update'))[0];
      const steps = await tx.select().from(executionSteps).where(eq(executionSteps.executionId, executionId));
      if (!steps.some(step => step.actionType === 'notify' && step.outputSnapshotJson?.notified === true)) return;
      const triggers = await tx.select().from(planTriggers).where(and(eq(planTriggers.planVersionId, execution.planVersionId), eq(planTriggers.triggerType, 'schedule')));
      const current = plan?.status === 'active' && plan.activeVersionId === execution.planVersionId;
      const nextRunAt = current ? triggers.flatMap(trigger => { try { return [CronExpressionParser.parse(String(trigger.configJson.cronExpression), { tz: String(trigger.configJson.timezone), currentDate: new Date() }).next().toISOString()]; } catch { return []; } }).sort()[0] ?? null : null;
      await this.audit.append({ actorType: 'system', userId, executionId, action: 'GITHUB_DIGEST_RESULT_REEVALUATED', resourceType: 'execution', resourceId: executionId,
        correlationId: plan.id, source: 'scheduler', result: current ? 'success' : 'blocked',
        after: { planVersionId: execution.planVersionId, state: current ? 'WAITING_NEXT_SCHEDULE' : 'INACTIVE_VERSION', nextRunAt, verification: 'SOURCE_RESPONSE_ONLY' },
        changeSummary: 'Completed public digest returned to the existing persistent schedule; no personal Truth created' }, tx);
    });
  }
}
