import { createServer, type Server } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { currentAppRole } from '../common/app-role';
import { MYSQL_POOL } from '../common/database.module';
import { EXECUTION_WORKER, OUTBOX_WORKER } from '../execution/execution.module';
import { QueueService } from '../infrastructure/queue.service';

interface WorkerHealth { ready: boolean; reason: string | null }
type ProbeReadiness = {
  status: 'ready' | 'not_ready';
  role: string;
  checkedAt: string;
  mysql?: string;
  redis?: string;
  bullmq?: string;
  queueCounts?: Record<string, number>;
  worker?: { ready?: boolean; reason?: string | null };
  reason?: string | null;
};

export class WorkerProbe {
  private server?: Server;
  constructor(private readonly app: INestApplicationContext) {}

  async listen() {
    const role = currentAppRole();
    if (role !== 'execution-worker' && role !== 'outbox-worker') throw new Error('Worker probe can only run in a standalone worker process');
    const port = Number(process.env[role === 'execution-worker' ? 'EXECUTION_WORKER_PROBE_PORT' : 'OUTBOX_WORKER_PROBE_PORT'] ?? (role === 'execution-worker' ? 3011 : 3012));
    const host = process.env.WORKER_PROBE_HOST ?? '127.0.0.1';
    this.server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/live') { response.statusCode = 200; response.end(JSON.stringify({ status: 'ok', role, checkedAt: new Date().toISOString() })); return; }
      if (request.url !== '/ready') { response.statusCode = 404; response.end(JSON.stringify({ status: 'not_found' })); return; }
      try {
        const readiness = await this.readiness();
        response.statusCode = readiness.status === 'ready' ? 200 : 503;
        response.end(JSON.stringify(readiness));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'readiness_check_failed';
        response.statusCode = 503;
        response.end(JSON.stringify({ status: 'not_ready', role, checkedAt: new Date().toISOString(), reason }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => { this.server!.off('error', reject); resolve(); });
    });
    return { role, host, port };
  }

  async close() {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
    this.server = undefined;
  }

  private async readiness(): Promise<ProbeReadiness> {
    const role = currentAppRole();
    const pool = this.app.get<Pool>(MYSQL_POOL);
    const timeoutMs = this.readinessTimeoutMs();
    const [mysql, queue, worker] = await Promise.all([
      this.withTimeout(pool.query('SELECT 1'), timeoutMs, 'mysql_timeout')
        .then(() => ({ status: 'ready' as const, timedOut: false }))
        .catch((error) => ({ status: 'unavailable' as const, timedOut: error instanceof Error && error.message === 'mysql_timeout' })),
      this.withTimeout(this.app.get(QueueService).health(), timeoutMs, 'queue_timeout')
        .then((health) => ({ health, timedOut: false }))
        .catch((error) => ({
          health: { redis: 'unavailable', bullmq: 'unavailable', counts: {} },
          timedOut: error instanceof Error && error.message === 'queue_timeout',
        })),
      this.withTimeout(Promise.resolve(role === 'execution-worker'
        ? this.app.get<{ readiness(): Promise<WorkerHealth> }>(EXECUTION_WORKER).readiness()
        : this.app.get<{ readiness(): WorkerHealth }>(OUTBOX_WORKER).readiness()), timeoutMs, 'worker_timeout')
        .then((health) => ({ health, timedOut: false }))
        .catch((error) => ({
          health: { ready: false, reason: error instanceof Error ? error.message : 'worker_readiness_failed' },
          timedOut: error instanceof Error && error.message === 'worker_timeout',
        })),
    ]);
    const ready = mysql.status === 'ready' && queue.health.redis === 'PONG' && queue.health.bullmq === 'ready' && worker.health.ready;
    const reason = ready
      ? null
      : mysql.timedOut || queue.timedOut || worker.timedOut
        ? 'readiness_timeout'
        : mysql.status !== 'ready'
          ? 'mysql_dependency_unavailable'
          : queue.health.redis !== 'PONG' || queue.health.bullmq !== 'ready'
            ? 'redis_or_bullmq_dependency_unavailable'
            : worker.health.reason ?? 'worker_not_ready';
    return {
      status: ready ? 'ready' : 'not_ready',
      role,
      checkedAt: new Date().toISOString(),
      mysql: mysql.status,
      redis: queue.health.redis,
      bullmq: queue.health.bullmq,
      queueCounts: queue.health.counts,
      worker: worker.health,
      reason,
    };
  }

  private readinessTimeoutMs() {
    const parsed = Number(process.env.WORKER_READINESS_TIMEOUT_MS ?? 3_000);
    return Number.isFinite(parsed) && parsed >= 200 ? parsed : 3_000;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
