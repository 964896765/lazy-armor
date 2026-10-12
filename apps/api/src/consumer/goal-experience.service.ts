import { Injectable, NotFoundException } from '@nestjs/common';
import {
  agentReportSchema, authoringJobProjectionSchema, conversationGenerationOutcome,
  goalBriefSchema, goalExperienceListSchema, goalExperienceSchema,
  type GoalExperience, type GoalExperienceList,
} from '@lazy-armor/plan-schema';
import { ConsumerService } from './consumer.service';

interface ConversationRead {
  id: string; title: string; version: number; mode: string; status?: string; planId: string | null; updatedAt: Date | string;
  messages: Array<{ id: string; requestId: string; role: string; createdAt: Date | string; structuredPayload: Record<string, unknown> | null }>;
  authoringJobs?: unknown[];
}

/** An owner-scoped view of existing Conversation/Message/AuthoringJob authorities; never creates a Goal or authorizes execution. */
export function projectGoalExperience(conversation: ConversationRead, evaluatedAt = new Date().toISOString()): GoalExperience {
  const lastUser = conversation.messages.filter(message => message.role === 'user').at(-1);
  const message = conversation.messages.filter(row => row.role === 'assistant' && (!lastUser || row.requestId === lastUser.requestId)).at(-1);
  const payload = message?.structuredPayload ?? {};
  const parsedJobs = (conversation.authoringJobs ?? []).flatMap(value => { const parsed = authoringJobProjectionSchema.safeParse(value); return parsed.success ? [parsed.data] : []; });
  const matchingJob = parsedJobs.find(job => job.conversationId === conversation.id && (job.resultMessageId === message?.id || job.requestId === lastUser?.requestId));
  const inlineJob = authoringJobProjectionSchema.safeParse(payload.authoringJob);
  const authoringJob = matchingJob ?? (inlineJob.success && inlineJob.data.conversationId === conversation.id ? inlineJob.data : null);
  // A prior request's requirement summary is historical evidence, not the new request's current understanding.
  const parsedBrief = goalBriefSchema.safeParse(payload.goalBrief);
  const goalBrief = parsedBrief.success ? parsedBrief.data : undefined;
  const reportResult = agentReportSchema.safeParse(payload.report);
  const report = reportResult.success ? reportResult.data : null;
  let outcome = conversationGenerationOutcome(typeof payload.result === 'string' ? payload.result : undefined, payload.report, authoringJob ?? payload.authoringJob);
  if (outcome.code === 'PLAN_DRAFT' && conversation.status === 'PLAN_CONFIRMED' && conversation.planId) outcome = { ...outcome, status: '计划已创建', code: 'PLAN_CREATED', stage: 'PLAN_CREATED' };
  if (outcome.code === 'USER_EVENT_DRAFT' && conversation.status === 'USER_EVENT_CONFIRMED') outcome = { ...outcome, status: '个人事项已创建', code: 'EVENT_CREATED', stage: 'EVENT_CREATED' };
  const conversationPath = `/chat?mode=${conversation.mode === 'PLAN' ? 'plan' : 'temporary'}&conversationId=${encodeURIComponent(conversation.id)}`;
  const reportPath = report && message ? `/report?conversationId=${encodeURIComponent(conversation.id)}&messageId=${encodeURIComponent(message.id)}` : null;
  const nextStep = outcome.statusGroup === 'COMPLETED' ? report ? '查看报告、来源与测算假设' : '查看本次答复' : outcome.code === 'PLAN_CREATED' ? '查看计划状态与下一步' : outcome.code === 'EVENT_CREATED' ? '查看事项时间与后续提醒' : outcome.code === 'CLARIFICATION_REQUIRED' ? '补充关键条件后继续' : ['ACTION_PROPOSAL', 'PLAN_DRAFT', 'USER_EVENT_DRAFT'].includes(outcome.code) ? '回到原需求审阅方案' : outcome.code.endsWith('FAILED') || outcome.stage === 'UNKNOWN' || ['MODEL_UNAVAILABLE', 'PLANNER_OUTPUT_INVALID', 'CONTEXT_UNAVAILABLE'].includes(outcome.code) ? '查看原因和原需求，核对后继续' : outcome.code.endsWith('CANCELLED') || outcome.code.endsWith('SUPERSEDED') ? '查看原需求与历史记录' : '查看当前进度；离开页面后任务继续处理';
  const sourceDates = [conversation.updatedAt instanceof Date ? conversation.updatedAt.toISOString() : conversation.updatedAt, report?.updatedAt, authoringJob?.updatedAt].filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)));
  const updatedAt = sourceDates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? (conversation.updatedAt instanceof Date ? conversation.updatedAt.toISOString() : conversation.updatedAt);
  return goalExperienceSchema.parse({
    schemaVersion: 'goal-experience.v1', authority: 'ConversationProjection', readOnly: true,
    conversationId: conversation.id, conversationVersion: conversation.version, planId: conversation.planId,
    title: (goalBrief?.statement || report?.plan?.title || conversation.title || '我的目标').slice(0, 300),
    status: outcome.status, statusGroup: outcome.statusGroup, phase: outcome.phase, stage: outcome.stage, nextStep,
    updatedAt,
    evaluatedAt,
    primaryAction: { label: report ? outcome.statusGroup === 'COMPLETED' ? '查看报告' : '查看报告进度' : outcome.code === 'PLAN_CREATED' ? '查看计划' : '查看目标', path: reportPath ?? (outcome.code === 'PLAN_CREATED' ? `/plans/${conversation.planId}` : conversationPath) },
    conversationAction: { label: '继续原需求', path: conversationPath },
    evidenceRefs: [`conversation:${conversation.id}:${conversation.version}`, ...(message ? [`message:${message.id}`] : []), ...(report && message ? [`report:${message.id}:${report.revision}`] : []), ...(goalBrief ? [`goal-brief:${goalBrief.goalId}:${goalBrief.version}`] : []), ...(authoringJob ? [`authoring-job:${authoringJob.jobId}`] : [])],
    report: report && message ? { messageId: message.id, stage: report.stage, title: report.plan?.title ?? '自主报告', marketFactsVerified: false } : null,
    authoringJob, ...(goalBrief ? { goalBrief } : {}),
  });
}

@Injectable()
export class GoalExperienceService {
  constructor(private readonly consumer: ConsumerService) {}
  async list(userId: string, limit = 10): Promise<GoalExperienceList> {
    const boundedLimit = Math.min(20, Math.max(1, limit));
    // ConsumerService applies owner/deleted/archive filters. No unscoped IDs enter detail reads.
    const conversations = await this.consumer.conversations(userId);
    const rows = conversations.slice(0, boundedLimit);
    const evaluatedAt = new Date().toISOString();
    const results = await Promise.allSettled(rows.map(row => this.get(userId, row.id, evaluatedAt)));
    const items: GoalExperience[] = [];
    const unavailableConversationIds: string[] = [];
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      if (result.status === 'fulfilled') items.push(result.value);
      else unavailableConversationIds.push(rows[index]!.id);
    }
    return goalExperienceListSchema.parse({ schemaVersion: 'goal-experience-list.v1', authority: 'ConversationProjection', readOnly: true, evaluatedAt, items, truncated: conversations.length > boundedLimit, unavailableConversationIds });
  }
  async get(userId: string, conversationId: string, evaluatedAt?: string): Promise<GoalExperience> {
    const conversation = await this.consumer.conversation(userId, conversationId);
    if (!conversation || conversation.id !== conversationId) throw new NotFoundException('目标不存在');
    return projectGoalExperience(conversation as unknown as ConversationRead, evaluatedAt);
  }
}
