import { authoringJobProjectionSchema, goalBriefSchema, goalExperienceListSchema, type WorkItemProjection } from '@lazy-armor/plan-schema/mobile';

const fieldLabels = { goal: '目标', motivation: '为什么做', currentState: '当前情况', resources: '已有资源', constraints: '限制', timeframe: '时间', budget: '预算', location: '地点', successCriteria: '成功标准', riskPreference: '风险偏好' };
export function presentGoalBrief(raw: unknown) {
  const parsed = goalBriefSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  return {
    title: value.statement,
    known: value.fields.filter(field => field.key !== 'goal' && ['USER_STATED', 'CONFIRMED'].includes(field.status)).map(field => `${fieldLabels[field.key]}：${field.value}`),
    assumptions: value.fields.filter(field => field.status === 'ASSUMPTION').map(field => `${fieldLabels[field.key]}：${field.value}`),
    questions: value.readiness.questions.map(item => item.question),
    unknown: value.fields.filter(field => field.status === 'UNKNOWN').map(field => fieldLabels[field.key]),
    ready: value.readiness.state === 'READY_FOR_PROPOSAL',
  };
}
export function presentAuthoringJob(raw: unknown) {
  const parsed = authoringJobProjectionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const job = parsed.data;
  const labels = { QUEUED: '需求已受理，等待整理', RUNNING: job.stage === 'UNDERSTANDING' ? '正在理解目标' : '正在准备方案', SUCCEEDED: '本次方案已生成', FAILED: '本次方案未生成', CANCELLED: '本次生成已取消', SUPERSEDED: '需求已更新' };
  return { label: labels[job.status], pending: ['QUEUED', 'RUNNING'].includes(job.status), failed: job.status === 'FAILED' };
}
export function parseGoalExperience(raw: unknown) {
  const parsed = goalExperienceListSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
/** Routes open existing authority surfaces only; no proposed next action is executed by this view. */
export function actionableWorkItems(items: readonly WorkItemProjection[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!['ASK_USER', 'CONNECT_RESOURCE', 'REQUEST_APPROVAL', 'RECONCILE'].includes(item.nextAction)) return false;
    const path = item.primaryAction?.path;
    if (!path?.startsWith('/') || path.startsWith('//') || seen.has(`${item.sourceRef.type}:${item.sourceRef.id}`)) return false;
    seen.add(`${item.sourceRef.type}:${item.sourceRef.id}`);
    return true;
  }).slice(0, 5);
}
