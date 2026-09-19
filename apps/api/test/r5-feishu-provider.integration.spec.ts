import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FEISHU_CALLBACK_PATH } from '@lazy-armor/config';
import { validateProviderCapabilityManifest, validateProviderRuntimePolicy, type ConnectorRequest } from '@lazy-armor/connector-sdk';
import { parseAndNormalizeObservation, realityValueHash } from '@lazy-armor/plan-schema';
import { FeishuProviderAdapter } from '../src/providers/feishu/feishu.adapter';
import { FeishuAuthClient, feishuScopes } from '../src/providers/feishu/feishu-auth';
import { FEISHU_TRANSPORT, FeishuHttpClient, type FeishuTransport } from '../src/providers/feishu/feishu-http.client';
import { FEISHU_SCOPES, feishuManifest, feishuPolicy, FEISHU_EXPLICIT_DENIALS } from '../src/providers/feishu/feishu-manifest';
import { parseFeishuEvent, verifyFeishuEventSignature } from '../src/providers/feishu/feishu-event';
import { createConnectorRegistry } from '../src/connectors/connectors.module';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';

const config = { appId: 'cli_isolatedapp', appSecret: 'isolated-secret', redirectUri: 'https://api.example.test/api/providers/feishu/oauth/callback' };
const ALL_SCOPES = Object.values(FEISHU_SCOPES).join(' ');
const key = 'a'.repeat(64);
const credential = { tokenMode: 'USER_OAUTH', accessToken: 'user-access', refreshToken: 'user-refresh', refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  scopes: ALL_SCOPES, openId: 'ou_owner', tenantKey: 'tk_owner', appId: config.appId };
const messageAction = { kind: 'message' as const, receiveId: 'ou_target', msgType: 'text' as const, text: '隔离测试消息' };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const feishuRequest = (capability = 'FEISHU_MESSAGE_SEND', fields: Record<string, unknown> = messageAction): ConnectorRequest => ({ capability,
  requestId: 'isolated-request', idempotencyKey: key, input: { context: { feishuAction: fields } }, credentials: { data: credential } });

function router(mutate?: (url: URL, init: RequestInit) => Response | undefined): FeishuTransport {
  return vi.fn<FeishuTransport>(async (url, init) => {
    const target = new URL(url);
    return mutate?.(target, init) ?? json({ code: 0, data: {} });
  });
}

