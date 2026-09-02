import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, or, sum } from 'drizzle-orm';
import { usageEvents } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { EntitlementService } from '../membership/entitlement.service';
import { decodeCursor, encodeCursor, type CursorPageDto } from '../common/cursor-pagination';

export interface RecordUsageInput {
  userId: string;
  usageType: string;
  quantity: number;
  unit: string;
  provider?: string | null;
  resourceType: string;
  resourceId: string;
  executionId?: string | null;
  sideEffectOperationId?: string | null;
  usageIdentity: string;
  billable: boolean;
  providerCostMinor?: number | null;
  occurredAt?: Date;
}

type UsageExecutor = Pick<InjectedDatabase, 'insert'>;

@Injectable()
export class UsageService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly entitlements: EntitlementService,
  ) {}

  async record(input: RecordUsageInput, executor: UsageExecutor = this.db): Promise<{ created: boolean }> {
    if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new BadRequestException('Usage quantity must be a non-negative integer');
    if (!input.usageIdentity || input.usageIdentity.length > 255) throw new BadRequestException('Usage identity is invalid');
    const now = new Date();
    try {
      await executor.insert(usageEvents).values({
        id: newId(),
        userId: input.userId,
        usageType: input.usageType,
        quantity: input.quantity,
        unit: input.unit,
        provider: input.provider ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        executionId: input.executionId ?? null,
        sideEffectOperationId: input.sideEffectOperationId ?? null,
        usageIdentity: input.usageIdentity,
        billable: input.billable ? 1 : 0,
        providerCostMinor: input.providerCostMinor ?? null,
        occurredAt: input.occurredAt ?? now,
        createdAt: now,
      });
      return { created: true };
    } catch (error) {
      if (this.hasDatabaseCode(error, 'ER_DUP_ENTRY')) return { created: false };
      throw error;
    }
  }

  async recordAiUsage(input: {
    userId: string;
    identity: string;
    inputUnits: number;
    outputUnits: number;
    provider: string;
    resourceId: string;
    billable?: boolean;
  }) {
    const common = {
      userId: input.userId,
      unit: 'characters',
      provider: input.provider,
      resourceType: 'plan_intent',
      resourceId: input.resourceId,
      billable: input.billable ?? false,
    };
    return Promise.all([
      this.record({ ...common, usageType: 'ai.input', quantity: input.inputUnits, usageIdentity: 'ai.input:' + input.identity }),
      this.record({ ...common, usageType: 'ai.output', quantity: input.outputUnits, usageIdentity: 'ai.output:' + input.identity }),
    ]);
  }

  async getMonthlyUsage(userId: string, at = new Date()) {
    const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    const rows = await this.db.select({
      usageType: usageEvents.usageType,
      quantity: sum(usageEvents.quantity),
    }).from(usageEvents)
      .where(and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.occurredAt, periodStart),
        lt(usageEvents.occurredAt, periodEnd),
      ))
      .groupBy(usageEvents.usageType);
    const totals = new Map(rows.map((row) => [row.usageType, Number(row.quantity ?? 0)]));
    const membership = await this.entitlements.getEntitlements(userId);
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      plan: {
        active: membership.usage.activePlans,
        limit: membership.limits.max_active_plans,
      },
      execution: {
        completed: totals.get('execution.completed') ?? 0,
      },
      advancedAi: {
        inputUnits: totals.get('ai.input') ?? 0,
        outputUnits: totals.get('ai.output') ?? 0,
        unit: 'characters',
      },
      connector: {
        operations: totals.get('connector.operation') ?? 0,
      },
      notification: {
        generated: totals.get('notification.generated') ?? 0,
        delivered: totals.get('notification.delivered') ?? 0,
      },
      storage: {
        fileBytes: totals.get('storage.file_bytes') ?? 0,
      },
    };
  }

  async listEvents(userId: string, query: CursorPageDto) {
    const cursor = decodeCursor(query.cursor);
    const filters = [eq(usageEvents.userId, userId)];
    if (cursor) filters.push(or(lt(usageEvents.occurredAt, cursor.createdAt), and(eq(usageEvents.occurredAt, cursor.createdAt), lt(usageEvents.id, cursor.id)))!);
    const rows = await this.db.select({
      id: usageEvents.id,
      usageType: usageEvents.usageType,
      quantity: usageEvents.quantity,
      unit: usageEvents.unit,
      provider: usageEvents.provider,
      resourceType: usageEvents.resourceType,
      resourceId: usageEvents.resourceId,
      occurredAt: usageEvents.occurredAt,
      createdAt: usageEvents.createdAt,
    }).from(usageEvents).where(and(...filters))
      .orderBy(desc(usageEvents.occurredAt), desc(usageEvents.id)).limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.occurredAt, id: last.id }) : null };
  }

  private hasDatabaseCode(error: unknown, expected: string) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
      if ((current as { code?: unknown }).code === expected) return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }
}
