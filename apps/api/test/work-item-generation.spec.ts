import { describe, expect, it, vi } from 'vitest';
import { consumerMessages } from '@lazy-armor/database';
import { WorkItemProjectionService } from '../src/consumer/work-item-projection.service';
vi.mock('../src/consumer/consumer.service', () => ({ ConsumerService: class ConsumerService {} }));
vi.mock('../src/consumer/plan-state-assessment.service', () => ({ PlanStateAssessmentService: class PlanStateAssessmentService {} }));
vi.mock('../src/plans/lifecycle-read.service', () => ({ LifecycleReadService: class LifecycleReadService {} }));
vi.mock('../src/creation-drafts/draft-gap-projection.service', () => ({ DraftGapProjectionService: class DraftGapProjectionService {} }));
const now = new Date('2026-10-11T00:00:00.000Z');
const conversationId = '01a12549-5915-7043-b5f3-ee6258827525';
const messageId = '01a12549-5915-7043-b5f3-ee6258827526';
describe('Work item autonomous report delivery', () => {
  it.each(['QUEUED', 'WRITING', 'REVIEWING', 'FAILED', 'COMPLETED'])('opens the original report and preserves its %s status', async stage => {
    const rows = [{ conversation: { id: conversationId, title: '洗车店评估' }, message: { id: messageId, content: '已开始生成', createdAt: now, structuredPayload: { result: 'ANSWER', report: { version: 'agent-report.v1', revision: 1, stage, goal: '洗车店评估', conversationVersion: 1, sources: [], warnings: [], markdown: stage === 'COMPLETED' ? '完整报告，市场参数尚待核实' : undefined, updatedAt: now.toISOString() } } } }];
    const db = { select: () => ({ from: (table: unknown) => { const chain = { where: () => chain, innerJoin: () => chain, orderBy: () => chain, limit: async () => table === consumerMessages ? rows : [] }; return chain; } }) };
    const consumer = { planLibrary: async () => ({ plans: [] }), requests: async () => [] };
    const service = new WorkItemProjectionService(db as never, consumer as never, { project: async () => [] } as never, {} as never, {} as never);
    const result = await service.project('owner');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'ConversationResult', status: `REPORT_${stage}`, nextAction: stage === 'COMPLETED' ? 'COMPLETE' : 'WAIT', primaryAction: { path: `/report?conversationId=${conversationId}&messageId=${messageId}` } });
  });
});
