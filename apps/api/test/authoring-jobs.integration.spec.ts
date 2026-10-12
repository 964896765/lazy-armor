import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import type { ModuleRef } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { authoringJobs, consumerConversations, consumerMessages, createDatabase, users } from '@lazy-armor/database';
import { AuthoringJobsService, type AdmitAuthoringJob, type AuthoringJobClaim } from '../src/orchestrator/authoring-jobs.service';

/** Real transactions on a guarded test DB. No Runtime, model, external service or Redis mutation. */
describe.sequential('V91 durable authoring transactions', () => {
  let bundle: ReturnType<typeof createDatabase>, jobs: AuthoringJobsService;
  let processor: (claim: AuthoringJobClaim) => Promise<void>;
  const ownerId = randomUUID(), strangerId = randomUUID();
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
    if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Only an isolated *_test DB may run authoring tests');
    bundle = createDatabase(url);
    const [tables] = await bundle.pool.query("SHOW TABLES LIKE 'authoring_jobs'");
    if (!(tables as unknown[]).length) {
      // Additive 0091 only; prior test baseline must already be provisioned by the repo test setup.
      const sql = await readFile(new URL('../../../packages/database/drizzle/0091_durable_authoring.sql', import.meta.url), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) await bundle.pool.query(statement);
    }
    const now = new Date();
    await bundle.db.insert(users).values([ownerId, strangerId].map(id => ({ id, status: 'active', role: 'user', createdAt: now, updatedAt: now })));
    processor = async () => { throw new Error('fixture not configured'); };
    jobs = new AuthoringJobsService(bundle.db, new ConfigService({}), { get: () => ({ processAuthoringJob: (claim: AuthoringJobClaim) => processor(claim) }) } as unknown as ModuleRef);
  });
  afterAll(async () => { await jobs?.onApplicationShutdown(); await bundle?.pool.end(); });

  async function fixture() {
    const conversationId = randomUUID(), inputMessageId = randomUUID(), resultMessageId = randomUUID(), requestId = randomUUID();
    const input: AdmitAuthoringJob = { userId: ownerId, conversationId, inputMessageId, resultMessageId, requestId,
      sourceConversationVersion: 1, inputHash: createHash('sha256').update(requestId).digest('hex'), payloadJson: { resultMessageId, attachmentIds: [] } };
    const job = await bundle.db.transaction(async tx => {
      const now = new Date();
      await tx.insert(consumerConversations).values({ id: conversationId, userId: ownerId, mode: 'TEMPORARY', title: 'authoring test', status: 'PROCESSING', contextRefs: [], version: 1, createdAt: now, updatedAt: now });
      await tx.insert(consumerMessages).values([
        { id: inputMessageId, conversationId, requestId, role: 'user', content: '我想完成一个目标', structuredPayload: {}, contextRefs: [], createdAt: now },
        { id: resultMessageId, conversationId, requestId, role: 'assistant', content: '正在理解目标', structuredPayload: { result: 'AUTHORING_QUEUED' }, contextRefs: [], createdAt: now },
      ]);
      return jobs.admit(tx, input);
    });
    return { input, job, conversationId, resultMessageId };
  }
  async function expire(jobId: string) {
    await bundle.db.update(authoringJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(authoringJobs.id, jobId));
  }
  async function commit(claim: AuthoringJobClaim) {
    await bundle.db.transaction(async tx => {
      await jobs.assertClaimCurrent(tx, claim);
      await tx.update(consumerMessages).set({ content: '已形成经过校验的建议', structuredPayload: { result: 'CLARIFICATION_REQUIRED', clarification: { missingRequirements: ['请补充预算'] } } }).where(eq(consumerMessages.id, claim.resultMessageId!));
      await jobs.complete(tx, claim, claim.resultMessageId!);
      await tx.update(consumerConversations).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(consumerConversations.id, claim.conversationId));
    });
  }

  it('keeps admission atomic and replay identities stable while rejecting changed input', async () => {
    const { input, job } = await fixture();
    const replay = await Promise.all([1, 2, 3].map(() => bundle.db.transaction(tx => jobs.admit(tx, input))));
    expect(replay.every(row => row.id === job.id)).toBe(true);
    await expect(bundle.db.transaction(tx => jobs.admit(tx, { ...input, inputHash: 'a'.repeat(64) }))).rejects.toThrow('AUTHORING_REPLAY_MISMATCH');
    const rollbackRequestId = randomUUID();
    await expect(bundle.db.transaction(async tx => {
      const now = new Date(), messageId = randomUUID();
      await tx.insert(consumerMessages).values({ id: messageId, conversationId: input.conversationId, requestId: rollbackRequestId, role: 'user', content: 'rollback', structuredPayload: {}, contextRefs: [], createdAt: now });
      await jobs.admit(tx, { ...input, requestId: rollbackRequestId, inputMessageId: messageId, resultMessageId: undefined });
      throw new Error('ROLLBACK');
    })).rejects.toThrow('ROLLBACK');
    const rows = await bundle.db.select().from(authoringJobs).where(and(eq(authoringJobs.conversationId, input.conversationId), eq(authoringJobs.requestId, rollbackRequestId)));
    expect(rows).toHaveLength(0);
  });
  it('projects owner-only state without input, credential or lease disclosure', async () => {
    const { job } = await fixture();
    await expect(jobs.get(strangerId, job.id)).rejects.toMatchObject({ status: 404 });
    const projection = await jobs.get(ownerId, job.id);
    expect(projection).toMatchObject({ status: 'QUEUED', executionAuthorized: false, resultMessageId: job.resultMessageId });
    expect(projection).not.toHaveProperty('payloadJson'); expect(projection).not.toHaveProperty('leaseToken');
  });
  it('keeps the active request visible after more than one hundred historical computations', async () => {
    const { job, conversationId } = await fixture();
    await bundle.db.transaction(async tx => {
      const messages: Array<typeof consumerMessages.$inferInsert> = [];
      const history: Array<typeof authoringJobs.$inferInsert> = [];
      for (let index = 0; index < 101; index++) {
        const requestId = randomUUID(), inputMessageId = randomUUID(), resultMessageId = randomUUID();
        const createdAt = new Date(job.createdAt.getTime() - (102 - index) * 1_000);
        messages.push(
          { id: inputMessageId, conversationId, requestId, role: 'user', content: '历史隔离请求', structuredPayload: {}, contextRefs: [], createdAt },
          { id: resultMessageId, conversationId, requestId, role: 'assistant', content: '历史隔离结果', structuredPayload: { result: 'ANSWER' }, contextRefs: [], createdAt },
        );
        history.push({ ...job, id: randomUUID(), requestId, inputMessageId, resultMessageId,
          inputHash: createHash('sha256').update(requestId).digest('hex'), status: 'SUCCEEDED', stage: 'COMPLETED',
          createdAt, updatedAt: createdAt, finishedAt: createdAt, leaseToken: null, leaseExpiresAt: null });
      }
      await tx.insert(consumerMessages).values(messages); await tx.insert(authoringJobs).values(history);
    });
    const projected = await jobs.listForConversation(ownerId, conversationId);
    expect(projected).toHaveLength(100);
    expect(projected.at(-1)).toMatchObject({ jobId: job.id, status: 'QUEUED', resultMessageId: job.resultMessageId });
    expect(projected.map(row => row.createdAt)).toEqual(projected.map(row => row.createdAt).sort());
    await expect(jobs.listForConversation(strangerId, conversationId)).rejects.toMatchObject({ status: 404 });
  });
  it('admits one concurrent holder and fences late result after lease takeover', async () => {
    const { job } = await fixture();
    const claims = await Promise.all([jobs.claim(job.id), jobs.claim(job.id), jobs.claim(job.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    await expire(job.id);
    const newer = (await jobs.claim(job.id))!;
    expect(newer.leaseToken).not.toBe(old.leaseToken);
    await expect(commit(old)).rejects.toThrow('AUTHORING_LEASE_FENCED');
    await commit(newer);
    expect(await jobs.get(ownerId, job.id)).toMatchObject({ status: 'SUCCEEDED', attemptCount: 2 });
    expect(await jobs.claim(job.id)).toBeNull();
  });
  it('cancels an in-flight calculation and prevents a late assistant overwrite', async () => {
    const { job, resultMessageId } = await fixture();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    processor = async claim => { entered(); await waiting; await commit(claim); };
    const processing = jobs.process(job.id);
    await started;
    expect(await jobs.cancel(ownerId, job.id)).toMatchObject({ status: 'CANCELLED' });
    release(); await processing;
    const message = (await bundle.db.select().from(consumerMessages).where(eq(consumerMessages.id, resultMessageId)))[0];
    expect(message.content).toBe('本次需求处理已取消。');
    expect(message.structuredPayload).toMatchObject({ authoringJob: { status: 'CANCELLED' } });
  });
  it('supersedes obsolete versions without changing the new conversation state', async () => {
    const { job, conversationId } = await fixture();
    const claim = (await jobs.claim(job.id))!;
    await bundle.db.update(consumerConversations).set({ version: 2, status: 'ACTIVE' }).where(eq(consumerConversations.id, conversationId));
    await expect(commit(claim)).rejects.toThrow('AUTHORING_SOURCE_CHANGED');
    expect(await jobs.claim(job.id)).toBeNull();
    expect(await jobs.get(ownerId, job.id)).toMatchObject({ status: 'SUPERSEDED' });
    expect((await bundle.db.select().from(consumerConversations).where(eq(consumerConversations.id, conversationId)))[0]).toMatchObject({ version: 2, status: 'ACTIVE' });
  });
  it('enforces persisted deadline and bounded attempts, freeing PROCESSING on failure', async () => {
    const expired = await fixture();
    await bundle.db.update(authoringJobs).set({ deadlineAt: new Date(Date.now() - 1_000) }).where(eq(authoringJobs.id, expired.job.id));
    expect(await jobs.claim(expired.job.id)).toBeNull();
    expect(await jobs.get(ownerId, expired.job.id)).toMatchObject({ status: 'FAILED', errorCode: 'AUTHORING_DEADLINE_EXCEEDED' });
    const exhausted = await fixture();
    await jobs.claim(exhausted.job.id); await expire(exhausted.job.id);
    await jobs.claim(exhausted.job.id); await expire(exhausted.job.id);
    expect(await jobs.claim(exhausted.job.id)).toBeNull();
    expect(await jobs.get(ownerId, exhausted.job.id)).toMatchObject({ status: 'FAILED', attemptCount: 2, errorCode: 'AUTHORING_ATTEMPTS_EXHAUSTED' });
    expect((await bundle.db.select().from(consumerConversations).where(eq(consumerConversations.id, exhausted.conversationId)))[0].status).toBe('ACTIVE');
  });
  it('repairs lost enqueue from persisted jobs with stable IDs and no Redis fixture', async () => {
    const { job } = await fixture();
    const enqueue = vi.spyOn(jobs, 'enqueue').mockResolvedValue(undefined);
    try { await jobs.recover(); expect(enqueue).toHaveBeenCalledWith(job.id); }
    finally { enqueue.mockRestore(); }
  });
  it('retries calculation once and preserves a terminal bounded failure', async () => {
    const { job } = await fixture();
    processor = async () => { throw new Error('test transient model failure'); };
    expect(await jobs.process(job.id)).toMatchObject({ status: 'QUEUED', attemptCount: 1 });
    expect(await jobs.process(job.id)).toMatchObject({ status: 'FAILED', attemptCount: 2 });
    expect(await jobs.process(job.id)).toMatchObject({ status: 'FAILED', attemptCount: 2 });
  });
  it('publishes deadline failure before a late model return and fences its write', async () => {
    const { job, resultMessageId } = await fixture();
    await bundle.db.update(authoringJobs).set({ deadlineAt: new Date(Date.now() + 700) }).where(eq(authoringJobs.id, job.id));
    let release!: () => void, attempted!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const finished = new Promise<void>(resolve => { attempted = resolve; });
    processor = async claim => {
      await waiting;
      try { await expect(commit(claim)).rejects.toThrow('AUTHORING_LEASE_FENCED'); }
      finally { attempted(); }
    };
    expect(await jobs.process(job.id)).toMatchObject({ status: 'FAILED', errorCode: 'AUTHORING_DEADLINE_EXCEEDED' });
    release(); await finished;
    expect((await bundle.db.select().from(consumerMessages).where(eq(consumerMessages.id, resultMessageId)))[0].structuredPayload).toMatchObject({ authoringJob: { status: 'FAILED' } });
  });
  it('hides deleted conversation jobs from owner routes while recovery supersedes them', async () => {
    const { job, conversationId } = await fixture();
    await bundle.db.update(consumerConversations).set({ deletedAt: new Date() }).where(eq(consumerConversations.id, conversationId));
    await expect(jobs.get(ownerId, job.id)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.cancel(ownerId, job.id)).rejects.toMatchObject({ status: 404 });
    expect(await jobs.claim(job.id)).toBeNull();
    expect((await bundle.db.select().from(authoringJobs).where(eq(authoringJobs.id, job.id)))[0].status).toBe('SUPERSEDED');
  });
});
