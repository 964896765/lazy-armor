import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GITHUB_CALLBACK_PATH } from '@lazy-armor/config';
import { GITHUB_TRANSPORT, type GitHubTransport } from '../src/providers/github/github-http.client';
import { githubWebhookManifest } from '../src/providers/github/github-webhook-manifest';
import { auth, bootP2App, register, activatePlan, type Session } from './p2-test-helpers';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { CapabilityUsabilityService } from '../src/provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';

describe.sequential('9D actual GitHub adapter over isolated TCP/MySQL; not real GitHub acceptance', () => {
  let app: INestApplication; let pool: Pool; let server: Server; let owner: Session; let other: Session; let worker: ExecutionWorker; let connection: string;
  let exchanges = 0; let mutations = 0; let refreshes = 0; let revokes = 0; let disconnect = false; let limited = false;
  const repository = { id: 42, owner: 'isolated-owner', name: 'isolated-repo' }; const route = '/repos/isolated-owner/isolated-repo'; const base = 'https://api.github.com' + route;
  const issues = new Map<number, Record<string, unknown>>(); const comments = new Map<number, Record<string, unknown>>();
  let prState: Record<string, unknown>; let prTruthId: string;
  let releaseIssueRead: (() => void) | undefined; let issueReadStarted: (() => void) | undefined; let heldIssueRead: Promise<void> | undefined;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const keys = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_REDIRECT_URI', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const pipelineFailures: { stage: string; code: string }[] = [];
  beforeAll(async () => {
    issues.set(1, { id: 99, number: 1, title: 'Observed issue', body: 'Actual isolated issue', state: 'open', user: { id: 7 }, url: base + '/issues/1', updated_at: '2026-09-13T10:00:00Z' });
    prState = { ...issues.get(1), id: 100, number: 2, url: base + '/pulls/2', state: 'closed', merged: true };
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
      const actualRepo = { ...repository, owner: { login: repository.owner }, full_name: repository.owner + '/' + repository.name, private: true, updated_at: '2026-09-13T10:00:00Z' };
      if (url.pathname === '/user/repos') { res.end(JSON.stringify([actualRepo])); return; }
      if (url.pathname.startsWith('/applications/') && req.method === 'DELETE') { revokes++; res.statusCode = 204; res.end(); return; }
      if (url.pathname === route) { res.end(JSON.stringify(actualRepo)); return; }
      if (limited && req.method === 'GET') { res.statusCode = 403; res.setHeader('retry-after', '60'); res.end(JSON.stringify({ message: 'You have exceeded a secondary rate limit' })); return; }
      if (url.pathname === route + '/pulls/2') { res.end(JSON.stringify(prState)); return; }
      if (url.pathname === route + '/issues/1' && heldIssueRead) { const held = heldIssueRead; issueReadStarted?.(); await held; }
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
    const pipeline = app.get(RealityPipelineService);
    const ingest = pipeline.ingest.bind(pipeline); const confirm = pipeline.confirmCandidate.bind(pipeline);
    const recordFailure = (stage: string, error: unknown) => {
      let current = error; let code = 'NON_DATABASE_ERROR';
      for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
        const item = current as { code?: string; cause?: unknown }; if (/^ER_[A-Z_]+$/.test(item.code ?? '')) code = item.code!; current = item.cause;
      }
      pipelineFailures.push({ stage, code }); // Diagnostic codes only; no SQL, token or provider payload.
    };
    vi.spyOn(pipeline, 'ingest').mockImplementation(async (...args) => { try { return await ingest(...args); } catch (error) { recordFailure('ingest', error); throw error; } });
    vi.spyOn(pipeline, 'confirmCandidate').mockImplementation(async (...args) => { try { return await confirm(...args); } catch (error) { recordFailure('confirm', error); throw error; } });
    const local = pipeline as unknown as { ingestOnce: typeof pipeline.ingest }; const materialize = local.ingestOnce.bind(pipeline);
    vi.spyOn(local, 'ingestOnce').mockImplementation(async (...args) => { try { return await materialize(...args); } catch (error) { recordFailure('materialization', error); throw error; } });
    await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision=1");
    await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision=2");
    await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='github' AND revision=3");
    app.get(ProviderCapabilityRegistryService).installRevision(githubWebhookManifest);
    owner = await register(app, 'github-owner-' + unique + '@example.com', 'GitHub owner'); other = await register(app, 'github-other-' + unique + '@example.com', 'Other');
  });
  afterAll(async () => {
    const databaseFailures = pipelineFailures.filter((failure) => failure.code !== 'NON_DATABASE_ERROR');
    if (databaseFailures.length) console.info('Safe local acquisition diagnostics', JSON.stringify(databaseFailures));
    vi.restoreAllMocks();
    releaseIssueRead?.();
    if (pool) { await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision IN (2,3)");
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
    const replies = await Promise.all(Array.from({ length: 3 }, () => observe('READ_ISSUE', { number: 1 })));
    for (const reply of replies) expect(reply.status, JSON.stringify({ response: reply.body, pipelineFailures })).toBe(201);
    expect(new Set(replies.map((r) => r.body.observations[1].observationId)).size).toBe(1);
    const [facts] = await pool.query<RowDataPacket[]>("SELECT fact_key FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND resource_type IN ('Repository','Issue')", [owner.userId]); expect(facts).toHaveLength(2);
    const pr = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201); expect(pr.body.observations[1].candidates[0].value).toMatchObject({ state: 'closed', merged: true });
    const workflow = await observe('READ_WORKFLOW_STATUS', { runId: 3 }).expect(201); expect(workflow.body.observations[1].candidates[0].value).toMatchObject({ status: 'completed', conclusion: 'success' });
  });
  async function prVersions() {
    const [versions] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id,version_number,value_json,value_hash,evidence_hash,created_at FROM truth_record_versions WHERE truth_record_id=UUID_TO_BIN(?) ORDER BY version_number', [prTruthId]);
    return versions;
  }
  it('appends one stable PR Truth version per actual change under concurrent reads without rewriting history', async () => {
    const initial = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201); const truth = initial.body.observations[1].truth[0];
    prTruthId = truth.id; expect(truth.currentVersion.versionNumber).toBe(1); const original = await prVersions();
    prState = { ...prState, state: 'open', merged: false, updated_at: '2026-09-13T10:01:00Z' };
    const changed = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201);
    expect(changed.body.observations[1].truth[0]).toMatchObject({ id: prTruthId, currentVersion: { versionNumber: 2, value: { value: { state: 'open', merged: false } } } });
    prState = { ...prState, state: 'closed', merged: true, updated_at: '2026-09-13T10:02:00Z' };
    const merged = await Promise.all(Array.from({ length: 3 }, () => observe('READ_PULL_REQUEST', { number: 2 }).expect(201)));
    expect(new Set(merged.map((r) => r.body.observations[1].observationId)).size).toBe(1);
    for (const reply of merged) expect(reply.body.observations[1].truth[0]).toMatchObject({ id: prTruthId, currentVersion: { versionNumber: 3 } });
    const versions = await prVersions(); expect(versions).toHaveLength(3); expect(versions[0]).toEqual(original[0]);
    const [provenance] = await pool.query<RowDataPacket[]>('SELECT p.id FROM truth_provenance p INNER JOIN truth_record_versions v ON v.id=p.truth_record_version_id WHERE v.truth_record_id=UUID_TO_BIN(?)', [prTruthId]); expect(provenance).toHaveLength(3);
  });
  it('revalidates unchanged actual reads without an immutable version or CHANGED wakeup', async () => {
    const versions = await prVersions(); const reply = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201);
    expect(reply.body.observations[1].truth[0]).toMatchObject({ id: prTruthId, currentVersion: { versionNumber: 3 } }); expect(await prVersions()).toEqual(versions);
    const [audit] = await pool.query<RowDataPacket[]>("SELECT id FROM audit_logs WHERE resource_id=? AND action='GENERIC_TRUTH_REVALIDATED'", [prTruthId]); expect(audit.length).toBeGreaterThan(0);
  });
  it('supersedes out-of-order provider state without rolling back the current PR version', async () => {
    prState = { ...prState, state: 'open', merged: false, updated_at: '2026-09-13T10:01:30Z' };
    const reply = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201); const candidateId = reply.body.observations[1].candidates[0].id;
    expect(reply.body.observations[1].truth[0]).toMatchObject({ id: prTruthId, currentVersion: { versionNumber: 3, value: { value: { state: 'closed', merged: true } } } });
    const [candidate] = await pool.query<RowDataPacket[]>('SELECT status FROM candidate_facts WHERE id=UUID_TO_BIN(?)', [candidateId]); expect(candidate[0].status).toBe('SUPERSEDED'); expect(await prVersions()).toHaveLength(3);
    prState = { ...prState, state: 'closed', merged: true, updated_at: '2026-09-13T10:02:00Z' };
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
  it('rejects a completed GET acquired with an obsolete credential version after concurrent rotation', async () => {
    const [before] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id,current_version_id,verified_at FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='Issue'", [owner.userId]);
    const started = new Promise<void>((resolve) => { issueReadStarted = resolve; }); heldIssueRead = new Promise<void>((resolve) => { releaseIssueRead = resolve; });
    const pending = observe('READ_ISSUE', { number: 1 }).then((reply) => reply);
    try {
      await started;
      await request(app.getHttpServer()).post(`/api/connections/${connection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: {
        accessToken: 'isolated-access-new', refreshToken: 'isolated-refresh-new', scopes: 'repo', tokenMode: 'OAUTH_APP', githubUserId: '7', githubLogin: 'isolated-owner', repositories: JSON.stringify([repository]),
        expiresAt: new Date(Date.now() + 86400000).toISOString(), refreshExpiresAt: new Date(Date.now() + 172800000).toISOString() } }).expect(201);
      releaseIssueRead!(); const reply = await pending; expect(reply.status, JSON.stringify(reply.body)).toBe(403);
      const [after] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id,current_version_id,verified_at FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='Issue'", [owner.userId]); expect(after).toEqual(before);
    } finally { releaseIssueRead?.(); heldIssueRead = undefined; issueReadStarted = undefined; }
    await observe('READ_ISSUE', { number: 1 }).expect(201);
  });
  it('rejects publication when a permission revocation commits during the actual API read', async () => {
    const [before] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id,current_version_id,verified_at FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='Issue'", [owner.userId]);
    const started = new Promise<void>((resolve) => { issueReadStarted = resolve; }); heldIssueRead = new Promise<void>((resolve) => { releaseIssueRead = resolve; });
    const pending = observe('READ_ISSUE', { number: 1 }).then((reply) => reply);
    try {
      await started;
      await request(app.getHttpServer()).put(`/api/connections/${connection}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'READ_ISSUE', granted: false }] }).expect(200);
      releaseIssueRead!(); const reply = await pending; expect(reply.status, JSON.stringify(reply.body)).toBe(403);
      const [after] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id,current_version_id,verified_at FROM truth_records WHERE user_id=UUID_TO_BIN(?) AND resource_key='Issue'", [owner.userId]); expect(after).toEqual(before);
    } finally {
      releaseIssueRead?.(); heldIssueRead = undefined; issueReadStarted = undefined;
      await request(app.getHttpServer()).put(`/api/connections/${connection}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'READ_ISSUE', granted: true }] }).expect(200);
    }
  });
  it('blocks equal-time conflicting actual state and rejects consumer-forged acquisition proofs', async () => {
    const versions = await prVersions(); prState = { ...prState, merged: false };
    const reply = await observe('READ_PULL_REQUEST', { number: 2 }).expect(201); const candidateId = reply.body.observations[1].candidates[0].id;
    expect(reply.body.observations[1].truth[0]).toMatchObject({ id: prTruthId, status: 'conflicted', currentVersion: { versionNumber: 3 } }); expect(await prVersions()).toEqual(versions);
    const [candidate] = await pool.query<RowDataPacket[]>('SELECT status FROM candidate_facts WHERE id=UUID_TO_BIN(?)', [candidateId]); expect(candidate[0].status).toBe('CONFLICT');
    await request(app.getHttpServer()).post(`/api/candidates/${candidateId}/confirm`).set(auth(owner.token)).send({ readProof: { capabilityKey: 'READ_PULL_REQUEST', credentialVersion: 1, requestId: 'forged', acquiredAt: new Date().toISOString() } }).expect(403);
    const listed = await request(app.getHttpServer()).get('/api/truth').set(auth(owner.token)).expect(200); expect(listed.body.some((item: { id: string }) => item.id === prTruthId)).toBe(false);
    await observe('READ_PULL_REQUEST', { number: 2 }).expect(409); expect(await prVersions()).toEqual(versions);
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
