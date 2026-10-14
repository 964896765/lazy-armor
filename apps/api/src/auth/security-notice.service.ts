import { HttpException, Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authSecurityNotices, loginIdentifiers } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { workerEnabled } from '../common/app-role';
import type { AuthTransaction } from './auth-transaction';
import { maskIdentifier } from './login-identifier';
import { SmsCodeDeliveryService, type SmsReservation } from './sms-code-delivery.service';

type Notice = typeof authSecurityNotices.$inferSelect;
type Payload = { recipient: string; oldMasked: string; newMasked: string };

@Injectable()
export class SecurityNoticeService implements OnModuleInit, OnApplicationShutdown {
  private ready = false;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService, private readonly sms: SmsCodeDeliveryService) {}
  private gateway() {
    if (this.config.get<string>('AUTH_SECURITY_NOTICE_SEND_ENABLED') !== 'true') return null;
    try {
      const endpoint = this.config.get<string>('AUTH_SECURITY_NOTICE_ENDPOINT') ?? '';
      const url = new URL(endpoint), token = this.config.get<string>('AUTH_SECURITY_NOTICE_TOKEN');
      const phoneTemplate = this.config.get<string>('AUTH_SECURITY_NOTICE_PHONE_TEMPLATE') ?? '';
      const emailTemplate = this.config.get<string>('AUTH_SECURITY_NOTICE_EMAIL_TEMPLATE') ?? '';
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || !token || token.length < 32 ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(phoneTemplate) || !/^[A-Za-z0-9_-]{1,100}$/.test(emailTemplate)) return null;
      this.encryptionKey();
      return { endpoint, token, phoneTemplate, emailTemplate };
    } catch { return null; }
  }
  private encryptionKey() {
    const key = Buffer.from(this.config.getOrThrow<string>('CREDENTIAL_MASTER_KEY'), 'base64');
    if (key.length !== 32) throw new Error('Security notice encryption requires a 32-byte master key');
    return key;
  }
  private aad(row: Pick<Notice,'id'|'userId'|'eventId'|'channel'>) { return Buffer.from(JSON.stringify(['phone-changed-v1',row.id,row.userId,row.eventId,row.channel])); }
  private seal(row: Pick<Notice,'id'|'userId'|'eventId'|'channel'>, payload: Payload) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm',this.encryptionKey(),nonce);
    cipher.setAAD(this.aad(row));
    const body = Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString('base64');
  }
  private open(row: Notice): Payload {
    const bytes = Buffer.from(row.recipientCipher,'base64'), decipher = createDecipheriv('aes-256-gcm',this.encryptionKey(),bytes.subarray(0,12));
    decipher.setAAD(this.aad(row)); decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as Payload;
  }
  async onModuleInit() {
    try { await this.db.select({id:authSecurityNotices.id}).from(authSecurityNotices).limit(1); }
    catch { throw new Error('Authentication requires the 0095 durable security notice table before deployment'); }
    this.ready = true;
    if (this.config.get<string>('AUTH_SECURITY_NOTICE_SEND_ENABLED') !== 'true') return;
    if (!this.gateway()) throw new Error('Enabled security notices require approved gateway and encryption configuration');
    if (workerEnabled('outbox-worker')) this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick().catch(() => undefined).finally(() => { this.running = undefined; });
    },5000);
  }
  available() { return this.ready && Boolean(this.gateway()) && this.sms.available(); }
  async enqueue(tx: AuthTransaction, userId: string, oldPhone: string, newPhone: string, now: Date) {
    if (!this.available()) throw new HttpException('安全通知服务暂不可用，请稍后重新开始换号。',503);
    const emails = await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.userId,userId),eq(loginIdentifiers.kind,'email'),isNull(loginIdentifiers.disabledAt)));
    const eventId = newId(), oldMasked = maskIdentifier('phone',oldPhone), newMasked = maskIdentifier('phone',newPhone);
    for (const recipient of [{kind:'phone',identifier:oldPhone},...emails]) {
      const row = {id:newId(),userId,eventId,channel:recipient.kind};
      await tx.insert(authSecurityNotices).values({...row,recipientCipher:this.seal(row,{recipient:recipient.identifier,oldMasked,newMasked}),masked:maskIdentifier(recipient.kind as 'phone'|'email',recipient.identifier),state:'PENDING',attempts:0,nextAttemptAt:now,createdAt:now,updatedAt:now});
    }
  }
  async list(userId: string) {
    if (!this.ready) return [];
    return this.db.select({channel:authSecurityNotices.channel,masked:authSecurityNotices.masked,state:authSecurityNotices.state,createdAt:authSecurityNotices.createdAt}).from(authSecurityNotices).where(eq(authSecurityNotices.userId,userId)).orderBy(desc(authSecurityNotices.createdAt)).limit(10);
  }
  async tick() {
    if (!this.available()) return;
    // A process may die after the POST. Expired claims are unknown, never resent.
    await this.db.update(authSecurityNotices).set({state:'UNKNOWN',updatedAt:new Date()}).where(and(eq(authSecurityNotices.state,'CLAIMED'),sql`${authSecurityNotices.claimedAt} < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 60 SECOND)`));
    const pending = await this.db.select().from(authSecurityNotices).where(and(eq(authSecurityNotices.state,'PENDING'),sql`${authSecurityNotices.nextAttemptAt} <= UTC_TIMESTAMP(6)`)).orderBy(authSecurityNotices.nextAttemptAt).limit(8);
    for (const row of pending) {
      const now = new Date();
      const [claim] = await this.db.update(authSecurityNotices).set({state:'CLAIMED',attempts:row.attempts+1,claimedAt:now,updatedAt:now}).where(and(eq(authSecurityNotices.id,row.id),eq(authSecurityNotices.state,'PENDING'),eq(authSecurityNotices.attempts,row.attempts)));
      if (claim.affectedRows !== 1) continue;
      await this.deliver({...row,attempts:row.attempts+1});
    }
  }
  private async state(row: Notice, state: string, nextAttemptAt?: Date, providerId?: string) {
    const providerKey = providerId ? createHmac('sha256',this.encryptionKey()).update('security-notice-provider:'+providerId).digest('hex') : undefined;
    await this.db.update(authSecurityNotices).set({state,nextAttemptAt,providerKey,updatedAt:new Date()}).where(and(eq(authSecurityNotices.id,row.id),eq(authSecurityNotices.state,'CLAIMED')));
  }
  private async deliver(row: Notice) {
    let payload: Payload;
    try { payload = this.open(row); } catch { await this.state(row,'BLOCKED'); return; }
    let reservation: SmsReservation | undefined;
    const gateway = this.gateway();
    if (!gateway) { await this.state(row,'BLOCKED'); return; }
    try {
      if (row.channel === 'phone') reservation = await this.sms.reserve(payload.recipient,'security-notice-worker','security-phone-changed');
    } catch (error) {
      // No outbound work occurred: bounded retries retain the frozen recipient.
      const response = error instanceof HttpException ? error.getResponse() : undefined;
      const retry = typeof response === 'object' && response && 'retryAfterMs' in response ? Number(response.retryAfterMs) : 60000;
      await this.state(row,row.attempts >= 5 ? 'BLOCKED' : 'PENDING',new Date(Date.now()+Math.min(86400000,Math.max(60000,retry||60000)))); return;
    }
    if (!this.available()) {
      if (reservation) await this.sms.mark(reservation.id,'CANCELLED');
      await this.state(row,row.attempts >= 5 ? 'BLOCKED' : 'PENDING',new Date(Date.now()+60000)); return;
    }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    try {
      const ack = await Promise.race([(async () => {
        const response = await fetch(gateway.endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+gateway.token,'content-type':'application/json','idempotency-key':row.id},signal:controller.signal,body:JSON.stringify({type:'security_notice',contractVersion:1,purpose:'phone-changed',requestId:row.id,eventId:row.eventId,channel:row.channel,recipient:payload.recipient,templateId:row.channel === 'phone' ? gateway.phoneTemplate : gateway.emailTemplate,params:{oldPhone:payload.oldMasked,newPhone:payload.newMasked},...(reservation?{smsBudgetRequestId:reservation.id,budgetDay:reservation.bucket,maxCostFen:reservation.reservedFen}:{})})});
        if (!response.ok) throw new Error('Gateway unavailable');
        const value = await response.json() as Record<string,unknown>;
        if (value.accepted !== true || value.requestId !== row.id || typeof value.providerRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.providerRequestId) || (reservation && (!Number.isSafeInteger(value.costFen) || Number(value.costFen)<0 || Number(value.costFen)>reservation.reservedFen))) throw new Error('Invalid acknowledgement');
        return {providerId:value.providerRequestId,costFen:Number(value.costFen)};
      })(),new Promise<never>((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(new Error('Gateway timeout')); },4000); })]);
      if (reservation) await this.sms.mark(reservation.id,'ACCEPTED',ack.costFen,ack.providerId);
      await this.state(row,'ACCEPTED',undefined,ack.providerId);
    } catch {
      if (reservation) await this.sms.mark(reservation.id,'UNKNOWN').catch(() => undefined);
      await this.state(row,'UNKNOWN');
    } finally { clearTimeout(timer!); controller.abort(); }
  }
  async onApplicationShutdown() { if (this.timer) clearInterval(this.timer); await this.running; }
}
