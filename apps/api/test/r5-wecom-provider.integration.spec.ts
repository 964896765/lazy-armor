import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WECOM_CALLBACK_PATH } from '@lazy-armor/config';
import { validateProviderCapabilityManifest, validateProviderRuntimePolicy, type ConnectorRequest } from '@lazy-armor/connector-sdk';
import { parseAndNormalizeObservation, realityValueHash } from '@lazy-armor/plan-schema';
import { WeComProviderAdapter } from '../src/providers/wecom/wecom.adapter';
import { WeComAuthClient, wecomScopes } from '../src/providers/wecom/wecom-auth';
import { WECOM_TRANSPORT, WeComHttpClient, type WeComTransport } from '../src/providers/wecom/wecom-http.client';
import { WECOM_SCOPES, wecomManifest, wecomPolicy, WECOM_EXPLICIT_DENIALS } from '../src/providers/wecom/wecom-manifest';
import { parseWeComEvent, verifyWeComChallenge } from '../src/providers/wecom/wecom-event';
import { createConnectorRegistry } from '../src/connectors/connectors.module';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';

const config = { corpId: 'wwisolatedcorp', agentId: '1000002', appSecret: 'isolated-secret', redirectUri: 'https://api.example.test/api/providers/wecom/oauth/callback', callbackToken: 'isolated-callback-token' };
const ALL_SCOPES = Object.values(WECOM_SCOPES).join(' ');
const key = 'a'.repeat(64);
const credential = { tokenMode: 'USER_OAUTH', accessToken: 'user-access', refreshToken: 'wecom-corp-refresh-marker', refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  scopes: ALL_SCOPES, corpId: 'wwisolatedcorp', agentId: '1000002', userId: 'zhangsan' };
const messageAction = { kind: 'message' as const, touser: 'zhangsan', text: '隔离测试消息' };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const wecomRequest = (capability = 'WECOM_APP_MESSAGE_SEND', fields: Record<string, unknown> = messageAction): ConnectorRequest => ({ capability,
  requestId: 'isolated-request', idempotencyKey: key, input: { context: { wecomAction: fields } }, credentials: { data: credential } });

function router(mutate?: (url: URL, init: RequestInit) => Response | undefined): WeComTransport {
  return vi.fn<WeComTransport>(async (url, init) => {
    const target = new URL(url);
    return mutate?.(target, init) ?? json({ errcode: 0, data: {} });
  });
}

