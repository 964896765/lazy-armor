import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { deviceTasks as deviceTasksTable } from '@lazy-armor/database';
import { eq } from 'drizzle-orm';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from '../src/common/database.module';
import { DeviceTasksService } from '../src/device-tasks/device-tasks.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

describe.sequential('R4 edge device task transport', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let deviceTasks: DeviceTasksService;
  let reality: RealityPipelineService;
  let trustedDeviceId: string;
  let deviceSessionId: string;

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deviceId = `edge-${unique}`;
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`r4-device-task-${unique}`));
    owner = await register(app, `r4-device-owner-${unique}@example.com`, 'R4 Device Owner');
    deviceTasks = app.get(DeviceTasksService);
    reality = app.get(RealityPipelineService);

    const challenge = await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({
      deviceId, keyId: `key-${unique}`, publicKeySpki, publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex'),
    }).expect(201);
    const proof = sign('sha256', Buffer.from(challenge.body.payload as string, 'utf8'), keyPair.privateKey).toString('base64');
    const verified = await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.body.challengeId}/verify`).set(auth(owner.token)).send({ signature: proof }).expect(201);
    trustedDeviceId = verified.body.id as string;
    deviceSessionId = verified.body.deviceSession.id as string;
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  function signedHeaders(body: unknown, method: string, path: string) {
    const requestId = randomBytes(32).toString('hex');
    const signedAt = new Date().toISOString();
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const message = `lazy-armor-device-request-v1|${deviceSessionId}|${requestId}|${method}|${path}|${payloadHash}|${signedAt}`;
    return {
      'x-device-session': deviceSessionId, 'x-device-request-id': requestId, 'x-device-signed-at': signedAt,
      'x-device-payload-hash': payloadHash, 'x-device-signature': sign('sha256', Buffer.from(message, 'utf8'), keyPair.privateKey).toString('base64'),
    };
  }

  it('records device heartbeats and resolves online state for the trusted device', async () => {
    const body = { onlineState: 'online' };
    const response = await request(app.getHttpServer()).post('/api/device-tasks/heartbeat').set(auth(owner.token))
      .set(signedHeaders(body, 'POST', '/device-tasks/heartbeat')).send(body).expect(201);
    expect(response.body).toMatchObject({ trustedDeviceId, deviceId, onlineState: 'online', online: true });
    expect(await deviceTasks.heartbeatState(owner.userId, trustedDeviceId)).toMatchObject({ onlineState: 'online', online: true });
  });

  it('enqueues, claims, and completes a READ_CONSUMABLE task with result routed into verified truth', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});
    expect(task).toMatchObject({ status: 'PENDING', taskType: 'READ_CONSUMABLE', factKey: 'device.consumable.remaining_days', claimToken: null });

    const listed = await request(app.getHttpServer()).get('/api/device-tasks').set(auth(owner.token))
      .set(signedHeaders({}, 'GET', '/device-tasks')).expect(200);
    expect((listed.body as Array<{ id: string }>).some((item) => item.id === task.id)).toBe(true);

    const claimed = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/claim`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', `/device-tasks/${task.id}/claim`)).send({}).expect(201);
    expect(claimed.body).toMatchObject({ id: task.id, status: 'CLAIMED' });
    expect(claimed.body.claimToken).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(claimed.body.leaseExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const completeBody = { claimToken: claimed.body.claimToken as string, result: { remainingDays: 25 } };
    const completed = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody).expect(201);
    expect(completed.body).toMatchObject({ id: task.id, status: 'SUCCEEDED', result: { remainingDays: 25 } });
    expect(completed.body.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(completed.body.reality).toMatchObject({ candidateId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(completed.body.reality.truth).toMatchObject({ status: 'verified' });
    expect(completed.body.reality.truth.currentVersion.value).toMatchObject({ factKey: 'device.consumable.remaining_days', value: { remainingDays: 25 } });

    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody).expect(409);

    const stored = await deviceTasks.get(owner.userId, task.id);
    expect(stored.status).toBe('SUCCEEDED');
    const truths = await reality.listTruth(owner.userId);
    expect(truths.some((item) => item.currentVersion.value.factKey === 'device.consumable.remaining_days' && item.currentVersion.value.value.remainingDays === 25)).toBe(true);
  });

  it('prevents duplicate claims and recovers expired leases back to claimable', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});

    const path = `/device-tasks/${task.id}/claim`;
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token)).set(signedHeaders({}, 'POST', path)).send({}),
      request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token)).set(signedHeaders({}, 'POST', path)).send({}),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;

    await app.get(DATABASE).update(deviceTasksTable).set({ leaseExpiresAt: new Date(Date.now() - 5_000) }).where(eq(deviceTasksTable.id, task.id));
    const staleBody = { claimToken: winner.body.claimToken as string, result: { remainingDays: 25 } };
    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(staleBody, 'POST', `/device-tasks/${task.id}/complete`)).send(staleBody).expect(409);
    const recovery = await deviceTasks.recoverExpired();
    expect(recovery.recovered).toBeGreaterThanOrEqual(1);

    const reclaimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    expect(reclaimed.body).toMatchObject({ id: task.id, status: 'CLAIMED' });
    expect(reclaimed.body.claimToken).not.toBe(winner.body.claimToken);

    const failBody = { claimToken: reclaimed.body.claimToken as string, errorCode: 'DEVICE_READ_TIMEOUT' };
    const failed = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/fail`).set(auth(owner.token))
      .set(signedHeaders(failBody, 'POST', `/device-tasks/${task.id}/fail`)).send(failBody).expect(201);
    expect(failed.body).toMatchObject({ status: 'FAILED', errorCode: 'DEVICE_READ_TIMEOUT' });
  });

  it('marks real-Android-only task types as AWAITING_DEVICE_EVIDENCE', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'APP_READ_SESSION', 'device.app.read.session', 'AppReadSession', {});
    expect(task.status).toBe('AWAITING_DEVICE_EVIDENCE');
    expect((await deviceTasks.get(owner.userId, task.id)).status).toBe('AWAITING_DEVICE_EVIDENCE');
    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/claim`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', `/device-tasks/${task.id}/claim`)).send({}).expect(409);
  });
});
