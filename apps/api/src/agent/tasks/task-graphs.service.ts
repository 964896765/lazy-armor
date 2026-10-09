import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { agentTaskGraphs, agentTasks, executions, executionSteps, plans, reconciliationCases, sideEffectOperations } from '@lazy-armor/database';
import { taskStatusFromRuntime, type AgentTaskProjection, type TaskGraphProjection, type TaskStatus } from '@lazy-armor/plan-schema';
import { and, asc, desc, eq, lt, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { decodeCursor, pageResult, type CursorPageDto } from '../../common/cursor-pagination';

@Injectable()
export class TaskGraphsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async listForPlan(userId: string, planId: string, query: CursorPageDto) {
    const plan = (await this.db.select({ id: plans.id }).from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))))[0];
    if (!plan) throw new NotFoundException('Plan not found');
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.select().from(agentTaskGraphs).where(and(eq(agentTaskGraphs.userId, userId), eq(agentTaskGraphs.planId, planId),
      cursor ? or(lt(agentTaskGraphs.createdAt, cursor.createdAt), and(eq(agentTaskGraphs.createdAt, cursor.createdAt), lt(agentTaskGraphs.id, cursor.id))) : undefined))
      .orderBy(desc(agentTaskGraphs.createdAt), desc(agentTaskGraphs.id)).limit(query.limit + 1);
    const page = pageResult(rows, query.limit);
    return { items: await Promise.all(page.items.map(row => this.get(userId, row.id))), nextCursor: page.nextCursor };
  }

  async get(userId: string, graphId: string): Promise<TaskGraphProjection> {
    return this.db.transaction(async tx => {
      const graph = (await tx.select().from(agentTaskGraphs).where(and(eq(agentTaskGraphs.id, graphId), eq(agentTaskGraphs.userId, userId))))[0];
      if (!graph) throw new NotFoundException('Task graph not found');
      const execution = (await tx.select().from(executions).where(and(eq(executions.id, graph.executionId), eq(executions.userId, userId))))[0];
      if (!execution) throw new NotFoundException('Execution not found');
      const plan = graph.planId ? (await tx.select().from(plans).where(and(eq(plans.id, graph.planId), eq(plans.userId, userId))))[0] : null;
      const steps = await tx.select().from(executionSteps).where(eq(executionSteps.executionId, execution.id));
      const rows = await tx.select().from(agentTasks).where(eq(agentTasks.graphId, graph.id)).orderBy(asc(agentTasks.taskOrder));
      const operations = await tx.select().from(sideEffectOperations).where(eq(sideEffectOperations.executionId, execution.id));
      const cases = await tx.select().from(reconciliationCases).where(eq(reconciliationCases.executionId, execution.id));
      const tasks: AgentTaskProjection[] = rows.filter(row => row.executionStepId).map(row => {
        const step = steps.find(item => item.id === row.executionStepId)!;
        const operation = operations.find(item => item.executionStepId === step.id);
        const resolved = operation && cases.find(item => item.operationId === operation.id && item.status === 'RESOLVED');
        const resultState = resolved ? resolved.resultState : operation?.status === 'outcome_unknown' ? 'OUTCOME_UNKNOWN' : null;
        let status = taskStatusFromRuntime({ executionStatus: execution.status, stepStatus: step.status,
          errorCode: resolved ? null : step.errorCode, resultState });
        let waitReason: AgentTaskProjection['waitReason'] = null;
        if (step.status === 'pending') {
          const dependenciesDone = row.dependsOnJson.every(id => {
            const dependency = rows.find(item => item.id === id);
            return steps.find(item => item.id === dependency?.executionStepId)?.status === 'succeeded';
          });
          if (!dependenciesDone) { status = 'WAITING'; waitReason = 'DEPENDENCY'; }
          else if (execution.status === 'waiting_approval') { status = 'WAITING'; waitReason = 'APPROVAL'; }
          else if (['queued', 'running'].includes(execution.status)) status = 'READY';
        }
        if (status === 'WAITING' && !waitReason) waitReason = step.status === 'retry_wait' ? 'RETRY' : 'RUNTIME';
        return { id: row.id, parentTaskId: row.parentTaskId, executionStepId: step.id, title: row.title,
          status, recordedStatus: row.status as TaskStatus, runtimeStatus: step.status, priority: row.priority,
          dependsOn: row.dependsOnJson, retryCount: step.retryCount, skipped: step.status === 'skipped', waitReason };
      });
      let status = taskStatusFromRuntime({ executionStatus: execution.status, errorCode: execution.errorCode });
      if (tasks.some(task => task.status === 'UNKNOWN')) status = 'UNKNOWN';
      else if (['succeeded', 'partially_succeeded', 'failed'].includes(execution.status) && tasks.length && tasks.every(task => task.status === 'SUCCESS' && !task.skipped)) status = 'SUCCESS';
      const root = rows.find(row => !row.executionStepId);
      if (root) tasks.unshift({ id: root.id, parentTaskId: null, executionStepId: null, title: root.title, status,
        recordedStatus: root.status as TaskStatus, runtimeStatus: execution.status, priority: root.priority,
        dependsOn: [], retryCount: Math.max(0, ...tasks.map(task => task.retryCount)), skipped: false,
        waitReason: status === 'WAITING' ? execution.status === 'waiting_approval' ? 'APPROVAL' : execution.status === 'retry_wait' ? 'RETRY' : 'RUNTIME' : null });
      return { id: graph.id, planId: graph.planId, planVersionId: graph.planVersionId, executionId: execution.id,
        status, recordedStatus: graph.status as TaskStatus, runtimeStatus: execution.status, planPaused: plan?.status === 'paused',
        createdAt: graph.createdAt.toISOString(), updatedAt: graph.updatedAt.toISOString(),
        historical: Boolean(plan && graph.planVersionId !== (plan.activeVersionId ?? plan.currentVersionId)), tasks };
    });
  }
}
