import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { ConnectorError, ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { ReportModelService } from '../src/agent/reports/report-model.service';
import { WEB_READ } from '../src/connectors/public-web.connector';
describe.sequential('report web research under original resource authority', { timeout: 90000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, model: ReportModelService;
  const url = 'https://www.example.gov.cn/report.html', excerpt = '这是隔离测试的公开网页正文，不是实际荆门数据。'.repeat(25);
  const plan = { title: '公开资料报告', prompt: '根据实际取得的原文编写完整报告，清楚区分假设与来源响应。'.repeat(8), sections: ['市场', '选址', '成本', '建议'], assumptions: ['成本待核实'], researchQuestions: ['本地统计资料'], connectionIds: [] as string[], webQueries: ['荆门 统计资料'], financialModel: null };
  const markdown = plan.sections.join('\n') + '\n[S1] 依据实际来源响应分析。\n' + '本报告使用公开来源响应，数字不足列为假设，资料不作为个人Truth。'.repeat(35);
  beforeAll(async () => {
    ({ app, pool } = await bootP2App('report-web-' + Date.now()));
    owner = await register(app, `web-${Date.now()}@example.test`, '隔离测试'); other = await register(app, `web-other-${Date.now()}@example.test`, '其他用户');
    const connector = app.get(ConnectorRegistry).get('public_web_research');
    vi.spyOn(connector, 'validateConnection').mockImplementation(async () => ({ status: 'healthy', checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() }));
    vi.spyOn(connector, 'read').mockImplementation(async input => input.input.mode === 'search'
      ? { ok: true, data: { query: input.input.query, candidates: [{ title: '统计原文', url, method: 'SEARCH_RESULT' }], warnings: [] } }
      : { ok: true, data: { page: { title: '统计原文', url, publishedAt: '2025-03-14', excerpt, sha256: createHash('sha256').update(excerpt).digest('hex'), retrievedAt: new Date().toISOString(), truncated: false, verification: 'SOURCE_RESPONSE_ONLY' } } });
    model = app.get(ReportModelService);
    vi.spyOn(model, 'plan'); vi.spyOn(model, 'write'); vi.spyOn(model, 'review'); vi.spyOn(model, 'chooseWebSources');
  });
  beforeEach(() => {
    vi.mocked(model.write).mockResolvedValue({ value: { markdown }, modelId: 'isolated-fixture' });
    vi.mocked(model.review).mockResolvedValue({ value: { issues: [] }, modelId: 'isolated-fixture' });
    vi.mocked(model.chooseWebSources).mockResolvedValue({ value: { urls: [url] }, modelId: 'isolated-fixture' });
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  async function start(granted: boolean) {
    const connection = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: 'public_web_research', externalAccountName: '隔离网页范围', credentials: { entryUrls: 'https://www.example.gov.cn/' } }).expect(201)).body;
    if (granted) await setGrant(connection.id, true);
    vi.mocked(model.plan).mockResolvedValue({ value: { ...plan, connectionIds: [connection.id] }, modelId: 'isolated-fixture' });
    const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', title: '公开资料' }).expect(201)).body;
    const posted = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send({ content: '生成荆门公开资料分析报告', version: 0, requestId: 'web-' + conversation.id }).expect(201)).body;
    return { connection, conversation, message: posted.messages.find((m: { role: string }) => m.role === 'assistant') };
  }
  async function setGrant(id: string, granted: boolean) { await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: WEB_READ, granted }] }).expect(200); }
  async function finish(flow: Awaited<ReturnType<typeof start>>) {
    await app.get(ReportGenerationService).process(flow.message.id);
    const result = (await request(app.getHttpServer()).get(`/api/conversations/${flow.conversation.id}`).set(auth(owner.token)).expect(200)).body;
    return result.messages.find((m: { id: string }) => m.id === flow.message.id).structuredPayload.report;
  }
  it('requires an explicit grant, retains URL/dates/hash and creates no Truth', async () => {
    const flow = await start(true), report = await finish(flow);
    expect(report.stage).toBe('COMPLETED');
    expect(report.sources[0]).toMatchObject({ url, content: excerpt, publishedAt: '2025-03-14', retrievalMethod: 'SEARCH_RESULT', capabilityKey: WEB_READ, provenance: 'SOURCE_RESPONSE_ONLY' });
    expect(report.sources[0].authorityHash).toHaveLength(64);
    const scope = (await request(app.getHttpServer()).get(`/api/connections/${flow.connection.id}/public-web-scope`).set(auth(owner.token)).expect(200)).body;
    expect(scope.origins).toEqual(['https://www.example.gov.cn']);
    await request(app.getHttpServer()).get(`/api/connections/${flow.connection.id}/public-web-scope`).set(auth(other.token)).expect(404);
    const [rows] = await pool.query('SELECT COUNT(*) count FROM truth_records WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect((rows as Array<{ count: number }>)[0]?.count).toBe(0);
  });
  it('does not search without permission', async () => {
    const flow = await start(false), read = vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!); const calls = read.mock.calls.length;
    const report = await finish(flow);
    expect(read.mock.calls.length).toBe(calls); expect(report.sources).toEqual([]);
    expect(report.stage).toBe('FAILED'); expect(report.errorCode).toBe('REPORT_WEB_SOURCE_REQUIRED');
    expect(model.write).not.toHaveBeenCalledWith(owner.userId, expect.anything(), expect.anything(), [], expect.anything());
  });
  it('does not publish an assumed report when required web research yields no selected original', async () => {
    const flow = await start(true);
    vi.mocked(model.chooseWebSources).mockResolvedValueOnce({ value: { urls: [] }, modelId: 'fixture' });
    const report = await finish(flow);
    expect(report.stage).toBe('FAILED'); expect(report.errorCode).toBe('REPORT_WEB_SOURCE_REQUIRED');
    expect(report.markdown).toBeUndefined();
  });
  it('rejects a short document while preserving authority for the next valid original', async () => {
    const flow = await start(true), emptyUrl = 'https://www.example.gov.cn/empty.html';
    vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!)
      .mockResolvedValueOnce({ ok: true, data: { query: plan.webQueries[0], candidates: [{ title: '空文档', url: emptyUrl, method: 'SEARCH_RESULT' }, { title: '统计原文', url, method: 'SEARCH_RESULT' }], warnings: [] } })
      .mockRejectedValueOnce(new ConnectorError('WEB_TEXT_INSUFFICIENT', 'INVALID_REQUEST', '正文不足'));
    vi.mocked(model.chooseWebSources).mockResolvedValueOnce({ value: { urls: [emptyUrl, url] }, modelId: 'fixture' });
    const report = await finish(flow);
    expect(report.stage).toBe('COMPLETED'); expect(report.sources).toHaveLength(1); expect(report.sources[0].url).toBe(url);
    const connection = (await request(app.getHttpServer()).get(`/api/connections/${flow.connection.id}`).set(auth(owner.token)).expect(200)).body;
    expect(connection.status).toBe('connected');
  });
  it('does not publish if authorization is revoked during model writing', async () => {
    const flow = await start(true);
    vi.mocked(model.write).mockImplementationOnce(async () => { await setGrant(flow.connection.id, false); return { value: { markdown }, modelId: 'fixture' }; });
    const report = await finish(flow);
    expect(report.stage).toBe('FAILED'); expect(report.errorCode).toBe('REPORT_SOURCE_AUTHORITY_CHANGED');
  });
  it('fences revoke/regrant even when permission is restored before publication', async () => {
    const flow = await start(true);
    vi.mocked(model.write).mockImplementationOnce(async () => { await setGrant(flow.connection.id, false); await setGrant(flow.connection.id, true); return { value: { markdown }, modelId: 'fixture' }; });
    const report = await finish(flow);
    expect(report.stage).toBe('FAILED'); expect(report.errorCode).toBe('REPORT_SOURCE_AUTHORITY_CHANGED');
  });
  it('rejects a model-invented URL before reading it', async () => {
    const flow = await start(true);
    vi.mocked(model.chooseWebSources).mockResolvedValueOnce({ value: { urls: ['https://www.example.gov.cn/invented.html'] }, modelId: 'fixture' });
    const report = await finish(flow);
    expect(report.stage).toBe('FAILED'); expect(report.errorCode).toBe('REPORT_SOURCE_INVALID');
  });
});
