import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { candidateCapability, type CapabilityRequirement, type VersionedProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { ResolutionEvidenceService } from '../src/capability-resolver/resolution-evidence.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('Batch 6 capability resolver', () => {
  let app: INestApplication; let pool: Pool; let owner: Session; let stranger: Session; let planVersionId: string; let connectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const requirement: CapabilityRequirement = { schemaVersion: '1', capabilityKey: 'MANUAL_INPUT', resource: 'manual_record', operation: 'read',
    fields: ['value'], purpose: 'scenario_runtime', minimumReality: 'VERIFIED', maxAgeSeconds: 60, maxRisk: 'R1', maxCostMicros: 0,
    preferredProviders: [], preferredSourceModes: [] };
  const body = (key: string) => ({ planVersionId, requestKey: `${unique}-${key}`, requirement });
  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`resolution-${unique}`));
    owner = await register(app, `resolver-${unique}@example.com`, 'Resolver');
    stranger = await register(app, `resolver-other-${unique}@example.com`, 'Other');
    const compiled = await request(app.getHttpServer()).post('/api/scenarios/device.status/compile').set(auth(owner.token)).send({}).expect(201);
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(compiled.body.definitionInput).expect(201);
    planVersionId = plan.body.currentVersion.id;
    connectionId = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token))
      .send({ connectorId: 'manual', externalAccountName: 'Resolution fixture' }).expect(201)).body.id;
    await request(app.getHttpServer()).put(`/api/connections/${connectionId}/permissions`).set(auth(owner.token))
      .send({ permissions: [{ capability: 'MANUAL_INPUT', granted: true }] }).expect(200);
    await request(app.getHttpServer()).post(`/api/connections/${connectionId}/validate`).set(auth(owner.token)).expect(201);
  });
  afterAll(async () => { vi.restoreAllMocks(); await pool?.end(); await app?.close(); });

  it('migrates the decision table and rejects missing nested requirements or unauthenticated calls', async () => {
    const [tables] = await pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='capability_resolution_decisions'");
    expect(tables).toHaveLength(1);
    await request(app.getHttpServer()).post('/api/capability-resolutions').send(body('no-auth')).expect(401);
    await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send({ planVersionId, requestKey: 'missing' }).expect(400);
    await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send({ ...body('injection'), candidates: [] }).expect(400);
  });

  it('persists blocked real registry decisions without claiming official support', async () => {
    const r = await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send(body('real')).expect(201);
    expect(r.body.decisionJson).toMatchObject({ status: 'BLOCKED', selectedCandidateId: null, executionAuthorized: false });
  });

  it('resolves a verified isolated fixture using server-side evidence and persists one audited decision under concurrency', async () => {
    const c = candidateCapability({ key: 'MANUAL_INPUT', name: 'Isolated fixture', resource: 'manual_record', sourceModes: ['MANUAL'] });
    const manifest = { schemaVersion: '1', providerKey: 'manual', providerName: 'Test fixture only', revision: 1, manifestHash: 'f'.repeat(64),
      accountTypes: [], sourceModes: ['MANUAL'], actionModes: ['OBSERVE'], providerReview: 'VERIFIED', rateLimitPolicy: 'test', evidence: [], explicitDenials: [],
      capabilities: [{ ...c, officialAvailability: 'AVAILABLE', implementationStatus: 'PRODUCTION', reviewStatus: 'VERIFIED', accountTypes: [],
        dataBoundary: { resources: ['manual_record'], readableFields: ['value'], writableFields: [], purpose: ['scenario_runtime'] } }] } as VersionedProviderCapabilityManifest;
    vi.spyOn(app.get(ProviderCapabilityRegistryService), 'list').mockReturnValue([manifest]);
    app.get(ResolutionEvidenceService).register('manual', async () => ({ accountSatisfied: true, deviceSatisfied: true,
      reality: 'VERIFIED', observedAt: new Date().toISOString(), costMicros: 0, latencyMs: 1, reliability: 1 }));
    await pool.query('UPDATE provider_capability_health SET valid_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 10 MINUTE) WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    const responses = await Promise.all([0, 1, 2].map(() => request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send(body('concurrent')).expect(201)));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(responses[0].body.decisionJson, JSON.stringify(responses[0].body.decisionJson)).toMatchObject({ status: 'RESOLVED', selectedCandidateId: `${connectionId}:MANUAL_INPUT`, executionAuthorized: false });
    const id = responses[0].body.id;
    const [audits] = await pool.query<RowDataPacket[]>("SELECT id FROM audit_logs WHERE resource_id=? AND action='CAPABILITY_RESOLUTION_DECIDED'", [id]);
    expect(audits).toHaveLength(1);
    await request(app.getHttpServer()).get(`/api/capability-resolutions/${id}`).set(auth(stranger.token)).expect(404);
    await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(stranger.token)).send(body('other')).expect(404);
    await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send({ ...body('concurrent'), requirement: { ...requirement, maxRisk: 'R0' } }).expect(409);
  });

  it('honors current grant expiry despite positive manifest and health evidence', async () => {
    await pool.query('UPDATE connection_capability_grants SET expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE) WHERE connection_id=UUID_TO_BIN(?)', [connectionId]);
    const r = await request(app.getHttpServer()).post('/api/capability-resolutions').set(auth(owner.token)).send(body('expired')).expect(201);
    expect(r.body.decisionJson.status).toBe('BLOCKED');
    expect(r.body.decisionJson.candidates[0].reasons).toContain('GRANT_NOT_SATISFIED');
  });
});
