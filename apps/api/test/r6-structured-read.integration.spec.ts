import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { deviceAppConnections } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEISHU_CALLBACK_PATH } from '@lazy-armor/config';
import { AppReadSessionsService } from '../src/app-read-sessions/app-read-sessions.service';
import { DATABASE, type InjectedDatabase } from '../src/common/database.module';
import { DeviceTasksService } from '../src/device-tasks/device-tasks.service';
import { FeishuService } from '../src/providers/feishu/feishu.service';
import { FEISHU_TRANSPORT, type FeishuTransport } from '../src/providers/feishu/feishu-http.client';
import { PDF_TEXT_LAYER, type PdfTextLayer } from '../src/structured-read/file-structured-reader';
import { StructuredReadService } from '../src/structured-read/structured-read.service';
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
  });

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

  it('Golden 5: Android simulated structured read -> Truth (real device stays AWAITING)', async () => {
    const session = await sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['SHARE'], durationSeconds: 300 }, trustedDeviceId);
    const awaiting = await structuredRead.androidRead(owner.userId, {
      requestId: `android-${unique}`, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
      fieldExpectations: { 'wallet.balance': { type: 'number' } },
    });
    expect(awaiting.status).toBe('AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE');
    const taskId = awaiting.acceptance.deviceTaskId as string;
    const claimed = await deviceTasks.claim(owner.userId, deviceId, taskId);
    const completed = await deviceTasks.complete(owner.userId, taskId, claimed.claimToken!, {
      packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'wallet-1', activityName: 'WalletActivity', observedAt: new Date().toISOString(),
      nodes: [{ resourceId: 'wallet.balance', text: '1,234.50', role: 'TextView', enabled: true }],
    });
    expect(completed.reality).toMatchObject({ truthRecordIds: [expect.stringMatching(/^[0-9a-f-]{36}$/)] });
    expect(await findTruthValue(pool, owner.userId, 'wallet.balance')).toBe(1234.5);
  });

  it('rejects wrong package, wrong device, wrong user and expired AppReadSession', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const session = await sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['SHARE'], durationSeconds: 300 }, trustedDeviceId);
    const base = {
      userId: owner.userId, sourceType: 'DEVICE_APP' as const, resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
    };
    await expect(structuredRead.androidRead(owner.userId, { ...base, requestId: `r-${unique}-wp`, packageName: 'com.other.app' })).rejects.toThrow(/package/);
    await expect(structuredRead.androidRead(owner.userId, { ...base, requestId: `r-${unique}-wd`, deviceId: 'wrong-device' })).rejects.toThrow(/device/);
    const stranger = await register(app, `r6-stranger-${unique}@example.com`, 'R6 Stranger');
    await expect(structuredRead.androidRead(stranger.userId, { ...base, requestId: `r-${unique}-wu`, userId: stranger.userId })).rejects.toThrow();
    await pool.query('UPDATE app_read_sessions SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=UUID_TO_BIN(?)', [session.id]);
    await expect(structuredRead.androidRead(owner.userId, { ...base, requestId: `r-${unique}-we` })).rejects.toThrow(/expired|active/);
  });

  it('rejects unsigned completion, resource mismatch and duplicate completion', async () => {
    await clearActiveSessions(pool, trustedDeviceId);
    const session = await sessions.create(owner.userId, { connectionId: appConnectionId, targetPackage: 'com.lazyarmor.fixture.wallet', modes: ['SHARE'], durationSeconds: 300 }, trustedDeviceId);

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
    const mismatchClaim = await deviceTasks.claim(owner.userId, deviceId, mismatchTask.acceptance.deviceTaskId as string);
    await expect(deviceTasks.complete(owner.userId, mismatchTask.acceptance.deviceTaskId as string, mismatchClaim.claimToken!, { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'other-resource', nodes: [{ resourceId: 'wallet.balance', text: '5' }] })).rejects.toThrow();

    // duplicate completion
    const dupTask = await structuredRead.androidRead(owner.userId, {
      requestId: `dup-${unique}`, userId: owner.userId, sourceType: 'DEVICE_APP', resourceType: 'FixtureWallet', resourceId: 'wallet-1',
      packageName: 'com.lazyarmor.fixture.wallet', appReadSessionId: session.id, deviceId, requestedFields: ['wallet.balance'],
    });
    const dupClaim = await deviceTasks.claim(owner.userId, deviceId, dupTask.acceptance.deviceTaskId as string);
    const good = { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'wallet-1', nodes: [{ resourceId: 'wallet.balance', text: '5' }] };
    await deviceTasks.complete(owner.userId, dupTask.acceptance.deviceTaskId as string, dupClaim.claimToken!, good);
    await expect(deviceTasks.complete(owner.userId, dupTask.acceptance.deviceTaskId as string, dupClaim.claimToken!, good)).rejects.toThrow();
  });
});

async function clearActiveSessions(pool: Pool, trustedDeviceId: string): Promise<void> {
  await pool.query("UPDATE app_read_sessions SET status='CANCELLED', active_device_key=NULL, ended_at=UTC_TIMESTAMP(6) WHERE trusted_device_id=UUID_TO_BIN(?)", [trustedDeviceId]);
}
