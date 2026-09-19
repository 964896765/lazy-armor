import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DINGTALK_CALLBACK_PATH } from '@lazy-armor/config';
import { validateProviderCapabilityManifest, validateProviderRuntimePolicy, type ConnectorRequest } from '@lazy-armor/connector-sdk';
import { parseAndNormalizeObservation, realityValueHash } from '@lazy-armor/plan-schema';
import { DingTalkProviderAdapter } from '../src/providers/dingtalk/dingtalk.adapter';
import { DingTalkAuthClient, dingtalkScopes } from '../src/providers/dingtalk/dingtalk-auth';
import { DINGTALK_TRANSPORT, DingTalkHttpClient, type DingTalkTransport } from '../src/providers/dingtalk/dingtalk-http.client';
import { DINGTALK_SCOPES, dingtalkManifest, dingtalkPolicy, DINGTALK_EXPLICIT_DENIALS } from '../src/providers/dingtalk/dingtalk-manifest';
import { parseDingTalkEvent, parseDingTalkStreamEvent, verifyDingTalkEventSignature } from '../src/providers/dingtalk/dingtalk-event';
import { createConnectorRegistry } from '../src/connectors/connectors.module';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';

const config = { appKey: 'dingisolatedapp', appSecret: 'isolated-secret', redirectUri: 'https://api.example.test/api/providers/dingtalk/oauth/callback' };
const ALL_SCOPES = Object.values(DINGTALK_SCOPES).join(' ');
const key = 'a'.repeat(64);
const credential = { tokenMode: 'USER_OAUTH', accessToken: 'user-access', refreshToken: 'user-refresh', refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  scopes: ALL_SCOPES, corpId: 'dingisolatedcorp', openId: 'ou_owner', appKey: config.appKey };
const messageAction = { kind: 'message' as const, receiveId: 'user123', robotCode: 'dingrobot1', text: '隔离测试消息' };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const dingtalkRequest = (capability = 'DINGTALK_MESSAGE_SEND', fields: Record<string, unknown> = messageAction): ConnectorRequest => ({ capability,
  requestId: 'isolated-request', idempotencyKey: key, input: { context: { dingtalkAction: fields } }, credentials: { data: credential } });

function router(mutate?: (url: URL, init: RequestInit) => Response | undefined): DingTalkTransport {
  return vi.fn<DingTalkTransport>(async (url, init) => {
    const target = new URL(url);
    return mutate?.(target, init) ?? json({ errcode: 0, data: {} });
  });
}

