import type { INestApplication } from '@nestjs/common';
import { candidateCapability, type ProviderAdapter, type ProviderCapabilityManifest, type ProviderRuntimePolicy,
  type OfficialEvidenceRevision, providerDefinitionHash } from '@lazy-armor/connector-sdk';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProviderRuntimeService } from '../src/provider-runtime/provider-runtime.service';
import { RateLimiterService } from '../src/infrastructure/rate-limiter.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('Batch 9A Provider runtime foundation', () => {
  let app: INestApplication; let pool: Pool; let service: ProviderRuntimeService; let owner: Session; let stranger: Session;
  let connectionId: string; let server: Server; let endpoint: string; let reads = 0;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2); const providerKey = 'runtime-fixture-' + unique;
  const capability = { ...candidateCapability({ key: 'READ_FIXTURE', name: 'Isolated fixture read', resource: 'test.record', sourceModes: ['MANUAL'] }),
    officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'NOT_REQUIRED' as const, providerAvailability: 'beta' as const };
  const manifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey, providerName: 'Isolated test adapter', revision: 1, accountTypes: ['consumer'],
    sourceModes: ['MANUAL'], actionModes: ['OBSERVE'], providerReview: 'NOT_REQUIRED', rateLimitPolicy: 'test', capabilities: [capability], evidence: [], explicitDenials: [] };
  const evidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey, key: 'isolated-review', revision: 1, kind: 'MANUAL_REVIEW', status: 'NOT_REQUIRED',
    uri: 'https://example.test/runtime', summary: 'Fixture only, not official provider evidence', contentHash: 'a'.repeat(64), reviewedAt: null };
  const policy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey, revision: 1, manifestRevision: 1,
    evidence: { key: evidence.key, revision: 1, hash: providerDefinitionHash(evidence) }, rateLimit: { providerRequests: 100, connectionRequests: 100, windowSeconds: 86400 },
    // Connection creation performs one real health probe; one further read is budgeted.
    quota: { providerUnits: 100, connectionUnits: 2, windowSeconds: 86400, capabilityUnits: { READ_FIXTURE: 1 } },
    retry: { maxReadAttempts: 1, baseDelayMs: 10, maxDelayMs: 10, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
    health: { validForSeconds: 60, timeoutMs: 1000 }, verificationPolicies: [], errorMapping: [] };
  const adapter: ProviderAdapter = {
    metadata: () => ({ key: providerKey, name: 'Fixture', description: 'Test only', version: '1.0.0', connectorSdkVersion: '0.1.0', providerType: 'internal',
      productionStatus: 'DRAFT_ONLY', authentication: { type: 'none' }, supportsRefresh: false, supportsRevoke: true, supportsWebhook: false,
      supportsHealthCheck: true, sandboxSupport: 'full', rateLimitStrategy: 'fixed_window' }), capabilities: () => [capability],
    authorize: async () => { throw new Error('Unsupported'); }, refresh: async () => { throw new Error('Unsupported'); },
    revoke: vi.fn(async () => {}), health: async () => ({ status: 'healthy', checkedAt: new Date().toISOString() }),
    read: async () => { const response = await fetch(endpoint); return { ok: response.ok, data: await response.json() }; },
    execute: async () => { throw new Error('No write capability'); }, verify: async () => ({ state: 'OUTCOME_UNKNOWN', method: 'PROVIDER_RESPONSE', evidence: {} }),
  };
  beforeAll(async () => {
    ({ app, pool } = await bootP2App('provider-runtime-' + unique)); service = app.get(ProviderRuntimeService);
    owner = await register(app, 'runtime-' + unique + '@example.com', 'Runtime owner'); stranger = await register(app, 'runtime-other-' + unique + '@example.com', 'Other');
    server = createServer((_req, res) => { reads++; res.setHeader('content-type', 'application/json'); res.end('{"value":1}'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    // Preserve all evidence/rows; only deactivate this isolated fixture for later suites.
    if (pool) await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key=?", [providerKey]);
    await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('concurrently publishes the same immutable bundle with one manifest, evidence and policy', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => service.publish({ manifest, evidence, policy })));
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    for (const table of ['provider_capability_manifests', 'provider_capability_evidence', 'provider_runtime_policies']) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ' + table + ' WHERE provider_key=?', [providerKey]);
      expect(rows[0].n).toBe(1);
    }
  });
  it('conflicting revisions and mismatched evidence roll back without modifying history', async () => {
    const before = await service.get(providerKey);
    await expect(service.publish({ manifest, evidence, policy: { ...policy, quota: { ...policy.quota, connectionUnits: 3 } } })).rejects.toThrow('immutable');
    await expect(service.publish({ manifest, evidence: { ...evidence, summary: 'changed' }, policy })).rejects.toThrow('binding');
    await expect(service.publish({ manifest: { ...manifest, providerName: 'changed' }, evidence, policy })).rejects.toThrow('immutable');
    expect(await service.get(providerKey)).toEqual(before);
  });
  it('reuses the existing deterministic verification evaluator, not adapter success claims', () => {
    const verification = { key: providerKey + '.verify', revision: '1', providerKey, capabilityKey: 'WRITE_FIXTURE',
      methods: ['OPERATION_LOOKUP' as const], timeoutMs: 1000, maxAttempts: 1, expiresAfterMs: 60_000,
      predicates: [{ path: ['status'], equals: 'done', result: 'SUCCEEDED' as const }] };
    expect(service.verifyEvidence(verification, { state: 'SUCCEEDED', method: 'OPERATION_LOOKUP', evidence: {} })).toBe('OUTCOME_UNKNOWN');
    expect(service.verifyEvidence(verification, { state: 'SUCCEEDED', method: 'PROVIDER_RESPONSE', evidence: { status: 'done' } })).toBe('OUTCOME_UNKNOWN');
    expect(service.verifyEvidence(verification, { state: 'SUCCEEDED', method: 'OPERATION_LOOKUP', evidence: { status: 'done' } })).toBe('SUCCEEDED');
  });
  it('protects read-only policy routes by role and revision contracts', async () => {
    await request(app.getHttpServer()).get('/api/provider-runtime/policies').expect(401);
    await request(app.getHttpServer()).get('/api/provider-runtime/policies').set(auth(owner.token)).expect(403);
    await pool.query("UPDATE users SET role='operations_readonly' WHERE id=UUID_TO_BIN(?)", [owner.userId]);
    const response = await request(app.getHttpServer()).get('/api/provider-runtime/policies/' + providerKey).set(auth(owner.token)).expect(200);
    expect(response.body).toMatchObject({ revision: 1, definitionHash: providerDefinitionHash(policy), definitionJson: policy });
    await request(app.getHttpServer()).get('/api/provider-runtime/policies/' + providerKey + '/revisions/1').set(auth(owner.token)).expect(200);
    await request(app.getHttpServer()).get('/api/provider-runtime/policies/' + providerKey + '/revisions/bad').set(auth(owner.token)).expect(400);
    await request(app.getHttpServer()).get('/api/provider-runtime/policies/unknown-provider').set(auth(owner.token)).expect(404);
    await request(app.getHttpServer()).post('/api/provider-runtime/policies/' + providerKey + '/execute').set(auth(owner.token)).send({}).expect(404);
  });
  it('connection views use actual registration, isolate tenants and block missing grants before I/O', async () => {
    app.get<{ register(value: unknown): void }>('CONNECTOR_REGISTRY').register(service.bridge(adapter, manifest, policy));
    const connectorId = randomUUID();
    await pool.query("INSERT INTO connectors(id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES(UUID_TO_BIN(?),?,'Runtime fixture','active','1.0.0',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [connectorId, providerKey]);
    await pool.query("INSERT INTO connector_capabilities(id,connector_id,capability_key,name,operation,risk_level,provider_availability,created_at) VALUES(UUID_TO_BIN(UUID()),UUID_TO_BIN(?),'READ_FIXTURE','Read fixture','read','R0','beta',UTC_TIMESTAMP(6))", [connectorId]);
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: providerKey, externalAccountName: 'Test only' }).expect(201)).body.id;
    await request(app.getHttpServer()).get('/api/connections/' + connectionId + '/provider-runtime').set(auth(stranger.token)).expect(404);
    const view = await request(app.getHttpServer()).get('/api/connections/' + connectionId + '/provider-runtime').set(auth(owner.token)).expect(200);
    expect(view.body).toMatchObject({ runtimeRegistered: true, runtimePolicy: { definitionJson: policy } });
    await expect(service.bridge(adapter, manifest, policy).read({ capability: capability.key, input: {}, requestId: 'no-grant', userId: owner.userId, connectionId })).rejects.toMatchObject({ providerCode: 'PERMISSION_DENIED' });
    expect(reads).toBe(0);
    await request(app.getHttpServer()).put('/api/connections/' + connectionId + '/permissions').set(auth(owner.token)).send({ permissions: [{ capability: capability.key, granted: true }] }).expect(200);
  });
  it('stale health and expired grant fail closed before any request', async () => {
    const input = { capability: capability.key, input: {}, requestId: 'stale', userId: owner.userId, connectionId };
    await pool.query("INSERT INTO provider_capability_health(id,connection_id,provider_key,capability_key,status,checked_at,valid_until,created_at,updated_at) VALUES(UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,'READ_FIXTURE','HEALTHY',DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 HOUR),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE checked_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE),valid_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 HOUR)", [connectionId, providerKey]);
    await expect(service.bridge(adapter, manifest, policy).read(input)).rejects.toMatchObject({ providerCode: 'PROVIDER_UNAVAILABLE' });
    await pool.query("UPDATE connection_capability_grants SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?)", [connectionId]);
    await expect(service.bridge(adapter, manifest, policy).read(input)).rejects.toMatchObject({ providerCode: 'SCOPE_MISSING' });
    expect(reads).toBe(0);
    await pool.query('UPDATE connection_capability_grants SET expires_at=NULL WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    await pool.query('UPDATE provider_capability_health SET checked_at=UTC_TIMESTAMP(6),valid_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
  });
  it('atomic weighted quota permits one real network read under concurrent requests', async () => {
    const bridge = service.bridge(adapter, manifest, policy);
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => bridge.read({ capability: capability.key, input: {}, requestId: 'quota-' + i, userId: owner.userId, connectionId })));
    expect(results.filter((item) => item.status === 'fulfilled'), JSON.stringify(results.map((item) => item.status === 'rejected' ? { code: item.reason.code, providerCode: item.reason.providerCode, message: item.reason.message } : 'ok'))).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected').every((item) => item.status === 'rejected' && item.reason.providerCode === 'QUOTA_EXCEEDED')).toBe(true);
    expect(reads).toBe(1);
    const limiter = app.get(RateLimiterService); const key = 'weighted-' + unique;
    const budgets = await Promise.all(Array.from({ length: 5 }, () => limiter.consume(key, 6, 60, 2)));
    expect(budgets.filter((item) => item.allowed)).toHaveLength(3);
    await expect(limiter.consume(key, 6, 60, 0)).rejects.toThrow('Invalid');
  });
  it('scoped revoke remains locally fail-closed and passes owner context to the adapter', async () => {
    await Promise.allSettled([request(app.getHttpServer()).delete('/api/connections/' + connectionId).set(auth(owner.token)).expect(204),
      ...Array.from({ length: 4 }, () => service.recordHealth(policy, { capability: capability.key, input: {}, requestId: 'revoke-health-race', userId: owner.userId, connectionId }, { status: 'healthy', checkedAt: new Date().toISOString() }))]);
    expect(adapter.revoke).toHaveBeenCalledWith(expect.objectContaining({ userId: owner.userId, connectionId }));
    await expect(service.bridge(adapter, manifest, policy).read({ capability: capability.key, input: {}, requestId: 'revoked', userId: owner.userId, connectionId })).rejects.toMatchObject({ code: 'CONNECTION_REVOKED' });
    const view = await request(app.getHttpServer()).get('/api/connections/' + connectionId + '/provider-runtime').set(auth(owner.token)).expect(200);
    expect(view.body.capabilities[0]).toMatchObject({ usable: false, grant: 'REVOKED', health: 'PERMISSION_REVOKED' });
    expect(reads).toBe(1);
  });
  it('publishes independent evidence and policy revisions and reloads the active manifest', async () => {
    const before = await service.get(providerKey, 1);
    const nextEvidence = { ...evidence, revision: 2, summary: 'Second isolated review' };
    const nextPolicy = { ...policy, revision: 2, manifestRevision: 2, evidence: { key: evidence.key, revision: 2, hash: providerDefinitionHash(nextEvidence) } };
    await service.publish({ manifest: { ...manifest, revision: 2 }, evidence: nextEvidence, policy: nextPolicy });
    expect(await service.get(providerKey, 1)).toEqual(before);
    const registry = app.get(ProviderCapabilityRegistryService); await registry.onModuleInit();
    expect(registry.get(providerKey).revision).toBe(2);
    await expect(service.publish({ manifest, evidence, policy })).rejects.toThrow('backwards');
    const [rows] = await pool.query<RowDataPacket[]>('SELECT revision,status FROM provider_capability_manifests WHERE provider_key=? ORDER BY revision', [providerKey]);
    expect(rows).toEqual([{ revision: 1, status: 'SUPERSEDED' }, { revision: 2, status: 'ACTIVE' }]);
  });
  it('a legacy health response cannot resurrect a connection revoked while its I/O was in flight', async () => {
    const id = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: 'manual', externalAccountName: 'Health race fixture' }).expect(201)).body.id;
    const registry = app.get<{ get(key: string): { validateConnection?: () => Promise<{ status: 'healthy'; checkedAt: string }> } }>('CONNECTOR_REGISTRY');
    const manual = registry.get('manual'); const original = manual.validateConnection;
    let started!: () => void; let finish!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; }); const release = new Promise<void>((resolve) => { finish = resolve; });
    manual.validateConnection = async () => { started(); await release; return { status: 'healthy', checkedAt: new Date().toISOString() }; };
    const pending = request(app.getHttpServer()).post('/api/connections/' + id + '/validate').set(auth(owner.token)).then((response) => response);
    try {
      await entered; await request(app.getHttpServer()).delete('/api/connections/' + id).set(auth(owner.token)).expect(204); finish();
      expect((await pending).status).toBe(403);
      const view = await request(app.getHttpServer()).get('/api/connections/' + id).set(auth(owner.token)).expect(200);
      expect(view.body.status).toBe('revoked');
    } finally { finish(); manual.validateConnection = original; }
  });
});
