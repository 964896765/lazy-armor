import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
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
    return deviceHeaders(deviceSessionId, keyPair.privateKey, body, method, path);
  }

  function deviceHeaders(sessionId: string, privateKey: KeyObject, body: unknown, method: string, path: string) {
    const requestId = randomBytes(32).toString('hex');
    const signedAt = new Date().toISOString();
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const message = `lazy-armor-device-request-v1|${sessionId}|${requestId}|${method}|${path}|${payloadHash}|${signedAt}`;
    return {
      'x-device-session': sessionId, 'x-device-request-id': requestId, 'x-device-signed-at': signedAt,
      'x-device-payload-hash': payloadHash, 'x-device-signature': sign('sha256', Buffer.from(message, 'utf8'), privateKey).toString('base64'),
    };
  }

  async function enrollSecondDevice() {
    const secondDeviceId = `edge-b-${unique}`;
    const secondKeyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const secondSpki = secondKeyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const challenge = await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({
      deviceId: secondDeviceId, keyId: `key-b-${unique}`, publicKeySpki: secondSpki,
      publicKeyFingerprint: createHash('sha256').update(Buffer.from(secondSpki, 'base64')).digest('hex'),
    }).expect(201);
    const proof = sign('sha256', Buffer.from(challenge.body.payload as string, 'utf8'), secondKeyPair.privateKey).toString('base64');
    const verified = await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.body.challengeId}/verify`).set(auth(owner.token)).send({ signature: proof }).expect(201);
    return { trustedDeviceId: verified.body.id as string, deviceId: secondDeviceId, deviceSessionId: verified.body.deviceSession.id as string, privateKey: secondKeyPair.privateKey };
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

    const evidencePath = `/device-tasks/${task.id}/evidence`;
    const evidence = await request(app.getHttpServer()).get(`/api${evidencePath}`).set(auth(owner.token))
      .set(signedHeaders({}, 'GET', evidencePath)).expect(200);
    expect(evidence.body.task).toMatchObject({
      id: task.id,
      status: 'SUCCEEDED',
      attemptCount: 1,
      deviceOnline: true,
      claimedAt: expect.any(String),
      leaseExpiresAt: expect.any(String),
      deviceHeartbeatAt: expect.any(String),
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(evidence.body.observations).toHaveLength(1);
    expect(evidence.body.candidates).toHaveLength(1);
    expect(evidence.body.truths).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'verified', current: true })]));
    expect(JSON.stringify(evidence.body)).not.toContain(claimed.body.claimToken);
    expect(JSON.stringify(evidence.body)).not.toContain('remainingDays');

    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody).expect(409);

    const stored = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
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
    expect((await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id)).status).toBe('AWAITING_DEVICE_EVIDENCE');
    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/claim`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', `/device-tasks/${task.id}/claim`)).send({}).expect(409);
  });

  it('fails closed across devices: device B cannot see, claim, or complete device A tasks', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});
    const claimed = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/claim`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', `/device-tasks/${task.id}/claim`)).send({}).expect(201);
    const second = await enrollSecondDevice();

    const listB = await request(app.getHttpServer()).get('/api/device-tasks').set(auth(owner.token))
      .set(deviceHeaders(second.deviceSessionId, second.privateKey, {}, 'GET', '/device-tasks')).expect(200);
    expect((listB.body as Array<{ id: string }>).some((item) => item.id === task.id)).toBe(false);

    const getB = await request(app.getHttpServer()).get(`/api/device-tasks/${task.id}`).set(auth(owner.token))
      .set(deviceHeaders(second.deviceSessionId, second.privateKey, {}, 'GET', `/device-tasks/${task.id}`));
    expect(getB.status).toBe(404);
    const evidencePath = `/device-tasks/${task.id}/evidence`;
    await request(app.getHttpServer()).get(`/api${evidencePath}`).set(auth(owner.token))
      .set(deviceHeaders(second.deviceSessionId, second.privateKey, {}, 'GET', evidencePath)).expect(404);

    const claimB = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/claim`).set(auth(owner.token))
      .set(deviceHeaders(second.deviceSessionId, second.privateKey, {}, 'POST', `/device-tasks/${task.id}/claim`)).send({});
    expect(claimB.status).toBe(404);

    const completeBody = { claimToken: claimed.body.claimToken as string, result: { remainingDays: 25 } };
    const completeB = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(deviceHeaders(second.deviceSessionId, second.privateKey, completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody);
    expect(completeB.status).toBe(404);

    expect((await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id)).status).toBe('CLAIMED');
  });

  it('atomic CAS: recover cannot steal an active lease and heartbeat cannot outlive recovery', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});
    const path = `/device-tasks/${task.id}/claim`;
    const claimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    const token = claimed.body.claimToken as string;

    const heartbeatBody = { claimToken: token };
    const [activeRecover, activeHeartbeat] = await Promise.all([
      deviceTasks.recoverExpired(),
      request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/heartbeat`).set(auth(owner.token))
        .set(signedHeaders(heartbeatBody, 'POST', `/device-tasks/${task.id}/heartbeat`)).send(heartbeatBody),
    ]);
    expect(activeHeartbeat.status).toBe(201);
    expect(activeRecover.recovered).toBe(0);
    const afterActive = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
    expect(afterActive.status).toBe('CLAIMED');
    expect(afterActive.claimToken).toBe(token);

    await app.get(DATABASE).update(deviceTasksTable).set({ leaseExpiresAt: new Date(Date.now() - 5_000) }).where(eq(deviceTasksTable.id, task.id));
    const [expiredRecover, expiredHeartbeat] = await Promise.all([
      deviceTasks.recoverExpired(),
      request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/heartbeat`).set(auth(owner.token))
        .set(signedHeaders(heartbeatBody, 'POST', `/device-tasks/${task.id}/heartbeat`)).send(heartbeatBody),
    ]);
    expect([403, 409]).toContain(expiredHeartbeat.status);
    expect(expiredRecover.recovered).toBe(1);
    const afterExpired = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
    expect(afterExpired.status).toBe('PENDING');
    expect(afterExpired.claimToken).toBeNull();
  });

  it('atomic CAS: a stale completion cannot succeed after reclaim', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});
    const path = `/device-tasks/${task.id}/claim`;
    const claimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    const staleToken = claimed.body.claimToken as string;

    await app.get(DATABASE).update(deviceTasksTable).set({ leaseExpiresAt: new Date(Date.now() - 5_000) }).where(eq(deviceTasksTable.id, task.id));

    const staleBody = { claimToken: staleToken, result: { remainingDays: 25 } };
    const [reclaimedResponse, staleComplete] = await Promise.all([
      (async () => {
        const recovered = await deviceTasks.recoverExpired();
        expect(recovered.recovered).toBe(1);
        return request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
          .set(signedHeaders({}, 'POST', path)).send({});
      })(),
      request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
        .set(signedHeaders(staleBody, 'POST', `/device-tasks/${task.id}/complete`)).send(staleBody),
    ]);
    expect(staleComplete.status).toBeGreaterThanOrEqual(400);
    expect(reclaimedResponse.status).toBe(201);
    expect(reclaimedResponse.body.status).toBe('CLAIMED');

    const row = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
    expect(row.status).toBe('CLAIMED');
    expect(row.claimToken).toBe(reclaimedResponse.body.claimToken);
    expect(row.claimToken).not.toBe(staleToken);
    expect(row.result).toBeNull();
  });

  it('rejects enqueue of an unregistered task type', async () => {
    await expect(deviceTasks.enqueue(owner.userId, trustedDeviceId, 'NOT_A_REAL_TASK', 'f', 'r', {})).rejects.toThrow();
  });

  it('never marks SUCCEEDED for an unregistered task type at completion', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});
    const path = `/device-tasks/${task.id}/claim`;
    const claimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    await app.get(DATABASE).update(deviceTasksTable).set({ taskType: 'NOT_A_REAL_TASK' }).where(eq(deviceTasksTable.id, task.id));
    const completeBody = { claimToken: claimed.body.claimToken as string, result: { remainingDays: 25 } };
    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody).expect(400);
    const row = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('UNSUPPORTED_TASK_TYPE');
    expect(row.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed: structured read without UI nodes never reports SUCCEEDED', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'APP_STRUCTURED_READ', 'structured_read.field', 'FixtureWallet', {
      packageName: 'com.lazyarmor.fixture.wallet', resourceType: 'FixtureWallet', resourceId: 'fixture-1',
      requestedFields: ['wallet.balance'], fieldExpectations: {},
    });
    const path = `/device-tasks/${task.id}/claim`;
    const claimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    const completeBody = { claimToken: claimed.body.claimToken as string, result: { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'fixture-1', nodes: [] } };
    await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody).expect(400);
    const row = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('RESULT_VERIFICATION_FAILED');
  });

  it('completes APP_STRUCTURED_READ with real nodes into verified truth, requiring truthRecordIds for SUCCEEDED', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'APP_STRUCTURED_READ', 'structured_read.field', 'FixtureWallet', {
      packageName: 'com.lazyarmor.fixture.wallet', resourceType: 'FixtureWallet', resourceId: 'fixture-1',
      requestedFields: ['wallet.balance'], fieldExpectations: {},
    });
    const path = `/device-tasks/${task.id}/claim`;
    const claimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    const completeBody = {
      claimToken: claimed.body.claimToken as string,
      result: { packageName: 'com.lazyarmor.fixture.wallet', resourceId: 'fixture-1', nodes: [{ resourceId: 'wallet.balance', text: '25' }] },
    };
    const completed = await request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
      .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody).expect(201);
    expect(completed.body).toMatchObject({ id: task.id, status: 'SUCCEEDED' });
    expect(completed.body.reality.candidateIds.length).toBeGreaterThan(0);
    expect(completed.body.reality.truthRecordIds.length).toBeGreaterThan(0);

    const truths = await reality.listTruth(owner.userId);
    expect(truths.some((item) => item.currentVersion.value.factKey === 'structured_read.field')).toBe(true);
  });

  it('stale-claim Truth race: old complete cannot write VERIFIED truth or SUCCEEDED after reclaim', async () => {
    const task = await deviceTasks.enqueue(owner.userId, trustedDeviceId, 'READ_CONSUMABLE', 'device.consumable.remaining_days', 'device.consumable', {});
    const path = `/device-tasks/${task.id}/claim`;
    const claimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
      .set(signedHeaders({}, 'POST', path)).send({}).expect(201);
    const staleToken = claimed.body.claimToken as string;

    // Short lease so it expires while the old claimant is parked before the Truth write.
    await app.get(DATABASE).update(deviceTasksTable).set({ leaseExpiresAt: new Date(Date.now() + 500) }).where(eq(deviceTasksTable.id, task.id));

    // Deterministic barrier: hang the RealityPipeline ingest so complete() keeps
    // the task row locked inside its transaction after ownership validation but
    // before any VERIFIED Truth is materialized.
    const originalIngest = reality.ingest.bind(reality);
    let releaseIngest!: () => void;
    const ingestReleased = new Promise<void>((resolve) => { releaseIngest = resolve; });
    let signalIngest!: () => void;
    const ingestReached = new Promise<void>((resolve) => { signalIngest = resolve; });
    (reality as unknown as { ingest: typeof reality.ingest }).ingest = (async (...args: Parameters<RealityPipelineService['ingest']>) => {
      signalIngest();
      await ingestReleased;
      return originalIngest(...args);
    }) as typeof reality.ingest;

    try {
      const completeBody = { claimToken: staleToken, result: { remainingDays: 999 } };
      const staleCompletePromise = request(app.getHttpServer()).post(`/api/device-tasks/${task.id}/complete`).set(auth(owner.token))
        .set(signedHeaders(completeBody, 'POST', `/device-tasks/${task.id}/complete`)).send(completeBody)
        .then((response) => response);

      // Old claimant is now parked inside the transaction holding the row lock.
      await ingestReached;
      // Let the lease expire deterministically before releasing the barrier.
      await new Promise((resolve) => setTimeout(resolve, 800));

      // recover + reclaim block on the row lock until the stale claimant rolls back.
      releaseIngest();
      const recovered = await deviceTasks.recoverExpired();
      expect(recovered.recovered).toBeGreaterThanOrEqual(1);

      const reclaimed = await request(app.getHttpServer()).post(`/api${path}`).set(auth(owner.token))
        .set(signedHeaders({}, 'POST', path)).send({});
      expect(reclaimed.status).toBe(201);
      expect(reclaimed.body).toMatchObject({ id: task.id, status: 'CLAIMED' });

      const staleResponse = await staleCompletePromise;
      expect(staleResponse.status).toBe(409);

      const row = await deviceTasks.get(owner.userId, trustedDeviceId, deviceId, task.id);
      expect(row.status).toBe('CLAIMED');
      expect(row.claimToken).toBe(reclaimed.body.claimToken);
      expect(row.claimToken).not.toBe(staleToken);
      expect(row.result).toBeNull();

      // The stale claimant must not have materialized VERIFIED Truth for this fact.
      const truths = await reality.listTruth(owner.userId);
      expect(truths.some((item) => item.currentVersion.value.factKey === 'device.consumable.remaining_days' && item.currentVersion.value.value?.remainingDays === 999)).toBe(false);
    } finally {
      (reality as unknown as { ingest: typeof reality.ingest }).ingest = originalIngest as typeof reality.ingest;
    }
  });
});
