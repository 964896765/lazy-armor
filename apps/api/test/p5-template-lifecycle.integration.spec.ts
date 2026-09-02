import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P5-D template lifecycle overlay', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let admin: Session;
  let user: Session;
  let installedPlanId: string;
  let activeVersionId: string;
  const templateKey = 'monthly-bill-summary';
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const config = {
    planName: 'Lifecycle ' + unique,
    summaryDay: 3,
    sourceType: 'manual',
    billingPeriod: 'current_month',
    showCategories: true,
    showMonthOverMonth: true,
    anomalyThresholdPercent: 18,
    notificationPreference: 'summary',
  };

  beforeAll(async () => {
    const booted = await bootP2App('p5-template-lifecycle-' + unique);
    app = booted.app;
    pool = booted.pool;
    admin = await register(app, 'p5-template-admin-' + unique + '@example.com', 'Template Admin');
    user = await register(app, 'p5-template-user-' + unique + '@example.com', 'Template User');
    await pool.query("UPDATE users SET role='super_admin' WHERE id=UUID_TO_BIN(?)", [admin.userId]);
  });

  afterAll(async () => {
    await pool?.query(
      "UPDATE template_lifecycle_versions SET status='published', reason='test cleanup', updated_at=UTC_TIMESTAMP(6) WHERE template_key=? AND template_version='1'",
      [templateKey],
    );
    await pool?.end();
    await app?.close();
  });

  it('allows only administrators to mutate lifecycle and installs the published template', async () => {
    await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/lifecycle/suspend')
      .set(auth(user.token)).send({ reason: 'not allowed' }).expect(403);
    const installed = await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/install')
      .set(auth(user.token)).send({ config }).expect(201);
    installedPlanId = installed.body.id;
    await activatePlan(app, user.token, installedPlanId);
    activeVersionId = (await request(app.getHttpServer()).get('/api/plans/' + installedPlanId).set(auth(user.token)).expect(200)).body.activeVersionId;
  });

  it('suspends new discovery/install while retaining the installed Plan and immutable active version', async () => {
    await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/lifecycle/suspend')
      .set(auth(admin.token)).send({ reason: 'safety review' }).expect(201);
    const listed = await request(app.getHttpServer()).get('/api/templates').set(auth(user.token)).expect(200);
    expect(listed.body.map((item: { key: string }) => item.key)).not.toContain(templateKey);
    await request(app.getHttpServer()).get('/api/templates/' + templateKey).set(auth(user.token)).expect(404);
    await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/install')
      .set(auth(user.token)).send({ config }).expect(409);
    const historical = await request(app.getHttpServer()).get('/api/plans/' + installedPlanId).set(auth(user.token)).expect(200);
    expect(historical.body).toMatchObject({ id: installedPlanId, status: 'active', activeVersionId });
  });

  it('restores publication and creates only a new draft PlanVersion without replacing active history', async () => {
    await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/lifecycle/publish')
      .set(auth(admin.token)).send({ reason: 'review complete' }).expect(201);
    const updated = await request(app.getHttpServer()).post('/api/templates/plans/' + installedPlanId + '/version')
      .set(auth(user.token)).send({ config: { ...config, planName: 'Lifecycle v2 ' + unique } }).expect(201);
    expect(updated.body).toMatchObject({ versionNumber: 2 });
    const plan = await request(app.getHttpServer()).get('/api/plans/' + installedPlanId).set(auth(user.token)).expect(200);
    expect(plan.body.activeVersionId).toBe(activeVersionId);
    expect(plan.body.currentVersion.versionNumber).toBe(2);
    const original = await request(app.getHttpServer()).get('/api/plans/' + installedPlanId + '/versions/1').set(auth(user.token)).expect(200);
    expect(original.body.id).toBe(activeVersionId);
  });

  it('deprecates discovery/new install, then exercises draft-review-publish transitions', async () => {
    await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/lifecycle/deprecate')
      .set(auth(admin.token)).send({ reason: 'superseded' }).expect(201);
    const details = await request(app.getHttpServer()).get('/api/templates/' + templateKey).set(auth(user.token)).expect(200);
    expect(details.body.status).toBe('deprecated');
    const listed = await request(app.getHttpServer()).get('/api/templates').set(auth(user.token)).expect(200);
    expect(listed.body.map((item: { key: string }) => item.key)).not.toContain(templateKey);
    await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/install')
      .set(auth(user.token)).send({ config }).expect(409);

    await pool.query("UPDATE template_lifecycle_versions SET status='draft', updated_at=UTC_TIMESTAMP(6) WHERE template_key=? AND template_version='1'", [templateKey]);
    const review = await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/lifecycle/submit-review')
      .set(auth(admin.token)).send({ reason: 'candidate ready' }).expect(201);
    expect(review.body.status).toBe('review');
    const published = await request(app.getHttpServer()).post('/api/templates/' + templateKey + '/lifecycle/publish')
      .set(auth(admin.token)).send({ reason: 'approved' }).expect(201);
    expect(published.body.status).toBe('published');
  });

  it('records each formal lifecycle transition in Audit', async () => {
    const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) count FROM audit_logs WHERE action='TEMPLATE_LIFECYCLE_CHANGED' AND resource_id=? AND actor_user_id=UUID_TO_BIN(?)",
      [templateKey, admin.userId],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(5);
  });
});
