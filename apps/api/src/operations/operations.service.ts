import { Inject, Injectable } from '@nestjs/common';
import { operationalRecords } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { CreateOperationalRecordDto } from './dto';

@Injectable()
export class OperationsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async create(userId: string, input: CreateOperationalRecordDto) {
    const id = newId();
    const now = new Date();
    const amountMinor = input.amount === undefined ? null : Math.round(input.amount * 100);
    await this.db.transaction(async (tx) => {
      await tx.insert(operationalRecords).values({
        id, userId, recordType: input.recordType, subject: input.subject.trim(), quantity: input.quantity ?? null,
        amountMinor, currency: input.currency?.toUpperCase() ?? null, status: input.status,
        occurredAt: new Date(input.occurredAt), needsAttention: input.needsAttention ? 1 : 0,
        sourceType: input.sourceType, metadataJson: null, createdAt: now, updatedAt: now,
      });
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'OPERATIONAL_RECORD_CREATED', resourceType: 'operational_record', resourceId: id, userId, correlationId: id, source: 'api', result: 'success', changeSummary: 'Operational fact recorded for shared summary', after: { recordType: input.recordType, subject: input.subject, quantity: input.quantity ?? null, amountMinor, status: input.status, needsAttention: input.needsAttention } }, tx);
    });
    return (await this.list(userId)).find((item) => item.id === id) ?? null;
  }

  async list(userId: string) {
    const rows = await this.db.select().from(operationalRecords).where(eq(operationalRecords.userId, userId)).orderBy(desc(operationalRecords.occurredAt));
    return rows.map((row) => this.response(row));
  }

  async resolveInternal(userId: string, _config: Record<string, unknown>, context: Record<string, unknown>) {
    const reference = typeof context.referenceDate === 'string' ? new Date(context.referenceDate) : new Date();
    const start = new Date(reference); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    const rows = await this.db.select().from(operationalRecords).where(and(eq(operationalRecords.userId, userId), gte(operationalRecords.occurredAt, start), lt(operationalRecords.occurredAt, end))).orderBy(desc(operationalRecords.occurredAt));
    const records = rows.map((row) => this.response(row));
    const counts = records.reduce<Record<string, number>>((acc, item) => { acc[item.recordType] = (acc[item.recordType] ?? 0) + 1; return acc; }, {});
    const amountTotals = records.reduce<Record<string, number>>((acc, item) => {
      if (item.amount !== null) acc[item.recordType] = Number(((acc[item.recordType] ?? 0) + item.amount).toFixed(2));
      return acc;
    }, {});
    return { ...context, operationalSummary: {
      date: start.toISOString().slice(0, 10), recordCount: records.length, counts, amountTotals,
      attentionCount: records.filter((item) => item.needsAttention).length,
      attentionRecords: records.filter((item) => item.needsAttention), records,
    } };
  }

  private response(row: typeof operationalRecords.$inferSelect) {
    return {
      id: row.id, recordType: row.recordType, subject: row.subject, quantity: row.quantity,
      amount: row.amountMinor === null ? null : Number((row.amountMinor / 100).toFixed(2)), currency: row.currency,
      status: row.status, occurredAt: row.occurredAt.toISOString(), needsAttention: Boolean(row.needsAttention), sourceType: row.sourceType,
    };
  }
}
