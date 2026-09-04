import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { deviceAppConnections, mobileNotificationReceipts } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { NotificationService } from '../notifications/notification.service';
import { ObservabilityService } from '../observability/observability.service';
import type { CreateMobileNotificationReceiptDto } from './notification-receipt.dto';

const NOTIFICATION_READ_MODE = 'notification_read';
const CAPTURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class MobileNotificationReceiptsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiterService,
    private readonly notifications: NotificationService,
    private readonly telemetry: ObservabilityService,
  ) {}

  async receive(userId: string, connectionId: string, input: CreateMobileNotificationReceiptDto) {
    const connection = await this.getConnection(userId, connectionId);
    await this.assertConnectionAllowsSource(connection, input.sourcePackage, userId, connectionId);
    const postedAt = new Date(input.postedAt);
    const capturedAt = new Date(input.capturedAt);
    await this.assertFresh(capturedAt, postedAt, userId, connectionId);

    const rate = await this.limiter.consume(`mobile-notification:${connectionId}`, 60, 60);
    if (!rate.allowed) {
      await this.block(userId, connectionId, 'RATE_LIMITED');
      this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'RATE_LIMITED' });
      throw new ConflictException('Notification source rate limit exceeded');
    }

    const payloadHash = createHash('sha256').update(JSON.stringify({
      eventId: input.eventId,
      contentHash: input.contentHash,
      sourcePackage: input.sourcePackage,
      postedAt: input.postedAt,
      capturedAt: input.capturedAt,
      hasTitle: input.hasTitle,
      hasText: input.hasText,
    })).digest('hex');
    const existing = await this.findExisting(connectionId, input.eventId);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        await this.block(userId, connectionId, 'DUPLICATE_MISMATCH');
        this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'DUPLICATE_MISMATCH' });
        throw new ConflictException('Notification event key cannot be reused with different evidence');
      }
      this.telemetry.increment('mobile_notification.duplicate', 1, { source: 'generic' });
      return { receiptId: existing.id, duplicate: true, status: existing.status };
    }

    const now = new Date();
    const id = newId();
    try {
      await this.db.insert(mobileNotificationReceipts).values({
        id,
        userId,
        deviceAppConnectionId: connectionId,
        eventId: input.eventId,
        payloadHash,
        sourcePackage: input.sourcePackage,
        postedAt,
        amountMinor: null,
        status: 'received_unclassified',
        snapshotJson: { schema: 'mobile-notification-minimal-v1', hasTitle: input.hasTitle, hasText: input.hasText },
        receivedAt: now,
        verifiedAt: null,
      });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const raced = await this.findExisting(connectionId, input.eventId);
      if (!raced || raced.payloadHash !== payloadHash) throw new ConflictException('Notification event key cannot be reused with different evidence');
      this.telemetry.increment('mobile_notification.duplicate', 1, { source: 'generic' });
      return { receiptId: raced.id, duplicate: true, status: raced.status };
    }

    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'MOBILE_NOTIFICATION_RECEIPT_RECORDED', resourceType: 'mobile_notification_receipt', resourceId: id,
      userId, correlationId: id, changeSummary: 'Recorded a minimal notification receipt from a user-authorized generic app source', source: 'api', result: 'success',
    });
    this.telemetry.increment('mobile_notification.received', 1, { source: 'generic', status: 'unclassified' });
    await this.notifications.emit({
      userId, priority: 'P2', eventType: 'mobile_notification_received', dedupeKey: `mobile_notification:${connectionId}:${input.eventId}`,
      title: '收到一条待核实的应用通知', body: '已保留一条你授权应用的通知线索，等待后续验证。不会触发自动操作。', actionRequired: false,
    });
    return { receiptId: id, duplicate: false, status: 'received_unclassified' };
  }

  private async getConnection(userId: string, connectionId: string) {
    const rows = await this.db.select().from(deviceAppConnections)
      .where(and(eq(deviceAppConnections.id, connectionId), eq(deviceAppConnections.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Device app connection not found');
    return rows[0];
  }

  private async assertConnectionAllowsSource(connection: typeof deviceAppConnections.$inferSelect, sourcePackage: string, userId: string, connectionId: string) {
    if (!connection.enabled || connection.packageName !== sourcePackage || !connection.modesJson.includes(NOTIFICATION_READ_MODE)) {
      await this.block(userId, connectionId, 'SOURCE_NOT_AUTHORIZED');
      this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'SOURCE_NOT_AUTHORIZED' });
      throw new ForbiddenException('This notification source is not authorized for the selected connection');
    }
  }

  private async assertFresh(capturedAt: Date, postedAt: Date, userId: string, connectionId: string) {
    const now = Date.now();
    if (!Number.isFinite(capturedAt.getTime()) || !Number.isFinite(postedAt.getTime()) || Math.abs(now - capturedAt.getTime()) > CAPTURE_WINDOW_MS || postedAt.getTime() > now + CAPTURE_WINDOW_MS || now - postedAt.getTime() > MAX_EVENT_AGE_MS) {
      await this.block(userId, connectionId, 'STALE_EVENT');
      this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'STALE_EVENT' });
      throw new ConflictException('Notification source event is outside the accepted time window');
    }
  }

  private async findExisting(connectionId: string, eventId: string) {
    const rows = await this.db.select({ id: mobileNotificationReceipts.id, payloadHash: mobileNotificationReceipts.payloadHash, status: mobileNotificationReceipts.status })
      .from(mobileNotificationReceipts).where(and(eq(mobileNotificationReceipts.deviceAppConnectionId, connectionId), eq(mobileNotificationReceipts.eventId, eventId))).limit(1);
    return rows[0];
  }

  private async block(userId: string, connectionId: string, reasonCode: string) {
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'MOBILE_NOTIFICATION_RECEIPT_REJECTED', resourceType: 'device_app_connection', resourceId: connectionId,
      userId, source: 'api', result: 'blocked', reasonCode, changeSummary: 'Rejected a mobile notification receipt before persistence',
    });
  }
}

function isDuplicate(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code === 'ER_DUP_ENTRY') return true;
    current = candidate.cause;
  }
  return false;
}
