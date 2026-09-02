import { Test } from '@nestjs/testing';
import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminOperationsService } from '../src/admin/admin-operations.service';

type WorkerRole = 'execution-worker' | 'outbox-worker';
interface WorkerProcess { child: ChildProcess; role: WorkerRole; probePort: number; output: string[] }

const apiRoot = process.cwd();
const repoRoot = path.resolve(apiRoot, '..', '..');
const dockerComposePath = path.join(repoRoot, 'infra', 'docker', 'docker-compose.yml');
const entries: Record<WorkerRole, string> = {
  'execution-worker': path.join(apiRoot, 'dist', 'entrypoints', 'execution-worker.main.js'),
  'outbox-worker': path.join(apiRoot, 'dist', 'entrypoints', 'outbox-worker.main.js'),
};
const portBase = 36500 + Math.floor(Math.random() * 500);
const ports: Record<WorkerRole, number> = { 'execution-worker': portBase, 'outbox-worker': portBase + 1 };
const activeWorkers: WorkerProcess[] = [];

describe.sequential('P0-H4 Operations to true-process worker linkage', { timeout: 300000 }, () => {
  let app: INestApplication;
  let operations: AdminOperationsService;

  beforeAll(async () => {
    for (const entry of Object.values(entries)) {
      if (!existsSync(entry)) throw new Error('Worker dist entrypoint is missing. Run the API build before this focused gate.');
    }
    await ensureContainerRunning('lazy-armor-p0-mysql-1');
    await ensureContainerRunning('lazy-armor-p0-redis-1');
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'development';
    process.env.APP_ROLE = 'api';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 12).toString('base64');
    process.env.CREDENTIAL_STORE_PATH = `.data/test-h4-operations-linkage-${Date.now()}`;
    process.env.WORKER_PROBE_HOST = '127.0.0.1';
    process.env.WORKER_READINESS_TIMEOUT_MS = '800';
    process.env.EXECUTION_WORKER_PROBE_PORT = String(ports['execution-worker']);
    process.env.OUTBOX_WORKER_PROBE_PORT = String(ports['outbox-worker']);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    operations = app.get(AdminOperationsService);
  });

  afterAll(async () => {
    while (activeWorkers.length) await stopWorker(activeWorkers.pop()!);
    await ensureContainerRunning('lazy-armor-p0-redis-1');
    await ensureContainerRunning('lazy-armor-p0-mysql-1');
    await app?.close();
  });

  it('reports DOWN, UP, dependency DEGRADED, process restart, and truthful metric availability for both workers', async () => {
    const before = await operations.workers();
    expect(before.executionWorker).toMatchObject({ processStatus: 'DOWN', status: 'DOWN' });
    expect(before.outboxWorker).toMatchObject({ processStatus: 'DOWN', status: 'DOWN' });

    let execution = await startWorker('execution-worker');
    let outbox = await startWorker('outbox-worker');
    const up = await waitForWorkers((workers) => bothWorkers(workers, (worker) => worker.status === 'UP'));
    assertReady(up.executionWorker);
    assertReady(up.outboxWorker);

    stopContainer('lazy-armor-p0-redis-1');
    const redisDegraded = await waitForWorkers((workers) => bothWorkers(workers, (worker) => worker.processStatus === 'UP' && worker.liveness === 'UP' && worker.status === 'DEGRADED' && worker.readiness.status === 'not_ready' && worker.readiness.redis !== 'PONG'), 45_000);
    expect(redisDegraded.executionWorker.readiness.reason).toMatch(/redis|bullmq|dependency/i);
    expect(redisDegraded.outboxWorker.readiness.reason).toMatch(/redis|bullmq|dependency/i);

    startContainer('lazy-armor-p0-redis-1');
    await ensureContainerHealthy('lazy-armor-p0-redis-1');
    await waitForWorkers((workers) => bothWorkers(workers, (worker) => worker.status === 'UP'), 45_000);

    stopContainer('lazy-armor-p0-mysql-1');
    const mysqlDegraded = await waitForWorkers((workers) => bothWorkers(workers, (worker) => worker.processStatus === 'UP' && worker.status === 'DEGRADED' && worker.readiness.status === 'not_ready' && worker.readiness.mysql !== 'ready' && worker.dataStatus === 'unavailable'), 60_000);
    expect(mysqlDegraded.executionWorker.readiness.reason).toMatch(/mysql|dependency/i);
    expect(mysqlDegraded.outboxWorker.readiness.reason).toMatch(/mysql|dependency/i);
    expect(mysqlDegraded.executionWorker).toMatchObject({ queueBacklog: null, activeWork: null, failureCount: null, recentFailures: [] });
    expect(mysqlDegraded.outboxWorker).toMatchObject({ queueBacklog: null, activeWork: null, failureCount: null, recentFailures: [] });

    const [outboxUnavailable, executionsUnavailable, overviewUnavailable] = await Promise.all([
      operations.outbox(), operations.executions(), operations.overview(),
    ]);
    expect(outboxUnavailable).toMatchObject({ dataStatus: 'unavailable', deadCount: null, pendingCount: null, retryWaitCount: null, recentFailures: [] });
    expect(executionsUnavailable).toMatchObject({ dataStatus: 'unavailable', recentFailed: [], stuck: [] });
    expect(overviewUnavailable).toMatchObject({ status: 'DEGRADED', dataStatus: 'unavailable' });

    startContainer('lazy-armor-p0-mysql-1');
    await ensureContainerHealthy('lazy-armor-p0-mysql-1', 60_000);
    const mysqlRecovered = await waitForWorkers((workers) => bothWorkers(workers, (worker) => worker.status === 'UP' && worker.dataStatus === 'available'), 60_000);
    expect(mysqlRecovered.executionWorker.readiness.mysql).toBe('ready');
    expect(mysqlRecovered.outboxWorker.readiness.mysql).toBe('ready');
    expect((await operations.outbox()).dataStatus).toBe('available');
    expect((await operations.executions()).dataStatus).toBe('available');

    await stopWorker(execution);
    let killed = await waitForWorkers((workers) => workers.executionWorker.processStatus === 'DOWN' && workers.executionWorker.status === 'DOWN');
    expect(killed.executionWorker.liveness).toBe('DOWN');
    execution = await startWorker('execution-worker');
    await waitForWorkers((workers) => workers.executionWorker.status === 'UP');

    await stopWorker(outbox);
    killed = await waitForWorkers((workers) => workers.outboxWorker.processStatus === 'DOWN' && workers.outboxWorker.status === 'DOWN');
    expect(killed.outboxWorker.liveness).toBe('DOWN');
    outbox = await startWorker('outbox-worker');
    await waitForWorkers((workers) => bothWorkers(workers, (worker) => worker.status === 'UP'));

    await stopWorker(execution);
    await stopWorker(outbox);
  });

  async function waitForWorkers(predicate: (workers: any) => boolean, timeoutMs = 30_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      last = await operations.workers();
      if (predicate(last)) return last;
      await sleep(300);
    }
    throw new Error(`Operations worker state did not converge: ${JSON.stringify(last)}`);
  }
});

