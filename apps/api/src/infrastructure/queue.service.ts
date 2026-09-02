import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly redis: IORedis;
  private readonly foundationQueue: Queue;
  private readonly executionQueue: Queue<{ executionId: string }>;
  private failNextExecutionEnqueue = false;

  constructor(config: ConfigService) {
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
    return { redis, bullmq: 'ready', counts };
  }

  async addExecution(executionId: string, policy: { maxAttempts: number; initialDelayMs: number }, delay = 0) {
    if (this.failNextExecutionEnqueue && process.env.NODE_ENV === 'test') {
      this.failNextExecutionEnqueue = false;
      throw new Error('Simulated queue outage');
    }
    return this.executionQueue.add('execute', { executionId }, {
      jobId: executionId,
      delay,
      attempts: policy.maxAttempts,
      backoff: { type: 'exponential', delay: policy.initialDelayMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
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
    return this.addExecution(executionId, policy);
  }
  failNextEnqueueForTest() { if (process.env.NODE_ENV !== 'test') throw new Error('Test hook is disabled'); this.failNextExecutionEnqueue = true; }

  async onApplicationShutdown() {
    await Promise.all([this.foundationQueue.close(), this.executionQueue.close()]);
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
