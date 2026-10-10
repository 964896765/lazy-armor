import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import type { MethodResourceMatch, SkillCapability, SkillMethodRef, SkillRepositoryProjection } from '@lazy-armor/plan-schema';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { LocalCapabilitiesService } from '../src/consumer/local-capabilities.service';
import { RuntimeTargetsService } from '../src/runtime-targets/runtime-targets.service';
import { BrowserDriver } from '../src/providers/browser/browser-driver';
import { BrowserAdapter } from '../src/providers/browser/browser.adapter';
import { browserEvidence, browserManifest, browserPolicy } from '../src/providers/browser/browser-manifest';
import { ProviderRuntimeService } from '../src/provider-runtime/provider-runtime.service';
import { ConnectorCatalogSyncService } from '../src/connectors/connector-catalog-sync.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const manifest: SkillCapability = { name: 'ResourceReviewMethod', version: '1.0.0', description: '隔离能力核对方法', domain: 'unmatched',
  input: {}, output: {}, requiredCapabilities: [], permission: ['WRITE'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: 'Untrusted method declaration; no execution authority.' };
describe.sequential('Selected methods reuse current owner-scoped resource readiness, NOT real resource acceptance', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, methods: SkillRepositoriesService, registry: ConnectorRegistry;
  let publicSource: ReturnType<ConnectorRegistry['get']>, browser: BrowserDriver;
  const previousBrowserEnabled = process.env.BROWSER_RUNTIME_ENABLED;
  beforeAll(async () => {
    process.env.BROWSER_RUNTIME_ENABLED = '0';
    ({ app, pool } = await bootP2App('method-resources-' + randomUUID()));
    owner = await register(app, randomUUID() + '@example.test', 'Review owner'); other = await register(app, randomUUID() + '@example.test', 'Other review owner');
    methods = app.get(SkillRepositoriesService); registry = app.get(ConnectorRegistry); publicSource = registry.get('public_http_json');
    vi.spyOn(publicSource, 'read').mockResolvedValue({ ok: true, data: { value: {}, retrievedAt: new Date().toISOString(), verification: 'SOURCE_RESPONSE_ONLY' } });
    // Health transport fixture only. Resource review must never invoke Browser read/form.
    browser = new BrowserDriver({ executablePath: 'unused-in-this-read-only-contract', allowedOrigins: ['https://example.com'] });
    vi.spyOn(browser, 'health').mockResolvedValue(new Date().toISOString()); vi.spyOn(browser, 'read'); vi.spyOn(browser, 'form');
    const runtime = app.get(ProviderRuntimeService);
    await runtime.publish({ manifest: browserManifest, evidence: browserEvidence, policy: browserPolicy });
    registry.register(runtime.bridge(new BrowserAdapter(browser, input => runtime.beforeOperation(browserPolicy, input, 'execute')), browserManifest, browserPolicy));
    await app.get(ConnectorCatalogSyncService).sync();
  });
  afterAll(async () => {
    vi.restoreAllMocks(); await app?.close(); await pool?.end();
    if (previousBrowserEnabled === undefined) delete process.env.BROWSER_RUNTIME_ENABLED; else process.env.BROWSER_RUNTIME_ENABLED = previousBrowserEnabled;
  });
  const ref = (repo: SkillRepositoryProjection): SkillMethodRef => ({ repositoryId: repo.id, repositoryVersion: repo.version, entryId: repo.entries[0].id,
    revisionId: repo.entries[0].revisionId, contentHash: repo.entries[0].contentHash });
  async function selected(keys: string[], mode = 'TEMPORARY') {
    let repo = await methods.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '资源核对方法库', sourceType: 'USER', entries: [{ ...manifest, requiredCapabilities: keys }] });
    repo = await methods.change(owner.userId, repo.id, repo.version, true);
    const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode, methodRefs: [ref(repo)] }).expect(201)).body;
    return { id: conversation.id as string, repo, conversation };
  }
  const match = (id: string, version = 0, token = owner.token) => request(app.getHttpServer()).get(`/api/conversations/${id}/method-resources?version=${version}`).set(auth(token));
  const candidate = (view: MethodResourceMatch, key: string, id: string) => view.methods[0].requirements.find(row => row.key === key)!.resources.find(row => row.resourceId === id)!;
  async function connection(token = owner.token, connectorId = 'public_http_json') {
    const id = (await request(app.getHttpServer()).post('/api/connections').set(auth(token))
      .send({ connectorId, externalAccountName: token === owner.token ? '我的核对来源' : 'OTHER_OWNER_RESOURCE', credentials: { endpoint: 'https://example.com/isolated-review.json' } }).expect(201)).body.id as string;
    vi.mocked(publicSource.read!).mockClear(); vi.mocked(browser.health).mockClear(); return id;
  }
  const permission = (id: string, granted: boolean, capability = 'READ_PUBLIC_HTTP_JSON', token = owner.token) => request(app.getHttpServer())
    .put(`/api/connections/${id}/permissions`).set(auth(token)).send({ permissions: [{ capability, granted }] }).expect(200);
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations,(SELECT COUNT(*) FROM runtime_targets WHERE user_id=UUID_TO_BIN(?)) targets,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths,(SELECT COUNT(*) FROM audit_logs WHERE user_id=UUID_TO_BIN(?)) audits', Array(6).fill(owner.userId));
    return rows[0];
  }
  it('requires the owned current conversation and server-selected declarations', async () => {
    const goal = await selected([]);
    await request(app.getHttpServer()).get(`/api/conversations/${goal.id}/method-resources?version=0`).expect(401);
    await match(goal.id, 0, other.token).expect(404); await match(goal.id, 1).expect(409);
    await request(app.getHttpServer()).get(`/api/conversations/${goal.id}/method-resources`).set(auth(owner.token)).expect(400);
    await request(app.getHttpServer()).get(`/api/conversations/${goal.id}/method-resources?version=0&capabilityKey=BROWSER_SUBMIT_FORM`).set(auth(owner.token)).expect(400);
    const plain = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
    await match(plain.id).expect(400);
    expect((await match(goal.id).expect(200)).body).toMatchObject({ executionAuthorized: false, methods: [{ requirements: [] }] });
    await request(app.getHttpServer()).post(`/api/conversations/${goal.id}/history`).set(auth(owner.token)).send({ version: 0, action: 'ARCHIVE' }).expect(201);
    await match(goal.id, 1).expect(409);
  });
  it('reads real stored permission/health state without source I/O or new Runtime/Truth/audit records', async () => {
    const id = await connection(), foreign = await connection(other.token);
    await permission(id, true); await permission(foreign, true, 'READ_PUBLIC_HTTP_JSON', other.token);
    const goal = await selected(['READ_PUBLIC_HTTP_JSON']), before = await counts(), refresh = vi.spyOn(app.get(RuntimeTargetsService), 'refresh');
    try {
      const view = (await match(goal.id).expect(200)).body as MethodResourceMatch;
      expect(view).toMatchObject({ schemaVersion: 'method-resource-match.v1', conversationId: goal.id, conversationVersion: 0, workContext: 'TEMPORARY', executionAuthorized: false });
      expect(candidate(view, 'READ_PUBLIC_HTTP_JSON', 'connection:' + id)).toMatchObject({ state: 'READY', name: '我的核对来源', operation: 'read', action: { path: '/interface-detail?id=' + id } });
      expect(JSON.stringify(view)).not.toMatch(new RegExp(foreign + '|OTHER_OWNER_RESOURCE|example.com|credential|endpoint|accessToken'));
      expect(publicSource.read).not.toHaveBeenCalled(); expect(browser.read).not.toHaveBeenCalled(); expect(browser.form).not.toHaveBeenCalled(); expect(browser.health).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled(); expect(await counts()).toEqual(before);
      const unchanged = (await request(app.getHttpServer()).get('/api/conversations/' + goal.id).set(auth(owner.token)).expect(200)).body;
      expect(unchanged.contextRefs).toEqual(goal.conversation.contextRefs); expect(unchanged.version).toBe(0); expect(unchanged.messages).toEqual([]);
    } finally { refresh.mockRestore(); }
  });
  it('recomputes the same method needs after normal revoke/regrant without replacing the selection', async () => {
    const id = await connection(), goal = await selected(['READ_PUBLIC_HTTP_JSON']);
    await permission(id, false);
    const missing = (await match(goal.id).expect(200)).body as MethodResourceMatch;
    expect(candidate(missing, 'READ_PUBLIC_HTTP_JSON', 'connection:' + id)).toMatchObject({ state: 'UNAVAILABLE', reasons: expect.arrayContaining(['CAPABILITY_GRANT_REVOKED']) });
    await permission(id, true);
    const restored = (await match(goal.id).expect(200)).body as MethodResourceMatch;
    expect(candidate(restored, 'READ_PUBLIC_HTTP_JSON', 'connection:' + id).state).toBe('READY'); expect(restored.methods[0].ref).toEqual(missing.methods[0].ref);
    expect(publicSource.read).not.toHaveBeenCalled();
  });
  it.each(['HEALTH', 'CREDENTIAL'])('refuses stale %s despite an existing connection and grant', async state => {
    const id = await connection(); await permission(id, true); const goal = await selected(['READ_PUBLIC_HTTP_JSON']);
    if (state === 'HEALTH') await pool.query('UPDATE provider_capability_health SET valid_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE connection_id=UUID_TO_BIN(?)', [id]);
    else await pool.query('UPDATE credential_refs cr JOIN connections c ON c.credential_ref_id=cr.id SET cr.expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE c.id=UUID_TO_BIN(?)', [id]);
    expect(candidate((await match(goal.id).expect(200)).body, 'READ_PUBLIC_HTTP_JSON', 'connection:' + id).state).toBe('UNAVAILABLE');
    expect(publicSource.read).not.toHaveBeenCalled();
  });
  it('keeps actual R3 operation metadata and refuses an unloaded adapter even if durable catalog state is usable', async () => {
    const id = await connection(owner.token, 'controlled_browser'); await permission(id, true, 'BROWSER_SUBMIT_FORM');
    const goal = await selected(['BROWSER_SUBMIT_FORM']);
    const view = (await match(goal.id).expect(200)).body as MethodResourceMatch;
    expect(view.methods[0].declaredRisk).toBe('R0');
    expect(candidate(view, 'BROWSER_SUBMIT_FORM', 'connection:' + id)).toMatchObject({ state: 'READY', operation: 'execute', riskLevel: 'R3' });
    const original = registry.list.bind(registry), hidden = vi.spyOn(registry, 'list').mockImplementation(() => original().filter(adapter => adapter.metadata().key !== 'controlled_browser'));
    try { expect(candidate((await match(goal.id).expect(200)).body, 'BROWSER_SUBMIT_FORM', 'connection:' + id))
      .toMatchObject({ state: 'UNAVAILABLE', riskLevel: 'R3', reasons: expect.arrayContaining(['PROVIDER_RUNTIME_UNAVAILABLE']) }); }
    finally { hidden.mockRestore(); }
    expect(browser.read).not.toHaveBeenCalled(); expect(browser.form).not.toHaveBeenCalled(); expect(browser.health).not.toHaveBeenCalled();
  });
  async function native(capabilities = ['network.status']) {
    const id = randomUUID();
    await pool.query("INSERT INTO trusted_devices(id,user_id,device_id,key_id,public_key_spki,public_key_fingerprint,trust_level,status,last_proved_at,created_at,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?,?,'key_proven','active',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [id, owner.userId, id, randomUUID(), 'isolated-permission-evidence', randomUUID().replaceAll('-', '').repeat(2)]);
    await pool.query("INSERT INTO device_heartbeats(id,user_id,trusted_device_id,device_id,online_state,last_heartbeat_at,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'online',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [randomUUID(), owner.userId, id, id]);
    for (const capability of capabilities) await pool.query("INSERT INTO local_capability_states(id,user_id,trusted_device_id,capability,manifest_version,user_grant,system_permission,health,checked_at,evidence_ref,updated_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'android-local-v5',1,'GRANTED','HEALTHY',UTC_TIMESTAMP(6),'isolated-native-evidence',UTC_TIMESTAMP(6))", [randomUUID(), owner.userId, id, capability]);
    return id;
  }
  it('requires fresh device heartbeat and native evidence together', async () => {
    const id = await native(), goal = await selected(['network.status']), sourceId = `local:${id}:network.status`;
    expect(candidate((await match(goal.id).expect(200)).body, 'network.status', sourceId).state).toBe('READY');
    await pool.query('UPDATE device_heartbeats SET last_heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE trusted_device_id=UUID_TO_BIN(?)', [id]);
    expect(candidate((await match(goal.id).expect(200)).body, 'network.status', sourceId)).toMatchObject({ state: 'UNAVAILABLE', reasons: ['WAITING_DEVICE'] });
    await pool.query('UPDATE device_heartbeats SET last_heartbeat_at=UTC_TIMESTAMP(6) WHERE trusted_device_id=UUID_TO_BIN(?)', [id]);
    await pool.query('UPDATE local_capability_states SET checked_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 10 MINUTE) WHERE trusted_device_id=UUID_TO_BIN(?)', [id]);
    expect(candidate((await match(goal.id).expect(200)).body, 'network.status', sourceId).state).toBe('UNAVAILABLE');
  });
  it('deduplicates explicit aliases and requires App/page scope despite general OS grants', async () => {
    await native(['notification.read', 'accessibility.read']);
    const goal = await selected(['notification.read', 'app.notification.read', 'structured_read.field', 'isolated.missing.capability']);
    const view = (await match(goal.id).expect(200)).body as MethodResourceMatch;
    expect(view.methods[0].requirements.map(row => row.key)).toEqual(['app.notification.read', 'structured_read.field', 'isolated.missing.capability']);
    expect(view.methods[0].requirements[0].resources).toEqual([expect.objectContaining({ state: 'NEEDS_SELECTION', reasons: ['APP_SOURCE_REQUIRED'] })]);
    expect(view.methods[0].requirements[1].resources).toEqual([expect.objectContaining({ state: 'NEEDS_SELECTION', reasons: ['PAGE_SOURCE_SCOPE_REQUIRED'], action: { label: '核对应用与字段范围', path: '/resources?returnConversationId=' + goal.id + '&returnMode=temporary' } })]);
    expect(view.methods[0].requirements[2]).toMatchObject({ resources: [], reasons: ['NO_CAPABILITY_PROVIDER'] });
  });
  it('preserves three selected method groups and their original Plan conversation context', async () => {
    const choices = [await selected(['READ_PUBLIC_HTTP_JSON']), await selected(['network.status']), await selected(['notification.read'])].reverse();
    const refs = choices.map(choice => ref(choice.repo));
    const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN', methodRefs: refs }).expect(201)).body;
    const view = (await match(conversation.id).expect(200)).body as MethodResourceMatch;
    expect(view.workContext).toBe('PLAN'); expect(view.methods.map(method => method.ref)).toEqual(refs);
    expect(view.methods.map(method => method.requirements[0].key)).toEqual(['app.notification.read', 'network.status', 'READ_PUBLIC_HTTP_JSON']);
    expect(view.executionAuthorized).toBe(false);
  });
  it.each(['UPGRADE', 'DISABLE', 'ARCHIVE'])('rejects stale method choice after %s without returning substituted requirements', async change => {
    const goal = await selected(['isolated.original']);
    if (change === 'UPGRADE') await methods.revise(owner.userId, goal.repo.id, goal.repo.entries[0].id, goal.repo.version, { ...manifest, version: '1.1.0', requiredCapabilities: ['BROWSER_SUBMIT_FORM'] });
    else await methods.change(owner.userId, goal.repo.id, goal.repo.version, false, change === 'ARCHIVE');
    const result = await match(goal.id).expect(409); expect(result.body.methods).toBeUndefined();
  });
  it.each(['METHOD', 'CONVERSATION'])('fences %s changes during resource computation', async change => {
    const goal = await selected(['READ_PUBLIC_HTTP_JSON']), local = app.get(LocalCapabilitiesService), original = local.project.bind(local);
    const hook = vi.spyOn(local, 'project').mockImplementationOnce(async (...args) => {
      if (change === 'METHOD') await methods.change(owner.userId, goal.repo.id, goal.repo.version, false);
      else await request(app.getHttpServer()).post(`/api/conversations/${goal.id}/history`).set(auth(owner.token)).send({ version: 0, action: 'RENAME', title: '更新后的目标' }).expect(201);
      return original(...args);
    });
    try { const response = await match(goal.id).expect(409); expect(response.body.methods).toBeUndefined(); }
    finally { hook.mockRestore(); }
  });
});
