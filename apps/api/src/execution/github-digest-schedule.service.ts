import { Inject, Injectable } from '@nestjs/common';
import { auditLogs, executions, planSources, plans, planTriggers } from '@lazy-armor/database';
import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import { isGithubDigestDefinition } from '@lazy-armor/plan-schema';
import { CronExpressionParser } from 'cron-parser';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { PlanDefinitionAssembler } from '../plans/plan-definition.assembler';
import { ExecutionDispatchService } from './execution-dispatch.service';
import { GithubDigestService } from './github-digest.service';
import { AuditService } from '../audit/audit.service';

/** Adapter on the original execution-worker tick; no second timer or scheduler. */
@Injectable()
export class GithubDigestScheduleService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly assembler: PlanDefinitionAssembler,
    private readonly dispatch: ExecutionDispatchService, private readonly digest: GithubDigestService, private readonly audit: AuditService) {}
  async wake(userId?: string, now = new Date()) {
    const rows = await this.db.select({ plan: plans, trigger: planTriggers }).from(plans)
      .innerJoin(planSources, and(eq(planSources.planVersionId, plans.activeVersionId), eq(planSources.sourceType, 'file'), sql`JSON_UNQUOTE(JSON_EXTRACT(${planSources.configJson}, '$.mode')) = 'github_trending_daily'`))
      .innerJoin(planTriggers, and(eq(planTriggers.planVersionId, plans.activeVersionId), eq(planTriggers.triggerType, 'schedule')))
      .where(and(eq(plans.status, 'active'), eq(plans.executionScope, 'PLAN'), ...(userId ? [eq(plans.userId, userId)] : [])));
    const results: Array<{ planId: string; executionId: string }> = [];
    for (const { plan, trigger } of rows) {
      if (!plan.activeVersionId || trigger.configJson.cronExpression !== '0 9 * * *' || trigger.configJson.timezone !== 'Asia/Shanghai') continue;
      const slot = CronExpressionParser.parse('0 9 * * *', { tz: 'Asia/Shanghai', currentDate: new Date(now.getTime() + 1) }).prev().toDate();
      if (now.getTime() - slot.getTime() >= 60000 || slot < plan.updatedAt) continue;
      try {
        const assembled = await this.assembler.assembleById(plan.userId, plan.id, plan.activeVersionId);
        if (!isGithubDigestDefinition(assembled.definition)) continue;
        const result = await this.dispatch.dispatchGithubSchedule(plan.userId, plan.id, plan.activeVersionId, trigger.id, slot);
        results.push({ planId: plan.id, executionId: result.id });
      } catch {
        await this.audit.append({ actorType: 'system', userId: plan.userId, action: 'GITHUB_DIGEST_SCHEDULE_BLOCKED', resourceType: 'plan_version', resourceId: plan.activeVersionId,
          source: 'scheduler', result: 'blocked', after: { triggerId: trigger.id, scheduledAt: slot.toISOString() }, changeSummary: 'Daily public digest could not dispatch its current version; other scheduled plans continue' });
      }
    }
    return results;
  }
  async complete(userId?: string) {
    const rows = await this.db.select({ id: executions.id, userId: executions.userId }).from(executions)
      .where(and(eq(executions.status, 'succeeded'), sql`${executions.requestId} LIKE 'github-%'`,
        notExists(this.db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.userId, executions.userId), eq(auditLogs.resourceId, sql`LOWER(BIN_TO_UUID(${executions.id}))`), eq(auditLogs.action, 'GITHUB_DIGEST_RESULT_REEVALUATED')))),
        ...(userId ? [eq(executions.userId, userId)] : []))).orderBy(asc(executions.finishedAt)).limit(32);
    for (const row of rows) await this.digest.recordCompletion(row.userId, row.id);
  }
}
