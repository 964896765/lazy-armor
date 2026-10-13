import { ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { loginIdentifiers, authIdentities, authSessions, passwordResetTokens, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { IdentityResolverService } from './identity-resolver.service';
import { authTransaction } from './auth-transaction';
import { normalizeIdentifier, maskIdentifier } from './login-identifier';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import type { AuthenticatedUser, UserRole } from '../common/auth-context';
import type { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto';
import { PasswordResetDeliveryService } from './password-reset-delivery.service';

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
  userId: string;
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
    private readonly resetDelivery: PasswordResetDeliveryService,
    private readonly identities: IdentityResolverService,
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

  loginMethods() {
    return { passwordLogin: true, passwordRegistration: this.registrationAllowed() };
  }

  async register(input: RegisterDto) {
    if (!this.registrationAllowed()) throw new ForbiddenException('Public registration is disabled');
    const passwordHash = await hash(input.password, 12);
    const created = await this.identities.registerPassword(input, passwordHash);
    return this.issueTokens(created.userId, { authMethod: 'PASSWORD', authenticatedAt: new Date().toISOString() }, { id: created.identityId, email: created.email, passwordHash });
  }

  async loginVerified(kind: 'phone' | 'email', identifier: string, context: RequestContext) {
    const resolved = await this.identities.verifiedLogin(kind, identifier);
    return { ...await this.issueTokens(resolved.userId, {
      ip: context.ip, userAgent: context.userAgent, authMethod: kind === 'phone' ? 'PHONE_OTP' : 'EMAIL_OTP',
      authenticatedAt: new Date().toISOString(),
    }), firstLogin: resolved.firstLogin };
  }

  async login(input: LoginDto, context: RequestContext): Promise<TokenPair> {
    const email = normalizeIdentifier('email', input.email);
    const ip = context.ip ?? 'unknown';
    const accountLimit = await this.rateLimiter.consume(`login:acct:${email}`, 10, 300);
    const ipLimit = await this.rateLimiter.consume(`login:ip:${ip}`, 20, 300);
    if (!accountLimit.allowed || !ipLimit.allowed) {
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'LOGIN_RATE_LIMITED', resourceType: 'auth', resourceId: ip, userId: null, source: 'api', result: 'blocked', reasonCode: 'LOGIN_RATE_LIMITED', changeSummary: 'Login rate limit exceeded' });
      throw new HttpException('Too many login attempts, please try again later', 429);
    }

    const identity = await this.identities.passwordIdentity(email);
    const user = identity ? (await this.db.select().from(users).where(eq(users.id, identity.userId)).limit(1))[0] : undefined;
    const row = identity && user ? { ...identity, status: user.status } : undefined;
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
    return this.issueTokens(row.userId, { ip, userAgent: context.userAgent ?? null, authMethod: 'PASSWORD', authenticatedAt: new Date().toISOString() }, { id: row.id, passwordHash: row.passwordHash, email });
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
    if (!rotated) {
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'REFRESH_ROTATION_CONFLICT', resourceType: 'auth_session', resourceId: session.id, userId: session.userId, source: 'api', result: 'blocked', reasonCode: 'REFRESH_ALREADY_ROTATED', changeSummary: 'Concurrent refresh rotation lost the atomic session claim' });
      throw new UnauthorizedException('Refresh token already rotated');
    }
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
    const observed = (await this.db.select().from(authIdentities).where(eq(authIdentities.userId, userId)).limit(1))[0];
    if (!observed || !(await compare(input.oldPassword, observed.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await hash(input.newPassword, 12);
    await authTransaction(this.db, async tx => {
      const user = (await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update'))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('账号暂不可用');
      const current = (await tx.select().from(authIdentities).where(eq(authIdentities.id, observed.id)).limit(1).for('update'))[0];
      if (current?.passwordHash !== observed.passwordHash) throw new UnauthorizedException('Current password is incorrect');
      const now = new Date();
      await tx.update(authIdentities).set({ passwordHash, updatedAt: now }).where(eq(authIdentities.userId, userId));
      await tx.update(authSessions).set({ revokedAt: now, revokeReason: 'password_changed' }).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
      await tx.update(passwordResetTokens).set({ usedAt: now }).where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'PASSWORD_CHANGED', resourceType: 'auth', resourceId: userId, userId, source: 'api', result: 'success', changeSummary: 'Password changed; all sessions revoked' }, tx);
    });
    return { changed: true };
  }

  async securityMethods(userId: string) {
    const verified = await this.db.select().from(loginIdentifiers).where(eq(loginIdentifiers.userId, userId));
    const legacy = await this.db.select().from(authIdentities).where(eq(authIdentities.userId, userId));
    const identifiers = verified.filter(item => item.kind === 'phone' || item.kind === 'email').map(item => ({
      kind: item.kind, masked: maskIdentifier(item.kind as 'phone' | 'email', item.identifier), verified: true,
    }));
    for (const item of legacy) if (!verified.some(v => v.kind === 'email' && v.identifier === item.email)) {
      identifiers.push({ kind: 'email', masked: maskIdentifier('email', item.email), verified: Boolean(item.emailVerifiedAt) });
    }
    return { identifiers, passwordConfigured: legacy.length > 0,
      canSetPassword: legacy.length === 0 && verified.some(item => item.kind === 'email'),
      canVerifyEmail: legacy.some(item => !item.emailVerifiedAt), passkeysAvailable: false };
  }

  async assertEmailVerification(userId: string, email: string, password: string) {
    if (!(await this.rateLimiter.consume(`email-proof:${userId}`, 10, 300)).allowed) throw new HttpException('尝试次数过多，请稍后再试', 429);
    const canonical = normalizeIdentifier('email', email);
    const identity = await this.identities.passwordIdentity(canonical);
    const allowed = identity?.userId === userId && await compare(password, identity.passwordHash);
    if (!allowed) throw new UnauthorizedException('当前账号验证失败');
    return identity!;
  }

  async verifyLegacyEmail(userId: string, email: string, expectedPasswordHash: string) {
    return this.identities.verifyLegacyEmail(userId, email, expectedPasswordHash);
  }

  async assertInitialPassword(userId: string, email: string) {
    const canonical = normalizeIdentifier('email', email);
    const mapping = (await this.db.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.userId, userId), eq(loginIdentifiers.kind, 'email'), eq(loginIdentifiers.identifier, canonical))).limit(1))[0];
    const existing = (await this.db.select().from(authIdentities).where(eq(authIdentities.userId, userId)).limit(1))[0];
    if (!mapping || existing) throw new ForbiddenException('请验证当前账号的邮箱，已有密码请使用修改密码入口。');
  }

  async setInitialPassword(userId: string, email: string, password: string) {
    await this.assertInitialPassword(userId, email);
    const passwordHash = await hash(password, 12);
    return this.identities.setInitialPassword(userId, email, passwordHash);
  }

  async forgotPassword(email: string, context: RequestContext = {}) {
    const normalized = normalizeIdentifier('email', email);
    const ip = context.ip ?? 'unknown';
    const [accountLimit, ipLimit] = await Promise.all([
      this.rateLimiter.consume(`password-reset:acct:${normalized}`, 3, 900),
      this.rateLimiter.consume(`password-reset:ip:${ip}`, 10, 900),
    ]);
    // Keep the response uniform for unknown addresses and rate-limited requests.
    if (!accountLimit.allowed || !ipLimit.allowed) {
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'PASSWORD_RESET_RATE_LIMITED', resourceType: 'auth', resourceId: ip, userId: null, source: 'api', result: 'blocked', reasonCode: 'PASSWORD_RESET_RATE_LIMITED', changeSummary: 'Password reset request rate limit exceeded' });
      return { requested: true };
    }

    const identity = await this.identities.passwordIdentity(normalized);
    // An unverified legacy email is not a trusted recovery channel.
    if (!identity?.emailVerifiedAt) return { requested: true };

    const raw = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.resetTtlSeconds * 1000);
    const delivery = await this.resetDelivery.deliver({ email: normalized, token: raw, expiresAt });
    if (delivery !== 'delivered') {
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'PASSWORD_RESET_DELIVERY_UNAVAILABLE', resourceType: 'auth', resourceId: normalized, userId: identity.userId, source: 'api', result: delivery === 'unavailable' ? 'blocked' : 'failure', reasonCode: delivery === 'unavailable' ? 'PASSWORD_RESET_DELIVERY_UNAVAILABLE' : 'PASSWORD_RESET_DELIVERY_FAILED', changeSummary: 'Password reset request was not issued because secure delivery was unavailable' });
      return { requested: true };
    }

    await authTransaction(this.db, async tx => {
      const user = (await tx.select().from(users).where(eq(users.id, identity.userId)).limit(1).for('update'))[0];
      const current = (await tx.select().from(authIdentities).where(eq(authIdentities.id, identity.id)).limit(1).for('update'))[0];
      const known = (await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind, 'email'), eq(loginIdentifiers.identifier, normalized))).limit(1).for('update'))[0];
      // A password change during delivery invalidates the pending recovery link.
      if (user?.status !== 'active' || !current?.emailVerifiedAt || current.passwordHash !== identity.passwordHash || (known && known.userId !== identity.userId)) return;
      await tx.insert(passwordResetTokens).values({ id: newId(), userId: identity.userId, tokenHash: hashToken(raw), expiresAt, usedAt: null, createdAt: now });
      await this.audit.append({ actorType: 'system', actorUserId: null, action: 'PASSWORD_RESET_REQUESTED', resourceType: 'auth', resourceId: normalized, userId: identity.userId, source: 'api', result: 'success', changeSummary: 'Password reset token delivered through the configured secure channel' }, tx);
    });
    return { requested: true };
  }

  async resetPassword(input: ResetPasswordDto) {
    const tokenHash = hashToken(input.token);
    const tokenRow = (await this.db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1))[0];
    if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date()) throw new UnauthorizedException('Invalid or expired reset token');
    const passwordHash = await hash(input.newPassword, 12);
    await authTransaction(this.db, async tx => {
      const user = (await tx.select().from(users).where(eq(users.id, tokenRow.userId)).limit(1).for('update'))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('Invalid or expired reset token');
      const credential = (await tx.select().from(authIdentities).where(eq(authIdentities.userId, tokenRow.userId)).limit(1).for('update'))[0];
      if (!credential?.emailVerifiedAt) throw new UnauthorizedException('Invalid or expired reset token');
      const mapping = (await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind, 'email'), eq(loginIdentifiers.identifier, credential.email))).limit(1).for('update'))[0];
      if (mapping && mapping.userId !== tokenRow.userId) throw new UnauthorizedException('Invalid or expired reset token');
      const now = new Date();
      const [claim] = await tx.update(passwordResetTokens).set({ usedAt: now })
        .where(and(eq(passwordResetTokens.id, tokenRow.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, sql`UTC_TIMESTAMP(6)`)));
      if (claim.affectedRows !== 1) throw new UnauthorizedException('Invalid or expired reset token');
      const [changed] = await tx.update(authIdentities).set({ passwordHash, updatedAt: now }).where(eq(authIdentities.userId, tokenRow.userId));
      if (changed.affectedRows < 1) throw new UnauthorizedException('Invalid or expired reset token');
      await tx.update(authSessions).set({ revokedAt: now, revokeReason: 'password_reset' }).where(and(eq(authSessions.userId, tokenRow.userId), isNull(authSessions.revokedAt)));
      await tx.update(passwordResetTokens).set({ usedAt: now }).where(and(eq(passwordResetTokens.userId, tokenRow.userId), isNull(passwordResetTokens.usedAt)));
      await this.audit.append({ actorType: 'user', actorUserId: tokenRow.userId, action: 'PASSWORD_RESET_COMPLETED', resourceType: 'auth', resourceId: tokenRow.userId, userId: tokenRow.userId, source: 'api', result: 'success', changeSummary: 'Password reset completed; all sessions revoked' }, tx);
    });
    return { reset: true };
  }

  private async issueTokens(userId: string, clientMeta: Record<string, unknown> | null, proof?: { id: string; passwordHash: string; email: string }): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('hex');
    const sessionId = newId();
    const now = new Date();
    await authTransaction(this.db, async tx => {
      const user = (await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update'))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('账号暂不可用');
      if (proof) {
        const identity = (await tx.select().from(authIdentities).where(eq(authIdentities.id, proof.id)).limit(1).for('update'))[0];
        const known = (await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind, 'email'), eq(loginIdentifiers.identifier, proof.email))).limit(1).for('update'))[0];
        if (identity?.userId !== userId || identity.passwordHash !== proof.passwordHash || (known && known.userId !== userId)) throw new UnauthorizedException(LOGIN_UNIFORM_ERROR);
      }
      await tx.insert(authSessions).values({
        id: sessionId, userId, refreshTokenHash: hashToken(refreshToken), familyId: newId(),
        clientMetadataJson: clientMeta ?? null, createdAt: now, expiresAt: new Date(now.getTime() + this.refreshTtlSeconds * 1000),
        lastUsedAt: null, revokedAt: null, revokeReason: null,
      });
    });
    return this.issueAccessAndRefresh(sessionId, refreshToken, userId);
  }

  private async issueAccessAndRefresh(sessionId: string, refreshToken: string, userId: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: this.accessTtlSeconds });
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: this.accessTtlSeconds, userId };
  }

  private async rotateSession(session: typeof authSessions.$inferSelect, now: Date, context: RequestContext): Promise<{ sessionId: string; refreshToken: string } | null> {
    const refreshToken = randomBytes(32).toString('hex');
    const sessionId = newId();
    const rotated = await authTransaction(this.db, async (tx) => {
      const user = (await tx.select().from(users).where(eq(users.id, session.userId)).limit(1).for('update'))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('账号暂不可用');
      const [claim] = await tx.update(authSessions)
        .set({ revokedAt: now, revokeReason: 'rotated', lastUsedAt: now })
        .where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)));
      if (claim.affectedRows !== 1) return false;
      await tx.insert(authSessions).values({
        id: sessionId, userId: session.userId, refreshTokenHash: hashToken(refreshToken), familyId: session.familyId,
        clientMetadataJson: { ...(session.clientMetadataJson ?? {}), ...(context.ip ? { ip: context.ip } : {}), ...(context.userAgent ? { userAgent: context.userAgent } : {}) },
        createdAt: now, expiresAt: session.expiresAt, lastUsedAt: null, revokedAt: null, revokeReason: null,
      });
      return true;
    });
    return rotated ? { sessionId, refreshToken } : null;
  }

  private async revokeFamily(familyId: string, reason: string) {
    const now = new Date();
    await this.db.update(authSessions).set({ revokedAt: now, revokeReason: reason }).where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)));
  }
}
