import { consumerConversations, consumerMessages } from '@lazy-armor/database';
import { agentReportSchema, catalogHash, goalBriefSchema, type PersonalMemory } from '@lazy-armor/plan-schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { LearningTransaction } from './learning-source';

export async function readDecisionReport(tx: LearningTransaction, userId: string, conversationId: string, messageId: string, lock = false) {
  const conversationQuery = tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt)));
  const conversation = (await (lock ? conversationQuery.for('update') : conversationQuery))[0];
  if (!conversation) return null;
  const messageQuery = tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, messageId), eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.role, 'assistant')));
  const message = (await (lock ? messageQuery.for('update') : messageQuery))[0];
  const report = agentReportSchema.safeParse(message?.structuredPayload?.report);
  if (!message || !report.success || report.data.stage !== 'COMPLETED' || !report.data.markdown || !report.data.review) return null;
  const brief = goalBriefSchema.safeParse(report.data.requirementContext?.goalBrief ?? message.structuredPayload?.goalBrief);
  if ((report.data.requirementContext?.goalBrief || message.structuredPayload?.goalBrief) && !brief.success) return null;
  return { report: report.data, ref: { kind: 'REPORT_DECISION' as const, conversationId, messageId, reportRevision: report.data.revision,
    reportHash: catalogHash(report.data), goalId: brief.success ? brief.data.goalId : null, goalVersion: brief.success ? brief.data.version : null } };
}

export async function reportDecisionSourceCurrent(tx: LearningTransaction, userId: string, ref: PersonalMemory['sourceRef'], lock = false) {
  if (!ref || !('kind' in ref) || ref.kind !== 'REPORT_DECISION') return false;
  const source = await readDecisionReport(tx, userId, ref.conversationId, ref.messageId, lock);
  return Boolean(source && catalogHash(source.ref) === catalogHash(ref));
}
