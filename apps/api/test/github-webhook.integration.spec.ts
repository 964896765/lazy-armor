import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createServer, type Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GITHUB_CALLBACK_PATH } from '@lazy-armor/config';
import { GITHUB_TRANSPORT, type GitHubTransport } from '../src/providers/github/github-http.client';
import { githubWebhookManifest } from '../src/providers/github/github-webhook-manifest';
import { GitHubWebhookService } from '../src/providers/github/github-webhook.service';
import { GitHubService } from '../src/providers/github/github.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { VersionedResourceTruthService } from '../src/reality-pipeline/versioned-resource-truth.service';

describe.sequential('9D signed HTTP webhook / actual adapter TCP / MySQL leased acquisition; not real platform acceptance', () => {
  let app: INestApplication; let pool: Pool; let server: Server; let owner: Session; let other: Session; let connection: string; let worker: GitHubWebhookService;
  let apiReads = 0; let mutations = 0; let offline = false; let limited = false;
  let apiGetRequests = 0;
  let limitedReceipt: string;
  let heldRead: Promise<void> | undefined; let readStarted: (() => void) | undefined; let releaseRead: (() => void) | undefined;
  const unique = randomUUID(); const secret = 'isolated-github-webhook-signing-secret-2026';
  const repository = { id: 742, owner: 'webhook-owner', name: 'webhook-repo' };
  const route = '/repos/webhook-owner/webhook-repo'; const base = 'https://api.github.com' + route;
  const rawRepo = { ...repository, owner: { login: repository.owner }, full_name: 'webhook-owner/webhook-repo', private: true, updated_at: '2026-09-14T06:00:00Z' };
  let issue = { id: 799, number: 1, title: 'Actual API title', body: 'Actual API body', state: 'open', user: { id: 77 }, url: base + '/issues/1', updated_at: '2026-09-14T06:00:00Z' };
  const pullRequest = { ...issue, id: 800, number: 2, url: base + '/pulls/2', merged: false };
  const workflowRun = { id: 803, workflow_id: 300, status: 'completed', conclusion: 'success', head_sha: 'b'.repeat(40), updated_at: '2026-09-14T06:00:00Z' };
  const keys = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_REDIRECT_URI', 'GITHUB_WEBHOOK_SECRET', 'REDIS_KEY_PREFIX'] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://isolated.test'); res.setHeader('content-type', 'application/json');
      if (url.pathname === '/login/oauth/access_token') { res.end(JSON.stringify({ access_token: 'isolated-webhook-access', token_type: 'bearer', scope: 'repo',
        expires_in: 28800, refresh_token: 'isolated-webhook-refresh', refresh_token_expires_in: 15897600 })); return; }
      if (req.method !== 'GET') { mutations++; res.statusCode = 204; res.end(); return; }
      apiGetRequests++;
      if (url.pathname === '/user') { res.setHeader('x-oauth-scopes', 'repo'); res.end(JSON.stringify({ id: 77, login: 'webhook-owner' })); return; }
      if (url.pathname === '/user/repos') { res.end(JSON.stringify([rawRepo])); return; }
      if (url.pathname === route) { res.end(JSON.stringify(rawRepo)); return; }
      if (url.pathname === route + '/pulls/2') { apiReads++; res.end(JSON.stringify(pullRequest)); return; }
      if (url.pathname === route + '/actions/runs/803') { apiReads++; res.end(JSON.stringify(workflowRun)); return; }
      if (url.pathname === route + '/issues/1') {
        apiReads++; if (heldRead) { const latch = heldRead; readStarted?.(); await latch; }
        if (offline) { req.socket.destroy(); return; }
        if (limited) { res.statusCode = 429; res.setHeader('retry-after', '60'); res.end(JSON.stringify({ message: 'API rate limit exceeded' })); return; }
        res.end(JSON.stringify(issue)); return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.GITHUB_OAUTH_CLIENT_ID = 'isolated-webhook-client'; process.env.GITHUB_OAUTH_CLIENT_SECRET = 'isolated-webhook-client-secret';
    process.env.GITHUB_OAUTH_REDIRECT_URI = 'https://api.example.test' + GITHUB_CALLBACK_PATH; process.env.GITHUB_WEBHOOK_SECRET = secret;
    process.env.REDIS_KEY_PREFIX = 'lazy-armor-github-webhook-' + unique;
    const transport: GitHubTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool } = await bootP2App('github-webhook-' + unique, [{ token: GITHUB_TRANSPORT, value: transport }]));
    await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision IN (1,2)");
    await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='github' AND revision=3");
    app.get(ProviderCapabilityRegistryService).installRevision(githubWebhookManifest);
    owner = await register(app, 'webhook-owner-' + unique + '@example.com', 'Webhook owner'); other = await register(app, 'webhook-other-' + unique + '@example.com', 'Other');
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    const started = await request(app.getHttpServer()).post('/api/providers/github/authorize').set(auth(owner.token)).send({}).expect(201);
    const state = new URL(started.body.authorizationUrl).searchParams.get('state');
    const completed = await request(app.getHttpServer()).get(GITHUB_CALLBACK_PATH).query({ state, code: 'primary' }).set('X-Forwarded-Proto', 'https').expect(200);
    connection = completed.body.connectionId; worker = app.get(GitHubWebhookService);
  });
  afterAll(async () => {
    releaseRead?.();
    if (pool) { await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='github' AND revision IN (2,3)");
      await pool.query("UPDATE provider_capability_manifests SET status='ACTIVE',superseded_at=NULL WHERE provider_key='github' AND revision=1"); }
    await app?.close(); await pool?.end(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  });
  function signed(extra: Record<string, unknown> = {}, deliveryId = randomUUID()) {
    const raw = JSON.stringify({ action: 'edited', repository: rawRepo, issue: { ...issue, title: 'SIGNED_PRIVATE_TITLE', body: 'SIGNED_PRIVATE_BODY', state: 'closed' }, ...extra });
    return { raw, deliveryId, signature: 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') };
  }
  function send(event = signed(), secure = true, header = 'issues', target = connection) {
    const call = request(app.getHttpServer()).post(`/api/providers/github/connections/${target}/webhook`).set('content-type', 'application/json')
      .set('x-hub-signature-256', event.signature).set('x-github-delivery', event.deliveryId).set('x-github-event', header);
    if (secure) call.set('X-Forwarded-Proto', 'https'); return call.send(event.raw);
  }
  const view = (id: string) => request(app.getHttpServer()).get(`/api/providers/github/webhook-receipts/${id}`).set(auth(owner.token)).expect(200);
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM source_observations WHERE user_id=UUID_TO_BIN(?)) observations,(SELECT COUNT(*) FROM truth_record_versions v JOIN truth_records t ON t.id=v.truth_record_id WHERE t.user_id=UUID_TO_BIN(?)) versions", [owner.userId, owner.userId]); return rows[0];
  }
  async function enqueue(extra: Record<string, unknown> = {}) { return (await send(signed({ nonce: randomUUID(), ...extra })).expect(202)).body.receiptId as string; }
  const claim = () => worker.claim(4, 45_000, connection);
  async function claimOne(id: string) { const rows = await claim(); const row = rows.find((r) => r.id === id); expect(row).toBeDefined(); return row!; }
  it('requires HTTPS JSON signature and matching signed body shape, before accepting a receipt', async () => {
    await send(signed(), false).expect(403); await send({ ...signed(), signature: 'sha256=' + '0'.repeat(64) }).expect(403);
    await send(signed(), true, 'pull_request').expect(403); await send(signed({ pull_request: {} })).expect(403);
    await send(signed({ repository: { ...rawRepo, id: 1000 } })).expect(403); await send(signed(), true, 'issues', randomUUID()).expect(403);
    expect(apiReads).toBe(0); expect(await counts()).toMatchObject({ observations: 0, versions: 0 });
  });
  it('persists one minimal hint before 202 under concurrent replay and changed delivery headers', async () => {
    const event = signed(); const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => send({ ...event, deliveryId: i < 3 ? event.deliveryId : randomUUID() })));
    replies.forEach((r) => expect(r.status, JSON.stringify(r.body)).toBe(202)); expect(new Set(replies.map((r) => r.body.receiptId)).size).toBe(1);
    expect(replies.filter((r) => !r.body.duplicate)).toHaveLength(1); expect(apiReads).toBe(0); expect(replies.every((r) => r.body.truthConfirmed === false)).toBe(true);
    const id = replies[0].body.receiptId;
    const [rows] = await pool.query<RowDataPacket[]>('SELECT payload,payload_snapshot_json,acquisition_status FROM webhook_receipts WHERE id=UUID_TO_BIN(?)', [id]);
    expect(rows[0].payload).toBe('{}'); expect(JSON.stringify(rows[0].payload_snapshot_json)).not.toMatch(/SIGNED_PRIVATE|isolated-webhook-access|closed/);
    await request(app.getHttpServer()).get(`/api/providers/github/webhook-receipts/${id}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/providers/github/webhook-receipts/${id}`).expect(401);
    await send(signed({ action: 'closed' }, event.deliveryId)).expect(409);
    const batches = await Promise.all(Array.from({ length: 4 }, () => claim())); const claimed = batches.flat(); expect(claimed).toHaveLength(1);
    await worker.process(claimed[0]); expect((await view(id)).body).toMatchObject({ status: 'READ_BACK_COMPLETE', attempts: 1 });
    const [facts] = await pool.query<RowDataPacket[]>("SELECT value_json FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND resource_type='Issue'", [owner.userId]);
    expect(facts[0].value_json).toMatchObject({ state: 'open', title: 'Actual API title', body: 'Actual API body' }); expect(mutations).toBe(0);
  });
  it('rejects a signed wrong resource ID before materializing even repository metadata', async () => {
    const before = await counts(); const id = await enqueue({ issue: { ...issue, id: 9999 } });
    await worker.process(await claimOne(id)); expect((await view(id)).body.status).toBe('BLOCKED'); expect(await counts()).toEqual(before);
  });
  it('rejects a delivery collision even when the supplied body already belongs to a different receipt', async () => {
    const a = signed({ nonce: randomUUID() }); const b = signed({ nonce: randomUUID() });
    const aId = (await send(a).expect(202)).body.receiptId; const bId = (await send(b).expect(202)).body.receiptId;
    await send({ ...b, deliveryId: a.deliveryId }).expect(409);
    const rows = await claim(); expect(rows.map((r) => r.id).sort()).toEqual([aId, bId].sort()); await Promise.all(rows.map((r) => worker.process(r)));
  });
  it('acquires PR and workflow state through their own API endpoints, not signed state claims', async () => {
    const pr = signed({ issue: undefined, action: 'closed', number: 2, pull_request: { ...pullRequest, state: 'closed', merged: true, base: { repo: rawRepo } } });
    const prId = (await send(pr, true, 'pull_request').expect(202)).body.receiptId; await worker.process(await claimOne(prId));
    expect((await view(prId)).body.status).toBe('READ_BACK_COMPLETE');
    const run = signed({ issue: undefined, action: 'completed', workflow_run: { ...workflowRun, conclusion: 'failure', url: base + '/actions/runs/803', repository: rawRepo } });
    const runId = (await send(run, true, 'workflow_run').expect(202)).body.receiptId; await worker.process(await claimOne(runId));
    expect((await view(runId)).body.status).toBe('READ_BACK_COMPLETE');
    const [facts] = await pool.query<RowDataPacket[]>("SELECT resource_type,value_json FROM candidate_facts WHERE user_id=UUID_TO_BIN(?) AND resource_type IN ('PullRequest','Workflow')", [owner.userId]);
    expect(facts.find((f) => f.resource_type === 'PullRequest')!.value_json).toMatchObject({ state: 'open', merged: false });
    expect(facts.find((f) => f.resource_type === 'Workflow')!.value_json).toMatchObject({ conclusion: 'success' }); expect(mutations).toBe(0);
  });
  it('rejects persisted hint corruption before issuing any provider READ', async () => {
    const id = await enqueue(); const reads = apiReads;
    await pool.query("UPDATE webhook_receipts SET payload_snapshot_json=JSON_SET(payload_snapshot_json,'$.resourceId',9999) WHERE id=UUID_TO_BIN(?)", [id]);
    await worker.process(await claimOne(id)); expect((await view(id)).body.status).toBe('BLOCKED'); expect(apiReads).toBe(reads);
  });
  it('revalidates unchanged state without duplicate Truth versions across distinct deliveries', async () => {
    const before = await counts(); const a = await enqueue(); const b = await enqueue();
    const claims = await claim(); expect(claims.map((r) => r.id).sort()).toEqual([a, b].sort());
    await Promise.all(claims.map((r) => worker.process(r))); expect((await view(a)).body.status).toBe('READ_BACK_COMPLETE'); expect((await view(b)).body.status).toBe('READ_BACK_COMPLETE');
    expect((await counts()).versions).toBe(before.versions); expect(mutations).toBe(0);
  });
  it('lets a successor recover an expired READ lease without stale worker completion or re-publication', async () => {
    const before = await counts(); const id = await enqueue(); const stale = await claimOne(id);
    const started = new Promise<void>((resolve) => { readStarted = resolve; }); heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const pending = worker.process(stale);
    try {
      await started; await pool.query('UPDATE webhook_receipts SET acquisition_lease_until=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=UUID_TO_BIN(?)', [id]);
      const fresh = await claimOne(id); expect(fresh.acquisitionLeaseToken).not.toBe(stale.acquisitionLeaseToken);
      releaseRead!(); await pending; expect((await view(id)).body.status).toBe('PROCESSING'); expect(await counts()).toEqual(before);
      heldRead = undefined; await worker.process(fresh); expect((await view(id)).body).toMatchObject({ status: 'READ_BACK_COMPLETE', attempts: 2 });
      expect((await counts()).versions).toBe(before.versions);
    } finally { releaseRead?.(); heldRead = undefined; readStarted = undefined; }
  });
  it('does not confirm when product permission is revoked during actual GET', async () => {
    const before = await counts(); const id = await enqueue(); const row = await claimOne(id);
    const started = new Promise<void>((resolve) => { readStarted = resolve; }); heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const pending = worker.process(row);
    try {
      await started; await request(app.getHttpServer()).put(`/api/connections/${connection}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'READ_ISSUE', granted: false }] }).expect(200);
      await send(signed({ nonce: randomUUID() })).expect(403);
      releaseRead!(); await pending; expect((await view(id)).body.status).toBe('BLOCKED'); expect((await counts()).versions).toBe(before.versions);
    } finally {
      releaseRead?.(); heldRead = undefined; readStarted = undefined;
      await request(app.getHttpServer()).put(`/api/connections/${connection}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'READ_ISSUE', granted: true }] }).expect(200);
    }
  });
  it('fences a successor takeover AFTER the precheck but BEFORE the actual Truth transaction', async () => {
    const before = await counts(); const id = await enqueue(); const stale = await claimOne(id);
    const truth = app.get(VersionedResourceTruthService); const original = truth.confirm.bind(truth);
    let reached!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { reached = resolve; }); const paused = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(truth, 'confirm').mockImplementationOnce(async (...args) => {
      expect(args[2].acquisitionLease).toEqual({ receiptId: id, leaseToken: stale.acquisitionLeaseToken });
      reached(); await paused; return original(...args);
    });
    const pending = worker.process(stale);
    try {
      await started; await pool.query('UPDATE webhook_receipts SET acquisition_lease_until=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=UUID_TO_BIN(?)', [id]);
      const successor = await claimOne(id); release(); await pending;
      expect((await view(id)).body.status).toBe('PROCESSING'); expect((await counts()).versions).toBe(before.versions);
      await worker.process(successor); expect((await view(id)).body).toMatchObject({ status: 'READ_BACK_COMPLETE', attempts: 2 });
      expect((await counts()).versions).toBe(before.versions);
    } finally { release(); await pending; spy.mockRestore(); }
  });
  it('rejects an obsolete credential proof acquired before concurrent rotation', async () => {
    const before = await counts(); const id = await enqueue(); const row = await claimOne(id);
    const started = new Promise<void>((resolve) => { readStarted = resolve; }); heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const pending = worker.process(row);
    try {
      await started; await request(app.getHttpServer()).post(`/api/connections/${connection}/credentials/rotate`).set(auth(owner.token)).send({ credentials: {
        accessToken: 'isolated-webhook-access-new', scopes: 'repo', tokenMode: 'OAUTH_APP', githubUserId: '77', githubLogin: 'webhook-owner', repositories: JSON.stringify([repository]),
        expiresAt: new Date(Date.now() + 86400000).toISOString() } }).expect(201);
      releaseRead!(); await pending; expect((await view(id)).body.status).toBe('BLOCKED'); expect((await counts()).versions).toBe(before.versions);
    } finally { releaseRead?.(); heldRead = undefined; readStarted = undefined; }
  });
  it.each(['Grant', 'Candidate'] as const)('rechecks Grant expiry after waiting for a %s publication lock', async (target) => {
    const before = await counts(); const id = await enqueue(); const row = await claimOne(id);
    const truth = app.get(VersionedResourceTruthService); const original = truth.confirm.bind(truth);
    let reached!: () => void; let release!: () => void; let publicationCandidate = '';
    const started = new Promise<void>((resolve) => { reached = resolve; }); const paused = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(truth, 'confirm').mockImplementation(async (...args) => {
      const [candidates] = await pool.query<RowDataPacket[]>('SELECT resource_type FROM candidate_facts WHERE id=UUID_TO_BIN(?)', [args[1]]);
      if (candidates[0]?.resource_type === 'Issue') { publicationCandidate = args[1]; reached(); await paused; }
      return original(...args);
    });
    const lock = await pool.getConnection(); const pending = worker.process(row);
    try {
      await started; await lock.beginTransaction();
      if (target === 'Candidate') await lock.query('SELECT id FROM candidate_facts WHERE id=UUID_TO_BIN(?) FOR UPDATE', [publicationCandidate]);
      await (target === 'Grant' ? lock : pool).query('UPDATE connection_capability_grants SET expires_at=UTC_TIMESTAMP(6)+INTERVAL 5 SECOND WHERE connection_id=UUID_TO_BIN(?) AND capability_key=?', [connection, 'READ_ISSUE']);
      release(); // confirm captures its initial time, then waits for this real row lock.
      await new Promise<void>((resolve) => setTimeout(resolve, 5200));
      const [deadline] = await lock.query<RowDataPacket[]>('SELECT expires_at<=UTC_TIMESTAMP(6) AS expired FROM connection_capability_grants WHERE connection_id=UUID_TO_BIN(?) AND capability_key=?', [connection, 'READ_ISSUE']);
      expect(deadline[0].expired).toBe(1); await lock.commit(); await pending;
      expect((await view(id)).body.status).toBe('BLOCKED'); expect((await counts()).versions).toBe(before.versions);
    } finally {
      release(); await lock.rollback(); await pending; lock.release(); spy.mockRestore();
      await request(app.getHttpServer()).put(`/api/connections/${connection}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'READ_ISSUE', granted: true }] }).expect(200);
    }
  });
  it('recovers a transient network loss via scheduled READ only, not a side-effect retry', async () => {
    const before = await counts(); const id = await enqueue(); offline = true;
    try { await worker.process(await claimOne(id)); } finally { offline = false; }
    const failed = (await view(id)).body; expect(failed).toMatchObject({ status: 'RETRY', attempts: 1 }); expect((await counts()).versions).toBe(before.versions);
    await pool.query('UPDATE webhook_receipts SET acquisition_next_attempt_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [id]);
    await worker.process(await claimOne(id)); expect((await view(id)).body).toMatchObject({ status: 'READ_BACK_COMPLETE', attempts: 2 }); expect(mutations).toBe(0);
  });
  it('appends a new immutable Truth version from actual API change, not webhook claimed state', async () => {
    const before = await counts(); issue = { ...issue, state: 'closed', updated_at: '2026-09-14T06:01:00Z' };
    const id = await enqueue({ issue: { ...issue, state: 'open' } }); await worker.process(await claimOne(id));
    expect((await view(id)).body.status).toBe('READ_BACK_COMPLETE'); expect((await counts()).versions).toBe(before.versions + 1);
    const [versions] = await pool.query<RowDataPacket[]>("SELECT v.version_number,v.value_json FROM truth_record_versions v JOIN truth_records t ON t.id=v.truth_record_id WHERE t.user_id=UUID_TO_BIN(?) AND t.resource_key='Issue' ORDER BY v.version_number", [owner.userId]);
    expect(versions).toHaveLength(2); expect(versions[0].value_json.value.state).toBe('open'); expect(versions[1].value_json.value.state).toBe('closed');
  });
  it('expires purged, out-of-time and exhausted hints without any API acquisition', async () => {
    const ids = [await enqueue(), await enqueue(), await enqueue()]; const reads = apiReads;
    await pool.query('UPDATE webhook_receipts SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=UUID_TO_BIN(?)', [ids[0]]);
    await pool.query('UPDATE webhook_receipts SET purged_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [ids[1]]);
    await pool.query('UPDATE webhook_receipts SET acquisition_attempt_count=6 WHERE id=UUID_TO_BIN(?)', [ids[2]]);
    expect(await claim()).toEqual([]); expect(apiReads).toBe(reads);
    expect((await view(ids[0])).body.status).toBe('EXPIRED'); expect((await view(ids[1])).body.status).toBe('EXPIRED'); expect((await view(ids[2])).body.status).toBe('FAILED');
  });
  it('preserves provider 429 cooldown and keeps accepted delivery pending rather than successful', async () => {
    const id = await enqueue(); limitedReceipt = id; const reads = apiReads; limited = true;
    try { await worker.process(await claimOne(id)); } finally { limited = false; }
    const result = (await view(id)).body; expect(result.status).toBe('RETRY'); expect(result.result.reasonCode).toBe('RATE_LIMITED');
    expect(new Date(result.nextAttemptAt).getTime() - Date.now()).toBeGreaterThan(55_000); expect(apiReads - reads).toBe(1); expect(await claim()).toEqual([]);
  });
  it('cannot bypass active cooldown through an early recovery health probe', async () => {
    const requests = apiGetRequests;
    const github = app.get(GitHubService); const recover = github.recoverObservationHealth.bind(github);
    let recoveryError: unknown;
    const probe = vi.spyOn(github, 'recoverObservationHealth').mockImplementation(async (...args) => {
      try { return await recover(...args); } catch (error) { recoveryError = error; throw error; }
    });
    // Simulate an incorrectly early dequeue without changing Runtime cooldown.
    await pool.query('UPDATE webhook_receipts SET acquisition_next_attempt_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [limitedReceipt]);
    try { await worker.process(await claimOne(limitedReceipt)); } finally { probe.mockRestore(); }
    const result = (await view(limitedReceipt)).body;
    expect(result).toMatchObject({ status: 'RETRY', attempts: 2, result: { reasonCode: 'RATE_LIMITED' } });
    expect(recoveryError).toMatchObject({ code: 'RATE_LIMITED', category: 'RATE_LIMITED', retryable: true });
    expect(apiGetRequests).toBe(requests); expect(new Date(result.nextAttemptAt).getTime() - Date.now()).toBeGreaterThan(55_000);
  });
  it('rechecks revocation before queued READ and never treats retained receipt as live authorization', async () => {
    const id = limitedReceipt; const reads = apiReads;
    await request(app.getHttpServer()).delete(`/api/connections/${connection}`).set(auth(owner.token)).expect(204);
    await pool.query('UPDATE webhook_receipts SET acquisition_next_attempt_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [id]);
    await worker.process(await claimOne(id)); expect((await view(id)).body.status).toBe('BLOCKED'); expect(apiReads).toBe(reads);
    await send(signed({ nonce: randomUUID() })).expect(403);
  });
});
