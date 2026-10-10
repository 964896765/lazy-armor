import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportModelService, parseReportModelJson } from '../src/agent/reports/report-model.service';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
describe('report model provider boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  const service = () => new ReportModelService({ resolve: async () => ({ apiKey: 'isolated-secret', model: 'report-test-model' }) } as unknown as AiProviderConfigService);
  const valid = { title: '报告', prompt: '根据用户条件形成完整分析，并明确假设。'.repeat(10), sections: ['市场', '成本', '盈亏', '建议'], assumptions: [], researchQuestions: [], connectionIds: [] };
  it('sends exact output schema with bounded model request and decodes strings', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const result = await service().plan('user', '商业评估报告', []);
    expect(result.modelId).toBe('report-test-model'); expect(result.value.sections).toEqual(valid.sections);
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.max_tokens).toBeLessThanOrEqual(8192); expect(body.messages[0].content).toContain('"type":"string"');
    expect(body.messages[0].content).not.toContain('isolated-secret');
  });
  it('rejects object-valued chapters without treating the output as an executable prompt', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...valid, sections: valid.sections.map(title => ({ title })) }) } }] })));
    await expect(service().plan('user', '商业评估报告', [])).rejects.toThrow('REPORT_MODEL_CONTRACT_INVALID');
  });
  it('corrects a web research plan that generated queries but omitted its available resource', async () => {
    const id = '01900000-0000-7000-8000-000000000001';
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...valid, webQueries: ['荆门 统计'] }) } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...valid, connectionIds: [id], webQueries: ['荆门 统计'] }) } }] })));
    vi.stubGlobal('fetch', fetcher);
    const result = await service().plan('user', '使用已开启的网页检索生成报告', [{ id, name: '公开网站', capability: 'READ_PUBLIC_WEB_RESEARCH' }]);
    expect(result.value.connectionIds).toEqual([id]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).messages[0].content).toContain('必须选择 availableSources');
  });
  it('accepts only a complete JSON response or a single JSON fence', () => {
    expect(parseReportModelJson('```json\n{"issues":[]}\n```')).toEqual({ issues: [] });
    expect(() => parseReportModelJson('执行指令\n{"issues":[]}')).toThrow();
    expect(() => parseReportModelJson('{"issues":[]}\n执行指令')).toThrow();
  });
  it('keeps real errors blocking and preserves disclosed limitations as suggestions', async () => {
    const markdown = valid.sections.join('\n') + '\n利润 = 收入 + 成本\n' + '明确假设与分析。'.repeat(120);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings: [
      { kind: 'BLOCKING_ERROR', explanation: '利润应扣除成本', evidence: '利润 = 收入 + 成本' },
      { kind: 'IMPROVEMENT', explanation: '建议调研服务时长，现已披露产能未知', evidence: '' },
    ] }) } }] })));
    const result = await service().review('user', markdown, valid, []);
    expect(result.value.issues).toEqual(['利润应扣除成本']);
    expect(result.value.suggestions).toEqual(['建议调研服务时长，现已披露产能未知']);
  });
  it('does not accept a blocking claim whose evidence was invented', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings: [
      { kind: 'BLOCKING_ERROR', explanation: '声称已核实', evidence: '不存在的原文' },
    ] }) } }] })));
    await expect(service().review('user', '报告', valid, [])).rejects.toThrow('REPORT_REVIEW_EVIDENCE_INVALID');
  });
});