function bothWorkers(workers: any, predicate: (worker: any) => boolean) {
  return predicate(workers.executionWorker) && predicate(workers.outboxWorker);
}

function assertReady(worker: any) {
  expect(worker).toMatchObject({ processStatus: 'UP', liveness: 'UP', status: 'UP', dataStatus: 'available', readiness: { status: 'ready', mysql: 'ready', redis: 'PONG', bullmq: 'ready' } });
}

async function startWorker(role: WorkerRole): Promise<WorkerProcess> {
  const output: string[] = [];
  const child = spawn(process.execPath, [entries[role]], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development', APP_ENV: 'development', APP_ROLE: role,
      EXECUTION_WORKER_PROBE_PORT: String(ports['execution-worker']),
      OUTBOX_WORKER_PROBE_PORT: String(ports['outbox-worker']),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));
  const worker = { child, role, probePort: ports[role], output };
  activeWorkers.push(worker);
  await waitForProbe(worker.probePort, '/live', 200, 30_000, worker);
  return worker;
}

async function stopWorker(worker: WorkerProcess) {
  const index = activeWorkers.indexOf(worker);
  if (index >= 0) activeWorkers.splice(index, 1);
  if (worker.child.exitCode !== null) return;
  worker.child.kill('SIGTERM');
  if (await waitForExit(worker.child, 8_000)) return;
  if (worker.child.pid) {
    try { execFileSync('taskkill', ['/PID', String(worker.child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
  if (!(await waitForExit(worker.child, 4_000))) throw new Error(`Worker did not exit: ${worker.output.join('')}`);
}

async function waitForProbe(port: number, pathName: '/live' | '/ready', status: number, timeoutMs: number, worker: WorkerProcess) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}${pathName}`); if (response.status === status) return await response.json(); } catch {}
    if (worker.child.exitCode !== null) throw new Error(`${worker.role} exited early: ${worker.output.join('')}`);
    await sleep(250);
  }
  throw new Error(`${worker.role} probe did not reach ${status}: ${worker.output.join('')}`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

function stopContainer(name: string) { execFileSync('docker', ['stop', '--time', '1', name], { cwd: repoRoot, stdio: 'ignore' }); }
function startContainer(name: string) { execFileSync('docker', ['start', name], { cwd: repoRoot, stdio: 'ignore' }); }

async function ensureContainerRunning(name: string) {
  try {
    const state = execFileSync('docker', ['inspect', '-f', '{{.State.Status}}', name], { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (state !== 'running') startContainer(name);
  } catch {
    execFileSync('docker', ['compose', '-f', dockerComposePath, 'up', '-d', name.includes('mysql') ? 'mysql' : 'redis'], { cwd: repoRoot, stdio: 'ignore' });
  }
  await ensureContainerHealthy(name);
}

async function ensureContainerHealthy(name: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = execFileSync('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name], { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (health === 'healthy' || health === 'running') return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Container did not become healthy: ${name}`);
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