describe('R5-03 WeCom manifest, error mapping and adapter contract (no platform acceptance)', () => {
  it('validates manifest and policy, denies destructive capabilities and expresses real message boundaries', () => {
    expect(() => validateProviderCapabilityManifest(wecomManifest)).not.toThrow();
    expect(() => validateProviderRuntimePolicy(wecomPolicy, wecomManifest)).not.toThrow();
    expect(wecomManifest.providerKey).toBe('wecom'); expect(wecomManifest.providerName).toBe('企业微信 / WeCom');
    expect(wecomManifest.capabilities).toHaveLength(7);
    expect(wecomManifest.capabilities.filter((c) => c.operation === 'execute').every((c) => c.riskLevel === 'R3'
      && c.sideEffectContract.sideEffect && !c.sideEffectContract.supportsIdempotencyKey && c.sideEffectContract.supportsOperationLookup
      && c.sideEffectContract.retrySafety === 'unsafe' && c.verificationMethods.length > 0)).toBe(true);
    expect(WECOM_EXPLICIT_DENIALS).toEqual(expect.arrayContaining(['DELETE_CALENDAR', 'BULK_MESSAGE', 'ADMIN_PERMISSION_CHANGE', 'APPROVAL_FORCE_DECISION']));
    expect(wecomManifest.capabilities.find((c) => c.key === 'WECOM_APP_MESSAGE_EVENT')!.dataBoundary.purpose).toContain('BOT_VISIBLE_MESSAGE_EVENT');
    const disabled = createConnectorRegistry({ NODE_ENV: 'production' }).get('wecom');
    expect(disabled.metadata().productionStatus).toBe('DISABLED');
    expect(disabled.capabilities().every((c) => c.providerAvailability === 'disabled')).toBe(true);
  });
  it('normalizes WeCom resources into a generic Reality Pipeline fact without a provider Engine', () => {
    const payload = { resourceType: 'WeComMessage', resourceId: 'msg_1', corpId: 'wwisolatedcorp', fromUser: 'zhangsan', content: 'hi', updatedAt: new Date().toISOString() };
    const observation = { sourceMode: 'WEBHOOK' as const, providerKey: 'wecom', connectionId: 'owned-connection', externalEventKey: 'isolated-event',
      parserKey: 'generic.wecom-resource.v1' as const, resourceHint: 'WeComMessage', payload, evidenceHash: realityValueHash(payload), observedAt: new Date().toISOString() };
    const fact = parseAndNormalizeObservation(observation)[0];
    expect(fact).toMatchObject({ factKey: 'wecom.resource.state', resourceType: 'WeComResource', subjectKey: 'owned-connection:wwisolatedcorp:WeComMessage:msg_1' });
    expect(() => parseAndNormalizeObservation({ ...observation, connectionId: undefined })).toThrow();
  });
  it('maps WeCom errcode and HTTP status into ProviderRuntimeError without leaking errcode into the Runtime', async () => {
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [200, { errcode: 40014, errmsg: 'invalid access_token' }, 'AUTH_EXPIRED'],
      [200, { errcode: 40001, errmsg: 'invalid credential' }, 'AUTH_REVOKED'],
      [200, { errcode: 48002, errmsg: 'no permission' }, 'PERMISSION_DENIED'],
      [200, { errcode: 45009, errmsg: 'freq limit' }, 'RATE_LIMITED'],
      [200, { errcode: 40003, errmsg: 'invalid userid' }, 'RESOURCE_NOT_FOUND'],
      [503, { errcode: 500, errmsg: 'server error' }, 'PROVIDER_UNAVAILABLE'],
      [401, { errcode: 0, errmsg: 'unauthorized' }, 'AUTH_EXPIRED'],
      [403, { errcode: 0, errmsg: 'forbidden' }, 'PERMISSION_DENIED'],
    ];
    for (const [status, body, code] of cases) {
      const transport = router(() => json(body, status));
      const http = new WeComHttpClient(transport);
      await expect(http.object('https://qyapi.weixin.qq.com/cgi-bin/message/get')).rejects.toMatchObject({ code, name: 'ProviderRuntimeError' });
    }
  });
  it('times out and normalizes network failure without retrying a write', async () => {
    const hanging = router(() => new Promise<Response>(() => undefined));
    await expect(new WeComHttpClient(hanging, 30).object('https://qyapi.weixin.qq.com/cgi-bin/message/get')).rejects.toMatchObject({ code: 'TIMEOUT' });
    const broken = router(() => { throw new Error('ECONNREFUSED'); });
    await expect(new WeComHttpClient(broken).object('https://qyapi.weixin.qq.com/cgi-bin/message/get')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('runs the member OAuth lifecycle (authorize -> exchange) and refuses an expired refresh', async () => {
    const transport = router((url) => {
      if (url.pathname === '/cgi-bin/gettoken') return json({ errcode: 0, access_token: 'corp-token', expires_in: 7200 });
      if (url.pathname === '/cgi-bin/auth/getuserinfo') return json({ errcode: 0, userid: 'zhangsan' });
      return undefined;
    });
    const authClient = new WeComAuthClient(config, new WeComHttpClient(transport));
    const started = authClient.start({ userId: 'u', state: 's'.repeat(48), redirectUri: config.redirectUri });
    expect(started.authorizationUrl).toContain('connect/oauth2/authorize');
    const token = await authClient.exchange({ userId: 'u', state: 's'.repeat(48), code: 'primary', redirectUri: config.redirectUri });
    expect(token.credentials).toMatchObject({ tokenMode: 'USER_OAUTH', corpId: 'wwisolatedcorp', userId: 'zhangsan' });
    expect(token.credentials.appSecret).toBeUndefined();
    await expect(authClient.refresh({ credential: { ...token.credentials, refreshExpiresAt: new Date(Date.now() - 1000).toISOString() } })).rejects.toMatchObject({ code: 'AUTH_REVOKED' });
  });
  it('projects scopes and capabilities and refuses a write without structured approved context', async () => {
    const transport = router((url) => url.pathname === '/cgi-bin/user/get' ? json({ errcode: 0, userid: 'zhangsan' }) : undefined);
    const adapter = new WeComProviderAdapter(new WeComAuthClient(config, new WeComHttpClient(transport)), new WeComHttpClient(transport));
    expect(adapter.capabilities()).toHaveLength(7);
    await expect(adapter.execute({ ...wecomRequest(), input: {} })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(adapter.execute({ ...wecomRequest(), idempotencyKey: undefined })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(adapter.execute({ ...wecomRequest(), credentials: { data: { ...credential, scopes: 'calendar:read' } } })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
    expect(wecomScopes('snsapi_base message:send')).toEqual(['message:send', 'snsapi_base']);
    expect(() => wecomScopes('bad scope!')).toThrow();
  });
  it('sends one message, verifies by read-back and reconciles by bounded POST', async () => {
    let posts = 0;
    const transport = router((url, init) => {
      if (url.pathname === '/cgi-bin/user/get') return json({ errcode: 0, userid: 'zhangsan' });
      if (url.pathname === '/cgi-bin/message/send' && init.method === 'POST') { posts++; return json({ errcode: 0, msgid: 'msg_1' }); }
      if (url.pathname === '/cgi-bin/message/get') return json({ errcode: 0, msgid: 'msg_1', text: { content: messageAction.text } });
      return undefined;
    });
    const adapter = new WeComProviderAdapter(new WeComAuthClient(config, new WeComHttpClient(transport)), new WeComHttpClient(transport));
    const result = await adapter.execute(wecomRequest());
    expect(result.data.verificationEvidence).toMatchObject({ matched: true, resourceId: 'msg_1' });
    expect(posts).toBe(1);
    const lookup = await adapter.lookupOperation({ ...wecomRequest(), input: { context: { wecomAction: messageAction }, resourceId: 'msg_1' } });
    expect(lookup.data.verificationEvidence).toMatchObject({ matched: true });
  });
  it('verifies WeCom callback signature and challenge handshake', () => {
    const token = config.callbackToken;
    const body = JSON.stringify({ ToUserName: 'wwisolatedcorp', FromUserName: 'zhangsan', CreateTime: String(Math.floor(Date.now() / 1000)), MsgType: 'text', Content: 'hi', MsgId: 'msg_1' });
    const { timestamp, nonce, signature } = signWeCom(body, token);
    const parsed = parseWeComEvent({ rawBody: Buffer.from(body), signature, timestamp, nonce, token });
    expect(parsed).toMatchObject({ type: 'event', event: { eventId: 'msg_1', corpId: 'wwisolatedcorp' } });
    expect(verifyWeComChallenge({ token, timestamp, nonce, signature: signWeCom('challenge123', token).signature, echostr: 'challenge123' })).toEqual({ challenge: 'challenge123' });
    expect(() => parseWeComEvent({ rawBody: Buffer.from(body), signature: 'deadbeef'.repeat(5), timestamp, nonce, token })).toThrow();
    expect(() => verifyWeComChallenge({ token, timestamp, nonce, signature: 'deadbeef'.repeat(5), echostr: 'challenge123' })).toThrow();
  });
});

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');
function signWeCom(payload: string, token: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce123';
  const signature = sha1([token, timestamp, nonce, payload].sort().join(''));
  return { timestamp, nonce, signature };
}

const enabled = process.env.RUN_REAL_DB_INTEGRATION === '1';

describe.skipIf(!enabled).sequential('R5-03 WeCom local TCP golden journeys', { timeout: 120_000 }, () => {
  let app: INestApplication; let pool: Pool; let server: Server; let endpoint: string; let owner: Session; let other: Session; let worker: ExecutionWorker; let connection: string;
  let gettokenCalls = 0; let mutations = 0; let limited = false; let denyUserInfo = false;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const keys = ['WECOM_CORP_ID', 'WECOM_AGENT_ID', 'WECOM_APP_SECRET', 'WECOM_OAUTH_REDIRECT_URI', 'WECOM_CALLBACK_TOKEN', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const calendar = { schedule_id: 'sched_1', summary: '项目例会', start_time: String(Math.floor(Date.now() / 1000) + 3600), end_time: String(Math.floor(Date.now() / 1000) + 7200), status: 'NORMAL', update_time: String(Math.floor(Date.now() / 1000)) };

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks).toString();
      const url = new URL(req.url!, 'http://isolated.test'); res.setHeader('content-type', 'application/json');
      const path = url.pathname;
      if (path === '/cgi-bin/gettoken') { gettokenCalls++; res.end(JSON.stringify({ errcode: 0, access_token: 'isolated-corp-token', expires_in: 7200 })); return; }
      if (path === '/cgi-bin/auth/getuserinfo') { res.end(JSON.stringify({ errcode: 0, userid: 'zhangsan' })); return; }
      if (path === '/cgi-bin/user/get') { if (denyUserInfo) { res.statusCode = 401; res.end(JSON.stringify({ errcode: 40014, errmsg: 'invalid access_token' })); return; } res.end(JSON.stringify({ errcode: 0, userid: 'zhangsan' })); return; }
      if (limited) { res.statusCode = 429; res.end(JSON.stringify({ errcode: 45009, errmsg: 'freq limit' })); return; }
      if (path === '/cgi-bin/oa/schedule/get_by_calendar' && req.method === 'POST') { res.end(JSON.stringify({ errcode: 0, schedule_list: [calendar] })); return; }
      if (path === '/cgi-bin/message/send' && req.method === 'POST') { mutations++; res.end(JSON.stringify({ errcode: 0, msgid: 'msg_1' })); return; }
      if (path === '/cgi-bin/message/get' && req.method === 'POST') { res.end(JSON.stringify({ errcode: 0, msgid: 'msg_1', text: { content: '隔离测试消息' } })); return; }
      void body;
      res.statusCode = 404; res.end(JSON.stringify({ errcode: 40003, errmsg: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.WECOM_CORP_ID = config.corpId; process.env.WECOM_AGENT_ID = config.agentId; process.env.WECOM_APP_SECRET = config.appSecret;
    process.env.WECOM_OAUTH_REDIRECT_URI = 'https://api.example.test' + WECOM_CALLBACK_PATH; process.env.WECOM_CALLBACK_TOKEN = config.callbackToken;
    process.env.REDIS_KEY_PREFIX = 'lazy-armor-wecom-isolated-' + unique;
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    const prePool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
    await prePool.query("DELETE FROM provider_runtime_policies WHERE provider_key='wecom'");
    await prePool.query("DELETE FROM verification_policies WHERE policy_key LIKE 'wecom.%'");
    await prePool.query("DELETE FROM provider_capability_evidence WHERE provider_key='wecom'");
    await prePool.query("DELETE FROM provider_capability_manifests WHERE provider_key='wecom'");
    await prePool.end();
    const transport: WeComTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool, worker } = await bootP2App('wecom-' + unique, [{ token: WECOM_TRANSPORT, value: transport }]));
    app.get(ProviderCapabilityRegistryService).installRevision(wecomManifest);
    owner = await register(app, 'wecom-owner-' + unique + '@example.com', 'WeCom owner'); other = await register(app, 'wecom-other-' + unique + '@example.com', 'Other');
  });
  afterAll(async () => {
    if (pool) await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='wecom'");
    await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
  async function start() { const result = await request(app.getHttpServer()).post('/api/providers/wecom/authorize').set(auth(owner.token)).send({}).expect(201); return new URL(result.body.authorizationUrl).searchParams.get('state')!; }
  it('consumes one OAuth state once, keeps status AWAITING markers and never exposes credentials', async () => {
    await request(app.getHttpServer()).post('/api/providers/wecom/authorize').send({}).expect(401);
    const state = await start();
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    await request(app.getHttpServer()).get(WECOM_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(200);
    await request(app.getHttpServer()).get(WECOM_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(403);
    const status = await request(app.getHttpServer()).get('/api/providers/wecom/status').set(auth(owner.token)).expect(200);
    expect(status.body).toMatchObject({ appConfigured: true, realAccountAcceptance: 'AWAITING_WECOM_OAUTH_EVIDENCE', eventAcceptance: 'AWAITING_WECOM_EVENT_EVIDENCE' });
    const [conns] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM connections WHERE user_id=UUID_TO_BIN(?)", [owner.userId]);
    connection = conns[0].id;
    const [creds] = await pool.query<RowDataPacket[]>('SELECT current_version FROM credential_refs WHERE id=(SELECT credential_ref_id FROM connections WHERE id=UUID_TO_BIN(?))', [connection]);
    expect(creds[0]).toBeDefined();
    expect(JSON.stringify(await request(app.getHttpServer()).get('/api/connections').set(auth(owner.token)).expect(200))).not.toContain('isolated-secret');
  });
  it('projects the six-dimension readiness and all 7 capabilities as usable after health', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
    expect(view.capabilities).toHaveLength(7);
    expect(view.capabilities.every((c) => c.usable)).toBe(true);
    await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/observations`).set(auth(other.token)).send({ capability: 'WECOM_CALENDAR_READ', calendarId: 'wecom_cal' }).expect(404);
  });
  it('Journey A: calendar Source -> Observation -> Candidate -> VERIFIED Truth', async () => {
    const reply = await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'WECOM_CALENDAR_READ', calendarId: 'wecom_cal' }).expect(201);
    const observation = reply.body.observations[0];
    expect(observation.candidates[0].value).toMatchObject({ title: '项目例会' });
    expect(observation.truth[0]).toMatchObject({ status: 'verified' });
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND fact_key='calendar_event.schedule'", [owner.userId]);
    expect(facts.length).toBeGreaterThan(0);
  });
  it('Journey A (webhook): signed message event -> dedupe -> Reality Pipeline -> Truth', async () => {
    const payload = { ToUserName: 'wwisolatedcorp', FromUserName: 'zhangsan', CreateTime: String(Math.floor(Date.now() / 1000)), MsgType: 'text', Content: 'webhook hi', MsgId: 'msg_w1' };
    const body = JSON.stringify(payload);
    const { timestamp, nonce, signature } = signWeCom(body, config.callbackToken);
    const reply = await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/webhook`).query({ msg_signature: signature, timestamp, nonce }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(200);
    expect(reply.body).toMatchObject({ duplicate: false, truthConfirmed: true });
    const duplicate = await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/webhook`).query({ msg_signature: signature, timestamp, nonce }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(200);
    expect(duplicate.body).toMatchObject({ duplicate: true });
    const [truths] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) c FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='WeComResource'", [owner.userId]);
    expect(Number(truths[0].c)).toBe(1);
  });
  it('rejects invalid signature and wrong tenant webhook targets', async () => {
    const badPayload = { ToUserName: 'wwwrong', FromUserName: 'zhangsan', CreateTime: String(Math.floor(Date.now() / 1000)), MsgType: 'text', Content: 'x', MsgId: 'msg_w2' };
    const body = JSON.stringify(badPayload);
    await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/webhook`).query({ msg_signature: 'deadbeef'.repeat(5), timestamp: String(Math.floor(Date.now() / 1000)), nonce: 'nonce123' }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(403);
    const { timestamp, nonce, signature } = signWeCom(body, config.callbackToken);
    await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/webhook`).query({ msg_signature: signature, timestamp, nonce }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(403);
  });
  it('handles echostr challenge handshake', async () => {
    const { timestamp, nonce, signature } = signWeCom('challenge123', config.callbackToken);
    const reply = await request(app.getHttpServer()).get(`/api/providers/wecom/connections/${connection}/webhook`).query({ msg_signature: signature, timestamp, nonce, echostr: 'challenge123' }).set('X-Forwarded-Proto', 'https').expect(200);
    expect(reply.body).toEqual({ challenge: 'challenge123' });
  });
  it('refreshes an expiring credential through the existing version store', async () => {
    const before = gettokenCalls;
    await request(app.getHttpServer()).post(`/api/connections/${connection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: { ...credential, expiresAt: new Date(Date.now() + 30000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() } }).expect(201);
    await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'WECOM_CALENDAR_READ', calendarId: 'wecom_cal' }).expect(201);
    expect(gettokenCalls).toBeGreaterThan(before);
  });
  it('marks the connection reauthorization_required on 401 and blocks reads', async () => {
    denyUserInfo = true;
    try { await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'WECOM_CALENDAR_READ', calendarId: 'wecom_cal' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400)); }
    finally { denyUserInfo = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('Journey B: Plan -> Risk -> Approval -> CapabilityResolver -> WeCom send -> Verification', async () => {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: 'WeCom send ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId: connection, requiredCapability: 'WECOM_APP_MESSAGE_SEND', config: { visibility: 'private' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, owner.token, plan.body.id);
    const run = await request(app.getHttpServer()).post(`/api/plans/${plan.body.id}/executions`).set(auth(owner.token)).send({ requestId: unique, triggerPayload: { wecomAction: messageAction } }).expect(201);
    await worker.processExecution(run.body.id);
    const waiting = await request(app.getHttpServer()).get(`/api/executions/${run.body.id}`).set(auth(owner.token)).expect(200);
    expect(waiting.body.status).toBe('waiting_approval');
    expect(mutations).toBe(0);
    await request(app.getHttpServer()).post('/api/approvals/' + waiting.body.approvals[0].id + '/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(run.body.id);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [run.body.id]);
    expect(messages).toHaveLength(1);
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE'); const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER');
    const claims = (await Promise.all([outbox.claim(1000, unique + 'a'), outbox.claim(1000, unique + 'b')])).flat().filter((m) => m.id === messages[0].id);
    expect(claims).toHaveLength(1);
    await Promise.all([dispatcher.process(claims[0]), dispatcher.process(claims[0])]);
    expect(mutations).toBe(1);
    const [evidence] = await pool.query<RowDataPacket[]>("SELECT ve.result_state FROM verification_evidence ve INNER JOIN side_effect_operations op ON op.id=ve.operation_id WHERE op.execution_id=UUID_TO_BIN(?)", [run.body.id]);
    expect(evidence.some((e) => e.result_state === 'SUCCEEDED')).toBe(true);
    await dispatcher.process(claims[0]); expect(mutations).toBe(1);
  });
  it('maps rate-limit HTTP 429 into Runtime Health without immediate retry', async () => {
    limited = true;
    try {
      const result = await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'WECOM_CALENDAR_READ', calendarId: 'wecom_cal' }).expect(400);
      expect(result.body).toMatchObject({ category: 'RATE_LIMITED', providerCode: 'RATE_LIMITED' });
      const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
      expect(view.capabilities.find((c) => c.key === 'WECOM_CALENDAR_READ')).toMatchObject({ health: 'RATE_LIMITED', usable: false });
    } finally { limited = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('revokes the connection and closes all capability grants', async () => {
    await request(app.getHttpServer()).delete(`/api/connections/${connection}`).set(auth(owner.token)).expect(204);
    await request(app.getHttpServer()).post(`/api/providers/wecom/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'WECOM_CALENDAR_READ', calendarId: 'wecom_cal' }).expect(403);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
    expect(view.capabilities.every((c) => !c.usable)).toBe(true);
  });
});
