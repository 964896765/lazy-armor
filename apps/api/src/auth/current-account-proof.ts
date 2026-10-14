import { Injectable, UnauthorizedException } from '@nestjs/common';
import { authIdentities, authSessions, loginIdentifiers, users } from '@lazy-armor/database';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { InjectedDatabase } from '../common/database.module';
import type { AuthenticatedUser } from '../common/auth-context';
import { PasswordCredentialService } from './password-credential.service';

// Shared by identifier binding and Passkey enrollment. No client identity selects an account.
@Injectable()
export class CurrentAccountProofService {
  constructor(private readonly passwords: PasswordCredentialService) {}
  async passwordEpoch(userId: string, reader: Pick<InjectedDatabase, 'select'>, digest: (value: string) => string, lock = false) {
    return digest(JSON.stringify(await this.passwords.observe(userId, reader, lock) ?? { userId, password: 'none' }));
  }
  sourceEpoch(row: typeof loginIdentifiers.$inferSelect, digest: (value: string) => string) {
    return digest(JSON.stringify([row.id, row.userId, row.kind, row.identifier, row.verifiedAt]));
  }
  async source(userId: string, id: string, reader: Pick<InjectedDatabase, 'select'>, lock = false) {
    const query = reader.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.id, id), eq(loginIdentifiers.userId, userId))).limit(1);
    const row = (await (lock ? query.for('update') : query))[0];
    if (!row?.verifiedAt || row.disabledAt || !['email', 'phone'].includes(row.kind)) throw new UnauthorizedException('当前账号验证已失效');
    if (row.kind === 'email') {
      const query = reader.select().from(authIdentities).where(eq(authIdentities.email, row.identifier)).limit(1);
      const legacy = (await (lock ? query.for('update') : query))[0];
      if (legacy && legacy.userId !== userId) throw new UnauthorizedException('当前账号验证已失效');
    }
    return row;
  }
  async assertSession(user: AuthenticatedUser, reader: Pick<InjectedDatabase, 'select'>, lock = false) {
    if (!user.sessionId) throw new UnauthorizedException('当前账号验证已失效');
    const userQuery = reader.select({ status: users.status }).from(users).where(eq(users.id, user.id)).limit(1);
    const active = (await (lock ? userQuery.for('update') : userQuery))[0];
    const query = reader.select({ id: authSessions.id, expiresAt: authSessions.expiresAt }).from(authSessions).where(and(eq(authSessions.id, user.sessionId), eq(authSessions.userId, user.id), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date()))).limit(1);
    const session = (await (lock ? query.for('update') : query))[0];
    if (active?.status !== 'active' || !session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('当前账号验证已失效');
  }
}
