import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { INestApplication } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { BrowserDriver } from '../src/providers/browser/browser-driver';
import { BrowserAdapter } from '../src/providers/browser/browser.adapter';
import { browserEvidence, browserManifest, browserPolicy } from '../src/providers/browser/browser-manifest';
import { ProviderRuntimeService } from '../src/provider-runtime/provider-runtime.service';
import { ConnectorCatalogSyncService } from '../src/connectors/connector-catalog-sync.service';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

const executablePath = process.env.TEST_BROWSER_EXECUTABLE_PATH;
describe.skipIf(!executablePath || !existsSync(executablePath))('Controlled browser real Chromium + isolated web server, NOT real website acceptance', { timeout: 90000 }, () => {
  let server: Server, endpoint: string, driver: BrowserDriver, app: INestApplication, pool: Pool, owner: Session, connectionId: string;
  let worker: Awaited<ReturnType<typeof bootP2App>>['worker'];
  const previousApprovalTtl = process.env.TEST_APPROVAL_TTL_MS;
  const effects = new Map<string, string>(); let posts = 0, loseResponse = false;
  const output = (marker: string) => `<div id="result">Saved</div><div id="operation">${marker}</div>`;
  beforeAll(async () => {
    // Real Chromium startup and DOM verification exceed the fixture's 2s default.
    process.env.TEST_APPROVAL_TTL_MS = '120000';
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      if (req.method === 'POST') {
        let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
          const fields = new URLSearchParams(body), marker = fields.get('operationId')!; posts++; effects.set(marker, fields.get('message')!);
          if (loseResponse) { loseResponse = false; req.socket.destroy(); } else res.end(output(marker));
        }); return;
      }
      const url = new URL(req.url!, endpoint);
      if (url.pathname === '/lookup') { const marker = url.searchParams.get('operationId')!; res.end(effects.has(marker) ? output(marker) : '<div id="result">Missing</div><div id="operation">missing</div>'); return; }
      res.end('<div id="title">Scoped page</div><input id="password" type="password" value="secret"><form action="/submit" method="post"><input id="message" name="message"><input id="marker" name="operationId" type="hidden"><button id="submit" type="submit">Save</button></form>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    driver = new BrowserDriver({ executablePath: executablePath!, allowedOrigins: [endpoint], allowLoopbackTest: true });
    ({ app, pool, worker } = await bootP2App('browser-' + randomUUID())); owner = await register(app, randomUUID() + '@example.test', 'Browser owner');
    const runtime = app.get(ProviderRuntimeService);
    await runtime.publish({ manifest: browserManifest, evidence: browserEvidence, policy: browserPolicy });
    app.get(ConnectorRegistry).register(runtime.bridge(new BrowserAdapter(driver, input => runtime.beforeOperation(browserPolicy, input, 'execute')), browserManifest, browserPolicy));
    await app.get(ConnectorCatalogSyncService).sync();
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token))
      .send({ connectorId: 'controlled_browser', externalAccountName: 'Isolated web server', credentials: { endpoint: endpoint + '/' } }).expect(201)).body.id;
  });
  afterAll(async () => {
    if (previousApprovalTtl === undefined) delete process.env.TEST_APPROVAL_TTL_MS;
    else process.env.TEST_APPROVAL_TTL_MS = previousApprovalTtl;
    await app?.close(); await pool?.end(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const form = () => ({ url: endpoint + '/', submitUrl: endpoint + '/submit', lookupUrl: endpoint + '/lookup',
    fields: [{ selector: '#message', value: 'Confirmed message' }], submitSelector: '#submit', operationFieldSelector: '#marker',
    resultSelector: '#result', operationResultSelector: '#operation', expectedText: 'Saved' });
  it('returns only exact fields and refuses editable text and unscoped origin', async () => {
    expect(await driver.read({ url: endpoint + '/', selectors: ['#title'] }, endpoint)).toMatchObject({ fields: [{ selector: '#title', text: 'Scoped page' }], verification: 'OBSERVATION_ONLY' });
    await expect(driver.read({ url: endpoint + '/', selectors: ['#password'] }, endpoint)).rejects.toThrow();
    await expect(driver.read({ url: 'http://127.0.0.1:1/', selectors: ['#title'] }, endpoint)).rejects.toThrow();
    await expect(driver.read({ url: endpoint + '/', selectors: ['body'] }, endpoint)).rejects.toThrow();
    expect(posts).toBe(0);
  });
  it('rejects a forged execution through the existing Provider host before website I/O', async () => {
    const adapter = app.get(ConnectorRegistry).get('controlled_browser');
    await expect(adapter.execute!({ capability: 'BROWSER_SUBMIT_FORM', input: { config: { browser: form() }, context: {} },
      userId: owner.userId, connectionId, requestId: randomUUID(), idempotencyKey: 'a'.repeat(64) })).rejects.toThrow();
    expect(posts).toBe(0);
  });
  it('rechecks current authority before submit and prevents a revoked action', async () => {
    await expect(driver.form(form(), endpoint, 'b'.repeat(64), async () => { throw new Error('REVOKED'); })).rejects.toThrow('REVOKED');
    expect(posts).toBe(0);
  });
  async function run(label: string) {
    // Isolate action scenarios: their dispatch/recheck/lookup calls must not consume
    // each other's fixed-window connection budget.
    const actionConnectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token))
      .send({ connectorId: 'controlled_browser', externalAccountName: 'Browser ' + label, credentials: { endpoint: endpoint + '/' } }).expect(201)).body.id;
    await request(app.getHttpServer()).put(`/api/connections/${actionConnectionId}/permissions`).set(auth(owner.token))
      .send({ permissions: [{ capability: 'BROWSER_SUBMIT_FORM', granted: true }] }).expect(200);
    const created = (await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: 'Browser ' + label, domain: 'general', automationLevel: 'L2', approvalPolicy: { type: 'always' },
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'publish', connectionId: actionConnectionId, requiredCapability: 'BROWSER_SUBMIT_FORM', config: { visibility: 'private', browser: form() }, stepOrder: 0 }] }).expect(response => expect(response.status, JSON.stringify(response.body)).toBe(201))).body;
    await activatePlan(app, owner.token, created.id);
    const runId = (await request(app.getHttpServer()).post(`/api/plans/${created.id}/executions`).set(auth(owner.token)).send({ requestId: randomUUID(), triggerPayload: {} }).expect(201)).body.id;
    await worker.processExecution(runId);
    const view = (await request(app.getHttpServer()).get('/api/executions/' + runId).set(auth(owner.token)).expect(200)).body;
    expect(view.status).toBe('waiting_approval');
    await request(app.getHttpServer()).post(`/api/approvals/${view.approvals[0].id}/approve`).set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(runId);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [runId]);
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE');
    const claim = (await outbox.claim(100, 'browser')).find(row => row.id === messages[0].id)!;
    const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER'); await dispatcher.process(claim);
    const [diagnostic] = await pool.query<RowDataPacket[]>('SELECT status,error_code errorCode,error_message errorMessage FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)',[runId]);
    return { runId, claim, dispatcher, diagnostic: { operations: diagnostic } };
  }
  it('uses original risk approval and outbox, submits once and verifies operation-specific DOM read-back', async () => {
    const input = await run('approved'); expect(posts,JSON.stringify(input.diagnostic)).toBe(1); await input.dispatcher.process(input.claim); expect(posts).toBe(1);
    const [operations] = await pool.query<RowDataPacket[]>('SELECT status FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [input.runId]);
    expect(operations).toHaveLength(1); expect(operations[0].status).toBe('succeeded');
  });
  it('keeps a lost response unknown and reconciles through GET-only lookup without redispatch', async () => {
    loseResponse = true; const input = await run('lost-response'); expect(posts,JSON.stringify(input.diagnostic)).toBe(2);
    const [cases] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM reconciliation_cases WHERE execution_id=UUID_TO_BIN(?)', [input.runId]);
    expect(cases).toHaveLength(1);
    const reconciliation = app.get(ReconciliationService), claim = (await reconciliation.claim(100)).find(row => row.id === cases[0].id)!;
    await reconciliation.process(claim);
    const resolved = await reconciliation.get(owner.userId, cases[0].id);
    expect(resolved, JSON.stringify(resolved.evidence)).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED' });
    await input.dispatcher.process(input.claim); expect(posts).toBe(2);
    const [operations] = await pool.query<RowDataPacket[]>('SELECT status FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [input.runId]);
    expect(operations[0].status).toBe('outcome_unknown');
  });
});
