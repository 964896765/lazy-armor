import { Inject, Injectable } from '@nestjs/common';
import { profiles } from '@lazy-armor/database';
import { eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

export interface GoalTimeContext {
  timezone: string;
  locale: string;
  settingsSource: 'PROFILE' | 'DEFAULT';
}

export function normalizeGoalTimeContext(settings?: { timezone: string; locale: string } | null): GoalTimeContext {
  let timezone = 'Asia/Shanghai';
  let locale = 'zh-CN';
  let valid = Boolean(settings);
  if (settings) {
    try { timezone = new Intl.DateTimeFormat('en', { timeZone: settings.timezone }).resolvedOptions().timeZone; }
    catch { valid = false; }
    try { locale = Intl.getCanonicalLocales(settings.locale)[0] ?? locale; }
    catch { valid = false; }
  }
  return { timezone, locale, settingsSource: valid ? 'PROFILE' : 'DEFAULT' };
}

/** Read-only context, selecting only owned time settings. Memory/credentials are not copied. */
@Injectable()
export class GoalExecutionContextService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async timeContext(userId: string): Promise<GoalTimeContext> {
    const settings = (await this.db.select({ timezone: profiles.timezone, locale: profiles.locale })
      .from(profiles).where(eq(profiles.userId, userId)).limit(1))[0];
    return normalizeGoalTimeContext(settings);
  }
}
