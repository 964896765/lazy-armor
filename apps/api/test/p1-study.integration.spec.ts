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

describe.sequential('P1 study canonical plan', { timeout: 60000 }, () => {
  let app: INestApplication;
  let worker: ExecutionWorker;
  let user: Session;
  let outsider: Session;
  let planId: string;
  let firstExecutionId: string;
  let firstExecutionSummary: string;
  let firstDayTasks: Array<{ id: string; subject: string; title: string }>;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 9).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-study-credentials-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    worker = app.get(ExecutionWorker);
    user = await register(`study-${unique}@example.com`, '学习用户');
    outsider = await register(`study-out-${unique}@example.com`, '学习外部用户');
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

  async function activate(currentPlanId: string, token: string) {
    await request(app.getHttpServer()).post(`/api/plans/${currentPlanId}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${currentPlanId}/versions/1/apply`).set(auth(token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${currentPlanId}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
  }

  async function dispatch(currentPlanId: string, token: string, triggerPayload: Record<string, unknown>) {
    const created = await request(app.getHttpServer())
      .post(`/api/plans/${currentPlanId}/executions`)
      .set(auth(token))
      .send({ requestId: `study-${unique}-${Math.random().toString(16).slice(2)}`, triggerPayload })
      .expect(201);
    await worker.processExecution(created.body.id);
    const detail = await request(app.getHttpServer()).get(`/api/executions/${created.body.id}`).set(auth(token)).expect(200);
    return {
      id: created.body.id as string,
      detail: detail.body as {
        id: string;
        status: string;
        resultSummary: string | null;
        steps: Array<{ actionType: string }>;
      },
    };
  }

  it('installs a 60-day exam study plan with controlled config and generic actions only', async () => {
    const template = await request(app.getHttpServer())
      .get('/api/templates/exam-study-plan')
      .set(auth(user.token))
      .expect(200);
    expect(template.body.configFields).toHaveLength(10);

    const installed = await request(app.getHttpServer())
      .post('/api/templates/exam-study-plan/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: '教资 60 天冲刺',
          examName: '教资笔试',
          examDate: '2027-05-30',
          subjects: '综合素质，教育知识与能力，作文',
          dailyStudyMinutes: 60,
          preferredStudyTime: '20:30',
          target: '60 天完成三轮复习',
          currentProgress: 20,
          weeklySummaryDay: 'sunday',
          missedTaskStrategy: 'catch_up_today',
        },
      })
      .expect(201);
    planId = installed.body.id as string;

    const version = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(version.body.templateKey).toBe('exam-study-plan');
    expect(version.body.templateConfig).toMatchObject({
      examName: '教资笔试',
      dailyStudyMinutes: 60,
      currentProgress: 20,
      weeklySummaryDay: 'sunday',
    });
    expect(version.body.definition.sources).toHaveLength(1);
    expect(version.body.definition.sources[0].config).toMatchObject({
      resource: 'study_plan',
      examName: '教资笔试',
      examDate: '2027-05-30',
      dailyStudyMinutes: 60,
      preferredStudyTime: '20:30',
      target: '60 天完成三轮复习',
    });
    expect(version.body.definition.sources[0].config.subjects).toEqual(['综合素质', '教育知识与能力', '作文']);
    expect(version.body.definition.actions.map((action: { actionType: string }) => action.actionType)).toEqual(['create_task', 'summarize', 'notify']);

    await activate(planId, user.token);
  });

  it('generates daily study tasks and records a readable execution result', async () => {
    const execution = await dispatch(planId, user.token, { referenceDate: '2027-03-31T12:00:00.000Z' });
    firstExecutionId = execution.id;
    firstExecutionSummary = execution.detail.resultSummary ?? '';
    expect(execution.detail.status).toBe('succeeded');
    expect(execution.detail.resultSummary).toBe('今天已安排 2 项学习任务，共 60 分钟，距离考试还有 60 天。');
    expect(execution.detail.steps.map((step) => step.actionType)).toEqual(['create_task', 'summarize', 'notify']);

    const tasks = await request(app.getHttpServer())
      .get(`/api/study-tasks?planId=${encodeURIComponent(planId)}&studyDate=${encodeURIComponent('2027-03-31T00:00:00.000Z')}`)
      .set(auth(user.token))
      .expect(200);
    expect(tasks.body).toHaveLength(2);
    expect(tasks.body.reduce((sum: number, task: { durationMinutes: number }) => sum + task.durationMinutes, 0)).toBe(60);
    firstDayTasks = tasks.body;

    const plan = await request(app.getHttpServer())
      .get(`/api/plans/${planId}`)
      .set(auth(user.token))
      .expect(200);
    expect(plan.body.planCenterSummary).toMatchObject({
      kind: 'study',
      examName: '教资笔试',
      latestTaskCount: 2,
      currentProgressPercent: 20,
    });
  });

  it('updates study progress and marks completed tasks without mutating old execution results', async () => {
    const updated = await request(app.getHttpServer())
      .post('/api/study-progress')
      .set(auth(user.token))
      .send({
        planId,
        currentProgressPercent: 35,
        completedTaskIds: [firstDayTasks[0].id],
      })
      .expect(201);
    expect(updated.body).toMatchObject({
      sourcePlanId: planId,
      currentProgressPercent: 35,
      completedTaskCount: 1,
    });

    const execution = await request(app.getHttpServer())
      .get(`/api/executions/${firstExecutionId}`)
      .set(auth(user.token))
      .expect(200);
    expect(execution.body.resultSummary).toBe(firstExecutionSummary);
  });

  it('rebalances future tasks after a missed study session and exposes a Today alert', async () => {
    const execution = await dispatch(planId, user.token, { referenceDate: '2027-04-01T12:00:00.000Z' });
    expect(execution.detail.resultSummary).toBe('今天已安排 2 项学习任务，共 60 分钟；检测到漏学，后续安排已重排。');

    const tasks = await request(app.getHttpServer())
      .get(`/api/study-tasks?planId=${encodeURIComponent(planId)}&studyDate=${encodeURIComponent('2027-04-01T00:00:00.000Z')}`)
      .set(auth(user.token))
      .expect(200);
    expect(tasks.body).toHaveLength(2);
    expect(tasks.body.some((task: { title: string }) => task.title.includes('补漏复习'))).toBe(true);
    expect(tasks.body.some((task: { title: string }) => task.title.includes(firstDayTasks[1].subject))).toBe(true);

    const today = await request(app.getHttpServer())
      .get('/api/today')
      .set(auth(user.token))
      .expect(200);
    expect(today.body.alerts.some((item: { title: string; body: string }) => item.title.includes('后续安排已重排') || item.body.includes('后续安排已重排'))).toBe(true);
  });

  it('builds a weekly summary on the configured weekday', async () => {
    const secondDayTasks = await request(app.getHttpServer())
      .get(`/api/study-tasks?planId=${encodeURIComponent(planId)}&studyDate=${encodeURIComponent('2027-04-01T00:00:00.000Z')}`)
      .set(auth(user.token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/study-progress')
      .set(auth(user.token))
      .send({
        planId,
        currentProgressPercent: 45,
        completedTaskIds: secondDayTasks.body.map((task: { id: string }) => task.id),
      })
      .expect(201);

    const execution = await dispatch(planId, user.token, { referenceDate: '2027-04-04T12:00:00.000Z' });
    expect(execution.detail.resultSummary).toContain('本周已完成');
    expect(execution.detail.resultSummary).toContain('距离考试还有 56 天');
  });

  it('creates a new immutable PlanVersion when daily study minutes change', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/templates/plans/${planId}/version`)
      .set(auth(user.token))
      .send({
        config: {
          planName: '教资 60 天冲刺',
          examName: '教资笔试',
          examDate: '2027-05-30',
          subjects: '综合素质，教育知识与能力，作文',
          dailyStudyMinutes: 90,
          preferredStudyTime: '20:30',
          target: '60 天完成三轮复习',
          currentProgress: 45,
          weeklySummaryDay: 'sunday',
          missedTaskStrategy: 'catch_up_today',
        },
      })
      .expect(201);
    expect(created.body).toMatchObject({
      versionNumber: 2,
      templateKey: 'exam-study-plan',
      templateConfig: {
        dailyStudyMinutes: 90,
        currentProgress: 45,
      },
    });

    const original = await request(app.getHttpServer())
      .get(`/api/plans/${planId}/versions/1`)
      .set(auth(user.token))
      .expect(200);
    expect(original.body.templateConfig.dailyStudyMinutes).toBe(60);
    expect(original.body.templateConfig.currentProgress).toBe(20);
  });

  it('enforces cross-user isolation for study runtime data', async () => {
    await request(app.getHttpServer())
      .get(`/api/study-tasks?planId=${encodeURIComponent(planId)}`)
      .set(auth(outsider.token))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/study-progress?planId=${encodeURIComponent(planId)}`)
      .set(auth(outsider.token))
      .expect(404);
  });
});
