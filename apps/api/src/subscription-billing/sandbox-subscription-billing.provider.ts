import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newId } from '@lazy-armor/shared';
import { SubscriptionBillingProvider, type SubscriptionStatus, type VerifiedSubscriptionEvent } from './subscription-billing.provider';

@Injectable()
export class SandboxSubscriptionBillingProvider extends SubscriptionBillingProvider {
  readonly key = 'sandbox';
  readonly production = false;
  private readonly subscriptions = new Map<string, { status: SubscriptionStatus; cancelAtPeriodEnd: boolean }>();

  constructor(private readonly config: ConfigService) { super(); }

  async createCustomer() {
    this.assertEnabled();
    return { externalCustomerId: 'sbx_cus_' + newId().replaceAll('-', '') };
  }

  async createCheckout(input: { externalCustomerId: string; planKey: 'plus'; requestId: string }) {
    this.assertEnabled();
    const checkoutId = 'sbx_chk_' + newId().replaceAll('-', '');
    const externalSubscriptionId = 'sbx_sub_' + newId().replaceAll('-', '');
    this.subscriptions.set(externalSubscriptionId, { status: 'incomplete', cancelAtPeriodEnd: false });
    return {
      checkoutId,
      checkoutUrl: 'https://sandbox.lazy-armor.invalid/checkout/' + checkoutId,
      externalSubscriptionId,
    };
  }

  async getSubscription(externalSubscriptionId: string) {
    this.assertEnabled();
    const found = this.subscriptions.get(externalSubscriptionId);
    return found ? { externalSubscriptionId, ...found } : null;
  }

  async cancelSubscription(externalSubscriptionId: string) {
    this.assertEnabled();
    const found = this.subscriptions.get(externalSubscriptionId);
    if (!found) throw new BadRequestException('Sandbox subscription does not exist');
    const next = { ...found, cancelAtPeriodEnd: true };
    this.subscriptions.set(externalSubscriptionId, next);
    return next;
  }

  verifyWebhook(rawBody: string, signature: string, timestamp: string): VerifiedSubscriptionEvent {
    this.assertEnabled();
    const now = Math.floor(Date.now() / 1000);
    const parsedTimestamp = Number(timestamp);
    if (!Number.isFinite(parsedTimestamp) || Math.abs(now - parsedTimestamp) > 300) {
      throw new UnauthorizedException('Sandbox webhook timestamp is invalid or expired');
    }
    const expected = createHmac('sha256', this.config.getOrThrow<string>('SUBSCRIPTION_BILLING_SANDBOX_WEBHOOK_SECRET'))
      .update(timestamp + '.' + rawBody)
      .digest('hex');
    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Sandbox webhook signature is invalid');
    }
    let value: unknown;
    try { value = JSON.parse(rawBody); } catch { throw new BadRequestException('Sandbox webhook payload is invalid JSON'); }
    const payload = value as Record<string, unknown>;
    const allowedStatuses = ['active', 'trial', 'past_due', 'cancelled', 'expired'];
    if (
      typeof payload.eventId !== 'string' || !payload.eventId || payload.eventId.length > 255
      || payload.eventType !== 'subscription.updated'
      || typeof payload.customerId !== 'string' || !payload.customerId
      || typeof payload.subscriptionId !== 'string' || !payload.subscriptionId
      || payload.planKey !== 'plus'
      || typeof payload.status !== 'string' || !allowedStatuses.includes(payload.status)
      || typeof payload.cancelAtPeriodEnd !== 'boolean'
      || typeof payload.occurredAt !== 'string'
    ) throw new BadRequestException('Sandbox webhook payload is invalid');
    const occurredAt = new Date(payload.occurredAt);
    const currentPeriodStart = this.optionalDate(payload.currentPeriodStart);
    const currentPeriodEnd = this.optionalDate(payload.currentPeriodEnd);
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Sandbox webhook occurredAt is invalid');
    return {
      eventId: payload.eventId,
      eventType: 'subscription.updated',
      customerId: payload.customerId,
      subscriptionId: payload.subscriptionId,
      planKey: 'plus',
      status: payload.status as VerifiedSubscriptionEvent['status'],
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
      occurredAt,
    };
  }

  private optionalDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new BadRequestException('Sandbox webhook period is invalid');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Sandbox webhook period is invalid');
    return date;
  }

  private assertEnabled() {
    if (this.config.get<string>('SUBSCRIPTION_BILLING_PROVIDER') !== 'sandbox') {
      throw new ServiceUnavailableException('Subscription billing is disabled');
    }
  }
}
