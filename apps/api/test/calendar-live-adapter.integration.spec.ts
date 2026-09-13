import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GMAIL_CALLBACK_PATH, GOOGLE_CALENDAR_CALLBACK_PATH } from '@lazy-armor/config';
import { GOOGLE_TRANSPORT, type GoogleTransport } from '../src/providers/google/google-http.client';
import { CALENDAR_SCOPES, calendarManifest } from '../src/providers/calendar/calendar-manifest';
import { GMAIL_SCOPES, gmailManifest } from '../src/providers/gmail/gmail-manifest';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';

describe.sequential('9C actual Calendar and Gmail adapters over isolated TCP, not Google-account acceptance', () => {
  let app: INestApplication; let pool: Pool; let server: Server; let owner: Session; let other: Session; let worker: ExecutionWorker;
  let calendarConnection: string; let gmailConnection: string; let calendarExchanges = 0; let mutations = 0; let revokes = 0; let refreshes = 0;
  let disconnectCreate = false; let limited = false; const events = new Map<string, Record<string, unknown>>();
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2); const calendarId = 'owner@example.test';
  const fields = { calendarId, title: 'Incoming meeting', start: { dateTime: '2026-09-15T09:00:00+08:00', timeZone: 'Asia/Shanghai' },
    end: { dateTime: '2026-09-15T10:00:00+08:00', timeZone: 'Asia/Shanghai' }, attendees: ['guest@example.test'], sendUpdates: 'all' };
  const keys = ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI', 'GOOGLE_CALENDAR_OAUTH_REDIRECT_URI', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  beforeAll(async () => {
    events.set('incoming1', { id: 'incoming1', summary: fields.title, start: fields.start, end: fields.end, attendees: fields.attendees.map((email) => ({ email })),
      status: 'confirmed', etag: '"incoming1"', updated: '2026-09-13T06:00:00Z' });
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url!, 'http://fixture'); res.setHeader('content-type', 'application/json');
      if (url.pathname === '/token') {
        const form = new URLSearchParams(body); const code = form.get('code'); const gmail = code === 'gmail';
        if (form.get('grant_type') === 'refresh_token') refreshes++; else if (!gmail) calendarExchanges++;
        if (code === 'invalid') { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_grant' })); return; }
        res.end(JSON.stringify({ token_type: 'Bearer', access_token: gmail ? 'isolated-gmail' : 'isolated-calendar', refresh_token: 'isolated-refresh', expires_in: 3600,
          scope: gmail ? Object.values(GMAIL_SCOPES).join(' ') : code === 'readonly' ? [CALENDAR_SCOPES.read, CALENDAR_SCOPES.metadata].join(' ') : Object.values(CALENDAR_SCOPES).join(' ') })); return;
      }
      if (url.pathname === '/revoke') { revokes++; res.end('{}'); return; }
      if (url.pathname.endsWith('/profile')) { res.end(JSON.stringify({ emailAddress: calendarId })); return; }
      if (url.pathname.includes('/gmail/v1/')) {
        res.end(JSON.stringify({ id: 'meeting1', threadId: 'thread1', internalDate: '1789264800000', labelIds: ['INBOX'], payload: { mimeType: 'text/plain',
          headers: [{ name: 'Subject', value: fields.title }, { name: 'From', value: 'guest@example.test' }, { name: 'To', value: calendarId }],
          body: { data: Buffer.from('Meeting on 2026-09-15 at 09:00 Asia/Shanghai').toString('base64url') } } })); return;
      }
      if (url.pathname.endsWith('/primary')) { res.end(JSON.stringify({ id: calendarId })); return; }
      if (limited && req.method === 'GET') { res.statusCode = 429; res.end(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } })); return; }
      if (req.method === 'POST' && url.pathname.endsWith('/events')) {
        mutations++; const data = JSON.parse(body); const event = { ...data, status: 'confirmed', etag: '"created1"', updated: new Date().toISOString() };
        events.set(data.id, event); if (disconnectCreate) { req.socket.destroy(); return; } res.end(JSON.stringify(event)); return;
      }
      const id = url.pathname.split('/').at(-1)!;
      if (req.method === 'PATCH' && events.has(id)) {
        if (req.headers['if-match'] !== events.get(id)!.etag) { res.statusCode = 412; res.end(JSON.stringify({ error: { errors: [{ reason: 'conditionNotMet' }] } })); return; }
        mutations++; const event = { ...events.get(id), ...JSON.parse(body), etag: '"updated1"', updated: new Date().toISOString() }; events.set(id, event); res.end(JSON.stringify(event)); return;
      }
      if (url.pathname.endsWith('/events')) { res.end(JSON.stringify({ items: [events.get('incoming1')] })); return; }
      if (events.has(id)) { res.end(JSON.stringify(events.get(id))); return; }
      res.statusCode = 404; res.end(JSON.stringify({ error: { errors: [{ reason: 'notFound' }] } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.GMAIL_OAUTH_CLIENT_ID = 'isolated.apps.googleusercontent.com'; process.env.GMAIL_OAUTH_CLIENT_SECRET = 'isolated-secret';
    process.env.GMAIL_OAUTH_REDIRECT_URI = 'https://api.example.test' + GMAIL_CALLBACK_PATH;
    process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI = 'https://api.example.test' + GOOGLE_CALENDAR_CALLBACK_PATH;
    process.env.REDIS_KEY_PREFIX = 'lazy-armor-calendar-isolated-' + unique;
    const transport: GoogleTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool, worker } = await bootP2App('calendar-' + unique, [{ token: GOOGLE_TRANSPORT, value: transport }]));
    for (const manifest of [gmailManifest, calendarManifest]) {
      await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key=? AND revision=1", [manifest.providerKey]);
      await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key=? AND revision=2", [manifest.providerKey]);
      app.get(ProviderCapabilityRegistryService).installRevision(manifest);
    }
    owner = await register(app, 'calendar-owner-' + unique + '@example.com', 'Calendar owner'); other = await register(app, 'calendar-other-' + unique + '@example.com', 'Other');
  });
  afterAll(async () => {
    if (pool) for (const key of ['gmail', 'google_calendar']) {
      await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key=? AND revision=2", [key]);
      await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key=? AND revision=1", [key]);
    }
    await app?.close(); await pool?.end(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  });
  async function start(provider = 'calendar') { const response = await request(app.getHttpServer()).post(`/api/providers/google/${provider}/authorize`).set(auth(owner.token)).send({}).expect(201);
    return new URL(response.body.authorizationUrl).searchParams.get('state')!; }
  async function connect(code: string, provider = 'calendar') { const state = await start(provider); return request(app.getHttpServer()).get(provider === 'calendar' ? GOOGLE_CALENDAR_CALLBACK_PATH : GMAIL_CALLBACK_PATH)
    .query({ state, code }).set('X-Forwarded-Proto', 'https').expect(200); }
  it('uses the existing OAuth state CAS and requires a secure Calendar callback', async () => {
    await request(app.getHttpServer()).post('/api/providers/google/calendar/authorize').send({}).expect(401); const state = await start();
    await request(app.getHttpServer()).get(GOOGLE_CALENDAR_CALLBACK_PATH).query({ state, code: 'calendar' }).set('X-Forwarded-Proto', 'https').expect(403);
    expect(calendarExchanges).toBe(0); app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    const replies = await Promise.all(Array.from({ length: 4 }, () => request(app.getHttpServer()).get(GOOGLE_CALENDAR_CALLBACK_PATH).query({ state, code: 'calendar' }).set('X-Forwarded-Proto', 'https')));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1); expect(calendarExchanges).toBe(1); calendarConnection = replies.find((r) => r.status === 200)!.body.connectionId;
    expect(JSON.stringify(replies.map((r) => r.body))).not.toContain('isolated-calendar');
    const [rows] = await pool.query<RowDataPacket[]>('SELECT completion_status,code_verifier FROM oauth_authorization_states WHERE state=?', [state]);
    expect(rows[0]).toMatchObject({ completion_status: 'CONNECTED', code_verifier: null });
  });
  it('keeps scopes, owner isolation and Runtime Health distinct from merely connected', async () => {
    const status = await request(app.getHttpServer()).get('/api/providers/google-calendar/status').set(auth(owner.token)).expect(200);
    expect(status.body).toMatchObject({ oauthConfigured: true, realAccountAcceptance: 'NOT_VERIFIED' });
    const [grants] = await pool.query<RowDataPacket[]>('SELECT granted_scopes_json FROM connection_capability_grants WHERE connection_id=UUID_TO_BIN(?)', [calendarConnection]);
    expect(grants).toHaveLength(3); expect(JSON.stringify(grants)).toContain(CALENDAR_SCOPES.write);
    await request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`).set(auth(other.token)).send({}).expect(404);
    await request(app.getHttpServer()).post(`/api/connections/${calendarConnection}/invoke`).set(auth(owner.token)).send({ capability: 'CREATE_CALENDAR_EVENT', requestId: unique, input: {} }).expect(403);
    expect(mutations).toBe(0);
    await request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`).set(auth(owner.token)).send({ maxItems: 51 }).expect(400);
    await request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`).set(auth(owner.token)).send({ payload: { title: 'fabricated' } }).expect(400);
  });
  it('normalizes concurrent authenticated Calendar reads through the Generic Pipeline without duplicate Truth', async () => {
    const reads = await Promise.all(Array.from({ length: 3 }, () => request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`)
      .set(auth(owner.token)).send({ eventId: 'incoming1' }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201))));
    expect(new Set(reads.map((r) => r.body.observations[0].observationId)).size).toBe(1); expect(reads[0].body.observations[0].truth).toHaveLength(1);
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND resource_type='CalendarEvent'", [owner.userId]);
    expect(facts).toHaveLength(1); expect(facts[0].fact_key).toBe('calendar_event.schedule');
  });
  it('cannot add write scope declined during consent and consumes failed or cancelled callbacks once', async () => {
    const readonly = (await connect('readonly')).body.connectionId;
    await request(app.getHttpServer()).put(`/api/connections/${readonly}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'CREATE_CALENDAR_EVENT', granted: true }] }).expect(403);
    const state = await start(); const count = calendarExchanges;
    await request(app.getHttpServer()).get(GOOGLE_CALENDAR_CALLBACK_PATH).query({ state, code: 'invalid' }).set('X-Forwarded-Proto', 'https').expect(403);
    await request(app.getHttpServer()).get(GOOGLE_CALENDAR_CALLBACK_PATH).query({ state, code: 'invalid' }).set('X-Forwarded-Proto', 'https').expect(403); expect(calendarExchanges).toBe(count + 1);
    const cancelled = await start(); await request(app.getHttpServer()).get(GOOGLE_CALENDAR_CALLBACK_PATH).query({ state: cancelled, error: 'access_denied' }).set('X-Forwarded-Proto', 'https').expect(200);
    await request(app.getHttpServer()).get(GOOGLE_CALENDAR_CALLBACK_PATH).query({ state: cancelled, code: 'calendar' }).set('X-Forwarded-Proto', 'https').expect(403);
  });
  it('persists 429 as unhealthy and requires a new successful profile validation to recover', async () => {
    limited = true;
    try { const response = await request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`).set(auth(owner.token)).send({ eventId: 'incoming1' }).expect(400);
      expect(response.body).toMatchObject({ category: 'RATE_LIMITED', providerCode: 'RATE_LIMITED' });
      const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, calendarConnection);
      expect(view.capabilities.find((c) => c.key === 'READ_CALENDAR_EVENT')).toMatchObject({ health: 'RATE_LIMITED', usable: false });
    } finally { limited = false;
      await request(app.getHttpServer()).post(`/api/connections/${calendarConnection}/validate`).set(auth(owner.token)).send({}).expect(201);
    }
  });
  async function executeApproved(capability: string, data: Record<string, unknown>) {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: capability + ' ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId: calendarConnection, requiredCapability: capability, config: { visibility: 'private' }, stepOrder: 0 }] }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201));
    await activatePlan(app, owner.token, plan.body.id);
    const execution = await request(app.getHttpServer()).post(`/api/plans/${plan.body.id}/executions`).set(auth(owner.token)).send({ requestId: unique + '-' + capability, triggerPayload: { calendarEvent: data } }).expect(201);
    await worker.processExecution(execution.body.id); const detail = await request(app.getHttpServer()).get(`/api/executions/${execution.body.id}`).set(auth(owner.token)).expect(200);
    expect(detail.body.status).toBe('waiting_approval'); await request(app.getHttpServer()).post('/api/approvals/' + detail.body.approvals[0].id + '/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(execution.body.id);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [execution.body.id]);
    expect(messages).toHaveLength(1); return { executionId: execution.body.id, messageId: messages[0].id };
  }
  it('runs isolated Gmail → Truth → user approval → Calendar → read-only verification with one lost TCP mutation', async () => {
    gmailConnection = (await connect('gmail', 'gmail')).body.connectionId;
    const source = await request(app.getHttpServer()).post(`/api/providers/gmail/connections/${gmailConnection}/observations`).set(auth(owner.token)).send({ capability: 'READ_EMAIL_BODY', messageId: 'meeting1' }).expect(201);
    expect(source.body.observations[0].truth).toHaveLength(3);
    const metadata = source.body.observations[0].candidates.find((c: { factKey: string }) => c.factKey === 'email_message.metadata');
    expect(metadata.value.subject).toBe(fields.title);
    disconnectCreate = true; const run = await executeApproved('CREATE_CALENDAR_EVENT', { ...fields, title: metadata.value.subject });
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE'); const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER');
    const claimed = (await Promise.all([outbox.claim(1000, unique + 'a'), outbox.claim(1000, unique + 'b')])).flat().filter((m) => m.id === run.messageId); expect(claimed).toHaveLength(1);
    await Promise.all([dispatcher.process(claimed[0]), dispatcher.process(claimed[0])]);
    const [dispatchState] = await pool.query<RowDataPacket[]>('SELECT status,error_code FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [run.executionId]);
    expect(mutations, JSON.stringify(dispatchState)).toBe(1); disconnectCreate = false;
    const [cases] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM reconciliation_cases WHERE execution_id=UUID_TO_BIN(?)', [run.executionId]); expect(cases).toHaveLength(1);
    const reconciliation = app.get(ReconciliationService); const checks = (await Promise.all([reconciliation.claim(100), reconciliation.claim(100)])).flat().filter((c) => c.id === cases[0].id); expect(checks).toHaveLength(1);
    await reconciliation.process(checks[0]); expect(await reconciliation.get(owner.userId, cases[0].id)).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED' });
    await dispatcher.process(claimed[0]); expect(mutations).toBe(1);
    const [operation] = await pool.query<RowDataPacket[]>('SELECT status,attempt_count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [run.executionId]);
    expect(operation[0]).toMatchObject({ status: 'outcome_unknown', attempt_count: 1 });
  });
  it('updates an approved event with If-Match through the same Existing Execution and records verification', async () => {
    const run = await executeApproved('UPDATE_CALENDAR_EVENT', { ...fields, eventId: 'incoming1', etag: '"incoming1"', title: 'Confirmed updated meeting' });
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE'); const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER');
    const claimed = (await outbox.claim(1000, unique + 'update')).find((m) => m.id === run.messageId)!; await dispatcher.process(claimed);
    expect(events.get('incoming1')!.summary).toBe('Confirmed updated meeting'); expect(mutations).toBe(2);
    const [evidence] = await pool.query<RowDataPacket[]>("SELECT ve.result_state FROM verification_evidence ve INNER JOIN side_effect_operations op ON op.id=ve.operation_id WHERE op.execution_id=UUID_TO_BIN(?)", [run.executionId]);
    expect(evidence.some((row) => row.result_state === 'SUCCEEDED')).toBe(true);
  });
  it('refreshes using the shared Google token path and closes grants on revoke', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${calendarConnection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: { ...{
      accessToken: 'isolated-calendar', refreshToken: 'isolated-refresh', scopes: Object.values(CALENDAR_SCOPES).join(' '), calendarId }, expiresAt: new Date(Date.now() + 30000).toISOString() } }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201));
    await request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`).set(auth(owner.token)).send({ eventId: 'incoming1' }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201)); expect(refreshes).toBeGreaterThan(0);
    await request(app.getHttpServer()).delete(`/api/connections/${calendarConnection}`).set(auth(owner.token)).expect(204); expect(revokes).toBe(1);
    await request(app.getHttpServer()).post(`/api/providers/google-calendar/connections/${calendarConnection}/observations`).set(auth(owner.token)).send({}).expect(403);
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, calendarConnection); expect(view.capabilities.every((c) => !c.usable)).toBe(true);
  });
});
