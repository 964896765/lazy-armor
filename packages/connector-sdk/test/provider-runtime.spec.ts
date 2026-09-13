import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { candidateCapability, ConnectorError, ProviderCapabilityRegistry, ProviderConnectorBridge, ProviderRuntimeError,
  mapProviderFailure, providerDefinitionHash, providerErrorToConnector, validateOfficialEvidenceRevision,
  validateProviderRuntimePolicy, type ConnectorRequest, type OfficialEvidenceRevision, type ProviderAdapter,
  type ProviderCapabilityManifest, type ProviderRuntimePolicy, type ProviderResultState } from '../src';

function fixture(oauth = false) {
  const cap = { ...candidateCapability({ key: 'READ_FIXTURE', name: 'Read fixture', resource: 'test.record', sourceModes: ['MANUAL'] }),
    officialAvailability: 'AVAILABLE' as const, implementationStatus: 'BETA' as const, reviewStatus: 'NOT_REQUIRED' as const,
    providerAvailability: 'beta' as const, oauthScopes: oauth ? ['fixture.read'] : [] };
  const write = { ...cap, key: 'WRITE_FIXTURE', operation: 'execute' as const, riskLevel: 'R3' as const,
    oauthScopes: oauth ? ['fixture.write'] : [], verificationMethods: ['OPERATION_LOOKUP'],
    sideEffectContract: { sideEffect: true, supportsIdempotencyKey: false, supportsOperationLookup: true, retrySafety: 'unsafe' as const } };
  const manifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey: 'runtime_fixture', providerName: 'Isolated fixture',
    revision: 1, providerReview: 'NOT_REQUIRED', accountTypes: ['consumer'], sourceModes: ['MANUAL'], actionModes: ['OBSERVE', 'EXECUTE'],
    rateLimitPolicy: 'test', capabilities: [cap, write], evidence: [], explicitDenials: [] };
  const evidence: OfficialEvidenceRevision = { schemaVersion: '1', providerKey: manifest.providerKey, key: 'test-review', revision: 1,
    kind: 'MANUAL_REVIEW', status: 'NOT_REQUIRED', uri: 'https://example.test/runtime', summary: 'Isolated fixture, not a real provider', contentHash: 'a'.repeat(64), reviewedAt: null };
  const policy: ProviderRuntimePolicy = { schemaVersion: '1', providerKey: manifest.providerKey, revision: 1, manifestRevision: 1,
    evidence: { key: evidence.key, revision: 1, hash: providerDefinitionHash(evidence) },
    rateLimit: { providerRequests: 10, connectionRequests: 5, windowSeconds: 60 },
    quota: { providerUnits: 20, connectionUnits: 10, windowSeconds: 60, capabilityUnits: { READ_FIXTURE: 1, WRITE_FIXTURE: 2 } },
    retry: { maxReadAttempts: 2, baseDelayMs: 5, maxDelayMs: 20, writeMode: 'EXISTING_OUTBOX_ONLY', unknownMode: 'RECONCILE_ONLY' },
    health: { validForSeconds: 60, timeoutMs: 1000 }, verificationPolicies: [{ key: 'runtime_fixture.verify', revision: '1',
      providerKey: manifest.providerKey, capabilityKey: 'WRITE_FIXTURE', methods: ['OPERATION_LOOKUP'], timeoutMs: 1000, maxAttempts: 2, expiresAfterMs: 60_000,
      predicates: [{ path: ['status'], equals: 'done', result: 'SUCCEEDED' }] }], errorMapping: [{ providerCode: 'insufficient_scope', httpStatus: 403, code: 'SCOPE_MISSING' }] };
  const adapter: ProviderAdapter = {
    metadata: () => ({ key: manifest.providerKey, name: 'Fixture', description: 'test only', version: '1.0.0', connectorSdkVersion: '0.1.0',
      providerType: 'internal', productionStatus: 'DRAFT_ONLY', authentication: { type: oauth ? 'oauth2' : 'none' }, supportsRefresh: true,
      supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'full', rateLimitStrategy: 'fixed_window' }),
    capabilities: () => manifest.capabilities, authorize: vi.fn(async () => { throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); }),
    refresh: vi.fn(async () => { throw new ProviderRuntimeError('AUTH_EXPIRED', 'BEFORE_DISPATCH'); }), revoke: vi.fn(async () => {}),
    health: vi.fn(async () => ({ status: 'healthy' as const, checkedAt: new Date().toISOString() })),
    read: vi.fn(async () => ({ ok: true, data: { value: 1 } })), execute: vi.fn(async () => ({ ok: true, data: { status: 'done' } })),
    lookupOperation: vi.fn(async () => ({ ok: true, data: { status: 'done' } })), verify: vi.fn(async () => ({ state: 'SUCCEEDED' as const, method: 'OPERATION_LOOKUP' as const, evidence: { status: 'done' } })),
  };
  const host = { assertPolicyActive: vi.fn(async () => {}), beforeOperation: vi.fn(async () => {}), verifyEvidence: vi.fn((_policy, result) => result.state as ProviderResultState) };
  const bridge = new ProviderConnectorBridge(adapter, manifest, policy, host);
  const request: ConnectorRequest = { capability: 'READ_FIXTURE', input: {}, requestId: 'test', userId: 'owner', connectionId: 'owned', connectorKey: manifest.providerKey };
  return { adapter, bridge, manifest, policy, evidence, host, request };
}
describe('Provider runtime common contract', () => {
  it('validates bounded revision policies and canonical hashes', () => {
    const { manifest, policy, evidence } = fixture();
    expect(() => validateOfficialEvidenceRevision(evidence)).not.toThrow();
    expect(() => validateProviderRuntimePolicy(policy, manifest)).not.toThrow();
    expect(providerDefinitionHash({ z: 1, a: 2 })).toBe(providerDefinitionHash({ a: 2, z: 1 }));
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity])('rejects quota budget %s', (value) => {
    const { manifest, policy } = fixture(); policy.quota.connectionUnits = value;
    expect(() => validateProviderRuntimePolicy(policy, manifest)).toThrow();
  });
  it('rejects missing costs, unsafe retries, unknown fields and ambiguous error mappings', () => {
    const { manifest, policy } = fixture();
    const missing = structuredClone(policy); delete missing.quota.capabilityUnits.WRITE_FIXTURE;
    expect(() => validateProviderRuntimePolicy(missing, manifest)).toThrow();
    expect(() => validateProviderRuntimePolicy({ ...policy, extra: true } as ProviderRuntimePolicy, manifest)).toThrow();
    expect(() => validateProviderRuntimePolicy({ ...policy, errorMapping: [...policy.errorMapping, ...policy.errorMapping] }, manifest)).toThrow();
    const unsafe = structuredClone(policy); unsafe.retry.unknownMode = 'RETRY' as never;
    expect(() => validateProviderRuntimePolicy(unsafe, manifest)).toThrow();
  });
  it('does not accept token-bearing evidence URLs or unofficial NOT_REQUIRED evidence', () => {
    const { evidence } = fixture();
    expect(() => validateOfficialEvidenceRevision({ ...evidence, uri: evidence.uri + '?token=secret' })).toThrow();
    expect(() => validateOfficialEvidenceRevision({ ...evidence, kind: 'OFFICIAL_DOC' })).toThrow();
    expect(() => validateOfficialEvidenceRevision({ ...evidence, status: 'VERIFIED' })).toThrow();
  });
  it('protects revision snapshots against caller mutation and revision rollback', () => {
    const { manifest, bridge, policy } = fixture(); const registry = new ProviderCapabilityRegistry();
    registry.register(manifest); registry.get(manifest.providerKey)!.providerReview = 'VERIFIED';
    expect(registry.get(manifest.providerKey)!.providerReview).toBe('NOT_REQUIRED');
    registry.register({ ...manifest, revision: 2 }); expect(() => registry.register(manifest)).toThrow();
    bridge.policy.quota.connectionUnits = 100; policy.quota.connectionUnits = 200;
    expect(bridge.policy.quota.connectionUnits).toBe(10);
  });
  it('rejects unknown official review, wrong operation and absent scoped write context before I/O', async () => {
    const f = fixture();
    await expect(f.bridge.execute(f.request)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(f.bridge.execute({ ...f.request, capability: 'WRITE_FIXTURE' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const bridge = new ProviderConnectorBridge(f.adapter, { ...f.manifest, providerReview: 'TO_VERIFY_OFFICIAL' }, f.policy, f.host);
    await expect(bridge.read(f.request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(f.adapter.read).not.toHaveBeenCalled(); expect(f.adapter.execute).not.toHaveBeenCalled();
  });
  it('enforces owned credential resolution, token expiry and actual OAuth scopes', async () => {
    const f = fixture(true);
    await expect(f.bridge.read(f.request)).rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' });
    await expect(f.bridge.read({ ...f.request, credentials: { data: { accessToken: 'private', scopes: '' } } })).rejects.toMatchObject({ providerCode: 'SCOPE_MISSING' });
    await expect(f.bridge.read({ ...f.request, credentials: { data: { accessToken: 'private', scopes: 'fixture.read', expiresAt: 'invalid' } } })).rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' });
    await expect(f.bridge.read({ ...f.request, credentials: { data: { accessToken: 'private', scopes: 'fixture.read' } } })).resolves.toMatchObject({ ok: true });
    expect(f.adapter.read).toHaveBeenCalledTimes(1);
  });
  it.each(['PARTIALLY_SUCCEEDED', 'OUTCOME_UNKNOWN'] as ProviderResultState[])('does not promote %s to success or retry execute', async (state) => {
    const f = fixture(); f.adapter.verify = vi.fn(async () => ({ state, method: 'OPERATION_LOOKUP' as const, evidence: {} }));
    await expect(f.bridge.execute({ ...f.request, capability: 'WRITE_FIXTURE', idempotencyKey: 'op' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', category: 'OUTCOME_UNKNOWN', retryable: false, operationState: 'unknown' });
    expect(f.adapter.execute).toHaveBeenCalledTimes(1);
  });
  it('preserves stable blocking/unknown legacy codes and redacts raw error messages', () => {
    const f = fixture();
    expect(mapProviderFailure(f.policy, { providerCode: 'insufficient_scope', httpStatus: 403, phase: 'BEFORE_DISPATCH' }).code).toBe('SCOPE_MISSING');
    expect(providerErrorToConnector(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH'), 'execute', true)).toMatchObject({ code: 'NETWORK_ERROR', category: 'OUTCOME_UNKNOWN', retryable: false });
    expect(providerErrorToConnector(new ProviderRuntimeError('RATE_LIMITED', 'AFTER_DISPATCH', 10, true), 'execute', true)).toMatchObject({ code: 'RATE_LIMITED', retryable: false });
    expect(providerErrorToConnector(new Error('token=private-secret'), 'read', true).message).not.toContain('private-secret');
  });
  it('maps authorization errors and requires a connection-scoped revoke', async () => {
    const f = fixture(); await expect(f.bridge.revoke()).rejects.toBeInstanceOf(ConnectorError);
    await f.bridge.revoke(f.request); expect(f.adapter.revoke).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', connectionId: 'owned' }));
    await expect(f.bridge.refreshCredentials({} as never)).rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' });
    await expect(f.bridge.startAuthorization({} as never)).rejects.toMatchObject({ code: 'CONNECTION_REVOKED' });
  });
  it('bounds read retries, charges each attempt and never shortens Retry-After', async () => {
    const f = fixture(); let attempts = 0;
    f.adapter.read = vi.fn(async () => { attempts++; if (attempts === 1) throw new ProviderRuntimeError('NETWORK_ERROR', 'AFTER_DISPATCH'); return { ok: true, data: {} }; });
    await expect(f.bridge.read(f.request)).resolves.toMatchObject({ ok: true });
    expect(attempts).toBe(2); expect(f.host.beforeOperation).toHaveBeenCalledTimes(2);
    f.adapter.read = vi.fn(async () => { throw new ProviderRuntimeError('RATE_LIMITED', 'AFTER_DISPATCH', 1000, true); });
    await expect(f.bridge.read(f.request)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 1000 });
    expect(f.adapter.read).toHaveBeenCalledTimes(1);
  });
  it('bounds read-only health probes without adding write retries', async () => {
    const f = fixture(); f.policy.health.timeoutMs = 5; f.policy.retry.maxReadAttempts = 1;
    f.adapter.health = vi.fn(async () => new Promise<never>(() => {}));
    const bridge = new ProviderConnectorBridge(f.adapter, f.manifest, f.policy, f.host);
    await expect(bridge.validateConnection(f.request)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(f.adapter.execute).not.toHaveBeenCalled();
  });
  it('official evidence is gated before OAuth or credential refresh I/O', async () => {
    const f = fixture(); f.host.assertPolicyActive = vi.fn(async () => { throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH'); });
    await expect(f.bridge.startAuthorization({} as never)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(f.bridge.refreshCredentials({} as never)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(f.adapter.authorize).not.toHaveBeenCalled(); expect(f.adapter.refresh).not.toHaveBeenCalled();
  });
  it('real TCP side effect + lost response dispatches once, then exposes only read-only lookup', async () => {
    const f = fixture(); let effects = 0; let lookups = 0;
    const server = createServer((req, res) => {
      if (req.method === 'POST') { effects++; req.resume(); req.socket.destroy(); }
      else { lookups++; res.setHeader('content-type', 'application/json'); res.end('{"status":"done"}'); }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    f.adapter.execute = vi.fn(async () => { const response = await fetch(url, { method: 'POST' }); return { ok: response.ok, data: await response.json() }; });
    f.adapter.lookupOperation = vi.fn(async () => { const response = await fetch(url); return { ok: response.ok, data: await response.json() }; });
    const bridge = new ProviderConnectorBridge(f.adapter, f.manifest, f.policy, f.host);
    const input = { ...f.request, capability: 'WRITE_FIXTURE', idempotencyKey: 'once' };
    try {
      await expect(bridge.execute(input)).rejects.toMatchObject({ operationState: 'unknown', retryable: false });
      await Promise.all([bridge.lookupOperation!(input), bridge.lookupOperation!(input)]);
      expect(effects).toBe(1); expect(lookups).toBe(2); expect(f.adapter.execute).toHaveBeenCalledTimes(1);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
