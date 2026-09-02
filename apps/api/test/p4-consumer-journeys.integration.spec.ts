import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, dispatchPlan, oauthConnect, register, type Session } from './p2-test-helpers';

interface TemplateListItem {
  key: string;
  group: string;
  name: string;
}

describe.sequential('P4 consumer journeys', { timeout: 90000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p4-journeys-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p4-journeys-${unique}@example.com`, 'P4 Consumer');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('Journey A installs device consumable reminder through the public template flow and reaches Today/Record', async () => {
    const templates = await request(app.getHttpServer())
      .get('/api/templates')
      .set(auth(user.token))
      .expect(200);
    expect(templates.body).toEqual(expect.arrayContaining([
      expect.objectContaining<Partial<TemplateListItem>>({
        key: 'device-consumable-reminder',
        group: '我的东西',
        name: '设备耗材提醒',
      }),
    ]));

    await request(app.getHttpServer())
      .get('/api/templates/device-consumable-reminder')
      .set(auth(user.token))
      .expect(200);

    const profile = await request(app.getHttpServer())
      .post('/api/device-profiles')
      .set(auth(user.token))
      .send({
        type: '净水器',
        brand: '小米',
        model: `P4-Pro-${unique}`,
        purchasedAt: '2027-01-01T00:00:00.000Z',
        warrantyUntil: '2029-01-01T00:00:00.000Z',
        maintenanceIntervalDays: 180,
        sourceType: 'manual',
      })
      .expect(201);

    const consumable = await request(app.getHttpServer())
      .post('/api/device-consumables')
      .set(auth(user.token))
      .send({
        deviceProfileId: profile.body.id,
        name: '前置滤芯',
        lastReplacedAt: '2027-05-01T00:00:00.000Z',
        replacementIntervalDays: 150,
        remindBeforeDays: 10,
      })
      .expect(201);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/device-consumable-reminder/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '净水器滤芯提醒',
          deviceProfileId: profile.body.id,
          consumableId: consumable.body.id,
          preparationMode: 'shopping_list',
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    const planId = installed.body.id as string;

    const draft = await request(app.getHttpServer())
      .get(`/api/plans/${planId}`)
      .set(auth(user.token))
      .expect(200);
    expect(draft.body).toMatchObject({
      status: 'draft',
      templateKey: 'device-consumable-reminder',
      hasMissingConnection: false,
    });

    await activatePlan(app, user.token, planId);

    const execution = await dispatchPlan(app, worker, user.token, planId, {
      referenceDate: '2027-09-18T08:00:00.000Z',
    });
    expect(execution.body).toMatchObject({
      status: 'succeeded',
      resultSummary: '前置滤芯预计 10 天后需要更换，已准备购买清单。',
    });

    const today = await request(app.getHttpServer())
      .get('/api/today')
      .set(auth(user.token))
      .expect(200);
    expect(today.body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: expect.stringContaining('前置滤芯'),
      }),
    ]));

    const records = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/executions`)
      .set(auth(user.token))
      .expect(200);
    expect(records.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: execution.body.id,
        planName: '净水器滤芯提醒',
        resultSummary: '前置滤芯预计 10 天后需要更换，已准备购买清单。',
      }),
    ]));

    const detail = await request(app.getHttpServer())
      .get(`/api/executions/${execution.body.id}`)
      .set(auth(user.token))
      .expect(200);
    expect(detail.body.outputs.some((item: { actionType: string }) => item.actionType === 'prepare_purchase')).toBe(true);
  });

  it('Journey B keeps draft safe before connection, resolves OAuth bindings into a new version, then surfaces revoke failure in Today/Record', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/daily-important-summary/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: `每日重点-${unique}`,
          summaryTime: '07:30',
          includedSources: ['email', 'calendar'],
          lookAheadHours: 24,
          includeCalendar: true,
          includeMessages: true,
          maxItems: 5,
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    const planId = installed.body.id as string;

    const beforeConnect = await request(app.getHttpServer())
      .get(`/api/plans/${planId}`)
      .set(auth(user.token))
      .expect(200);
    expect(beforeConnect.body).toMatchObject({
      status: 'draft',
      templateKey: 'daily-important-summary',
      hasMissingConnection: true,
    });
    expect(beforeConnect.body.missingConnections).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerKey: 'gmail' }),
      expect.objectContaining({ providerKey: 'google_calendar' }),
    ]));

    const versionsBefore = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/versions`)
      .set(auth(user.token))
      .expect(200);
    expect(versionsBefore.body).toHaveLength(1);

    const gmail = await oauthConnect(app, user.token, 'gmail', 'gmail-primary');
    const calendar = await oauthConnect(app, user.token, 'google_calendar', 'calendar-primary');
    expect(gmail.connection.status).toBe('connected');
    expect(calendar.connection.status).toBe('connected');

    const resolved = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/connections/resolve`)
      .set(auth(user.token))
      .expect(201);
    expect(resolved.body.currentVersion.versionNumber).toBe(2);
    expect(resolved.body.activeVersion).toBeNull();
    expect(resolved.body.hasMissingConnection).toBe(false);

    const versionsAfterResolve = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/versions`)
      .set(auth(user.token))
      .expect(200);
    expect(versionsAfterResolve.body).toHaveLength(2);
    expect(versionsAfterResolve.body.map((item: { versionNumber: number }) => item.versionNumber)).toEqual([2, 1]);

    await request(app.getHttpServer())
      .post(`/api/plans/${planId}/status`)
      .set(auth(user.token))
      .send({ status: 'ready' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/plans/${planId}/versions/2/apply`)
      .set(auth(user.token))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/plans/${planId}/status`)
      .set(auth(user.token))
      .send({ status: 'active' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/important-item-candidates/sync')
      .set(auth(user.token))
      .send({ connectionId: gmail.connection.id, sourceType: 'email' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/important-item-candidates/sync')
      .set(auth(user.token))
      .send({ connectionId: calendar.connection.id, sourceType: 'calendar' })
      .expect(201);

    const successful = await dispatchPlan(app, worker, user.token, planId, {
      referenceDate: '2027-04-06T08:00:00.000Z',
    });
    expect(successful.body.status).toBe('succeeded');
    expect(successful.body.resultSummary).not.toBe('今天没有需要处理的重要事项。');

    const summaryToday = await request(app.getHttpServer())
      .get('/api/today')
      .set(auth(user.token))
      .expect(200);
    expect(summaryToday.body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        executionId: successful.body.id,
        category: 'summary',
      }),
    ]));

    await request(app.getHttpServer())
      .put(`/api/connections/${calendar.connection.id}/permissions`)
      .set(auth(user.token))
      .send({ permissions: [{ capability: 'READ_EVENT', granted: false }] })
      .expect(200);

    const blocked = await dispatchPlan(app, worker, user.token, planId, {
      referenceDate: '2027-04-07T08:00:00.000Z',
    });
    expect(blocked.body).toMatchObject({
      status: 'failed',
      errorCode: 'PERMISSION_REVOKED',
    });

    const afterRevoke = await request(app.getHttpServer())
      .get('/api/today')
      .set(auth(user.token))
      .expect(200);
    expect(afterRevoke.body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        executionId: blocked.body.id,
        category: 'attention',
        title: '日历权限已经撤销',
      }),
    ]));

    const detail = await request(app.getHttpServer())
      .get(`/api/executions/${blocked.body.id}`)
      .set(auth(user.token))
      .expect(200);
    expect(detail.body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '日历权限已经撤销',
        body: 'calendar permission revoked',
      }),
    ]));

    const records = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/executions`)
      .set(auth(user.token))
      .expect(200);
    expect(records.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: blocked.body.id,
        status: 'failed',
        errorCode: 'PERMISSION_REVOKED',
      }),
    ]));
  });
});
