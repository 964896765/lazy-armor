import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { githubDigestPlan, githubTrendingSchema } from '@lazy-armor/plan-schema';
import { activatePlan, auth, bootP2App, register, setPlusMembership, type Session } from './p2-test-helpers';
import { GithubDigestModelService } from '../src/execution/github-digest-model.service';
import { GithubDigestScheduleService } from '../src/execution/github-digest-schedule.service';
import { GithubDigestService } from '../src/execution/github-digest.service';
import { WEB_READ } from '../src/connectors/public-web.connector';
import { SnapshotSanitizer } from '../src/common/snapshot-sanitizer.service';
import { SourceResolver } from '../src/execution/source-resolver.service';
import { PlanDefinitionAssembler } from '../src/plans/plan-definition.assembler';

describe.sequential('GitHub digest on original Plan and Execution', { timeout: 90000 }, () => {
  let app: Awaited<ReturnType<typeof bootP2App>>['app'], pool: Awaited<ReturnType<typeof bootP2App>>['pool'], worker: Awaited<ReturnType<typeof bootP2App>>['worker'];
  let owner: Session, other: Session, model: GithubDigestModelService, connectionId: string;
  const source = () => githubTrendingSchema.parse({ url: 'https://github.com/trending?since=daily', since: 'daily', language: 'all', retrievedAt: new Date().toISOString(), sha256: 'a'.repeat(64), verification: 'SOURCE_RESPONSE_ONLY',
    repositories: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, fullName: `isolated/project-${i}`, url: `https://github.com/isolated/project-${i}`, description: '隔离测试项目描述', language: 'TypeScript', stars: 1234, todayStars: 100 })) });
  beforeAll(async () => {
    ({ app, pool, worker } = await bootP2App('github-' + randomUUID())); owner = await register(app, randomUUID() + '@example.test', '隔离日榜用户'); other = await register(app, randomUUID() + '@example.test', '其他用户');
    await setPlusMembership(app, owner.userId);
    const connector = app.get(ConnectorRegistry).get('public_web_research');
    vi.spyOn(connector, 'validateConnection').mockResolvedValue({ status: 'healthy', checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 300000).toISOString() });
    vi.spyOn(connector, 'read').mockImplementation(async () => ({ ok: true, data: { githubTrending: source() } }));
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: 'public_web_research', externalAccountName: '隔离 GitHub', credentials: { entryUrls: 'https://github.com/trending?since=daily' } }).expect(201)).body.id;
    model = app.get(GithubDigestModelService); vi.spyOn(model, 'plan'); vi.spyOn(model, 'write');
  });
  beforeEach(async () => {
    await grant(true);
    vi.mocked(model.plan).mockImplementation(async () => ({ value: { prompt: '只依据本次实际读取的十项公开仓库，保持原始榜单顺序，逐项生成用途摘要并标明信息不足；排名变化只与上次成功汇总比较，首日不得虚构昨日数据，不能编造提交、发行日志或未给出的数值。'.repeat(2) }, modelId: 'isolated-model' }));
    vi.mocked(model.write).mockImplementation(async (_userId, _prompt, data) => ({ value: { overview: '这是隔离测试榜单概览。用途依据提供的描述。', items: data.repositories.map(r => ({ fullName: r.fullName, summary: '项目描述提供的用途概述，尚未独立核实。' })) }, modelId: 'isolated-model' }));
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  async function grant(granted: boolean) { await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: WEB_READ, granted }] }).expect(200); }
  async function plan() { const row = (await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(githubDigestPlan(connectionId)).expect(201)).body; await activatePlan(app, owner.token, row.id); return (await request(app.getHttpServer()).get(`/api/plans/${row.id}`).set(auth(owner.token)).expect(200)).body; }
  async function dispatch(planId: string, triggerPayload = {}) { return (await request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(owner.token)).send({ requestId: 'github-manual:' + randomUUID(), triggerPayload }).expect(201)).body; }
  async function get(id: string) { return (await request(app.getHttpServer()).get(`/api/executions/${id}`).set(auth(owner.token)).expect(200)).body; }
  it('automatically plans and writes, retains ten originals, sends once and records WAIT without Truth', async () => {
    const p = await plan(), run = await dispatch(p.id, { githubSource: { fake: true }, githubDigest: { fake: true } }); await worker.processExecution(run.id);
    const detail = await get(run.id); expect(detail.status).toBe('succeeded');
    const digest = detail.outputs.find((o: { output: Record<string, unknown> }) => o.output.githubDigest).output.githubDigest;
    expect(digest.source.repositories).toHaveLength(10); expect(digest.baselineAt).toBeNull(); expect(digest.prompt.length).toBeGreaterThan(100);
    expect(app.get(SnapshotSanitizer).sanitize({ githubDigest: digest }).truncated).toBeUndefined();
    expect(detail.notifications.filter((n: { eventType: string }) => n.eventType === 'github_trending_digest')).toHaveLength(1);
    await worker.processExecution(run.id); await app.get(GithubDigestScheduleService).complete(owner.userId); await app.get(GithubDigestScheduleService).complete(owner.userId);
    const assembled = await app.get(PlanDefinitionAssembler).assembleById(owner.userId, p.id, p.activeVersionId);
    const reads = vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!).mock.calls.length;
    const resumed = await app.get(SourceResolver).resolve(owner.userId, assembled.definition.sources, {}, run.requestId);
    expect(vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!).mock.calls.length).toBe(reads);
    expect(resumed.githubDigest).toEqual(digest);
    await app.get(GithubDigestService).notify(owner.userId, run.id, resumed);
    expect((await get(run.id)).notifications.filter((n: { eventType: string }) => n.eventType === 'github_trending_digest')).toHaveLength(1);
    const [truth] = await pool.query('SELECT COUNT(*) n FROM truth_records WHERE user_id=UUID_TO_BIN(?)', [owner.userId]); expect((truth as Array<{ n: number }>)[0]?.n).toBe(0);
    const history = (await request(app.getHttpServer()).get(`/api/plans/${p.id}/agent-loop/history`).set(auth(owner.token))).body;
    expect(history.items.some((r: { state: string }) => r.state === 'WAITING_NEXT_SCHEDULE')).toBe(true);
    await request(app.getHttpServer()).get(`/api/executions/${run.id}`).set(auth(other.token)).expect(404);
    const coverage = (await request(app.getHttpServer()).get(`/api/plans/${p.id}/agent-loop/coverage`).set(auth(owner.token))).body;
    expect(coverage.recordedDayCount).toBe(1); expect(coverage.continuityVerified).toBe(false);
    const second = await dispatch(p.id); await worker.processExecution(second.id);
    const next = await get(second.id); expect(next.status).toBe('succeeded'); expect(next.outputs.find((o: { output: Record<string, unknown> }) => o.output.githubDigest).output.githubDigest.items[0].previousRank).toBe(1);
  });
  it('performs zero network/model calls without current read permission', async () => {
    const p = await plan(); await grant(false);
    const read = vi.mocked(app.get(ConnectorRegistry).get('public_web_research').read!), before = read.mock.calls.length, writes = vi.mocked(model.write).mock.calls.length;
    const run = await dispatch(p.id); await worker.processExecution(run.id); const detail = await get(run.id);
    expect(detail.status).toBe('failed'); expect(read.mock.calls.length).toBe(before); expect(vi.mocked(model.write).mock.calls.length).toBe(writes); expect(detail.notifications.filter((n: { eventType: string }) => n.eventType === 'github_trending_digest')).toEqual([]);
  });
  it('fences revoke and regrant between model phases', async () => {
    const p = await plan(), original = vi.mocked(model.plan).getMockImplementation()!;
    vi.mocked(model.plan).mockImplementationOnce(async (...args) => { const result = await original(...args); await grant(false); await grant(true); return result; });
    const run = await dispatch(p.id); await worker.processExecution(run.id); const detail = await get(run.id);
    expect(detail.status).toBe('failed'); expect(detail.notifications.filter((n: { eventType: string }) => n.eventType === 'github_trending_digest')).toEqual([]);
  });
  it('blocks publication when paused during generation', async () => {
    const p = await plan(), original = vi.mocked(model.write).getMockImplementation()!;
    vi.mocked(model.write).mockImplementationOnce(async (...args) => { const result = await original(...args); await request(app.getHttpServer()).post(`/api/plans/${p.id}/status`).set(auth(owner.token)).send({ status: 'paused' }).expect(201); return result; });
    const run = await dispatch(p.id); await worker.processExecution(run.id); const detail = await get(run.id);
    expect(detail.status).toBe('failed'); expect(detail.notifications).toEqual([]);
  });
  it('rejects a model that replaces the source order', async () => {
    const p = await plan(), original = vi.mocked(model.write).getMockImplementation()!;
    vi.mocked(model.write).mockImplementationOnce(async (...args) => { const result = await original(...args); result.value.items.reverse(); return result; });
    const run = await dispatch(p.id); await worker.processExecution(run.id); expect((await get(run.id)).notifications.filter((n: { eventType: string }) => n.eventType === 'github_trending_digest')).toEqual([]);
  });
  it('blocks a changed applied version during generation', async () => {
    const p = await plan(), original = vi.mocked(model.write).getMockImplementation()!;
    vi.mocked(model.write).mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await request(app.getHttpServer()).post(`/api/plans/${p.id}/versions`).set(auth(owner.token)).send({ ...githubDigestPlan(connectionId), description: '隔离测试新版本' }).expect(201);
      await request(app.getHttpServer()).post(`/api/plans/${p.id}/versions/2/apply`).set(auth(owner.token)).expect(201);
      return result;
    });
    const run = await dispatch(p.id); await worker.processExecution(run.id); const detail = await get(run.id);
    expect(detail.status).not.toBe('succeeded'); expect(detail.notifications.filter((n: { eventType: string }) => n.eventType === 'github_trending_digest')).toEqual([]);
  });
  it('does not activate a version different from the reviewed one', async () => {
    const p = await plan(); await request(app.getHttpServer()).post(`/api/plans/${p.id}/status`).set(auth(owner.token)).send({ status: 'paused' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${p.id}/versions`).set(auth(owner.token)).send(githubDigestPlan(connectionId)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${p.id}/versions/2/apply`).set(auth(owner.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${p.id}/status`).set(auth(owner.token)).send({ status: 'active', expectedVersionId: p.activeVersionId }).expect(409);
    expect((await request(app.getHttpServer()).get(`/api/plans/${p.id}`).set(auth(owner.token))).body.status).toBe('paused');
  });
  it('renews expired website health before an authorized daily read, but never without permission', async () => {
    const p = await plan(), connector = app.get(ConnectorRegistry).get('public_web_research'), validate = vi.mocked(connector.validateConnection!);
    await pool.execute('UPDATE provider_capability_health SET valid_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?) AND capability_key=?', [connectionId, WEB_READ]);
    const checks = validate.mock.calls.length, run = await dispatch(p.id); await worker.processExecution(run.id);
    expect((await get(run.id)).status).toBe('succeeded'); expect(validate.mock.calls.length).toBe(checks + 1);
    await pool.execute('UPDATE provider_capability_health SET valid_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?) AND capability_key=?', [connectionId, WEB_READ]);
    await grant(false); const deniedChecks = validate.mock.calls.length, denied = await dispatch(p.id); await worker.processExecution(denied.id);
    expect(validate.mock.calls.length).toBe(deniedChecks); expect((await get(denied.id)).status).toBe('failed');
  });
  it('uses version-bound scheduled identity and refuses clients that forge it', async () => {
    const p = await plan(), slot = new Date(); slot.setUTCDate(slot.getUTCDate() + 1); slot.setUTCHours(1, 0, 0, 0);
    const scheduler = app.get(GithubDigestScheduleService), first = (await scheduler.wake(owner.userId, slot)).find(r => r.planId === p.id)!;
    expect(first.executionId).toBeTruthy(); const second = (await scheduler.wake(owner.userId, slot)).find(r => r.planId === p.id)!; expect(second.executionId).toBe(first.executionId);
    expect((await get(first.executionId)).triggerOrigin).toBe('SCHEDULE');
    await request(app.getHttpServer()).post(`/api/plans/${p.id}/executions`).set(auth(owner.token)).send({ requestId: `github-schedule:forged`, triggerPayload: {} }).expect(409);
    await worker.processExecution(first.executionId); await scheduler.complete(owner.userId); expect((await get(first.executionId)).status).toBe('succeeded');
    const later = (await scheduler.wake(owner.userId, new Date(slot.getTime() + 60000))).find(r => r.planId === p.id); expect(later).toBeUndefined();
  });
});
