import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutionWorker } from '../src/execution/execution-worker.service';

interface Session {
  token: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.sequential('P1 content + daily summary canonical plans', { timeout: 60000 }, () => {
  let app: INestApplication;
  let worker: ExecutionWorker;
  let user: Session;
  let outsider: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-content-summary-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    worker = app.get(ExecutionWorker);
    user = await register(`content-${unique}@example.com`, '内容用户');
    outsider = await register(`content-out-${unique}@example.com`, '内容外部用户');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'correct-horse-battery-staple', displayName })
      .expect(201);
    return { token: response.body.accessToken as string };
  }

  async function activate(planId: string, token: string) {
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions/1/apply`).set(auth(token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
  }

  async function dispatch(planId: string, token: string, triggerPayload: Record<string, unknown>) {
    const response = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/executions`)
      .set(auth(token))
      .send({ requestId: `p1-content-summary-${unique}-${Math.random().toString(16).slice(2)}`, triggerPayload })
      .expect(201);
    await worker.processExecution(response.body.id);
    return request(app.getHttpServer()).get(`/api/executions/${response.body.id}`).set(auth(token)).expect(200);
  }

  async function listNotifications(token: string) {
    const response = await request(app.getHttpServer()).get('/api/notifications').set(auth(token)).expect(200);
    return response.body as Array<{ eventType: string; title: string; body: string; priority: string }>;
  }

  it('rejects invalid content platform config before install', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/video-multi-platform/install')
      .set(auth(user.token))
      .send({
        config: {
          masterContentId: '00000000-0000-0000-0000-000000000000',
          targetPlatforms: ['unknown_platform'],
        },
      })
      .expect(400);
  });

  it('creates master content and keeps it isolated across users', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/master-contents')
      .set(auth(user.token))
      .send({
        title: '厨房收纳技巧合集',
        body: '这一期内容围绕厨房收纳、冰箱分区和台面整理展开。',
        mediaReferences: ['video://kitchen-1'],
        coverReference: 'cover://kitchen-1',
        tags: ['收纳', '厨房', '家庭'],
        sourceType: 'manual',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      title: '厨房收纳技巧合集',
      sourceType: 'manual',
      mediaReferences: ['video://kitchen-1'],
    });

    const mine = await request(app.getHttpServer()).get('/api/master-contents').set(auth(user.token)).expect(200);
    expect(mine.body.some((item: { id: string }) => item.id === created.body.id)).toBe(true);

    const theirs = await request(app.getHttpServer()).get('/api/master-contents').set(auth(outsider.token)).expect(200);
    expect(theirs.body.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
  });

  it('installs multi-platform content template, generates variants and prepares draft-only publish results', async () => {
    const content = await request(app.getHttpServer())
      .post('/api/master-contents')
      .set(auth(user.token))
      .send({
        title: '清晨做饭的三步节奏',
        body: '先备菜，再统一加热，最后集中收尾，让早上更从容。',
        mediaReferences: ['video://morning-cook'],
        coverReference: 'cover://morning-cook',
        tags: ['做饭', '效率', '生活'],
        sourceType: 'manual',
      })
      .expect(201);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/video-multi-platform/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '晨间内容一稿多发',
          masterContentId: content.body.id,
          targetPlatforms: ['douyin', 'bilibili'],
          generateTitle: true,
          generateDescription: true,
          generateTags: true,
          prepareCover: true,
          requireApprovalBeforePublish: true,
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const execution = await dispatch(installed.body.id, user.token, {});
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toBe('已为抖音和B站准备好发布版本。');

    const variants = await request(app.getHttpServer())
      .get(`/api/platform-variants?masterContentId=${content.body.id}`)
      .set(auth(user.token))
      .expect(200);
    expect(variants.body).toHaveLength(2);
    expect(variants.body.map((item: { platform: string }) => item.platform).sort()).toEqual(['bilibili', 'douyin']);
    expect(variants.body.every((item: { publishStatus: string }) => item.publishStatus === 'prepared')).toBe(true);

    const plan = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}`).set(auth(user.token)).expect(200);
    expect(plan.body.planCenterSummary).toMatchObject({
      kind: 'content',
      targetPlatforms: ['抖音', 'B站'],
      latestPreparedVariantCount: 2,
      waitingConfirmation: true,
    });

    const version = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}/versions/1`).set(auth(user.token)).expect(200);
    expect(version.body.definition.actions.map((action: { actionType: string }) => action.actionType)).toEqual(['generate_content', 'create_draft', 'prepare_publish', 'notify']);
    expect(version.body.definition.actions.some((action: { actionType: string }) => action.actionType === 'publish')).toBe(false);
  });

  it('keeps platform validation deterministic and returns human-readable revision messages', async () => {
    const content = await request(app.getHttpServer())
      .post('/api/master-contents')
      .set(auth(user.token))
      .send({
        title: '这个标题非常非常长'.repeat(8),
        body: '正文保留简短说明。',
        mediaReferences: ['video://long-title'],
        coverReference: 'cover://long-title',
        tags: ['长标题', '测试'],
        sourceType: 'manual',
      })
      .expect(201);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/video-multi-platform/install')
      .set(auth(user.token))
      .send({
        config: {
          masterContentId: content.body.id,
          targetPlatforms: ['bilibili'],
          generateTitle: false,
          generateDescription: true,
          generateTags: true,
          prepareCover: true,
          requireApprovalBeforePublish: true,
          notificationPreference: 'important',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const before = await listNotifications(user.token);
    const execution = await dispatch(installed.body.id, user.token, {});
    expect(execution.body.resultSummary).toContain('B站版本标题超出限制，等待你修改。');

    const variants = await request(app.getHttpServer())
      .get(`/api/platform-variants?masterContentId=${content.body.id}&platform=bilibili`)
      .set(auth(user.token))
      .expect(200);
    expect(variants.body[0]).toMatchObject({
      platform: 'bilibili',
      publishStatus: 'needs_revision',
    });

    const after = await listNotifications(user.token);
    expect(after.filter((item) => item.eventType === 'content_variant_revision_needed')).toHaveLength(
      before.filter((item) => item.eventType === 'content_variant_revision_needed').length + 1,
    );
  });

  it('keeps execution result immutable across repeated content preparations', async () => {
    const content = await request(app.getHttpServer())
      .post('/api/master-contents')
      .set(auth(user.token))
      .send({
        title: '玄关整理前后对比',
        body: '展示玄关整理思路与前后变化。',
        mediaReferences: ['video://entryway'],
        coverReference: 'cover://entryway',
        tags: ['整理', '玄关', '改造'],
        sourceType: 'manual',
      })
      .expect(201);
    const installed = await request(app.getHttpServer())
      .post('/api/templates/video-multi-platform/install')
      .set(auth(user.token))
      .send({
        config: {
          masterContentId: content.body.id,
          targetPlatforms: ['douyin', 'bilibili'],
          generateTitle: true,
          generateDescription: true,
          generateTags: true,
          prepareCover: true,
          requireApprovalBeforePublish: false,
          notificationPreference: 'silent',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const first = await dispatch(installed.body.id, user.token, {});
    const second = await dispatch(installed.body.id, user.token, {});
    expect(first.body.resultSummary).toBe('已为抖音和B站准备好发布版本。');
    expect(second.body.resultSummary).toBe('已为抖音和B站准备好发布版本。');

    const variants = await request(app.getHttpServer())
      .get(`/api/platform-variants?masterContentId=${content.body.id}`)
      .set(auth(user.token))
      .expect(200);
    expect(variants.body).toHaveLength(4);
  });

  it('keeps real publish as guarded R3 work that waits for approval', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/plans')
      .set(auth(user.token))
      .send({
        name: '真实发布门禁测试',
        description: '确保真实发布不会在 P1 绕开审批。',
        domain: 'content',
        automationLevel: 'L3',
        approvalPolicy: { type: 'above_risk_level', config: { riskLevel: 'R3' } },
        sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
        triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
        conditions: [],
        actions: [{ actionType: 'publish', config: { visibility: 'public' }, stepOrder: 0 }],
      })
      .expect(201);
    await activate(created.body.id, user.token);

    const execution = await dispatch(created.body.id, user.token, {});
    expect(execution.body.status).toBe('waiting_approval');
    expect(execution.body.approvalStatus).toBe('pending');
  });

  it('rejects invalid daily summary time before install', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/daily-important-summary/install')
      .set(auth(user.token))
      .send({
        config: {
          summaryTime: '25:61',
          includedSources: ['internal_task'],
          lookAheadHours: 24,
          includeCalendar: true,
          includeMessages: true,
          maxItems: 5,
          notificationPreference: 'summary',
        },
      })
      .expect(400);
  });

  it('normalizes important item sources, dedupes candidates and groups must/should/ignore deterministically', async () => {
    await request(app.getHttpServer())
      .post('/api/important-item-candidates')
      .set(auth(user.token))
      .send({
        sourceType: 'internal_task',
        sourceId: `task-${unique}`,
        title: '今天交付周报',
        summary: '今天下班前需要提交周报',
        occurredAt: '2027-03-10T08:00:00.000Z',
        dueAt: '2027-03-10T16:00:00.000Z',
        category: '工作',
        importanceSignals: { highPriority: true },
        requiresAction: true,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/important-item-candidates')
      .set(auth(user.token))
      .send({
        sourceType: 'test_email',
        sourceId: `mail-${unique}`,
        title: '客户等你回复',
        summary: '请在明天中午前回复报价',
        occurredAt: '2027-03-10T09:00:00.000Z',
        dueAt: '2027-03-11T10:00:00.000Z',
        senderOrOrganizer: '客户A',
        category: '邮件',
        importanceSignals: { needsReply: true },
        requiresAction: true,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/important-item-candidates')
      .set(auth(user.token))
      .send({
        sourceType: 'test_calendar',
        sourceId: `cal-${unique}`,
        title: '下午站会',
        summary: '14:00 团队站会',
        occurredAt: '2027-03-10T13:00:00.000Z',
        category: '会议',
        importanceSignals: {},
        requiresAction: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/important-item-candidates')
      .set(auth(user.token))
      .send({
        sourceType: 'manual_event',
        sourceId: `event-${unique}`,
        title: '顺路买咖啡滤纸',
        summary: '如果今天出门就顺路买',
        occurredAt: '2027-03-12T10:00:00.000Z',
        category: '生活',
        importanceSignals: {},
        requiresAction: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/important-item-candidates')
      .set(auth(user.token))
      .send({
        sourceType: 'internal_task',
        sourceId: `task-${unique}`,
        title: '今天交付周报',
        summary: '同一事项重复写入后应被去重',
        occurredAt: '2027-03-10T08:00:00.000Z',
        dueAt: '2027-03-10T16:00:00.000Z',
        category: '工作',
        importanceSignals: { highPriority: true },
        requiresAction: true,
      })
      .expect(201);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/daily-important-summary/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '每天重点先看',
          summaryTime: '07:30',
          includedSources: ['internal_task', 'manual_event', 'test_email', 'test_calendar'],
          lookAheadHours: 36,
          includeCalendar: true,
          includeMessages: true,
          maxItems: 2,
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    await activate(installed.body.id, user.token);

    const before = await listNotifications(user.token);
    const execution = await dispatch(installed.body.id, user.token, { referenceDate: '2027-03-10T10:00:00.000Z' });
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toBe('今天有 3 件重要事项，其中 2 件需要尽快处理。');

    const summarizeStep = execution.body.steps.find((step: { actionType: string }) => step.actionType === 'summarize');
    expect(summarizeStep.outputSnapshotJson).toMatchObject({
      mustHandleCount: 2,
      shouldHandleCount: 1,
      ignoredCount: 1,
    });
    expect(summarizeStep.outputSnapshotJson.topItems).toHaveLength(2);
    expect(summarizeStep.outputSnapshotJson.sourceCounts).toMatchObject({
      internal_task: 1,
      test_email: 1,
      test_calendar: 1,
      manual_event: 1,
    });

    const after = await listNotifications(user.token);
    expect(after.filter((item) => item.eventType === 'daily_important_summary')).toHaveLength(
      before.filter((item) => item.eventType === 'daily_important_summary').length + 1,
    );

    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(today.body.alerts.some((item: { body: string }) => item.body.includes('今天有 3 件重要事项'))).toBe(true);

    const plan = await request(app.getHttpServer()).get(`/api/plans/${installed.body.id}`).set(auth(user.token)).expect(200);
    expect(plan.body.planCenterSummary).toMatchObject({
      kind: 'daily_summary',
      summaryTime: '07:30',
      latestImportantCount: 3,
    });
  });

  it('keeps empty daily summary silent and isolates candidates across users', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/daily-important-summary/install')
      .set(auth(outsider.token))
      .send({
        config: {
          summaryTime: '08:00',
          includedSources: ['internal_task'],
          lookAheadHours: 24,
          includeCalendar: false,
          includeMessages: false,
          maxItems: 5,
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    await activate(installed.body.id, outsider.token);

    const outsiderCandidates = await request(app.getHttpServer())
      .get('/api/important-item-candidates')
      .set(auth(outsider.token))
      .expect(200);
    expect(outsiderCandidates.body).toHaveLength(0);

    const before = await listNotifications(outsider.token);
    const execution = await dispatch(installed.body.id, outsider.token, { referenceDate: '2027-03-10T10:00:00.000Z' });
    expect(execution.body.resultSummary).toBe('今天没有需要处理的重要事项。');

    const after = await listNotifications(outsider.token);
    expect(after.length).toBe(before.length);
  });
});
