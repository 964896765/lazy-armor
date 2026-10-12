import { z } from 'zod';
import { agentReportSchema } from './agent-report';
import { authoringJobProjectionSchema } from './authoring-job';
import { goalBriefSchema } from './goal-brief';

const actionSchema = z.object({ label: z.string().min(1).max(120), path: z.string().min(1).max(600).refine(path => path.startsWith('/') && !path.startsWith('//')) }).strict();
export const goalExperienceSchema = z.object({
  schemaVersion: z.literal('goal-experience.v1'), authority: z.literal('ConversationProjection'), readOnly: z.literal(true),
  conversationId: z.string().uuid(), conversationVersion: z.number().int().nonnegative(), planId: z.string().uuid().nullable(),
  title: z.string().min(1).max(300), status: z.string().max(120), statusGroup: z.enum(['INCOMPLETE', 'COMPLETED']),
  phase: z.enum(['REPORT', 'AUTHORING', 'CONVERSATION']), stage: z.string().max(100),
  nextStep: z.string().max(300), updatedAt: z.iso.datetime(), evaluatedAt: z.iso.datetime(),
  primaryAction: actionSchema, conversationAction: actionSchema, evidenceRefs: z.array(z.string().max(200)).max(20),
  report: z.object({ messageId: z.string().uuid(), stage: agentReportSchema.shape.stage, title: z.string().max(180), marketFactsVerified: z.literal(false) }).strict().nullable(),
  authoringJob: authoringJobProjectionSchema.nullable(),
  goalBrief: goalBriefSchema.optional(),
}).strict();
export type GoalExperience = z.infer<typeof goalExperienceSchema>;
export const goalExperienceListSchema = z.object({
  schemaVersion: z.literal('goal-experience-list.v1'), authority: z.literal('ConversationProjection'), readOnly: z.literal(true),
  evaluatedAt: z.string(), items: z.array(goalExperienceSchema).max(20), truncated: z.boolean(),
  unavailableConversationIds: z.array(z.string().uuid()).max(20),
}).strict();
export type GoalExperienceList = z.infer<typeof goalExperienceListSchema>;

export interface ConversationGenerationOutcome {
  status: string; statusGroup: 'INCOMPLETE' | 'COMPLETED'; code: string;
  phase: GoalExperience['phase']; stage: string;
}
const reportLabels: Record<string, string> = {
  QUEUED: '报告等待生成', PLANNING: '正在整理提示词与提纲', RESEARCHING: '正在读取授权资料',
  COMPOSING: '正在完成能力组合', WRITING: '正在生成报告', REVIEWING: '正在检查报告', COMPLETED: '报告已生成', FAILED: '报告未完成', SUPERSEDED: '报告目标已更新',
};
/** Read-only generation status. A completed authoring job never proves an external action or Goal complete. */
export function conversationGenerationOutcome(result: string | undefined, report?: unknown, authoringJob?: unknown): ConversationGenerationOutcome {
  if (report !== undefined && report !== null) {
    const parsed = agentReportSchema.safeParse(report);
    if (!parsed.success) return { status: '报告状态待核对', statusGroup: 'INCOMPLETE', code: 'REPORT_UNKNOWN', phase: 'REPORT', stage: 'UNKNOWN' };
    const stage = parsed.data.stage;
    if (stage === 'COMPLETED' && !parsed.data.markdown?.trim()) return { status: '报告正文待核对', statusGroup: 'INCOMPLETE', code: 'REPORT_UNKNOWN', phase: 'REPORT', stage: 'UNKNOWN' };
    return { status: reportLabels[stage]!, statusGroup: stage === 'COMPLETED' ? 'COMPLETED' : 'INCOMPLETE', code: `REPORT_${stage}`, phase: 'REPORT', stage };
  }
  if (authoringJob !== undefined && authoringJob !== null) {
    const parsed = authoringJobProjectionSchema.safeParse(authoringJob);
    if (!parsed.success) return { status: '生成任务状态待核对', statusGroup: 'INCOMPLETE', code: 'AUTHORING_UNKNOWN', phase: 'AUTHORING', stage: 'UNKNOWN' };
    const job = parsed.data;
    if (job.status !== 'SUCCEEDED') {
      const labels = { QUEUED: '需求已受理，等待整理', RUNNING: job.stage === 'UNDERSTANDING' ? '正在理解目标' : '正在准备方案', FAILED: '本次方案未生成', CANCELLED: '本次生成已取消', SUPERSEDED: '需求已更新' };
      return { status: labels[job.status], statusGroup: 'INCOMPLETE', code: `AUTHORING_${job.status}`, phase: 'AUTHORING', stage: job.stage };
    }
    if (!result || result === 'AUTHORING_PENDING') return { status: '方案已生成，正在读取结果', statusGroup: 'INCOMPLETE', code: 'AUTHORING_SUCCEEDED', phase: 'AUTHORING', stage: job.stage };
  }
  if (result === 'ANSWER') return { status: '已生成答复', statusGroup: 'COMPLETED', code: 'ANSWER_AVAILABLE', phase: 'CONVERSATION', stage: 'COMPLETED' };
  const labels: Record<string, string> = { ACTION_PROPOSAL: '一次性操作待确认', PLAN_DRAFT: '草案待确认', USER_EVENT_DRAFT: '个人事项待确认', CLARIFICATION_REQUIRED: '需要补充信息', CONTEXT_UNAVAILABLE: '需要更新上下文', MODEL_UNAVAILABLE: '模型暂不可用', PLANNER_OUTPUT_INVALID: '草案校验未通过', AUTHORING_PENDING: '需求已受理，正在整理' };
  return { status: labels[result ?? ''] ?? '正在分析', statusGroup: 'INCOMPLETE', code: result ?? 'PROCESSING', phase: 'CONVERSATION', stage: result ?? 'PROCESSING' };
}
