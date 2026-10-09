import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LOCAL_CAPABILITY_CATALOG } from '@lazy-armor/plan-schema';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { PersistentNotificationPlanService } from '../src/consumer/persistent-notification-plan.service';
import { TerminalHandoffService } from '../src/strategy-runtime/terminal-handoff.service';
import { StrategyRuntimeService } from '../src/strategy-runtime/strategy-runtime.service';
import { auth, bootP2App, register, activatePlan, setPlusMembership, type Session } from './p2-test-helpers';

/** Signed, isolated protocol fixtures. None of these assertions are phone evidence. */
describe.sequential('P3 persistent notification source authority and continuation', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, trustedId: string, sessionId: string, connectionId: string, worker: Awaited<ReturnType<typeof bootP2App>>['worker'];
  let plans: PersistentNotificationPlanService;
  const unique = 'p3plan-' + Date.now(), deviceId = 'edge-' + unique, sourcePackage = 'com.jingdong.app.mall';
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const model = { modelId: () => 'fixture-notification-plan', capability: () => ({ modelId: 'fixture-notification-plan', supportsStructuredCompletion: true, supportsToolSelection: false, maxContextTokens: 16000 }), complete: async () => ({ result: 'PLAN_DRAFT', notificationWatch: { recipeKey: 'notification.shipment-watch.v1', sourcePackage, connectionId, trustedDeviceId: trustedId, lookbackHours: 168, notificationPolicy: 'EXCEPTION_ONLY' }, intentSummary: '京东物流异常提醒', explanation: '持续核实京东通知中的物流异常，并提供站内提醒；缺权限时等待恢复。', domain: 'daily_life', scenarioKey: 'daily_life.delivery', scenarioRevision: 2, strategyKey: 'SILENT_FOLLOW_UP', requiredFacts: ['shipment.status'], selectedTruthRefs: [], requiredCapabilities: ['app.notification.read'], selectedSkillIds: [], toolRequirements: [], draftDefinition: null, missingRequirements: [], warnings: [], riskHints: [] }) };
  function signed(path: string, body: unknown) { const requestId = randomBytes(32).toString('hex'), signedAt = new Date().toISOString(), payloadHash = hash(JSON.stringify(body)); return request(app.getHttpServer()).post('/api' + path).set(auth(owner.token)).set({ 'x-device-session': sessionId, 'x-device-request-id': requestId, 'x-device-signed-at': signedAt, 'x-device-payload-hash': payloadHash, 'x-device-signature': sign('sha256', Buffer.from(`lazy-armor-device-request-v1|${sessionId}|${requestId}|POST|${path}|${payloadHash}|${signedAt}`), keys.privateKey).toString('base64') }).send(body); }
  async function manifest(permission: 'GRANTED' | 'DENIED') { await signed('/consumer/local-capabilities', { manifestVersion: 'android-local-v4', capabilities: LOCAL_CAPABILITY_CATALOG.map(s => ({ key: s.key, userGrant: s.key === 'notification.read', systemPermission: s.key === 'notification.read' ? permission : 'UNKNOWN', health: 'HEALTHY', checkedAt: Date.now() })) }).expect(201); await signed('/device-tasks/heartbeat', { onlineState: 'online' }).expect(201); }
  async function createPlan() {
    const c = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN' }).expect(201)).body;
    const r = (await request(app.getHttpServer()).post(`/api/conversations/${c.id}/messages`).set(auth(owner.token)).send({ version: c.version, requestId: randomUUID(), content: '以后有京东快递异常时提醒我' }).expect(201)).body;
    expect(r.messages.at(-1).structuredPayload).toMatchObject({ result: 'PLAN_DRAFT', validationErrors: [] });
    const gaps=(await request(app.getHttpServer()).get(`/api/creation-drafts/${r.creationDraft.draftId}/gaps`).set(auth(owner.token)).expect(200)).body;
    expect(gaps.sourceResolutionState).toBe('RESOLVED');
    expect(gaps.sourceOptions.some((source:any)=>source.sourceId==='device-app:'+connectionId&&source.selected)).toBe(true);
    const confirmed = (await request(app.getHttpServer()).post(`/api/conversations/${c.id}/confirm-plan`).set(auth(owner.token)).send({ version: r.version, confirmed: true }).expect(201)).body;
    await activatePlan(app, owner.token, confirmed.planId);
    const plan = (await request(app.getHttpServer()).get('/api/plans/' + confirmed.planId).set(auth(owner.token)).expect(200)).body;
    return { id: confirmed.planId, versionId: plan.activeVersionId };
  }
  async function tasks(versionId: string) { const [rows] = await pool.query<RowDataPacket[]>("SELECT BIN_TO_UUID(id) id,status,result_json result,payload_json payload FROM device_tasks WHERE user_id=UUID_TO_BIN(?) AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.planNotificationRead.planVersionId'))=? ORDER BY created_at DESC", [owner.userId, versionId]); return rows; }
  async function complete(versionId: string, status?: string, eventKey = status) {
    await plans.resume(owner.userId, versionId);
    const row = (await tasks(versionId))[0];
    const task = (await signed('/device-tasks/' + row.id + '/claim', {}).expect(201)).body;
    const items = status ? [{ eventId: hash(versionId + ':' + eventKey), contentHash: hash('real-fixture:' + eventKey), sourcePackage, postedAt: Date.now() - 5000, capturedAt: Date.now(), hasTitle: true, hasText: true, candidateKind: 'shipment_candidate', candidateResource: 'shipment', candidateConfidence: 75, amountMinor: null, currency: null, candidateStatus: status, parserVersion: 'generic-notification-v1', status: 'received_unclassified' }] : [];
    const contentJson = JSON.stringify(items), result = { manifestVersion: 'android-local-v1', capability: 'notification.read', state: items.length ? 'VERIFIED_PRESENT' : 'VERIFIED_EMPTY', observedAt: Date.now(), scopeStart: task.payload.scopeStart, scopeEnd: task.payload.scopeEnd, itemCount: items.length, items, contentJson, contentHash: hash(contentJson) };
    const body = { claimToken: task.claimToken, result };
    await signed('/device-tasks/' + task.id + '/complete', body).expect(201);
    await signed('/device-tasks/' + task.id + '/complete', body).expect(201);
    await plans.resume(owner.userId, versionId);
    if (!status) return { task };
    const pending = (await request(app.getHttpServer()).get('/api/device-app-connections/notification-receipts').set(auth(owner.token)).expect(200)).body;
    const [receiptRows] = await pool.query<RowDataPacket[]>('SELECT BIN_TO_UUID(id) id FROM mobile_notification_receipts WHERE user_id=UUID_TO_BIN(?) AND device_app_connection_id=UUID_TO_BIN(?) AND event_id=?', [owner.userId, connectionId, items[0].eventId]);
    const receipt = pending.find((r: any) => r.id === receiptRows[0]?.id);
    expect(receipt).toBeDefined();
    const verified = (await request(app.getHttpServer()).post(`/api/device-app-connections/${connectionId}/notification-receipts/${receipt.id}/verify`).set(auth(owner.token)).send({ confirmed: true }).expect(201)).body;
    return { task, truthId: verified.truthRecord.id };
  }
  beforeAll(async () => {
    ({ app, pool, worker } = await bootP2App(unique, [{ token: AGENT_MODEL, value: model }]));
    plans = app.get(PersistentNotificationPlanService); owner = await register(app, unique + '@example.com', 'Notification owner'); other = await register(app, unique + '-other@example.com', 'Other');
    await setPlusMembership(app,owner.userId);
    const publicKeySpki = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const challenge = (await request(app.getHttpServer()).post('/api/trusted-devices/challenges').set(auth(owner.token)).send({ deviceId, keyId: unique, publicKeySpki, publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('hex') }).expect(201)).body;
    const device = (await request(app.getHttpServer()).post(`/api/trusted-devices/challenges/${challenge.challengeId}/verify`).set(auth(owner.token)).send({ signature: sign('sha256', Buffer.from(challenge.payload), keys.privateKey).toString('base64') }).expect(201)).body;
    trustedId = device.id; sessionId = device.deviceSession.id;
    connectionId = (await signed('/device-app-connections', { trustedDeviceId: trustedId, deviceId, packageName: sourcePackage, displayName: 'JD signed protocol fixture', launchable: true, discoveryFingerprint: hash(unique), modes: ['open_app', 'notification_read'] }).expect(201)).body.id;
  });
  afterAll(async () => { await pool?.end(); await app?.close(); });
  it('confirms a source-bound immutable Plan while denied, and resumes the same version once after grant', async () => {
    await manifest('DENIED'); const plan = await createPlan();
    await plans.resume(owner.userId, plan.versionId); expect(await tasks(plan.versionId)).toHaveLength(0);
    await request(app.getHttpServer()).get('/api/plans/' + plan.id).set(auth(other.token)).expect(404);
    await manifest('GRANTED'); await Promise.all([plans.resume(owner.userId, plan.versionId), plans.resume(owner.userId, plan.versionId)]);
    expect(await tasks(plan.versionId)).toHaveLength(1);
    await complete(plan.versionId); await plans.recover(owner.userId); await plans.recover(owner.userId);
    expect(await tasks(plan.versionId)).toHaveLength(1);
    const [versions] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM plan_versions WHERE plan_id=UUID_TO_BIN(?)', [plan.id]); expect(Number(versions[0].n)).toBe(1);
    const [ledger] = await pool.query<RowDataPacket[]>('SELECT capability_id capability,verification_state verification FROM capability_invocations i INNER JOIN runtime_results r ON r.invocation_id=i.id WHERE i.plan_version_id=UUID_TO_BIN(?)', [plan.versionId]); expect(ledger).toMatchObject([{ capability: 'app.notification.read', verification: 'VERIFIED' }]);
    const [wait] = await pool.query<RowDataPacket[]>("SELECT after_snapshot_json snapshot FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND resource_id=? AND action='PERSISTENT_NOTIFICATION_RESOURCE_STATE' ORDER BY created_at DESC LIMIT 1", [owner.userId, plan.versionId]); expect(wait[0].snapshot).toMatchObject({ state: 'WAITING_FACT_CHANGE', acquisitionState: 'VERIFIED_EMPTY', nextBestAction: 'WAIT' });
  });
  it('fences an old read epoch, keeps its terminal history, and starts only a bounded new read', async () => {
    await manifest('GRANTED'); const plan = await createPlan(); await plans.resume(owner.userId, plan.versionId);
    const old = (await tasks(plan.versionId))[0]; const claim = (await signed('/device-tasks/' + old.id + '/claim', {}).expect(201)).body;
    await manifest('DENIED'); await plans.resume(owner.userId, plan.versionId); await manifest('GRANTED');
    await plans.resume(owner.userId, plan.versionId); await plans.resume(owner.userId, plan.versionId);
    const rows = await tasks(plan.versionId); expect(rows).toHaveLength(2); expect(rows.find(r => r.id === old.id)).toMatchObject({ status: 'FAILED', result: null });
    await signed('/device-tasks/' + old.id + '/heartbeat', { claimToken: claim.claimToken }).expect(409);
    await complete(plan.versionId);
    const versions = (await request(app.getHttpServer()).get('/api/plans/' + plan.id + '/versions').set(auth(owner.token)).expect(200)).body; expect(versions).toHaveLength(1);
  });
  it('keeps an empty read immutable and acquires distinct later exception Truth in existing worker windows', async () => {
    await manifest('GRANTED'); const plan = await createPlan(); const empty = await complete(plan.versionId);
    const baseline = (await tasks(plan.versionId))[0];
    await plans.recover(owner.userId); await plans.recover(owner.userId); expect(await tasks(plan.versionId)).toHaveLength(1);
    // Clock-only protocol fixture, not phone evidence. Existing worker windows
    // acquire later notifications; no production Task/Result/Truth is injected.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const eventKey of ['exception-first', 'exception-second']) {
        vi.setSystemTime((Math.floor(Date.now() / 300_000) + 1) * 300_000 + 1000);
        await manifest('GRANTED');
        await Promise.all([plans.resume(owner.userId, plan.versionId), plans.resume(owner.userId, plan.versionId)]);
        const read = await complete(plan.versionId, 'EXCEPTION', eventKey);
        // Receipt verification returns a record identity; select the pending
        // occurrence for that exact Plan, never recreate the Plan or its version.
        const pendingWakeups = (await app.get(StrategyRuntimeService).listWakeups(owner.userId)).filter(r => r.wakeup.planVersionId === plan.versionId && r.wakeup.handoffStatus === 'PENDING');
        expect(pendingWakeups).toHaveLength(1);
        const handoff = await app.get(TerminalHandoffService).handoff(owner.userId, pendingWakeups[0].wakeup.id); expect(handoff.status).toBe('DISPATCHED');
        await worker.processExecution(handoff.executionId!); await plans.continueLocalResults(owner.userId); await plans.continueLocalResults(owner.userId);
        const [run] = await pool.query<RowDataPacket[]>('SELECT status FROM executions WHERE id=UUID_TO_BIN(?)', [handoff.executionId]); expect(run[0].status).toBe('succeeded');
        const [wait] = await pool.query<RowDataPacket[]>("SELECT after_snapshot_json snapshot FROM audit_logs WHERE action='PERSISTENT_NOTIFICATION_RESULT_REEVALUATED' AND resource_id=?", [handoff.executionId]); expect(wait).toHaveLength(1); expect(wait[0].snapshot).toMatchObject({ state: 'WAITING_FACT_CHANGE', nextBestAction: 'WAIT', planVersionId: plan.versionId });
        const [counts] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM notifications WHERE execution_id=UUID_TO_BIN(?) AND event_type='logistics_exception'", [handoff.executionId]); expect(Number(counts[0].n)).toBe(1);
        await app.get(TerminalHandoffService).handoff(owner.userId, pendingWakeups[0].wakeup.id); await plans.resume(owner.userId, plan.versionId);
        expect((await tasks(plan.versionId))[0].id).toBe(read.task.id);
      }
      const rows = await tasks(plan.versionId); expect(rows).toHaveLength(3);
      expect(rows.find(row => row.id === empty.task.id)).toEqual(baseline);
      expect(new Set(rows.map(row => row.payload.planNotificationRead.windowKey)).size).toBe(3);
      expect(rows.every(row => row.payload.planNotificationRead.attempt === 1)).toBe(true);
      const versions = (await request(app.getHttpServer()).get('/api/plans/' + plan.id + '/versions').set(auth(owner.token)).expect(200)).body; expect(versions).toHaveLength(1);
      await request(app.getHttpServer()).post(`/api/plans/${plan.id}/executions`).set(auth(owner.token)).send({ requestId: randomUUID(), triggerPayload: { hydratedFactValue: { status: 'exception' } } }).expect(409);
    } finally { vi.useRealTimers(); }
  });
  it('keeps normal notification Truth separate and does not remind or dispatch an exception', async () => {
    await manifest('GRANTED'); const plan = await createPlan(); await complete(plan.versionId, 'IN_TRANSIT');
    const wakeups = (await app.get(StrategyRuntimeService).listWakeups(owner.userId)).filter(r => r.wakeup.planVersionId === plan.versionId); expect(wakeups).toHaveLength(1);
    const handoff = await app.get(TerminalHandoffService).handoff(owner.userId, wakeups[0].wakeup.id); expect(handoff.status).toBe('QUIET');
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM executions WHERE plan_id=UUID_TO_BIN(?)', [plan.id]); expect(Number(rows[0].n)).toBe(0);
  });
});
