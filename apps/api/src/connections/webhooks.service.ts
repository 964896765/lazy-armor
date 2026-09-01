import { ConflictException, ForbiddenException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { connections, credentialRefs, webhookReceipts } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';
import { PermissionsService } from '../permissions/permissions.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import type { WebhookEventDto } from './dto';
import { WebhookSignatureVerifier } from './webhook-signature-verifier.service';

const MAX_WEBHOOK_PAYLOAD_BYTES = 100_000; // §15 payload 大小上限
const TIMESTAMP_WINDOW_SECONDS = 300; // §14 时间戳新鲜度 ±5 分钟

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly permissions: PermissionsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly verifier: WebhookSignatureVerifier,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async receive(userId: string, connectionId: string, event: WebhookEventDto) {
    await this.permissions.assertGranted(userId, connectionId, 'RECEIVE_WEBHOOK');
    await this.verifySignatureIfPresent(userId, connectionId, event);

    // §14 时间戳新鲜度：提供则必须在 ±5 分钟内。
    if (event.timestamp) {
      const ts = Number(event.timestamp);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_WINDOW_SECONDS) {
        throw new ConflictException('Webhook timestamp is outside the replay window');
      }
    }

    // §13 限流：每个连接每分钟上限。
    const rate = await this.rateLimiter.consume(`webhook:${connectionId}`, 100, 60);
    if (!rate.allowed) throw new ConflictException('Webhook rate limit exceeded');

    const payload = JSON.stringify(event.payload);
    // §15 payload 大小上限，避免无限原样保存。
    if (Buffer.byteLength(payload, 'utf8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
      throw new PayloadTooLargeException('Webhook payload exceeds the maximum size');
    }

    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const existing = await this.findExisting(connectionId, event.eventId, event.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ConflictException('Duplicate webhook key has a different payload');
      return { receiptId: existing.id, duplicate: true };
    }
    const id = newId();
    const receivedAt = new Date();
    const retentionDays = this.config.get<number>('WEBHOOK_RETENTION_DAYS') ?? 7;
    try {
      await this.db.insert(webhookReceipts).values({
        id, connectionId, eventId: event.eventId, requestId: event.requestId, idempotencyKey: event.idempotencyKey,
        payloadHash, payload: '{}', payloadSnapshotJson: this.minimalSnapshot(event.payload), payloadSizeBytes: Buffer.byteLength(payload, 'utf8'),
        receivedAt, expiresAt: new Date(receivedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000), purgedAt: null,
      });
      return { receiptId: id, duplicate: false };
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
      const raced = await this.findExisting(connectionId, event.eventId, event.idempotencyKey);
      if (!raced || raced.payloadHash !== payloadHash) throw new ConflictException('Duplicate webhook key has a different payload');
      return { receiptId: raced.id, duplicate: true };
    }
  }

  private minimalSnapshot(payload: Record<string, unknown>) {
    const keys = Object.keys(payload).sort().slice(0, 50);
    return {
      schema: 'webhook-minimal-v1',
      topLevelKeys: keys,
      topLevelKeyCount: Object.keys(payload).length,
      arrayItemCount: Array.isArray(payload.items) ? payload.items.length : null,
    };
  }

  private async findExisting(connectionId: string, eventId: string, idempotencyKey: string) {
    const rows = await this.db.select({ id: webhookReceipts.id, payloadHash: webhookReceipts.payloadHash })
      .from(webhookReceipts)
      .where(and(eq(webhookReceipts.connectionId, connectionId), or(eq(webhookReceipts.eventId, eventId), eq(webhookReceipts.idempotencyKey, idempotencyKey))))
      .limit(1);
    return rows[0];
  }

  private async verifySignatureIfPresent(userId: string, connectionId: string, event: WebhookEventDto) {
    if (!event.signature && !event.timestamp) return;
    if (!event.signature || !event.timestamp) {
      await this.audit.append({
        actorType: 'user',
        actorUserId: userId,
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        resourceType: 'connection',
        resourceId: connectionId,
        userId,
        source: 'api',
        result: 'blocked',
        reasonCode: 'BAD_SIGNATURE',
        changeSummary: 'Webhook signature or timestamp was missing',
      });
      throw new ForbiddenException('Webhook signature validation failed');
    }

    const rows = await this.db.select({
      credentialRef: credentialRefs.ref,
      credentialVersion: credentialRefs.currentVersion,
    }).from(connections)
      .leftJoin(credentialRefs, eq(connections.credentialRefId, credentialRefs.id))
      .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
      .limit(1);
    const credentialRef = rows[0]?.credentialRef;
    if (!credentialRef) {
      await this.audit.append({
        actorType: 'user',
        actorUserId: userId,
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        resourceType: 'connection',
        resourceId: connectionId,
        userId,
        source: 'api',
        result: 'blocked',
        reasonCode: 'WEBHOOK_SECRET_MISSING',
        changeSummary: 'Webhook signing secret is not configured',
      });
      throw new ForbiddenException('Webhook signature validation failed');
    }

    const credential = await this.credentials.get(credentialRef, rows[0]?.credentialVersion ?? undefined);
    const secret = credential.webhookSecret ?? credential.signingSecret;
    if (!secret) {
      await this.audit.append({
        actorType: 'user',
        actorUserId: userId,
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        resourceType: 'connection',
        resourceId: connectionId,
        userId,
        source: 'api',
        result: 'blocked',
        reasonCode: 'WEBHOOK_SECRET_MISSING',
        changeSummary: 'Webhook signing secret is not configured',
      });
      throw new ForbiddenException('Webhook signature validation failed');
    }

    const check = this.verifier.verify(JSON.stringify(event.payload), event.signature, event.timestamp, secret);
    if (!check.valid) {
      await this.audit.append({
        actorType: 'user',
        actorUserId: userId,
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        resourceType: 'connection',
        resourceId: connectionId,
        userId,
        source: 'api',
        result: 'blocked',
        reasonCode: check.reason ?? 'BAD_SIGNATURE',
        changeSummary: 'Webhook signature verification failed',
      });
      throw new ForbiddenException('Webhook signature validation failed');
    }
  }
}
