import { agentTaskGraphs, agentTasks, executions, executionSteps } from '@lazy-armor/database';
import { canTransitionTask, taskStatusFromRuntime, type TaskStatus } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { asc, eq } from 'drizzle-orm';
import type { InjectedDatabase } from '../../common/database.module';

type TaskTransaction = Pick<InjectedDatabase, 'select' | 'insert' | 'update'>;

/** Called only inside validated dispatch's transaction, after frozen steps exist. */
export async function materializeTaskGraph(tx: TaskTransaction, executionId: string) {
  const execution = (await tx.select().from(executions).where(eq(executions.id, executionId)))[0];
  if (!execution) throw new Error('Task graph requires an existing authorized Execution');
  const steps = await tx.select().from(executionSteps).where(eq(executionSteps.executionId, executionId)).orderBy(asc(executionSteps.stepOrder));
  const graphId = newId();
  const rootId = newId();
  const now = new Date();
  await tx.insert(agentTaskGraphs).values({ id: graphId, userId: execution.userId, planId: execution.planId,
    planVersionId: execution.planVersionId, executionId, status: 'CREATED', createdAt: now, updatedAt: now });
  await tx.insert(agentTasks).values({ id: rootId, graphId, parentTaskId: null, executionStepId: null, taskOrder: 0,
    title: '本次运行', status: 'CREATED', priority: 5, dependsOnJson: [], retryCount: 0,
    resourceLock: `execution:${executionId}`, createdAt: now, updatedAt: now });
  let previousId: string | null = null;
  for (const [index, step] of steps.entries()) {
    const id = newId();
    await tx.insert(agentTasks).values({ id, graphId, parentTaskId: rootId, executionStepId: step.id, taskOrder: index + 1,
      title: taskTitle(step.requiredCapability ?? step.actionType, index), status: 'CREATED', priority: 5,
      dependsOnJson: previousId ? [previousId] : [], retryCount: 0,
      resourceLock: `execution:${executionId}`, createdAt: now, updatedAt: now });
    previousId = id;
  }
}

/** Runs after the existing owner fence, in the SAME Runtime transaction. */
export async function syncTaskSnapshots(tx: TaskTransaction, executionId: string) {
  const graph = (await tx.select().from(agentTaskGraphs).where(eq(agentTaskGraphs.executionId, executionId)))[0];
  if (!graph) return; // Pre-migration history is never fabricated or backfilled by reads.
  const execution = (await tx.select().from(executions).where(eq(executions.id, executionId)))[0];
  if (!execution) throw new Error('Task graph Execution missing');
  const steps = await tx.select().from(executionSteps).where(eq(executionSteps.executionId, executionId));
  const tasks = await tx.select().from(agentTasks).where(eq(agentTasks.graphId, graph.id));
  const unknown = execution.errorCode === 'OUTCOME_UNKNOWN' || steps.some(step => step.errorCode === 'OUTCOME_UNKNOWN');
  const graphStatus = taskStatusFromRuntime({ executionStatus: execution.status, errorCode: unknown ? 'OUTCOME_UNKNOWN' : null });
  const now = new Date();
  if (graph.status !== graphStatus && canTransitionTask(graph.status as TaskStatus, graphStatus)) {
    await tx.update(agentTaskGraphs).set({ status: graphStatus, updatedAt: now }).where(eq(agentTaskGraphs.id, graph.id));
  }
  for (const task of tasks) {
    const step = steps.find(item => item.id === task.executionStepId);
    const status = task.executionStepId ? step && taskStatusFromRuntime({ executionStatus: execution.status,
      stepStatus: step.status, errorCode: step.errorCode, approvalPending: step.status === 'pending' && execution.status === 'waiting_approval' }) : graphStatus;
    if (status && !['UNKNOWN', 'SUCCESS', 'FAILED', 'CANCELLED'].includes(task.status) &&
      (status !== task.status || step?.retryCount !== task.retryCount) && canTransitionTask(task.status as TaskStatus, status)) {
      await tx.update(agentTasks).set({ status, retryCount: step?.retryCount ?? task.retryCount, updatedAt: now }).where(eq(agentTasks.id, task.id));
    }
  }
}

function taskTitle(capability: string, index: number) {
  const labels: Record<string, string> = { 'calendar.event.read': '读取日程', 'calendar.read': '读取日程',
    'calendar.event.create': '添加日历事项', 'calendar.event.update': '更新日历事项', 'calendar.event.delete': '删除外部日历事项',
    'notification.read': '读取已授权通知', 'notification.send': '发送提醒', 'notification': '发送提醒', 'send_notification': '发送提醒' };
  return labels[capability] ?? `执行第 ${index + 1} 项`;
}
