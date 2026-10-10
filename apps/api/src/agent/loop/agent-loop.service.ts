import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { auditLogs, approvalRequests, capabilityInvocations, executions, executionSteps, plans, planVersions, planTriggers, reconciliationCases, runtimeResults, verificationEvidence, sideEffectOperations } from '@lazy-armor/database';
import { agentLoopState, type AgentLoopProjection, type AgentLoopReflection, type AgentLoopHistoryItem } from '@lazy-armor/plan-schema';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../../common/cursor-pagination';
import { PlansService } from '../../plans/plans.service';
import { PlanControlProjectionService } from '../../plans/plan-control-projection.service';

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
        ['PERSISTENT_NOTIFICATION_RESOURCE_STATE', 'PERSISTENT_NOTIFICATION_RESULT_REEVALUATED', 'PERSISTENT_PLAN_RESULT_REEVALUATED']),
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
    const items: AgentLoopHistoryItem[] = page.items.map(({ createdAt, ...row }) => ({ ...row, planVersionId: versionId, recordedAt: createdAt.toISOString() }));
    return { planVersionId: versionId, items, nextCursor: page.nextCursor };
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
    let reflection: AgentLoopReflection | null = null;
    if (run && versionId && ['succeeded', 'partially_succeeded', 'failed', 'cancelled'].includes(run.status)) {
      const [results, cases] = await Promise.all([
        this.db.select({ invocation: capabilityInvocations, result: runtimeResults }).from(capabilityInvocations).leftJoin(runtimeResults, and(eq(capabilityInvocations.id, runtimeResults.invocationId), eq(runtimeResults.userId, userId)))
          .where(and(eq(capabilityInvocations.userId, userId), eq(capabilityInvocations.executionId, run.id), eq(capabilityInvocations.planVersionId, versionId))),
        this.db.select().from(reconciliationCases).where(and(eq(reconciliationCases.userId, userId), eq(reconciliationCases.executionId, run.id))),
      ]);
      // RESOLVED alone is insufficient: exact committed verification must exist.
      const resolved = cases.filter(row => row.status === 'RESOLVED' && row.resultState === 'SUCCEEDED');
      const evidence = resolved.length ? await this.db.select({ caseId: verificationEvidence.caseId, operationId: verificationEvidence.operationId, actionIntentId: executionSteps.actionIntentId }).from(verificationEvidence)
        .innerJoin(sideEffectOperations, and(eq(sideEffectOperations.id, verificationEvidence.operationId), eq(sideEffectOperations.executionId, run.id), eq(sideEffectOperations.userId, userId)))
        .innerJoin(executionSteps, and(eq(executionSteps.id, sideEffectOperations.executionStepId), eq(executionSteps.executionId, run.id)))
        .where(and(eq(verificationEvidence.userId, userId), eq(verificationEvidence.resultState, 'SUCCEEDED'), inArray(verificationEvidence.caseId, resolved.map(row => row.id)))) : [];
      const verified = results.filter(row => row.result?.verificationState === 'VERIFIED' && row.result.evidenceRefs.length > 0);
      const reconciled = resolved.length > 0 && results.length > 0 && cases.length === resolved.length &&
        resolved.every(row => evidence.some(item => item.caseId === row.id && item.operationId === row.operationId)) && results.every(row =>
          verified.includes(row) || Boolean(row.invocation.actionIntentId && evidence.some(item => item.actionIntentId === row.invocation.actionIntentId)));
      const unknown = !reconciled && (run.errorCode === 'OUTCOME_UNKNOWN' || results.some(row => row.result?.verificationState === 'OUTCOME_UNKNOWN'));
      const outcome = reconciled ? 'VERIFIED' : unknown ? 'UNKNOWN' : run.status === 'cancelled' ? 'CANCELLED' :
        run.status !== 'succeeded' ? 'FAILED' : results.length > 0 && verified.length === results.length ? 'VERIFIED' : 'UNVERIFIED';
      reflection = { executionId: run.id, planVersionId: versionId, recordedStatus: run.status, outcome,
        verifiedResultCount: reconciled ? evidence.length : verified.length, evaluatedAt: new Date().toISOString() };
    }
    const watch = 'notificationWatchState' in projection ? projection.notificationWatchState : undefined;
    return { schemaVersion: 'agent-loop.v1', planId, planVersionId: versionId ?? null, title: versions[0]?.name ?? '持续计划',
      state: agentLoopState({ planStatus: summary.status, resourceAvailable: !summary.hasMissingConnection,
        approvalPending: approvals.length > 0 || run?.status === 'waiting_approval',
        reconciliationPending: unknowns.length > 0 || (run?.errorCode === 'OUTCOME_UNKNOWN' && reflection?.outcome !== 'VERIFIED'),
        runStatus: run?.status, outcome: reflection?.outcome, observationState: watch?.state }),
      nextRunAt: summary.status === 'active' ? summary.nextExpectedRunAt : null,
      triggerModes: [...new Set(triggers.map(trigger => trigger.triggerType))], reflection,
      asOf: new Date().toISOString(), executionAuthorized: false };
  }
}
