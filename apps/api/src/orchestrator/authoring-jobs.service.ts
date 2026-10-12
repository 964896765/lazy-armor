import { ConflictException, Inject, Injectable, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { authoringJobs, consumerConversations, consumerMessages } from '@lazy-armor/database';
import { authoringJobProjectionSchema, authoringJobTerminal, goalBriefSchema, type AuthoringJobProjection } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { workerEnabled } from '../common/app-role';

export type AuthoringTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
export type AuthoringJobRow = typeof authoringJobs.$inferSelect;
type Job = AuthoringJobRow;
export type AuthoringJobClaim = Job & { leaseToken: string };
export interface AuthoringJobProcessor { processAuthoringJob(claim: AuthoringJobClaim): Promise<void> }
export interface AdmitAuthoringJob {
  userId: string; conversationId: string; requestId: string; inputMessageId: string; inputHash: string;
  sourceConversationVersion: number; payloadJson: Record<string, unknown>;
  resultMessageId?: string;
}
export class AuthoringJobFenceError extends Error {
  constructor(readonly code: string) { super(code); }
}
const LEASE_MS = 30_000;
const DEADLINE_MS = 350_000;
const MAX_ATTEMPTS = 2;

/** Durable computation/admission. Does not create or authorize Execution, Plan or Truth. */
@Injectable()
export class AuthoringJobsService implements OnModuleInit, OnApplicationShutdown {
  private queue?: Queue<{ jobId: string }>;
  private worker?: Worker<{ jobId: string }>;
  private redis?: IORedis;
  private recovery?: ReturnType<typeof setInterval>;
  private recovering = false;
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService,
    private readonly modules: ModuleRef) {}

  private queueClient() {
    if (!this.redis) this.redis = new IORedis(this.config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    if (!this.queue) this.queue = new Queue('lazy-armor-authoring', { connection: this.redis, prefix: this.config.get<string>('REDIS_KEY_PREFIX') || 'bull' });
    return this.queue;
  }
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('execution-worker')) return;
    this.queueClient();
    this.worker = new Worker('lazy-armor-authoring', job => this.process(job.data.jobId), {
      connection: this.redis!, prefix: this.config.get<string>('REDIS_KEY_PREFIX') || 'bull', concurrency: 2, lockDuration: LEASE_MS,
    });
    this.worker.on('error', () => undefined);
    this.recovery = setInterval(() => { void this.recover().catch(() => undefined); }, 15_000);
    void this.recover().catch(() => undefined);
  }

  /** Caller saves the user message and PROCESSING/version marker in this same transaction. */
  async admit(tx: AuthoringTransaction, input: AdmitAuthoringJob): Promise<AuthoringJobRow> {
    if (!/^[a-f0-9]{64}$/.test(input.inputHash) || !input.requestId || input.requestId.length > 100
      || !Number.isSafeInteger(input.sourceConversationVersion) || input.sourceConversationVersion < 1
      || Buffer.byteLength(JSON.stringify(input.payloadJson), 'utf8') > 128_000) throw new ConflictException('AUTHORING_INPUT_INVALID');
    const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, input.conversationId), eq(consumerConversations.userId, input.userId))).for('update'))[0];
    const prior = (await tx.select().from(authoringJobs).where(and(eq(authoringJobs.userId, input.userId), eq(authoringJobs.conversationId, input.conversationId), eq(authoringJobs.requestId, input.requestId))).for('update'))[0];
    if (prior) {
      if (prior.inputHash !== input.inputHash || prior.inputMessageId !== input.inputMessageId || prior.sourceConversationVersion !== input.sourceConversationVersion) throw new ConflictException('AUTHORING_REPLAY_MISMATCH');
      if (input.resultMessageId && input.resultMessageId !== prior.resultMessageId) throw new ConflictException('AUTHORING_REPLAY_MISMATCH');
      return prior;
    }
    if (!conversation || conversation.deletedAt || conversation.archivedAt || conversation.version !== input.sourceConversationVersion || conversation.status !== 'PROCESSING') throw new ConflictException('AUTHORING_SOURCE_CHANGED');
    const message = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, input.inputMessageId), eq(consumerMessages.conversationId, input.conversationId), eq(consumerMessages.role, 'user'), eq(consumerMessages.requestId, input.requestId))))[0];
    if (!message) throw new ConflictException('AUTHORING_INPUT_MESSAGE_REQUIRED');
    const now = new Date();
    const row: Job = { id: newId(), ...input, status: 'QUEUED', stage: 'QUEUED', revision: 0,
      attemptCount: 0, maxAttempts: MAX_ATTEMPTS, leaseToken: null, leaseExpiresAt: null,
      deadlineAt: new Date(now.getTime() + DEADLINE_MS), cancelRequestedAt: null,
      resultMessageId: input.resultMessageId ?? null, errorCode: null, finishedAt: null, createdAt: now, updatedAt: now };
    await tx.insert(authoringJobs).values(row);
    return row;
  }
  async enqueue(jobId: string) {
    await this.queueClient().add('author', { jobId }, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
  async get(userId: string, jobId: string) {
    const row = (await this.db.select().from(authoringJobs).where(and(eq(authoringJobs.id, jobId), eq(authoringJobs.userId, userId))))[0];
    if (!row) throw new NotFoundException('Authoring job not found');
    const conversation = (await this.db.select({ id: consumerConversations.id }).from(consumerConversations).where(and(eq(consumerConversations.id, row.conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))))[0];
    if (!conversation) throw new NotFoundException('Authoring job not found');
    return this.project(row);
  }
  async list(userId: string, conversationId: string) {
    const owned = (await this.db.select({ id: consumerConversations.id }).from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))))[0];
    if (!owned) throw new NotFoundException('Conversation not found');
    return (await this.db.select().from(authoringJobs).where(and(eq(authoringJobs.userId, userId), eq(authoringJobs.conversationId, conversationId)))
      .orderBy(desc(authoringJobs.createdAt), desc(authoringJobs.id)).limit(100)).reverse().map(row => this.project(row));
  }
  listForConversation(userId: string, conversationId: string) { return this.list(userId, conversationId); }

  /** Old clients need a final response even when a worker already owns the persisted lease. */
  async waitForTerminal(userId: string, jobId: string): Promise<AuthoringJobProjection> {
    let lastClaimCheck = 0;
    while (true) {
      const current = await this.get(userId, jobId);
      if (authoringJobTerminal(current.status)) return current;
      const now = Date.now(), remaining = Date.parse(current.deadlineAt) - now;
      if (current.status === 'QUEUED' || remaining <= 0 || now - lastClaimCheck >= 1000) {
        lastClaimCheck = now;
        // Claim enforces deadline, attempts, source version and ownership of the current lease.
        await this.process(jobId);
        const settled = await this.get(userId, jobId);
        if (authoringJobTerminal(settled.status)) return settled;
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(1, Math.min(250, remaining))));
    }
  }

  private sourceCurrent(conversation: typeof consumerConversations.$inferSelect | undefined, row: Job) {
    return Boolean(conversation && conversation.userId === row.userId && !conversation.deletedAt && !conversation.archivedAt
      && conversation.version === row.sourceConversationVersion && conversation.status === 'PROCESSING');
  }
  /** Consistent lock order: Conversation then Job, including final consumer result transactions. */
  private async lock(tx: AuthoringTransaction, row: Job) {
    const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, row.conversationId), eq(consumerConversations.userId, row.userId))).for('update'))[0];
    const current = (await tx.select().from(authoringJobs).where(and(eq(authoringJobs.id, row.id), eq(authoringJobs.userId, row.userId))).for('update'))[0];
    return { conversation, current };
  }
  private async stop(tx: AuthoringTransaction, row: Job, status: 'FAILED' | 'CANCELLED' | 'SUPERSEDED', errorCode: string,
    conversation?: typeof consumerConversations.$inferSelect) {
    const now = new Date();
    const next: Job = { ...row, status, stage: 'STOPPED', errorCode, leaseToken: null, leaseExpiresAt: null,
      revision: row.revision + 1, finishedAt: now, updatedAt: now,
      ...(status === 'CANCELLED' ? { cancelRequestedAt: now } : {}) };
    await tx.update(authoringJobs).set({ status: next.status, stage: next.stage, errorCode: next.errorCode, leaseToken: null, leaseExpiresAt: null,
      revision: next.revision, finishedAt: now, updatedAt: now, cancelRequestedAt: next.cancelRequestedAt }).where(eq(authoringJobs.id, row.id));
    if (row.resultMessageId) {
      const placeholder = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, row.resultMessageId), eq(consumerMessages.conversationId, row.conversationId), eq(consumerMessages.requestId, row.requestId), eq(consumerMessages.role, 'assistant'))).for('update'))[0];
      const brief = goalBriefSchema.safeParse(placeholder?.structuredPayload?.goalBrief);
      if (placeholder) await tx.update(consumerMessages).set({
        content: status === 'CANCELLED' ? '本次需求处理已取消。' : status === 'SUPERSEDED' ? '目标已更新，本次历史建议处理已停止。' : '本次需求处理暂未完成，已保留原需求，可以重试。',
        // Preserve checked requirement metadata for the next conversation turn, never a runnable proposal.
        structuredPayload: { result: 'AUTHORING_STOPPED', authoringJob: this.project(next), ...(brief.success ? { goalBrief: brief.data } : {}) },
      }).where(eq(consumerMessages.id, placeholder.id));
    }
    if (this.sourceCurrent(conversation, row)) await tx.update(consumerConversations).set({ status: 'ACTIVE', version: conversation!.version + 1, updatedAt: now }).where(eq(consumerConversations.id, row.conversationId));
  }
  async cancel(userId: string, jobId: string) {
    const row = (await this.db.select().from(authoringJobs).where(and(eq(authoringJobs.id, jobId), eq(authoringJobs.userId, userId))))[0];
    if (!row) throw new NotFoundException('Authoring job not found');
    await this.db.transaction(async tx => {
      const { conversation, current } = await this.lock(tx, row);
      if (!conversation || conversation.deletedAt) throw new NotFoundException('Authoring job not found');
      if (!current || authoringJobTerminal(current.status as AuthoringJobProjection['status'])) return;
      await this.stop(tx, current, this.sourceCurrent(conversation, current) ? 'CANCELLED' : 'SUPERSEDED', 'AUTHORING_CANCELLED', conversation);
    });
    return this.get(userId, jobId);
  }
  async claim(jobId: string): Promise<AuthoringJobClaim | null> {
    const row = (await this.db.select().from(authoringJobs).where(eq(authoringJobs.id, jobId)))[0];
    if (!row) return null;
    return this.db.transaction(async tx => {
      const { conversation, current } = await this.lock(tx, row);
      if (!current || authoringJobTerminal(current.status as AuthoringJobProjection['status'])) return null;
      if (!this.sourceCurrent(conversation, current)) { await this.stop(tx, current, 'SUPERSEDED', 'AUTHORING_SOURCE_CHANGED', conversation); return null; }
      const now = new Date();
      if (current.deadlineAt <= now) { await this.stop(tx, current, 'FAILED', 'AUTHORING_DEADLINE_EXCEEDED', conversation); return null; }
      if (current.status === 'RUNNING' && current.leaseExpiresAt && current.leaseExpiresAt > now) return null;
      if (current.attemptCount >= current.maxAttempts) { await this.stop(tx, current, 'FAILED', 'AUTHORING_ATTEMPTS_EXHAUSTED', conversation); return null; }
      const next: AuthoringJobClaim = { ...current, status: 'RUNNING', stage: 'UNDERSTANDING', attemptCount: current.attemptCount + 1,
        revision: current.revision + 1, leaseToken: newId(), leaseExpiresAt: new Date(Math.min(now.getTime() + LEASE_MS, current.deadlineAt.getTime())), errorCode: null, updatedAt: now };
      await tx.update(authoringJobs).set({ status: next.status, stage: next.stage, attemptCount: next.attemptCount, revision: next.revision,
        leaseToken: next.leaseToken, leaseExpiresAt: next.leaseExpiresAt, errorCode: null, updatedAt: now }).where(eq(authoringJobs.id, next.id));
      return next;
    });
  }

  async assertClaimCurrent(tx: AuthoringTransaction, claim: AuthoringJobClaim) {
    const { conversation, current } = await this.lock(tx, claim);
    const now = new Date();
    if (!current || current.status !== 'RUNNING' || current.leaseToken !== claim.leaseToken || current.revision !== claim.revision
      || !current.leaseExpiresAt || current.leaseExpiresAt <= now || current.deadlineAt <= now || current.cancelRequestedAt) throw new AuthoringJobFenceError('AUTHORING_LEASE_FENCED');
    if (!this.sourceCurrent(conversation, current)) throw new AuthoringJobFenceError('AUTHORING_SOURCE_CHANGED');
    return current;
  }
  async checkpoint(claim: AuthoringJobClaim) { await this.db.transaction(tx => this.assertClaimCurrent(tx, claim)); }
  async heartbeat(claim: AuthoringJobClaim) {
    await this.db.transaction(async tx => {
      const row = await this.assertClaimCurrent(tx, claim), now = new Date();
      await tx.update(authoringJobs).set({ leaseExpiresAt: new Date(Math.min(now.getTime() + LEASE_MS, row.deadlineAt.getTime())), updatedAt: now }).where(eq(authoringJobs.id, row.id));
    });
  }
  async compiling(tx: AuthoringTransaction, claim: AuthoringJobClaim) {
    await this.assertClaimCurrent(tx, claim);
    await tx.update(authoringJobs).set({ stage: 'COMPILING', updatedAt: new Date() }).where(eq(authoringJobs.id, claim.id));
  }
  /** Must share a transaction with assistant insertion and the ACTIVE conversation update. */
  async complete(tx: AuthoringTransaction, claim: AuthoringJobClaim, resultMessageId: string) {
    await this.assertClaimCurrent(tx, claim);
    const message = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, resultMessageId), eq(consumerMessages.conversationId, claim.conversationId), eq(consumerMessages.requestId, claim.requestId), eq(consumerMessages.role, 'assistant'))))[0];
    if (!message) throw new ConflictException('AUTHORING_RESULT_MESSAGE_REQUIRED');
    const now = new Date();
    await tx.update(authoringJobs).set({ status: 'SUCCEEDED', stage: 'COMPLETED', resultMessageId, revision: claim.revision + 1,
      leaseToken: null, leaseExpiresAt: null, errorCode: null, finishedAt: now, updatedAt: now }).where(eq(authoringJobs.id, claim.id));
  }
  private async failed(claim: AuthoringJobClaim, code: string) {
    await this.db.transaction(async tx => {
      const { conversation, current } = await this.lock(tx, claim);
      if (!current || current.status !== 'RUNNING' || current.leaseToken !== claim.leaseToken || current.revision !== claim.revision) return;
      if (!this.sourceCurrent(conversation, current)) { await this.stop(tx, current, 'SUPERSEDED', 'AUTHORING_SOURCE_CHANGED', conversation); return; }
      if (current.deadlineAt <= new Date() || code === 'AUTHORING_DEADLINE_EXCEEDED' || current.attemptCount >= current.maxAttempts) {
        await this.stop(tx, current, 'FAILED', code, conversation); return;
      }
      await tx.update(authoringJobs).set({ status: 'QUEUED', stage: 'QUEUED', revision: current.revision + 1, leaseToken: null,
        leaseExpiresAt: null, errorCode: code, updatedAt: new Date() }).where(eq(authoringJobs.id, current.id));
    });
  }
  /** Public for legacy synchronous waiting and isolated tests; still uses the same persisted lease. */
  async process(jobId: string): Promise<AuthoringJobProjection | undefined> {
    const claim = await this.claim(jobId);
    if (!claim) { const row = (await this.db.select().from(authoringJobs).where(eq(authoringJobs.id, jobId)))[0]; return row ? this.project(row) : undefined; }
    const heartbeat = setInterval(() => { void this.heartbeat(claim).catch(() => undefined); }, LEASE_MS / 4);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const processor = this.modules.get<AuthoringJobProcessor>('CONSUMER_AUTHORING_PROCESSOR', { strict: false });
      await Promise.race([processor.processAuthoringJob(claim), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new AuthoringJobFenceError('AUTHORING_DEADLINE_EXCEEDED')), Math.max(1, claim.deadlineAt.getTime() - Date.now()));
      })]);
      const current = (await this.db.select().from(authoringJobs).where(eq(authoringJobs.id, claim.id)))[0];
      if (current?.status === 'RUNNING') throw new Error('AUTHORING_PROCESSOR_DID_NOT_COMMIT');
    } catch (error) {
      await this.failed(claim, error instanceof AuthoringJobFenceError ? error.code : 'AUTHORING_PROCESSING_FAILED');
    } finally { clearInterval(heartbeat); if (deadline) clearTimeout(deadline); }
    const current = (await this.db.select().from(authoringJobs).where(eq(authoringJobs.id, claim.id)))[0];
    return current ? this.project(current) : undefined;
  }
  async recover() {
    if (this.recovering) return 0;
    this.recovering = true;
    try {
      const now = new Date();
      const rows = await this.db.select({ id: authoringJobs.id }).from(authoringJobs).where(or(eq(authoringJobs.status, 'QUEUED'),
        and(eq(authoringJobs.status, 'RUNNING'), or(lte(authoringJobs.leaseExpiresAt, now), lte(authoringJobs.deadlineAt, now)))))
        .orderBy(asc(authoringJobs.createdAt)).limit(40);
      for (const row of rows) await this.enqueue(row.id);
      return rows.length;
    } finally { this.recovering = false; }
  }
  project(row: Job): AuthoringJobProjection {
    return authoringJobProjectionSchema.parse({ schemaVersion: 'authoring-job.v1', jobId: row.id, conversationId: row.conversationId, requestId: row.requestId,
      status: row.status, stage: row.stage, attemptCount: row.attemptCount, maxAttempts: row.maxAttempts,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), deadlineAt: row.deadlineAt.toISOString(),
      resultMessageId: row.resultMessageId, errorCode: row.errorCode, executionAuthorized: false });
  }
  async onApplicationShutdown() {
    if (this.recovery) clearInterval(this.recovery);
    await this.worker?.close(); await this.queue?.close();
    if (this.redis && this.redis.status !== 'end') await this.redis.quit();
  }
}
