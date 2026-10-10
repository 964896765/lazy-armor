import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SkillCapability, SkillRepositoryProjection } from '@lazy-armor/plan-schema';
import { addSelectedMethod, methodConversationRequest, startMethodConversation } from '../../mobile/src/method-selection';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { FakeAgentModel, type AgentModelAdapter, type AgentModelRequest } from '../src/ai-adapter/agent-model-adapter';
import { RemoteAgentModel } from '../src/ai-adapter/remote-agent-model';
import { serverDevelopmentAi } from '../src/ai-provider-config/server-development-ai';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const intent = '开发虚构验收：只解释我已保存的“虚构阅读偏好”和所选方法要求的来源核对步骤。不要读取数据、不要查询资料、不要安排事项、不要创建计划，也不要调用工具。';
const manifest: SkillCapability = { name: 'PublicMetadataReadMethod', version: '1.0.0', description: '隔离方法声明：读取前核对来源', domain: 'information', input: {}, output: {},
  requiredCapabilities: ['READ_PUBLIC_HTTP_JSON'], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: 'BETA_METHOD_REFERENCE：先核对来源和授权；响应只证明来源返回，不自动成为 Truth。' };
function assertIsolation() {
  const db = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid'), redis = new URL(process.env.REDIS_URL ?? 'redis://invalid');
  if (db.hostname !== '127.0.0.1' || db.port !== '3311' || !db.pathname.endsWith('_test') || redis.hostname !== '127.0.0.1' || redis.pathname !== '/15') throw new Error('Isolated 3311 _test database and Redis DB 15 required');
  if (!process.env.TEST_REDIS_KEY_PREFIX || process.env.TEST_REDIS_KEY_PREFIX !== process.env.REDIS_KEY_PREFIX) throw new Error('Explicit isolated queue prefix required');
}
async function counts(pool: Pool, session: Session) {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations,(SELECT COUNT(*) FROM device_tasks WHERE user_id=UUID_TO_BIN(?)) deviceTasks,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', Array(5).fill(session.userId));
  return rows[0];
}
async function surfaces(app: INestApplication, session: Session) {
  const paths = ['/api/timeline?date=all', '/api/plan-library', '/api/conversations', '/api/consumer/resources', '/api/service-offerings'];
  for (const path of paths) {
    const result = (await request(app.getHttpServer()).get(path).set(auth(session.token)).expect(200)).body;
    expect(result !== null && typeof result === 'object', path).toBe(true);
  }
  return paths;
}
async function seed(app: INestApplication) {
  const owner = await register(app, randomUUID() + '@example.test', 'Fictional Beta owner');
  await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(owner.token)).send({ version: 0, enabled: true }).expect(200);
  const memory = (await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ type: 'PREFERENCE', title: '虚构阅读偏好',
    content: '开发虚构阅读偏好 BETA_MEMORY_SOURCE_BOUNDARY：先核对公开元数据来源，再解释版本；不自动购买或执行。', requestId: randomUUID(), confirmed: true }).expect(201)).body;
  const methods = app.get(SkillRepositoriesService);
  let repo = await methods.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '隔离 Beta 方法包', sourceType: 'USER', entries: [manifest,
    { ...manifest, name: 'SourceBoundaryExplainMethod', requiredCapabilities: [], instruction: 'BETA_SECOND_METHOD：只解释，保留来源、时效与核实边界。' }] });
  repo = await methods.change(owner.userId, repo.id, repo.version, true);
  const selected = repo.entries.reduce((choices, entry) => addSelectedMethod(choices, repo, entry.id), [] as ReturnType<typeof addSelectedMethod>);
  return { owner, memory, repo, selected };
}
async function conversation(app: INestApplication, input: Awaited<ReturnType<typeof seed>>) {
  return startMethodConversation(input.selected,
    id => request(app.getHttpServer()).get('/api/skill-repositories/' + id).set(auth(input.owner.token)).expect(200).then(response => response.body as SkillRepositoryProjection),
    body => request(app.getHttpServer()).post('/api/conversations').set(auth(input.owner.token)).send(body).expect(201).then(response => response.body));
}
const ask = (app: INestApplication, session: Session, id: string, version = 0) => request(app.getHttpServer()).post(`/api/conversations/${id}/messages`).set(auth(session.token))
  .send({ version, requestId: randomUUID(), content: intent }).expect(201).then(response => response.body);

