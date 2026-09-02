import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ObservabilityService } from '../observability/observability.service';

@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly redis: IORedis;
  private readonly foundationQueue: Queue;
  private readonly executionQueue: Queue<{ executionId: string }>;
  private failNextExecutionEnqueue = false;

  constructor(config: ConfigService, private readonly telemetry: ObservabilityService) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    const prefix = config.get<string>('REDIS_KEY_PREFIX');
    const queueOptions = { connection: this.redis, ...(prefix ? { prefix } : {}) };
    this.foundationQueue = new Queue('lazy-armor-foundation', queueOptions);
    this.executionQueue = new Queue<{ executionId: string }>('lazy-armor-executions', queueOptions);
  }

  async health() {
    if (this.redis.status === 'wait') await this.redis.connect();
    const redis = await this.redis.ping();
    await Promise.all([this.foundationQueue.waitUntilReady(), this.executionQueue.waitUntilReady()]);
    const counts = await this.executionQueue.getJobCounts('waiting', 'delayed', 'active', 'failed');
    this.telemetry.gauge('queue.waiting', Number(counts.waiting ?? 0), { queue: 'lazy-armor-executions' });
    this.telemetry.gauge('queue.active', Number(counts.active ?? 0), { queue: 'lazy-armor-executions' });
    this.telemetry.gauge('queue.delayed', Number(counts.delayed ?? 0), { queue: 'lazy-armor-executions' });
    this.telemetry.gauge('queue.failed', Number(counts.failed ?? 0), { queue: 'lazy-armor-executions' });
    return { redis, bullmq: 'ready', counts };
  }

  async addExecution(executionId: string, policy: { maxAttempts: number; initialDelayMs: number }, delay = 0) {
    if (this.failNextExecutionEnqueue && process.env.NODE_ENV === 'test') {
      this.failNextExecutionEnqueue = false;
      this.telemetry.increment('queue.error_count', 1, { queue: 'lazy-armor-executions', operation: 'addExecution' });
      throw new Error('Simulated queue outage');
    }
    const job = await this.executionQueue.add('execute', { executionId }, {
      jobId: executionId,
      delay,
      attempts: policy.maxAttempts,
      backoff: { type: 'exponential', delay: policy.initialDelayMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.telemetry.increment('queue.enqueue_count', 1, { queue: 'lazy-armor-executions' });
    this.telemetry.event('log', 'execution_enqueued', { executionId, delayMs: delay });
    return job;
  }

  async hasExecutionJob(executionId: string) { return Boolean(await this.executionQueue.getJob(executionId)); }
  async removeExecutionJob(executionId: string) { const job = await this.executionQueue.getJob(executionId); if (job && !(await job.isActive())) await job.remove(); }
  async resumeExecution(executionId: string, policy: { maxAttempts: number; initialDelayMs: number }) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const prior = await this.executionQueue.getJob(executionId);
      if (!prior) break;
      if (!(await prior.isActive())) { await prior.remove(); break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const remaining = await this.executionQueue.getJob(executionId);
    if (remaining) throw new Error('Previous Execution job is still active');
    this.telemetry.increment('queue.resume_count', 1, { queue: 'lazy-armor-executions' });
    return this.addExecution(executionId, policy);
  }
  failNextEnqueueForTest() { if (process.env.NODE_ENV !== 'test') throw new Error('Test hook is disabled'); this.failNextExecutionEnqueue = true; }

  async onApplicationShutdown() {
    await Promise.all([this.foundationQueue.close(), this.executionQueue.close()]);
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
