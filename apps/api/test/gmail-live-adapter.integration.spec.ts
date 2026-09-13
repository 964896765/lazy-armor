import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GMAIL_CALLBACK_PATH } from '@lazy-armor/config';
import { GOOGLE_TRANSPORT, type GoogleTransport } from '../src/providers/google/google-http.client';
import { GMAIL_SCOPES, gmailManifest } from '../src/providers/gmail/gmail-manifest';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';

describe.sequential('9B actual Gmail adapter over isolated TCP (not Google account acceptance)', () => {
  let app: INestApplication; let pool: Pool; let server: Server; let endpoint: string; let user: Session; let other: Session; let worker: ExecutionWorker;
  let connectionId: string; let exchangeCount = 0; let revokeCount = 0; let refreshCount = 0; let mutations = 0;
  let refreshGate: Promise<void> | null = null; let refreshStarted: (() => void) | null = null;
  let rateLimited = false;
  const stored = new Map<string, Record<string, unknown>>();
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const redirect = 'https://api.example.test' + GMAIL_CALLBACK_PATH;
  const savedEnv = { id: process.env.GMAIL_OAUTH_CLIENT_ID, secret: process.env.GMAIL_OAUTH_CLIENT_SECRET, redirect: process.env.GMAIL_OAUTH_REDIRECT_URI, prefix: process.env.REDIS_KEY_PREFIX };
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url!, 'http://fixture'); res.setHeader('content-type', 'application/json');
      if (url.pathname === '/token') {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'refresh_token') { refreshCount++; refreshStarted?.(); if (refreshGate) await refreshGate; }
        else { exchangeCount++; expect(form.get('code_verifier')?.length).toBeGreaterThanOrEqual(43); }
        if (form.get('code') === 'invalid') { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_grant' })); return; }
        res.end(JSON.stringify({ token_type: 'Bearer', access_token: 'isolated-access', refresh_token: 'isolated-refresh', expires_in: 3600,
          scope: form.get('code') === 'readonly' ? GMAIL_SCOPES.read : Object.values(GMAIL_SCOPES).join(' ') })); return;
      }
      if (url.pathname === '/revoke') { revokeCount++; res.end('{}'); return; }
      if (url.pathname.endsWith('/profile')) { res.end(JSON.stringify({ emailAddress: 'sender@example.test' })); return; }
      if (req.method === 'POST' && url.pathname.endsWith('/messages/send')) {
        mutations++; const raw = Buffer.from(JSON.parse(body).raw, 'base64url').toString('utf8'); const [head, ...parts] = raw.split('\r\n\r\n');
        const headers = head.split('\r\n').map((line) => ({ name: line.slice(0, line.indexOf(':')), value: line.slice(line.indexOf(':') + 1).trim() }));
        stored.set('sent1', { id: 'sent1', threadId: 'thread1', internalDate: String(Date.now()), labelIds: ['SENT'],
          payload: { mimeType: 'text/plain', headers, body: { data: Buffer.from(Buffer.from(parts.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64')).toString('base64url') } } });
        req.socket.destroy(); return;
      }
      if (url.pathname.endsWith('/messages')) {
        if (url.searchParams.get('q')?.startsWith('rfc822msgid:')) { res.end(JSON.stringify({ messages: stored.has('sent1') ? [{ id: 'sent1' }] : [] })); return; }
        res.end(JSON.stringify({ messages: [{ id: 'inbox1' }] })); return;
      }
      if (url.pathname.endsWith('/messages/sent1')) { res.end(JSON.stringify(stored.get('sent1'))); return; }
      if (url.pathname.endsWith('/messages/inbox1') && rateLimited) { res.statusCode = 429; res.end(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } })); return; }
      if (url.pathname.endsWith('/messages/inbox1')) { res.end(JSON.stringify({ id: 'inbox1', threadId: 'thread1', internalDate: '1789264800000', labelIds: ['INBOX'],
        payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Meeting' }, { name: 'From', value: 'colleague@example.test' }, { name: 'To', value: 'sender@example.test' }],
          ...(url.searchParams.get('format') === 'full' ? { body: { data: Buffer.from('Meeting tomorrow').toString('base64url') } } : {}) } })); return; }
      res.statusCode = 404; res.end(JSON.stringify({ error: { errors: [{ reason: 'notFound' }] } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.GMAIL_OAUTH_CLIENT_ID = 'isolated-client.apps.googleusercontent.com'; process.env.GMAIL_OAUTH_CLIENT_SECRET = 'isolated-secret-only'; process.env.GMAIL_OAUTH_REDIRECT_URI = redirect;
    process.env.REDIS_KEY_PREFIX = 'lazy-armor-gmail-isolated-' + unique;
    const transport: GoogleTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool, worker } = await bootP2App('gmail-live-' + unique, [{ token: GOOGLE_TRANSPORT, value: transport }]));
    // The shared integration database retains immutable revisions between runs;
    // only test catalog activation pointers are restored for this adapter suite.
    await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='gmail' AND revision=1");
    await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='gmail' AND revision=2");
    app.get(ProviderCapabilityRegistryService).installRevision(gmailManifest);
    user = await register(app, unique + '@example.com', 'Gmail owner'); other = await register(app, 'other-' + unique + '@example.com', 'Other owner');
  });
  afterAll(async () => {
    // Restore active catalog pointer, never change immutable revision definitions.
    if (pool) {
      await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='gmail' AND revision=2");
      await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='gmail' AND revision=1");
    }
    await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of Object.entries({ GMAIL_OAUTH_CLIENT_ID: savedEnv.id, GMAIL_OAUTH_CLIENT_SECRET: savedEnv.secret, GMAIL_OAUTH_REDIRECT_URI: savedEnv.redirect, REDIS_KEY_PREFIX: savedEnv.prefix })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  async function start() {
    const response = await request(app.getHttpServer()).post('/api/providers/google/gmail/authorize').set(auth(user.token)).send({}).expect(201);
    const url = new URL(response.body.authorizationUrl); expect(url.searchParams.get('code_challenge_method')).toBe('S256'); return url.searchParams.get('state')!;
  }
  it('enforces authenticated start and HTTPS callback; claims concurrent callbacks before exchanging token', async () => {
    await request(app.getHttpServer()).post('/api/providers/google/gmail/authorize').send({}).expect(401);
    const state = await start();
    await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).query({ state, code: 'code' }).set('X-Forwarded-Proto', 'https').expect(403); expect(exchangeCount).toBe(0);
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    const replies = await Promise.all(Array.from({ length: 4 }, () => request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).query({ state, code: 'code' }).set('X-Forwarded-Proto', 'https')));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1); expect(replies.filter((r) => r.status === 403)).toHaveLength(3); expect(exchangeCount).toBe(1);
    connectionId = replies.find((r) => r.status === 200)!.body.connectionId;
    expect(JSON.stringify(replies.map((r) => r.body))).not.toContain('isolated-access');
    const [states] = await pool.query<RowDataPacket[]>('SELECT completion_status,code_verifier FROM oauth_authorization_states WHERE state=?', [state]);
    expect(states[0]).toMatchObject({ completion_status: 'CONNECTED', code_verifier: null });
  });
  it('derives grants and health from actual isolated OAuth/API responses and isolates owners', async () => {
    const status = await request(app.getHttpServer()).get('/api/providers/gmail/status').set(auth(user.token)).expect(200);
    expect(status.body).toMatchObject({ oauthConfigured: true, realAccountAcceptance: 'NOT_VERIFIED' });
    const [grants] = await pool.query<RowDataPacket[]>('SELECT capability_key,granted_scopes_json FROM connection_capability_grants WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    expect(grants).toHaveLength(5); expect(JSON.stringify(grants)).toContain(GMAIL_SCOPES.read);
    await request(app.getHttpServer()).post(`/api/providers/gmail/connections/${connectionId}/observations`).set(auth(other.token)).send({ capability: 'READ_EMAIL_BODY' }).expect(404);
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/invoke`).set(auth(user.token)).send({ capability: 'SEND_EMAIL', requestId: unique, input: {} }).expect(403);
    expect(mutations).toBe(0);
  });
  it('ingests authenticated API reads into generic Candidates and immutable Truth with concurrent dedupe', async () => {
    const view = await app.get(CapabilityUsabilityService).resolveConnection(user.userId, connectionId);
    const capability = view.capabilities.find((c) => c.key === 'READ_EMAIL_BODY');
    expect(capability?.usable, JSON.stringify(capability)).toBe(true);
    const reads = await Promise.all(Array.from({ length: 3 }, () => request(app.getHttpServer()).post(`/api/providers/gmail/connections/${connectionId}/observations`)
      .set(auth(user.token)).send({ capability: 'READ_EMAIL_BODY', messageId: 'inbox1' }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201))));
    expect(reads[0].body.observations[0].truth).toHaveLength(3);
    expect(new Set(reads.map((r) => r.body.observations[0].observationId)).size).toBe(1);
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND resource_type='EmailMessage'", [user.userId]);
    expect(facts).toHaveLength(3);
  });
  it('cannot grant write scopes declined at Google and consumes denied consent without token I/O', async () => {
    const state = await start(); const response = await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).set('X-Forwarded-Proto', 'https').query({ state, code: 'readonly' }).expect(200);
    await request(app.getHttpServer()).put(`/api/connections/${response.body.connectionId}/permissions`).set(auth(user.token))
      .send({ permissions: [{ capability: 'SEND_EMAIL', granted: true }] }).expect(403);
    const cancelled = await start(); const before = exchangeCount;
    await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).set('X-Forwarded-Proto', 'https').query({ state: cancelled, error: 'access_denied' }).expect(200);
    await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).set('X-Forwarded-Proto', 'https').query({ state: cancelled, code: 'code' }).expect(403); expect(exchangeCount).toBe(before);
  });
  it('failed token exchange consumes the attempt; retrying its callback cannot redispatch', async () => {
    const state = await start(); const before = exchangeCount;
    await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).set('X-Forwarded-Proto', 'https').query({ state, code: 'invalid' }).expect(403);
    await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).set('X-Forwarded-Proto', 'https').query({ state, code: 'invalid' }).expect(403);
    expect(exchangeCount).toBe(before + 1);
    const [states] = await pool.query<RowDataPacket[]>('SELECT completion_status,failure_code,code_verifier FROM oauth_authorization_states WHERE state=?', [state]);
    expect(states[0]).toMatchObject({ completion_status: 'FAILED', failure_code: 'OAUTH_COMPLETION_FAILED', code_verifier: null });
  });
  it('maps Google 429 to unhealthy runtime availability and only a successful profile check restores Health', async () => {
    rateLimited = true;
    try {
      const response = await request(app.getHttpServer()).post(`/api/connections/${connectionId}/invoke`).set(auth(user.token))
        .send({ capability: 'READ_EMAIL_LABELS', requestId: unique + '-429', input: { messageId: 'inbox1' } }).expect(400);
      expect(response.body).toMatchObject({ category: 'RATE_LIMITED', providerCode: 'RATE_LIMITED' });
      const view = await app.get(CapabilityUsabilityService).resolveConnection(user.userId, connectionId);
      expect(view.capabilities.find((c) => c.key === 'READ_EMAIL_LABELS')).toMatchObject({ health: 'RATE_LIMITED', usable: false });
    } finally { rateLimited = false; }
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/validate`).set(auth(user.token)).send({}).expect(201);
    const restored = await app.get(CapabilityUsabilityService).resolveConnection(user.userId, connectionId);
    expect(restored.capabilities.find((c) => c.key === 'READ_EMAIL_LABELS')).toMatchObject({ health: 'HEALTHY', usable: true });
  });
  it('runs SEND_EMAIL through ActionIntent, approval, existing Runner, one lost TCP send and read-only reconciliation', async () => {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(user.token)).send({ name: 'Gmail send ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId, requiredCapability: 'SEND_EMAIL', config: { visibility: 'private' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, user.token, plan.body.id);
    const execution = await request(app.getHttpServer()).post(`/api/plans/${plan.body.id}/executions`).set(auth(user.token))
      .send({ requestId: unique, triggerPayload: { email: { from: 'sender@example.test', to: ['recipient@example.test'], subject: 'Meeting', body: 'Approved message only' } } }).expect(201);
    await worker.processExecution(execution.body.id);
    const detail = await request(app.getHttpServer()).get('/api/executions/' + execution.body.id).set(auth(user.token)).expect(200);
    expect(detail.body.status).toBe('waiting_approval');
    await request(app.getHttpServer()).post('/api/approvals/' + detail.body.approvals[0].id + '/approve').set(auth(user.token)).send({}).expect(201);
    await worker.processExecution(execution.body.id);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [execution.body.id]); expect(messages).toHaveLength(1);
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE'); const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER');
    const claims = (await Promise.all([outbox.claim(1000, unique + 'a'), outbox.claim(1000, unique + 'b')])).flat().filter((r) => r.id === messages[0].id); expect(claims).toHaveLength(1);
    await Promise.all([dispatcher.process(claims[0]), dispatcher.process(claims[0])]);
    const [cases] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM reconciliation_cases WHERE execution_id=UUID_TO_BIN(?)', [execution.body.id]); expect(cases).toHaveLength(1); expect(mutations).toBe(1);
    const reconciliation = app.get(ReconciliationService); const checks = (await Promise.all([reconciliation.claim(100), reconciliation.claim(100)])).flat().filter((r) => r.id === cases[0].id); expect(checks).toHaveLength(1);
    await reconciliation.process(checks[0]); expect(await reconciliation.get(user.userId, cases[0].id)).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED' });
    await dispatcher.process(claims[0]); expect(mutations).toBe(1);
    const [operations] = await pool.query<RowDataPacket[]>('SELECT status,attempt_count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [execution.body.id]);
    expect(operations[0]).toMatchObject({ status: 'outcome_unknown', attempt_count: 1 });
  });
  it('refreshes expiring credentials and revokes both provider token and local grants', async () => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT cr.id FROM credential_refs cr INNER JOIN connections c ON c.credential_ref_id=cr.id WHERE c.id=UUID_TO_BIN(?)', [connectionId]);
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/credentials/rotate`).set(auth(user.token)).send({ credentials: { accessToken: 'isolated-access',
      refreshToken: 'isolated-refresh', scopes: Object.values(GMAIL_SCOPES).join(' '), emailAddress: 'sender@example.test', expiresAt: new Date(Date.now() + 30000).toISOString() } }).expect(201);
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/validate`).set(auth(user.token)).send({}).expect(201); expect(refreshCount).toBe(1); expect(rows).toHaveLength(1);
    await request(app.getHttpServer()).delete(`/api/connections/${connectionId}`).set(auth(user.token)).expect(204); expect(revokeCount).toBe(1);
    await request(app.getHttpServer()).post(`/api/providers/gmail/connections/${connectionId}/observations`).set(auth(user.token)).send({ capability: 'READ_EMAIL_BODY' }).expect(403);
  });
  it('revocation wins over a refresh response arriving late and cannot resurrect credentials or health', async () => {
    const state = await start(); const response = await request(app.getHttpServer()).get(GMAIL_CALLBACK_PATH).set('X-Forwarded-Proto', 'https').query({ state, code: 'code' }).expect(200);
    const id = response.body.connectionId;
    await request(app.getHttpServer()).post(`/api/connections/${id}/credentials/rotate`).set(auth(user.token)).send({ credentials: { accessToken: 'isolated-access',
      refreshToken: 'isolated-refresh', scopes: Object.values(GMAIL_SCOPES).join(' '), emailAddress: 'sender@example.test', expiresAt: new Date(Date.now() + 30000).toISOString() } }).expect(201);
    let release!: () => void; refreshGate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const validating = request(app.getHttpServer()).post(`/api/connections/${id}/validate`).set(auth(user.token)).send({}).then((r) => r);
    try {
      await started; await request(app.getHttpServer()).delete(`/api/connections/${id}`).set(auth(user.token)).expect(204); release();
      expect([400, 403]).toContain((await validating).status);
      const [rows] = await pool.query<RowDataPacket[]>('SELECT c.status connection_status,cr.status credential_status FROM connections c INNER JOIN credential_refs cr ON cr.id=c.credential_ref_id WHERE c.id=UUID_TO_BIN(?)', [id]);
      expect(rows[0]).toMatchObject({ connection_status: 'revoked', credential_status: 'revoked' });
      const [health] = await pool.query<RowDataPacket[]>('SELECT status FROM provider_capability_health WHERE connection_id=UUID_TO_BIN(?)', [id]);
      expect(health.every((h) => h.status === 'PERMISSION_REVOKED')).toBe(true);
    } finally { release(); refreshGate = null; refreshStarted = null; }
  });
});
