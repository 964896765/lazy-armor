import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { deviceConsumables, deviceProfiles, preparedShoppingItems } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

type DeviceContext = Record<string, unknown>;

interface DeviceProfileShape {
  id?: string;
  type: string;
  brand: string;
  model: string;
  purchasedAt: string;
  warrantyUntil?: string | null;
  maintenanceIntervalDays?: number | null;
  sourceType: string;
}

interface DeviceConsumableShape {
  id?: string;
  deviceProfileId?: string;
  name: string;
  lastReplacedAt: string;
  replacementIntervalDays: number;
  remindBeforeDays: number;
  expectedReplaceAt?: string | null;
  status: string;
}

@Injectable()
export class DeviceService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async createProfile(userId: string, input: {
    type: string;
    brand: string;
    model: string;
    purchasedAt: string;
    warrantyUntil?: string;
    maintenanceIntervalDays?: number;
    sourceType: 'manual' | 'internal' | 'test';
  }) {
    const now = new Date();
    const id = newId();
    await this.db.insert(deviceProfiles).values({
      id,
      userId,
      type: input.type,
      brand: input.brand,
      model: input.model,
      purchasedAt: new Date(input.purchasedAt),
      warrantyUntil: input.warrantyUntil ? new Date(input.warrantyUntil) : null,
      maintenanceIntervalDays: input.maintenanceIntervalDays ?? null,
      sourceType: input.sourceType,
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getProfileById(userId, id);
  }

  async listProfiles(userId: string, type?: string) {
    const filters = [eq(deviceProfiles.userId, userId)];
    if (type) filters.push(eq(deviceProfiles.type, type));
    const rows = await this.db.select().from(deviceProfiles)
      .where(and(...filters))
      .orderBy(desc(deviceProfiles.createdAt));
    return rows.map((row) => this.profileResponse(row));
  }

  async createConsumable(userId: string, input: {
    deviceProfileId: string;
    name: string;
    lastReplacedAt: string;
    replacementIntervalDays: number;
    remindBeforeDays: number;
  }) {
    await this.assertProfileOwned(userId, input.deviceProfileId);
    const now = new Date();
    const id = newId();
    await this.db.insert(deviceConsumables).values({
      id,
      userId,
      deviceProfileId: input.deviceProfileId,
      name: input.name,
      lastReplacedAt: new Date(input.lastReplacedAt),
      replacementIntervalDays: input.replacementIntervalDays,
      remindBeforeDays: input.remindBeforeDays,
      expectedReplaceAt: this.expectedReplaceAt(input.lastReplacedAt, input.replacementIntervalDays),
      status: 'active',
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getConsumableById(userId, id);
  }

  async listConsumables(userId: string, deviceProfileId?: string) {
    const filters = [eq(deviceConsumables.userId, userId)];
    if (deviceProfileId) filters.push(eq(deviceConsumables.deviceProfileId, deviceProfileId));
    const rows = await this.db.select().from(deviceConsumables)
      .where(and(...filters))
      .orderBy(desc(deviceConsumables.expectedReplaceAt), desc(deviceConsumables.createdAt));
    return rows.map((row) => this.consumableResponse(row));
  }

  async updateReplacement(userId: string, consumableId: string, lastReplacedAt: string) {
    const row = await this.getConsumableRow(userId, consumableId);
    const now = new Date();
    await this.db.update(deviceConsumables).set({
      lastReplacedAt: new Date(lastReplacedAt),
      expectedReplaceAt: this.expectedReplaceAt(lastReplacedAt, row.replacementIntervalDays),
      updatedAt: now,
    }).where(eq(deviceConsumables.id, consumableId));
    return this.getConsumableById(userId, consumableId);
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: DeviceContext) {
    const deviceProfileId = typeof config.deviceProfileId === 'string' ? config.deviceProfileId : null;
    const consumableId = typeof config.consumableId === 'string' ? config.consumableId : null;
    if (!deviceProfileId || !consumableId) return context;
    const [profile, consumable] = await Promise.all([
      this.getProfileById(userId, deviceProfileId),
      this.getConsumableById(userId, consumableId),
    ]);
    if (!profile || !consumable) return context;
    return this.enrichContext({
      ...context,
      deviceProfile: profile,
      deviceConsumable: consumable,
      preparationMode: typeof config.preparationMode === 'string' ? config.preparationMode : context.preparationMode,
    });
  }

  enrichContext(context: DeviceContext) {
    const profile = this.normalizeProfile(context.deviceProfile);
    const consumable = this.normalizeConsumable(context.deviceConsumable);
    if (!profile || !consumable) return context;
    const reference = typeof context.referenceDate === 'string' ? new Date(context.referenceDate) : new Date();
    const expectedReplaceAt = consumable.expectedReplaceAt ? new Date(consumable.expectedReplaceAt) : this.expectedReplaceAt(consumable.lastReplacedAt, consumable.replacementIntervalDays);
    const remainingDays = Math.ceil((expectedReplaceAt.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24));
    const reminderAt = new Date(expectedReplaceAt);
    reminderAt.setUTCDate(reminderAt.getUTCDate() - consumable.remindBeforeDays);
    const nearReplacement = reference >= reminderAt;
    return {
      ...context,
      deviceProfile: profile,
      deviceConsumable: {
        ...consumable,
        expectedReplaceAt: expectedReplaceAt.toISOString(),
      },
      deviceType: profile.type,
      deviceBrand: profile.brand,
      deviceModel: profile.model,
      consumableName: consumable.name,
      replacementIntervalDays: consumable.replacementIntervalDays,
      remindBeforeDays: consumable.remindBeforeDays,
      expectedReplaceAt: expectedReplaceAt.toISOString(),
      remainingDays,
      nearReplacement,
      preparationMode: typeof context.preparationMode === 'string' ? context.preparationMode : 'shopping_list',
    };
  }

  async preparePurchaseItem(userId: string, planId: string, context: DeviceContext) {
    const enriched = this.enrichContext(context);
    if (!enriched.nearReplacement || enriched.preparationMode !== 'shopping_list') return null;
    const itemName = `${typeof enriched.deviceBrand === 'string' ? enriched.deviceBrand : ''}${typeof enriched.deviceModel === 'string' ? ` ${enriched.deviceModel}` : ''} ${typeof enriched.consumableName === 'string' ? enriched.consumableName : '耗材'}`.trim();
    const expectedReplaceAt = typeof enriched.expectedReplaceAt === 'string' ? enriched.expectedReplaceAt : 'unknown';
    const reason = `${itemName}预计 ${Math.max(typeof enriched.remainingDays === 'number' ? enriched.remainingDays : 0, 0)} 天后需要更换。`;
    const now = new Date();
    const dedupeKey = `device-consumable:${planId}:${typeof enriched.consumableName === 'string' ? enriched.consumableName : 'consumable'}:${expectedReplaceAt}`;
    await this.db.insert(preparedShoppingItems).values({
      id: newId(),
      userId,
      sourcePlanId: planId,
      itemName,
      quantitySuggestion: 1,
      reason,
      dedupeKey,
      status: 'prepared',
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        reason,
        quantitySuggestion: 1,
        status: 'prepared',
        updatedAt: now,
      },
    });
    const row = (await this.db.select().from(preparedShoppingItems)
      .where(and(eq(preparedShoppingItems.userId, userId), eq(preparedShoppingItems.dedupeKey, dedupeKey)))
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

  private async assertProfileOwned(userId: string, deviceProfileId: string) {
    const row = (await this.db.select({ id: deviceProfiles.id }).from(deviceProfiles)
      .where(and(eq(deviceProfiles.id, deviceProfileId), eq(deviceProfiles.userId, userId)))
      .limit(1))[0];
    if (!row) throw new NotFoundException('Device profile not found');
  }

  private async getProfileRow(userId: string, id: string) {
    const row = (await this.db.select().from(deviceProfiles)
      .where(and(eq(deviceProfiles.userId, userId), eq(deviceProfiles.id, id)))
      .limit(1))[0];
    if (!row) throw new NotFoundException('Device profile not found');
    return row;
  }

  private async getConsumableRow(userId: string, id: string) {
    const row = (await this.db.select().from(deviceConsumables)
      .where(and(eq(deviceConsumables.userId, userId), eq(deviceConsumables.id, id)))
      .limit(1))[0];
    if (!row) throw new NotFoundException('Device consumable not found');
    return row;
  }

  private async getProfileById(userId: string, id: string) {
    const row = await this.getProfileRow(userId, id);
    return this.profileResponse(row);
  }

  private async getConsumableById(userId: string, id: string) {
    const row = await this.getConsumableRow(userId, id);
    return this.consumableResponse(row);
  }

  private normalizeProfile(value: unknown): DeviceProfileShape | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.type !== 'string'
      || typeof row.brand !== 'string'
      || typeof row.model !== 'string'
      || typeof row.purchasedAt !== 'string'
    ) return null;
    return {
      id: typeof row.id === 'string' ? row.id : undefined,
      type: row.type,
      brand: row.brand,
      model: row.model,
      purchasedAt: row.purchasedAt,
      warrantyUntil: typeof row.warrantyUntil === 'string' ? row.warrantyUntil : null,
      maintenanceIntervalDays: typeof row.maintenanceIntervalDays === 'number' ? row.maintenanceIntervalDays : null,
      sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'internal',
    };
  }

  private normalizeConsumable(value: unknown): DeviceConsumableShape | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.name !== 'string'
      || typeof row.lastReplacedAt !== 'string'
      || typeof row.replacementIntervalDays !== 'number'
      || typeof row.remindBeforeDays !== 'number'
    ) return null;
    return {
      id: typeof row.id === 'string' ? row.id : undefined,
      deviceProfileId: typeof row.deviceProfileId === 'string' ? row.deviceProfileId : undefined,
      name: row.name,
      lastReplacedAt: row.lastReplacedAt,
      replacementIntervalDays: row.replacementIntervalDays,
      remindBeforeDays: row.remindBeforeDays,
      expectedReplaceAt: typeof row.expectedReplaceAt === 'string' ? row.expectedReplaceAt : null,
      status: typeof row.status === 'string' ? row.status : 'active',
    };
  }

  private expectedReplaceAt(lastReplacedAt: string, replacementIntervalDays: number) {
    const date = new Date(lastReplacedAt);
    date.setUTCDate(date.getUTCDate() + replacementIntervalDays);
    return date;
  }

  private profileResponse(row: typeof deviceProfiles.$inferSelect) {
    return {
      id: row.id,
      type: row.type,
      brand: row.brand,
      model: row.model,
      purchasedAt: row.purchasedAt.toISOString(),
      warrantyUntil: row.warrantyUntil?.toISOString() ?? null,
      maintenanceIntervalDays: row.maintenanceIntervalDays,
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private consumableResponse(row: typeof deviceConsumables.$inferSelect) {
    return {
      id: row.id,
      deviceProfileId: row.deviceProfileId,
      name: row.name,
      lastReplacedAt: row.lastReplacedAt.toISOString(),
      replacementIntervalDays: row.replacementIntervalDays,
      remindBeforeDays: row.remindBeforeDays,
      expectedReplaceAt: row.expectedReplaceAt.toISOString(),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
