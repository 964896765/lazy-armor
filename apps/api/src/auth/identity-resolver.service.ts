import { ConflictException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { authIdentities, loginIdentifiers, profiles, userMemberships, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { authTransaction, type AuthTransaction } from './auth-transaction';
import { normalizeIdentifier, type IdentifierKind } from './login-identifier';
import type { RegisterDto } from './dto';
import { PasswordCredentialService } from './password-credential.service';

function conflict() { return new ConflictException({ code: 'IDENTITY_CONFLICT', message: '该标识的历史账号记录需要核对，请联系支持处理。' }); }

@Injectable()
export class IdentityResolverService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService, private readonly passwords: PasswordCredentialService) {}

  // Consistent unique-index locking, including missing-key gaps at explicit RR,
  // serializes legacy password creation with verified identifier creation.
  private async mappings(tx: AuthTransaction, kind: IdentifierKind, identifier: string) {
    const known = (await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind, kind), eq(loginIdentifiers.identifier, identifier))).limit(1).for('update'))[0];
    const legacy = kind === 'email' ? (await tx.select().from(authIdentities).where(eq(authIdentities.email, identifier)).limit(1).for('update'))[0] : undefined;
    if (known && legacy && known.userId !== legacy.userId) throw conflict();
    return { known, legacy };
  }

  async passwordIdentity(email: string) {
    const legacy = (await this.db.select().from(authIdentities).where(eq(authIdentities.email, email)).limit(1))[0];
    const known = (await this.db.select({ userId: loginIdentifiers.userId }).from(loginIdentifiers).where(and(eq(loginIdentifiers.kind, 'email'), eq(loginIdentifiers.identifier, email))).limit(1))[0];
    return legacy && (!known || known.userId === legacy.userId) ? legacy : undefined;
  }

  async passwordOwner(kind:IdentifierKind,value:string,reader:Pick<InjectedDatabase,'select'>=this.db,lock=false) {
    const identifier=normalizeIdentifier(kind,value);
    const query=reader.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind,kind),eq(loginIdentifiers.identifier,identifier))).limit(1);
    const known=(await (lock?query.for('update'):query))[0];
    const legacyQuery=reader.select().from(authIdentities).where(eq(authIdentities.email,identifier)).limit(1);
    const legacy=kind==='email'?(await (lock?legacyQuery.for('update'):legacyQuery))[0]:undefined;
    if(known&&legacy&&known.userId!==legacy.userId) return undefined;
    const userId=known?.userId??legacy?.userId;
    return userId?{userId,legacy,known}:undefined;
  }

  private async createUser(tx: AuthTransaction, displayName: string, now: Date) {
    const id = newId();
    await tx.insert(users).values({ id, status: 'active', role: 'user', createdAt: now, updatedAt: now });
    await tx.insert(profiles).values({ id: newId(), userId: id, displayName, timezone: 'Asia/Shanghai', locale: 'zh-CN', createdAt: now, updatedAt: now });
    await tx.insert(userMemberships).values({ id: newId(), userId: id, membershipPlanKey: 'free', status: 'active', startedAt: now, currentPeriodStart: now, cancelAtPeriodEnd: 0, provider: 'internal', createdAt: now, updatedAt: now });
    return id;
  }

  async registerPassword(input: RegisterDto, passwordHash: string) {
    const email = normalizeIdentifier('email', input.email);
    return authTransaction(this.db, async tx => {
      const { known, legacy } = await this.mappings(tx, 'email', email);
      if (known || legacy) throw new HttpException('Invalid email or password', 409);
      const now = new Date(), userId = await this.createUser(tx, input.displayName, now);
      // A password registration alone proves no control of the email inbox.
      const identityId = newId();
      await tx.insert(authIdentities).values({ id: identityId, userId, email, passwordHash, emailVerifiedAt: null, createdAt: now, updatedAt: now });
      const proof=await this.passwords.seed(tx,userId,identityId,passwordHash,now);
      return { userId, identityId, email, proof };
    });
  }

  async verifiedLogin(kind: IdentifierKind, value: string) {
    const identifier = normalizeIdentifier(kind, value);
    return authTransaction(this.db, async tx => {
      const { known, legacy } = await this.mappings(tx, kind, identifier);
      if (legacy && !legacy.emailVerifiedAt && !known) {
        throw new ConflictException({ code: 'EMAIL_PROOF_REQUIRED', message: '请先用原密码进入账号，再验证邮箱；忘记密码可通过安全恢复流程处理。' });
      }
      const now = new Date(), firstLogin = !known && !legacy;
      const userId = known?.userId ?? legacy?.userId ?? await this.createUser(tx, kind === 'phone' ? '手机用户' : '邮箱用户', now);
      const user = (await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('账号暂不可用');
      if (!known) await tx.insert(loginIdentifiers).values({ id: newId(), userId, kind, identifier, verifiedAt: now, createdAt: now, updatedAt: now });
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'LOGIN_CODE_VERIFIED', resourceType: 'auth', resourceId: userId, source: 'api', result: 'success', changeSummary: 'Verified passwordless login' }, tx);
      return { userId, firstLogin };
    });
  }

  async verifyLegacyEmail(userId: string, value: string, expectedPasswordHash: string) {
    const email = normalizeIdentifier('email', value);
    return authTransaction(this.db, async tx => {
      const { known, legacy } = await this.mappings(tx, 'email', email);
      if (!legacy || legacy.userId !== userId || legacy.passwordHash !== expectedPasswordHash) throw new UnauthorizedException('当前账号验证失败');
      const user = (await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update'))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('账号暂不可用');
      const now = new Date();
      const proof=await this.passwords.observe(userId,tx,true);
      if(proof?.passwordHash!==expectedPasswordHash)throw new UnauthorizedException('当前密码证明已失效');
      await this.passwords.assertCurrent(tx,proof);
      if (!known) await tx.insert(loginIdentifiers).values({ id: newId(), userId, kind: 'email', identifier: email, verifiedAt: now, createdAt: now, updatedAt: now });
      await tx.update(authIdentities).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(authIdentities.id, legacy.id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'LOGIN_IDENTIFIER_VERIFIED', resourceType: 'auth', resourceId: userId, source: 'api', result: 'success', changeSummary: 'Existing account email verified with inbox and password proofs' }, tx);
      return { verified: true };
    });
  }

  async setInitialPassword(userId: string, value: string, passwordHash: string) {
    const email = normalizeIdentifier('email', value);
    return authTransaction(this.db, async tx => {
      const { known, legacy } = await this.mappings(tx, 'email', email);
      if (known?.userId !== userId || legacy) throw new ConflictException('请验证当前账号邮箱，并使用修改密码入口管理已有密码。');
      const user = (await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update'))[0];
      if (user?.status !== 'active') throw new UnauthorizedException('账号暂不可用');
      const existing = await this.passwords.observe(userId,tx,true);
      if (existing) throw new ConflictException('已经设置密码，请使用修改密码入口。');
      const now = new Date();
      const identityId=newId();
      await tx.insert(authIdentities).values({ id: identityId, userId, email, passwordHash, emailVerifiedAt: known.verifiedAt, createdAt: now, updatedAt: now });
      await this.passwords.seed(tx,userId,identityId,passwordHash,now);
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'PASSWORD_SET', resourceType: 'auth', resourceId: userId, source: 'api', result: 'success', changeSummary: 'Optional password added to the existing verified account' }, tx);
      return { configured: true };
    });
  }
}
