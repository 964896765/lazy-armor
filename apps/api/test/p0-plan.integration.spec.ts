import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createPool, type Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Session { token: string; userId: string }

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const definition = (amount = 150) => ({
  name: '话费守护',
  description: 'Canonical Demo Plan',
  domain: 'billing',
  automationLevel: 'L1',
  sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
  conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: amount, sortOrder: 0 }],
  actions: [{ actionType: 'notify', config: { channel: 'in_app' }, stepOrder: 0 }],
});

describe.sequential('P0-4 Plan Engine Core integration', () => {
  let app: INestApplication;
  let pool: Pool;
  let userA: Session;
  let userB: Session;
  let planId: string;
  let version1Hash: string;
  let version2Hash: string;
  let activeVersion1Id: string;
  let internalConnectionId: string;
  let userBConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 8).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-plan-credentials-${unique}`;
    const { AppModule } = await import('../dist/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });
    userA = await register(`plan-a-${unique}@example.com`, '计划用户 A');
    userB = await register(`plan-b-${unique}@example.com`, '计划用户 B');
    userBConnectionId = await createConnection(userB.token, 'internal', '用户 B 内部连接');
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'correct-horse-battery-staple', displayName }).expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(response.body.accessToken)).expect(200);
    return { token: response.body.accessToken as string, userId: me.body.id as string };
  }

  async function createConnection(token: string, connectorId: string, externalAccountName: string, expiresAt?: string) {
    const response = await request(app.getHttpServer()).post('/api/connections').set(auth(token)).send({ connectorId, externalAccountName, expiresAt }).expect(201);
    return response.body.id as string;
  }

  it('1 creates a Plan in draft with no active version', async () => {
    const response = await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send(definition()).expect(201);
    planId = response.body.id;
    expect(response.body).toMatchObject({ status: 'draft', activeVersionId: null, currentVersion: { versionNumber: 1, name: '话费守护' } });
  });

  it('2 automatically creates Version 1', async () => {
    const versions = await request(app.getHttpServer()).get(`/api/plans/${planId}/versions`).set(auth(userA.token)).expect(200);
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0].versionNumber).toBe(1);
  });

  it('3 reads the owned Plan summary', async () => {
    const response = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userA.token)).expect(200);
    expect(response.body.id).toBe(planId);
  });

  it('4 reads a complete, normalized PlanDefinition with derived risk', async () => {
    const response = await request(app.getHttpServer()).get(`/api/plans/${planId}/versions/1`).set(auth(userA.token)).expect(200);
    expect(response.body.definition).toMatchObject({ schemaVersion: '1.0', name: '话费守护', actions: [{ actionType: 'notify', riskLevel: 'R1' }] });
    expect(response.body.definition.conditions[0].comparisonValue).toBe(150);
    expect(response.body.computedHash).toBe(response.body.definitionHash);
    version1Hash = response.body.definitionHash;
  });

  it('5 moves draft to ready, applies V1, then activates without executing it', async () => {
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(userA.token)).send({ status: 'ready' }).expect(201);
    const applied = await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(userA.token)).expect(201);
    activeVersion1Id = applied.body.activeVersionId;
    expect(applied.body.status).toBe('ready');
    const activated = await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(userA.token)).send({ status: 'active' }).expect(201);
    expect(activated.body.status).toBe('active');
  });

  it('6 creates V2 for the changed rule', async () => {
    const created = await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(definition(200)).expect(201);
    expect(created.body.versionNumber).toBe(2);
    version2Hash = created.body.definitionHash;
  });

  it('7 preserves V1 after V2 is created', async () => {
    const v1 = await request(app.getHttpServer()).get(`/api/plans/${planId}/versions/1`).set(auth(userA.token)).expect(200);
    expect(v1.body.definition.conditions[0].comparisonValue).toBe(150);
  });

  it('8 advances current to V2 while active remains V1', async () => {
    const plan = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userA.token)).expect(200);
    expect(plan.body.currentVersion.versionNumber).toBe(2);
    expect(plan.body.activeVersionId).toBe(activeVersion1Id);
  });

  it('9 applies V2 explicitly and changes only the active pointer', async () => {
    const response = await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/2/apply`).set(auth(userA.token)).expect(201);
    expect(response.body.activeVersion.versionNumber).toBe(2);
    expect(response.body.currentVersion.versionNumber).toBe(2);
  });

  it('10 rejects applying a nonexistent version', async () => {
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/999/apply`).set(auth(userA.token)).expect(404);
  });

  it('11 prevents User B from reading User A Plan', async () => {
    await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userB.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(userB.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(userB.token)).send({ status: 'archived' }).expect(404);
  });

  it('12 prevents User B from reading User A Version', async () => {
    await request(app.getHttpServer()).get(`/api/plans/${planId}/versions/1`).set(auth(userB.token)).expect(404);
  });

  it('13 prevents User A from referencing User B Connection and rolls back Plan creation', async () => {
    const before = await request(app.getHttpServer()).get('/api/plans').set(auth(userA.token)).expect(200);
    const invalid = definition();
    invalid.actions = [{ ...invalid.actions[0], actionType: 'update_internal_record', connectionId: userBConnectionId, requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'bill' } }] as never;
    await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send(invalid).expect(400);
    const after = await request(app.getHttpServer()).get('/api/plans').set(auth(userA.token)).expect(200);
    expect(after.body).toHaveLength(before.body.length);
  });

  it.each([
    ['14 invalid Source Type', 'sources', [{ sourceType: 'script', config: {}, sortOrder: 0 }]],
    ['15 invalid Trigger Type', 'triggers', [{ triggerType: 'daemon', config: {}, sortOrder: 0 }]],
    ['16 invalid Condition Operator', 'conditions', [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'EVAL', comparisonValue: 1, sortOrder: 0 }]],
    ['17 invalid Action Type', 'actions', [{ actionType: 'shell', config: {}, stepOrder: 0 }]],
  ])('%s is rejected', async (_label, field, value) => {
    await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send({ ...definition(), [field]: value }).expect(400);
  });

  it('18 rejects a capability that does not belong to the referenced connector', async () => {
    internalConnectionId = await createConnection(userA.token, 'internal', 'Plan 内部连接');
    const invalid = definition();
    invalid.actions = [{ actionType: 'update_internal_record', connectionId: internalConnectionId, requiredCapability: 'NOT_A_CAPABILITY', config: { recordType: 'bill' }, stepOrder: 0 }] as never;
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(invalid).expect(400);
  });

  it('19 rejects a revoked Connection', async () => {
    const connectionId = await createConnection(userA.token, 'internal', '即将撤销');
    await request(app.getHttpServer()).delete(`/api/connections/${connectionId}`).set(auth(userA.token)).expect(204);
    const invalid = definition();
    invalid.actions = [{ actionType: 'update_internal_record', connectionId, requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'bill' }, stepOrder: 0 }] as never;
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(invalid).expect(400);
  });

  it('20 rejects an expired Connection', async () => {
    const connectionId = await createConnection(userA.token, 'internal', '即将过期', new Date(Date.now() + 500).toISOString());
    await new Promise((resolve) => setTimeout(resolve, 700));
    const invalid = definition();
    invalid.actions = [{ actionType: 'update_internal_record', connectionId, requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'bill' }, stepOrder: 0 }] as never;
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(invalid).expect(400);
  });

  it('21 rejects an illegal draft to active state transition', async () => {
    const created = await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send({ ...definition(), name: '非法跳转测试' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(userA.token)).send({ status: 'active' }).expect(400);
  });

  it('22 exposes no endpoint for deleting a formal Version', async () => {
    await request(app.getHttpServer()).delete(`/api/plans/${planId}/versions/1`).set(auth(userA.token)).expect(404);
  });

  it('23 produces a stable hash for equal Definitions', async () => {
    const v3 = await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(definition(200)).expect(201);
    expect(v3.body.definitionHash).toBe(version2Hash);
  });

  it('24 changes the hash when the Definition changes', () => {
    expect(version2Hash).not.toBe(version1Hash);
  });

  it('25 rolls back the complete Version transaction on reference validation failure', async () => {
    const beforePlan = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userA.token)).expect(200);
    const beforeVersions = await request(app.getHttpServer()).get(`/api/plans/${planId}/versions`).set(auth(userA.token)).expect(200);
    const invalid = definition(300);
    invalid.actions = [{ actionType: 'update_internal_record', connectionId: userBConnectionId, requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'bill' }, stepOrder: 0 }] as never;
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(invalid).expect(400);
    const afterPlan = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userA.token)).expect(200);
    const afterVersions = await request(app.getHttpServer()).get(`/api/plans/${planId}/versions`).set(auth(userA.token)).expect(200);
    expect(afterVersions.body).toHaveLength(beforeVersions.body.length);
    expect(afterPlan.body.currentVersionId).toBe(beforePlan.body.currentVersionId);
  });

  it('26 rolls back Apply when a stored Version reference becomes revoked', async () => {
    const connectionId = await createConnection(userA.token, 'internal', 'Apply 前撤销');
    const withConnection = definition(400);
    withConnection.actions = [{ actionType: 'update_internal_record', connectionId, requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'bill' }, stepOrder: 0 }] as never;
    const v4 = await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(userA.token)).send(withConnection).expect(201);
    const before = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userA.token)).expect(200);
    await request(app.getHttpServer()).delete(`/api/connections/${connectionId}`).set(auth(userA.token)).expect(204);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/${v4.body.versionNumber}/apply`).set(auth(userA.token)).expect(400);
    const after = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(userA.token)).expect(200);
    expect(after.body.activeVersionId).toBe(before.body.activeVersionId);
  });

  it('27 has the forward migration and all immutable-version triggers installed', async () => {
    const [migrations] = await pool.query<Array<{ id: number }>>('SELECT id FROM __drizzle_migrations ORDER BY id');
    const [triggers] = await pool.query<Array<{ TRIGGER_NAME: string }>>("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE LIKE 'plan%'");
    expect(migrations.map((row) => row.id)).toContain(2);
    expect(triggers).toHaveLength(10);
  });

  it('28 rejects direct UPDATE and DELETE against an immutable PlanVersion', async () => {
    await expect(pool.query('UPDATE plan_versions SET name = ? WHERE plan_id = UUID_TO_BIN(?) AND version_number = 1', ['篡改', planId])).rejects.toThrow(/immutable/);
    await expect(pool.query('DELETE FROM plan_versions WHERE plan_id = UUID_TO_BIN(?) AND version_number = 1', [planId])).rejects.toThrow(/cannot be deleted/);
  });
});
