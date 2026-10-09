import { Inject, Injectable, Optional } from '@nestjs/common';
import type { MemoryContextSnapshot } from '@lazy-armor/plan-schema';
import { MemoryService } from '../memory/memory.service';
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

/** Read-only context. User memory is explicitly authorized data, never Truth or policy. */
@Injectable()
export class GoalExecutionContextService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, @Optional() private readonly memory?: MemoryService) {}

  memoryContext(userId: string, intent: string): Promise<MemoryContextSnapshot> {
    return this.memory?.context(userId, intent) ?? Promise.resolve({ enabled: false, settingsVersion: 0, items: [] });
  }
  memoryContextCurrent(userId: string, context: MemoryContextSnapshot) {
    return this.memory?.contextCurrent(userId, context) ?? Promise.resolve(context.items.length === 0);
  }

  async timeContext(userId: string): Promise<GoalTimeContext> {
    const settings = (await this.db.select({ timezone: profiles.timezone, locale: profiles.locale })
      .from(profiles).where(eq(profiles.userId, userId)).limit(1))[0];
    return normalizeGoalTimeContext(settings);
  }
}
