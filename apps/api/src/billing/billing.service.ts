import { Inject, Injectable } from '@nestjs/common';
import { billingRecords } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

type BillingContext = Record<string, unknown>;

interface NormalizedBillingRecord {
  provider: string;
  category: string;
  billingPeriod: string;
  amount: number;
  currency: string;
  occurredAt: string;
  sourceType: string;
}

@Injectable()
export class BillingService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async create(userId: string, input: {
    provider: string;
    category: string;
    billingPeriod: string;
    amount: number;
    currency: string;
    occurredAt: string;
    sourceType: 'manual' | 'internal' | 'file';
  }) {
    const now = new Date();
    const id = newId();
    const amountMinor = Math.round(input.amount * 100);
    await this.db.insert(billingRecords).values({
      id,
      userId,
      provider: input.provider,
      category: input.category,
      billingPeriod: input.billingPeriod,
      amountMinor,
      currency: input.currency.toUpperCase(),
      occurredAt: new Date(input.occurredAt),
      sourceType: input.sourceType,
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getById(userId, id);
  }

  async list(userId: string, billingPeriod?: string) {
    const filters = [eq(billingRecords.userId, userId)];
    if (billingPeriod) filters.push(eq(billingRecords.billingPeriod, billingPeriod));
    const rows = await this.db.select().from(billingRecords)
      .where(and(...filters))
      .orderBy(desc(billingRecords.occurredAt), desc(billingRecords.createdAt));
    return rows.map((row) => this.toResponse(row));
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: BillingContext) {
    const billingPeriodMode = typeof config.billingPeriod === 'string' ? config.billingPeriod : 'current_month';
    const reference = typeof context.referenceDate === 'string' ? new Date(context.referenceDate) : new Date();
    const currentPeriod = this.resolveBillingPeriod(reference, billingPeriodMode === 'previous_month' ? -1 : 0);
    const previousPeriod = this.resolveBillingPeriod(reference, billingPeriodMode === 'previous_month' ? -2 : -1);
    const category = typeof config.category === 'string' && config.category.trim() ? config.category.trim() : null;
    const currentWhere = category
      ? and(eq(billingRecords.userId, userId), eq(billingRecords.billingPeriod, currentPeriod), eq(billingRecords.category, category))
      : and(eq(billingRecords.userId, userId), eq(billingRecords.billingPeriod, currentPeriod));
    const previousWhere = category
      ? and(eq(billingRecords.userId, userId), eq(billingRecords.billingPeriod, previousPeriod), eq(billingRecords.category, category))
      : and(eq(billingRecords.userId, userId), eq(billingRecords.billingPeriod, previousPeriod));
    const [currentRows, previousRows] = await Promise.all([
      this.db.select().from(billingRecords).where(currentWhere).orderBy(asc(billingRecords.occurredAt)),
      this.db.select().from(billingRecords).where(previousWhere).orderBy(asc(billingRecords.occurredAt)),
    ]);
    return this.buildBillingContext({
      ...context,
      billingRecords: currentRows.map((row) => this.toResponse(row)),
      previousBillingRecords: previousRows.map((row) => this.toResponse(row)),
      billingPeriod: currentPeriod,
      previousBillingPeriod: previousPeriod,
    });
  }

  enrichContext(context: BillingContext) {
    if (!Array.isArray(context.billingRecords) && typeof context.amount !== 'number' && !this.hasChangePair(context.amountChange)) return context;
    return this.buildBillingContext(context);
  }

  private async getById(userId: string, id: string) {
    const row = (await this.db.select().from(billingRecords)
      .where(and(eq(billingRecords.userId, userId), eq(billingRecords.id, id)))
      .limit(1))[0];
    return row ? this.toResponse(row) : null;
  }

  private buildBillingContext(context: BillingContext): BillingContext {
    const billingRows = this.normalizeRecords(context.billingRecords);
    const previousRows = this.normalizeRecords(context.previousBillingRecords);
    const currentTotal = typeof context.amount === 'number' ? context.amount : this.total(billingRows);
    const previousTotal = this.readPreviousTotal(context, previousRows);
    const categoryTotals = billingRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.category] = Number(((acc[row.category] ?? 0) + row.amount).toFixed(2));
      return acc;
    }, {});
    const providerTotals = billingRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = Number(((acc[row.provider] ?? 0) + row.amount).toFixed(2));
      return acc;
    }, {});
    return {
      ...context,
      billingRecords: billingRows,
      previousBillingRecords: previousRows.length > 0 ? previousRows : context.previousBillingRecords,
      amount: Number(currentTotal.toFixed(2)),
      currentPeriodTotal: Number(currentTotal.toFixed(2)),
      previousPeriodTotal: Number(previousTotal.toFixed(2)),
      amountChange: { previous: Number(previousTotal.toFixed(2)), current: Number(currentTotal.toFixed(2)) },
      monthOverMonthChangePercent: previousTotal === 0 ? null : Number((((currentTotal - previousTotal) / previousTotal) * 100).toFixed(2)),
      categoryTotals,
      providerTotals,
    };
  }

  private normalizeRecords(value: unknown): NormalizedBillingRecord[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const amount = typeof row.amount === 'number'
        ? row.amount
        : typeof row.amountMinor === 'number'
          ? row.amountMinor / 100
          : null;
      if (typeof row.provider !== 'string' || typeof row.category !== 'string' || typeof row.billingPeriod !== 'string' || typeof row.currency !== 'string' || typeof row.occurredAt !== 'string' || typeof row.sourceType !== 'string' || amount === null) return [];
      return [{
        provider: row.provider,
        category: row.category,
        billingPeriod: row.billingPeriod,
        amount: Number(amount.toFixed(2)),
        currency: row.currency,
        occurredAt: row.occurredAt,
        sourceType: row.sourceType,
      }];
    });
  }

  private total(rows: NormalizedBillingRecord[]) {
    return rows.reduce((sum, row) => sum + row.amount, 0);
  }

  private readPreviousTotal(context: BillingContext, previousRows: NormalizedBillingRecord[]) {
    if (this.hasChangePair(context.amountChange) && typeof context.amountChange.previous === 'number') return context.amountChange.previous;
    if (typeof context.previousPeriodTotal === 'number') return context.previousPeriodTotal;
    if (typeof context.previousTotal === 'number') return context.previousTotal;
    return this.total(previousRows);
  }

  private hasChangePair(value: unknown): value is { previous: number; current: number } {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { previous?: unknown }).previous === 'number' && typeof (value as { current?: unknown }).current === 'number');
  }

  private resolveBillingPeriod(reference: Date, deltaMonths: number) {
    const date = new Date(reference);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + deltaMonths);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private toResponse(row: typeof billingRecords.$inferSelect) {
    return {
      id: row.id,
      provider: row.provider,
      category: row.category,
      billingPeriod: row.billingPeriod,
      amount: Number((row.amountMinor / 100).toFixed(2)),
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
