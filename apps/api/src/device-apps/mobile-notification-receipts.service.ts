import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { deviceAppConnections, mobileNotificationReceipts } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { NotificationService } from '../notifications/notification.service';
import { ObservabilityService } from '../observability/observability.service';
import { TrustedDevicesService } from '../trusted-devices/trusted-devices.service';
import { TruthStoreService } from '../truth-store/truth-store.service';
import type { CreateMobileNotificationReceiptDto } from './notification-receipt.dto';
import type { VerifyMobileNotificationReceiptDto } from './verify-notification-receipt.dto';

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
    private readonly trustedDevices: TrustedDevicesService,
    private readonly truthStore: TruthStoreService,
  ) {}

  async receive(userId: string, connectionId: string, input: CreateMobileNotificationReceiptDto, signedTrustedDeviceId: string) {
    const connection = await this.getConnection(userId, connectionId);
    if (connection.trustedDeviceId !== signedTrustedDeviceId) {
      await this.block(userId, connectionId, 'SIGNED_DEVICE_MISMATCH');
      this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'SIGNED_DEVICE_MISMATCH' });
      throw new ForbiddenException('A notification receipt must be signed by the trusted device bound to this connection');
    }
    if (!connection.trustedDeviceId) {
      await this.block(userId, connectionId, 'TRUSTED_DEVICE_REQUIRED');
      this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'TRUSTED_DEVICE_REQUIRED' });
      throw new ForbiddenException('Notification sources require a trusted device');
    }
    try {
      await this.trustedDevices.assertActive(userId, connection.trustedDeviceId, connection.deviceId);
    } catch (error) {
      await this.block(userId, connectionId, 'TRUSTED_DEVICE_NOT_ACTIVE');
      this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'TRUSTED_DEVICE_NOT_ACTIVE' });
      throw error;
    }
    await this.assertConnectionAllowsSource(connection, input.sourcePackage, userId, connectionId);
    await this.assertNormalizedCandidate(input, userId, connectionId);
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
      candidateKind: input.candidateKind,
      candidateResource: input.candidateResource,
      candidateConfidence: input.candidateConfidence,
      amountMinor: input.amountMinor,
      currency: input.currency,
      parserVersion: input.parserVersion,
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
        amountMinor: input.amountMinor,
        status: 'received_unclassified',
        snapshotJson: { schema: 'mobile-notification-minimal-v2', hasTitle: input.hasTitle, hasText: input.hasText, candidateKind: input.candidateKind, candidateResource: input.candidateResource, candidateConfidence: input.candidateConfidence, currency: input.currency, parserVersion: input.parserVersion },
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

  async listPending(userId: string) {
    const rows = await this.db.select().from(mobileNotificationReceipts)
      .where(and(eq(mobileNotificationReceipts.userId, userId), eq(mobileNotificationReceipts.status, 'received_unclassified')))
      .orderBy(mobileNotificationReceipts.receivedAt);
    return rows.map((receipt) => {
      const snapshot = receipt.snapshotJson as Record<string, unknown>;
      return {
        id: receipt.id, connectionId: receipt.deviceAppConnectionId, status: receipt.status, postedAt: receipt.postedAt.toISOString(), receivedAt: receipt.receivedAt.toISOString(),
        candidateKind: snapshot.candidateKind === 'billing_transaction_candidate' || snapshot.candidateKind === 'account_notification_candidate' ? snapshot.candidateKind : 'unknown',
        candidateResource: snapshot.candidateResource === 'mobile.billing.transaction' || snapshot.candidateResource === 'mobile.account.notification' ? snapshot.candidateResource : null,
        candidateConfidence: typeof snapshot.candidateConfidence === 'number' ? snapshot.candidateConfidence : 0,
        amountMinor: typeof receipt.amountMinor === 'number' ? receipt.amountMinor : null,
        currency: snapshot.currency === 'CNY' ? 'CNY' : null,
      };
    });
  }

  async verify(userId: string, connectionId: string, receiptId: string, input: VerifyMobileNotificationReceiptDto) {
    const rows = await this.db.select().from(mobileNotificationReceipts)
      .where(and(eq(mobileNotificationReceipts.id, receiptId), eq(mobileNotificationReceipts.deviceAppConnectionId, connectionId), eq(mobileNotificationReceipts.userId, userId))).limit(1);
    const receipt = rows[0];
    if (!receipt) throw new NotFoundException('Mobile notification receipt not found');
    if (receipt.status !== 'received_unclassified') throw new ConflictException('Notification receipt has already been decided');
    const now = new Date();
    if (!input.confirmed) {
      await this.db.update(mobileNotificationReceipts).set({ status: 'rejected_by_user', verifiedAt: now }).where(eq(mobileNotificationReceipts.id, receiptId));
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'MOBILE_NOTIFICATION_CANDIDATE_REJECTED', resourceType: 'mobile_notification_receipt', resourceId: receiptId, userId, correlationId: receiptId, changeSummary: 'User rejected a notification candidate; no truth record was created', source: 'api', result: 'success' });
      this.telemetry.increment('mobile_notification.verification', 1, { outcome: 'rejected_by_user' });
      return { receiptId, status: 'rejected_by_user', truthRecord: null };
    }
    const truthRecord = await this.truthStore.confirmMobileReceipt(userId, receipt);
    await this.db.update(mobileNotificationReceipts).set({ status: 'verified', verifiedAt: now }).where(eq(mobileNotificationReceipts.id, receiptId));
    await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'MOBILE_NOTIFICATION_CANDIDATE_CONFIRMED', resourceType: 'mobile_notification_receipt', resourceId: receiptId, userId, correlationId: receiptId, changeSummary: 'User confirmed a generic notification candidate after device key proof', source: 'api', result: 'success' });
    this.telemetry.increment('mobile_notification.verification', 1, { outcome: 'verified' });
    return { receiptId, status: 'verified', truthRecord };
  }

  private async assertNormalizedCandidate(input: CreateMobileNotificationReceiptDto, userId: string, connectionId: string) {
    const valid = (input.candidateKind === 'unknown' && input.candidateResource === null && input.amountMinor === null && input.currency === null && input.candidateConfidence === 0)
      || (input.candidateKind === 'billing_transaction_candidate' && input.candidateResource === 'mobile.billing.transaction' && Number.isSafeInteger(input.amountMinor) && (input.amountMinor as number) >= 0 && (input.amountMinor as number) <= 2_147_483_647 && input.currency === 'CNY' && input.candidateConfidence >= 1)
      || (input.candidateKind === 'account_notification_candidate' && input.candidateResource === 'mobile.account.notification' && input.amountMinor === null && input.currency === null && input.candidateConfidence >= 1);
    if (valid) return;
    await this.block(userId, connectionId, 'INVALID_NORMALIZED_CANDIDATE');
    this.telemetry.increment('mobile_notification.rejected', 1, { reason: 'INVALID_NORMALIZED_CANDIDATE' });
    throw new BadRequestException('Notification candidate is not a valid generic normalized signal');
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
