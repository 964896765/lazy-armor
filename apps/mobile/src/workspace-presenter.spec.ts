import { describe, expect, it } from 'vitest';
import { workspaceConversation } from './workspace-presenter';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const report = (stage: string) => ({ version: 'agent-report.v1', revision: 1, stage, goal: '研究目标', conversationVersion: 1, sources: [], warnings: [], markdown: '测算假设，市场待核实', updatedAt: '2026-10-12T03:00:00.000Z' });
describe('workspace owned conversation and report history', () => {
  it('keeps failed and older completed reports distinct instead of treating any report as current success', () => {
    const view = workspaceConversation({ id: a, version: 2, mode: 'TEMPORARY', messages: [
      { id: a, role: 'assistant', content: '已生成', structuredPayload: { result: 'ANSWER', report: report('COMPLETED') } },
      { id: b, role: 'assistant', content: '未生成', structuredPayload: { result: 'ANSWER', report: report('FAILED') } },
    ] }, a);
    expect(view?.reports.map(item => item.status)).toEqual(['报告未完成', '报告已生成']); expect(view?.answer).toBeNull();
  });
  it('rejects a different conversation and reports unavailable formats without hiding them behind an answer', () => {
    const value = { id: a, version: 1, mode: 'TEMPORARY', messages: [{ id: b, role: 'assistant', content: '不可误当完整成果', structuredPayload: { result: 'ANSWER', report: { stage: 'COMPLETED' } } }] };
    expect(workspaceConversation(value, b)).toBeNull();
    expect(workspaceConversation(value, a)).toMatchObject({ reports: [], unavailableReports: 1, answer: null });
  });
});
