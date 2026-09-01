import { Inject, Injectable } from '@nestjs/common';
import { outboxMessages } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, inArray, lte, or, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { hashPayload } from './idempotency';
import { ExecutionRuntimeError } from '../execution.types';

export type OutboxExecutor = Pick<InjectedDatabase, 'insert' | 'select' | 'update'>;

export interface OutboxEnqueueInput {
  aggregateType: string;
  aggregateId: string;
  userId: string;
  eventType: string;
  destination: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  correlationId: string;
  causationId?: string | null;
}

@Injectable()
export class OutboxService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async enqueue(input: OutboxEnqueueInput, executor: OutboxExecutor = this.db): Promise<string> {
    const now = new Date();
    const id = newId();
    const payloadHash = hashPayload(input.payload);
    await executor.insert(outboxMessages).values({
      id, aggregateType: input.aggregateType, aggregateId: input.aggregateId, userId: input.userId,
      eventType: input.eventType, destination: input.destination, payloadJson: input.payload, payloadHash,
      dedupeKey: input.dedupeKey, correlationId: input.correlationId, causationId: input.causationId ?? null,
      status: 'pending', attemptCount: 0, nextAttemptAt: now, lockedBy: null, lockExpiresAt: null,
      lastErrorCode: null, lastErrorMessage: null, createdAt: now, publishedAt: null, updatedAt: now,
    }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
    return id;
  }

  async get(id: string) {
    return (await this.db.select().from(outboxMessages).where(eq(outboxMessages.id, id)).limit(1))[0] ?? null;
  }

  // 多个 Worker 并发安全：FOR UPDATE SKIP LOCKED + 短 Lease；崩溃后 lock 过期可重新 Claim。
  async claim(batch: number, workerId: string, leaseMs = 30_000): Promise<Array<typeof outboxMessages.$inferSelect>> {
    const now = new Date();
    const rows = await this.db.transaction(async (tx) => {
      const candidates = await tx.select().from(outboxMessages)
        .where(and(
          or(eq(outboxMessages.status, 'pending'), eq(outboxMessages.status, 'retry_wait'), eq(outboxMessages.status, 'processing')),
          lte(outboxMessages.nextAttemptAt, now),
          or(isNull(outboxMessages.lockExpiresAt), lte(outboxMessages.lockExpiresAt, now)),
        ))
        .orderBy(outboxMessages.nextAttemptAt)
        .limit(batch)
        .for('update', { skipLocked: true });
      if (!candidates.length) return [];
      await tx.update(outboxMessages).set({
        status: 'processing', lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
      }).where(inArray(outboxMessages.id, candidates.map((row) => row.id)));
      return candidates;
    });
    return rows;
  }

  async markPublished(id: string) {
    const now = new Date();
    await this.db.update(outboxMessages).set({ status: 'published', publishedAt: now, lockedBy: null, lockExpiresAt: null, updatedAt: now }).where(eq(outboxMessages.id, id));
  }

  async markRetryWait(id: string, code: string, message: string, nextAttemptAt: Date) {
    const now = new Date();
    const current = (await this.db.select({ attemptCount: outboxMessages.attemptCount }).from(outboxMessages).where(eq(outboxMessages.id, id)).limit(1))[0];
    await this.db.update(outboxMessages).set({
      status: 'retry_wait', attemptCount: (current?.attemptCount ?? 0) + 1, nextAttemptAt, lockedBy: null, lockExpiresAt: null,
      lastErrorCode: code, lastErrorMessage: message.slice(0, 1000), updatedAt: now,
    }).where(eq(outboxMessages.id, id));
  }

  async markDead(id: string, code: string, message: string) {
    const now = new Date();
    await this.db.update(outboxMessages).set({ status: 'dead', lockedBy: null, lockExpiresAt: null, lastErrorCode: code, lastErrorMessage: message.slice(0, 1000), updatedAt: now }).where(eq(outboxMessages.id, id));
  }

  async assertPayloadIntegrity(id: string, expected: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) throw new ExecutionRuntimeError('OUTBOX_MESSAGE_NOT_FOUND', 'Outbox message no longer exists');
    if (hashPayload(row.payloadJson) !== row.payloadHash) throw new ExecutionRuntimeError('SECURITY_PAYLOAD_INTEGRITY_FAILURE', 'Outbox payload failed integrity verification');
    void expected;
    return row;
  }
}
