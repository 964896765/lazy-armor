import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createPool, type Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

interface Session {
  token: string;
  userId: string;
}

interface WorkerProcess {
  child: ChildProcess;
  probePort: number;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const apiRoot = process.cwd();
const repoRoot = path.resolve(apiRoot, '..', '..');
const executionWorkerEntry = path.join(apiRoot, 'dist', 'entrypoints', 'execution-worker.main.js');
const activeWorkers: WorkerProcess[] = [];
let portCursor = 35420;
let sharedConnectionId = '';

describe.sequential('P5-G scale true-process multi-worker', { timeout: 180000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: IORedis;
  let queue: Queue<{ executionId: string }>;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    if (!existsSync(executionWorkerEntry)) {
      throw new Error('Execution worker dist entrypoint is missing. Run `pnpm --filter @lazy-armor/api build` first.');
    }
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'development';
    process.env.APP_ROLE = 'api';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 12).toString('base64');
    process.env.CREDENTIAL_STORE_PATH = `.data/test-p5-scale-${unique}`;
    process.env.WORKER_READINESS_TIMEOUT_MS = '800';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 6, timezone: 'Z' });
    redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue('lazy-armor-executions', { connection: redis });
    user = await register(app, `p5-scale-worker-${unique}@example.com`, 'P5 Scale Worker');
    sharedConnectionId = await createConnection(app, user.token, 'internal', `内部连接-${unique}`);
    await grant(app, user.token, sharedConnectionId, 'WRITE_INTERNAL');
  });

  afterEach(async () => {
    while (activeWorkers.length) {
      await stopWorker(activeWorkers.pop()!);
    }
  });

  afterAll(async () => {
    while (activeWorkers.length) {
      await stopWorker(activeWorkers.pop()!);
    }
    await queue?.close();
    if (redis && redis.status !== 'end') await redis.quit();
    await pool?.end();
    await app?.close();
  });

  it('executes one side effect once under two competing execution workers and duplicate jobs', async () => {
    const planId = await createInternalPlan(app, user.token, `双 worker-${unique}`);
    const executionId = await dispatch(app, user.token, planId, { amount: 300 }, `p5-scale-${unique}`);

    await queue.add('dup-a', { executionId }, { jobId: `${executionId}-a`, removeOnComplete: true, removeOnFail: false });
    await queue.add('dup-b', { executionId }, { jobId: `${executionId}-b`, removeOnComplete: true, removeOnFail: false });

    await startExecutionWorker();
    await startExecutionWorker();

    const detail = await waitForExecutionStatus(app, user.token, executionId, 'succeeded');
    expect(detail.steps.filter((step: { status: string }) => step.status === 'succeeded')).toHaveLength(1);
    const succeeded = detail.steps.find((step: { status: string }) => step.status === 'succeeded');
    expect(succeeded.attemptCount).toBe(1);
    expect(detail.events.filter((event: { eventType: string }) => event.eventType === 'worker_lease_acquired')).toHaveLength(1);
  });
});

async function register(app: INestApplication, email: string, displayName: string): Promise<Session> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-battery-staple', displayName })
    .expect(201);
  const me = await request(app.getHttpServer()).get('/api/me').set(auth(response.body.accessToken)).expect(200);
  return { token: response.body.accessToken as string, userId: me.body.id as string };
}

async function createConnection(app: INestApplication, token: string, connectorId: string, name: string) {
  const response = await request(app.getHttpServer())
    .post('/api/connections')
    .set(auth(token))
    .send({ connectorId, externalAccountName: name })
    .expect(201);
  return response.body.id as string;
}

async function grant(app: INestApplication, token: string, id: string, capability: string) {
  await request(app.getHttpServer())
    .put(`/api/connections/${id}/permissions`)
    .set(auth(token))
    .send({ permissions: [{ capability, granted: true }] })
    .expect(200);
}

async function createInternalPlan(app: INestApplication, token: string, name: string) {
  const created = await request(app.getHttpServer())
    .post('/api/plans')
    .set(auth(token))
    .send({
      name,
      description: 'P5-G true-process multi-worker scale',
      domain: 'general',
      automationLevel: 'L1',
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
      triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
      conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 200, sortOrder: 0 }],
      actions: [{ actionType: 'update_internal_record', connectionId: sharedConnectionId, requiredCapability: 'WRITE_INTERNAL', config: { recordType: 'worker-p5-scale' }, stepOrder: 0 }],
    })
    .expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(token)).send({ status: 'ready' }).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/versions/1/apply`).set(auth(token)).expect(201);
  await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(token)).send({ status: 'active' }).expect(201);
  return created.body.id as string;
}

async function dispatch(app: INestApplication, token: string, planId: string, payload: Record<string, unknown>, requestId: string) {
  const created = await request(app.getHttpServer())
    .post(`/api/plans/${planId}/executions`)
    .set(auth(token))
    .send({ requestId, triggerPayload: payload })
    .expect(201);
  return created.body.id as string;
}

async function waitForExecutionStatus(app: INestApplication, token: string, executionId: string, status: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await request(app.getHttpServer()).get(`/api/executions/${executionId}`).set(auth(token)).expect(200);
    if (row.body.status === status) return row.body;
    await sleep(200);
  }
  throw new Error(`Execution did not reach ${status}`);
}

async function startExecutionWorker(): Promise<WorkerProcess> {
  const probePort = portCursor++;
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    APP_ENV: 'development',
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
    JWT_SECRET: process.env.JWT_SECRET!,
    CREDENTIAL_MASTER_KEY: process.env.CREDENTIAL_MASTER_KEY!,
    CREDENTIAL_STORE_PATH: process.env.CREDENTIAL_STORE_PATH!,
    WORKER_READINESS_TIMEOUT_MS: process.env.WORKER_READINESS_TIMEOUT_MS ?? '800',
    WORKER_PROBE_HOST: '127.0.0.1',
    EXECUTION_WORKER_PROBE_PORT: String(probePort),
  };
  const child = spawn(process.execPath, [executionWorkerEntry], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const worker = { child, probePort };
  await waitForLive(probePort);
  activeWorkers.push(worker);
  return worker;
}

async function stopWorker(worker: WorkerProcess) {
  const index = activeWorkers.indexOf(worker);
  if (index >= 0) activeWorkers.splice(index, 1);
  if (worker.child.exitCode !== null) return;
  worker.child.kill('SIGTERM');
  const exited = await waitForExit(worker.child, 8_000);
  if (!exited && worker.child.pid) {
    try { execFileSync('taskkill', ['/PID', String(worker.child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    await waitForExit(worker.child, 4_000);
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return true;
  const deadline = Date.now() + timeoutMs;
  return await new Promise<boolean>((resolve) => {
    let finished = false;
    const settle = (value: boolean) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(value);
    };
    const onExit = () => settle(true);
    const poll = setInterval(() => {
      void isChildProcessAlive(child).then((alive) => { if (!alive) settle(true); }).catch(() => undefined);
    }, 200);
    poll.unref?.();
    const timer = setTimeout(() => settle(false), Math.max(0, deadline - Date.now()));
    child.once('exit', onExit);
  });
}

async function waitForLive(port: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/live`);
      if (response.status === 200) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Worker /live did not reach HTTP 200 on port ${port}`);
}

async function isChildProcessAlive(child: ChildProcess) {
  if (child.exitCode !== null) return false;
  if (!child.pid) return false;
  try { process.kill(child.pid, 0); return true; } catch { return false; }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