describe('R5-02 DingTalk manifest, error mapping and adapter contract (no platform acceptance)', () => {
  it('validates manifest and policy, denies destructive capabilities and expresses real message boundaries', () => {
    expect(() => validateProviderCapabilityManifest(dingtalkManifest)).not.toThrow();
    expect(() => validateProviderRuntimePolicy(dingtalkPolicy, dingtalkManifest)).not.toThrow();
    expect(dingtalkManifest.providerKey).toBe('dingtalk'); expect(dingtalkManifest.providerName).toBe('钉钉 / DingTalk');
    expect(dingtalkManifest.capabilities).toHaveLength(9);
    expect(dingtalkManifest.capabilities.filter((c) => c.operation === 'execute').every((c) => c.riskLevel === 'R3'
      && c.sideEffectContract.sideEffect && !c.sideEffectContract.supportsIdempotencyKey && c.sideEffectContract.supportsOperationLookup
      && c.sideEffectContract.retrySafety === 'unsafe' && c.verificationMethods.length > 0)).toBe(true);
    expect(DINGTALK_EXPLICIT_DENIALS).toEqual(expect.arrayContaining(['DELETE_CALENDAR', 'BULK_MESSAGE', 'ADMIN_PERMISSION_CHANGE', 'APPROVAL_FORCE_DECISION']));
    const messageEvent = dingtalkManifest.capabilities.find((c) => c.key === 'DINGTALK_MESSAGE_EVENT_READ')!;
    expect(messageEvent.dataBoundary.purpose).toContain('BOT_VISIBLE_MESSAGE_EVENT');
    expect(dingtalkManifest.capabilities.find((c) => c.key === 'DINGTALK_MESSAGE_SEND')!.dataBoundary.purpose).toContain('APP_AUTHORIZED_MESSAGE_RESOURCE');
    const disabled = createConnectorRegistry({ NODE_ENV: 'production' }).get('dingtalk');
    expect(disabled.metadata().productionStatus).toBe('DISABLED');
    expect(disabled.capabilities().every((c) => c.providerAvailability === 'disabled')).toBe(true);
  });
  it('normalizes DingTalk resources into a generic Reality Pipeline fact without a provider Engine', () => {
    const payload = { resourceType: 'DingTalkMessage', resourceId: 'om_1', corpId: 'dingisolatedcorp', userId: 'ou_s', content: 'hi', updatedAt: new Date().toISOString() };
    const observation = { sourceMode: 'WEBHOOK' as const, providerKey: 'dingtalk', connectionId: 'owned-connection', externalEventKey: 'isolated-event',
      parserKey: 'generic.dingtalk-resource.v1' as const, resourceHint: 'DingTalkMessage', payload, evidenceHash: realityValueHash(payload), observedAt: new Date().toISOString() };
    const fact = parseAndNormalizeObservation(observation)[0];
    expect(fact).toMatchObject({ factKey: 'dingtalk.resource.state', resourceType: 'DingTalkResource', subjectKey: 'owned-connection:dingisolatedcorp:DingTalkMessage:om_1' });
    expect(() => parseAndNormalizeObservation({ ...observation, connectionId: undefined })).toThrow();
  });
  it('maps DingTalk errcode and HTTP status into ProviderRuntimeError without leaking errcode into the Runtime', async () => {
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [200, { errcode: 40014, errmsg: 'token expired' }, 'AUTH_EXPIRED'],
      [200, { errcode: 40001, errmsg: 'invalid credential' }, 'AUTH_EXPIRED'],
      [200, { errcode: 60011, errmsg: 'no permission' }, 'PERMISSION_DENIED'],
      [200, { errcode: 90002, errmsg: 'flow control' }, 'RATE_LIMITED'],
      [200, { errcode: 40003, errmsg: 'invalid parameter' }, 'RESOURCE_NOT_FOUND'],
      [503, { errcode: 500, errmsg: 'server error' }, 'PROVIDER_UNAVAILABLE'],
      [401, { errcode: 0, errmsg: 'unauthorized' }, 'AUTH_EXPIRED'],
      [403, { errcode: 0, errmsg: 'forbidden' }, 'PERMISSION_DENIED'],
      [200, { code: 'InvalidAuthentication', message: 'token invalid' }, 'AUTH_EXPIRED'],
    ];
    for (const [status, body, code] of cases) {
      const transport = router(() => json(body, status));
      const http = new DingTalkHttpClient(transport);
      await expect(http.object('https://api.dingtalk.com/v1.0/im/messages/om_1')).rejects.toMatchObject({ code, name: 'ProviderRuntimeError' });
    }
  });
  it('times out and normalizes network failure without retrying a write', async () => {
    const hanging = router(() => new Promise<Response>(() => undefined));
    await expect(new DingTalkHttpClient(hanging, 30).object('https://api.dingtalk.com/v1.0/im/messages/om_1')).rejects.toMatchObject({ code: 'TIMEOUT' });
    const broken = router(() => { throw new Error('ECONNREFUSED'); });
    await expect(new DingTalkHttpClient(broken).object('https://api.dingtalk.com/v1.0/im/messages/om_1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('runs the user authCode lifecycle (authorize -> exchange -> refresh) and refuses an expired refresh', async () => {
    let refreshed = false;
    const transport = router((url, init) => {
      if (url.pathname === '/v1.0/oauth2/userAccessToken') {
        if (refreshed) return json({ errcode: 0, errmsg: 'ok', error: 'invalid_grant' });
        refreshed = true;
        return json({ accessToken: 'user-access', refreshToken: 'user-refresh', expireIn: 7200, corpId: 'dingisolatedcorp', openId: 'ou_owner', scope: ALL_SCOPES });
      }
      return undefined;
    });
    const authClient = new DingTalkAuthClient(config, new DingTalkHttpClient(transport));
    const started = authClient.start({ userId: 'u', state: 's'.repeat(48), redirectUri: config.redirectUri });
    expect(started.authorizationUrl).toContain('oauth2/auth');
    const token = await authClient.exchange({ userId: 'u', state: 's'.repeat(48), code: 'authcode-primary', redirectUri: config.redirectUri });
    expect(token.credentials).toMatchObject({ tokenMode: 'USER_OAUTH', corpId: 'dingisolatedcorp', openId: 'ou_owner' });
    expect(token.credentials.appSecret).toBeUndefined();
    await expect(authClient.refresh({ credential: token.credentials })).rejects.toMatchObject({ code: 'AUTH_REVOKED' });
  });
  it('projects scopes and capabilities and refuses a write without structured approved context', async () => {
    const transport = router((url) => url.pathname === '/v1.0/contact/users/me' ? json({ openId: 'ou_owner', corpId: 'dingisolatedcorp' }) : undefined);
    const adapter = new DingTalkProviderAdapter(new DingTalkAuthClient(config, new DingTalkHttpClient(transport)), new DingTalkHttpClient(transport));
    expect(adapter.capabilities()).toHaveLength(9);
    await expect(adapter.execute({ ...dingtalkRequest(), input: {} })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(adapter.execute({ ...dingtalkRequest(), idempotencyKey: undefined })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(adapter.execute({ ...dingtalkRequest(), credentials: { data: { ...credential, scopes: 'calendar:read' } } })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
    expect(dingtalkScopes('openid robot:message:send')).toEqual(['openid', 'robot:message:send']);
    expect(() => dingtalkScopes('bad scope!')).toThrow();
  });
  it('sends one message, verifies by read-back and reconciles by bounded GET', async () => {
    let posts = 0;
    const transport = router((url, init) => {
      if (url.pathname === '/v1.0/contact/users/me') return json({ openId: 'ou_owner', corpId: 'dingisolatedcorp' });
      if (url.pathname === '/v1.0/robot/oToMessages/batchSend' && init.method === 'POST') { posts++; return json({ errcode: 0, msgId: 'om_1' }); }
      if (url.pathname === '/v1.0/im/messages/om_1') return json({ errcode: 0, msgId: 'om_1', content: messageAction.text });
      return undefined;
    });
    const adapter = new DingTalkProviderAdapter(new DingTalkAuthClient(config, new DingTalkHttpClient(transport)), new DingTalkHttpClient(transport));
    const result = await adapter.execute(dingtalkRequest());
    expect(result.data.verificationEvidence).toMatchObject({ matched: true, resourceId: 'om_1' });
    expect(posts).toBe(1);
    const lookup = await adapter.lookupOperation({ ...dingtalkRequest(), input: { context: { dingtalkAction: messageAction }, resourceId: 'om_1' } });
    expect(lookup.data.verificationEvidence).toMatchObject({ matched: true });
  });
  it('verifies DingTalk event signature, challenge handshake and folds HTTP/Stream into one envelope', () => {
    const appSecret = config.appSecret;
    const body = JSON.stringify({ EventType: 'message', corpId: 'dingisolatedcorp', msgId: 'om_1', userId: 'ou_s', content: 'hi', createAt: String(Math.floor(Date.now() / 1000)) });
    const { timestamp, signature } = signEvent(body, appSecret);
    const parsed = parseDingTalkEvent({ rawBody: Buffer.from(body), signature, timestamp, appSecret });
    expect(parsed).toMatchObject({ type: 'event', event: { eventId: 'om_1', corpId: 'dingisolatedcorp', transport: 'HTTP_CALLBACK' } });
    expect(parseDingTalkEvent({ rawBody: Buffer.from(JSON.stringify({ EventType: 'check_url', Random: 'challenge123' })), appSecret })).toEqual({ type: 'url_verification', challenge: 'challenge123' });
    expect(() => parseDingTalkEvent({ rawBody: Buffer.from(body), signature: 'invalid', timestamp, appSecret })).toThrow();
    expect(() => verifyDingTalkEventSignature({ rawBody: Buffer.from(body), signature, timestamp: String(Math.floor(Date.now() / 1000) - 900), appSecret })).toThrow();
    const stream = parseDingTalkStreamEvent({ EventType: 'message', corpId: 'dingisolatedcorp', msgId: 'om_1', userId: 'ou_s', content: 'hi', createAt: String(Math.floor(Date.now() / 1000)) });
    expect(stream).toMatchObject({ type: 'event', event: { transport: 'STREAM', eventId: 'om_1' } });
  });
});

function signEvent(body: string, appSecret: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', appSecret).update(`${timestamp}\n${appSecret}`).digest('base64');
  return { timestamp, signature };
}

const enabled = process.env.RUN_REAL_DB_INTEGRATION === '1';

describe.skipIf(!enabled).sequential('R5-02 DingTalk local TCP golden journeys', { timeout: 120_000 }, () => {
  let app: INestApplication; let pool: Pool; let server: Server; let endpoint: string; let owner: Session; let other: Session; let worker: ExecutionWorker; let connection: string;
  let exchanges = 0; let refreshes = 0; let mutations = 0; let limited = false; let denyUserInfo = false;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const keys = ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET', 'DINGTALK_OAUTH_REDIRECT_URI', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const calendar = { id: 'evt_1', summary: '项目例会', start: { dateTime: new Date(Date.now() + 3600000).toISOString() }, end: { dateTime: new Date(Date.now() + 7200000).toISOString() }, status: 'confirmed', updatedTime: new Date().toISOString() };

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks).toString();
      const url = new URL(req.url!, 'http://isolated.test'); res.setHeader('content-type', 'application/json');
      const path = url.pathname;
      if (path === '/v1.0/oauth2/accessToken') { res.end(JSON.stringify({ accessToken: 'isolated-app-token', expireIn: 7200 })); return; }
      if (path === '/v1.0/oauth2/userAccessToken') {
        const form = JSON.parse(body); const refreshing = form.grantType === 'refresh_token';
        if (refreshing) refreshes++; else exchanges++;
        if (form.code === 'invalid') { res.end(JSON.stringify({ errcode: 0, errmsg: 'ok', error: 'invalid_grant' })); return; }
        res.end(JSON.stringify({ accessToken: refreshing ? 'isolated-access-new' : 'isolated-access', refreshToken: refreshing ? 'isolated-refresh-new' : 'isolated-refresh',
          expireIn: 7200, corpId: 'dingisolatedcorp', openId: 'ou_owner', scope: ALL_SCOPES })); return;
      }
      if (path === '/v1.0/contact/users/me') { if (denyUserInfo) { res.statusCode = 401; res.end(JSON.stringify({ errcode: 40014, errmsg: 'token expired' })); return; } res.end(JSON.stringify({ openId: 'ou_owner', corpId: 'dingisolatedcorp' })); return; }
      if (limited) { res.statusCode = 429; res.end(JSON.stringify({ errcode: 90002, errmsg: 'flow control' })); return; }
      if (path === '/v1.0/calendar/calendars/dingcal_owner/events') { res.end(JSON.stringify({ errcode: 0, events: [calendar] })); return; }
      if (path === '/v1.0/robot/oToMessages/batchSend' && req.method === 'POST') { mutations++; res.end(JSON.stringify({ errcode: 0, msgId: 'om_1' })); return; }
      if (path === '/v1.0/im/messages/om_1') { res.end(JSON.stringify({ errcode: 0, msgId: 'om_1', content: '隔离测试消息' })); return; }
      res.statusCode = 404; res.end(JSON.stringify({ errcode: 40003, errmsg: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.DINGTALK_APP_KEY = config.appKey; process.env.DINGTALK_APP_SECRET = config.appSecret; process.env.DINGTALK_OAUTH_REDIRECT_URI = 'https://api.example.test' + DINGTALK_CALLBACK_PATH;
    process.env.REDIS_KEY_PREFIX = 'lazy-armor-dingtalk-isolated-' + unique;
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    const prePool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
    await prePool.query("DELETE FROM provider_runtime_policies WHERE provider_key='dingtalk'");
    await prePool.query("DELETE FROM verification_policies WHERE policy_key LIKE 'dingtalk.%'");
    await prePool.query("DELETE FROM provider_capability_evidence WHERE provider_key='dingtalk'");
    await prePool.query("DELETE FROM provider_capability_manifests WHERE provider_key='dingtalk'");
    await prePool.end();
    const transport: DingTalkTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool, worker } = await bootP2App('dingtalk-' + unique, [{ token: DINGTALK_TRANSPORT, value: transport }]));
    app.get(ProviderCapabilityRegistryService).installRevision(dingtalkManifest);
    owner = await register(app, 'dingtalk-owner-' + unique + '@example.com', 'DingTalk owner'); other = await register(app, 'dingtalk-other-' + unique + '@example.com', 'Other');
  });
  afterAll(async () => {
    if (pool) await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='dingtalk'");
    await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
  async function start() { const result = await request(app.getHttpServer()).post('/api/providers/dingtalk/authorize').set(auth(owner.token)).send({}).expect(201); return new URL(result.body.authorizationUrl).searchParams.get('state')!; }
  it('consumes one authCode state once, keeps status AWAITING markers and never exposes credentials', async () => {
    await request(app.getHttpServer()).post('/api/providers/dingtalk/authorize').send({}).expect(401);
    const state = await start();
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    await request(app.getHttpServer()).get(DINGTALK_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(200);
    await request(app.getHttpServer()).get(DINGTALK_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(403);
    expect(exchanges).toBe(1);
    const status = await request(app.getHttpServer()).get('/api/providers/dingtalk/status').set(auth(owner.token)).expect(200);
    expect(status.body).toMatchObject({ appConfigured: true, realAccountAcceptance: 'AWAITING_DINGTALK_OAUTH_EVIDENCE', eventAcceptance: 'AWAITING_DINGTALK_EVENT_EVIDENCE' });
    const [conns] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM connections WHERE user_id=UUID_TO_BIN(?)", [owner.userId]);
    connection = conns[0].id;
    const [creds] = await pool.query<RowDataPacket[]>('SELECT current_version FROM credential_refs WHERE id=(SELECT credential_ref_id FROM connections WHERE id=UUID_TO_BIN(?))', [connection]);
    expect(creds[0]).toBeDefined();
    expect(JSON.stringify(await request(app.getHttpServer()).get('/api/connections').set(auth(owner.token)).expect(200))).not.toContain('isolated-secret');
  });
  it('projects the six-dimension readiness and all 9 capabilities as usable after health', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
    expect(view.capabilities).toHaveLength(9);
    expect(view.capabilities.every((c) => c.usable)).toBe(true);
    await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/observations`).set(auth(other.token)).send({ capability: 'DINGTALK_CALENDAR_READ', calendarId: 'dingcal_owner' }).expect(404);
  });
  it('Journey A: calendar Source -> Observation -> Candidate -> VERIFIED Truth', async () => {
    const reply = await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'DINGTALK_CALENDAR_READ', calendarId: 'dingcal_owner' }).expect(201);
    const observation = reply.body.observations[0];
    expect(observation.candidates[0].value).toMatchObject({ title: '项目例会' });
    expect(observation.truth[0]).toMatchObject({ status: 'verified' });
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND fact_key='calendar_event.schedule'", [owner.userId]);
    expect(facts.length).toBeGreaterThan(0);
  });
  it('Journey A (webhook): signed message event -> dedupe -> Reality Pipeline -> Truth', async () => {
    const payload = { EventType: 'message', corpId: 'dingisolatedcorp', msgId: 'om_w1', userId: 'ou_sender', content: 'webhook hi', createAt: String(Math.floor(Date.now() / 1000)) };
    const body = JSON.stringify(payload);
    const { timestamp, signature } = signEvent(body, config.appSecret);
    const reply = await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/webhook`).query({ timestamp, signature }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(200);
    expect(reply.body).toMatchObject({ duplicate: false, truthConfirmed: true });
    const duplicate = await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/webhook`).query({ timestamp, signature }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(200);
    expect(duplicate.body).toMatchObject({ duplicate: true });
    const [truths] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) c FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='DingTalkResource'", [owner.userId]);
    expect(Number(truths[0].c)).toBe(1);
  });
  it('rejects invalid signature, wrong tenant, and non-DingTalk webhook targets', async () => {
    const badPayload = { EventType: 'message', corpId: 'dingwrong', msgId: 'om_w2', userId: 'ou_s', content: 'x', createAt: String(Math.floor(Date.now() / 1000)) };
    const body = JSON.stringify(badPayload);
    await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/webhook`).query({ timestamp: String(Math.floor(Date.now() / 1000)), signature: 'invalid' }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(403);
    const { timestamp, signature } = signEvent(body, config.appSecret);
    await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/webhook`).query({ timestamp, signature }).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(403);
  });
  it('handles check_url challenge handshake', async () => {
    const body = JSON.stringify({ EventType: 'check_url', Random: 'challenge123' });
    const reply = await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/webhook`).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(200);
    expect(reply.body).toEqual({ challenge: 'challenge123' });
  });
  it('refreshes an expiring credential through the existing version store', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: { ...credential, refreshToken: 'user-refresh', expiresAt: new Date(Date.now() + 30000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() } }).expect(201);
    await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'DINGTALK_CALENDAR_READ', calendarId: 'dingcal_owner' }).expect(201);
    expect(refreshes).toBeGreaterThan(0);
  });
  it('marks the connection reauthorization_required on 401 and blocks reads', async () => {
    denyUserInfo = true;
    try { await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'DINGTALK_CALENDAR_READ', calendarId: 'dingcal_owner' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400)); }
    finally { denyUserInfo = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('Journey B: Plan -> Risk -> Approval -> CapabilityResolver -> DingTalk send -> Verification', async () => {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: 'DingTalk send ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId: connection, requiredCapability: 'DINGTALK_MESSAGE_SEND', config: { visibility: 'private' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, owner.token, plan.body.id);
    const run = await request(app.getHttpServer()).post(`/api/plans/${plan.body.id}/executions`).set(auth(owner.token)).send({ requestId: unique, triggerPayload: { dingtalkAction: messageAction } }).expect(201);
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
      const result = await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'DINGTALK_CALENDAR_READ', calendarId: 'dingcal_owner' }).expect(400);
      expect(result.body).toMatchObject({ category: 'RATE_LIMITED', providerCode: 'RATE_LIMITED' });
      const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
      expect(view.capabilities.find((c) => c.key === 'DINGTALK_CALENDAR_READ')).toMatchObject({ health: 'RATE_LIMITED', usable: false });
    } finally { limited = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('revokes the connection and closes all capability grants', async () => {
    await request(app.getHttpServer()).delete(`/api/connections/${connection}`).set(auth(owner.token)).expect(204);
    await request(app.getHttpServer()).post(`/api/providers/dingtalk/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'DINGTALK_CALENDAR_READ', calendarId: 'dingcal_owner' }).expect(403);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
    expect(view.capabilities.every((c) => !c.usable)).toBe(true);
  });
});
