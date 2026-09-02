import { ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { authIdentities, authSessions, passwordResetTokens, profiles, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import type { AuthenticatedUser, UserRole } from '../common/auth-context';
import type { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto';

const LOGIN_UNIFORM_ERROR = 'Invalid email or password';
let dummyPasswordHashPromise: Promise<string> | undefined;
function dummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHashPromise) dummyPasswordHashPromise = hash('lazy-armor-dummy-password', 12);
  return dummyPasswordHashPromise;
}
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private readonly resetTtlSeconds: number;

  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.accessTtlSeconds = this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS') ?? 900;
    this.refreshTtlSeconds = this.config.get<number>('REFRESH_TOKEN_TTL_SECONDS') ?? 2_592_000;
    this.resetTtlSeconds = this.config.get<number>('PASSWORD_RESET_TOKEN_TTL_SECONDS') ?? 1800;
  }

  private registrationAllowed(): boolean {
    const explicit = this.config.get<string>('PUBLIC_REGISTRATION');
    if (explicit !== undefined) return explicit === 'true';
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  async register(input: RegisterDto) {
    if (!this.registrationAllowed()) throw new ForbiddenException('Public registration is disabled');
    const email = input.email.trim().toLowerCase();
    const existing = await this.db.select({ id: authIdentities.id }).from(authIdentities).where(eq(authIdentities.email, email)).limit(1);
    if (existing.length) throw new HttpException(LOGIN_UNIFORM_ERROR, 409);

    const now = new Date();
    const userId = newId();
    const profileId = newId();
    const identityId = newId();
    const passwordHash = await hash(input.password, 12);

    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(users).values({ id: userId, status: 'active', role: 'user', createdAt: now, updatedAt: now });
        await tx.insert(profiles).values({
          id: profileId,
          userId,
          displayName: input.displayName,
          avatar: null,
          timezone: 'Asia/Shanghai',
          locale: 'zh-CN',
          preferencesJson: null,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(authIdentities).values({ id: identityId, userId, email, passwordHash, emailVerifiedAt: null, createdAt: now, updatedAt: now });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpException(LOGIN_UNIFORM_ERROR, 409);
      throw error;
    }
    return this.issueTokens(userId, null);
  }

  async login(input: LoginDto, context: RequestContext): Promise<TokenPair> {
    const email = input.email.trim().toLowerCase();
    const ip = context.ip ?? 'unknown';
    const accountLimit = await this.rateLimiter.consume(`login:acct:${email}`, 10, 300);
    const ipLimit = await this.rateLimiter.consume(`login:ip:${ip}`, 20, 300);
    if (!accountLimit.allowed || !ipLimit.allowed) {
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'LOGIN_RATE_LIMITED', resourceType: 'auth', resourceId: ip, userId: null, source: 'api', result: 'blocked', reasonCode: 'LOGIN_RATE_LIMITED', changeSummary: 'Login rate limit exceeded' });
      throw new HttpException('Too many login attempts, please try again later', 429);
    }

    const rows = await this.db.select({ userId: authIdentities.userId, passwordHash: authIdentities.passwordHash, status: users.status, role: users.role })
      .from(authIdentities)
      .innerJoin(users, eq(authIdentities.userId, users.id))
      .where(eq(authIdentities.email, email))
      .limit(1);
    const row = rows[0];
    // 账号枚举防护：不存在账号也执行一次同代价的 bcrypt 比较。
    const passwordOk = row ? await compare(input.password, row.passwordHash) : await compare(input.password, await dummyPasswordHash());
    if (!row || row.status !== 'active' || !passwordOk) {
      const failCount = await this.rateLimiter.failureCount(`login:fail:acct:${email}`, 900);
      if (row) {
        await this.audit.append({ actorType: 'user', actorUserId: row.userId, action: 'LOGIN_FAILURE', resourceType: 'auth', resourceId: email, userId: row.userId, source: 'api', result: 'failure', reasonCode: 'INVALID_CREDENTIALS', changeSummary: 'Login failed with invalid credentials' });
      }
      if (failCount >= 5) throw new HttpException('Too many failed attempts, please try again later', 429);
      throw new UnauthorizedException(LOGIN_UNIFORM_ERROR);
    }
    await this.rateLimiter.resetFailures(`login:fail:acct:${email}`);
    await this.audit.append({ actorType: 'user', actorUserId: row.userId, action: 'LOGIN_SUCCESS', resourceType: 'auth', resourceId: email, userId: row.userId, source: 'api', result: 'success', changeSummary: 'User logged in' });
    return this.issueTokens(row.userId, { ip, userAgent: context.userAgent ?? null });
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token);
      const rows = await this.db.select({ id: users.id, status: users.status, role: users.role }).from(users).where(eq(users.id, payload.sub)).limit(1);
      const user = rows[0];
      if (!user || user.status !== 'active') throw new Error('inactive');
      const sessions = await this.db.select({ id: authSessions.id }).from(authSessions)
        .where(and(eq(authSessions.id, payload.sid), eq(authSessions.userId, user.id), isNull(authSessions.revokedAt))).limit(1);
      if (!sessions[0]) throw new Error('session revoked');
      return { id: user.id, status: 'active', role: user.role as UserRole };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const sessions = await this.db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, tokenHash)).limit(1);
    const session = sessions[0];
    if (!session) throw new UnauthorizedException('Invalid refresh token');
    if (session.revokedAt) {
      // 重用检测：已轮换/撤销的 token 再次使用 → 撤销整个 family。
      await this.revokeFamily(session.familyId, 'refresh_reuse');
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'REFRESH_REUSE_DETECTED', resourceType: 'auth_session', resourceId: session.id, userId: session.userId, source: 'api', result: 'blocked', reasonCode: 'REFRESH_REUSE', changeSummary: 'Reused refresh token detected; session family revoked' });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (session.expiresAt <= new Date()) throw new UnauthorizedException('Refresh token expired');
    const now = new Date();
    const rotated = await this.rotateSession(session, now, context);
    return this.issueAccessAndRefresh(rotated.sessionId, rotated.refreshToken, session.userId);
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const session = (await this.db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, tokenHash)).limit(1))[0];
    if (!session) return { revoked: false };
    await this.db.update(authSessions).set({ revokedAt: new Date(), revokeReason: 'logout' }).where(eq(authSessions.id, session.id));
    await this.audit.append({ actorType: 'user', actorUserId: session.userId, action: 'LOGOUT', resourceType: 'auth_session', resourceId: session.id, userId: session.userId, source: 'api', result: 'success', changeSummary: 'Session revoked on logout' });
    return { revoked: true };
  }

  async changePassword(userId: string, input: ChangePasswordDto) {
    const rows = await this.db.select({ id: authIdentities.id, passwordHash: authIdentities.passwordHash }).from(authIdentities).where(eq(authIdentities.userId, userId)).limit(1);
    const identity = rows[0];
    if (!identity || !(await compare(input.oldPassword, identity.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await hash(input.newPassword, 12);
    await this.db.update(authIdentities).set({ passwordHash, updatedAt: new Date() }).where(eq(authIdentities.id, identity.id));
    // 密码修改后撤销旧 Session（§2/§5）。
    await this.db.update(authSessions).set({ revokedAt: new Date(), revokeReason: 'password_changed' }).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'PASSWORD_CHANGED', resourceType: 'auth', resourceId: userId, userId, source: 'api', result: 'success', changeSummary: 'Password changed; all sessions revoked' });
    return { changed: true };
  }

  async forgotPassword(email: string) {
    const normalized = email.trim().toLowerCase();
    const identity = (await this.db.select({ userId: authIdentities.userId }).from(authIdentities).where(eq(authIdentities.email, normalized)).limit(1))[0];
    // 统一响应，不泄漏账号是否存在。
    if (!identity) return { requested: true };
    const raw = randomBytes(32).toString('hex');
    const now = new Date();
    await this.db.insert(passwordResetTokens).values({
      id: newId(), userId: identity.userId, tokenHash: hashToken(raw),
      expiresAt: new Date(now.getTime() + this.resetTtlSeconds * 1000), usedAt: null, createdAt: now,
    });
    // 本轮无真实邮件 Provider：不持久化明文，仅记录审计；真实投递留待 P1 Email Provider。
    await this.audit.append({ actorType: 'system', actorUserId: null, action: 'PASSWORD_RESET_REQUESTED', resourceType: 'auth', resourceId: normalized, userId: identity.userId, source: 'api', result: 'success', changeSummary: 'Password reset requested' });
    return { requested: true };
  }

  async resetPassword(input: ResetPasswordDto) {
    const tokenHash = hashToken(input.token);
    const tokenRow = (await this.db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1))[0];
    if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date()) throw new UnauthorizedException('Invalid or expired reset token');
    const passwordHash = await hash(input.newPassword, 12);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(authIdentities).set({ passwordHash, updatedAt: now }).where(eq(authIdentities.userId, tokenRow.userId));
      await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, tokenRow.id));
      await tx.update(authSessions).set({ revokedAt: now, revokeReason: 'password_reset' }).where(and(eq(authSessions.userId, tokenRow.userId), isNull(authSessions.revokedAt)));
    });
    await this.audit.append({ actorType: 'user', actorUserId: tokenRow.userId, action: 'PASSWORD_RESET_COMPLETED', resourceType: 'auth', resourceId: tokenRow.userId, userId: tokenRow.userId, source: 'api', result: 'success', changeSummary: 'Password reset completed; all sessions revoked' });
    return { reset: true };
  }

  private async issueTokens(userId: string, clientMeta: Record<string, unknown> | null): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('hex');
    const sessionId = newId();
    const now = new Date();
    await this.db.insert(authSessions).values({
      id: sessionId, userId, refreshTokenHash: hashToken(refreshToken), familyId: newId(),
      clientMetadataJson: clientMeta ?? null, createdAt: now, expiresAt: new Date(now.getTime() + this.refreshTtlSeconds * 1000),
      lastUsedAt: null, revokedAt: null, revokeReason: null,
    });
    return this.issueAccessAndRefresh(sessionId, refreshToken, userId);
  }

  private async issueAccessAndRefresh(sessionId: string, refreshToken: string, userId: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: this.accessTtlSeconds });
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: this.accessTtlSeconds };
  }

  private async rotateSession(session: typeof authSessions.$inferSelect, now: Date, context: RequestContext): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = randomBytes(32).toString('hex');
    const sessionId = newId();
    await this.db.transaction(async (tx) => {
      await tx.update(authSessions).set({ revokedAt: now, revokeReason: 'rotated', lastUsedAt: now }).where(eq(authSessions.id, session.id));
      await tx.insert(authSessions).values({
        id: sessionId, userId: session.userId, refreshTokenHash: hashToken(refreshToken), familyId: session.familyId,
        clientMetadataJson: { ...(session.clientMetadataJson ?? {}), ...(context.ip ? { ip: context.ip } : {}), ...(context.userAgent ? { userAgent: context.userAgent } : {}) },
        createdAt: now, expiresAt: session.expiresAt, lastUsedAt: null, revokedAt: null, revokeReason: null,
      });
    });
    return { sessionId, refreshToken };
  }

  private async revokeFamily(familyId: string, reason: string) {
    const now = new Date();
    await this.db.update(authSessions).set({ revokedAt: now, revokeReason: reason }).where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)));
  }
}
