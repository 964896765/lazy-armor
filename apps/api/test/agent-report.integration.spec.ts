import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { bootP2App, register, auth, type Session } from './p2-test-helpers';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import { ConnectionsService } from '../src/connections/connections.service';
import { reportTerminal } from '@lazy-armor/plan-schema';

describe.sequential('autonomous report through original conversation', { timeout: 90000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, generator: ReportGenerationService;
  const plan = { title: '商业评估报告', prompt: '根据用户条件形成完整评估，数字不足采用清晰假设。'.repeat(10), sections: ['市场', '成本', '盈亏', '建议'], assumptions: ['成本是测算假设'], researchQuestions: ['租金待实地核验'], connectionIds: [], financialModel: { operatingDays: 30, startupCosts: [{ name: '投入', yuan: 60000 }], fixedMonthlyCosts: [{ name: '成本', yuan: 9000 }], monthlyDepreciationYuan: 1000, scenarios: [10,20,30].map(carsPerDay => ({ name: String(carsPerDay), carsPerDay, washPriceYuan: 30, washVariableYuan: 6, beautyConversion: 0.1, beautyPriceYuan: 100, beautyVariableRate: 0.4 })) } };
  const markdown = '# 市场\n# 成本\n# 盈亏\n# 建议\n' + '这是一份隔离测试正文，使用测算假设，具体市场事实需要核实。'.repeat(60);
  beforeAll(async () => {
    const unique = `report-${Date.now()}`; ({ app, pool } = await bootP2App(unique));
    owner = await register(app, `${unique}@example.com`, '报告测试'); other = await register(app, `${unique}-other@example.com`, '另一用户');
    generator = app.get(ReportGenerationService);
    vi.spyOn(app.get(ConnectionsService), 'list').mockResolvedValue([]);
    vi.spyOn(app.get(ReportModelService), 'plan').mockResolvedValue({ value: plan, modelId: 'isolated-report-fixture' });
    vi.spyOn(app.get(ReportModelService), 'write').mockResolvedValue({ value: { markdown }, modelId: 'isolated-report-fixture' });
    vi.spyOn(app.get(ReportModelService), 'review').mockResolvedValue({ value: { issues: [] }, modelId: 'isolated-report-fixture' });
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  async function start(requestId: string) {
    const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', title: '洗车评估' }).expect(201)).body;
    const input = { content: '在湖北荆门开洗车店的商业评估报告，按两工位租赁店测算', version: 0, requestId };
    const posted = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send(input).expect(201)).body;
    const message = posted.messages.find((m: { role: string }) => m.role === 'assistant');
    return { conversation, posted, message, input };
  }
  it('returns promptly with durable job identity and completes prompt, draft and review without Truth', async () => {
    const flow = await start('report-complete'); expect(flow.message.structuredPayload.report.stage).toBe('QUEUED');
    await generator.process(flow.message.id);
    const result = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(owner.token)).expect(200)).body;
    const report = result.messages.find((m: { id: string }) => m.id === flow.message.id).structuredPayload.report;
    expect(report.stage).toBe('COMPLETED'); expect(report.plan.prompt).toBe(plan.prompt); expect(report.markdown).toContain(markdown);
    expect(report.markdown).toContain('24000.00'); expect(report.sources[0].provenance).toBe('MODEL_ASSUMPTIONS_CALCULATED'); expect(report.warnings[0]).toContain('假设'); expect(report.review.issues).toEqual([]);
    await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(other.token)).expect(404);
    const [rows] = await pool.query('SELECT COUNT(*) count FROM truth_records WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect((rows as Array<{ count: number }>)[0]!.count).toBe(0);
  });
  it('same request returns the same message and terminal redelivery does not call the model', async () => {
    const flow = await start('report-idempotent');
    const repeated = (await request(app.getHttpServer()).post(`/api/conversations/${flow.conversation.id}/messages`).set(auth(owner.token)).send(flow.input).expect(201)).body;
    expect(repeated.messages).toHaveLength(2);
    await generator.process(flow.message.id); const model = app.get(ReportModelService); const calls = vi.mocked(model.write).mock.calls.length;
    await generator.process(flow.message.id); expect(vi.mocked(model.write).mock.calls).toHaveLength(calls);
  });
  it('a changed goal fences a queued report before any model call', async () => {
    const flow = await start('report-superseded'); const model = app.get(ReportModelService); const calls = vi.mocked(model.plan).mock.calls.length;
    await request(app.getHttpServer()).post(`/api/conversations/${flow.conversation.id}/history`).set(auth(owner.token)).send({ version: flow.posted.version, action: 'ARCHIVE' }).expect(201);
    await generator.process(flow.message.id);
    const result = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(result.messages.at(-1).structuredPayload.report.stage).toBe('SUPERSEDED'); expect(vi.mocked(model.plan).mock.calls).toHaveLength(calls);
  });
  it('rejects invented source IDs without reading or publishing a finished report', async () => {
    const flow = await start('report-invalid-source');
    vi.mocked(app.get(ReportModelService).plan).mockResolvedValueOnce({ value: { ...plan, connectionIds: ['00000000-0000-4000-8000-000000000099'] }, modelId: 'fixture' });
    const read = vi.spyOn(app.get(ConnectionsService), 'invokeConsumerRead');
    await generator.process(flow.message.id);
    const result = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(result.messages.at(-1).structuredPayload.report.stage).toBe('FAILED'); expect(read).not.toHaveBeenCalled();
  });
  it('an incomplete review retains a draft and never labels it complete', async () => {
    const flow = await start('report-review-failure'); const model = app.get(ReportModelService);
    vi.mocked(model.review).mockResolvedValueOnce({ value: { issues: ['公式错误'] }, modelId: 'fixture' }).mockResolvedValueOnce({ value: { issues: ['公式仍错误'] }, modelId: 'fixture' });
    await generator.process(flow.message.id);
    const result = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(owner.token)).expect(200)).body;
    const report = result.messages.at(-1).structuredPayload.report;
    expect(report.stage).toBe('FAILED'); expect(reportTerminal(report.stage)).toBe(true); expect(report.review.issues).toEqual(['公式仍错误']); expect(report.markdown).toContain(markdown);
  });
  it('completes without suppressing nonblocking review suggestions', async () => {
    const flow = await start('report-review-suggestions');
    vi.mocked(app.get(ReportModelService).review).mockResolvedValueOnce({ value: { issues: [], suggestions: ['签约前实测洗车与美容服务耗时'] }, modelId: 'fixture' });
    await generator.process(flow.message.id);
    const result = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(owner.token)).expect(200)).body;
    const report = result.messages.at(-1).structuredPayload.report;
    expect(report.stage).toBe('COMPLETED'); expect(report.warnings).toContain('检查建议：签约前实测洗车与美容服务耗时');
    expect(report.review.issues).toEqual([]);
  });
});
