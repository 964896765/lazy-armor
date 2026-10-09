import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { candidateCapability, ConnectorRegistry, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import type { GoalUnderstanding } from '@lazy-armor/plan-schema';
import { LocalCapabilitiesService } from '../src/consumer/local-capabilities.service';
import { RuntimeTargetsService } from '../src/runtime-targets/runtime-targets.service';
import { ProviderCapabilityRegistryService } from '../src/provider-capabilities/provider-capability-registry.service';
import { DATABASE, type InjectedDatabase } from '../src/common/database.module';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

/** Isolated source/understanding fixtures; no real user, endpoint or Runtime acceptance claim. */
describe.sequential('version-bound resource review and consumer read publication fences', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session;
  let adapter: ReturnType<ConnectorRegistry['get']>;
  const response = () => ({ ok: true, data: { value: { fixture: true }, retrievedAt: new Date().toISOString(), verification: 'SOURCE_RESPONSE_ONLY' } });
  beforeAll(async () => {
    ({ app, pool } = await bootP2App('goal-resource-read-' + randomUUID()));
    owner = await register(app, randomUUID() + '@example.test', 'Resource review fixture');
    other = await register(app, randomUUID() + '@example.test', 'Other owner');
    adapter = app.get(ConnectorRegistry).get('public_http_json');
    vi.spyOn(adapter, 'read').mockImplementation(async () => response());
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await pool?.end(); });
  async function connection() {
    vi.mocked(adapter.read!).mockImplementation(async () => response());
    const id = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token))
      .send({ connectorId: 'public_http_json', externalAccountName: 'Isolated source', credentials: { endpoint: 'https://example.com/data.json' } }).expect(201)).body.id;
    await permission(id, true); vi.mocked(adapter.read!).mockClear(); return id as string;
  }
  async function permission(id: string, granted: boolean) {
    await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set(auth(owner.token))
      .send({ permissions: [{ capability: 'READ_PUBLIC_HTTP_JSON', granted }] }).expect(200);
  }
  const read = (id: string, token = owner.token) => request(app.getHttpServer()).post(`/api/connections/${id}/invoke`).set(auth(token))
    .send({ capability: 'READ_PUBLIC_HTTP_JSON', requestId: randomUUID(), input: {} });
  async function authorityCounts() {
    const [rows] = await pool.query<any[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths,(SELECT COUNT(*) FROM runtime_targets WHERE user_id=UUID_TO_BIN(?)) targets', Array(5).fill(owner.userId));
    return rows[0];
  }
  async function savedGoal(capabilities: GoalUnderstanding['capabilities']) {
    const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
    const messageId = randomUUID(), proposalId = randomUUID();
    const understanding: GoalUnderstanding = { schemaVersion: 'goal-understanding.v1', stage: 'AI_PROPOSED', proposalId, summary: 'Isolated saved goal', domain: null,
      lifecycle: 'TEMPORARY', executionMode: 'DIRECT', requiredFacts: [], capabilities, steps: ['ACQUIRE'], missingRequirements: [], selectedSkillIds: [], truthRefs: [],
      policy: { confirmationRequired: false, approval: 'RUNTIME_POLICY', executionAuthorized: false }, provenance: { modelId: 'isolated-contract-fixture', generatedAt: new Date().toISOString() } };
    await pool.query('INSERT INTO consumer_messages(id,conversation_id,request_id,role,content,structured_payload,context_refs,model_id,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?, ?,?, ?,?, ?,UTC_TIMESTAMP(6))',
      [messageId, conversation.id, randomUUID(), 'assistant', 'Isolated saved understanding', JSON.stringify({ result: 'ANSWER', proposalId, understanding }), '[]', 'isolated-contract-fixture']);
    return { id: conversation.id as string, messageId, understanding };
  }
  const match = (goal: { id: string; messageId: string }, version = 0, token = owner.token) => request(app.getHttpServer())
    .get(`/api/conversations/${goal.id}/messages/${goal.messageId}/resources?version=${version}`).set(auth(token));
  it('registers a bounded BETA read and publishes only source response without creating execution or Truth', async () => {
    const id = await connection(), before = await authorityCounts();
    const view = (await request(app.getHttpServer()).get(`/api/connections/${id}/capabilities`).set(auth(owner.token)).expect(200)).body;
    expect(view.manifestRevision).toBe(1); expect(view.executionAuthorized).toBe(false);
    expect(view.capabilities).toContainEqual(expect.objectContaining({ key: 'READ_PUBLIC_HTTP_JSON', implementation: 'BETA', usable: true, operation: 'read' }));
    expect((await read(id).expect(201)).body).toMatchObject({ value: { fixture: true }, verification: 'SOURCE_RESPONSE_ONLY' });
    expect(vi.mocked(adapter.read!)).toHaveBeenCalledTimes(1);
    await read(id, other.token).expect(404);
    expect(await authorityCounts()).toEqual(before);
  });
  it('blocks stale health and expired credentials before dispatch, sharing capability list readiness', async () => {
    const id = await connection();
    await pool.query('UPDATE provider_capability_health SET valid_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?)', [id]);
    await read(id).expect(403); expect(adapter.read).not.toHaveBeenCalled();
    await pool.query('UPDATE provider_capability_health SET valid_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE) WHERE connection_id=UUID_TO_BIN(?)', [id]);
    await pool.query('UPDATE credential_refs cr JOIN connections c ON c.credential_ref_id=cr.id SET cr.expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE c.id=UUID_TO_BIN(?)', [id]);
    const view = (await request(app.getHttpServer()).get(`/api/connections/${id}/capabilities`).set(auth(owner.token)).expect(200)).body;
    expect(view.capabilities[0].usable).toBe(false); expect(view.capabilities[0].health).toBe('REAUTHORIZATION_REQUIRED');
    await read(id).expect(403); expect(adapter.read).not.toHaveBeenCalled();
  });
  it.each(['revoke', 'revoke-regrant', 'rotate', 'disconnect'])('rejects in-flight %s without publishing a stale response or poisoning provider health', async change => {
    const id = await connection(), before = await authorityCounts();
    const [health] = await pool.query<any[]>('SELECT status,checked_at,valid_until FROM provider_capability_health WHERE connection_id=UUID_TO_BIN(?)', [id]);
    vi.mocked(adapter.read!).mockImplementationOnce(async () => {
      if (change === 'revoke' || change === 'revoke-regrant') { await permission(id, false); if (change === 'revoke-regrant') await permission(id, true); }
      if (change === 'rotate') await request(app.getHttpServer()).post(`/api/connections/${id}/credentials/rotate`).set(auth(owner.token)).send({ credentials: { endpoint: 'https://example.com/new.json' } }).expect(201);
      if (change === 'disconnect') await request(app.getHttpServer()).delete(`/api/connections/${id}`).set(auth(owner.token)).expect(204);
      return response();
    });
    const result = await read(id).expect(403); expect(result.body.value).toBeUndefined(); expect(result.body.verification).toBeUndefined();
    const [after] = await pool.query<any[]>('SELECT status,checked_at,valid_until FROM provider_capability_health WHERE connection_id=UUID_TO_BIN(?)', [id]);
    // Disconnect legitimately sets permission health; publication fencing itself never re-labels provider success/failure.
    if (change !== 'disconnect') expect(after).toEqual(health);
    expect(await authorityCounts()).toEqual(before);
    expect(adapter.read).toHaveBeenCalledTimes(1);
  });
  it('recomputes resources for the same saved goal without rewriting understanding or making execution objects', async () => {
    const id = await connection(); await permission(id, false);
    const goal = await savedGoal([{ key: 'READ_PUBLIC_HTTP_JSON', availability: 'UNAVAILABLE', reasons: ['CAPABILITY_NOT_GRANTED'] }]);
    const before = await authorityCounts();
    const first = (await match(goal).expect(200)).body;
    expect(first.requirements[0].resources.find((r: any) => r.resourceId === 'connection:' + id).state).toBe('UNAVAILABLE');
    await permission(id, true);
    const current = (await match(goal).expect(200)).body;
    expect(current.executionAuthorized).toBe(false); expect(current.messageId).toBe(goal.messageId); expect(current.conversationVersion).toBe(0);
    expect(current.requirements[0].resources.find((r: any) => r.resourceId === 'connection:' + id)).toMatchObject({ state: 'READY', action: { path: '/interface-detail?id=' + id } });
    const saved = (await request(app.getHttpServer()).get(`/api/conversations/${goal.id}`).set(auth(owner.token)).expect(200)).body;
    expect(saved.messages.at(-1).structuredPayload.understanding).toEqual(goal.understanding);
    expect(await authorityCounts()).toEqual(before); expect(adapter.read).not.toHaveBeenCalled();
    expect(JSON.stringify(current)).not.toMatch(/credential_ref|example.com|accessToken|endpoint/);
  });
  it('requires the current owned conversation/message/version and fences a goal changed during computation', async () => {
    const goal = await savedGoal([]);
    await match(goal, 0, other.token).expect(404); await match(goal, 1).expect(409);
    await match({ ...goal, messageId: randomUUID() }).expect(409);
    await request(app.getHttpServer()).get(`/api/conversations/${goal.id}/messages/${goal.messageId}/resources`).set(auth(owner.token)).expect(400);
    const native = vi.spyOn(app.get(LocalCapabilitiesService), 'project').mockImplementationOnce(async () => {
      await pool.query('UPDATE consumer_conversations SET version=version+1 WHERE id=UUID_TO_BIN(?)', [goal.id]); return [];
    });
    try { await match(goal).expect(409); } finally { native.mockRestore(); }
    await pool.query('UPDATE consumer_conversations SET status=? WHERE id=UUID_TO_BIN(?)', ['PROCESSING', goal.id]);
    await match(goal, 1).expect(409);
  });
  it('requires per-App notification authorization and never refreshes Runtime targets in a read-only review', async () => {
    const goal = await savedGoal([{ key: 'app.notification.read', availability: 'UNRESOLVED', reasons: [], sourcePackage: 'com.jingdong.app.mall' }]);
    const refresh = vi.spyOn(app.get(RuntimeTargetsService), 'refresh');
    const before = await authorityCounts();
    try {
      const view = (await match(goal).expect(200)).body;
      expect(view.requirements[0].resources[0]).toMatchObject({ state: 'UNAVAILABLE', reasons: ['APP_SOURCE_REQUIRED'] });
      expect(refresh).not.toHaveBeenCalled(); expect(await authorityCounts()).toEqual(before);
    } finally { refresh.mockRestore(); }
  });
  it('concurrent role registration retains one immutable manifest and one evidence set', async () => {
    const providerKey = 'isolated-' + randomUUID();
    const manifest: ProviderCapabilityManifest = { schemaVersion: '1', providerKey, providerName: 'Isolated startup fixture', revision: 1,
      accountTypes: ['INTERNAL'], sourceModes: ['MANUAL'], actionModes: ['OBSERVE'], providerReview: 'NOT_REQUIRED', rateLimitPolicy: 'fixture-only', evidence: [], explicitDenials: [],
      capabilities: [candidateCapability({ key: 'FIXTURE_READ', name: 'Isolated read', resource: 'Fixture', sourceModes: ['MANUAL'] })] };
    const registries = Array.from({ length: 3 }, () => new ProviderCapabilityRegistryService(app.get<InjectedDatabase>(DATABASE)));
    for (const registry of registries) registry.installRevision(manifest);
    await Promise.all(registries.map(registry => registry.sync()));
    const [rows] = await pool.query<any[]>('SELECT BIN_TO_UUID(id) id,manifest_hash,status FROM provider_capability_manifests WHERE provider_key=?', [providerKey]);
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('ACTIVE');
    const [evidence] = await pool.query<any[]>('SELECT COUNT(*) n FROM provider_capability_evidence WHERE manifest_id=UUID_TO_BIN(?)', [rows[0].id]);
    expect(evidence[0].n).toBe(manifest.capabilities[0].evidence.length);
    const different = new ProviderCapabilityRegistryService(app.get<InjectedDatabase>(DATABASE));
    different.installRevision({ ...manifest, providerName: 'Conflicting immutable revision' });
    await expect(different.sync()).rejects.toThrow('revision is immutable');
    const [retained] = await pool.query<any[]>('SELECT manifest_hash FROM provider_capability_manifests WHERE provider_key=?', [providerKey]);
    expect(retained[0].manifest_hash).toBe(rows[0].manifest_hash);
  });
});
