import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionWorker } from '../src/execution/execution-worker.service';
import { EntitlementService } from '../src/membership/entitlement.service';

interface Session {
  token: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P1 canonical plans regression', { timeout: 120000 }, () => {
  let app: INestApplication;
  let worker: ExecutionWorker;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-p1-canonical-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    worker = app.get(ExecutionWorker);
    user = await register(`p1-canonical-${unique}@example.com`, 'P1 总回归用户');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'correct-horse-battery-staple', displayName })
      .expect(201);
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(response.body.accessToken)).expect(200);
    await app.get(EntitlementService).setForInternalFixture(me.body.id as string, 'plus', 'active');
    return { token: response.body.accessToken as string };
  }

  async function activate(planId: string, token: string) {
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
  }

  async function dispatch(planId: string, token: string, triggerPayload: Record<string, unknown>) {
    const created = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/executions`)
      .set(auth(token))
      .send({ requestId: `p1-canonical-${unique}-${Math.random().toString(16).slice(2)}`, triggerPayload })
      .expect(201);
    await worker.processExecution(created.body.id);
    return (await request(app.getHttpServer()).get(`/api/executions/${created.body.id}`).set(auth(token)).expect(200)).body as {
      id: string;
      status: string;
      resultSummary: string | null;
    };
  }

  async function installTemplate(key: string, config: Record<string, unknown>) {
    const installed = await request(app.getHttpServer())
      .post(`/api/templates/${key}/install`)
      .set(auth(user.token))
      .send({ config })
      .expect(201);
    await activate(installed.body.id, user.token);
    return installed.body as { id: string; templateKey: string; templateVersion: string; currentVersion: { templateConfig: Record<string, unknown> } };
  }

  async function assertPlanRuntimeSurfaces(planId: string, executionId: string, templateKey: string) {
    const version = await request(app.getHttpServer()).get(`/api/plans/${planId}/versions/1`).set(auth(user.token)).expect(200);
    expect(version.body.templateKey).toBe(templateKey);
    const plan = await request(app.getHttpServer()).get(`/api/plans/${planId}`).set(auth(user.token)).expect(200);
    expect(plan.body.id).toBe(planId);
    expect(plan.body.currentVersion.versionNumber).toBe(1);
    expect(plan.body.activeVersion.versionNumber).toBe(1);
    const records = await request(app.getHttpServer()).get(`/api/plans/${planId}/executions`).set(auth(user.token)).expect(200);
    expect(records.body.some((item: { id: string }) => item.id === executionId)).toBe(true);
    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(Array.isArray(today.body.alerts)).toBe(true);
    expect(Array.isArray(today.body.pendingApprovals)).toBe(true);
  }

  it('runs all 8 canonical plans through template, plan version, apply, execution, result, today and record surfaces', async () => {
    const listed = await request(app.getHttpServer()).get('/api/templates').set(auth(user.token)).expect(200);
    expect(listed.body.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining([
      'monthly-bill-summary',
      'mobile-bill-guard',
      'quiet-delivery-guard',
      'family-supply-reminder',
      'video-multi-platform',
      'daily-important-summary',
      'exam-study-plan',
      'device-consumable-reminder',
    ]));

    await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({
      provider: '水费',
      category: '居家',
      billingPeriod: '2027-01',
      amount: 80,
      currency: 'CNY',
      occurredAt: '2027-01-03T08:00:00.000Z',
      sourceType: 'internal',
    }).expect(201);
    await request(app.getHttpServer()).post('/api/billing-records').set(auth(user.token)).send({
      provider: '电费',
      category: '居家',
      billingPeriod: '2027-01',
      amount: 120,
      currency: 'CNY',
      occurredAt: '2027-01-04T08:00:00.000Z',
      sourceType: 'internal',
    }).expect(201);
    await request(app.getHttpServer()).post('/api/logistics-tracking-snapshots').set(auth(user.token)).send({
      trackingNumber: `SF-${unique}`,
      carrier: 'sf',
      status: 'in_transit',
      latestEvent: '快件正在运输中',
      latestEventAt: '2027-01-20T00:00:00.000Z',
      lastUpdatedAt: '2027-01-20T00:00:00.000Z',
      sourceType: 'internal',
    }).expect(201);
    await request(app.getHttpServer()).post('/api/important-item-candidates').set(auth(user.token)).send({
      sourceType: 'internal_task',
      sourceId: `task-${unique}`,
      title: '今天交付总回归报告',
      summary: '今天下班前需要交付 P1 总回归结果',
      occurredAt: '2027-03-10T08:00:00.000Z',
      dueAt: '2027-03-10T16:00:00.000Z',
      category: '工作',
      importanceSignals: { highPriority: true },
      requiresAction: true,
    }).expect(201);

    const content = await request(app.getHttpServer())
      .post('/api/master-contents')
      .set(auth(user.token))
      .send({
        title: `厨房收纳 ${unique}`,
        body: '把台面、抽屉和冰箱分区一次性整理好。',
        mediaReferences: ['video://kitchen'],
        coverReference: 'cover://kitchen',
        tags: ['收纳', '厨房', '家务'],
        sourceType: 'manual',
      })
      .expect(201);

    const deviceProfile = await request(app.getHttpServer())
      .post('/api/device-profiles')
      .set(auth(user.token))
      .send({
        type: '净水器',
        brand: '小米',
        model: `净水器Pro-${unique}`,
        purchasedAt: '2026-12-01T00:00:00.000Z',
        warrantyUntil: '2028-12-01T00:00:00.000Z',
        maintenanceIntervalDays: 180,
        sourceType: 'manual',
      })
      .expect(201);
    const deviceConsumable = await request(app.getHttpServer())
      .post('/api/device-consumables')
      .set(auth(user.token))
      .send({
        deviceProfileId: deviceProfile.body.id,
        name: '前置滤芯',
        lastReplacedAt: '2027-01-01T00:00:00.000Z',
        replacementIntervalDays: 150,
        remindBeforeDays: 10,
      })
      .expect(201);

    const monthly = await installTemplate('monthly-bill-summary', {
      planName: `月度账单汇总-${unique}`,
      summaryDay: 3,
      sourceType: 'internal',
      billingPeriod: 'current_month',
      showCategories: true,
      showMonthOverMonth: true,
      anomalyThresholdPercent: 20,
      notificationPreference: 'silent',
    });
    expect(monthly.currentVersion.templateConfig.planName).toBe(`月度账单汇总-${unique}`);
    const monthlyExecution = await dispatch(monthly.id, user.token, { referenceDate: '2027-01-20T00:00:00.000Z' });
    expect(monthlyExecution.status).toBe('succeeded');
    expect(monthlyExecution.resultSummary).toContain('月度账单已汇总');
    await assertPlanRuntimeSurfaces(monthly.id, monthlyExecution.id, 'monthly-bill-summary');

    const mobile = await installTemplate('mobile-bill-guard', {
      planName: `话费异常守护-${unique}`,
      monthlyThreshold: 150,
      percentIncreaseThreshold: 30,
      sourceType: 'manual',
      onlyAbnormalNotify: true,
      checkDayOfMonth: 5,
    });
    const mobileExecution = await dispatch(mobile.id, user.token, { amount: 151, amountChange: { previous: 100, current: 151 } });
    expect(mobileExecution.status).toBe('succeeded');
    expect(mobileExecution.resultSummary).toContain('151.00');
    await assertPlanRuntimeSurfaces(mobile.id, mobileExecution.id, 'mobile-bill-guard');

    const logistics = await installTemplate('quiet-delivery-guard', {
      planName: `快递静默管家-${unique}`,
      trackingNumber: `SF-${unique}`,
      carrier: 'sf',
      staleHours: 48,
      notifyOnException: true,
      notifyOnDelivered: false,
      checkInterval: '12h',
    });
    const logisticsExecution = await dispatch(logistics.id, user.token, { referenceDate: '2027-01-20T12:00:00.000Z' });
    expect(logisticsExecution.status).toBe('succeeded');
    expect(logisticsExecution.resultSummary).toBe('检查快递：运输正常。');
    await assertPlanRuntimeSurfaces(logistics.id, logisticsExecution.id, 'quiet-delivery-guard');

    const household = await installTemplate('family-supply-reminder', {
      planName: `家庭补给提醒-${unique}`,
      itemName: `纸巾-${unique}`,
      category: '日用',
      lastPurchasedAt: '2027-02-01',
      purchaseQuantity: 3,
      estimatedUsageDays: 12,
      remindBeforeDays: 4,
      preparationMode: 'shopping_list',
    });
    const householdExecution = await dispatch(household.id, user.token, { referenceDate: '2027-02-10T00:00:00.000Z' });
    expect(householdExecution.status).toBe('succeeded');
    expect(householdExecution.resultSummary).toContain(`纸巾-${unique}`);
    await assertPlanRuntimeSurfaces(household.id, householdExecution.id, 'family-supply-reminder');

    const contentPlan = await installTemplate('video-multi-platform', {
      planName: `视频一稿多发-${unique}`,
      masterContentId: content.body.id,
      targetPlatforms: ['douyin', 'bilibili'],
      generateTitle: true,
      generateDescription: true,
      generateTags: true,
      prepareCover: true,
      requireApprovalBeforePublish: true,
      notificationPreference: 'summary',
    });
    const contentExecution = await dispatch(contentPlan.id, user.token, {});
    expect(contentExecution.status).toBe('succeeded');
    expect(contentExecution.resultSummary).toContain('准备好发布版本');
    await assertPlanRuntimeSurfaces(contentPlan.id, contentExecution.id, 'video-multi-platform');

    const daily = await installTemplate('daily-important-summary', {
      planName: `每日重要事项摘要-${unique}`,
      summaryTime: '07:30',
      includedSources: ['internal_task'],
      lookAheadHours: 24,
      includeCalendar: false,
      includeMessages: false,
      maxItems: 5,
      notificationPreference: 'summary',
    });
    const dailyExecution = await dispatch(daily.id, user.token, { referenceDate: '2027-03-10T10:00:00.000Z' });
    expect(dailyExecution.status).toBe('succeeded');
    expect(dailyExecution.resultSummary).toContain('今天有');
    await assertPlanRuntimeSurfaces(daily.id, dailyExecution.id, 'daily-important-summary');
    const dailyToday = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(dailyToday.body.alerts.some((item: { body: string }) => item.body.includes('今天有'))).toBe(true);

    const study = await installTemplate('exam-study-plan', {
      planName: `考试学习计划-${unique}`,
      examName: '教资笔试',
      examDate: '2027-05-30',
      subjects: '综合素质，教育知识与能力，作文',
      dailyStudyMinutes: 60,
      preferredStudyTime: '20:30',
      target: '60 天完成三轮复习',
      currentProgress: 20,
      weeklySummaryDay: 'sunday',
      missedTaskStrategy: 'catch_up_today',
    });
    const studyExecution = await dispatch(study.id, user.token, { referenceDate: '2027-03-31T12:00:00.000Z' });
    expect(studyExecution.status).toBe('succeeded');
    expect(studyExecution.resultSummary).toContain('今天已安排');
    await assertPlanRuntimeSurfaces(study.id, studyExecution.id, 'exam-study-plan');
    const studyTasks = await request(app.getHttpServer())
      .get(`/api/study-tasks?planId=${encodeURIComponent(study.id)}&studyDate=${encodeURIComponent('2027-03-31T00:00:00.000Z')}`)
      .set(auth(user.token))
      .expect(200);
    expect(studyTasks.body.length).toBeGreaterThan(0);

    const device = await installTemplate('device-consumable-reminder', {
      planName: `设备耗材提醒-${unique}`,
      deviceProfileId: deviceProfile.body.id,
      consumableId: deviceConsumable.body.id,
      preparationMode: 'shopping_list',
      notificationPreference: 'summary',
    });
    const deviceExecution = await dispatch(device.id, user.token, { referenceDate: '2027-05-25T00:00:00.000Z' });
    expect(deviceExecution.status).toBe('succeeded');
    expect(deviceExecution.resultSummary).toContain('前置滤芯');
    await assertPlanRuntimeSurfaces(device.id, deviceExecution.id, 'device-consumable-reminder');
    const prepared = await request(app.getHttpServer()).get('/api/prepared-shopping-items?status=prepared').set(auth(user.token)).expect(200);
    expect(prepared.body.some((item: { itemName: string }) => item.itemName.includes('前置滤芯'))).toBe(true);
  });
});
