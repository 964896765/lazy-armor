import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { auditLogs, approvalRequests, capabilityInvocations, executions, executionSteps, plans, planVersions, planTriggers, reconciliationCases, runtimeResults, verificationEvidence, sideEffectOperations } from '@lazy-armor/database';
import { agentLoopState, buildLoopCoverage, loopCoverageWindow, type AgentLoopProjection, type AgentLoopReflection, type AgentLoopHistoryItem } from '@lazy-armor/plan-schema';
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../../common/cursor-pagination';
import { PlansService } from '../../plans/plans.service';
import { PlanControlProjectionService } from '../../plans/plan-control-projection.service';
import { reflectLoopRun } from './agent-loop-reflection';

/** Loop Manager and Reflection over Plan/Task/WAIT. The original Worker runs the loop. */
@Injectable()
export class AgentLoopService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly planService: PlansService, private readonly control: PlanControlProjectionService) {}

  async list(userId: string, query: CursorPageDto) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.select().from(plans).where(and(eq(plans.userId, userId), eq(plans.executionScope, 'PLAN'),
      inArray(plans.status, ['active', 'paused', 'blocked', 'degraded']), ...(cursor ? [or(lt(plans.createdAt, cursor.createdAt),
        and(eq(plans.createdAt, cursor.createdAt), lt(plans.id, cursor.id)))!] : [])))
      .orderBy(desc(plans.createdAt), desc(plans.id)).limit(query.limit + 1);
    const page = pageResult(rows, query.limit);
    const items: AgentLoopProjection[] = [];
    for (const row of page.items) items.push(await this.forPlan(userId, row.id));
    return { items, nextCursor: page.nextCursor };
  }

  async history(userId: string, planId: string, query: CursorPageDto) {
    const plan = (await this.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId), eq(plans.executionScope, 'PLAN'))).limit(1))[0];
    if (!plan) throw new NotFoundException('Persistent plan not found');
    const versionId = plan.activeVersionId ?? plan.currentVersionId;
    if (!versionId) return { planVersionId: null, items: [], nextCursor: null };
    const cursor = decodeCursor(query.cursor);
    const [runs, checkpoints] = await Promise.all([
      this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.planId, planId), eq(executions.planVersionId, versionId),
        ...(cursor ? [or(lt(executions.createdAt, cursor.createdAt), and(eq(executions.createdAt, cursor.createdAt), lt(executions.id, cursor.id)))!] : [])))
        .orderBy(desc(executions.createdAt), desc(executions.id)).limit(query.limit + 1),
      this.db.select().from(auditLogs).where(and(eq(auditLogs.userId, userId), inArray(auditLogs.action,
        ['PERSISTENT_NOTIFICATION_RESOURCE_STATE', 'PERSISTENT_NOTIFICATION_RESULT_REEVALUATED', 'PERSISTENT_PLAN_RESULT_REEVALUATED', 'GITHUB_DIGEST_RESULT_REEVALUATED']),
        or(and(eq(auditLogs.resourceType, 'plan_version'), eq(auditLogs.resourceId, versionId)),
          and(eq(auditLogs.correlationId, planId), sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.planVersionId')) = ${versionId}`)),
        ...(cursor ? [or(lt(auditLogs.createdAt, cursor.createdAt), and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)))!] : [])))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(query.limit + 1),
    ]);
    const rows = [
      ...runs.map(row => ({ id: row.id, createdAt: row.createdAt, kind: 'RUN' as const, state: row.status, nextRunAt: null, executionId: row.id })),
      ...checkpoints.map(row => { const snapshot = row.afterSnapshotJson;
        return { id: row.id, createdAt: row.createdAt, kind: 'CHECKPOINT' as const,
          state: typeof snapshot?.state === 'string' ? snapshot.state : 'RECORDED',
          nextRunAt: typeof snapshot?.nextRunAt === 'string' && !Number.isNaN(Date.parse(snapshot.nextRunAt)) ? snapshot.nextRunAt : null,
          executionId: row.executionId }; }),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const page = pageResult(rows, query.limit);
    const pageRunIds = new Set(page.items.filter(row => row.kind === 'RUN').map(row => row.id));
    const reflections = await this.reflections(userId, versionId, runs.filter(row => pageRunIds.has(row.id)));
    const items: AgentLoopHistoryItem[] = page.items.map(({ createdAt, ...row }) => ({ ...row, planVersionId: versionId,
      recordedAt: createdAt.toISOString(), reflection: reflections.get(row.id) ?? null }));
    return { planVersionId: versionId, items, nextCursor: page.nextCursor };
  }

  async coverage(userId: string, planId: string) {
    const plan = (await this.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId), eq(plans.executionScope, 'PLAN'))).limit(1))[0];
    if (!plan) throw new NotFoundException('Persistent plan not found');
    const versionId = plan.activeVersionId ?? plan.currentVersionId ?? null, asOf = new Date();
    if (!versionId) return buildLoopCoverage({ planId, planVersionId: null, asOf, records: [], recordsComplete: true });
    const window = loopCoverageWindow(asOf), limit = 500;
    const [runs, checkpoints] = await Promise.all([
      this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.planId, planId), eq(executions.planVersionId, versionId),
        gte(executions.createdAt, window.start), lte(executions.createdAt, window.end))).orderBy(desc(executions.createdAt), desc(executions.id)).limit(limit + 1),
      this.db.select({ id: auditLogs.id, createdAt: auditLogs.createdAt, executionId: auditLogs.executionId,
        state: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.state'))` }).from(auditLogs)
        .where(and(eq(auditLogs.userId, userId), inArray(auditLogs.action,
          ['PERSISTENT_NOTIFICATION_RESOURCE_STATE', 'PERSISTENT_NOTIFICATION_RESULT_REEVALUATED', 'PERSISTENT_PLAN_RESULT_REEVALUATED', 'GITHUB_DIGEST_RESULT_REEVALUATED']),
        or(and(eq(auditLogs.resourceType, 'plan_version'), eq(auditLogs.resourceId, versionId)),
          and(eq(auditLogs.correlationId, planId), sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.planVersionId')) = ${versionId}`)),
        gte(auditLogs.createdAt, window.start), lte(auditLogs.createdAt, window.end)))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit + 1),
    ]);
    const selected = runs.slice(0, limit), reflections = await this.reflections(userId, versionId, selected);
    const records: AgentLoopHistoryItem[] = [
      ...selected.map(run => ({ id: run.id, kind: 'RUN' as const, planVersionId: versionId, recordedAt: run.createdAt.toISOString(), state: run.status,
        nextRunAt: null, executionId: run.id, reflection: reflections.get(run.id) ?? null })),
      ...checkpoints.slice(0, limit).map(checkpoint => ({ id: checkpoint.id, kind: 'CHECKPOINT' as const, planVersionId: versionId,
        recordedAt: checkpoint.createdAt.toISOString(), state: checkpoint.state || 'RECORDED', nextRunAt: null, executionId: checkpoint.executionId, reflection: null })),
    ];
    return buildLoopCoverage({ planId, planVersionId: versionId, asOf, records, recordsComplete: runs.length <= limit && checkpoints.length <= limit });
  }

  async forPlan(userId: string, planId: string): Promise<AgentLoopProjection> {
    const summary = await this.planService.get(userId, planId);
    const owned = (await this.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId), eq(plans.executionScope, 'PLAN'))).limit(1))[0];
    if (!owned) throw new NotFoundException('Persistent plan not found');
    const versionId = ['active', 'paused', 'degraded', 'blocked'].includes(summary.status)
      ? summary.activeVersionId ?? summary.currentVersionId : summary.currentVersionId;
    const projection = await this.control.forPlan(userId, planId);
    const [triggers, runs, unknowns, versions, approvals] = await Promise.all([
      versionId ? this.db.select().from(planTriggers).where(eq(planTriggers.planVersionId, versionId)) : [],
      versionId ? this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.planId, planId), eq(executions.planVersionId, versionId)))
        .orderBy(desc(executions.createdAt), desc(executions.id)).limit(1) : [],
      this.db.select({ id: reconciliationCases.id }).from(reconciliationCases).innerJoin(executions, eq(executions.id, reconciliationCases.executionId))
        .where(and(eq(reconciliationCases.userId, userId), eq(executions.userId, userId), eq(executions.planId, planId),
          inArray(reconciliationCases.status, ['OPEN', 'RECONCILING', 'NEEDS_USER']))).limit(1),
      versionId ? this.db.select({ name: planVersions.name }).from(planVersions).where(and(eq(planVersions.id, versionId), eq(planVersions.planId, planId))).limit(1) : [],
      this.db.select({ id: approvalRequests.id }).from(approvalRequests).innerJoin(executions, eq(executions.id, approvalRequests.executionId))
        .where(and(eq(approvalRequests.userId, userId), eq(executions.userId, userId), eq(executions.planId, planId), eq(approvalRequests.status, 'pending'))).limit(1),
    ]);
    const run = runs[0];
    const reflection = run && versionId ? (await this.reflections(userId, versionId, [run])).get(run.id) ?? null : null;
    const watch = 'notificationWatchState' in projection ? projection.notificationWatchState : undefined;
    return { schemaVersion: 'agent-loop.v1', planId, planVersionId: versionId ?? null, title: versions[0]?.name ?? '持续计划',
      state: agentLoopState({ planStatus: summary.status, resourceAvailable: !summary.hasMissingConnection,
        approvalPending: approvals.length > 0 || run?.status === 'waiting_approval',
        reconciliationPending: unknowns.length > 0 || reflection?.outcome === 'UNKNOWN' || (run?.errorCode === 'OUTCOME_UNKNOWN' && !reflection),
        runStatus: run?.status, outcome: reflection?.outcome, observationState: watch?.state }),
      nextRunAt: summary.status === 'active' ? summary.nextExpectedRunAt : null,
      triggerModes: [...new Set(triggers.map(trigger => trigger.triggerType))], reflection,
      asOf: new Date().toISOString(), executionAuthorized: false };
  }

  private async reflections(userId: string, versionId: string, runs: Array<typeof executions.$inferSelect>) {
    const terminal = runs.filter(run => ['succeeded', 'partially_succeeded', 'failed', 'cancelled'].includes(run.status));
    const views = new Map<string, AgentLoopReflection>();
    if (!terminal.length) return views;
    const ids = terminal.map(run => run.id);
    const [results, cases, steps] = await Promise.all([
      this.db.select({ invocation: capabilityInvocations, result: runtimeResults }).from(capabilityInvocations)
        .leftJoin(runtimeResults, and(eq(capabilityInvocations.id, runtimeResults.invocationId), eq(runtimeResults.userId, userId)))
        .where(and(eq(capabilityInvocations.userId, userId), inArray(capabilityInvocations.executionId, ids), eq(capabilityInvocations.planVersionId, versionId))),
      this.db.select().from(reconciliationCases).where(and(eq(reconciliationCases.userId, userId), inArray(reconciliationCases.executionId, ids))),
      this.db.select({ id: executionSteps.id, executionId: executionSteps.executionId, status: executionSteps.status, errorCode: executionSteps.errorCode })
        .from(executionSteps).where(inArray(executionSteps.executionId, ids)),
    ]);
    const evidence = cases.length ? await this.db.select({ caseId: verificationEvidence.caseId, operationId: verificationEvidence.operationId,
      executionId: sideEffectOperations.executionId, executionStepId: sideEffectOperations.executionStepId, policyId: verificationEvidence.policyId,
      actionIntentId: verificationEvidence.actionIntentId, stepActionIntentId: executionSteps.actionIntentId, resultState: verificationEvidence.resultState })
      .from(verificationEvidence)
      .innerJoin(sideEffectOperations, and(eq(sideEffectOperations.id, verificationEvidence.operationId), inArray(sideEffectOperations.executionId, ids), eq(sideEffectOperations.userId, userId)))
      .innerJoin(executionSteps, and(eq(executionSteps.id, sideEffectOperations.executionStepId), eq(executionSteps.executionId, sideEffectOperations.executionId)))
      .where(and(eq(verificationEvidence.userId, userId), inArray(verificationEvidence.caseId, cases.map(row => row.id)))) : [];
    const evaluatedAt = new Date().toISOString();
    for (const run of terminal) views.set(run.id, reflectLoopRun(run, versionId,
      results.filter(row => row.invocation.executionId === run.id), cases.filter(row => row.executionId === run.id),
      evidence.filter(row => row.executionId === run.id), evaluatedAt, steps.filter(row => row.executionId === run.id)));
    return views;
  }
}
