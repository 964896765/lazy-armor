import { describe, expect, it, vi, afterEach } from 'vitest';
import { initialReportBudget, reserveReportCall, recordReportUsage } from '../src/agent/reports/report-budget';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';

describe('persisted report model budget', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('retains consumed reservations on recovery and rejects the next call at the limit', () => {
    let budget = initialReportBudget(1000);
    for (let i = 0; i < 16; i++) budget = reserveReportCall(budget, 1001).budget;
    const restored = JSON.parse(JSON.stringify(budget));
    expect(restored).toMatchObject({ modelCalls: 16, reservedOutputTokens: 131072, costStatus: 'NOT_PRICED' });
    expect(() => reserveReportCall(restored, 1002)).toThrow('REPORT_BUDGET_MODEL_LIMIT');
  });
  it('rejects expired work and bounds an in-flight request by remaining time', () => {
    const budget = initialReportBudget(1000), deadline = Date.parse(budget.deadlineAt);
    expect(reserveReportCall(budget, deadline - 12).timeoutMs).toBe(12);
    expect(() => reserveReportCall(budget, deadline)).toThrow('REPORT_BUDGET_DEADLINE');
  });
  it('does not invent usage or prices when provider usage is missing', () => {
    const budget = initialReportBudget();
    expect(recordReportUsage(budget, undefined)).toBe(budget);
    expect(recordReportUsage(budget, { total_tokens: -1 })).toBe(budget);
    expect(recordReportUsage(budget, { total_tokens: 251 })).toMatchObject({ observedTotalTokens: 251, usageResponses: 1, costStatus: 'NOT_PRICED' });
  });
  it('reserves each actual provider attempt including invalid JSON and records its real usage', async () => {
    const valid = { title: '报告', prompt: '明确假设，提出完整分析。'.repeat(12), sections: ['市场', '成本', '风险', '建议'], assumptions: [], researchQuestions: [], connectionIds: [] };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'invalid' } }], usage: { total_tokens: 110 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }], usage: { total_tokens: 220 } })));
    vi.stubGlobal('fetch', fetcher);
    let persisted = initialReportBudget();
    const control = { reserve: async () => { const next = reserveReportCall(persisted); persisted = next.budget; return next; },
      recordUsage: async (usage: unknown) => { persisted = recordReportUsage(persisted, usage); } };
    const service = new ReportModelService({ resolve: async () => ({ apiKey: 'test', model: 'fixture' }) } as unknown as AiProviderConfigService);
    await service.plan('owner', '生成分析报告', [], undefined, control);
    expect(persisted).toMatchObject({ modelCalls: 2, reservedOutputTokens: 16384, observedTotalTokens: 330, usageResponses: 2 });
    persisted = { ...persisted, maxModelCalls: 2 };
    await expect(service.plan('owner', '生成分析报告', [], undefined, control)).rejects.toThrow('REPORT_BUDGET_MODEL_LIMIT');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
