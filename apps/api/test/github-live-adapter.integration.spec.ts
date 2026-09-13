import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GITHUB_CALLBACK_PATH } from '@lazy-armor/config';
import { GITHUB_TRANSPORT, type GitHubTransport } from '../src/providers/github/github-http.client';
import { githubManifest } from '../src/providers/github/github-manifest';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';

describe.sequential('9D actual GitHub adapter over isolated TCP/MySQL; not real GitHub acceptance', () => {
  let app: INestApplication; let pool: Pool; let server: Server; let owner: Session; let other: Session; let worker: ExecutionWorker; let connection: string;
  let exchanges = 0; let mutations = 0; let refreshes = 0; let revokes = 0; let disconnect = false; let limited = false;
  const repository = { id: 42, owner: 'isolated-owner', name: 'isolated-repo' }; const route = '/repos/isolated-owner/isolated-repo'; const base = 'https://api.github.com' + route;
  const issues = new Map<number, Record<string, unknown>>(); const comments = new Map<number, Record<string, unknown>>();
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const keys = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_REDIRECT_URI', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  beforeAll(async () => {
    issues.set(1, { id: 99, number: 1, title: 'Observed issue', body: 'Actual isolated issue', state: 'open', user: { id: 7 }, url: base + '/issues/1', updated_at: '2026-09-13T10:00:00Z' });
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks).toString();
      const url = new URL(req.url!, 'http://isolated.test'); res.setHeader('content-type', 'application/json');
      const token = String(req.headers.authorization ?? ''); const readonly = token.includes('readonly');
      if (url.pathname === '/login/oauth/access_token') {
        const form = new URLSearchParams(body); const refreshing = form.get('grant_type') === 'refresh_token';
        if (refreshing) refreshes++; else exchanges++;
        if (form.get('code') === 'invalid') { res.end(JSON.stringify({ error: 'bad_verification_code' })); return; }
        const read = form.get('code') === 'readonly'; res.end(JSON.stringify({ access_token: refreshing ? 'isolated-access-new' : read ? 'isolated-readonly' : 'isolated-access',
          token_type: 'bearer', scope: read ? 'public_repo' : 'repo', expires_in: 28800, refresh_token: refreshing ? 'isolated-refresh-new' : 'isolated-refresh', refresh_token_expires_in: 15897600 })); return;
      }
      if (url.pathname === '/user') { res.setHeader('x-oauth-scopes', readonly ? 'public_repo' : 'repo'); res.end(JSON.stringify({ id: readonly ? 8 : 7, login: readonly ? 'readonly-user' : 'isolated-owner' })); return; }
      const actualRepo = { ...repository, owner: { login: repository.owner }, full_name: repository.owner + '/' + repository.name, private: true };
      if (url.pathname === '/user/repos') { res.end(JSON.stringify([actualRepo])); return; }
      if (url.pathname.startsWith('/applications/') && req.method === 'DELETE') { revokes++; res.statusCode = 204; res.end(); return; }
      if (url.pathname === route) { res.end(JSON.stringify(actualRepo)); return; }
      if (limited && req.method === 'GET') { res.statusCode = 403; res.setHeader('retry-after', '60'); res.end(JSON.stringify({ message: 'You have exceeded a secondary rate limit' })); return; }
      if (url.pathname === route + '/pulls/2') { res.end(JSON.stringify({ ...issues.get(1), id: 100, number: 2, url: base + '/pulls/2', state: 'closed', merged: true })); return; }
      if (url.pathname === route + '/actions/runs/3') { res.end(JSON.stringify({ id: 103, workflow_id: 300, status: 'completed', conclusion: 'success', head_sha: 'b'.repeat(40), updated_at: '2026-09-13T10:00:00Z' })); return; }
      if (req.method === 'POST' && url.pathname === route + '/issues') {
        mutations++; const number = issues.size + 1; const issue = { ...JSON.parse(body), id: 100 + number, number, state: 'open', user: { id: 7 }, url: base + '/issues/' + number, updated_at: new Date().toISOString() };
        issues.set(number, issue); if (disconnect) { req.socket.destroy(); return; } res.end(JSON.stringify(issue)); return;
      }
      if (req.method === 'POST' && /\/issues\/\d+\/comments$/.test(url.pathname)) {
        mutations++; const id = 1000 + comments.size; const comment = { ...JSON.parse(body), id, user: { id: 7 }, issue_url: base + '/issues/' + url.pathname.split('/').at(-2), url: base + '/issues/comments/' + id };
        comments.set(id, comment); res.end(JSON.stringify(comment)); return;
      }
      if (url.pathname === route + '/issues') { res.end(JSON.stringify([...issues.values()])); return; }
      if (/\/issues\/\d+\/comments$/.test(url.pathname)) { res.end(JSON.stringify([...comments.values()])); return; }
      const id = Number(url.pathname.split('/').at(-1)); const record = url.pathname.includes('/comments/') ? comments.get(id) : issues.get(id);
      if (record) { res.end(JSON.stringify(record)); return; }
      res.statusCode = 404; res.end(JSON.stringify({ message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.GITHUB_OAUTH_CLIENT_ID = 'isolated-client'; process.env.GITHUB_OAUTH_CLIENT_SECRET = 'isolated-secret'; process.env.GITHUB_OAUTH_REDIRECT_URI = 'https://api.example.test' + GITHUB_CALLBACK_PATH;
    process.env.REDIS_KEY_PREFIX = 'lazy-armor-github-isolated-' + unique;
    const transport: GitHubTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool, worker } = await bootP2App('github-' + unique, [{ token: GITHUB_TRANSPORT, value: transport }]));
    await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision=1");
    await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='github' AND revision=2");
    app.get(ProviderCapabilityRegistryService).installRevision(githubManifest);
    owner = await register(app, 'github-owner-' + unique + '@example.com', 'GitHub owner'); other = await register(app, 'github-other-' + unique + '@example.com', 'Other');
  });
  afterAll(async () => {
    if (pool) { await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision=2");
      await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='github' AND revision=1"); }
    await app?.close(); await pool?.end(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  });
  async function start() { const result = await request(app.getHttpServer()).post('/api/providers/github/authorize').set(auth(owner.token)).send({}).expect(201); return new URL(result.body.authorizationUrl).searchParams.get('state')!; }
  const observe = (capability: string, fields = {}) => request(app.getHttpServer()).post(`/api/providers/github/connections/${connection}/observations`).set(auth(owner.token)).send({ capability, repository, ...fields });
  it('consumes one OAuth state across concurrent secure callbacks and does not expose credentials', async () => {
    await request(app.getHttpServer()).post('/api/providers/github/authorize').send({}).expect(401); const state = await start();
    await request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state, code: 'primary' }).expect(403); expect(exchanges).toBe(0);
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    const replies = await Promise.all(Array.from({ length: 4 }, () => request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https')));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1); expect(exchanges).toBe(1); connection = replies.find((r) => r.status === 200)!.body.connectionId;
    expect(JSON.stringify(replies.map((r) => r.body))).not.toContain('isolated-access');
    const [states] = await pool.query<RowDataPacket[]>('SELECT completion_status,code_verifier FROM oauth_authorization_states WHERE state=?', [state]); expect(states[0]).toMatchObject({ completion_status: 'CONNECTED', code_verifier: null });
  });
  it('keeps actual scope, owner, four-axis status and direct-write denial fail-closed', async () => {
    expect((await request(app.getHttpServer()).get('/api/providers/github/status').set(auth(owner.token)).expect(200)).body).toMatchObject({ oauthConfigured: true, realAccountAcceptance: 'NOT_VERIFIED' });
    const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection); expect(view.capabilities).toHaveLength(5); expect(view.capabilities.every((c) => c.usable)).toBe(true);
    await request(app.getHttpServer()).post(`/api/providers/github/connections/${connection}/observations`).set(auth(other.token)).send({ capability: 'READ_ISSUE', repository }).expect(404);
    await request(app.getHttpServer()).post(`/api/connections/${connection}/invoke`).set(auth(owner.token)).send({ capability: 'CREATE_ISSUE', requestId: unique, input: {} }).expect(403); expect(mutations).toBe(0);
    await observe('READ_ISSUE', { payload: { state: 'fabricated' } }).expect(400);
  });
  it('deduplicates concurrent official reads into Generic Truth and reads PR / Workflow actual state', async () => {
    const replies = await Promise.all(Array.from({ length: 3 }, () => observe('READ_ISSUE', { number: 1 }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201))));
    expect(new Set(replies.map((r) => r.body.observations[1].observationId)).size).toBe(1);
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND resource_type IN ('Repository','Issue')", [owner.userId]); expect(facts).toHaveLength(2);
    const pr = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201); expect(pr.body.observations[1].candidates[0].value).toMatchObject({ state: 'closed', merged: true });
    const workflow = await observe('READ_WORKFLOW_STATUS', { runId: 3 }).expect(201); expect(workflow.body.observations[1].candidates[0].value).toMatchObject({ status: 'completed', conclusion: 'success' });
  });
  it('cannot elevate declined repo scope and consumes cancelled/failed state only once', async () => {
    const state = await start(); const readonly = (await request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state, code: 'readonly' }).set('X-Forwarded-Proto', 'https').expect(200)).body.connectionId;
    await request(app.getHttpServer()).put(`/api/connections/${readonly}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'CREATE_ISSUE', granted: true }] }).expect(403);
    const cancelled = await start(); await request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state: cancelled, error: 'access_denied' }).set('X-Forwarded-Proto', 'https').expect(200);
    await request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state: cancelled, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(403);
    const bad = await start(); const count = exchanges;
    for (let i = 0; i < 2; i++) await request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state: bad, code: 'invalid' }).set('X-Forwarded-Proto', 'https').expect(403); expect(exchanges).toBe(count + 1);
  });
  async function approved(capability: string, fields: Record<string, unknown>) {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: capability + ' ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId: connection, requiredCapability: capability, config: { visibility: 'private' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, owner.token, plan.body.id);
    const run = await request(app.getHttpServer()).post(`/api/plans/${plan.body.id}/executions`).set(auth(owner.token)).send({ requestId: unique + '-' + capability, triggerPayload: { githubAction: fields } }).expect(201);
    await worker.processExecution(run.body.id); const detail = await request(app.getHttpServer()).get(`/api/executions/${run.body.id}`).set(auth(owner.token)).expect(200); expect(detail.body.status).toBe('waiting_approval');
    await request(app.getHttpServer()).post('/api/approvals/' + detail.body.approvals[0].id + '/approve').set(auth(owner.token)).send({}).expect(201); await worker.processExecution(run.body.id);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [run.body.id]); expect(messages).toHaveLength(1);
    return { executionId: run.body.id, messageId: messages[0].id };
  }
  it('records one side effect before TCP loss, concurrently reconciles by GET and never repeats POST', async () => {
    const run = await approved('CREATE_ISSUE', { repository, visibility: 'private', title: 'Approved isolated issue', body: 'Approved isolated details' }); disconnect = true;
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE'); const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER');
    const claims = (await Promise.all([outbox.claim(1000, unique + 'a'), outbox.claim(1000, unique + 'b')])).flat().filter((m) => m.id === run.messageId); expect(claims).toHaveLength(1);
    await Promise.all([dispatcher.process(claims[0]), dispatcher.process(claims[0])]); expect(mutations).toBe(1); disconnect = false;
    const [cases] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM reconciliation_cases WHERE execution_id=UUID_TO_BIN(?)', [run.executionId]); expect(cases).toHaveLength(1);
    const reconciliation = app.get(ReconciliationService); const checks = (await Promise.all([reconciliation.claim(100), reconciliation.claim(100)])).flat().filter((c) => c.id === cases[0].id); expect(checks).toHaveLength(1);
    await reconciliation.process(checks[0]); expect(await reconciliation.get(owner.userId, cases[0].id)).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED' });
    await dispatcher.process(claims[0]); expect(mutations).toBe(1);
    const [operation] = await pool.query<RowDataPacket[]>('SELECT status,attempt_count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [run.executionId]); expect(operation[0]).toMatchObject({ status: 'outcome_unknown', attempt_count: 1 });
  });
  it('routes approved comment through existing R3 Approval/Runner and read-back VerificationEvidence', async () => {
    const run = await approved('CREATE_COMMENT', { repository, visibility: 'private', issueNumber: 1, targetKind: 'ISSUE', body: 'Approved isolated comment' });
    const claims = await app.get<OutboxService>('OUTBOX_SERVICE').claim(1000, unique + 'comment'); const message = claims.find((m) => m.id === run.messageId)!;
    await app.get<OutboxWorker>('OUTBOX_WORKER').process(message); expect(mutations).toBe(2);
    const [evidence] = await pool.query<RowDataPacket[]>("SELECT ve.result_state FROM verification_evidence ve INNER JOIN side_effect_operations op ON op.id=ve.operation_id WHERE op.execution_id=UUID_TO_BIN(?)", [run.executionId]); expect(evidence.some((e) => e.result_state === 'SUCCEEDED')).toBe(true);
  });
  it('refreshes actual pair using the existing credential version store', async () => {
    await request(app.getHttpServer()).post(`/api/connections/${connection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: {
      accessToken: 'isolated-access', refreshToken: 'isolated-refresh', scopes: 'repo', tokenMode: 'OAUTH_APP', githubUserId: '7', githubLogin: 'isolated-owner', repositories: JSON.stringify([repository]),
      expiresAt: new Date(Date.now() + 30000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() } }).expect(201);
    await observe('READ_ISSUE', { number: 1 }).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(201)); expect(refreshes).toBeGreaterThan(0);
  });
  it('maps secondary-limit HTTP 403 into Runtime Health without an immediate retry', async () => {
    limited = true;
    try { const result = await observe('READ_ISSUE', { number: 1 }).expect(400); expect(result.body).toMatchObject({ category: 'RATE_LIMITED', providerCode: 'RATE_LIMITED' });
      const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection); expect(view.capabilities.find((c) => c.key === 'READ_ISSUE')).toMatchObject({ health: 'RATE_LIMITED', usable: false });
    } finally { limited = false; await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201); }
  });
  it('revokes current token and closes grants even while the provider is in cooldown', async () => {
    await request(app.getHttpServer()).delete(`/api/connections/${connection}`).set(auth(owner.token)).expect(204); expect(revokes).toBe(1);
    await observe('READ_ISSUE', { number: 1 }).expect(403); const view = await app.get(CapabilityUsabilityService).resolveConnection(owner.userId, connection); expect(view.capabilities.every((c) => !c.usable)).toBe(true);
  });
});
