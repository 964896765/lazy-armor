import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { activatePlan, auth, bootP2App, dispatchPlan, register, type Session } from './p2-test-helpers';

describe.sequential('P3 reusable Vehicle and Digital Account profiles', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let other: Session;
  let vehicleId: string;
  let digitalAccountId: string;
  let housingRecurringItemId: string;
  let workRecurringItemId: string;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p3-profiles-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p3-profile-${unique}@example.com`, 'P3 Profile');
    other = await register(app, `p3-profile-other-${unique}@example.com`, 'P3 Other');
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('supports a no-vehicle-API user and an auditable monotonic manual mileage update', async () => {
    const created = await request(app.getHttpServer()).post('/api/vehicle-profiles').set(auth(user.token)).send({
      brand: '比亚迪', model: '海豚', year: 2024, purchasedAt: '2024-03-01T00:00:00.000Z', mileageKm: 12000,
      insuranceExpiresAt: '2027-03-01T00:00:00.000Z', inspectionDueAt: '2030-03-01T00:00:00.000Z',
      maintenanceMileageKm: 15000, tireInstalledAt: '2024-03-01T00:00:00.000Z', batteryInstalledAt: '2024-03-01T00:00:00.000Z',
    }).expect(201);
    vehicleId = created.body.id as string;
    expect(created.body).toMatchObject({ sourceType: 'manual', mileageKm: 12000 });
    const updated = await request(app.getHttpServer()).patch(`/api/vehicle-profiles/${vehicleId}/mileage`).set(auth(user.token)).send({ mileageKm: 13500 }).expect(200);
    expect(updated.body.mileageKm).toBe(13500);
    await request(app.getHttpServer()).patch(`/api/vehicle-profiles/${vehicleId}/mileage`).set(auth(user.token)).send({ mileageKm: 13000 }).expect(400);
    await request(app.getHttpServer()).patch(`/api/vehicle-profiles/${vehicleId}/mileage`).set(auth(other.token)).send({ mileageKm: 14000 }).expect(404);
    expect((await request(app.getHttpServer()).get('/api/vehicle-profiles').set(auth(other.token)).expect(200)).body).toEqual([]);
  });

  it('stores only lightweight digital-account facts and rejects password-shaped extra input', async () => {
    const payload = {
      serviceName: '视频会员', subscriptionStatus: 'active', expiresAt: '2027-01-01T00:00:00.000Z',
      connectionStatus: 'none', securityReminderAt: '2026-12-20T00:00:00.000Z', backupStatus: 'not_configured',
    };
    await request(app.getHttpServer()).post('/api/digital-account-profiles').set(auth(user.token)).send({ ...payload, password: 'must-never-store' }).expect(400);
    const created = await request(app.getHttpServer()).post('/api/digital-account-profiles').set(auth(user.token)).send(payload).expect(201);
    digitalAccountId = created.body.id as string;
    expect(JSON.stringify(created.body)).not.toMatch(/password|secret|credential/i);
    expect((await request(app.getHttpServer()).get('/api/digital-account-profiles').set(auth(other.token)).expect(200)).body).toEqual([]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT metadata_json metadataJson FROM digital_account_profiles WHERE id=UUID_TO_BIN(?)', [created.body.id]);
    expect(rows[0].metadataJson).toBeNull();
    const [audit] = await pool.query<RowDataPacket[]>("SELECT after_snapshot_json snapshot FROM audit_logs WHERE action='DIGITAL_ACCOUNT_PROFILE_CREATED' AND resource_id=?", [created.body.id]);
    expect(JSON.stringify(audit)).not.toContain('must-never-store');
  });

  it('uses one recurring-item profile for life, housing and work follow-ups', async () => {
    const housing = await request(app.getHttpServer()).post('/api/recurring-item-profiles').set(auth(user.token)).send({
      domain: 'housing', category: '房租', title: '支付下月房租', nextDueAt: '2027-01-05T09:00:00.000Z', recurrenceDays: 30, remindBeforeDays: 7,
    }).expect(201);
    housingRecurringItemId = housing.body.id as string;
    const work = await request(app.getHttpServer()).post('/api/recurring-item-profiles').set(auth(user.token)).send({
      domain: 'work', category: '客户跟进', title: '确认方案反馈', nextDueAt: '2027-01-02T09:00:00.000Z', recurrenceDays: 7, remindBeforeDays: 2,
    }).expect(201);
    workRecurringItemId = work.body.id as string;
    expect((await request(app.getHttpServer()).get('/api/recurring-item-profiles').set(auth(other.token)).expect(200)).body).toEqual([]);

    const completed = await request(app.getHttpServer()).post(`/api/recurring-item-profiles/${workRecurringItemId}/complete`).set(auth(user.token)).send({
      completedAt: '2027-01-03T09:00:00.000Z',
    }).expect(201);
    expect(completed.body).toMatchObject({ status: 'active', recurrenceDays: 7 });
    expect(new Date(completed.body.nextDueAt).toISOString()).toBe('2027-01-09T09:00:00.000Z');
    const [audit] = await pool.query<RowDataPacket[]>("SELECT action FROM audit_logs WHERE resource_id=? AND action IN ('RECURRING_ITEM_PROFILE_CREATED','RECURRING_ITEM_COMPLETED') ORDER BY created_at", [workRecurringItemId]);
    expect(audit.map((row) => row.action)).toEqual(['RECURRING_ITEM_PROFILE_CREATED', 'RECURRING_ITEM_COMPLETED']);
  });

  it('drives reusable Plan Engine templates from both profiles without a domain-specific worker', async () => {
    for (const template of [
      { key: 'vehicle-care-reminder', config: { profileId: vehicleId, reminderTime: '09:00', remindBeforeDays: 30, mileageBufferKm: 500, notificationPreference: 'summary' } },
      { key: 'digital-subscription-reminder', config: { profileId: digitalAccountId, reminderTime: '09:00', remindBeforeDays: 14, notificationPreference: 'summary' } },
    ]) {
      const installed = await request(app.getHttpServer()).post(`/api/templates/${template.key}/install`).set(auth(user.token)).send({ config: template.config }).expect(201);
      await activatePlan(app, user.token, installed.body.id);
      const execution = await dispatchPlan(app, worker, user.token, installed.body.id, { referenceDate: '2026-12-20T08:00:00.000Z' });
      expect(execution.body.status).toBe('succeeded');
    }
    const [tables] = await pool.query<RowDataPacket[]>("SELECT table_name tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('vehicle_profiles','digital_account_profiles') ORDER BY table_name");
    expect(tables.map((row) => row.tableName)).toEqual(['digital_account_profiles', 'vehicle_profiles']);
  });

  it('drives housing-cycle and work-follow-up plans through the same recurring profile model', async () => {
    for (const template of [
      { key: 'recurring-life-reminder', profileId: housingRecurringItemId, referenceDate: '2027-01-01T09:00:00.000Z' },
      { key: 'work-follow-up-reminder', profileId: workRecurringItemId, referenceDate: '2027-01-08T09:00:00.000Z' },
    ]) {
      const installed = await request(app.getHttpServer()).post(`/api/templates/${template.key}/install`).set(auth(user.token)).send({
        config: { profileId: template.profileId, reminderTime: '09:00', notificationPreference: 'summary' },
      }).expect(201);
      await activatePlan(app, user.token, installed.body.id);
      const execution = await dispatchPlan(app, worker, user.token, installed.body.id, { referenceDate: template.referenceDate });
      expect(execution.body.status).toBe('succeeded');
      expect(execution.body.outputs.some((item: { actionType: string; output: { shouldNotify?: boolean } }) => item.actionType === 'summarize' && item.output.shouldNotify === true)).toBe(true);
    }
    const [operations] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) count FROM side_effect_operations seo JOIN executions e ON e.id=seo.execution_id WHERE e.user_id=UUID_TO_BIN(?)", [user.userId]);
    expect(Number(operations[0].count)).toBe(0);
  });
});
