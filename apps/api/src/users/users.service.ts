import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { profiles, users } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async getMe(userId: string) {
    const rows = await this.db.select({
      id: users.id,
      status: users.status,
      displayName: profiles.displayName,
      avatar: profiles.avatar,
      timezone: profiles.timezone,
      locale: profiles.locale,
    }).from(users).innerJoin(profiles, eq(users.id, profiles.userId)).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) throw new NotFoundException('User not found');
    return rows[0];
  }

  async updateProfile(userId: string, input: { displayName?: string; avatar?: string | null; timezone?: string; locale?: string }) {
    const changes = { ...input, updatedAt: new Date() };
    await this.db.update(profiles).set(changes).where(and(eq(profiles.userId, userId)));
    return this.getMe(userId);
  }
}
