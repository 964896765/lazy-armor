import { ConflictException, HttpException, Inject, Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authIdentities, authSessions, loginIdentifiers, passwordResetTokens, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { PasswordCredentialService, type PasswordProof } from './password-credential.service';
import { PasswordResetDeliveryService } from './password-reset-delivery.service';
import { authTransaction, type AuthTransaction } from './auth-transaction';
import { normalizeIdentifier } from './login-identifier';
import { decodeRecoveryToken, encodeRecoveryToken, recoveryTokenHash, type RecoveryContext } from './password-recovery-token';
import type { ResetPasswordDto } from './dto';

type Reader = Pick<InjectedDatabase,'select'>;
interface RecoverySource { userId:string; email:string; source:RecoveryContext['source'] }
const invalid = () => new UnauthorizedException({code:'PASSWORD_RECOVERY_EXPIRED',message:'恢复链接无效或已过期，请重新申请。'});

@Injectable()
export class PasswordRecoveryService implements OnModuleInit {
  constructor(@Inject(DATABASE) private readonly db:InjectedDatabase, private readonly config:ConfigService,
    private readonly passwords:PasswordCredentialService, private readonly delivery:PasswordResetDeliveryService,
    private readonly limiter:RateLimiterService, private readonly audit:AuditService) {}
  bound() { return this.config.get<string>('AUTH_PASSWORD_RECOVERY_MODE') === 'BOUND'; }
  requestsEnabled() { return this.config.get<string>('AUTH_PASSWORD_RECOVERY_REQUEST_ENABLED') !== 'false'; }
  onModuleInit() { if(this.bound()&&!this.passwords.unified()) throw new Error('Bound password recovery requires UNIFIED password credentials'); }
  capabilities() { return {available:this.requestsEnabled()&&this.delivery.available(),emailAliases:this.bound()}; }
  private secret() { return this.config.getOrThrow<string>('JWT_SECRET'); }
  private tokenHash(raw:string) { return recoveryTokenHash(this.secret(),raw); }
  private digest(purpose:string,value:unknown) { return createHmac('sha256',this.secret()).update('password-recovery:'+purpose+':'+JSON.stringify(value)).digest('hex'); }
  private passwordEpoch(proof:PasswordProof) { return this.digest('password',[proof.userId,proof.credentialId,proof.version,proof.sourceLegacyIdentityId,proof.passwordHash]); }
  private async guarded<T>(work:()=>Promise<T>):Promise<T> {
    try { return await work(); }
    catch(error) { if(error instanceof HttpException) throw error; throw new HttpException('密码恢复服务暂不可用，请稍后重试。',503); }
  }
  private async source(email:string,reader:Reader=this.db,lock=false):Promise<RecoverySource|undefined> {
    const knownQuery = reader.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind,'email'),eq(loginIdentifiers.identifier,email))).limit(1);
    const known = (await (lock?knownQuery.for('update'):knownQuery))[0];
    const legacyQuery = reader.select().from(authIdentities).where(eq(authIdentities.email,email)).limit(1);
    const legacy = (await (lock?legacyQuery.for('update'):legacyQuery))[0];
    if(known&&legacy&&known.userId!==legacy.userId) return undefined;
    if(known?.verifiedAt) return {userId:known.userId,email,source:{kind:'identifier',id:known.id,epoch:this.digest('identifier',[known.id,known.userId,known.kind,known.identifier,known.verifiedAt])}};
    if(legacy?.emailVerifiedAt) return {userId:legacy.userId,email,source:{kind:'legacy',id:legacy.id,epoch:this.digest('legacy',[legacy.id,legacy.userId,legacy.email,legacy.emailVerifiedAt])}};
    return undefined;
  }
  private async sourceForContext(context:RecoveryContext,tx:AuthTransaction) {
    // IDs only select a frozen source; current address and ownership still come
    // from SQL. A replacement identifier can never inherit an old recovery link.
    const row = context.source.kind==='identifier'
      ? (await tx.select({email:loginIdentifiers.identifier}).from(loginIdentifiers).where(eq(loginIdentifiers.id,context.source.id)).limit(1))[0]
      : (await tx.select({email:authIdentities.email}).from(authIdentities).where(eq(authIdentities.id,context.source.id)).limit(1))[0];
    if(!row) throw invalid();
    const source = await this.source(row.email,tx,true);
    if(!source||source.userId!==context.userId||source.source.kind!==context.source.kind||source.source.id!==context.source.id||source.source.epoch!==context.source.epoch) throw invalid();
    return source;
  }
  private async current(context:RecoveryContext,tx:AuthTransaction) {
    if(context.expiresAt<=Date.now()) throw invalid();
    await this.sourceForContext(context,tx);
    const user = (await tx.select({status:users.status}).from(users).where(eq(users.id,context.userId)).limit(1).for('update'))[0];
    if(user?.status!=='active') throw invalid();
    const proof = await this.passwords.observe(context.userId,tx,true);
    if(!proof||this.passwordEpoch(proof)!==context.passwordEpoch) throw invalid();
    return proof;
  }
  async recoverableEmails(userId:string) {
    if(!this.requestsEnabled()||!this.delivery.available()) return new Set<string>();
    const legacy = await this.db.select().from(authIdentities).where(eq(authIdentities.userId,userId));
    const known = this.bound()?await this.db.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.userId,userId),eq(loginIdentifiers.kind,'email'))):[];
    const result = new Set<string>();
    for(const email of new Set([...legacy.filter(row=>row.emailVerifiedAt).map(row=>row.email),...known.filter(row=>row.verifiedAt).map(row=>row.identifier)])) {
      const source = await this.source(email);
      if(source?.userId===userId) result.add(email);
    }
    return result;
  }
  async request(email:string,ip:string) {
    return this.guarded(async()=>{
      if(!this.requestsEnabled()) return {requested:true};
      const normalized = normalizeIdentifier('email',email);
      const [accountLimit,ipLimit] = await Promise.all([this.limiter.consume('password-reset:acct:'+normalized,3,900),this.limiter.consume('password-reset:ip:'+ip,10,900)]);
      if(!accountLimit.allowed||!ipLimit.allowed) return {requested:true};
      const source = await this.source(normalized);
      if(!source) return {requested:true};
      const user = (await this.db.select({status:users.status}).from(users).where(eq(users.id,source.userId)).limit(1))[0];
      if(user?.status!=='active') return {requested:true};
      let proof:PasswordProof|undefined;
      try { proof = await this.passwords.observe(source.userId); } catch(error) { if(!(error instanceof ConflictException)) throw error; }
      if(!proof||!(await this.limiter.consume('password-reset:user:'+source.userId,3,900)).allowed) return {requested:true};
      const now = new Date(), expiresAt = new Date(now.getTime()+(this.config.get<number>('PASSWORD_RESET_TOKEN_TTL_SECONDS')??1800)*1000);
      const context = {userId:source.userId,source:source.source,passwordEpoch:this.passwordEpoch(proof),expiresAt:expiresAt.getTime()};
      const raw = encodeRecoveryToken(this.secret(),context), frozen = decodeRecoveryToken(this.secret(),raw);
      const status = await this.delivery.deliver({email:normalized,token:raw,expiresAt});
      if(status!=='delivered') {
        await this.audit.append({actorType:'system',userId:source.userId,action:'PASSWORD_RESET_DELIVERY_UNAVAILABLE',resourceType:'auth',resourceId:source.userId,source:'api',result:status==='unavailable'?'blocked':'failure',changeSummary:'No usable recovery link issued because secure delivery was unavailable'});
        return {requested:true};
      }
      try {
        await authTransaction(this.db,async tx=>{
          await this.current(frozen,tx);
          const issuedAt = new Date();
          // The original per-user lock serializes requests on different aliases.
          // A failed delivery/transaction never revokes previously usable links.
          await tx.update(passwordResetTokens).set({usedAt:issuedAt}).where(and(eq(passwordResetTokens.userId,source.userId),isNull(passwordResetTokens.usedAt)));
          await tx.insert(passwordResetTokens).values({id:newId(),userId:source.userId,tokenHash:this.tokenHash(raw),expiresAt,usedAt:null,createdAt:issuedAt});
          await this.audit.append({actorType:'system',userId:source.userId,action:'PASSWORD_RESET_REQUESTED',resourceType:'auth',resourceId:source.userId,source:'api',result:'success',changeSummary:'Issued a channel and credential-bound recovery link; superseded previous links'},tx);
        });
      } catch(error) { if(!(error instanceof UnauthorizedException)&&!(error instanceof ConflictException)) throw error; }
      return {requested:true};
    });
  }
  async reset(input:ResetPasswordDto,ip='unknown') {
    return this.guarded(async()=>{
      if(!(await this.limiter.consume('password-reset:redeem:ip:'+ip,30,300)).allowed) throw new HttpException('尝试次数过多，请稍后再试',429);
      let context:RecoveryContext;
      try { context=decodeRecoveryToken(this.secret(),input.token); } catch { throw invalid(); }
      if(context.expiresAt<=Date.now()) throw invalid();
      const row = (await this.db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash,this.tokenHash(input.token))).limit(1))[0];
      if(!row||row.userId!==context.userId||row.usedAt||row.expiresAt<=new Date()||row.expiresAt.getTime()!==context.expiresAt) throw invalid();
      // Bound work before bcrypt: concurrent holders of a valid bearer cannot
      // force unlimited expensive hashes while SQL is waiting for the first claim.
      if(!(await this.limiter.consume('password-reset:redeem:token:'+this.tokenHash(input.token),5,300)).allowed) throw new HttpException('尝试次数过多，请稍后再试',429);
      const passwordHash = await hash(input.newPassword,12);
      await authTransaction(this.db,async tx=>{
        let proof:PasswordProof;
        try { proof=await this.current(context,tx); } catch(error) { if(error instanceof ConflictException) throw invalid(); throw error; }
        const now = new Date();
        const [claim] = await tx.update(passwordResetTokens).set({usedAt:now}).where(and(eq(passwordResetTokens.id,row.id),eq(passwordResetTokens.userId,context.userId),eq(passwordResetTokens.tokenHash,this.tokenHash(input.token)),isNull(passwordResetTokens.usedAt),gt(passwordResetTokens.expiresAt,sql`UTC_TIMESTAMP(6)`),eq(passwordResetTokens.expiresAt,new Date(context.expiresAt))));
        if(claim.affectedRows!==1) throw invalid();
        await this.passwords.change(tx,proof,passwordHash,now);
        await tx.update(authSessions).set({revokedAt:now,revokeReason:'password_reset'}).where(and(eq(authSessions.userId,context.userId),isNull(authSessions.revokedAt)));
        await tx.update(passwordResetTokens).set({usedAt:now}).where(and(eq(passwordResetTokens.userId,context.userId),isNull(passwordResetTokens.usedAt)));
        await this.audit.append({actorType:'user',actorUserId:context.userId,userId:context.userId,action:'PASSWORD_RESET_COMPLETED',resourceType:'auth',resourceId:context.userId,source:'api',result:'success',changeSummary:'Reset the same account password with a channel and credential-bound link; revoked all sessions'},tx);
      });
      return {reset:true};
    });
  }
}
