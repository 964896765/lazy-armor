import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { digitalAccountProfiles, planVersions, plans, recurringItemProfiles, vehicleProfiles } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { CompleteRecurringItemProfileDto, CreateDigitalAccountProfileDto, CreateRecurringItemProfileDto, CreateVehicleProfileDto, UpdateVehicleMileageDto } from './dto';

@Injectable()
export class ProfilesService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async createVehicle(userId: string, input: CreateVehicleProfileDto) {
    const id = newId();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(vehicleProfiles).values({
        id, userId, brand: input.brand.trim(), model: input.model.trim(), year: input.year,
        purchasedAt: date(input.purchasedAt), mileageKm: input.mileageKm, mileageUpdatedAt: now,
        insuranceExpiresAt: date(input.insuranceExpiresAt), inspectionDueAt: date(input.inspectionDueAt),
        maintenanceDueAt: date(input.maintenanceDueAt), maintenanceMileageKm: input.maintenanceMileageKm ?? null,
        tireInstalledAt: date(input.tireInstalledAt), batteryInstalledAt: date(input.batteryInstalledAt),
        sourceType: 'manual', metadataJson: null, createdAt: now, updatedAt: now,
      });
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'VEHICLE_PROFILE_CREATED', resourceType: 'vehicle_profile', resourceId: id, userId, correlationId: id, source: 'api', result: 'success', changeSummary: 'Vehicle profile created from user-provided facts', after: { brand: input.brand, model: input.model, year: input.year, mileageKm: input.mileageKm } }, tx);
    });
    return this.getVehicle(userId, id);
  }

  listVehicles(userId: string) {
    return this.db.select().from(vehicleProfiles).where(eq(vehicleProfiles.userId, userId)).orderBy(desc(vehicleProfiles.createdAt));
  }

  async vehicleDetail(userId: string, id: string) {
    return this.getVehicle(userId, id);
  }

  async listPlansUsingVehicle(userId: string, vehicleId: string) {
    await this.getVehicle(userId, vehicleId);
    const rows = await this.db.select({
      planId: plans.id,
      planStatus: plans.status,
      planName: planVersions.name,
      templateKey: planVersions.templateKey,
      templateConfig: planVersions.templateConfigJson,
    })
      .from(plans)
      .innerJoin(planVersions, eq(plans.currentVersionId, planVersions.id))
      .where(eq(plans.userId, userId))
      .orderBy(desc(plans.updatedAt));
    return rows
      .filter((row) => {
        const config = (row.templateConfig ?? {}) as Record<string, unknown>;
        return config.profileId === vehicleId;
      })
      .map((row) => ({
        planId: row.planId,
        planName: row.planName,
        planStatus: row.planStatus,
        templateKey: row.templateKey,
      }));
  }

  async updateMileage(userId: string, id: string, input: UpdateVehicleMileageDto) {
    const recordedAt = date(input.recordedAt) ?? new Date();
    await this.db.transaction(async (tx) => {
      const current = (await tx.select().from(vehicleProfiles).where(and(eq(vehicleProfiles.id, id), eq(vehicleProfiles.userId, userId))).limit(1).for('update'))[0];
      if (!current) throw new NotFoundException('Vehicle profile not found');
      if (input.mileageKm < current.mileageKm) throw new BadRequestException('Mileage cannot move backwards');
      await tx.update(vehicleProfiles).set({ mileageKm: input.mileageKm, mileageUpdatedAt: recordedAt, updatedAt: new Date() }).where(eq(vehicleProfiles.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'VEHICLE_MILEAGE_UPDATED', resourceType: 'vehicle_profile', resourceId: id, userId, correlationId: id, source: 'api', result: 'success', before: { mileageKm: current.mileageKm }, after: { mileageKm: input.mileageKm, recordedAt }, changeSummary: 'Vehicle mileage updated manually' }, tx);
    });
    return this.getVehicle(userId, id);
  }

  async createDigitalAccount(userId: string, input: CreateDigitalAccountProfileDto) {
    const id = newId();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(digitalAccountProfiles).values({
        id, userId, serviceName: input.serviceName.trim(), subscriptionStatus: input.subscriptionStatus,
        expiresAt: date(input.expiresAt), connectionStatus: input.connectionStatus,
        securityReminderAt: date(input.securityReminderAt), backupStatus: input.backupStatus,
        sourceType: 'manual', metadataJson: null, createdAt: now, updatedAt: now,
      });
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'DIGITAL_ACCOUNT_PROFILE_CREATED', resourceType: 'digital_account_profile', resourceId: id, userId, correlationId: id, source: 'api', result: 'success', changeSummary: 'Digital account profile created without credentials', after: { serviceName: input.serviceName, subscriptionStatus: input.subscriptionStatus, connectionStatus: input.connectionStatus, backupStatus: input.backupStatus } }, tx);
    });
    return this.getDigitalAccount(userId, id);
  }

  listDigitalAccounts(userId: string) {
    return this.db.select().from(digitalAccountProfiles).where(eq(digitalAccountProfiles.userId, userId)).orderBy(desc(digitalAccountProfiles.createdAt));
  }

  async createRecurringItem(userId: string, input: CreateRecurringItemProfileDto) {
    const id = newId();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(recurringItemProfiles).values({
        id, userId, domain: input.domain, category: input.category.trim(), title: input.title.trim(),
        nextDueAt: new Date(input.nextDueAt), recurrenceDays: input.recurrenceDays ?? null,
        remindBeforeDays: input.remindBeforeDays, status: 'active', lastCompletedAt: null,
        sourceType: 'manual', metadataJson: null, createdAt: now, updatedAt: now,
      });
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'RECURRING_ITEM_PROFILE_CREATED', resourceType: 'recurring_item_profile', resourceId: id, userId, correlationId: id, source: 'api', result: 'success', changeSummary: 'Reusable recurring item profile created', after: { domain: input.domain, category: input.category, title: input.title, nextDueAt: input.nextDueAt, recurrenceDays: input.recurrenceDays ?? null, remindBeforeDays: input.remindBeforeDays } }, tx);
    });
    return this.getRecurringItem(userId, id);
  }

  listRecurringItems(userId: string) {
    return this.db.select().from(recurringItemProfiles).where(eq(recurringItemProfiles.userId, userId)).orderBy(desc(recurringItemProfiles.nextDueAt));
  }

  async completeRecurringItem(userId: string, id: string, input: CompleteRecurringItemProfileDto) {
    const completedAt = date(input.completedAt) ?? new Date();
    await this.db.transaction(async (tx) => {
      const current = (await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, id), eq(recurringItemProfiles.userId, userId))).limit(1).for('update'))[0];
      if (!current) throw new NotFoundException('Recurring item profile not found');
      let nextDueAt = current.nextDueAt;
      let status = 'completed';
      if (current.recurrenceDays) {
        nextDueAt = new Date(current.nextDueAt);
        do nextDueAt.setUTCDate(nextDueAt.getUTCDate() + current.recurrenceDays); while (nextDueAt <= completedAt);
        status = 'active';
      }
      await tx.update(recurringItemProfiles).set({ nextDueAt, status, lastCompletedAt: completedAt, updatedAt: new Date() }).where(eq(recurringItemProfiles.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'RECURRING_ITEM_COMPLETED', resourceType: 'recurring_item_profile', resourceId: id, userId, correlationId: id, source: 'api', result: 'success', before: { nextDueAt: current.nextDueAt, status: current.status }, after: { nextDueAt, status, completedAt }, changeSummary: current.recurrenceDays ? 'Recurring item advanced to its next due date' : 'One-time recurring item completed' }, tx);
    });
    return this.getRecurringItem(userId, id);
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: Record<string, unknown>) {
    const profileId = typeof config.profileId === 'string' ? config.profileId : '';
    if (!profileId) throw new BadRequestException('Profile source requires profileId');
    if (config.resource === 'vehicle_profile') {
      const vehicle = await this.getVehicle(userId, profileId);
      return { ...context, vehicle: {
        id: vehicle.id, brand: vehicle.brand, model: vehicle.model, year: vehicle.year,
        mileageKm: vehicle.mileageKm, mileageUpdatedAt: vehicle.mileageUpdatedAt.toISOString(),
        insuranceExpiresAt: vehicle.insuranceExpiresAt?.toISOString() ?? null,
        inspectionDueAt: vehicle.inspectionDueAt?.toISOString() ?? null,
        maintenanceDueAt: vehicle.maintenanceDueAt?.toISOString() ?? null,
        maintenanceMileageKm: vehicle.maintenanceMileageKm,
        tireInstalledAt: vehicle.tireInstalledAt?.toISOString() ?? null,
        batteryInstalledAt: vehicle.batteryInstalledAt?.toISOString() ?? null,
      } };
    }
    if (config.resource === 'digital_account_profile') {
      const account = await this.getDigitalAccount(userId, profileId);
      return { ...context, digitalAccount: {
        id: account.id, serviceName: account.serviceName, subscriptionStatus: account.subscriptionStatus,
        expiresAt: account.expiresAt?.toISOString() ?? null, connectionStatus: account.connectionStatus,
        securityReminderAt: account.securityReminderAt?.toISOString() ?? null, backupStatus: account.backupStatus,
      } };
    }
    if (config.resource === 'recurring_item_profile') {
      const item = await this.getRecurringItem(userId, profileId);
      const expectedDomain = typeof config.expectedDomain === 'string' ? config.expectedDomain : null;
      if (expectedDomain && item.domain !== expectedDomain) throw new BadRequestException('Recurring item domain does not match this plan');
      const reference = typeof context.referenceDate === 'string' ? new Date(context.referenceDate) : new Date();
      const daysUntilDue = Math.ceil((item.nextDueAt.getTime() - reference.getTime()) / 86_400_000);
      return { ...context, recurringItem: {
        id: item.id, domain: item.domain, category: item.category, title: item.title,
        nextDueAt: item.nextDueAt.toISOString(), recurrenceDays: item.recurrenceDays,
        remindBeforeDays: item.remindBeforeDays, status: item.status,
        lastCompletedAt: item.lastCompletedAt?.toISOString() ?? null, daysUntilDue,
        dueSoon: item.status === 'active' && daysUntilDue <= item.remindBeforeDays,
        overdue: item.status === 'active' && daysUntilDue < 0,
      } };
    }
    throw new BadRequestException('Unsupported profile source');
  }

  private async getVehicle(userId: string, id: string) {
    const row = (await this.db.select().from(vehicleProfiles).where(and(eq(vehicleProfiles.id, id), eq(vehicleProfiles.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Vehicle profile not found');
    return row;
  }

  private async getDigitalAccount(userId: string, id: string) {
    const row = (await this.db.select().from(digitalAccountProfiles).where(and(eq(digitalAccountProfiles.id, id), eq(digitalAccountProfiles.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Digital account profile not found');
    return row;
  }

  private async getRecurringItem(userId: string, id: string) {
    const row = (await this.db.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, id), eq(recurringItemProfiles.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Recurring item profile not found');
    return row;
  }
}

function date(value?: string) { return value ? new Date(value) : null; }
