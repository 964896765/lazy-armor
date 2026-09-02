import type { INestApplicationContext } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { MYSQL_POOL } from '../src/common/database.module';
import { EXECUTION_WORKER, OUTBOX_WORKER } from '../src/execution/execution.module';
import { WorkerProbe } from '../src/entrypoints/worker-probe';
import { QueueService } from '../src/infrastructure/queue.service';

describe.sequential('P0-H4 worker probe bounded readiness', () => {
  let probe: WorkerProbe | undefined;

  afterEach(async () => {
    await probe?.close();
    probe = undefined;
    delete process.env.APP_ROLE;
    delete process.env.EXECUTION_WORKER_PROBE_PORT;
    delete process.env.OUTBOX_WORKER_PROBE_PORT;
    delete process.env.WORKER_READINESS_TIMEOUT_MS;
  });

  it('serves /live and /ready for a healthy standalone execution worker', async () => {
    process.env.APP_ROLE = 'execution-worker';
    process.env.EXECUTION_WORKER_PROBE_PORT = '34111';
    process.env.WORKER_READINESS_TIMEOUT_MS = '500';
    probe = new WorkerProbe(fakeApp({
      mysql: async () => [['ok']],
      queueHealth: async () => ({ redis: 'PONG', bullmq: 'ready', counts: { waiting: 0, delayed: 0, active: 0, failed: 0 } }),
      executionReadiness: async () => ({ ready: true, reason: null }),
    }));
    await probe.listen();

    const live = await fetch('http://127.0.0.1:34111/live');
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({
      status: 'ok',
      role: 'execution-worker',
    });

    const ready = await fetch('http://127.0.0.1:34111/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ready',
      role: 'execution-worker',
      mysql: 'ready',
      redis: 'PONG',
      bullmq: 'ready',
      worker: {
        ready: true,
        reason: null,
      },
    });
  });

  it('returns 503 within the configured timeout when readiness hangs', async () => {
    process.env.APP_ROLE = 'execution-worker';
    process.env.EXECUTION_WORKER_PROBE_PORT = '34112';
    process.env.WORKER_READINESS_TIMEOUT_MS = '250';
    probe = new WorkerProbe(fakeApp({
      mysql: async () => [['ok']],
      queueHealth: async () => await new Promise(() => undefined),
      executionReadiness: async () => ({ ready: true, reason: null }),
    }));
    await probe.listen();

    const startedAt = Date.now();
    const ready = await fetch('http://127.0.0.1:34112/ready');
    const elapsedMs = Date.now() - startedAt;
    expect(ready.status).toBe(503);
    expect(elapsedMs).toBeLessThan(1_500);
    expect(await ready.json()).toMatchObject({
      status: 'not_ready',
      role: 'execution-worker',
      reason: 'readiness_timeout',
    });
  });

  it('keeps /live healthy while /ready reports outbox readiness failure', async () => {
    process.env.APP_ROLE = 'outbox-worker';
    process.env.OUTBOX_WORKER_PROBE_PORT = '34113';
    process.env.WORKER_READINESS_TIMEOUT_MS = '500';
    probe = new WorkerProbe(fakeApp({
      mysql: async () => [['ok']],
      queueHealth: async () => ({ redis: 'PONG', bullmq: 'ready', counts: { waiting: 3, delayed: 1, active: 0, failed: 0 } }),
      outboxReadiness: () => ({ ready: false, reason: 'redis_unavailable' }),
    }));
    await probe.listen();

    const live = await fetch('http://127.0.0.1:34113/live');
    expect(live.status).toBe(200);

    const ready = await fetch('http://127.0.0.1:34113/ready');
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      status: 'not_ready',
      role: 'outbox-worker',
      queueCounts: {
        waiting: 3,
        delayed: 1,
        active: 0,
        failed: 0,
      },
      worker: {
        ready: false,
        reason: 'redis_unavailable',
      },
      reason: 'redis_unavailable',
    });
  });
});

function fakeApp(input: {
  mysql: () => Promise<unknown>;
  queueHealth: () => Promise<{ redis: string; bullmq: string; counts: Record<string, number> }>;
  executionReadiness?: () => Promise<{ ready: boolean; reason: string | null }>;
  outboxReadiness?: () => { ready: boolean; reason: string | null };
}) {
  return {
    get(token: unknown) {
      if (token === MYSQL_POOL) return { query: input.mysql };
      if (token === QueueService) return { health: input.queueHealth };
      if (token === EXECUTION_WORKER) return { readiness: input.executionReadiness ?? (async () => ({ ready: false, reason: 'execution_worker_not_running' })) };
      if (token === OUTBOX_WORKER) return { readiness: input.outboxReadiness ?? (() => ({ ready: false, reason: 'outbox_worker_not_running' })) };
      throw new Error(`Unexpected provider lookup: ${String(token)}`);
    },
  } as unknown as INestApplicationContext;
}
