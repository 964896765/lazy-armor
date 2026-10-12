import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentReportSchema } from '@lazy-armor/plan-schema';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';

describe('corrected report final review retains its task budget', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('does not make the fifth provider request after planning, writing, review and correction exhaust the saved budget', async () => {
    const plan = { title: '学习报告', prompt: '依据明确假设与条件写作。'.repeat(15), sections: ['目标', '条件', '风险', '建议'], assumptions: [], researchQuestions: [], connectionIds: [] };
    const markdown = plan.sections.join('\n') + '\n错误口径\n' + '学习安排需要观察验证。'.repeat(100);
    const values = [plan, { markdown }, { findings: [{ kind: 'BLOCKING_ERROR', explanation: '需要修订错误口径', evidence: '错误口径' }] }, { markdown }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(values.shift()) } }], usage: { total_tokens: 100 } })));
    vi.stubGlobal('fetch', fetcher);
    const model = new ReportModelService({ resolve: async () => ({ apiKey: 'isolated', model: 'fixture' }) } as unknown as AiProviderConfigService);
    const initial = ReportGenerationService.prototype.initial.call({} as never, '生成学习分析报告', 1, []);
    initial.budget!.maxModelCalls = 4;
    let saved = initial;
    const generator = Object.assign(Object.create(ReportGenerationService.prototype), { model,
      connections: { list: async () => [] }, logger: { warn: vi.fn() },
      load: async () => ({ report: initial, conversation: { id: 'isolated', userId: 'owner' } }),
      save: async (_id: string, previous: typeof initial, patch: Partial<typeof initial>) => {
        saved = agentReportSchema.parse({ ...previous, ...patch, revision: previous.revision + 1 }); return saved;
      },
    }) as ReportGenerationService;
    await generator.process('isolated-report');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(saved).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_BUDGET_MODEL_LIMIT', budget: { modelCalls: 4, usageResponses: 4, observedTotalTokens: 400 } });
  });
});
