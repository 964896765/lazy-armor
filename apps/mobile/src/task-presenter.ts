import type { AgentTaskProjection, TaskGraphProjection, TaskStatus } from '@lazy-armor/plan-schema/mobile';

const labels: Record<TaskStatus, string> = { CREATED: '准备中', READY: '排队中', RUNNING: '处理中', WAITING: '等待中',
  SUCCESS: '已完成', FAILED: '未完成', UNKNOWN: '结果待核对', CANCELLED: '已取消' };
export function taskStatusLabel(status: TaskStatus) { return labels[status] ?? '状态待读取'; }
export function taskDetail(task: AgentTaskProjection) {
  if (task.skipped) return '本次未执行';
  if (task.status === 'UNKNOWN') return '正在核对实际结果';
  const reasons = { APPROVAL: '等待你的审批', DEPENDENCY: '等待前一项完成', RUNTIME: '等待执行恢复', RETRY: '等待受控重试', PLAN_PAUSED: '计划已暂停' };
  return task.waitReason ? reasons[task.waitReason] : taskStatusLabel(task.status);
}
export function taskGraphDetail(graph: TaskGraphProjection) {
  const steps = graph.tasks.filter(task => task.executionStepId);
  const completed = steps.filter(task => task.status === 'SUCCESS' && !task.skipped).length;
  return `${taskStatusLabel(graph.status)} · ${completed}/${steps.length} 项完成${graph.historical ? ' · 较早版本' : ''}`;
}
