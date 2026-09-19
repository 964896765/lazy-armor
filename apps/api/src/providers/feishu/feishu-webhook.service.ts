import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connections, connectors, credentialRefs, users, webhookReceipts } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { AuditService } from '../../audit/audit.service';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../../credentials/credential-provider';
import { FeishuService } from './feishu.service';
import { parseFeishuEvent } from './feishu-event';

// Feishu event adapter: signature/challenge validation -> durable dedupe ->
// normalize -> RealityPipeline.ingest -> Candidate -> Truth. It never writes
// Truth directly and never triggers Plan execution; it only feeds the pipeline.
@Injectable()
export class FeishuWebhookService {
  private readonly encryptKey?: string;
  constructor(config: ConfigService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly feishu: FeishuService, private readonly audit: AuditService) {
    const key = config.get<string>('FEISHU_EVENT_ENCRYPT_KEY');
    this.encryptKey = key && key.length >= 16 && !/^(?:placeholder|change[-_]?me|example|test[-_]?secret)/i.test(key) ? key : undefined;
  }
  configured() { return Boolean(this.encryptKey && this.feishu.status().appConfigured); }
  async receive(connectionId: string, input: { rawBody?: Buffer; signature?: unknown }) {
    if (!this.configured()) throw new ForbiddenException('Feishu signed event ingestion is not configured');
    let parsed;
    try { parsed = parseFeishuEvent({ rawBody: input.rawBody, signature: input.signature, encryptKey: this.encryptKey }); }
    catch { throw new ForbiddenException('Feishu signed event rejected'); }
    if (parsed.type === 'url_verification') return { challenge: parsed.challenge };
    const owned = (await this.db.select({ userId: connections.userId, ref: credentialRefs.ref, version: credentialRefs.currentVersion,
      status: connections.status, userStatus: users.status })
      .from(connections).innerJoin(connectors, eq(connectors.id, connections.connectorId))
      .innerJoin(credentialRefs, eq(credentialRefs.id, connections.credentialRefId))
      .innerJoin(users, eq(users.id, connections.userId))
      .where(and(eq(connections.id, connectionId), eq(connectors.key, 'feishu'))).limit(1))[0];
    if (!owned || owned.status !== 'connected' || owned.userStatus !== 'active') throw new ForbiddenException('Feishu event target is not authorized');
    let credential;
    try { credential = await this.credentials.get(owned.ref, owned.version); }
    catch { throw new ForbiddenException('Feishu event target is not authorized'); }
    if (credential.tenantKey && credential.tenantKey !== parsed.tenantKey) throw new ForbiddenException('Feishu event tenant mismatch');
    const idempotencyKey = `feishu-raw:v1:${parsed.payloadHash}`;
    const existing = async () => (await this.db.select().from(webhookReceipts).where(and(eq(webhookReceipts.connectionId, connectionId),
      or(eq(webhookReceipts.eventId, parsed.eventId), eq(webhookReceipts.idempotencyKey, idempotencyKey)))).limit(2));
    const response = (row: typeof webhookReceipts.$inferSelect, duplicate: boolean, truthConfirmed: boolean) => {
      if (row.payloadHash !== parsed.payloadHash) throw new ConflictException('Feishu event identity conflict');
      return { receiptId: row.id, duplicate, truthConfirmed };
    };
    const replay = (rows: Array<typeof webhookReceipts.$inferSelect>) => {
      const sameDelivery = rows.find((row) => row.eventId === parsed.eventId);
      if (sameDelivery && sameDelivery.payloadHash !== parsed.payloadHash) throw new ConflictException('Feishu event identity conflict');
      return response(sameDelivery ?? rows[0], true, false);
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const now = new Date();
        const prior = await this.db.select().from(webhookReceipts).where(and(eq(webhookReceipts.connectionId, connectionId),
          or(eq(webhookReceipts.eventId, parsed.eventId), eq(webhookReceipts.idempotencyKey, idempotencyKey)))).limit(2);
        if (prior.length) return replay(prior);
        const receiptId = newId();
        await this.db.insert(webhookReceipts).values({ id: receiptId, connectionId, eventId: parsed.eventId, requestId: `feishu-webhook:${newId()}`,
          idempotencyKey, payloadHash: parsed.payloadHash, payload: '{}', payloadSnapshotJson: parsed.resource, payloadSizeBytes: parsed.payloadSizeBytes,
          receivedAt: now, expiresAt: new Date(now.getTime() + 600_000), acquisitionProviderKey: 'feishu', acquisitionStatus: 'PENDING',
          acquisitionAttemptCount: 0, acquisitionNextAttemptAt: now, acquisitionResultJson: {} });
        await this.audit.append({ actorType: 'system', actorUserId: owned.userId, action: 'FEISHU_EVENT_ACCEPTED', resourceType: 'webhook_receipt',
          resourceId: receiptId, userId: owned.userId, source: 'api', result: 'success', changeSummary: 'Signed Feishu event queued for Reality Pipeline ingestion' });
        const observation = await this.feishu.observeEvent(owned.userId, connectionId, parsed.resource);
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
