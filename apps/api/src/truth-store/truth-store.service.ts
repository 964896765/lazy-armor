import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mobileNotificationReceipts, truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { and, desc, eq } from 'drizzle-orm';
import { newId } from '@lazy-armor/shared';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

interface CandidateSnapshot {
  schema?: unknown;
  candidateKind?: unknown;
  candidateResource?: unknown;
  candidateConfidence?: unknown;
  currency?: unknown;
  parserVersion?: unknown;
}

@Injectable()
export class TruthStoreService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async confirmMobileReceipt(userId: string, receipt: typeof mobileNotificationReceipts.$inferSelect) {
    const candidate = this.candidateFrom(receipt);
    const existing = await this.findByReceipt(this.db, userId, receipt.id);
    if (existing) return this.completedResponse(existing);

    const now = new Date();
    const truthId = newId();
    const versionId = newId();
    const value = { resource: candidate.resource, amountMinor: receipt.amountMinor, currency: candidate.currency, occurredAt: receipt.postedAt.toISOString() };
    const valueHash = hash(value);
    const evidenceHash = hash({ receiptId: receipt.id, payloadHash: receipt.payloadHash, candidateResource: candidate.resource, parserVersion: candidate.parserVersion });

    let result: { created: true } | { created: false; row: typeof truthRecords.$inferSelect };
    try {
      result = await this.db.transaction(async (tx) => {
        const raced = await this.findByReceipt(tx, userId, receipt.id);
        if (raced) return { created: false as const, row: raced };
        await tx.insert(truthRecords).values({
          id: truthId, userId, resourceKey: candidate.resource, subjectKey: receipt.id, status: 'verified', currentVersionId: null,
          sourceReceiptId: receipt.id, verifiedBy: 'user_confirmation', verifiedAt: now, revokedAt: null, createdAt: now, updatedAt: now,
        });
        await tx.insert(truthRecordVersions).values({
          id: versionId, truthRecordId: truthId, versionNumber: 1, valueJson: value, valueHash, verificationMethod: 'user_confirmation_after_device_key_proof', evidenceHash, createdAt: now,
        });
        await tx.update(truthRecords).set({ currentVersionId: versionId, updatedAt: now }).where(eq(truthRecords.id, truthId));
        return { created: true as const };
      });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const raced = await this.findByReceipt(this.db, userId, receipt.id);
      if (!raced) throw new ConflictException('Truth record confirmation conflicted; retry safely');
      return this.completedResponse(raced);
    }

    if (!result.created) return this.completedResponse(result.row);
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'TRUTH_RECORD_VERIFIED', resourceType: 'truth_record', resourceId: truthId,
      userId, correlationId: receipt.id, changeSummary: `Confirmed a brand-neutral ${candidate.resource} fact from a device notification candidate`, source: 'api', result: 'success',
    });
    return { id: truthId, resourceKey: candidate.resource, status: 'verified', verifiedAt: now.toISOString(), currentVersion: { versionNumber: 1, value } };
  }

  async resolveMobileBillingTransactions(userId: string, context: Record<string, unknown>) {
    const rows = await this.db.select({
      truthId: truthRecords.id, resourceKey: truthRecords.resourceKey, verifiedAt: truthRecords.verifiedAt, value: truthRecordVersions.valueJson,
    }).from(truthRecords).innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'), eq(truthRecords.resourceKey, 'mobile.billing.transaction')))
      .orderBy(desc(truthRecords.verifiedAt));
    const transactions = rows.map((row) => {
      const value = row.value as Record<string, unknown>;
      return {
        truthRecordId: row.truthId,
        amountMinor: typeof value.amountMinor === 'number' ? value.amountMinor : null,
        currency: value.currency === 'CNY' ? 'CNY' : null,
        occurredAt: typeof value.occurredAt === 'string' ? value.occurredAt : row.verifiedAt.toISOString(),
        verifiedAt: row.verifiedAt.toISOString(),
      };
    }).filter((value) => value.amountMinor !== null && value.currency === 'CNY');
    return { ...context, mobileBillingTransactions: transactions, mobileBillingTotalMinor: transactions.reduce((total, item) => total + (item.amountMinor ?? 0), 0) };
  }

  async list(userId: string, resourceKey?: string) {
    const rows = await this.db.select().from(truthRecords)
      .where(resourceKey ? and(eq(truthRecords.userId, userId), eq(truthRecords.resourceKey, resourceKey), eq(truthRecords.status, 'verified')) : and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified')))
      .orderBy(desc(truthRecords.verifiedAt));
    return rows.map((row) => this.completedResponse(row));
  }

  private async findByReceipt(db: Pick<InjectedDatabase, 'select'>, userId: string, receiptId: string) {
    return (await db.select().from(truthRecords).where(and(eq(truthRecords.userId, userId), eq(truthRecords.sourceReceiptId, receiptId))).limit(1))[0];
  }

  private completedResponse(row: typeof truthRecords.$inferSelect) {
    if (row.status !== 'verified' || !row.currentVersionId) {
      throw new ConflictException('Truth record is incomplete and cannot be consumed; manual recovery is required');
    }
    return this.toResponse(row);
  }

  private candidateFrom(receipt: typeof mobileNotificationReceipts.$inferSelect) {
    const snapshot = receipt.snapshotJson as CandidateSnapshot;
    if (snapshot.schema !== 'mobile-notification-minimal-v2' || snapshot.candidateKind !== 'billing_transaction_candidate' || snapshot.candidateResource !== 'mobile.billing.transaction' || snapshot.currency !== 'CNY' || snapshot.parserVersion !== 'generic-notification-v1' || !Number.isSafeInteger(receipt.amountMinor) || (receipt.amountMinor as number) < 0) {
      throw new BadRequestException('This notification candidate cannot become a verified fact');
    }
    return { resource: 'mobile.billing.transaction', currency: 'CNY', parserVersion: 'generic-notification-v1' } as const;
  }

  private toResponse(row: typeof truthRecords.$inferSelect) {
    return { id: row.id, resourceKey: row.resourceKey, status: row.status, sourceReceiptId: row.sourceReceiptId, verifiedBy: row.verifiedBy, verifiedAt: row.verifiedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, currentVersionId: row.currentVersionId };
  }
}

function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isDuplicate(error: unknown) {
  // Drizzle 会将 mysql2 的错误包裹为 DrizzleQueryError；真实并发路径的
  // ER_DUP_ENTRY 位于 cause，而非最外层错误对象。仅识别该精确数据库码，
  // 然后重新读取已提交的完整事实，绝不将其他写入错误降级为成功。
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === 'ER_DUP_ENTRY' || candidate?.cause?.code === 'ER_DUP_ENTRY';
}
