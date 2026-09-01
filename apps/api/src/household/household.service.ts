import { Inject, Injectable } from '@nestjs/common';
import { householdSupplyProfiles, preparedShoppingItems } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

type HouseholdContext = Record<string, unknown>;

interface HouseholdSupplyProfileShape {
  itemName: string;
  category: string;
  lastPurchasedAt: string;
  quantity: number;
  estimatedUsageDays: number;
  estimatedRunOutAt?: string | null;
  sourceType: string;
}

@Injectable()
export class HouseholdService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async createProfile(userId: string, input: {
    itemName: string;
    category: string;
    lastPurchasedAt: string;
    quantity: number;
    estimatedUsageDays: number;
    sourceType: 'manual' | 'internal' | 'test';
  }) {
    const now = new Date();
    const id = newId();
    await this.db.insert(householdSupplyProfiles).values({
      id,
      userId,
      itemName: input.itemName,
      category: input.category,
      lastPurchasedAt: new Date(input.lastPurchasedAt),
      quantity: input.quantity,
      estimatedUsageDays: input.estimatedUsageDays,
      estimatedRunOutAt: this.runOutAt(input.lastPurchasedAt, input.estimatedUsageDays),
      sourceType: input.sourceType,
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getProfileById(userId, id);
  }

  async listProfiles(userId: string, itemName?: string) {
    const filters = [eq(householdSupplyProfiles.userId, userId)];
    if (itemName) filters.push(eq(householdSupplyProfiles.itemName, itemName));
    const rows = await this.db.select().from(householdSupplyProfiles)
      .where(and(...filters))
      .orderBy(desc(householdSupplyProfiles.estimatedRunOutAt), desc(householdSupplyProfiles.createdAt));
    return rows.map((row) => this.profileResponse(row));
  }

  async listPreparedItems(userId: string, status?: 'prepared' | 'completed' | 'dismissed') {
    const filters = [eq(preparedShoppingItems.userId, userId)];
    if (status) filters.push(eq(preparedShoppingItems.status, status));
    const rows = await this.db.select().from(preparedShoppingItems)
      .where(and(...filters))
      .orderBy(desc(preparedShoppingItems.createdAt));
    return rows.map((row) => ({
      id: row.id,
      sourcePlanId: row.sourcePlanId,
      itemName: row.itemName,
      quantitySuggestion: row.quantitySuggestion,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  resolveInternal(_userId: string, config: Record<string, unknown>, context: HouseholdContext) {
    const current = this.normalizeProfile(context.householdSupplyProfile)
      ?? this.normalizeProfile({
        itemName: config.itemName,
        category: config.category,
        lastPurchasedAt: config.lastPurchasedAt,
        quantity: config.purchaseQuantity,
        estimatedUsageDays: config.estimatedUsageDays,
        sourceType: 'internal',
      });
    if (!current) return context;
    return this.enrichContext({
      ...context,
      householdSupplyProfile: current,
      remindBeforeDays: typeof config.remindBeforeDays === 'number' ? config.remindBeforeDays : context.remindBeforeDays,
      preparationMode: typeof config.preparationMode === 'string' ? config.preparationMode : context.preparationMode,
    });
  }

  enrichContext(context: HouseholdContext) {
    const profile = this.normalizeProfile(context.householdSupplyProfile ?? context);
    if (!profile) return context;
    const runOutAt = profile.estimatedRunOutAt ? new Date(profile.estimatedRunOutAt) : this.runOutAt(profile.lastPurchasedAt, profile.estimatedUsageDays);
    const reference = typeof context.referenceDate === 'string' ? new Date(context.referenceDate) : new Date();
    const remindBeforeDays = typeof context.remindBeforeDays === 'number' ? context.remindBeforeDays : 0;
    const daysUntilRunOut = Math.ceil((runOutAt.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24));
    const reminderAt = new Date(runOutAt);
    reminderAt.setUTCDate(reminderAt.getUTCDate() - remindBeforeDays);
    const nearRunOut = reference >= reminderAt;
    return {
      ...context,
      householdSupplyProfile: {
        ...profile,
        estimatedRunOutAt: runOutAt.toISOString(),
      },
      itemName: profile.itemName,
      category: profile.category,
      purchaseQuantity: profile.quantity,
      estimatedUsageDays: profile.estimatedUsageDays,
      estimatedRunOutAt: runOutAt.toISOString(),
      remindBeforeDays,
      daysUntilRunOut,
      nearRunOut,
      preparationMode: typeof context.preparationMode === 'string' ? context.preparationMode : 'reminder',
      sourceType: profile.sourceType,
    };
  }

  async prepareShoppingItem(userId: string, planId: string, input: {
    itemName: string;
    quantitySuggestion: number;
    reason: string;
    dedupeKey: string;
  }) {
    const now = new Date();
    await this.db.insert(preparedShoppingItems).values({
      id: newId(),
      userId,
      sourcePlanId: planId,
      itemName: input.itemName,
      quantitySuggestion: input.quantitySuggestion,
      reason: input.reason,
      dedupeKey: input.dedupeKey,
      status: 'prepared',
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        reason: input.reason,
        quantitySuggestion: input.quantitySuggestion,
        status: 'prepared',
        updatedAt: now,
      },
    });
    const row = (await this.db.select().from(preparedShoppingItems)
      .where(and(eq(preparedShoppingItems.userId, userId), eq(preparedShoppingItems.dedupeKey, input.dedupeKey)))
      .limit(1))[0];
    return row ? {
      id: row.id,
      itemName: row.itemName,
      quantitySuggestion: row.quantitySuggestion,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    } : null;
  }

  private async getProfileById(userId: string, id: string) {
    const row = (await this.db.select().from(householdSupplyProfiles)
      .where(and(eq(householdSupplyProfiles.userId, userId), eq(householdSupplyProfiles.id, id)))
      .limit(1))[0];
    return row ? this.profileResponse(row) : null;
  }

  private normalizeProfile(value: unknown): HouseholdSupplyProfileShape | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const quantity = typeof row.quantity === 'number'
      ? row.quantity
      : typeof row.purchaseQuantity === 'number'
        ? row.purchaseQuantity
        : null;
    if (
      typeof row.itemName !== 'string'
      || typeof row.category !== 'string'
      || typeof row.lastPurchasedAt !== 'string'
      || typeof row.estimatedUsageDays !== 'number'
      || quantity === null
    ) return null;
    return {
      itemName: row.itemName,
      category: row.category,
      lastPurchasedAt: row.lastPurchasedAt,
      quantity,
      estimatedUsageDays: row.estimatedUsageDays,
      estimatedRunOutAt: typeof row.estimatedRunOutAt === 'string' ? row.estimatedRunOutAt : null,
      sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'internal',
    };
  }

  private runOutAt(lastPurchasedAt: string, estimatedUsageDays: number) {
    const date = new Date(lastPurchasedAt);
    date.setUTCDate(date.getUTCDate() + estimatedUsageDays);
    return date;
  }

  private profileResponse(row: typeof householdSupplyProfiles.$inferSelect) {
    return {
      id: row.id,
      itemName: row.itemName,
      category: row.category,
      lastPurchasedAt: row.lastPurchasedAt.toISOString(),
      quantity: row.quantity,
      estimatedUsageDays: row.estimatedUsageDays,
      estimatedRunOutAt: row.estimatedRunOutAt.toISOString(),
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
