import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntitlementService } from '../src/membership/entitlement.service';
import { SECURITY_CAPABILITIES } from '../src/membership/entitlement-catalog';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const definition = (name: string) => ({
  name,
  description: 'P5 entitlement limit fixture',
  domain: 'life',
  automationLevel: 'L1',
  sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
  conditions: [],
  actions: [{ actionType: 'notify', config: { channel: 'in_app' }, stepOrder: 0 }],
});

describe.sequential('P5-A membership and entitlement', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let entitlements: EntitlementService;
  let userA: Session;
  let userB: Session;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);

  beforeAll(async () => {
    const booted = await bootP2App('p5-membership-' + unique);
    app = booted.app;
    pool = booted.pool;
    entitlements = app.get(EntitlementService);
    userA = await register(app, 'p5-membership-a-' + unique + '@example.com', 'P5 Member A');
    userB = await register(app, 'p5-membership-b-' + unique + '@example.com', 'P5 Member B');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('creates new users on Free and exposes the centralized entitlement catalog', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/me/membership')
      .set(auth(userA.token))
      .expect(200);
    expect(response.body).toMatchObject({
      membership: {
        planKey: 'free',
        effectivePlanKey: 'free',
        name: '免费版',
        status: 'active',
      },
      capabilities: {
        advanced_ai: false,
        premium_connector: false,
        advanced_summary: false,
        premium_template: false,
      },
      limits: {
        max_active_plans: 3,
        max_total_plans: 30,
        history_retention_days: 30,
      },
      usage: { activePlans: 0, totalPlans: 0 },
      upgrade: { available: false, mode: 'coming_soon' },
    });
  });

  it('supports internal Plus upgrade, downgrade, and expired fallback without a payment provider', async () => {
    const plus = await entitlements.setForInternalFixture(userA.userId, 'plus', 'active');
    expect(plus).toMatchObject({
      membership: { planKey: 'plus', effectivePlanKey: 'plus', name: 'Plus' },
      capabilities: { advanced_ai: true, premium_connector: true },
      limits: { max_active_plans: 100, history_retention_days: 365 },
    });

    const downgraded = await entitlements.setForInternalFixture(userA.userId, 'free', 'active');
    expect(downgraded.membership.effectivePlanKey).toBe('free');

    const expired = await entitlements.setForInternalFixture(
      userA.userId,
      'plus',
      'expired',
      new Date(Date.now() - 60_000),
    );
    expect(expired).toMatchObject({
      membership: { planKey: 'plus', effectivePlanKey: 'free', status: 'expired' },
      capabilities: { advanced_ai: false },
      limits: { max_active_plans: 3 },
    });
    await entitlements.setForInternalFixture(userA.userId, 'free', 'active');
  });

  it('enforces the Free active Plan limit without deleting plans or changing PlanVersion history', async () => {
    for (let index = 1; index <= 3; index += 1) {
      const plan = await createPlan(userA, 'Free Active ' + index);
      await activatePlan(userA, plan.id);
    }
    const blocked = await createPlan(userA, 'Free Blocked Fourth');
    await request(app.getHttpServer())
      .post('/api/plans/' + blocked.id + '/status')
      .set(auth(userA.token))
      .send({ status: 'ready' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/plans/' + blocked.id + '/versions/1/apply')
      .set(auth(userA.token))
      .expect(201);
    const rejected = await request(app.getHttpServer())
      .post('/api/plans/' + blocked.id + '/status')
      .set(auth(userA.token))
      .send({ status: 'active' })
      .expect(403);
    expect(rejected.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      message: '免费版最多可以同时启用 3 个计划。',
    });
    const preserved = await request(app.getHttpServer())
      .get('/api/plans/' + blocked.id)
      .set(auth(userA.token))
      .expect(200);
    expect(preserved.body.status).toBe('ready');
    const versions = await request(app.getHttpServer())
      .get('/api/plans/' + blocked.id + '/versions')
      .set(auth(userA.token))
      .expect(200);
    expect(versions.body).toHaveLength(1);
  });

  it('never puts permission revoke, disconnect, or other safety capabilities behind entitlement', async () => {
    for (const capability of SECURITY_CAPABILITIES) {
      await expect(entitlements.can(userA.userId, capability)).resolves.toBe(true);
      await expect(entitlements.assertAllowed(userA.userId, capability)).resolves.toBeUndefined();
    }

    const connection = await request(app.getHttpServer())
      .post('/api/connections')
      .set(auth(userA.token))
      .send({ connectorId: 'internal', externalAccountName: 'p5-security-' + unique })
      .expect(201);
    await request(app.getHttpServer())
      .put('/api/connections/' + connection.body.id + '/permissions')
      .set(auth(userA.token))
      .send({ permissions: [{ capability: 'WRITE_INTERNAL', granted: false }] })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/connections/' + connection.body.id)
      .set(auth(userA.token))
      .expect(204);
  });

  it('allows Plus to activate beyond the Free limit and downgrade never mutates existing plans', async () => {
    await entitlements.setForInternalFixture(userA.userId, 'plus', 'active');
    const plansBefore = await request(app.getHttpServer()).get('/api/plans').set(auth(userA.token)).expect(200);
    const fourth = plansBefore.body.find((item: { status: string }) => item.status === 'ready');
    expect(fourth).toBeTruthy();
    await request(app.getHttpServer())
      .post('/api/plans/' + fourth.id + '/status')
      .set(auth(userA.token))
      .send({ status: 'active' })
      .expect(201);

    const afterUpgrade = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(afterUpgrade.body.usage.activePlans).toBe(4);

    await entitlements.setForInternalFixture(userA.userId, 'free', 'active');
    const afterDowngrade = await request(app.getHttpServer()).get('/api/plans').set(auth(userA.token)).expect(200);
    expect(afterDowngrade.body.filter((item: { status: string }) => item.status === 'active')).toHaveLength(4);
  });

  it('isolates membership and Plan usage between users', async () => {
    const userBMembership = await request(app.getHttpServer())
      .get('/api/me/membership')
      .set(auth(userB.token))
      .expect(200);
    expect(userBMembership.body).toMatchObject({
      membership: { planKey: 'free', effectivePlanKey: 'free' },
      usage: { activePlans: 0, totalPlans: 0 },
    });
    const userBPlans = await request(app.getHttpServer()).get('/api/plans').set(auth(userB.token)).expect(200);
    expect(userBPlans.body).toEqual([]);
  });

  it('serializes concurrent activation so the Free limit cannot be raced', async () => {
    const userC = await register(app, 'p5-membership-c-' + unique + '@example.com', 'P5 Member C');
    const activeOne = await createPlan(userC, 'Concurrent Active 1');
    const activeTwo = await createPlan(userC, 'Concurrent Active 2');
    await activatePlan(userC, activeOne.id);
    await activatePlan(userC, activeTwo.id);
    const candidateA = await createReadyPlan(userC, 'Concurrent Candidate A');
    const candidateB = await createReadyPlan(userC, 'Concurrent Candidate B');

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/api/plans/' + candidateA.id + '/status').set(auth(userC.token)).send({ status: 'active' }),
      request(app.getHttpServer()).post('/api/plans/' + candidateB.id + '/status').set(auth(userC.token)).send({ status: 'active' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 403]);
    const membership = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userC.token)).expect(200);
    expect(membership.body.usage.activePlans).toBe(3);
  });

  async function createPlan(user: Session, name: string) {
    const response = await request(app.getHttpServer())
      .post('/api/plans')
      .set(auth(user.token))
      .send(definition(name))
      .expect(201);
    return response.body as { id: string };
  }

  async function createReadyPlan(user: Session, name: string) {
    const plan = await createPlan(user, name);
    await request(app.getHttpServer()).post('/api/plans/' + plan.id + '/status').set(auth(user.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post('/api/plans/' + plan.id + '/versions/1/apply').set(auth(user.token)).expect(201);
    return plan;
  }

  async function activatePlan(user: Session, planId: string) {
    await request(app.getHttpServer()).post('/api/plans/' + planId + '/status').set(auth(user.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post('/api/plans/' + planId + '/versions/1/apply').set(auth(user.token)).expect(201);
    await request(app.getHttpServer()).post('/api/plans/' + planId + '/status').set(auth(user.token)).send({ status: 'active' }).expect(201);
  }
});
