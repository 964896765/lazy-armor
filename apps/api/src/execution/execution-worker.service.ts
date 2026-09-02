import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ExecutionRunner } from './execution-runner.service';
import { ExecutionLeaseService } from './execution-lease.service';
import { workerEnabled } from '../common/app-role';
import { ObservabilityService } from '../observability/observability.service';

@Injectable()
export class ExecutionWorker implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker<{ executionId: string }>;
  private redis?: IORedis;

  constructor(
    private readonly config: ConfigService,
    private readonly runner: ExecutionRunner,
    private readonly lease: ExecutionLeaseService,
    private readonly telemetry: ObservabilityService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('execution-worker')) return;
    this.redis = new IORedis(this.config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null });
    const prefix = this.config.get<string>('REDIS_KEY_PREFIX');
    this.worker = new Worker('lazy-armor-executions', async (job) => {
      const outcome = await this.processExecution(job.data.executionId);
      if (outcome.retryScheduled) throw new Error('CONTROLLED_RETRY_SCHEDULED');
      return outcome;
    }, { connection: this.redis, concurrency: 4, ...(prefix ? { prefix } : {}) });
  }

  async processExecution(executionId: string) {
    const lease = await this.lease.acquire(executionId);
    if (!lease.acquired) {
      this.telemetry.event('warn', 'execution_worker_lease_skipped', { executionId, status: lease.status });
      return { status: lease.status };
    }
    const heartbeat = setInterval(() => {
      void this.lease.heartbeat(executionId, lease.workerToken).catch(() => undefined);
    }, Math.max(100, Math.floor(this.lease.leaseDurationMs / 3)));
    heartbeat.unref();
    try {
      return this.telemetry.runWithContext({ executionId }, async () => {
        this.telemetry.event('log', 'execution_worker_started', { executionId });
        const outcome = await this.runner.run(executionId, lease.workerToken);
        this.telemetry.event('log', 'execution_worker_finished', { executionId, status: outcome.status });
        return outcome;
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  async readiness() {
    if (!this.worker) return { ready: false, reason: 'execution_worker_not_running' };
    await this.worker.waitUntilReady();
    return { ready: this.worker.isRunning(), reason: this.worker.isRunning() ? null : 'execution_worker_not_running' };
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    if (this.redis && this.redis.status !== 'end') await this.redis.quit();
  }
}
