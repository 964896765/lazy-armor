import { createServer, type Server } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { currentAppRole } from '../common/app-role';
import { MYSQL_POOL } from '../common/database.module';
import { EXECUTION_WORKER, OUTBOX_WORKER } from '../execution/execution.module';
import { QueueService } from '../infrastructure/queue.service';

interface WorkerHealth { ready: boolean; reason: string | null }

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
      if (request.url === '/live') { response.statusCode = 200; response.end(JSON.stringify({ status: 'ok', role })); return; }
      if (request.url !== '/ready') { response.statusCode = 404; response.end(JSON.stringify({ status: 'not_found' })); return; }
      try {
        const readiness = await this.readiness();
        response.statusCode = readiness.status === 'ready' ? 200 : 503;
        response.end(JSON.stringify(readiness));
      } catch {
        response.statusCode = 503;
        response.end(JSON.stringify({ status: 'not_ready', role }));
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

  private async readiness() {
    const role = currentAppRole();
    const pool = this.app.get<Pool>(MYSQL_POOL);
    await pool.query('SELECT 1');
    const queue = await this.app.get(QueueService).health();
    const worker = role === 'execution-worker'
      ? await this.app.get<{ readiness(): Promise<WorkerHealth> }>(EXECUTION_WORKER).readiness()
      : this.app.get<{ readiness(): WorkerHealth }>(OUTBOX_WORKER).readiness();
    const ready = queue.bullmq === 'ready' && worker.ready;
    return { status: ready ? 'ready' : 'not_ready', role, mysql: 'ready', redis: queue.redis, bullmq: queue.bullmq, worker };
  }
}
