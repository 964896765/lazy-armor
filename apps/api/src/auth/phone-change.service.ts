import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authSessions, loginIdentifiers, passwordResetTokens } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { AuthenticatedUser } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { LoginCodeService } from './login-code.service';
import { PasswordCredentialService } from './password-credential.service';
import { IdentifierBindingService, type BindingState } from './identifier-binding.service';
import { SecurityNoticeService } from './security-notice.service';
import { maskIdentifier } from './login-identifier';
import type { AuthTransaction } from './auth-transaction';
import type { StartPhoneChangeDto } from './dto';

@Injectable()
export class PhoneChangeService extends IdentifierBindingService {
  constructor(@Inject(DATABASE) db: InjectedDatabase, config: ConfigService, passwords: PasswordCredentialService, codes: LoginCodeService, limiter: RateLimiterService, audit: AuditService, private readonly notices: SecurityNoticeService) { super('phone',db,config,passwords,codes,limiter,audit,'change'); }
  protected override additionalReady() { return this.notices.available(); }
  async capabilities(user: AuthenticatedUser) {
    const capability = await this.bindingCapabilities(user);
    const phones = capability.available ? await this.db.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.userId,user.id),eq(loginIdentifiers.kind,'phone'),isNull(loginIdentifiers.disabledAt))) : [];
    return {phoneChange:{...capability,available:capability.available && phones.length>0,phones:phones.map(row => ({id:row.id,masked:maskIdentifier('phone',row.identifier)}))},securityNotices:await this.notices.list(user.id)};
  }
  start(user: AuthenticatedUser, input: StartPhoneChangeDto, ip: string) { return this.startBinding(user,{...input,identifier:input.phone},ip); }
  protected override async finalize(tx: AuthTransaction, user: AuthenticatedUser, state: BindingState) {
    const old = await this.source(user.id,state.replacing!.id,tx,true), now = new Date();
    // Keep unique ownership as a tombstone. Recycling requires a separate reviewed flow.
    await tx.update(loginIdentifiers).set({disabledAt:now,updatedAt:now}).where(eq(loginIdentifiers.id,old.id));
    await tx.insert(loginIdentifiers).values({id:newId(),userId:user.id,kind:'phone',identifier:this.target(state),verifiedAt:now,createdAt:now,updatedAt:now});
    await tx.update(authSessions).set({revokedAt:now,revokeReason:'phone_changed'}).where(and(eq(authSessions.userId,user.id),isNull(authSessions.revokedAt)));
    await tx.update(passwordResetTokens).set({usedAt:now}).where(and(eq(passwordResetTokens.userId,user.id),isNull(passwordResetTokens.usedAt)));
    await this.notices.enqueue(tx,user.id,old.identifier,this.target(state),now);
    await this.audit.append({actorType:'user',actorUserId:user.id,userId:user.id,action:'LOGIN_PHONE_CHANGED',resourceType:'auth',resourceId:user.id,source:'api',result:'success',changeSummary:'Phone changed with two proofs; old phone disabled, all sessions and recovery links revoked, security notices queued'},tx);
    return {changed:true,reauthenticate:true,notification:'QUEUED'};
  }
}
