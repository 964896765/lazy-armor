import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { profiles, users } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  private readonly defaultSettings = {
    notifications: {
      importantExceptionImmediately: true,
      regularSummary: true,
      silentSuccess: true,
      dailySummaryTime: '08:00',
    },
    automationSafety: {
      preferredMode: 'confirm_before_execute',
      requireExtraConfirmationForHighRisk: true,
    },
  } as const;

  async getMe(userId: string) {
    const rows = await this.db.select({
      id: users.id,
      status: users.status,
      displayName: profiles.displayName,
      avatar: profiles.avatar,
      timezone: profiles.timezone,
      locale: profiles.locale,
      settings: profiles.preferencesJson,
    }).from(users).innerJoin(profiles, eq(users.id, profiles.userId)).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) throw new NotFoundException('User not found');
    return {
      ...rows[0],
      settings: this.mergeSettings(rows[0].settings),
    };
  }

  async updateProfile(userId: string, input: { displayName?: string; avatar?: string | null; timezone?: string; locale?: string }) {
    const changes = { ...input, updatedAt: new Date() };
    await this.db.update(profiles).set(changes).where(and(eq(profiles.userId, userId)));
    return this.getMe(userId);
  }

  async getSettings(userId: string) {
    const me = await this.getMe(userId);
    return me.settings;
  }

  async updateSettings(userId: string, input: {
    notifications?: {
      importantExceptionImmediately?: boolean;
      regularSummary?: boolean;
      silentSuccess?: boolean;
      dailySummaryTime?: string;
    };
    automationSafety?: {
      preferredMode?: string;
      requireExtraConfirmationForHighRisk?: boolean;
    };
  }) {
    const current = await this.getMe(userId);
    const next = this.mergeSettings({
      ...current.settings,
      notifications: { ...current.settings.notifications, ...(input.notifications ?? {}) },
      automationSafety: { ...current.settings.automationSafety, ...(input.automationSafety ?? {}) },
    });
    await this.db.update(profiles).set({ preferencesJson: next, updatedAt: new Date() }).where(and(eq(profiles.userId, userId)));
    return next;
  }

  private mergeSettings(settings: unknown) {
    const value = (settings && typeof settings === 'object' && !Array.isArray(settings)) ? settings as Record<string, unknown> : {};
    const notifications = (value.notifications && typeof value.notifications === 'object' && !Array.isArray(value.notifications)) ? value.notifications as Record<string, unknown> : {};
    const automationSafety = (value.automationSafety && typeof value.automationSafety === 'object' && !Array.isArray(value.automationSafety)) ? value.automationSafety as Record<string, unknown> : {};
    return {
      notifications: {
        importantExceptionImmediately: typeof notifications.importantExceptionImmediately === 'boolean' ? notifications.importantExceptionImmediately : this.defaultSettings.notifications.importantExceptionImmediately,
        regularSummary: typeof notifications.regularSummary === 'boolean' ? notifications.regularSummary : this.defaultSettings.notifications.regularSummary,
        silentSuccess: typeof notifications.silentSuccess === 'boolean' ? notifications.silentSuccess : this.defaultSettings.notifications.silentSuccess,
        dailySummaryTime: typeof notifications.dailySummaryTime === 'string' ? notifications.dailySummaryTime : this.defaultSettings.notifications.dailySummaryTime,
      },
      automationSafety: {
        preferredMode: typeof automationSafety.preferredMode === 'string' ? automationSafety.preferredMode : this.defaultSettings.automationSafety.preferredMode,
        requireExtraConfirmationForHighRisk: typeof automationSafety.requireExtraConfirmationForHighRisk === 'boolean'
          ? automationSafety.requireExtraConfirmationForHighRisk
          : this.defaultSettings.automationSafety.requireExtraConfirmationForHighRisk,
      },
    };
  }
}
