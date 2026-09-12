import type { INestApplication } from '@nestjs/common';
import { candidateCapability, type Connector, type ConnectorRequest, type VersionedProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';
import { ExecutionRuntimeError } from '../src/execution/execution.types';
import { ActionAdapter } from '../src/execution/action-adapter.service';
import { ReconciliationService, ReconciliationWorker } from '../src/execution/reconciliation.service';
import { VerificationPolicyRegistry } from '../src/execution/verification-policy-registry.service';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import type { OutboxService } from '../src/execution/side-effect/outbox.service';
import type { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { CONNECTOR_RESPONSE_POLICY, verificationPolicyHash } from '@lazy-armor/plan-schema';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { ResolutionEvidenceService } from '../src/capability-resolver/resolution-evidence.service';

describe.sequential('Batch 8 verification and reconciliation', () => {
  let app: INestApplication; let pool: Pool; let worker: ExecutionWorker; let owner: Session; let stranger: Session;
  let server: Server; let endpoint: string; let connectionId: string; let outbox: OutboxService; let outboxWorker: OutboxWorker; let service: ReconciliationService;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2); const providerKey = ('verify-' + unique).slice(0, 80);
  const capabilityKey = 'TEST_UNSAFE_VERIFIED_ACTION';
  const effects = new Map<string, number>(); const lookups = new Map<string, number>(); const statuses = new Map<string, string>();
  let resultStatus = 'done';
  const policy = { ...CONNECTOR_RESPONSE_POLICY, key: 'test-lookup-' + unique, revision: '1', providerKey, capabilityKey,
    methods: ['OPERATION_LOOKUP' as const], timeoutMs: 2000, maxAttempts: 2,
    predicates: [{ path: ['status'], equals: 'done', result: 'SUCCEEDED' as const },
      { path: ['status'], equals: 'partial', result: 'PARTIALLY_SUCCEEDED' as const }, { path: ['status'], equals: 'rejected', result: 'FAILED' as const }] };

  beforeAll(async () => {
    ({ app, pool, worker } = await bootP2App('verification-' + unique));
    owner = await register(app, 'verify-' + unique + '@example.com', 'Verification owner');
    stranger = await register(app, 'verify-other-' + unique + '@example.com', 'Other');
    server = createServer((req, res) => {
      const key = new URL(req.url!, 'http://localhost').searchParams.get('key')!;
      if (req.method === 'POST') {
        // Deliberately NO provider idempotency/dedupe: repeating this POST would produce another real side effect.
        effects.set(key, (effects.get(key) ?? 0) + 1); statuses.set(key, resultStatus);
        req.resume(); req.socket.destroy(); // The effect has committed, but the response is lost on a real TCP connection.
      } else {
        lookups.set(key, (lookups.get(key) ?? 0) + 1);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: statuses.get(key) ?? 'not_found' }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const connector: Connector = {
      metadata: () => ({ key: providerKey, name: 'Local network verification fixture', description: 'Test only', version: '1.0.0-test', connectorSdkVersion: '0.1.0',
        providerType: 'internal', productionStatus: 'DRAFT_ONLY', authentication: { type: 'none' }, supportsRefresh: false, supportsRevoke: false,
        supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'full', rateLimitStrategy: 'unknown' }),
      capabilities: () => [{ key: capabilityKey, name: 'Unsafe test action', operation: 'execute', riskLevel: 'R3', requiredPermission: capabilityKey,
        sideEffectContract: { supportsIdempotencyKey: false, supportsOperationLookup: true, retrySafety: 'unsafe' } }],
      validateConnection: async () => ({ status: 'healthy', checkedAt: new Date().toISOString() }),
      execute: async (input: ConnectorRequest) => {
        try { const response = await fetch(endpoint + '/effect?key=' + encodeURIComponent(input.idempotencyKey!), { method: 'POST' }); return { ok: response.ok, data: await response.json() }; }
        catch { throw new ExecutionRuntimeError('NETWORK_ERROR', 'Provider connection closed after request was sent', true); }
      },
      lookupOperation: async (input: ConnectorRequest) => {
        const response = await fetch(endpoint + '/lookup?key=' + encodeURIComponent(input.idempotencyKey!));
        return { ok: response.ok, data: await response.json() };
      },
    };
    app.get<{ register(value: Connector): void }>('CONNECTOR_REGISTRY').register(connector);
    const connectorId = randomUUID();
    await pool.query("INSERT INTO connectors (id,connector_key,name,status,adapter_version,created_at,updated_at) VALUES (UUID_TO_BIN(?),?,'Verification fixture','active','1.0.0-test',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [connectorId, providerKey]);
    await pool.query("INSERT INTO connector_capabilities (id,connector_id,capability_key,name,operation,risk_level,created_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,'Unsafe verified fixture','execute','R3',UTC_TIMESTAMP(6))", [connectorId, capabilityKey]);
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: providerKey, externalAccountName: 'Fixture' }).expect(201)).body.id;
    await request(app.getHttpServer()).put('/api/connections/' + connectionId + '/permissions').set(auth(owner.token)).send({ permissions: [{ capability: capabilityKey, granted: true }] }).expect(200);
    app.get(VerificationPolicyRegistry).register(policy);
    outbox = app.get('OUTBOX_SERVICE'); outboxWorker = app.get('OUTBOX_WORKER'); service = app.get(ReconciliationService);
  });
  afterAll(async () => { await pool?.end(); await app?.close(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

  async function unknown(label: string, status = 'done', resolved = false, crashed = false) {
    resultStatus = status;
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send({ name: 'Verification ' + label + unique, domain: 'general', automationLevel: 'L2',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [],
      actions: [{ actionType: 'update_internal_record', connectionId, requiredCapability: capabilityKey, config: { recordType: 'network_fixture' }, stepOrder: 0 }] }).expect(201);
    await activatePlan(app, owner.token, plan.body.id);
    let resolutionDecisionIds: string[] | undefined;
    if (resolved) {
      const requirement = { schemaVersion: '1', capabilityKey, resource: 'network_fixture', operation: 'execute', fields: ['recordType'], purpose: 'scenario_runtime',
        minimumReality: 'VERIFIED', maxAgeSeconds: 60, maxRisk: 'R3', maxCostMicros: 0, preferredProviders: [], preferredSourceModes: [] };
      const resolution = await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send({ planVersionId: plan.body.currentVersion.id, requestKey: unique + label + '-resolution', requirement }).expect(201);
      expect(resolution.body.decisionJson.status).toBe('RESOLVED'); resolutionDecisionIds = [resolution.body.id];
    }
    const route = '/api/plans/' + plan.body.id + (resolved ? '/resolved-executions' : '/executions');
    const input = { requestId: unique + label, triggerPayload: {}, ...(resolved ? { resolutionDecisionIds } : {}) };
    if (resolved) await request(app.getHttpServer()).post(route).set(auth(owner.token)).send({ ...input, triggerPayload: { sensitiveData: true } }).expect(409);
    const created = await request(app.getHttpServer()).post(route).set(auth(owner.token)).send(input).expect(201);
    if (resolved) {
      await request(app.getHttpServer()).post(route).set(auth(owner.token)).send({ ...input, triggerPayload: { changed: true } }).expect(409);
      const intents = await request(app.getHttpServer()).get('/api/executions/' + created.body.id + '/action-intents').set(auth(owner.token)).expect(200);
      expect(intents.body[0].adapter.capabilityResolutionDecisionId).toBe(resolutionDecisionIds![0]);
      expect(intents.body[0].effectiveRiskLevel).toBe('R3');
    }
    await worker.processExecution(created.body.id);
    const detail = await request(app.getHttpServer()).get('/api/executions/' + created.body.id).set(auth(owner.token)).expect(200);
    expect(detail.body.status).toBe('waiting_approval');
    await expect(app.get(ActionAdapter).assertOperation(created.body.id, detail.body.steps[0].id)).rejects.toMatchObject({ code: 'APPROVAL_NOT_VALID' });
    await request(app.getHttpServer()).post('/api/approvals/' + detail.body.approvals[0].id + '/approve').set(auth(owner.token)).send({}).expect(201);
    await worker.processExecution(created.body.id);
    const [messages] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))=?", [created.body.id]);
    expect(messages).toHaveLength(1);
    // Real database concurrent claims; only the winning lease holder dispatches our fixture message.
    const claims = (await Promise.all([outbox.claim(100, 'verification-a'), outbox.claim(100, 'verification-b')])).flat().filter((row) => row.id === messages[0].id);
    expect(claims).toHaveLength(1);
    if (crashed) {
      const [operations] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id, idempotency_key keyValue FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]);
      // Fault injection at the persisted dispatch checkpoint, followed by a real provider call whose response is lost.
      await pool.query("UPDATE side_effect_operations SET status='executing',attempt_count=1,started_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [operations[0].id]);
      await expect(app.get<{ get(key: string): Connector }>('CONNECTOR_REGISTRY').get(providerKey).execute!({ capability: capabilityKey, input: {}, requestId: 'crashed', idempotencyKey: operations[0].keyValue })).rejects.toThrow('closed');
    }
    await outboxWorker.process(claims[0]);
    const [cases] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(operation_id) operationId FROM reconciliation_cases WHERE execution_id=UUID_TO_BIN(?)', [created.body.id]);
    expect(cases).toHaveLength(1);
    const [operations] = await pool.query<RowDataPacket[]>('SELECT idempotency_key keyValue, status, attempt_count attempts FROM side_effect_operations WHERE id=UUID_TO_BIN(?)', [cases[0].operationId]);
    expect(operations[0]).toMatchObject({ status: 'outcome_unknown', attempts: 1 });
    expect(effects.get(operations[0].keyValue)).toBe(1);
    return { executionId: created.body.id, caseId: cases[0].id as string, key: operations[0].keyValue as string, message: claims[0] };
  }

  it('migrates additive tables, publishes policy contracts and guards ownership', async () => {
    const [tables] = await pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('verification_policies','verification_evidence','reconciliation_cases')");
    expect(tables).toHaveLength(3);
    const response = await request(app.getHttpServer()).get('/api/verification-policies').set(auth(owner.token)).expect(200);
    expect(response.body.some((item: { definitionHash: string }) => item.definitionHash === verificationPolicyHash(policy))).toBe(true);
    await request(app.getHttpServer()).get('/api/reconciliation-cases').expect(401);
    expect(() => app.get(VerificationPolicyRegistry).register({ ...policy, timeoutMs: 500 })).toThrow('immutable');
  });

  it('closes real side effect + network loss under concurrency without a second execution', async () => {
    const input = await unknown('network-close');
    await request(app.getHttpServer()).get('/api/reconciliation-cases/' + input.caseId).set(auth(stranger.token)).expect(404);
    await request(app.getHttpServer()).post('/api/reconciliation-cases/' + input.caseId + '/recheck').set(auth(stranger.token)).send({}).expect(404);
    const before = await request(app.getHttpServer()).get('/api/executions/' + input.executionId + '/verification').set(auth(owner.token)).expect(200);
    expect(before.body.resultState).toBe('OUTCOME_UNKNOWN');
    const claims = (await Promise.all([service.claim(100), service.claim(100), service.claim(100)])).flat().filter((row) => row.id === input.caseId);
    expect(claims).toHaveLength(1); await service.process(claims[0]);
    const detail = await request(app.getHttpServer()).get('/api/reconciliation-cases/' + input.caseId).set(auth(owner.token)).expect(200);
    expect(detail.body).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED', attemptCount: 1 });
    expect(detail.body.evidence.map((item: { resultState: string }) => item.resultState)).toEqual(['OUTCOME_UNKNOWN', 'SUCCEEDED']);
    await Promise.all([app.get(ReconciliationWorker).poll(), app.get(ReconciliationWorker).poll()]);
    await outboxWorker.process(input.message); await outboxWorker.poll();
    await request(app.getHttpServer()).post('/api/reconciliation-cases/' + input.caseId + '/recheck').set(auth(owner.token)).send({}).expect(201);
    expect(effects.get(input.key)).toBe(1); expect(lookups.get(input.key)).toBe(1);
    const result = await request(app.getHttpServer()).get('/api/executions/' + input.executionId + '/verification').set(auth(owner.token)).expect(200);
    expect(result.body).toMatchObject({ resultState: 'SUCCEEDED', historicalExecutionStatus: 'failed' });
    const [history] = await pool.query<RowDataPacket[]>("SELECT status FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)", [input.executionId]);
    expect(history[0].status).toBe('outcome_unknown');
    const [audits] = await pool.query<RowDataPacket[]>("SELECT id FROM audit_logs WHERE resource_id=? AND action='RECONCILIATION_RESOLVED'", [input.caseId]);
    expect(audits).toHaveLength(1);
  });

  it('fences expired leases, permits read-only takeover and records partial results', async () => {
    const input = await unknown('lease-takeover', 'partial');
    const prior = (await service.claim(100)).find((row) => row.id === input.caseId)!;
    await pool.query('UPDATE reconciliation_cases SET lease_until=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [input.caseId]);
    const next = (await service.claim(100)).find((row) => row.id === input.caseId)!;
    expect(next.leaseToken).not.toBe(prior.leaseToken);
    expect(await service.process(prior)).toEqual({ fenced: true });
    await service.process(next);
    const detail = await service.get(owner.userId, input.caseId);
    expect(detail).toMatchObject({ status: 'RESOLVED', resultState: 'PARTIALLY_SUCCEEDED', attemptCount: 2 });
    expect(detail.evidence).toHaveLength(2); expect(effects.get(input.key)).toBe(1);
  });

  it('does not treat pending/missing lookup data as success and stops at the retry bound', async () => {
    const input = await unknown('pending', 'pending');
    const first = (await service.claim(100)).find((row) => row.id === input.caseId)!; await service.process(first);
    expect((await service.get(owner.userId, input.caseId)).status).toBe('OPEN');
    await request(app.getHttpServer()).post('/api/reconciliation-cases/' + input.caseId + '/recheck').set(auth(owner.token)).send({}).expect(201);
    const second = (await service.claim(100)).find((row) => row.id === input.caseId)!; await service.process(second);
    expect(await service.get(owner.userId, input.caseId)).toMatchObject({ status: 'NEEDS_USER', resultState: 'OUTCOME_UNKNOWN', attemptCount: 2 });
    await request(app.getHttpServer()).post('/api/reconciliation-cases/' + input.caseId + '/recheck').set(auth(owner.token)).send({}).expect(409);
    expect(effects.get(input.key)).toBe(1);
  });

  it('joins a verified server-side Resolver decision through ActionIntent, Approval, Runner and reconciliation', async () => {
    const capability = candidateCapability({ key: capabilityKey, name: 'Verified test only', operation: 'execute', riskLevel: 'R3', resource: 'network_fixture', sourceModes: ['MANUAL'] });
    const manifest = { schemaVersion: '1', providerKey, providerName: 'Local fixture only', revision: 1, manifestHash: 'e'.repeat(64), accountTypes: [],
      sourceModes: ['MANUAL'], actionModes: ['EXECUTE'], providerReview: 'VERIFIED', rateLimitPolicy: 'test', evidence: [], explicitDenials: [],
      capabilities: [{ ...capability, officialAvailability: 'AVAILABLE', implementationStatus: 'PRODUCTION', reviewStatus: 'VERIFIED', accountTypes: [],
        verificationMethods: ['OPERATION_LOOKUP'], sideEffectContract: { sideEffect: true, supportsIdempotencyKey: false, supportsOperationLookup: true, retrySafety: 'unsafe' },
        dataBoundary: { resources: ['network_fixture'], readableFields: [], writableFields: ['recordType'], purpose: ['scenario_runtime'] } }] } as VersionedProviderCapabilityManifest;
    const mock = vi.spyOn(app.get(ProviderCapabilityRegistryService), 'list').mockReturnValue([manifest]);
    app.get(ResolutionEvidenceService).register(providerKey, async () => ({ accountSatisfied: true, deviceSatisfied: true, reality: 'VERIFIED', observedAt: new Date().toISOString(), costMicros: 0, latencyMs: 1, reliability: 1 }));
    await pool.query("INSERT INTO connection_capability_grants (id,connection_id,provider_key,capability_key,status,granted_scopes_json,granted_at,source,created_at,updated_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,?,'GRANTED',JSON_ARRAY(),UTC_TIMESTAMP(6),'test',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE status='GRANTED',expires_at=NULL,revoked_at=NULL", [connectionId, providerKey, capabilityKey]);
    await pool.query("INSERT INTO provider_capability_health (id,connection_id,provider_key,capability_key,status,checked_at,valid_until,created_at,updated_at) VALUES (UUID_TO_BIN(UUID()),UUID_TO_BIN(?),?,?,'HEALTHY',UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 10 MINUTE),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE status='HEALTHY',valid_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 10 MINUTE),checked_at=UTC_TIMESTAMP(6)", [connectionId, providerKey, capabilityKey]);
    try {
      const input = await unknown('resolved-runtime', 'done', true);
      const claimed = (await service.claim(100)).find((row) => row.id === input.caseId)!; await service.process(claimed);
      expect(await service.get(owner.userId, input.caseId)).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED' });
      expect(effects.get(input.key)).toBe(1);
    } finally { mock.mockRestore(); }
  });

  it('blocks lookup after permission revocation and never redispatches the prior side effect', async () => {
    const input = await unknown('revoked-lookup');
    await request(app.getHttpServer()).put('/api/connections/' + connectionId + '/permissions').set(auth(owner.token)).send({ permissions: [{ capability: capabilityKey, granted: false }] }).expect(200);
    try {
      const claim = (await service.claim(100)).find((row) => row.id === input.caseId)!; await service.process(claim);
      expect(await service.get(owner.userId, input.caseId)).toMatchObject({ resultState: 'OUTCOME_UNKNOWN' });
      expect(lookups.get(input.key)).toBeUndefined(); expect(effects.get(input.key)).toBe(1);
      await outboxWorker.process(input.message); expect(effects.get(input.key)).toBe(1);
    } finally {
      await request(app.getHttpServer()).put('/api/connections/' + connectionId + '/permissions').set(auth(owner.token)).send({ permissions: [{ capability: capabilityKey, granted: true }] }).expect(200);
    }
  });

  it('recovers an unsafe persisted dispatch after a crash using lookup only', async () => {
    const input = await unknown('unsafe-crashed-dispatch', 'done', false, true);
    const claim = (await service.claim(100)).find((row) => row.id === input.caseId)!; await service.process(claim);
    expect(await service.get(owner.userId, input.caseId)).toMatchObject({ status: 'RESOLVED', resultState: 'SUCCEEDED' });
    expect(effects.get(input.key)).toBe(1); expect(lookups.get(input.key)).toBe(1);
  });
});
