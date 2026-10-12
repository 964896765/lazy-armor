import { describe, expect, it, vi } from 'vitest';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { RequirementsService } from '../src/requirements/requirements.service';

describe('V91 report requirements survive background processing', () => {
  it('snapshots declarations without changing report.goal or treating them as report evidence', () => {
    const goal = '预算8万元，生成报告';
    const context = { userMessages: [{ messageId: 'earlier', quote: '荆门洗车店商业评估' }, { messageId: 'current', quote: goal }] };
    const report = ReportGenerationService.prototype.initial.call({} as never, goal, 2, [], context);
    context.userMessages[0].quote = 'mutated after enqueue';
    expect(report.goal).toBe(goal);
    expect(report.requirementContext?.userMessages[0].quote).toBe('荆门洗车店商业评估');
    expect(report.sources).toEqual([]);
    expect(ReportGenerationService.prototype.initial.call({} as never, goal, 2, []).requirementContext).toBeUndefined();
  });
  it('passes the persisted snapshot to planning and does not force car-wash financials on a new restaurant goal', async () => {
    const goal = '改为餐饮店，生成经营报告';
    const context = { userMessages: [{ messageId: 'earlier', quote: '荆门洗车店评估报告，预算10万元' }, { messageId: 'current', quote: '餐饮店预算8万元' }] };
    const report = ReportGenerationService.prototype.initial.call({} as never, goal, 2, [], context);
    const plan = { title: '餐饮店经营报告', prompt: '基于明确情景形成餐饮分析。'.repeat(15), sections: ['市场', '成本', '风险', '建议'], assumptions: ['未核实客流'], researchQuestions: [], connectionIds: [], financialModel: null };
    const model = { plan: vi.fn(async () => ({ value: plan, modelId: 'fixture' })),
      write: vi.fn(async () => ({ value: { markdown: '餐饮经营情景假设。'.repeat(100) }, modelId: 'fixture' })),
      review: vi.fn(async () => ({ value: { issues: [] }, modelId: 'fixture' })) };
    const saved: Array<Record<string, unknown>> = [];
    const generator = Object.assign(Object.create(ReportGenerationService.prototype), {
      model, connections: { list: vi.fn(async () => []) }, logger: { warn: vi.fn() },
      load: vi.fn(async () => ({ report, conversation: { userId: 'owner' } })),
      save: vi.fn(async (_id: string, previous: typeof report, patch: Record<string, unknown>) => {
        const next = { ...previous, ...patch, revision: previous.revision + 1 }; saved.push(next); return next;
      }),
    }) as ReportGenerationService;
    await generator.process('report-message');
    expect(model.plan).toHaveBeenCalledWith('owner', goal, [], report.requirementContext, expect.objectContaining({ reserve: expect.any(Function), recordUsage: expect.any(Function) }));
    expect(saved.at(-1)).toMatchObject({ stage: 'COMPLETED', goal, sources: [], plan: { financialModel: null } });
    expect(model.write).toHaveBeenCalledTimes(1);
  });
  it('a budget-only regeneration still requires financials from its typed original business scope', async () => {
    const requirements = new RequirementsService();
    const original = requirements.compile({ goalId: 'conversation', version: 1, messageId: 'earlier', intent: '荆门洗车店商业评估报告' });
    const goal = '预算改15万，重新生成报告';
    const goalBrief = requirements.compile({ goalId: 'conversation', version: 2, messageId: 'current', intent: goal, previous: original });
    const context = { goalBrief, userMessages: [{ messageId: 'earlier', quote: original.statement }, { messageId: 'current', quote: goal }] };
    const report = ReportGenerationService.prototype.initial.call({} as never, goal, 2, [], context);
    const model = { plan: vi.fn(async () => ({ value: { title: '评估', prompt: '明确假设。'.repeat(30), sections: ['市场', '成本', '风险', '建议'], assumptions: [], researchQuestions: [], connectionIds: [], financialModel: null }, modelId: 'fixture' })) };
    const saved: Array<Record<string, unknown>> = [];
    const generator = Object.assign(Object.create(ReportGenerationService.prototype), {
      model, connections: { list: vi.fn(async () => []) }, logger: { warn: vi.fn() },
      load: vi.fn(async () => ({ report, conversation: { userId: 'owner' } })),
      save: vi.fn(async (_id: string, previous: typeof report, patch: Record<string, unknown>) => {
        const next = { ...previous, ...patch, revision: previous.revision + 1 }; saved.push(next); return next;
      }),
    }) as ReportGenerationService;
    await generator.process('report-message');
    expect(model.plan).toHaveBeenCalledWith('owner', goal, [], report.requirementContext, expect.objectContaining({ reserve: expect.any(Function), recordUsage: expect.any(Function) }));
    expect(saved.at(-1)).toMatchObject({ stage: 'FAILED', errorCode: 'REPORT_FINANCIAL_MODEL_REQUIRED', goal });
  });
});
