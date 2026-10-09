import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { candidateCapability, type CapabilityRequirement, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { ResolutionEvidenceService } from '../src/capability-resolver/resolution-evidence.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('resource capability projection agrees with Runtime availability gates', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, connectionId: string, planVersionId: string;
  const requirement: CapabilityRequirement = { schemaVersion: '1', capabilityKey: 'MANUAL_INPUT', resource: 'manual_record', operation: 'read',
    fields: ['value'], purpose: 'scenario_runtime', minimumReality: 'VERIFIED', maxAgeSeconds: 60, maxRisk: 'R1', maxCostMicros: 0, preferredProviders: [], preferredSourceModes: [] };
  let revision = 100;
  function manifest(denied = false): ProviderCapabilityManifest {
    return { schemaVersion: '1', providerKey: 'manual', providerName: 'Isolated capability fixture', revision: revision++, accountTypes: ['INTERNAL'],
      sourceModes: ['MANUAL'], actionModes: ['OBSERVE'], providerReview: 'NOT_REQUIRED', rateLimitPolicy: 'test-only', evidence: [], explicitDenials: denied ? ['MANUAL_INPUT'] : [],
      capabilities: [{ ...candidateCapability({ key: 'MANUAL_INPUT', name: '隔离读取样例', resource: 'manual_record', sourceModes: ['MANUAL'] }),
        officialAvailability: 'AVAILABLE', implementationStatus: 'PRODUCTION', reviewStatus: 'NOT_REQUIRED', oauthScopes: ['records.read'], accountTypes: [],
        dataBoundary: { resources: ['manual_record'], readableFields: ['value'], writableFields: [], purpose: ['scenario_runtime'] } }] };
  }
  beforeAll(async () => {
    ({ app, pool } = await bootP2App('resource-capability-' + randomUUID()));
    owner = await register(app, randomUUID() + '@example.test', 'Resource owner'); other = await register(app, randomUUID() + '@example.test', 'Other owner');
    const compiled = (await request(app.getHttpServer()).post('/api/scenarios/device.status/compile').set(auth(owner.token)).send({}).expect(201)).body;
    const plan = (await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(compiled.definitionInput).expect(201)).body;
    planVersionId = plan.currentVersion.id;
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ connectorId: 'manual', externalAccountName: 'Isolated non-network fixture' }).expect(201)).body.id;
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: 'MANUAL_INPUT', granted: true }] }).expect(200);
    app.get(ProviderCapabilityRegistryService).installRevision(manifest());
    app.get(ResolutionEvidenceService).register('manual', async () => ({ accountSatisfied: true, deviceSatisfied: true, reality: 'VERIFIED', observedAt: new Date().toISOString(), costMicros: 0, latencyMs: 1, reliability: 1 }));
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function reset() {
    await pool.query('UPDATE connections SET status=?,expires_at=NULL WHERE id=UUID_TO_BIN(?)', ['connected', connectionId]);
    await pool.query('UPDATE connection_capability_grants SET provider_key=?,status=?,revoked_at=NULL,expires_at=NULL,granted_scopes_json=? WHERE connection_id=UUID_TO_BIN(?)', ['manual', 'GRANTED', JSON.stringify(['records.read']), connectionId]);
    await pool.query('UPDATE provider_capability_health SET provider_key=?,status=?,checked_at=UTC_TIMESTAMP(6),valid_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE) WHERE connection_id=UUID_TO_BIN(?)', ['manual', 'HEALTHY', connectionId]);
  }
  async function viewAndResolve(usable: boolean, reason?: string) {
    const view = (await request(app.getHttpServer()).get(`/api/connections/${connectionId}/capabilities`).set(auth(owner.token)).expect(200)).body;
    const capability = view.capabilities.find((c: { key: string }) => c.key === 'MANUAL_INPUT');
    expect(view.executionAuthorized).toBe(false); expect(capability.usable).toBe(usable);
    if (reason) expect(capability.reasons).toContain(reason);
    const resolution = (await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send({ planVersionId, requestKey: randomUUID(), requirement }).expect(201)).body;
    expect(resolution.decisionJson.status).toBe(usable ? 'RESOLVED' : 'BLOCKED');
    expect(resolution.decisionJson.executionAuthorized).toBe(false);
    return capability;
  }
  it('owned, fresh evidence is usable while credentials and execution authority remain absent', async () => {
    await reset(); const capability = await viewAndResolve(true);
    expect(capability.evidence.fresh).toBe(true);
    await request(app.getHttpServer()).get(`/api/connections/${connectionId}/capabilities`).expect(401);
    await request(app.getHttpServer()).get(`/api/connections/${connectionId}/capabilities`).set(auth(other.token)).expect(404);
    expect(JSON.stringify(capability)).not.toMatch(/accessToken|refreshToken|apiKey|clientSecret/);
  });
  it('connected does not mask expired or missing health evidence, including future-dated probes', async () => {
    for (const expression of ['DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND)', 'NULL']) {
      await reset(); await pool.query(`UPDATE provider_capability_health SET valid_until=${expression} WHERE connection_id=UUID_TO_BIN(?)`, [connectionId]);
      const c = await viewAndResolve(false, 'CAPABILITY_HEALTH_EVIDENCE_STALE'); expect(c.health).toBe('UNKNOWN');
    }
    await reset(); await pool.query('UPDATE provider_capability_health SET checked_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    await viewAndResolve(false, 'CAPABILITY_HEALTH_EVIDENCE_STALE');
  });
  it('expired, revoked and partial grants block the same owned capability in both surfaces', async () => {
    await reset(); await pool.query('UPDATE connection_capability_grants SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    expect((await viewAndResolve(false, 'CAPABILITY_GRANT_EXPIRED')).grant).toBe('EXPIRED');
    await reset(); await pool.query('UPDATE connection_capability_grants SET revoked_at=UTC_TIMESTAMP(6) WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    expect((await viewAndResolve(false, 'CAPABILITY_GRANT_REVOKED')).grant).toBe('REVOKED');
    await reset(); await pool.query('UPDATE connection_capability_grants SET granted_scopes_json=? WHERE connection_id=UUID_TO_BIN(?)', [JSON.stringify([]), connectionId]);
    expect((await viewAndResolve(false, 'CAPABILITY_SCOPE_PARTIAL')).grant).toBe('PARTIAL');
  });
  it('mismatched provider evidence cannot lend another provider its grant or health', async () => {
    await reset(); await pool.query('UPDATE connection_capability_grants SET provider_key=? WHERE connection_id=UUID_TO_BIN(?)', ['other_provider', connectionId]);
    expect((await viewAndResolve(false, 'CAPABILITY_GRANT_UNKNOWN')).grant).toBe('UNKNOWN');
    await reset(); await pool.query('UPDATE provider_capability_health SET provider_key=? WHERE connection_id=UUID_TO_BIN(?)', ['other_provider', connectionId]);
    expect((await viewAndResolve(false, 'CAPABILITY_HEALTH_UNKNOWN')).health).toBe('UNKNOWN');
  });
  it('expired/disconnected connection and old rate-limit failure never become available', async () => {
    await reset(); await pool.query('UPDATE connections SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [connectionId]);
    expect((await viewAndResolve(false, 'CONNECTION_NOT_READY')).health).toBe('REAUTHORIZATION_REQUIRED');
    await reset(); await pool.query('UPDATE connections SET status=? WHERE id=UUID_TO_BIN(?)', ['revoked', connectionId]);
    expect((await viewAndResolve(false, 'CONNECTION_NOT_READY')).health).toBe('PERMISSION_REVOKED');
    await reset(); await pool.query('UPDATE provider_capability_health SET status=?,valid_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?)', ['RATE_LIMITED', connectionId]);
    expect((await viewAndResolve(false, 'CAPABILITY_HEALTH_RATE_LIMITED')).health).toBe('RATE_LIMITED');
    await reset(); await viewAndResolve(true);
  });
  it('provider-level denial wins over all otherwise positive evidence', async () => {
    await reset(); app.get(ProviderCapabilityRegistryService).installRevision(manifest(true));
    await viewAndResolve(false, 'CAPABILITY_EXPLICITLY_DENIED');
  });
});
