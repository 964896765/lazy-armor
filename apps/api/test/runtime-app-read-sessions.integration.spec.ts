import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

describe.sequential('runtime productization batch 4 foreground acquisition', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let trustedDeviceId: string;
  let deviceSessionId: string;
  let connectionId: string;
  let sessionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deviceId = `android-${unique}`;
  const targetPackage = 'com.example.foregroundbilling';
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`app-read-${unique}`));
    owner = await register(app, `app-read-owner-${unique}@example.com`, 'App Read Owner');
    stranger = await register(app, `app-read-str-${unique}@example.com`, 'App Read Stranger');

    const challenge = await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({
      deviceId, keyId: `key-${unique}`, publicKeySpki, publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex'),
    }).expect(201);
    const proof = sign('sha256', Buffer.from(challenge.body.payload as string, 'utf8'), keyPair.privateKey).toString('base64');
    const verified = await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.body.challengeId}/verify`).set(auth(owner.token)).send({ signature: proof }).expect(201);
    trustedDeviceId = verified.body.id as string;
    deviceSessionId = verified.body.deviceSession.id as string;

    const connectionBody = {
      trustedDeviceId, deviceId, packageName: targetPackage, displayName: '前台账单测试', versionName: '1.0', versionCode: 1,
      launchable: true, discoveryFingerprint: hash(`discovery-${unique}`), modes: ['open_app', 'notification_read'],
    };
    const connection = await request(app.getHttpServer()).post('/api/device-app-connections').set(auth(owner.token))
      .set(signedHeaders(connectionBody, '/device-app-connections')).send(connectionBody).expect(201);
    connectionId = connection.body.id as string;
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  function signedHeaders(body: unknown, path: string) {
    const requestId = randomBytes(32).toString('hex');
    const signedAt = new Date().toISOString();
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const message = `lazy-armor-device-request-v1|${deviceSessionId}|${requestId}|POST|${path}|${payloadHash}|${signedAt}`;
    return {
      'x-device-session': deviceSessionId, 'x-device-request-id': requestId, 'x-device-signed-at': signedAt,
      'x-device-payload-hash': payloadHash, 'x-device-signature': sign('sha256', Buffer.from(message, 'utf8'), keyPair.privateKey).toString('base64'),
    };
  }

  it('requires a device-bound signature and admits only one active session per device under concurrency', async () => {
    const body = { connectionId, targetPackage, modes: ['NOTIFICATION', 'SHARE'], durationSeconds: 300 };
    const unsigned = await request(app.getHttpServer()).post('/api/app-read-sessions').set(auth(owner.token)).send(body);
    expect({ status: unsigned.status, body: unsigned.body }).toEqual({ status: 403, body: expect.anything() });
    const results = await Promise.all([
      request(app.getHttpServer()).post('/api/app-read-sessions').set(auth(owner.token)).set(signedHeaders(body, '/app-read-sessions')).send(body),
      request(app.getHttpServer()).post('/api/app-read-sessions').set(auth(owner.token)).set(signedHeaders(body, '/app-read-sessions')).send(body),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const created = results.find((result) => result.status === 201)!;
    sessionId = created.body.id as string;
    expect(created.body).toMatchObject({ targetPackage, status: 'WAITING_FOREGROUND', modes: ['NOTIFICATION', 'SHARE'] });
    await request(app.getHttpServer()).get(`/api/app-read-sessions/${sessionId}`).set(auth(stranger.token)).expect(404);
  });

  it('accepts exact-package heartbeats and deduplicates concurrent candidate capture without creating truth', async () => {
    const heartbeat = {
      eventKey: hash(`heartbeat-${unique}`), foregroundPackage: targetPackage, usageAccessGranted: true,
      nativeStatus: 'WAITING_FOREGROUND', observedAt: new Date().toISOString(),
    };
    const alive = await request(app.getHttpServer()).post(`/api/app-read-sessions/${sessionId}/heartbeat`).set(auth(owner.token))
      .set(signedHeaders(heartbeat, `/app-read-sessions/${sessionId}/heartbeat`)).send(heartbeat).expect(201);
    expect(alive.body.status).toBe('READING');

    const event = {
      eventKey: hash(`capture-${unique}`), eventType: 'NOTIFICATION_CAPTURED', packageName: targetPackage,
      observedAt: new Date().toISOString(), payload: { titleHash: hash('账单提醒'), bodyHash: hash('支付 25.80 元') },
      evidenceHash: hash(`evidence-${unique}`), candidateKind: 'billing_transaction_candidate', amountMinor: 2580, currency: 'CNY',
    };
    const path = `/app-read-sessions/${sessionId}/events`;
    const captured = await Promise.all([
      request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token)).set(signedHeaders(event, path)).send(event),
      request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token)).set(signedHeaders(event, path)).send(event),
    ]);
    expect(captured.map((result) => result.status)).toEqual([201, 201]);
    expect(new Set(captured.map((result) => result.body.candidateFactId))).toHaveLength(1);
    const candidateId = captured[0]!.body.candidateFactId as string;
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT COUNT(DISTINCT e.id) event_count, COUNT(DISTINCT c.id) candidate_count,
             SUM(CASE WHEN c.status='PENDING' AND c.truth_record_id IS NULL THEN 1 ELSE 0 END) pending_count
      FROM app_read_session_events e
      LEFT JOIN candidate_facts c ON c.id=e.candidate_fact_id
      WHERE e.session_id=UUID_TO_BIN(?) AND e.event_key=?`,
      [sessionId, event.eventKey],
    );
    expect(rows[0]).toMatchObject({ event_count: 1, candidate_count: 1, pending_count: '1' });
    expect(candidateId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails closed as soon as the foreground package changes', async () => {
    const heartbeat = {
      eventKey: hash(`foreground-lost-${unique}`), foregroundPackage: 'com.example.other', usageAccessGranted: true,
      nativeStatus: 'READING', observedAt: new Date().toISOString(),
    };
    const response = await request(app.getHttpServer()).post(`/api/app-read-sessions/${sessionId}/heartbeat`).set(auth(owner.token))
      .set(signedHeaders(heartbeat, `/app-read-sessions/${sessionId}/heartbeat`)).send(heartbeat).expect(201);
    expect(response.body).toMatchObject({ status: 'APP_LEFT_FOREGROUND', terminalReason: 'FOREGROUND_PACKAGE_MISMATCH' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT active_device_key FROM app_read_sessions WHERE id=UUID_TO_BIN(?)', [sessionId]);
    expect(rows[0]!.active_device_key).toBeNull();
  });
});
