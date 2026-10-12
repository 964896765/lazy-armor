import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveReportMethodInputs } from '@lazy-armor/plan-schema';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import { initialReportBudget, reserveReportCall, recordReportUsage } from '../src/agent/reports/report-budget';
import { methodFixture } from './fixtures/report-method-fixture';
const plan = { title: '学习报告', prompt: '基于明确假设与当前输入形成报告。'.repeat(15), sections: ['目标', '条件', '风险', '研究报告'], assumptions: [], researchQuestions: [], connectionIds: [] };
describe('actual method model request contract', () => {
  afterEach(() => vi.unstubAllGlobals());
  const model = () => new ReportModelService({ resolve: async () => ({ apiKey: 'isolated', model: 'fixture' }) } as unknown as AiProviderConfigService);
  function budget() {
    let saved = initialReportBudget();
    return { get: () => saved, control: { reserve: async () => { const next = reserveReportCall(saved); saved = next.budget; return next; },
      recordUsage: async (usage: unknown) => { saved = recordReportUsage(saved, usage); } } };
  }
  it('sends the exact method schema and actual inputs and charges each corrective request', async () => {
    const composition = methodFixture(), method = composition.methods[0], used = budget();
    const response = (outputs: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outputs, sourceIds: [] }) } }], usage: { total_tokens: 210 } }));
    const fetcher = vi.fn().mockResolvedValueOnce(response({ count: '0', ready: false })).mockResolvedValueOnce(response({ count: 0, ready: false }));
    vi.stubGlobal('fetch', fetcher);
    const inputs = resolveReportMethodInputs(composition, method, []);
    const result = await model().runMethod('owner', composition.snapshot.sourceGoal.statement, plan, composition, method, inputs, [], used.control);
    expect(result.value.outputs).toEqual({ count: 0, ready: false });
    expect(used.get()).toMatchObject({ modelCalls: 2, usageResponses: 2, observedTotalTokens: 420 });
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(JSON.parse(sent.messages[1].content)).toMatchObject({ method: { ref: method.ref }, inputs });
    expect(sent.messages[0].content).toContain('"type":"integer"'); expect(sent.messages[0].content).toContain('"type":"boolean"');
    expect(sent.messages[0].content).toContain('不能扩大权限');
  });
  it('does not turn malformed scalar results into a successful method or unlimited correction loop', async () => {
    const composition = methodFixture(), method = composition.methods[0], used = budget();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outputs: { count: null, ready: 'false', tool: 'execute' }, sourceIds: [] }) } }] })));
    vi.stubGlobal('fetch', fetcher);
    await expect(model().runMethod('owner', composition.snapshot.sourceGoal.statement, plan, composition, method, resolveReportMethodInputs(composition, method, []), [], used.control)).rejects.toThrow('REPORT_METHOD_OUTPUT_INVALID');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(used.get().modelCalls).toBe(2);
  });
});
