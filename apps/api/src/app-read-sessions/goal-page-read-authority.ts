import { ConflictException, NotFoundException } from '@nestjs/common';
import { consumerConversations, consumerMessages } from '@lazy-armor/database';
import { catalogHash, goalPageReadSchema, goalUnderstandingSchema, type FrozenGoalPageRead } from '@lazy-armor/plan-schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { RealityExecutor } from '../reality-pipeline/reality-pipeline.service';
import { createHash } from 'node:crypto';

export function goalPageSessionId(userId: string, messageId: string) {
  const bytes = createHash('sha256').update('goal-page-session:' + userId + ':' + messageId).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Lock the original goal when freezing consent or committing observed evidence. */
export async function savedGoalPageRead(store: RealityExecutor, userId: string,
  ref: { conversationId: string; messageId: string; conversationVersion: number }, lock = false) {
  const query = store.select().from(consumerConversations).where(and(eq(consumerConversations.id, ref.conversationId),
    eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).limit(1);
  const conversation = (await (lock ? query.for('update') : query))[0];
  if (!conversation) throw new NotFoundException('会话不存在');
  if (conversation.mode !== 'TEMPORARY' || conversation.archivedAt || conversation.status !== 'ACTIVE'
    || conversation.version !== ref.conversationVersion) throw new ConflictException('页面读取目标已更新，请回到原会话');
  const messageQuery = store.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, ref.conversationId),
    eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt), desc(consumerMessages.id)).limit(1);
  const message = (await (lock ? messageQuery.for('update') : messageQuery))[0];
  const proposal = goalPageReadSchema.safeParse(message?.structuredPayload?.pageRead);
  const understanding = goalUnderstandingSchema.safeParse(message?.structuredPayload?.understanding);
  if (!message || message.id !== ref.messageId || message.structuredPayload?.result !== 'ANSWER'
    || !proposal.success || !understanding.success || understanding.data.lifecycle !== 'TEMPORARY'
    || understanding.data.proposalId !== message.structuredPayload.proposalId) throw new ConflictException('请确认当前有效的页面读取建议');
  const frozen: FrozenGoalPageRead = { ...ref, proposalId: understanding.data.proposalId, proposalHash: catalogHash(message.structuredPayload) };
  return { proposal: proposal.data, frozen };
}

export async function assertGoalPageReadCurrent(store: RealityExecutor, userId: string, ref: FrozenGoalPageRead, lock = false) {
  const saved = await savedGoalPageRead(store, userId, ref, lock);
  if (saved.frozen.proposalHash !== ref.proposalHash || saved.frozen.proposalId !== ref.proposalId) throw new ConflictException('原页面读取建议已变化');
  return saved;
}
