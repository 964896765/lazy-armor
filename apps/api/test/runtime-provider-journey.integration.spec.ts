import type { INestApplication } from '@nestjs/common';
import { candidateCapability, providerDefinitionHash, type OfficialEvidenceRevision, type ProviderAdapter,
  type ProviderCapabilityManifest, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderRuntimeService } from '../src/provider-runtime/provider-runtime.service';
import { ReconciliationService } from '../src/execution/reconciliation.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('Batch 9A real TCP journey through existing Runner', () => {
  let app: INestApplication; let pool: Pool; let worker: ExecutionWorker; let owner: Session;
  let server: Server; let endpoint: string; let connectionId: string;
  const effects = new Map<string, number>(); const lookups = new Map<string, number>();
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2); const providerKey = 'runtime-journey-' + unique;
  const capabilityKey = 'TEST_UNSAFE_PROVIDER';
  const capability = { ...candidateCapability({ key: capabilityKey, name: 'Unsafe fixture action', resource: 'network_fixture', operation: 'execute', riskLevel: 'R3', sourceModes: ['MANUAL'] }),
    providerAvailability: 'beta' as const, officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'NOT_REQUIRED' as const,
    verificationMethods: ['OPERATION_LOOKUP'], sideEffectContract: { sideEffect: true, supportsIdempotencyKey: false, supportsOperationLookup: true, retrySafety: 'unsafe' as const } };
  const manifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey, providerName: 'Isolated real network fixture', revision: 1,
    accountTypes: ['consumer'], sourceModes: ['MANUAL'], actionModes: ['EXECUTE'], providerReview: 'NOT_REQUIRED', rateLimitPolicy: 'test', capabilities: [capability], evidence: [], explicitDenials: [] };
  const evidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey, key: 'test-review', revision: 1, kind: 'MANUAL_REVIEW', status: 'NOT_REQUIRED',
    uri: 'https://example.test/runtime-journey', summary: 'Local network fixture, not Gmail integration', contentHash: 'a'.repeat(64), reviewedAt: null };
  const policy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey, revision: 1, manifestRevision: 1,
    evidence: { key: evidence.key, revision: 1, hash: providerDefinitionHash(evidence) }, rateLimit: { providerRequests: 100, connectionRequests: 100, windowSeconds: 60 },
    quota: { providerUnits: 100, connectionUnits: 100, windowSeconds: 60, capabilityUnits: { [capabilityKey]: 1 } },
    retry: { maxReadAttempts: 1, baseDelayMs: 5, maxDelayMs: 10, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
    health: { validForSeconds: 300, timeoutMs: 2000 }, verificationPolicies: [{ key: providerKey + '.verify', revision: '1', providerKey, capabilityKey,
      methods: ['OPERATION_LOOKUP'], timeoutMs: 2000, maxAttempts: 2, expiresAfterMs: 60_000, predicates: [{ path: ['status'], equals: 'done', result: 'SUCCEEDED' }] }], errorMapping: [] };
  beforeAll(async () => {
    ({ app, pool, worker } = await bootP2App('runtime-journey-' + unique)); owner = await register(app, unique + '@example.com', 'Journey owner');
    server = createServer((req, res) => {
      const key = new URL(req.url!, 'http://localhost').searchParams.get('key')!;
      if (req.method === 'POST') { effects.set(key, (effects.get(key) ?? 0) + 1); req.resume(); req.socket.destroy(); }
      else { lookups.set(key, (lookups.get(key) ?? 0) + 1); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: effects.has(key) ? 'done' : 'missing' })); }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const adapter: ProviderAdapter = {
      metadata: () => ({ key: providerKey, name: 'Local network fixture', description: 'Test only', version: '1.0.0', connectorSdkVersion: '0.1.0',
        providerType: 'internal', productionStatus: 'DRAFT_ONLY', authentication: { type: 'none' }, supportsRefresh: false, supportsRevoke: false,
        supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'full', rateLimitStrategy: 'fixed_window' }), capabilities: () => [capability],
      authorize: async () => { throw new Error('Unsupported'); }, refresh: async () => { throw new Error('Unsupported'); }, revoke: async () => {},
      health: async () => ({ status: 'healthy', checkedAt: new Date().toISOString() }), read: async () => { throw new Error('No ordinary reads'); },
      execute: async (input) => { const response = await fetch(endpoint + '?key=' + input.idempotencyKey, { method: 'POST' }); return { ok: response.ok, data: await response.json() }; },
      lookupOperation: async (input) => { const response = await fetch(endpoint + '?key=' + input.idempotencyKey); return { ok: response.ok, data: await response.json() }; },
      verify: async () => ({ state: 'OUTCOME_UNKNOWN', method: 'OPERATION_LOOKUP', evidence: {} }),
    };
    const runtime = app.get(ProviderRuntimeService); await runtime.publish({ manifest, evidence, policy });
    app.get<{ register(value: unknown): void }>('CONNECTOR_REGISTRY').register(runtime.bridge(adapter, manifest, policy));
    const id = randomUUID();
    await pool.query("INSERT INTO connectors(id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES(UUID_TO_BIN(?),?,'Network fixture','active','1.0.0',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [id, providerKey]);
    await pool.query("INSERT INTO connector_capabilities(id,connector_id,capability_key,name,operation,risk_level,provider_availability,created_at) VALUES(UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,'Unsafe test','execute','R3','beta',UTC_TIMESTAMP(6))", [id, capabilityKey]);
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: providerKey, externalAccountName: 'Isolated account' }).expect(201)).body.id;
    await request(app.getHttpServer()).put('/api/connections/' + connectionId + '/permissions').set(auth(owner.token)).send({ permissions: [{ capability: capabilityKey, granted: true }] }).expect(200);
  });
  afterAll(async () => {
    if (pool) await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key=?", [providerKey]);
    await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('rejects a write outside the immutable Execution/Approval binding before provider I/O', async () => {
    const connector = app.get<{ get(key: string): { execute(input: unknown): Promise<unknown> } }>('CONNECTOR_REGISTRY').get(providerKey);
    await expect(connector.execute({ capability: capabilityKey, input: {}, requestId: 'forged', idempotencyKey: 'f'.repeat(64), userId: owner.userId, connectionId })).rejects.toMatchObject({ providerCode: 'PERMISSION_DENIED' });
    expect(effects.size).toBe(0);
  });
  it('approves, concurrently dispatches once, loses TCP response and reconciles without redispatch', async () => {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: 'Runtime network ' + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'update_internal_record', connectionId, requiredCapability: capabilityKey, config: { recordType: 'network_fixture' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, owner.token, plan.body.id);
    const created = await request(app.getHttpServer()).post('/api/plans/' + plan.body.id + '/executions').set(auth(owner.token)).send({ requestId: unique, triggerPayload: {} }).expect(201);
    await worker.processExecution(created.body.id);
    const detail = await request(app.getHttpServer()).get('/api/executions/' + created.body.id).set(auth(owner.token)).expect(200);
    expect(detail.body.status).toBe('waiting_approval');
    await request(app.getHttpServer()).post('/api/approvals/' + detail.body.approvals[0].id + '/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(created.body.id);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [created.body.id]); expect(messages).toHaveLength(1);
    const outbox = app.get<OutboxService>('OUTBOX_SERVICE'); const dispatcher = app.get<OutboxWorker>('OUTBOX_WORKER');
    const claims = (await Promise.all([outbox.claim(1000, 'runtime-a'), outbox.claim(1000, 'runtime-b')])).flat().filter((row) => row.id === messages[0].id); expect(claims).toHaveLength(1);
    await Promise.all([dispatcher.process(claims[0]), dispatcher.process(claims[0])]);
    const [cases] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM reconciliation_cases WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]);
    const [diagnostic] = await pool.query<RowDataPacket[]>('SELECT status,error_code FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]);
    expect(cases, JSON.stringify(diagnostic)).toHaveLength(1);
    const [operations] = await pool.query<RowDataPacket[]>('SELECT idempotency_key keyValue,status,attempt_count attempts FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]);
    expect(operations[0]).toMatchObject({ status: 'outcome_unknown', attempts: 1 }); expect(effects.get(operations[0].keyValue)).toBe(1);
    const reconciliation = app.get(ReconciliationService);
    const checks = (await Promise.all([reconciliation.claim(100), reconciliation.claim(100)])).flat().filter((row) => row.id === cases[0].id); expect(checks).toHaveLength(1);
    await reconciliation.process(checks[0]);
    const final = await reconciliation.get(owner.userId, cases[0].id);
    expect(final).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED', attemptCount: 1 });
    expect(final.evidence.map((row) => row.resultState)).toEqual(['OUTCOME_UNKNOWN', 'SUCCEEDED']);
    await dispatcher.process(claims[0]); expect(effects.get(operations[0].keyValue)).toBe(1); expect(lookups.get(operations[0].keyValue)).toBe(1);
    const [history] = await pool.query<RowDataPacket[]>('SELECT status FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]); expect(history[0].status).toBe('outcome_unknown');
  });
});
