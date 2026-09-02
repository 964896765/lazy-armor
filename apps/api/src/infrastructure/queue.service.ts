import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ObservabilityService } from '../observability/observability.service';

export type QueuePriorityClass = 'critical' | 'high' | 'normal' | 'low';
const PRIORITY_VALUE: Record<QueuePriorityClass, number> = { critical: 1, high: 2, normal: 5, low: 10 };

export function admissionForDepth(depth: number, threshold: number, priority: QueuePriorityClass) {
  if (depth < threshold || priority === 'critical' || priority === 'high') return { delayMs: 0, deferred: false };
  return priority === 'low' ? { delayMs: 30_000, deferred: true } : { delayMs: 5_000, deferred: true };
}

@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly redis: IORedis;
  private readonly foundationQueue: Queue;
  private readonly executionQueue: Queue<{ executionId: string }>;
  private readonly backpressureThreshold: number;
  private failNextExecutionEnqueue = false;

  constructor(config: ConfigService, private readonly telemetry: ObservabilityService) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    const prefix = config.get<string>('REDIS_KEY_PREFIX');
    const queueOptions = { connection: this.redis, ...(prefix ? { prefix } : {}) };
    this.backpressureThreshold = config.get<number>('QUEUE_BACKPRESSURE_THRESHOLD') ?? 10_000;
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

  async addExecution(executionId: string, policy: { maxAttempts: number; initialDelayMs: number }, delay = 0, priorityClass: QueuePriorityClass = 'normal') {
    if (this.failNextExecutionEnqueue && process.env.NODE_ENV === 'test') {
      this.failNextExecutionEnqueue = false;
      this.telemetry.increment('queue.error_count', 1, { queue: 'lazy-armor-executions', operation: 'addExecution' });
      throw new Error('Simulated queue outage');
    }
    const counts = await this.executionQueue.getJobCounts('waiting', 'delayed', 'active');
    const depth = Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0) + Number(counts.active ?? 0);
    const admission = admissionForDepth(depth, this.backpressureThreshold, priorityClass);
    const effectiveDelay = Math.max(delay, admission.delayMs);
    const job = await this.executionQueue.add('execute', { executionId }, {
      jobId: executionId,
      delay: effectiveDelay,
      priority: PRIORITY_VALUE[priorityClass],
      attempts: policy.maxAttempts,
      backoff: { type: 'exponential', delay: policy.initialDelayMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.telemetry.increment('queue.enqueue_count', 1, { queue: 'lazy-armor-executions' });
    this.telemetry.event('log', 'execution_enqueued', { executionId, delayMs: effectiveDelay, priorityClass, backpressureDeferred: admission.deferred });
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
    return this.addExecution(executionId, policy, 0, 'high');
  }
  failNextEnqueueForTest() { if (process.env.NODE_ENV !== 'test') throw new Error('Test hook is disabled'); this.failNextExecutionEnqueue = true; }

  async onApplicationShutdown() {
    await Promise.all([this.foundationQueue.close(), this.executionQueue.close()]);
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
