import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connections, connectors, credentialRefs, users, webhookReceipts } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { AuditService } from '../../audit/audit.service';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../../credentials/credential-provider';
import { WeComService } from './wecom.service';
import { parseWeComEvent, verifyWeComChallenge, type WeComEventEnvelope } from './wecom-event';

// WeCom callback adapter: signature/challenge validation -> durable dedupe ->
// normalize -> RealityPipeline.ingest -> Candidate -> Truth. It never writes
// Truth directly and never triggers Plan execution.
@Injectable()
export class WeComWebhookService {
  private readonly token?: string;
  constructor(config: ConfigService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly wecom: WeComService, private readonly audit: AuditService) {
    const value = config.get<string>('WECOM_CALLBACK_TOKEN');
    this.token = value && value.length >= 8 && !/^(?:placeholder|change[-_]?me|example|test[-_]?secret)/i.test(value) ? value : undefined;
  }
  configured() { return Boolean(this.token && this.wecom.status().appConfigured); }
  challenge(input: { signature?: unknown; timestamp?: unknown; nonce?: unknown; echostr?: unknown }) {
    if (!this.configured()) throw new ForbiddenException('WeCom signed callback is not configured');
    return verifyWeComChallenge({ token: this.token, signature: input.signature, timestamp: input.timestamp, nonce: input.nonce, echostr: input.echostr });
  }
  async receive(connectionId: string, input: { rawBody?: Buffer; signature?: unknown; timestamp?: unknown; nonce?: unknown }) {
    if (!this.configured()) throw new ForbiddenException('WeCom signed event ingestion is not configured');
    let parsed;
    try { parsed = parseWeComEvent({ rawBody: input.rawBody, signature: input.signature, timestamp: input.timestamp, nonce: input.nonce, token: this.token }); }
    catch { throw new ForbiddenException('WeCom signed event rejected'); }
    return this.ingest(connectionId, parsed.event);
  }
  private async ingest(connectionId: string, event: WeComEventEnvelope) {
    const owned = (await this.db.select({ userId: connections.userId, ref: credentialRefs.ref, version: credentialRefs.currentVersion,
      status: connections.status, userStatus: users.status })
      .from(connections).innerJoin(connectors, eq(connectors.id, connections.connectorId))
      .innerJoin(credentialRefs, eq(credentialRefs.id, connections.credentialRefId))
      .innerJoin(users, eq(users.id, connections.userId))
      .where(and(eq(connections.id, connectionId), eq(connectors.key, 'wecom'))).limit(1))[0];
    if (!owned || owned.status !== 'connected' || owned.userStatus !== 'active') throw new ForbiddenException('WeCom event target is not authorized');
    let credential;
    try { credential = await this.credentials.get(owned.ref, owned.version); }
    catch { throw new ForbiddenException('WeCom event target is not authorized'); }
    if (credential.corpId && credential.corpId !== event.corpId) throw new ForbiddenException('WeCom event tenant mismatch');
    const idempotencyKey = `wecom-raw:v1:${event.payloadHash}`;
    const existing = async () => (await this.db.select().from(webhookReceipts).where(and(eq(webhookReceipts.connectionId, connectionId),
      or(eq(webhookReceipts.eventId, event.eventId), eq(webhookReceipts.idempotencyKey, idempotencyKey)))).limit(2));
    const response = (row: typeof webhookReceipts.$inferSelect, duplicate: boolean, truthConfirmed: boolean) => {
      if (row.payloadHash !== event.payloadHash) throw new ConflictException('WeCom event identity conflict');
      return { receiptId: row.id, duplicate, truthConfirmed };
    };
    const replay = (rows: Array<typeof webhookReceipts.$inferSelect>) => {
      const sameDelivery = rows.find((row) => row.eventId === event.eventId);
      if (sameDelivery && sameDelivery.payloadHash !== event.payloadHash) throw new ConflictException('WeCom event identity conflict');
      return response(sameDelivery ?? rows[0], true, false);
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const now = new Date();
        const prior = await this.db.select().from(webhookReceipts).where(and(eq(webhookReceipts.connectionId, connectionId),
          or(eq(webhookReceipts.eventId, event.eventId), eq(webhookReceipts.idempotencyKey, idempotencyKey)))).limit(2);
        if (prior.length) return replay(prior);
        const receiptId = newId();
        await this.db.insert(webhookReceipts).values({ id: receiptId, connectionId, eventId: event.eventId, requestId: `wecom-webhook:${newId()}`,
          idempotencyKey, payloadHash: event.payloadHash, payload: '{}', payloadSnapshotJson: event.resource, payloadSizeBytes: event.payloadSizeBytes,
          receivedAt: now, expiresAt: new Date(now.getTime() + 600_000), acquisitionProviderKey: 'wecom', acquisitionStatus: 'PENDING',
          acquisitionAttemptCount: 0, acquisitionNextAttemptAt: now, acquisitionResultJson: {} });
        await this.audit.append({ actorType: 'system', actorUserId: owned.userId, action: 'WECOM_EVENT_ACCEPTED', resourceType: 'webhook_receipt',
          resourceId: receiptId, userId: owned.userId, source: 'api', result: 'success', changeSummary: 'Signed WeCom event queued for Reality Pipeline ingestion' });
        const observation = await this.wecom.observeEvent(owned.userId, connectionId, event.resource);
        await this.db.update(webhookReceipts).set({ acquisitionStatus: 'READ_BACK_COMPLETE', acquisitionResultJson: { truthRecordIds: observation.truth.map((t) => t.id) } }).where(eq(webhookReceipts.id, receiptId));
        return { receiptId, duplicate: false, truthConfirmed: observation.truth.length > 0, observation };
      } catch (error) {
        if (databaseCode(error) === 'ER_DUP_ENTRY') { const rows = await existing(); if (rows.length) return replay(rows); }
        if (attempt >= 3 || !['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(databaseCode(error))) throw error;
      }
    }
  }
}
function databaseCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const row = current as { code?: string; cause?: unknown }; if (/^ER_[A-Z_]+$/.test(row.code ?? '')) return row.code!; current = row.cause;
  }
  return '';
}
