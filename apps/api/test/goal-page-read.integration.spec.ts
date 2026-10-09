import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceAppConnections, localCapabilityStates } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { AgentPlannerService, AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import type { AgentModelOutput } from '../src/ai-adapter/agent-model-adapter';
import { DATABASE, type InjectedDatabase } from '../src/common/database.module';
import { AppReadSessionsService } from '../src/app-read-sessions/app-read-sessions.service';
import { DeviceTasksService } from '../src/device-tasks/device-tasks.service';
import { StructuredReadService } from '../src/structured-read/structured-read.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

/** Simulated nodes and model in an isolated DB. Never native/UI/model real acceptance. */
describe.sequential('Goal-bound page consent, read identity and original conversation result', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, db: InjectedDatabase;
  let deviceId: string, trustedDeviceId: string, deviceSessionId: string, connectionId: string;
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const packageName = 'com.miui.calculator', field = packageName + ':id/result';
  const proposal: AgentModelOutput = { result: 'ANSWER', intentSummary: '读取手机计算器当前结果', domain: null, scenarioKey: null, scenarioRevision: null,
    strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null,
    explanation: '请核对本次计算器页面读取范围，读取后还需核实。', missingRequirements: [], warnings: [], riskHints: [],
    pageRead: { version: 'goal-page-read.v1', packageName: 'com.miui.calculator', fields: ['currentResult'] } };
  const model = { modelId: () => 'isolated-page-read-fixture', complete: vi.fn(async () => structuredClone(proposal)) };

  beforeAll(async () => {
    ({ app, pool } = await bootP2App('goal-page-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
    db = app.get(DATABASE); owner = await register(app, randomUUID() + '@example.test', 'Page read fixture');
    other = await register(app, randomUUID() + '@example.test', 'Other owner');
    deviceId = 'page-fixture-' + randomUUID();
    const publicKeySpki = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const challenge = (await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({ deviceId,
      keyId: 'page-fixture-key', publicKeySpki, publicKeyFingerprint: hashBuffer(Buffer.from(publicKeySpki, 'base64')) }).expect(201)).body;
    const enrolled = (await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.challengeId}/verify`).set(auth(owner.token))
      .send({ signature: sign('sha256', Buffer.from(challenge.payload), keys.privateKey).toString('base64') }).expect(201)).body;
    trustedDeviceId = enrolled.id; deviceSessionId = enrolled.deviceSession.id; connectionId = newId();
    await db.insert(deviceAppConnections).values({ id: connectionId, userId: owner.userId, deviceId, trustedDeviceId, packageName,
      displayName: '计算器', launchable: true, connectionType: 'generic', enabled: 1, modesJson: ['open_app'], trustLevel: 'key_proven', createdAt: new Date(), updatedAt: new Date() });
    await db.insert(localCapabilityStates).values({ id: newId(), userId: owner.userId, trustedDeviceId, capability: 'accessibility.read', manifestVersion: 'android-local-v5',
      userGrant: true, systemPermission: 'GRANTED', health: 'HEALTHY', checkedAt: new Date(), evidenceRef: 'isolated-page-consent', updatedAt: new Date() });
  });
  beforeEach(async () => {
    model.complete.mockImplementation(async () => structuredClone(proposal));
    await pool.query("UPDATE app_read_sessions SET status='CANCELLED',active_device_key=NULL,ended_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?) AND active_device_key IS NOT NULL", [owner.userId]);
    await pool.query("UPDATE device_app_connections SET enabled=1,launchable=1 WHERE id=UUID_TO_BIN(?)", [connectionId]);
    await pool.query("UPDATE local_capability_states SET user_grant=1,system_permission='GRANTED',health='HEALTHY',checked_at=UTC_TIMESTAMP(6) WHERE user_id=UUID_TO_BIN(?) AND capability='accessibility.read'", [owner.userId]);
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  function hashBuffer(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
  function signed(body: unknown, path: string) {
    const requestId = randomBytes(32).toString('hex'), signedAt = new Date().toISOString(), payloadHash = hash(JSON.stringify(body));
    const bytes = Buffer.from(`lazy-armor-device-request-v1|${deviceSessionId}|${requestId}|POST|${path}|${payloadHash}|${signedAt}`);
    return { 'x-device-session': deviceSessionId, 'x-device-request-id': requestId, 'x-device-signed-at': signedAt,
      'x-device-payload-hash': payloadHash, 'x-device-signature': sign('sha256', bytes, keys.privateKey).toString('base64') };
  }
  async function goal() {
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
    const saved = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token))
      .send({ requestId: randomUUID(), content: '帮我读取手机计算器当前显示结果', version: created.version }).expect(201)).body;
    const message = saved.messages.at(-1);
    expect(message.structuredPayload.pageRead).toEqual(proposal.pageRead);
    expect(message.structuredPayload.understanding).toMatchObject({ lifecycle: 'TEMPORARY', policy: { confirmationRequired: true, executionAuthorized: false } });
    return { conversationId: saved.id as string, messageId: message.id as string, version: saved.version as number };
  }
  type Goal = Awaited<ReturnType<typeof goal>>;
  const path = (g: Goal) => `/conversations/${g.conversationId}/messages/${g.messageId}/page-read/confirm`;
  function confirm(g: Goal, extra = {}) {
    const body = { version: g.version, connectionId, confirmed: true, ...extra };
    return request(app.getHttpServer()).post('/api' + path(g)).set(auth(owner.token)).set(signed(body, path(g))).send(body);
  }
  async function read(g: Goal) {
    const session = (await confirm(g).expect(201)).body;
    const requestBody = { requestId: 'goal-page-' + session.id, sourceType: 'DEVICE_APP' as const, resourceType: 'CalculatorDisplay', resourceId: session.id,
      packageName, appReadSessionId: session.id, requestedFields: [field] };
    const response = await app.get(StructuredReadService).androidRead(owner.userId, requestBody);
    const taskId = response.acceptance.deviceTaskId!;
    await app.get(AppReadSessionsService).heartbeat(owner.userId, session.id, { eventKey: hash(randomUUID()), foregroundPackage: packageName,
      usageAccessGranted: true, nativeStatus: 'READING', observedAt: new Date().toISOString() }, trustedDeviceId);
    const claimed = await app.get(DeviceTasksService).claim(owner.userId, trustedDeviceId, deviceId, taskId);
    const result = { packageName, resourceId: session.id, screenId: session.id, observedAt: new Date().toISOString(),
      nodes: [{ resourceId: field, text: '42', enabled: true, role: 'TextView' }] };
    return { session, requestBody, taskId, claimed, result };
  }
  async function cards(g: Goal) { return (await request(app.getHttpServer()).get('/api/conversations/' + g.conversationId).set(auth(owner.token)).expect(200)).body; }
  async function count(g: Goal) {
    const [rows] = await pool.query<any[]>("SELECT (SELECT COUNT(*) FROM app_read_sessions WHERE user_id=UUID_TO_BIN(?)) sessions,(SELECT COUNT(*) FROM device_tasks WHERE user_id=UUID_TO_BIN(?)) tasks,(SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM source_observations WHERE user_id=UUID_TO_BIN(?)) observations,(SELECT COUNT(*) FROM consumer_messages WHERE conversation_id=UUID_TO_BIN(?)) messages", [owner.userId, owner.userId, owner.userId, owner.userId, g.conversationId]);
    return rows[0];
  }
  it('keeps suggestion separate from consent and rejects unsigned, unconfirmed, owner and scope injection', async () => {
    const g = await goal(), before = await count(g);
    const resources = (await request(app.getHttpServer()).get(`/api/conversations/${g.conversationId}/messages/${g.messageId}/resources?version=${g.version}`).set(auth(owner.token)).expect(200)).body;
    expect(resources.executionAuthorized).toBe(false);
    const review = resources.requirements[0].resources.find((r: { resourceId: string }) => r.resourceId === connectionId);
    expect(review.state).toBe('UNAVAILABLE'); // No online heartbeat in this isolated source fixture.
    const link = new URL(review.action.path, 'https://isolated.test');
    expect(link.searchParams.get('conversationId')).toBe(g.conversationId);
    expect(link.searchParams.get('messageId')).toBe(g.messageId);
    expect(link.searchParams.get('version')).toBe(String(g.version));
    await request(app.getHttpServer()).post('/api' + path(g)).set(auth(owner.token)).send({ version: g.version, connectionId, confirmed: true }).expect(403);
    await confirm(g, { confirmed: false }).expect(400);
    await confirm(g, { requestedFields: ['*'] }).expect(400);
    await request(app.getHttpServer()).post('/api' + path(g)).set(auth(other.token)).set(signed({ version: g.version, connectionId, confirmed: true }, path(g))).send({ version: g.version, connectionId, confirmed: true }).expect(403);
    await confirm(g, { version: g.version - 1 }).expect(409);
    expect(await count(g)).toEqual(before);
    await pool.query("UPDATE local_capability_states SET user_grant=0 WHERE user_id=UUID_TO_BIN(?) AND capability='accessibility.read'", [owner.userId]);
    await confirm(g).expect(403); expect(await count(g)).toEqual(before);
  });
  it('freezes one confirmed version under concurrent confirmation and preserves request identity on start replay', async () => {
    const g = await goal();
    const responses = await Promise.all([0, 1, 2].map(() => confirm(g).expect(201)));
    expect(new Set(responses.map(r => r.body.id)).size).toBe(1);
    const session = responses[0]!.body;
    const req = { requestId: 'goal-page-' + session.id, sourceType: 'DEVICE_APP' as const, resourceType: 'CalculatorDisplay', resourceId: session.id,
      packageName, appReadSessionId: session.id, requestedFields: [field] };
    const starts = await Promise.all([0, 1, 2].map(() => app.get(StructuredReadService).androidRead(owner.userId, req)));
    expect(new Set(starts.map(s => s.acceptance.deviceTaskId)).size).toBe(1);
    await expect(app.get(StructuredReadService).androidRead(owner.userId, { ...req, requestId: 'client-manufactured-request' })).rejects.toThrow(/identity/);
    expect((await cards(g)).pageReads).toEqual([expect.objectContaining({ messageId: g.messageId, conversationVersion: g.version, status: 'READING' })]);
    expect((await count(g)).plans).toBe(0);
  });
  it('returns only a candidate to the original conversation, then consumes exact independently verified Truth without rewriting Task or messages', async () => {
    const g = await goal(), r = await read(g);
    const completed = await app.get(DeviceTasksService).complete(owner.userId, trustedDeviceId, deviceId, r.taskId, r.claimed.claimToken!, r.result);
    const candidateId = (completed.reality as { candidateIds: string[] }).candidateIds[0]!;
    const before = await count(g);
    expect((await cards(g)).pageReads[0]).toMatchObject({ status: 'NEEDS_CONFIRMATION', verified: [], candidates: [{ id: candidateId, status: 'PENDING' }] });
    const proof = (await request(app.getHttpServer()).post('/api/candidates/' + candidateId + '/confirm').set(auth(owner.token)).send({}).expect(201)).body;
    const current = await cards(g);
    expect(current.pageReads[0]).toMatchObject({ status: 'VERIFIED', verified: [{ truthId: proof.id, value: '42', observedAt: r.result.observedAt }] });
    expect(current.version).toBe(g.version);
    await app.get(DeviceTasksService).complete(owner.userId, trustedDeviceId, deviceId, r.taskId, r.claimed.claimToken!, r.result);
    expect(await count(g)).toEqual(before);
    const [task] = await pool.query<any[]>('SELECT status,error_code,result_hash FROM device_tasks WHERE id=UUID_TO_BIN(?)', [r.taskId]);
    expect(task[0]).toMatchObject({ status: 'FAILED', error_code: 'NEEDS_CONFIRMATION' });
    await pool.query('UPDATE truth_records SET revoked_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [proof.id]);
    expect((await cards(g)).pageReads[0]).toMatchObject({ status: 'SOURCE_UNAVAILABLE', verified: [], candidates: [] });
  });
  it('does not consume a file result that reuses the page request identity before the actual Task delivers', async () => {
    const g = await goal(), session = (await confirm(g).expect(201)).body;
    await app.get(StructuredReadService).androidRead(owner.userId, { requestId: 'goal-page-' + session.id, sourceType: 'DEVICE_APP', resourceType: 'CalculatorDisplay', resourceId: session.id,
      packageName, appReadSessionId: session.id, requestedFields: [field] });
    const file = await app.get(StructuredReadService).readFile(owner.userId, { requestId: 'goal-page-' + session.id, sourceType: 'FILE', resourceType: 'CalculatorDisplay', resourceId: session.id,
      requestedFields: ['currentResult'] }, Buffer.from('currentResult: 999'), 'isolated.txt', 'text/plain');
    expect(file.truthRecordIds).toHaveLength(1); // Legitimate isolated file Truth, unrelated to native page acquisition.
    expect((await cards(g)).pageReads[0]).toMatchObject({ status: 'READING', verified: [], candidates: [] });
  });
  it('rejects a goal superseded during acquisition, rolling back candidate evidence and preserving the old Task', async () => {
    const g = await goal(), r = await read(g), before = await count(g);
    await pool.query('UPDATE consumer_conversations SET version=version+1 WHERE id=UUID_TO_BIN(?)', [g.conversationId]);
    await expect(app.get(DeviceTasksService).heartbeat(owner.userId, trustedDeviceId, deviceId, r.taskId, r.claimed.claimToken!)).rejects.toThrow(/goal changed/);
    await expect(app.get(DeviceTasksService).complete(owner.userId, trustedDeviceId, deviceId, r.taskId, r.claimed.claimToken!, r.result)).rejects.toThrow(/goal changed/);
    expect(await count(g)).toEqual(before);
    expect((await cards(g)).pageReads[0]).toMatchObject({ status: 'SUPERSEDED', verified: [], candidates: [] });
  });
  it('never republishes verified content when App source or authority changes', async () => {
    const g = await goal(), r = await read(g);
    const completed = await app.get(DeviceTasksService).complete(owner.userId, trustedDeviceId, deviceId, r.taskId, r.claimed.claimToken!, r.result);
    await request(app.getHttpServer()).post('/api/candidates/' + (completed.reality as { candidateIds: string[] }).candidateIds[0] + '/confirm').set(auth(owner.token)).send({}).expect(201);
    expect((await cards(g)).pageReads[0].status).toBe('VERIFIED');
    await pool.query('UPDATE device_app_connections SET updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [connectionId]);
    expect((await cards(g)).pageReads[0]).toMatchObject({ status: 'SOURCE_UNAVAILABLE', verified: [], candidates: [] });
  });
  it('requires explicit page intent and an owned supported source in the planner', async () => {
    const planner = app.get(AgentPlannerService), facts = { domain: null, scenarios: [], truths: [], tools: [], capabilities: [] };
    const unowned = await planner.planWithFacts('读取手机计算器当前结果', facts, { audit: false, workContext: 'TEMPORARY' });
    expect(unowned.result).toBe('PLANNER_OUTPUT_INVALID');
    const sourceFacts = { ...facts, capabilities: [{ key: 'structured_read.field', connectionId, trustedDeviceId, providerKey: packageName, usable: false, reasons: ['SOURCE_IDENTITY_ONLY'] }] };
    expect((await planner.planWithFacts('2加2等于几', sourceFacts, { audit: false, workContext: 'TEMPORARY' })).result).toBe('PLANNER_OUTPUT_INVALID');
    expect((await planner.planWithFacts('读取手机计算器当前结果', sourceFacts, { audit: false, workContext: 'PLAN' })).result).toBe('PLANNER_OUTPUT_INVALID');
  });
});