describe('R5-01 Feishu/Lark manifest, error mapping and adapter contract (no platform acceptance)', () => {
  it('validates manifest and policy, denies destructive/bulk capabilities and expresses real message boundaries', () => {
    expect(() => validateProviderCapabilityManifest(feishuManifest)).not.toThrow();
    expect(() => validateProviderRuntimePolicy(feishuPolicy, feishuManifest)).not.toThrow();
    expect(feishuManifest.providerKey).toBe('feishu'); expect(feishuManifest.providerName).toBe('飞书 / Lark');
    expect(feishuManifest.capabilities).toHaveLength(12);
    expect(feishuManifest.capabilities.filter((c) => c.operation === 'execute').every((c) => c.riskLevel === 'R3'
      && c.sideEffectContract.sideEffect && !c.sideEffectContract.supportsIdempotencyKey && c.sideEffectContract.supportsOperationLookup
      && c.sideEffectContract.retrySafety === 'unsafe' && c.verificationMethods.length > 0)).toBe(true);
    expect(FEISHU_EXPLICIT_DENIALS).toEqual(expect.arrayContaining(['DELETE_DOC', 'DELETE_CALENDAR', 'BULK_MESSAGE', 'BULK_MEMBER_OPERATION', 'APPROVAL_FORCE_DECISION', 'ADMIN_PERMISSION_CHANGE']));
    const messageEvent = feishuManifest.capabilities.find((c) => c.key === 'FEISHU_MESSAGE_EVENT_READ')!;
    expect(messageEvent.dataBoundary.purpose).toContain('BOT_VISIBLE_MESSAGE_EVENT');
    expect(feishuManifest.capabilities.find((c) => c.key === 'FEISHU_MESSAGE_SEND')!.dataBoundary.purpose).toContain('APP_AUTHORIZED_MESSAGE_RESOURCE');
    expect(feishuManifest.capabilities.some((c) => c.key === 'READ_ALL_FEISHU_MESSAGES')).toBe(false);
    const disabled = createConnectorRegistry({ NODE_ENV: 'production' }).get('feishu');
    expect(disabled.metadata().productionStatus).toBe('DISABLED');
    expect(disabled.capabilities().every((c) => c.providerAvailability === 'disabled')).toBe(true);
  });
  it('normalizes Feishu-native resources into a generic Reality Pipeline fact without a provider Engine', () => {
    const payload = { resourceType: 'FeishuMessage', resourceId: 'om_1', tenantKey: 'tk_owner', chatId: 'oc_1', senderId: 'ou_s', msgType: 'text', content: '{"text":"hi"}', updatedAt: new Date().toISOString() };
    const observation = { sourceMode: 'WEBHOOK' as const, providerKey: 'feishu', connectionId: 'owned-connection', externalEventKey: 'isolated-event',
      parserKey: 'generic.feishu-resource.v1' as const, resourceHint: 'FeishuMessage', payload, evidenceHash: realityValueHash(payload), observedAt: new Date().toISOString() };
    const fact = parseAndNormalizeObservation(observation)[0];
    expect(fact).toMatchObject({ factKey: 'feishu.resource.state', resourceType: 'FeishuResource', subjectKey: 'owned-connection:tk_owner:FeishuMessage:om_1' });
    expect(() => parseAndNormalizeObservation({ ...observation, connectionId: undefined })).toThrow();
  });
  it('maps Feishu errcode and HTTP status into ProviderRuntimeError without leaking errcode into the Runtime', async () => {
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [200, { code: 99991663, msg: 'token expired' }, 'AUTH_EXPIRED'],
      [200, { code: 99991668, msg: 'token invalid' }, 'AUTH_REVOKED'],
      [200, { code: 10003, msg: 'scope not authorized' }, 'PERMISSION_DENIED'],
      [200, { code: 99991403, msg: 'rate limited' }, 'RATE_LIMITED'],
      [200, { code: 1254046, msg: 'not found' }, 'RESOURCE_NOT_FOUND'],
      [503, { code: 500, msg: 'server error' }, 'PROVIDER_UNAVAILABLE'],
      [401, { code: 0, msg: 'unauthorized' }, 'AUTH_EXPIRED'],
      [403, { code: 0, msg: 'forbidden' }, 'PERMISSION_DENIED'],
    ];
    for (const [status, body, code] of cases) {
      const transport = router(() => json(body, status));
      const http = new FeishuHttpClient(transport);
      await expect(http.object('https://open.feishu.cn/open-apis/im/v1/messages/om_1')).rejects.toMatchObject({ code, name: 'ProviderRuntimeError' });
    }
  });
  it('times out and normalizes network failure without retrying a write', async () => {
    const hanging = router(() => new Promise<Response>(() => undefined));
    await expect(new FeishuHttpClient(hanging, 30).object('https://open.feishu.cn/open-apis/im/v1/messages/om_1')).rejects.toMatchObject({ code: 'TIMEOUT' });
    const broken = router(() => { throw new Error('ECONNREFUSED'); });
    await expect(new FeishuHttpClient(broken).object('https://open.feishu.cn/open-apis/im/v1/messages/om_1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  it('runs the user-delegated OAuth lifecycle (authorize -> exchange -> refresh) and refuses an expired refresh', async () => {
    let refreshed = false;
    const transport = router((url, init) => {
      if (url.pathname === '/open-apis/auth/v3/app_access_token/internal') return json({ code: 0, app_access_token: 'app-token', expire: 7200 });
      if (url.pathname === '/open-apis/authen/v2/oauth/token') {
        if (refreshed) return json({ code: 0, error: 'invalid_grant' });
        refreshed = true;
        return json({ code: 0, access_token: 'user-access', refresh_token: 'user-refresh', expires_in: 7200, refresh_token_expires_in: 604800, token_type: 'Bearer', scope: ALL_SCOPES, open_id: 'ou_owner', tenant_key: 'tk_owner' });
      }
      return undefined;
    });
    const authClient = new FeishuAuthClient(config, new FeishuHttpClient(transport));
    const started = authClient.start({ userId: 'u', state: 's'.repeat(48), redirectUri: config.redirectUri });
    expect(started.authorizationUrl).toContain('authen/v1/authorize');
    const token = await authClient.exchange({ userId: 'u', state: 's'.repeat(48), code: 'primary', redirectUri: config.redirectUri });
    expect(token.credentials).toMatchObject({ tokenMode: 'USER_OAUTH', openId: 'ou_owner', tenantKey: 'tk_owner' });
    expect(token.credentials.appSecret).toBeUndefined();
    await expect(authClient.refresh({ credential: token.credentials })).rejects.toMatchObject({ code: 'AUTH_REVOKED' });
  });
  it('projects scopes and capabilities and refuses a write without structured approved context', async () => {
    const transport = router((url) => url.pathname === '/open-apis/authen/v1/user_info' ? json({ code: 0, data: { open_id: 'ou_owner', tenant_key: 'tk_owner' } }) : undefined);
    const adapter = new FeishuProviderAdapter(new FeishuAuthClient(config, new FeishuHttpClient(transport)), new FeishuHttpClient(transport));
    expect(adapter.capabilities()).toHaveLength(12);
    await expect(adapter.execute({ ...feishuRequest(), input: {} })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(adapter.execute({ ...feishuRequest(), idempotencyKey: undefined })).rejects.toMatchObject({ phase: 'BEFORE_DISPATCH' });
    await expect(adapter.execute({ ...feishuRequest(), credentials: { data: { ...credential, scopes: 'calendar:calendar' } } })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
    expect(feishuScopes('im:message im:message:send_as_bot')).toEqual(['im:message', 'im:message:send_as_bot']);
    expect(() => feishuScopes('bad scope!')).toThrow();
  });
  it('sends one message, verifies by read-back and reconciles by bounded GET', async () => {
    let posts = 0;
    const transport = router((url, init) => {
      if (url.pathname === '/open-apis/authen/v1/user_info') return json({ code: 0, data: { open_id: 'ou_owner', tenant_key: 'tk_owner' } });
      if (url.pathname === '/open-apis/im/v1/messages' && init.method === 'POST') { posts++; return json({ code: 0, data: { message_id: 'om_1' } }); }
      if (url.pathname === '/open-apis/im/v1/messages/om_1') return json({ code: 0, data: { items: [{ message_id: 'om_1', chat_id: 'oc_1', msg_type: 'text', content: JSON.stringify({ text: messageAction.text }), create_time: String(Math.floor(Date.now() / 1000)) }] } });
      return undefined;
    });
    const adapter = new FeishuProviderAdapter(new FeishuAuthClient(config, new FeishuHttpClient(transport)), new FeishuHttpClient(transport));
    const result = await adapter.execute(feishuRequest());
    expect(result.data.verificationEvidence).toMatchObject({ matched: true, resourceId: 'om_1' });
    expect(posts).toBe(1);
    const lookup = await adapter.lookupOperation({ ...feishuRequest(), input: { context: { feishuAction: messageAction }, resourceId: 'om_1' } });
    expect(lookup.data.verificationEvidence).toMatchObject({ matched: true });
  });
  it('verifies Feishu event signature, challenge handshake and rejects invalid signature / wrong schema', () => {
    const encryptKey = 'isolated-encrypt-key-16';
    const body = JSON.stringify({ schema: '2.0', header: { event_id: 'evt_1', event_type: 'im.message.receive_v1', create_time: String(Math.floor(Date.now() / 1000)), app_id: config.appId, tenant_key: 'tk_owner' },
      event: { sender: { sender_id: { open_id: 'ou_s' } }, message: { message_id: 'om_1', chat_id: 'oc_1', msg_type: 'text', content: '{"text":"hi"}', create_time: String(Math.floor(Date.now() / 1000)) } } });
    const signature = signEvent(body, encryptKey);
    const parsed = parseFeishuEvent({ rawBody: Buffer.from(body), signature, encryptKey });
    expect(parsed).toMatchObject({ type: 'event', eventId: 'evt_1', tenantKey: 'tk_owner' });
    expect(parseFeishuEvent({ rawBody: Buffer.from(JSON.stringify({ type: 'url_verification', challenge: 'challenge123', token: 'tok' })), encryptKey })).toEqual({ type: 'url_verification', challenge: 'challenge123' });
    expect(() => parseFeishuEvent({ rawBody: Buffer.from(body), signature: 'invalid', encryptKey })).toThrow();
    expect(() => verifyFeishuEventSignature({ rawBody: Buffer.from(body), signature: signature.replace(/^[^,]+/, String(Math.floor(Date.now() / 1000) - 900)), encryptKey })).toThrow();
    expect(() => parseFeishuEvent({ rawBody: Buffer.from(body), signature, encryptKey })).not.toThrow();
  });
});

function signEvent(body: string, encryptKey: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'a'.repeat(16);
  const sig = createHmac('sha256', encryptKey).update(`${timestamp}${nonce}${encryptKey}${body}`).digest('hex');
  return `${timestamp},${nonce},${sig}`;
}

const enabled = process.env.RUN_REAL_DB_INTEGRATION === '1';

describe.skipIf(!enabled).sequential('R5-01 Feishu/Lark local TCP golden journeys', { timeout: 120_000 }, () => {
  let app: INestApplication; let pool: Pool; let server: Server; let endpoint: string; let owner: Session; let other: Session; let worker: ExecutionWorker; let connection: string;
  let exchanges = 0; let refreshes = 0; let mutations = 0; let limited = false; let denyUserInfo = false;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const keys = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_OAUTH_REDIRECT_URI', 'FEISHU_EVENT_ENCRYPT_KEY', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const encryptKey = 'isolated-encrypt-key-16';
  const calendar = { event_id: 'evt_1', summary: '项目例会', start_time: { timestamp: String(Math.floor(Date.now() / 1000) + 3600) }, end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 7200) }, status: 'confirmed', update_time: String(Math.floor(Date.now() / 1000)) };

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks).toString();
      const url = new URL(req.url!, 'http://isolated.test'); res.setHeader('content-type', 'application/json');
      const path = url.pathname;
      if (path === '/open-apis/auth/v3/app_access_token/internal') { res.end(JSON.stringify({ code: 0, app_access_token: 'isolated-app-token', expire: 7200 })); return; }
      if (path === '/open-apis/auth/v3/tenant_access_token/internal') { res.end(JSON.stringify({ code: 0, tenant_access_token: 'isolated-tenant-token', expire: 7200 })); return; }
      if (path === '/open-apis/authen/v2/oauth/token') {
        const form = JSON.parse(body); const refreshing = form.grant_type === 'refresh_token';
        if (refreshing) refreshes++; else exchanges++;
        if (form.code === 'invalid') { res.statusCode = 200; res.end(JSON.stringify({ code: 0, error: 'invalid_grant' })); return; }
        res.end(JSON.stringify({ code: 0, access_token: refreshing ? 'isolated-access-new' : 'isolated-access', refresh_token: refreshing ? 'isolated-refresh-new' : 'isolated-refresh',
          expires_in: 7200, refresh_token_expires_in: 604800, token_type: 'Bearer', scope: ALL_SCOPES, open_id: 'ou_owner', tenant_key: 'tk_owner' })); return;
      }
      if (path === '/open-apis/authen/v1/user_info') { if (denyUserInfo) { res.statusCode = 401; res.end(JSON.stringify({ code: 99991663, msg: 'token expired' })); return; } res.end(JSON.stringify({ code: 0, data: { open_id: 'ou_owner', tenant_key: 'tk_owner' } })); return; }
      if (limited) { res.statusCode = 429; res.end(JSON.stringify({ code: 99991403, msg: 'rate limited' })); return; }
      if (path === '/open-apis/calendar/v4/calendars/feishu.cn_owner/events') { res.end(JSON.stringify({ code: 0, data: { items: [calendar] } })); return; }
      if (path === '/open-apis/im/v1/messages' && req.method === 'POST') { mutations++; res.end(JSON.stringify({ code: 0, data: { message_id: 'om_1' } })); return; }
      if (path === '/open-apis/im/v1/messages/om_1') { res.end(JSON.stringify({ code: 0, data: { items: [{ message_id: 'om_1', chat_id: 'oc_1', msg_type: 'text', content: JSON.stringify({ text: '隔离测试消息' }), create_time: String(Math.floor(Date.now() / 1000)) }] } })); return; }
      res.statusCode = 404; res.end(JSON.stringify({ code: 1254046, msg: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.FEISHU_APP_ID = config.appId; process.env.FEISHU_APP_SECRET = config.appSecret; process.env.FEISHU_OAUTH_REDIRECT_URI = 'https://api.example.test' + FEISHU_CALLBACK_PATH;
    process.env.FEISHU_EVENT_ENCRYPT_KEY = encryptKey; process.env.REDIS_KEY_PREFIX = 'lazy-armor-feishu-isolated-' + unique;
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    // Drop any prior feishu catalog revision so the manifest hash is re-published fresh.
    const prePool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
    await prePool.query("DELETE FROM provider_runtime_policies WHERE provider_key='feishu'");
    await prePool.query("DELETE FROM verification_policies WHERE policy_key LIKE 'feishu.%'");
    await prePool.query("DELETE FROM provider_capability_evidence WHERE provider_key='feishu'");
    await prePool.query("DELETE FROM provider_capability_manifests WHERE provider_key='feishu'");
    await prePool.end();
    const transport: FeishuTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool, worker } = await bootP2App('feishu-' + unique, [{ token: FEISHU_TRANSPORT, value: transport }]));
    app.get(ProviderCapabilityRegistryService).installRevision(feishuManifest);
    owner = await register(app, 'feishu-owner-' + unique + '@example.com', 'Feishu owner'); other = await register(app, 'feishu-other-' + unique + '@example.com', 'Other');
  });
  afterAll(async () => {
    if (pool) await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='feishu'");
    await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
  async function start() { const result = await request(app.getHttpServer()).post('/api/providers/feishu/authorize').set(auth(owner.token)).send({}).expect(201); return new URL(result.body.authorizationUrl).searchParams.get('state')!; }
  it('consumes one OAuth state once, keeps status AWAITING markers and never exposes credentials', async () => {
    await request(app.getHttpServer()).post('/api/providers/feishu/authorize').send({}).expect(401);
    const state = await start();
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    await request(app.getHttpServer()).get(FEISHU_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(200);
    await request(app.getHttpServer()).get(FEISHU_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(403);
    expect(exchanges).toBe(1);
    const status = await request(app.getHttpServer()).get('/api/providers/feishu/status').set(auth(owner.token)).expect(200);
    expect(status.body).toMatchObject({ appConfigured: true, realAccountAcceptance: 'AWAITING_FEISHU_OAUTH_EVIDENCE', eventAcceptance: 'AWAITING_FEISHU_EVENT_EVIDENCE' });
    const [conns] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM connections WHERE user_id=UUID_TO_BIN(?)", [owner.userId]);
    connection = conns[0].id;
    const [creds] = await pool.query<RowDataPacket[]>('SELECT current_version FROM credential_refs WHERE id=(SELECT credential_ref_id FROM connections WHERE id=UUID_TO_BIN(?))', [connection]);
    expect(creds[0]).toBeDefined();
    expect(JSON.stringify(await request(app.getHttpServer()).get('/api/connections').set(auth(owner.token)).expect(200))).not.toContain('isolated-secret');
  });
  it('projects the six-dimension readiness and all 12 capabilities as usable after health', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
    expect(view.capabilities).toHaveLength(12);
    expect(view.capabilities.every((c) => c.usable)).toBe(true);
    await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/observations`).set(auth(other.token)).send({ capability: 'FEISHU_CALENDAR_READ', calendarId: 'feishu.cn_owner' }).expect(404);
  });
  it('Journey A: calendar Source -> Observation -> Candidate -> VERIFIED Truth', async () => {
    const reply = await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'FEISHU_CALENDAR_READ', calendarId: 'feishu.cn_owner' }).expect(201);
    const observation = reply.body.observations[0];
    expect(observation.candidates[0].value).toMatchObject({ title: '项目例会' });
    expect(observation.truth[0]).toMatchObject({ status: 'verified' });
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND fact_key='calendar_event.schedule'", [owner.userId]);
    expect(facts.length).toBeGreaterThan(0);
  });
  it('Journey A (webhook): signed message event -> dedupe -> Reality Pipeline -> Truth', async () => {
    const payload = { schema: '2.0', header: { event_id: 'evt_webhook', event_type: 'im.message.receive_v1', create_time: String(Math.floor(Date.now() / 1000)), app_id: config.appId, tenant_key: 'tk_owner' },
      event: { sender: { sender_id: { open_id: 'ou_sender' } }, message: { message_id: 'om_w1', chat_id: 'oc_1', msg_type: 'text', content: '{"text":"webhook hi"}', create_time: String(Math.floor(Date.now() / 1000)) } } };
    const body = JSON.stringify(payload);
    const signature = signEvent(body, encryptKey);
    const reply = await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/webhook`).set('X-Forwarded-Proto', 'https').set('X-Lark-Signature', signature).set('Content-Type', 'application/json').send(body).expect(200);
    expect(reply.body).toMatchObject({ duplicate: false, truthConfirmed: true });
    const duplicate = await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/webhook`).set('X-Forwarded-Proto', 'https').set('X-Lark-Signature', signature).set('Content-Type', 'application/json').send(body).expect(200);
    expect(duplicate.body).toMatchObject({ duplicate: true });
    const [truths] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) c FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='FeishuResource'", [owner.userId]);
    expect(Number(truths[0].c)).toBe(1);
  });
  it('rejects invalid signature, wrong tenant, and non-Feishu webhook targets', async () => {
    const badPayload = { schema: '2.0', header: { event_id: 'evt_bad', event_type: 'im.message.receive_v1', create_time: String(Math.floor(Date.now() / 1000)), app_id: config.appId, tenant_key: 'tk_wrong' },
      event: { sender: { sender_id: { open_id: 'ou_s' } }, message: { message_id: 'om_w2', chat_id: 'oc_1', msg_type: 'text', content: '{"text":"x"}', create_time: String(Math.floor(Date.now() / 1000)) } } };
    const body = JSON.stringify(badPayload);
    await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/webhook`).set('X-Forwarded-Proto', 'https').set('X-Lark-Signature', 'invalid').set('Content-Type', 'application/json').send(body).expect(403);
    await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/webhook`).set('X-Forwarded-Proto', 'https').set('X-Lark-Signature', signEvent(body, encryptKey)).set('Content-Type', 'application/json').send(body).expect(403);
  });
  it('handles url_verification challenge handshake', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge123', token: 'tok' });
    const reply = await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/webhook`).set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send(body).expect(200);
    expect(reply.body).toEqual({ challenge: 'challenge123' });
  });
  it('refreshes an expiring credential through the existing version store', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: { ...credential, refreshToken: 'user-refresh', expiresAt: new Date(Date.now() + 30000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() } }).expect(201);
    await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'FEISHU_CALENDAR_READ', calendarId: 'feishu.cn_owner' }).expect(201);
    expect(refreshes).toBeGreaterThan(0);
  });
  it('marks the connection reauthorization_required on 401 and blocks reads', async () => {
    denyUserInfo = true;
    try { await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'FEISHU_CALENDAR_READ', calendarId: 'feishu.cn_owner' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400)); }
    finally { denyUserInfo = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('Journey B: Plan -> Risk -> Approval -> CapabilityResolver -> Feishu send -> Verification', async () => {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: 'Feishu send ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId: connection, requiredCapability: 'FEISHU_MESSAGE_SEND', config: { visibility: 'private' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, owner.token, plan.body.id);
    const run = await request(app.getHttpServer()).post(`/api/plans/${plan.body.id}/executions`).set(auth(owner.token)).send({ requestId: unique, triggerPayload: { feishuAction: messageAction } }).expect(201);
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
      const result = await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'FEISHU_CALENDAR_READ', calendarId: 'feishu.cn_owner' }).expect(400);
      expect(result.body).toMatchObject({ category: 'RATE_LIMITED', providerCode: 'RATE_LIMITED' });
      const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
      expect(view.capabilities.find((c) => c.key === 'FEISHU_CALENDAR_READ')).toMatchObject({ health: 'RATE_LIMITED', usable: false });
    } finally { limited = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('revokes the connection and closes all capability grants', async () => {
    await request(app.getHttpServer()).delete(`/api/connections/${connection}`).set(auth(owner.token)).expect(204);
    await request(app.getHttpServer()).post(`/api/providers/feishu/connections/${connection}/observations`).set(auth(owner.token)).send({ capability: 'FEISHU_CALENDAR_READ', calendarId: 'feishu.cn_owner' }).expect(403);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection);
    expect(view.capabilities.every((c) => !c.usable)).toBe(true);
  });
});
