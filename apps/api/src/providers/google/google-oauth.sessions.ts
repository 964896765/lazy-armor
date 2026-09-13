import { ForbiddenException } from '@nestjs/common';
import type { GoogleOAuthConfig } from '@lazy-armor/config';
import { oauthAuthorizationStates } from '@lazy-armor/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { InjectedDatabase } from '../../common/database.module';
import type { ConnectionsService } from '../../connections/connections.service';

// HTTP callback adapter only: all ownership, credentials and CAS completion use
// the existing ConnectionsService. No separate auth store or token lifecycle.
export class GoogleOAuthSessions {
  constructor(private readonly config: GoogleOAuthConfig, private readonly providerKey: string,
    private readonly connections: ConnectionsService, private readonly db: InjectedDatabase) {}
  start(userId: string) { return this.connections.startOAuth(userId, this.providerKey, { redirectUri: this.config.redirectUri }); }
  async callback(state: string, code?: string, error?: string) {
    if (!/^[a-f0-9]{48}$/.test(state) || (!code && !error) || (code && error) || (code && code.length > 500)) throw new ForbiddenException('Invalid OAuth callback');
    const row = (await this.db.select().from(oauthAuthorizationStates).where(and(eq(oauthAuthorizationStates.state, state),
      eq(oauthAuthorizationStates.providerKey, this.providerKey), isNull(oauthAuthorizationStates.consumedAt))).limit(1))[0];
    if (!row || row.expiresAt <= new Date() || row.redirectUri !== this.config.redirectUri) throw new ForbiddenException('Invalid OAuth state');
    if (error) {
      const result = await this.db.update(oauthAuthorizationStates).set({ consumedAt: new Date(), codeVerifier: null,
        completionStatus: 'CANCELLED', failureCode: 'OAUTH_CONSENT_DENIED', updatedAt: new Date() })
        .where(and(eq(oauthAuthorizationStates.id, row.id), isNull(oauthAuthorizationStates.consumedAt)));
      if (result[0].affectedRows !== 1) throw new ForbiddenException('OAuth state already consumed');
      return { status: 'CANCELLED' };
    }
    const connection = await this.connections.completeOAuth(row.userId, this.providerKey, { state, code: code!, redirectUri: this.config.redirectUri });
    const validated = await this.connections.validate(row.userId, connection.id);
    return { connectionId: connection.id, status: validated.connection.status };
  }
}
