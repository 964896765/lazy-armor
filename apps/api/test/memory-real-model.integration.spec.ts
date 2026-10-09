import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { RemoteAgentModel } from '../src/ai-adapter/remote-agent-model';
import type { AgentModelAdapter, AgentModelRequest } from '../src/ai-adapter/agent-model-adapter';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import { serverDevelopmentAi } from '../src/ai-provider-config/server-development-ai';
import type { MemoryCandidate } from '@lazy-armor/plan-schema';

// Opt-in network acceptance uses fictional data and authenticated test accounts.
// Never switches the running development API to a test DB or treats API confirmation as phone consent.
describe.skipIf(process.env.MEMORY_REAL_MODEL_ACCEPTANCE !== '1').sequential('real model with controlled Memory API lifecycle', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session;
  let lastRequest: AgentModelRequest | undefined, memoryId: string, preferenceId: string, sourceConversationId: string;
  let modelCalls = 0;
  const stages: string[] = [], startedAt = new Date().toISOString();
  const evidenceFile = process.env.MEMORY_REAL_MODEL_EVIDENCE;
  const query = '开发虚构样例：请根据我确认保存的相机和预算偏好，说明应该核对哪种电池以及预算上限。仅解释，不购买或安排任务。';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated _test database required');
    if (!process.env.REDIS_URL || new URL(process.env.REDIS_URL).pathname !== '/15') throw new Error('Isolated Redis database 15 required');
    if (evidenceFile && existsSync(evidenceFile)) throw new Error('Fresh evidence path required');
    const config = serverDevelopmentAi({ ...process.env, NODE_ENV: 'development' });
    if (!config) throw new Error('Explicitly enabled existing development model required');
    const remote = new RemoteAgentModel({ resolve: async () => config } as unknown as AiProviderConfigService);
    const model: AgentModelAdapter = {
      modelId: () => remote.modelId(), capability: () => remote.capability(),
      complete: async input => { lastRequest = input; modelCalls++; return remote.complete(input); },
    };
    ({ app, pool } = await bootP2App('memory-real-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
    owner = await register(app, randomUUID() + '@example.test', 'Fictional Memory acceptance');
    other = await register(app, randomUUID() + '@example.test', 'Isolated other user');
    expect((await request(app.getHttpServer()).get('/api/memory/settings').set(auth(owner.token)).expect(200)).body.enabled).toBe(false);
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: true, version: 0 }).expect(200);
  }, 60000);
  afterAll(async () => {
    if (evidenceFile) writeFileSync(evidenceFile, JSON.stringify({ startedAt, completedAt: new Date().toISOString(),
      scope: 'Real DeepSeek + authenticated isolated Memory API lifecycle with explicitly fictional records; NOT real-user consent or phone UI acceptance',
      modelCalls, stages, passed: stages.length === 5, productionObjectsCreated: 0, mobileGoldenFlow: 'PENDING_NORMAL_LOGIN',
    }, null, 2), { flag: 'wx' });
    await app?.close(); await pool?.end();
  });
  async function ask(content: string, session = owner) {
    const c = (await request(app.getHttpServer()).post('/api/conversations').set(auth(session.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
    const result = (await request(app.getHttpServer()).post(`/api/conversations/${c.id}/messages`).set(auth(session.token))
      .send({ version: c.version, requestId: randomUUID(), content }).expect(201)).body;
    const payload = result.messages.at(-1).structuredPayload;
    expect(payload.result).toBe('ANSWER');
    return { conversationId: c.id as string, payload, answer: result.messages.at(-1).content as string };
  }

  it('real extraction stays pending until normal owner confirmation, with no Truth or execution', async () => {
    const statement = '以下是开发验收的虚构个人陈述，可提取待核对记忆建议：我有 Canon R10 相机，使用 LP-E17 电池。';
    const f = await ask(statement); sourceConversationId = f.conversationId;
    const items: MemoryCandidate[] = (await request(app.getHttpServer()).get(`/api/memory/candidates?conversationId=${sourceConversationId}`).set(auth(owner.token)).expect(200)).body.items;
    const candidate = items.find(item => item.type === 'ASSET' && item.quote?.includes('LP-E17'));
    expect(candidate).toBeDefined();
    expect((await request(app.getHttpServer()).get('/api/memory').set(auth(owner.token)).expect(200)).body.items).toEqual([]);
    await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate!.id}/confirm`).set(auth(other.token))
      .send({ type: candidate!.type, title: candidate!.title, content: candidate!.quote, version: candidate!.version, confirmed: true }).expect(404);
    const confirmation = { type: candidate!.type, title: candidate!.title, content: candidate!.quote, version: candidate!.version, confirmed: true };
    const confirmed = (await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate!.id}/confirm`).set(auth(owner.token)).send(confirmation).expect(201)).body;
    memoryId = confirmed.memoryId;
    expect((await request(app.getHttpServer()).post(`/api/memory/candidates/${candidate!.id}/confirm`).set(auth(owner.token)).send(confirmation).expect(201)).body.memoryId).toBe(memoryId);
    const source = (await request(app.getHttpServer()).get(`/api/memory/${memoryId}/reference?version=1`).set(auth(owner.token)).expect(200)).body;
    expect(source).toMatchObject({ state: 'CURRENT', source: { available: true, content: statement } });
    stages.push('real extraction -> pending -> owner confirmation -> source reference');
  });

  it('real model consumes confirmed Memory and relations through the production Planner', async () => {
    preferenceId = (await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({
      type: 'PREFERENCE', title: '虚构预算偏好', content: '虚构配件预算在300元以内。', confirmed: true, requestId: randomUUID(),
    }).expect(201)).body.id;
    await request(app.getHttpServer()).post(`/api/memory/${memoryId}/relations`).set(auth(owner.token)).send({
      toId: preferenceId, fromVersion: 1, toVersion: 1, relation: 'RELATED_TO', confirmed: true, requestId: randomUUID(),
    }).expect(201);
    const result = await ask(query);
    expect(result.payload.memoryRefs.map((ref: { id: string }) => ref.id)).toEqual(expect.arrayContaining([memoryId, preferenceId]));
    expect(result.payload.memoryRelationRefs).toHaveLength(1);
    expect(result.answer).toContain('LP-E17'); expect(result.answer).toMatch(/300|三百/);
    const data = lastRequest!.context.sections.find(s => s.title === 'PERSONAL MEMORY DATA');
    expect(data?.kind).toBe('UNTRUSTED_SOURCE_CONTENT');
    const metadata = lastRequest!.context.sections.find(s => s.kind === 'TRUSTED_RUNTIME_METADATA')!.content;
    expect(metadata).not.toContain('LP-E17');
    stages.push('confirmed data + relation -> real Planner context -> referenced answer');
  });

  it('correction replaces current model context and preserves the historical reference version', async () => {
    await request(app.getHttpServer()).patch(`/api/memory/${memoryId}`).set(auth(owner.token)).send({
      type: 'ASSET', title: '虚构相机更正', content: '我的虚构设备已更换为 Canon R7，相机使用 LP-E6NH 电池。', confirmed: true, version: 1,
    }).expect(200);
    expect((await request(app.getHttpServer()).get(`/api/memory/${memoryId}/reference?version=1`).set(auth(owner.token)).expect(200)).body.state).toBe('CHANGED');
    const result = await ask(query);
    expect(result.payload.memoryRefs.find((ref: { id: string }) => ref.id === memoryId).version).toBe(2);
    expect(result.payload.memoryRelationRefs ?? []).toEqual([]);
    expect(result.answer).toContain('LP-E6NH'); expect(result.answer).not.toContain('LP-E17');
    stages.push('correction -> new version consumption; historical refs unchanged; edge revoked');
  });

  it('disabling usage stops real-model Memory consumption for subsequent goals', async () => {
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: false, version: 1 }).expect(200);
    const result = await ask('开发虚构样例：我保存的相机使用什么电池？只依据已保存的个人资料，缺少资料时不要猜测。');
    expect(result.payload.memoryRefs ?? []).toEqual([]);
    expect(lastRequest!.context.sections.find(s => s.title === 'PERSONAL MEMORY DATA')).toBeUndefined();
    expect(result.answer).not.toContain('LP-E6NH');
    expect((await request(app.getHttpServer()).get(`/api/memory/${memoryId}`).set(auth(owner.token)).expect(200)).body.version).toBe(2);
    stages.push('usage disabled -> no Memory data or references sent to real model');
  });

  it('deletion and owner isolation leave no Memory content, Truth or execution authority', async () => {
    await request(app.getHttpServer()).delete(`/api/memory/${memoryId}`).set(auth(owner.token)).send({ version: 2 }).expect(200);
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ enabled: true, version: 2 }).expect(200);
    const result = await ask('开发虚构样例：我之前保存的相机型号和电池是什么？只依据当前保存的信息，不猜测。');
    expect((result.payload.memoryRefs ?? []).some((ref: { id: string }) => ref.id === memoryId)).toBe(false);
    expect(result.answer).not.toContain('LP-E6NH'); expect(result.answer).not.toContain('LP-E17');
    await request(app.getHttpServer()).get(`/api/memory/${preferenceId}/reference?version=1`).set(auth(other.token)).expect(404);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths,' +
      '(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,' +
      '(SELECT COUNT(*) FROM personal_memories WHERE id=UUID_TO_BIN(?) AND title IS NULL AND content IS NULL) scrubbed', [owner.userId, owner.userId, memoryId]);
    expect(rows[0]).toMatchObject({ truths: 0, executions: 0, scrubbed: 1 });
    stages.push('deleted data excluded; other owner rejected; no Truth or execution; tombstone scrubbed');
  });
});