describe.sequential('Five-page isolated Beta journey; fixture model is NOT real-user acceptance', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, lastRequest: AgentModelRequest | undefined;
  beforeAll(async () => {
    assertIsolation(); const fake = new FakeAgentModel();
    const model: AgentModelAdapter = { modelId: () => fake.modelId(), capability: () => fake.capability(), complete: async input => { lastRequest = input; return fake.complete(input); } };
    ({ app, pool } = await bootP2App('v90-fixture-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  it('reads all five backing surfaces without creating Runtime/Truth objects', async () => {
    const data = await seed(app), before = await counts(pool, data.owner);
    await surfaces(app, data.owner); expect(await counts(pool, data.owner)).toEqual(before);
  });
  it('keeps Memory and both selected methods in untrusted context, with exact references and owner isolation', async () => {
    const data = await seed(app), c = await conversation(app, data), before = await counts(pool, data.owner);
    const proposed = await ask(app, data.owner, c.id), payload = proposed.messages.at(-1).structuredPayload;
    expect(payload.result).toBe('ANSWER'); expect(payload.methodRefs).toEqual(methodConversationRequest(data.selected).methodRefs);
    expect(payload.memoryRefs).toContainEqual(expect.objectContaining({ id: data.memory.id }));
    for (const marker of ['BETA_MEMORY_SOURCE_BOUNDARY', 'BETA_METHOD_REFERENCE', 'BETA_SECOND_METHOD']) {
      expect(lastRequest!.context.sections.some(section => section.kind === 'UNTRUSTED_SOURCE_CONTENT' && section.content.includes(marker))).toBe(true);
      expect(lastRequest!.context.sections.some(section => section.kind !== 'UNTRUSTED_SOURCE_CONTENT' && section.content.includes(marker))).toBe(false);
    }
    expect(payload.understanding.policy.executionAuthorized).toBe(false); expect(await counts(pool, data.owner)).toEqual(before);
    const other = await register(app, randomUUID() + '@example.test', 'Other Beta owner');
    await request(app.getHttpServer()).get('/api/conversations/' + c.id).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get('/api/memory/' + data.memory.id + '/reference?version=1').set(auth(other.token)).expect(404);
  });
  it('projects real missing resource state instead of granting the method a capability', async () => {
    const data = await seed(app), c = await conversation(app, data), before = await counts(pool, data.owner);
    const review = (await request(app.getHttpServer()).get(`/api/conversations/${c.id}/method-resources?version=0`).set(auth(data.owner.token)).expect(200)).body;
    expect(review.methods.map((method: { ref: unknown }) => method.ref)).toEqual(methodConversationRequest(data.selected).methodRefs);
    const need = review.methods.flatMap((method: { requirements: unknown[] }) => method.requirements).find((row: { key: string }) => row.key === 'READ_PUBLIC_HTTP_JSON');
    expect(need).toMatchObject({ resources: [], reasons: ['NO_CAPABILITY_PROVIDER'] }); expect(review.executionAuthorized).toBe(false);
    expect(await counts(pool, data.owner)).toEqual(before);
  });
  it('retains frozen conversation choices and refuses review after method withdrawal', async () => {
    const data = await seed(app), c = await conversation(app, data);
    await app.get(SkillRepositoriesService).change(data.owner.userId, data.repo.id, data.repo.version, false); const before = await counts(pool, data.owner);
    await request(app.getHttpServer()).get(`/api/conversations/${c.id}/method-resources?version=0`).set(auth(data.owner.token)).expect(409);
    const original = (await request(app.getHttpServer()).get('/api/conversations/' + c.id).set(auth(data.owner.token)).expect(200)).body;
    expect(original.methods.map((method: { ref: unknown }) => method.ref)).toEqual(methodConversationRequest(data.selected).methodRefs);
    expect(original.methods.every((method: { state: string }) => method.state === 'UNAVAILABLE')).toBe(true);
    expect(await counts(pool, data.owner)).toEqual(before);
  });
  it('keeps existing Memory but stops its subsequent consumption after usage is disabled', async () => {
    const data = await seed(app), c = await conversation(app, data), first = await ask(app, data.owner, c.id);
    await request(app.getHttpServer()).patch('/api/memory/settings').set(auth(data.owner.token)).send({ version: 1, enabled: false }).expect(200);
    const before = await counts(pool, data.owner), latest = await ask(app, data.owner, c.id, first.version);
    expect(latest.messages.at(-1).structuredPayload.memoryRefs ?? []).toEqual([]);
    expect((await request(app.getHttpServer()).get('/api/memory/' + data.memory.id + '/reference?version=1').set(auth(data.owner.token)).expect(200)).body.memory.id).toBe(data.memory.id);
    expect(await counts(pool, data.owner)).toEqual(before);
  });
});

describe.skipIf(process.env.V90_REAL_ACCEPTANCE !== '1').sequential('Opt-in real model + public HTTPS read with isolated fictional Memory/methods; NOT mobile or Goal Runtime closure', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, lastRequest: AgentModelRequest | undefined, modelCalls = 0, completed = false;
  let source: { name: string; version: string; observedAt: string; verification: string } | null = null;
  const startedAt = new Date().toISOString(), stages: string[] = [], evidence = process.env.V90_REAL_EVIDENCE;
  beforeAll(async () => {
    assertIsolation(); if (!evidence || existsSync(evidence)) throw new Error('Fresh explicit real evidence path required');
    const config = serverDevelopmentAi({ ...process.env, NODE_ENV: 'development' });
    if (!config) throw new Error('Existing explicitly enabled development model required');
    const remote = new RemoteAgentModel({ resolve: async () => config } as unknown as AiProviderConfigService);
    const model: AgentModelAdapter = { modelId: () => remote.modelId(), capability: () => remote.capability(), complete: async input => { lastRequest = input; modelCalls++; return remote.complete(input); } };
    ({ app, pool } = await bootP2App('v90-real-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
  });
  afterAll(async () => {
    try { if (evidence && !existsSync(evidence)) writeFileSync(evidence, JSON.stringify({ startedAt, completedAt: new Date().toISOString(),
      scope: 'Real development model and public npm HTTPS response; fictional isolated account/Memory/methods; source inspection is not Goal Runtime or Truth verification',
      passed: completed, modelCalls, source, stages, phoneUi: 'REAL_PENDING', thirdPartyMethods: 'REAL_PENDING', goalRuntimeClosure: 'REAL_PENDING', sevenDays: 'REAL_PENDING' }, null, 2), { flag: 'wx' }); }
    finally { await app?.close(); await pool?.end(); }
  });
  it('combines original Memory/method/Goal/resource entry with a real read, preserving source-only evidence and zero execution/Truth', async () => {
    const data = await seed(app);
    const connection = (await request(app.getHttpServer()).post('/api/connections').set(auth(data.owner.token)).send({ connectorId: 'public_http_json',
      externalAccountName: 'Actual public npm metadata', credentials: { endpoint: 'https://registry.npmjs.org/typescript/latest' } }).expect(201)).body;
    await request(app.getHttpServer()).put(`/api/connections/${connection.id}/permissions`).set(auth(data.owner.token)).send({ permissions: [{ capability: 'READ_PUBLIC_HTTP_JSON', granted: true }] }).expect(200);
    const before = await counts(pool, data.owner), c = await conversation(app, data), proposed = await ask(app, data.owner, c.id), payload = proposed.messages.at(-1).structuredPayload;
    expect(payload.result).toBe('ANSWER'); expect(payload.methodRefs).toEqual(methodConversationRequest(data.selected).methodRefs);
    expect(payload.memoryRefs).toContainEqual(expect.objectContaining({ id: data.memory.id })); expect(payload.understanding.policy.executionAuthorized).toBe(false);
    expect(lastRequest!.context.sections.some(section => section.kind === 'UNTRUSTED_SOURCE_CONTENT' && section.content.includes('BETA_MEMORY_SOURCE_BOUNDARY'))).toBe(true);
    stages.push('Real model consumed isolated controlled Memory and pinned method references without execution authority');
    const review = (await request(app.getHttpServer()).get(`/api/conversations/${c.id}/method-resources?version=${proposed.version}`).set(auth(data.owner.token)).expect(200)).body;
    expect(review.methods.flatMap((method: { requirements: Array<{ resources: Array<{ resourceId: string; state: string }> }> }) => method.requirements)
      .flatMap((need: { resources: Array<{ resourceId: string; state: string }> }) => need.resources)).toContainEqual(expect.objectContaining({ resourceId: 'connection:' + connection.id, state: 'READY' }));
    const result = (await request(app.getHttpServer()).post(`/api/connections/${connection.id}/invoke`).set(auth(data.owner.token))
      .send({ capability: 'READ_PUBLIC_HTTP_JSON', requestId: randomUUID(), input: {} }).expect(201)).body;
    expect(result.sourceType).toBe('PUBLIC_HTTP_JSON'); expect(result.verification).toBe('SOURCE_RESPONSE_ONLY'); expect(result.value.name).toBe('typescript'); expect(typeof result.value.version).toBe('string');
    expect(result.value.version.length).toBeGreaterThan(0); expect(Number.isNaN(Date.parse(result.retrievedAt))).toBe(false);
    source = { name: result.value.name, version: result.value.version, observedAt: result.retrievedAt, verification: result.verification };
    stages.push('Actual public HTTPS response through explicitly granted original inspection; no Truth verification claim');
    await surfaces(app, data.owner); expect(await counts(pool, data.owner)).toEqual(before);
    expect(before).toMatchObject({ plans: 0, executions: 0, invocations: 0, deviceTasks: 0, truths: 0 });
    stages.push('Five backing surfaces readable; zero Plan/Execution/Invocation/DeviceTask/Truth created'); completed = true;
  });
});
