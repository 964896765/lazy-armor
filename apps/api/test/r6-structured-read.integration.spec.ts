import { createHash, generateKeyPairSync, sign, randomUUID, createPublicKey, verify } from 'node:crypto';
import { NativeCalendarRuntimeService } from '../src/execution/native-calendar-runtime.service';
import { LocalCapabilitiesService } from '../src/consumer/local-capabilities.service';
import { LOCAL_CAPABILITY_CATALOG } from '@lazy-armor/plan-schema';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { deviceAppConnections, localCapabilityStates } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FEISHU_CALLBACK_PATH } from '@lazy-armor/config';
import { AppReadSessionsService } from '../src/app-read-sessions/app-read-sessions.service';
import { DATABASE, type InjectedDatabase } from '../src/common/database.module';
import { DeviceTasksService } from '../src/device-tasks/device-tasks.service';
import { FeishuService } from '../src/providers/feishu/feishu.service';
import { FEISHU_TRANSPORT, type FeishuTransport } from '../src/providers/feishu/feishu-http.client';
import { PDF_TEXT_LAYER, type PdfTextLayer } from '../src/structured-read/file-structured-reader';
import { StructuredReadService, StructuredReadSourceInvalidError } from '../src/structured-read/structured-read.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const enabled = process.env.RUN_REAL_DB_INTEGRATION === '1';

class FixturePdfTextLayer implements PdfTextLayer {
  async extractText(content: Buffer): Promise<string | null> {
    return content.toString('utf8').startsWith('%PDF') ? 'balance: 55.00\ndueDate: 2026-09-18' : null;
  }
}

