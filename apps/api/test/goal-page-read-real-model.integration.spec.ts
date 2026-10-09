import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { deviceAppConnections } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import type { AgentModelAdapter, AgentModelRequest } from '../src/ai-adapter/agent-model-adapter';
import { RemoteAgentModel } from '../src/ai-adapter/remote-agent-model';
import { serverDevelopmentAi } from '../src/ai-provider-config/server-development-ai';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import { DATABASE, type InjectedDatabase } from '../src/common/database.module';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

/** Real remote model; fictional isolated source identity. No phone read or user consent claim. */
describe.skipIf(process.env.PAGE_READ_REAL_MODEL_ACCEPTANCE !== '1').sequential('real model page requirement through the production Goal entry', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, withoutSource: Session;
  let lastRequest: AgentModelRequest | undefined, calls = 0;
  const stages: string[] = [], startedAt = new Date().toISOString();
  const evidenceFile = process.env.PAGE_READ_REAL_MODEL_EVIDENCE;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '3311' || !url.pathname.endsWith('_test')) throw new Error('Isolated 3311 _test database required');
    if (!process.env.REDIS_URL || new URL(process.env.REDIS_URL).pathname !== '/15') throw new Error('Isolated Redis database 15 required');
    if (evidenceFile && existsSync(evidenceFile)) throw new Error('Fresh evidence path required');
    const config = serverDevelopmentAi({ ...process.env, NODE_ENV: 'development' });
    if (!config) throw new Error('Existing explicitly enabled development model required');
    const remote = new RemoteAgentModel({ resolve: async () => config } as unknown as AiProviderConfigService);
    const model: AgentModelAdapter = { modelId: () => remote.modelId(), capability: () => remote.capability(),
      complete: async input => { lastRequest = input; calls++; return remote.complete(input); } };
    ({ app, pool } = await bootP2App('page-real-model-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
    owner = await register(app, randomUUID() + '@example.test', 'Isolated page Goal acceptance');
    withoutSource = await register(app, randomUUID() + '@example.test', 'Isolated no-source owner');
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = keys.publicKey.export({ format: 'der', type: 'spki' });
    const deviceId = 'isolated-page-model-' + randomUUID();
    const challenge = (await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({ deviceId,
      keyId: 'isolated-page-model-key', publicKeySpki: spki.toString('base64'), publicKeyFingerprint: createHash('sha256').update(spki).digest('hex') }).expect(201)).body;
    const enrolled = (await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.challengeId}/verify`).set(auth(owner.token))
      .send({ signature: sign('sha256', Buffer.from(challenge.payload), keys.privateKey).toString('base64') }).expect(201)).body;
    // Fictional source identity supplied only to exercise the real model contract.
    await app.get<InjectedDatabase>(DATABASE).insert(deviceAppConnections).values({ id: newId(), userId: owner.userId,
      deviceId, trustedDeviceId: enrolled.id, packageName: 'com.miui.calculator', displayName: 'Isolated calculator source',
      launchable: true, connectionType: 'generic', enabled: 1, modesJson: ['open_app'], trustLevel: 'key_proven', createdAt: new Date(), updatedAt: new Date() });
  }, 60000);
  afterAll(async () => {
    if (evidenceFile) writeFileSync(evidenceFile, JSON.stringify({ startedAt, completedAt: new Date().toISOString(), model: 'deepseek', calls,
      scope: 'Real model + isolated authenticated Goal entry with fictional source identity; no production data or device execution',
      stages, passed: stages.length === 3, mobileGoldenFlow: 'REAL_PENDING', nativePageObservation: 'REAL_PENDING', userVerification: 'REAL_PENDING',
    }, null, 2), { flag: 'wx' });
    await app?.close(); await pool?.end();
  });
  async function count(userId: string) {
    const [rows] = await pool.query<any[]>(`SELECT
      (SELECT COUNT(*) FROM app_read_sessions WHERE user_id=UUID_TO_BIN(?)) sessions,
      (SELECT COUNT(*) FROM device_tasks WHERE user_id=UUID_TO_BIN(?)) tasks,
      (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,
      (SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths`, [userId, userId, userId, userId]);
    return rows[0];
  }
  async function ask(content: string, session = owner) {
    const before = await count(session.userId);
    const c = (await request(app.getHttpServer()).post('/api/conversations').set(auth(session.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
    const result = (await request(app.getHttpServer()).post(`/api/conversations/${c.id}/messages`).set(auth(session.token))
      .send({ version: c.version, requestId: randomUUID(), content }).expect(201)).body;
    expect(await count(session.userId)).toEqual(before);
    expect((await request(app.getHttpServer()).get('/api/conversations/' + c.id).set(auth(session.token)).expect(200)).body.pageReads).toEqual([]);
    return result.messages.at(-1).structuredPayload;
  }
  it('proposes a bounded page requirement without issuing consent, Task, Truth or a Plan', async () => {
    const p = await ask('请读取我手机计算器当前页面显示的结果。需要先让我核对读取范围，不能猜屏幕内容，也不要替我计算。');
    expect(p.result).toBe('ANSWER');
    expect(p.pageRead).toEqual({ version: 'goal-page-read.v1', packageName: 'com.miui.calculator', fields: ['currentResult'] });
    expect(p.understanding).toMatchObject({ lifecycle: 'TEMPORARY', policy: { confirmationRequired: true, executionAuthorized: false } });
    expect(p.answer.explanation).not.toMatch(/(?:显示|结果是|读到了)[：:]?\s*\d/);
    expect(lastRequest?.workContext).toBe('TEMPORARY');
    stages.push('real model -> bounded page requirement -> original understanding; zero consent/Task/Truth/Plan');
  });
  it('keeps ordinary arithmetic separate from reading a phone page', async () => {
    const p = await ask('请计算17乘以23。只回答算式的结果。');
    expect(p.pageRead ?? null).toBeNull();
    expect(p.understanding.policy.executionAuthorized).toBe(false);
    stages.push('ordinary arithmetic -> no page read or native execution');
  });
  it('does not invent an App identity for an owner with no source', async () => {
    const p = await ask('请读取我手机计算器当前页面显示的结果。', withoutSource);
    expect(p.pageRead ?? null).toBeNull();
    expect(p.understanding.policy.executionAuthorized).toBe(false);
    stages.push('missing owned source -> no invented page requirement, consent or Task');
  });
});