async function findTruthValue(pool: Pool, userId: string, field: string, resourceId?: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(v.value_json, '$.value.value')) value
     FROM truth_record_versions v
     INNER JOIN truth_records r ON r.current_version_id = v.id
     WHERE r.user_id = UUID_TO_BIN(?) AND JSON_UNQUOTE(JSON_EXTRACT(v.value_json, '$.value.field')) = ?
       ${resourceId ? `AND r.subject_key LIKE CONCAT('%:', ?)` : ''}`,
    resourceId ? [userId, field, `${resourceId}:${field}`] : [userId, field],
  );
  return rows.length ? Number(rows[0].value) : null;
}

describe.skipIf(!enabled).sequential('R6 Controlled Structured Read golden reads', { timeout: 180_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let server: Server;
  let endpoint: string;
  let owner: Session;
  let db: InjectedDatabase;
  let connection: string;
  let trustedDeviceId: string;
  let deviceId: string;
  let appConnectionId: string;
  let structuredRead: StructuredReadService;
  let deviceTasks: DeviceTasksService;
  let sessions: AppReadSessionsService;

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const config = { appId: 'cli_r6readtest', appSecret: 'r6-secret', redirectUri: `https://api.example.test${FEISHU_CALLBACK_PATH}` };
  const saved = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_OAUTH_REDIRECT_URI'].map((k) => [k, process.env[k]] as const);
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  beforeAll(async () => {
    deviceId = `edge-${unique}`;
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const path = decodeURIComponent(new URL(req.url!, 'http://isolated.test').pathname);
      res.setHeader('content-type', 'application/json');
      if (path === '/open-apis/auth/v3/app_access_token/internal') { res.end(JSON.stringify({ code: 0, app_access_token: 'r6-app-token', expire: 7200 })); return; }
      if (path === '/open-apis/authen/v2/oauth/token') { res.end(JSON.stringify({ code: 0, access_token: 'r6-access', refresh_token: 'r6-refresh', expires_in: 7200, refresh_token_expires_in: 604800, token_type: 'Bearer', scope: 'docx:document sheets:sheet bitable:app', open_id: 'ou_owner', tenant_key: 'tk_owner' })); return; }
      if (path === '/open-apis/authen/v1/user_info') { res.end(JSON.stringify({ code: 0, data: { open_id: 'ou_owner', tenant_key: 'tk_owner' } })); return; }
      if (path === '/open-apis/docx/v1/documents/doc_1') { res.end(JSON.stringify({ code: 0, data: { document: { document_id: 'doc_1', title: '钱包余额', revision: '1790208000' } } })); return; }
      if (path === '/open-apis/docx/v1/documents/doc_1/blocks/doc_1/children') {
        res.end(JSON.stringify({ code: 0, data: { items: [
          { block_id: 'b1', block_type: 2, text: { elements: [{ text_run: { content: 'balance: 128.50' } }] } },
          { block_id: 'b2', block_type: 2, text: { elements: [{ text_run: { content: 'dueDate: 2026-09-18' } }] } },
        ] } }));
        return;
      }
      if (path === '/open-apis/sheets/v2/spreadsheets/sheet_1/values/A1:B2') { res.end(JSON.stringify({ code: 0, data: { value_range: { range: 'A1:B2', values: [['balance', 'dueDate'], ['200', '2026-09-19']] } } })); return; }
      if (path === '/open-apis/bitable/v1/apps/bit_1/tables/tbl_1/records') { res.end(JSON.stringify({ code: 0, data: { items: [{ record_id: 'rec_1', fields: { balance: 42.5, dueDate: '2026-09-21' } }] } })); return; }
      res.statusCode = 404; res.end(JSON.stringify({ code: 1254046, msg: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    process.env.FEISHU_APP_ID = config.appId; process.env.FEISHU_APP_SECRET = config.appSecret; process.env.FEISHU_OAUTH_REDIRECT_URI = config.redirectUri;
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    const prePool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
    await prePool.query("DELETE FROM provider_runtime_policies WHERE provider_key='feishu'");
    await prePool.query("DELETE FROM verification_policies WHERE policy_key LIKE 'feishu.%'");
    await prePool.query("DELETE e FROM provider_capability_evidence e INNER JOIN provider_capability_manifests m ON m.id=e.manifest_id WHERE m.provider_key='feishu'");
    await prePool.query("DELETE FROM provider_capability_evidence WHERE provider_key='feishu'");
    await prePool.query("DELETE FROM provider_capability_manifests WHERE provider_key='feishu'");
    await prePool.end();
    const transport: FeishuTransport = (url, init) => { const source = new URL(url); return fetch(endpoint + source.pathname + source.search, init); };
    ({ app, pool } = await bootP2App('r6-read-' + unique, [{ token: FEISHU_TRANSPORT, value: transport }, { token: PDF_TEXT_LAYER, value: new FixturePdfTextLayer() }]));
    owner = await register(app, `r6-owner-${unique}@example.com`, 'R6 Owner');
    db = app.get(DATABASE);
    structuredRead = app.get(StructuredReadService);
    deviceTasks = app.get(DeviceTasksService);
    sessions = app.get(AppReadSessionsService);

    // Feishu OAuth (service-level to avoid the express query-string callback quirk)
    const feishu = app.get(FeishuService);
    const start = await feishu.start(owner.userId);
    const state = new URL(start.authorizationUrl).searchParams.get('state')!;
    const done = await feishu.callback(state, 'primary');
    connection = done.connectionId;
    await request(app.getHttpServer()).post(`/api/connections/${connection}/validate`).set(auth(owner.token)).send({}).expect(201);

    // Trusted device + device app connection
    const challenge = await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({
      deviceId, keyId: `key-${unique}`, publicKeySpki, publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex'),
    }).expect(201);
    const proof = sign('sha256', Buffer.from(challenge.body.payload as string, 'utf8'), keyPair.privateKey).toString('base64');
    const verified = await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.body.challengeId}/verify`).set(auth(owner.token)).send({ signature: proof }).expect(201);
    trustedDeviceId = verified.body.id as string;
    appConnectionId = newId();
    await db.insert(deviceAppConnections).values({ id: appConnectionId, userId: owner.userId, deviceId, trustedDeviceId, packageName: 'com.lazyarmor.fixture.wallet', displayName: 'Fixture Wallet', connectionType: 'generic', enabled: 1, modesJson: ['share'], trustLevel: 'key_proven', createdAt: new Date(), updatedAt: new Date() });
    await db.insert(localCapabilityStates).values({ id: newId(), userId: owner.userId, trustedDeviceId, capability: 'accessibility.read', manifestVersion: 'android-local-v5', userGrant: true, systemPermission: 'GRANTED', health: 'HEALTHY', checkedAt: new Date(), evidenceRef: 'isolated-native-ui-consent', updatedAt: new Date() });
  });

  const createUiSession = () => sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['UI_READ'], durationSeconds: 300,
    uiReadConsent: { version: 'ui-read.v1', requestedFields: ['wallet.balance', 'transaction.latest.amount', 'transaction.latest.time'] } }, trustedDeviceId);

  afterAll(async () => {
    if (pool) await pool.query("UPDATE provider_capability_manifests SET status='SUPERSEDED',superseded_at=UTC_TIMESTAMP(6) WHERE provider_key='feishu'");
    await pool?.end(); await app?.close();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  it('Golden 1: Feishu Doc structured read -> Candidate -> Truth', async () => {
    const reply = await request(app.getHttpServer()).post('/api/structured-reads').set(auth(owner.token)).send({
      requestId: `doc-${unique}`, sourceType: 'PROVIDER', providerKey: 'feishu', resourceType: 'FeishuDoc', resourceId: 'doc_1', connectionId: connection,
      requestedFields: ['balance', 'dueDate'], fieldExpectations: { balance: { type: 'number' }, dueDate: { type: 'date' } },
    }).expect(201);
    expect(reply.body).toMatchObject({ status: 'VERIFIED', readMethod: 'PROVIDER_STRUCTURED' });
    expect(reply.body.truthRecordIds).toHaveLength(2);
    expect(await findTruthValue(pool, owner.userId, 'balance')).toBe(128.5);
  });

  it('Golden 2: Feishu Sheet range/cells -> canonical table -> Truth', async () => {
    const reply = await request(app.getHttpServer()).post('/api/structured-reads').set(auth(owner.token)).send({
      requestId: `sheet-${unique}`, sourceType: 'PROVIDER', providerKey: 'feishu', resourceType: 'FeishuSheet', resourceId: 'sheet_1', connectionId: connection,
      structuredSelector: 'A1:B2', requestedFields: ['balance'], fieldExpectations: { balance: { type: 'number' } },
    }).expect(201);
    expect(reply.body).toMatchObject({ status: 'VERIFIED', readMethod: 'PROVIDER_STRUCTURED' });
    expect(await findTruthValue(pool, owner.userId, 'balance', 'sheet_1')).toBe(200);
  });

  it('Golden 3: PDF native text layer -> field extraction -> Truth', async () => {
    const reply = await request(app.getHttpServer()).post('/api/structured-reads').set(auth(owner.token)).send({
      requestId: `pdf-${unique}`, sourceType: 'PDF_PAGE', resourceType: 'PdfDoc', resourceId: 'pdf_1',
      requestedFields: ['balance'], fieldExpectations: { balance: { type: 'number' } },
      fileName: 'a.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-1.4 fake').toString('base64'),
    }).expect(201);
    expect(reply.body).toMatchObject({ status: 'VERIFIED', readMethod: 'FILE_NATIVE' });
    expect(await findTruthValue(pool, owner.userId, 'balance', 'pdf_1')).toBe(55);
  });

  it('Golden 4: Image Vision fallback -> structured extraction -> Truth', async () => {
    const reply = await request(app.getHttpServer()).post('/api/structured-reads').set(auth(owner.token)).send({
      requestId: `img-${unique}`, sourceType: 'IMAGE', resourceType: 'Image', resourceId: 'vision-correct',
      requestedFields: ['totalAmount'], fieldExpectations: { totalAmount: { type: 'number' } },
    }).expect(201);
    expect(reply.body).toMatchObject({ status: 'VERIFIED', readMethod: 'VISION_FALLBACK', acceptance: { vision: 'AWAITING_VISION_LIVE_EVIDENCE' } });
    expect(await findTruthValue(pool, owner.userId, 'totalAmount')).toBe(128.5);
  });

  it('Golden 5: consented Android fixture -> Candidate; Truth needs separate verification (real device stays AWAITING)', async () => {
    const session = await createUiSession();
    const awaiting = await structuredRead.androidRead(owner.userId, {
      requestId: `android-${unique}`, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
      fieldExpectations: { 'wallet.balance': { type: 'number' } },
    });
    expect(awaiting.status).toBe('AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE');
    const taskId = awaiting.acceptance.deviceTaskId as string;
    // Isolated simulated foreground evidence; not native capture acceptance.
    await pool.query("UPDATE app_read_sessions SET status='READING',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [session.id]);
    const claimed = await deviceTasks.claim(owner.userId, trustedDeviceId, deviceId, taskId);
    const ticket = (claimed as typeof claimed & { dispatchAuthorization: { payload: string; signature: string } }).dispatchAuthorization;
    const verifier = createPublicKey({ format: 'der', type: 'spki', key: Buffer.from(app.get(NativeCalendarRuntimeService).publicSigningKey(), 'base64') });
    expect(verify('sha256', Buffer.from(ticket.payload, 'base64'), verifier, Buffer.from(ticket.signature, 'base64'))).toBe(true);
    expect(JSON.parse(Buffer.from(ticket.payload, 'base64').toString())).toMatchObject({ version: 'ui-observation.v1', taskId, userId: owner.userId, sessionId: session.id, requestedFields: ['wallet.balance'], claimToken: claimed.claimToken });
    expect((await deviceTasks.evidence(owner.userId, trustedDeviceId, deviceId, taskId)).readScope?.fields).toEqual(['wallet.balance']);
    const completed = await deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, taskId, claimed.claimToken!, {
      packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'wallet-1', screenId: session.id, activityName: 'WalletActivity', observedAt: new Date().toISOString(),
      nodes: [{ resourceId: 'wallet.balance', text: '1,234.50', role: 'TextView', enabled: true }],
    });
    expect(completed.reality).toMatchObject({ truthRecordIds: [], candidateIds: [expect.stringMatching(/^[0-9a-f-]{36}$/)] });
    expect(await findTruthValue(pool, owner.userId, 'wallet.balance')).toBeNull();
    // Explicit isolated user verification is independent of field parsing.
    const candidateId = (completed.reality as { candidateIds: string[] }).candidateIds[0];
    const detail = await request(app.getHttpServer()).get('/api/candidates/' + candidateId).set(auth(owner.token)).expect(200);
    expect(detail.body).toMatchObject({ status: 'PENDING', value: { field: 'wallet.balance', value: 1234.5 }, source: { providerKey: 'edge-device' } });
    expect(detail.body).not.toHaveProperty('nodes');
    const confirmations = await Promise.all([0, 1].map(() => request(app.getHttpServer()).post('/api/candidates/' + candidateId + '/confirm').set(auth(owner.token)).send({}).expect(201)));
    expect(confirmations[0].body.id).toBe(confirmations[1].body.id);
    expect(await findTruthValue(pool, owner.userId, 'wallet.balance')).toBe(1234.5);
  });

  it('rejects wrong package, wrong device, wrong user and expired AppReadSession', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const session = await createUiSession();
    const base = {
      userId: owner.userId, sourceType: 'DEVICE_APP' as const, resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
    };
    await expect(structuredRead.androidRead(owner.userId, { ...base, requestId: `r-${unique}-wp`, packageName: 'com.other.app' })).rejects.toThrow(/package/);
    await expect(structuredRead.androidRead(owner.userId, { ...base, requestId: `r-${unique}-wd`, deviceId: 'wrong-device' })).rejects.toThrow(/device/);
    const stranger = await register(app, `r6-stranger-${unique}@example.com`, 'R6 Stranger');
    const candidateId = (await app.get(RealityPipelineService).listPending(owner.userId))[0]?.id;
    if (candidateId) await request(app.getHttpServer()).get('/api/candidates/' + candidateId).set(auth(stranger.token)).expect(404);
    await expect(structuredRead.androidRead(stranger.userId, { ...base, requestId: `r-${unique}-wu`, userId: stranger.userId })).rejects.toThrow();
    await pool.query('UPDATE app_read_sessions SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=UUID_TO_BIN(?)', [session.id]);
    await expect(structuredRead.androidRead(owner.userId, { ...base, requestId: `r-${unique}-we` })).rejects.toThrow(/expired|active/);
  });

  it('rejects SHARE as UI consent, narrowed-scope escalation, revoked grants and source-version ABA', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const shared = await sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['SHARE'], durationSeconds: 300 }, trustedDeviceId);
    const read = (sessionId: string, fields = ['wallet.balance']) => structuredRead.androidRead(owner.userId, { requestId: 'consent-' + sessionId, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'scope-wallet', packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: sessionId, deviceId, requestedFields: fields });
    await expect(read(shared.id)).rejects.toThrow(/does not authorize UI/);
    await clearActiveSessions(pool, trustedDeviceId);
    await expect(sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['UI_READ'], durationSeconds: 300 }, trustedDeviceId)).rejects.toThrow(/consent/);
    const scoped = await sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['UI_READ'], durationSeconds: 300, uiReadConsent: { version: 'ui-read.v1', requestedFields: ['wallet.balance'] } }, trustedDeviceId);
    await expect(read(scoped.id, ['transaction.latest.amount'])).rejects.toThrow(/consent/);
    const one = await read(scoped.id), two = await read(scoped.id);
    expect(one.acceptance.deviceTaskId).toBe(two.acceptance.deviceTaskId);
    await pool.query("UPDATE local_capability_states SET user_grant=0 WHERE user_id=UUID_TO_BIN(?) AND capability='accessibility.read'", [owner.userId]);
    await expect(read(scoped.id)).rejects.toThrow(/grant/);
    await pool.query("UPDATE local_capability_states SET user_grant=1 WHERE user_id=UUID_TO_BIN(?) AND capability='accessibility.read'", [owner.userId]);
    await pool.query('UPDATE device_app_connections SET updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=UUID_TO_BIN(?)', [appConnectionId]);
    await expect(read(scoped.id)).rejects.toThrow(/source version/);
  });

  it('rejects observations from a stopped or replaced session and fields outside the requested scope before Truth', async () => {
    for (const change of ['stopped', 'replaced', 'extra-field', 'future-observation', 'stale-heartbeat', 'disabled-source', 'screen-dump', 'selector-suffix']) {
      await clearActiveSessions(pool, trustedDeviceId);
      const session = await createUiSession();
      const requestId = 'scope-' + change + '-' + unique;
      const awaiting = await structuredRead.androidRead(owner.userId, { requestId, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
        packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'] });
      await pool.query("UPDATE app_read_sessions SET status='READING',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [session.id]);
      const taskId = awaiting.acceptance.deviceTaskId as string, claim = await deviceTasks.claim(owner.userId, trustedDeviceId, deviceId, taskId);
      const result = { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'wallet-1', screenId: change === 'replaced' ? randomUUID() : session.id,
        observedAt: new Date(Date.now() + (change === 'future-observation' ? 60000 : 0)).toISOString(),
        nodes: [{ resourceId: change === 'extra-field' ? 'transaction.latest.amount' : change === 'selector-suffix' ? 'unrequested/wallet.balance' : 'wallet.balance', text: '999' }], ...(change === 'screen-dump' ? { rawScreenText: 'unrequested content' } : {}) };
      if (change === 'stopped') await clearActiveSessions(pool, trustedDeviceId);
      if (change === 'stale-heartbeat') await pool.query('UPDATE app_read_sessions SET last_heartbeat_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) WHERE id=UUID_TO_BIN(?)', [session.id]);
      if (change === 'disabled-source') await pool.query('UPDATE device_app_connections SET enabled=0 WHERE id=UUID_TO_BIN(?)', [appConnectionId]);
      await expect(deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, taskId, claim.claimToken!, result)).rejects.toThrow();
      const [observations] = await pool.query<any[]>('SELECT COUNT(*) n FROM source_observations WHERE user_id=UUID_TO_BIN(?) AND external_event_key=?', [owner.userId, 'structured-read:' + requestId]);
      expect(observations[0].n).toBe(0);
      expect(await findTruthValue(pool, owner.userId, 'wallet.balance')).toBe(1234.5);
      await pool.query('UPDATE device_app_connections SET enabled=1 WHERE id=UUID_TO_BIN(?)', [appConnectionId]);
    }
  });

  it('signed grant revoke/regrant terminates the old UI session and preserves its Task identity', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const session = await createUiSession();
    const result = await structuredRead.androidRead(owner.userId, { requestId: 'grant-revoke-' + unique, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'revoked-wallet', packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'] });
    const manifest = (enabled: boolean) => ({ manifestVersion: 'android-local-v5', capabilities: LOCAL_CAPABILITY_CATALOG.map(spec => ({ key: spec.key, userGrant: spec.key === 'accessibility.read' && enabled, systemPermission: 'GRANTED', health: 'HEALTHY', checkedAt: Date.now() })) });
    const receiver = app.get(LocalCapabilitiesService);
    await receiver.receive(owner.userId, trustedDeviceId, 'isolated-revoke', manifest(false));
    await receiver.receive(owner.userId, trustedDeviceId, 'isolated-regrant', manifest(true));
    expect(await sessions.get(owner.userId, session.id)).toMatchObject({ status: 'FAILED', terminalReason: 'UI_READ_AUTHORITY_CHANGED' });
    await expect(deviceTasks.claim(owner.userId, trustedDeviceId, deviceId, result.acceptance.deviceTaskId)).rejects.toThrow(/no longer active/);
    const [rows] = await pool.query<any[]>('SELECT status,result_hash FROM device_tasks WHERE id=UUID_TO_BIN(?)', [result.acceptance.deviceTaskId]);
    expect(rows[0]).toMatchObject({ status: 'PENDING', result_hash: null });
  });

  it('rolls back all partial fields if publication loses its source, retaining the original claim and historical Truth', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const session = await createUiSession();
    const requestId = 'publication-rollback-' + unique;
    const awaiting = await structuredRead.androidRead(owner.userId, { requestId, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'rollback-wallet',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance', 'transaction.latest.amount'],
      fieldExpectations: { 'wallet.balance': { type: 'number' }, 'transaction.latest.amount': { type: 'number' } } });
    await pool.query("UPDATE app_read_sessions SET status='READING',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [session.id]);
    const taskId = awaiting.acceptance.deviceTaskId as string, claim = await deviceTasks.claim(owner.userId, trustedDeviceId, deviceId, taskId);
    const countVersions = async () => (await pool.query<any[]>('SELECT COUNT(*) n FROM truth_record_versions v JOIN truth_records r ON r.id=v.truth_record_id WHERE r.user_id=UUID_TO_BIN(?)', [owner.userId]))[0][0].n;
    const before = await countVersions(), original = (structuredRead as any).assertReadSession.bind(structuredRead);
    let sourceChecks = 0;
    const spy = vi.spyOn(structuredRead as any, 'assertReadSession').mockImplementation(async (...args) => {
      if (++sourceChecks === 2) throw new StructuredReadSourceInvalidError('Isolated source invalidation during final publication');
      return original(...args);
    });
    try {
      await expect(deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, taskId, claim.claimToken!, { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'rollback-wallet',
        screenId: session.id, observedAt: new Date().toISOString(), nodes: [{ resourceId: 'wallet.balance', text: '999' }, { resourceId: 'transaction.latest.amount', text: '2' }] })).rejects.toThrow('source invalidation');
      expect(sourceChecks).toBe(2); expect(await countVersions()).toBe(before);
      const [rows] = await pool.query<any[]>('SELECT status,result_hash FROM device_tasks WHERE id=UUID_TO_BIN(?)', [taskId]);
      expect(rows[0]).toMatchObject({ status: 'CLAIMED', result_hash: null });
      const [observations] = await pool.query<any[]>('SELECT COUNT(*) n FROM source_observations WHERE user_id=UUID_TO_BIN(?) AND external_event_key=?', [owner.userId, 'structured-read:' + requestId]);
      expect(observations[0].n).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it('rejects unsigned or changed completion while replay retains the same terminal identity', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const session = await createUiSession();

    // unsigned completion
    const unsignedTask = await structuredRead.androidRead(owner.userId, {
      requestId: `unsigned-${unique}`, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
    });
    await request(app.getHttpServer()).post(`/api/device-tasks/${unsignedTask.acceptance.deviceTaskId}/complete`).set(auth(owner.token)).send({ claimToken: 'a'.repeat(64), result: {} }).expect(403);

    // resource mismatch
    const mismatchTask = await structuredRead.androidRead(owner.userId, {
      requestId: `mismatch-${unique}`, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
    });
    const mismatchClaim = await deviceTasks.claim(owner.userId, trustedDeviceId, deviceId, mismatchTask.acceptance.deviceTaskId as string);
    await expect(deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, mismatchTask.acceptance.deviceTaskId as string, mismatchClaim.claimToken!, { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'other-resource', nodes: [{ resourceId: 'wallet.balance', text: '5' }] })).rejects.toThrow();

    // duplicate completion
    const dupTask = await structuredRead.androidRead(owner.userId, {
      requestId: `dup-${unique}`, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
    });
    const dupClaim = await deviceTasks.claim(owner.userId, trustedDeviceId, deviceId, dupTask.acceptance.deviceTaskId as string);
    await pool.query("UPDATE app_read_sessions SET status='READING',last_heartbeat_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [session.id]);
    const good = { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'wallet-1', screenId: session.id, observedAt: new Date().toISOString(), nodes: [{ resourceId: 'wallet.balance', text: '5' }] };
    const completed = await deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, dupTask.acceptance.deviceTaskId as string, dupClaim.claimToken!, good);
    const replay = await deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, dupTask.acceptance.deviceTaskId as string, dupClaim.claimToken!, good);
    expect(replay).toMatchObject({ id: completed.id, status: 'FAILED', errorCode: 'NEEDS_CONFIRMATION', resultHash: completed.resultHash });
    await expect(deviceTasks.complete(owner.userId, trustedDeviceId, deviceId, dupTask.acceptance.deviceTaskId as string, dupClaim.claimToken!, { ...good, nodes: [{ resourceId: 'wallet.balance', text: 'changed' }] })).rejects.toThrow();
  });
});

async function clearActiveSessions(pool: Pool, trustedDeviceId: string): Promise<void> {
  await pool.query("UPDATE app_read_sessions SET status='CANCELLED', active_device_key=NULL, ended_at=UTC_TIMESTAMP(6) WHERE trusted_device_id=UUID_TO_BIN(?)", [trustedDeviceId]);
}
