import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { subscriptionCancellationRequests, subscriptionCustomers, subscriptionEvents, subscriptions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { MembershipLifecycleService } from '../membership/membership-lifecycle.service';
import { SubscriptionBillingProvider, type VerifiedSubscriptionEvent } from './subscription-billing.provider';

@Injectable()
export class SubscriptionBillingService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly provider: SubscriptionBillingProvider,
    private readonly memberships: MembershipLifecycleService,
    private readonly audit: AuditService,
  ) {}

  async createCheckout(userId: string, input: { planKey: 'plus'; requestId: string }) {
    const replay = await this.findByCheckoutRequest(userId, input.requestId);
    if (replay) return { ...this.serialize(replay), duplicate: true };

    const customer = await this.getOrCreateCustomer(userId);
    const checkout = await this.provider.createCheckout({
      externalCustomerId: customer.externalCustomerId,
      planKey: input.planKey,
      requestId: input.requestId,
    });
    const now = new Date();
    const id = newId();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(subscriptions).values({
          id,
          userId,
          subscriptionCustomerId: customer.id,
          provider: this.provider.key,
          externalSubscriptionId: checkout.externalSubscriptionId,
          checkoutRequestId: input.requestId,
          externalCheckoutId: checkout.checkoutId,
          checkoutUrl: checkout.checkoutUrl,
          membershipPlanKey: input.planKey,
          status: 'incomplete',
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: 0,
          createdAt: now,
          updatedAt: now,
        });
        await this.audit.append({
          actorType: 'user', actorUserId: userId, action: 'SUBSCRIPTION_CHECKOUT_CREATED',
          resourceType: 'subscription', resourceId: id, userId, requestId: input.requestId,
          source: 'api', result: 'success', changeSummary: 'Sandbox Plus checkout created',
          after: { provider: this.provider.key, planKey: input.planKey, status: 'incomplete' },
        }, tx);
      });
    } catch (error) {
      if (!this.hasDatabaseCode(error, 'ER_DUP_ENTRY')) throw error;
      const raced = await this.findByCheckoutRequest(userId, input.requestId);
      if (!raced) throw error;
      return { ...this.serialize(raced), duplicate: true };
    }
    const created = await this.findById(userId, id);
    if (!created) throw new NotFoundException('Subscription checkout was not persisted');
    return { ...this.serialize(created), duplicate: false };
  }

  async getCurrent(userId: string) {
    const rows = await this.db.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return { subscription: rows[0] ? this.serialize(rows[0]) : null };
  }

  async cancel(userId: string, requestId: string) {
    const current = await this.findLatestSubscriptionRow(userId);
    if (!current) throw new NotFoundException('Subscription does not exist');

    // 已经处于 cancelAtPeriodEnd 时，任何 requestId 都不得再触发 Provider 副作用。
    if (current.cancelAtPeriodEnd === 1) {
      await this.reserveCancellation(userId, current.id, requestId, 'already_pending');
      const refreshed = await this.findById(userId, current.id);
      if (!refreshed) throw new NotFoundException('Subscription does not exist');
      return { ...this.serialize(refreshed), cancellationPending: true, duplicate: true };
    }

    // 先抢占 (userId, requestId) 幂等身份，只有赢家才调用 Provider。
    const reserved = await this.reserveCancellation(userId, current.id, requestId, 'pending');
    if (!reserved) {
      const refreshed = await this.findById(userId, current.id);
      if (!refreshed) throw new NotFoundException('Subscription does not exist');
      return { ...this.serialize(refreshed), cancellationPending: refreshed.cancelAtPeriodEnd === 1, duplicate: true };
    }

    await this.provider.cancelSubscription(current.externalSubscriptionId);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(subscriptions).set({ cancelAtPeriodEnd: 1, updatedAt: now })
        .where(and(eq(subscriptions.id, current.id), eq(subscriptions.userId, userId)));
      await tx.update(subscriptionCancellationRequests).set({ status: 'requested' })
        .where(and(eq(subscriptionCancellationRequests.userId, userId), eq(subscriptionCancellationRequests.requestId, requestId)));
      await this.audit.append({
        actorType: 'user', actorUserId: userId, action: 'SUBSCRIPTION_CANCELLATION_REQUESTED',
        resourceType: 'subscription', resourceId: current.id, userId, requestId,
        source: 'api', result: 'pending', changeSummary: 'Sandbox subscription cancellation requested',
        after: { cancelAtPeriodEnd: true },
      }, tx);
    });
    const refreshed = await this.findById(userId, current.id);
    if (!refreshed) throw new NotFoundException('Subscription does not exist');
    return { ...this.serialize(refreshed), cancellationPending: true, duplicate: false };
  }

  async receiveWebhook(rawBody: string, signature: string, timestamp: string) {
    let event: VerifiedSubscriptionEvent;
    try {
      event = this.provider.verifyWebhook(rawBody, signature, timestamp);
    } catch (error) {
      await this.audit.append({
        actorType: 'system', actorUserId: null, action: 'SUBSCRIPTION_WEBHOOK_REJECTED',
        resourceType: 'subscription_event', resourceId: null, userId: null,
        source: 'api', result: 'blocked', reasonCode: 'WEBHOOK_VERIFICATION_FAILED',
        changeSummary: 'Sandbox subscription webhook verification failed',
      });
      throw error;
    }
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const existing = await this.findEvent(event.eventId);
    if (existing) return this.duplicateResult(existing.payloadHash, payloadHash, event.eventId);

    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx.select({
          id: subscriptions.id,
          userId: subscriptions.userId,
          customerId: subscriptionCustomers.externalCustomerId,
          planKey: subscriptions.membershipPlanKey,
          lastAppliedOccurredAt: subscriptions.lastAppliedOccurredAt,
        }).from(subscriptions)
          .innerJoin(subscriptionCustomers, eq(subscriptionCustomers.id, subscriptions.subscriptionCustomerId))
          .where(and(
            eq(subscriptions.provider, this.provider.key),
            eq(subscriptions.externalSubscriptionId, event.subscriptionId),
          ))
          .limit(1)
          .for('update');
        const subscription = rows[0];
        if (!subscription) throw new NotFoundException('Webhook subscription does not exist');
        if (subscription.customerId !== event.customerId || subscription.planKey !== event.planKey) {
          throw new ConflictException('Webhook subscription identity does not match checkout');
        }

        const eventId = newId();
        const receivedAt = new Date();
        await tx.insert(subscriptionEvents).values({
          id: eventId,
          userId: subscription.userId,
          subscriptionId: subscription.id,
          provider: this.provider.key,
          externalEventId: event.eventId,
          eventType: event.eventType,
          payloadHash,
          payloadSnapshotJson: this.eventSnapshot(event),
          occurredAt: event.occurredAt,
          receivedAt,
        });

        // 时序保护：迟到旧事件不得覆盖已应用的新状态（append-only event 仍保留审计痕迹）。
        if (subscription.lastAppliedOccurredAt && event.occurredAt < subscription.lastAppliedOccurredAt) {
          await this.audit.append({
            actorType: 'system', actorUserId: null, action: 'SUBSCRIPTION_WEBHOOK_IGNORED',
            resourceType: 'subscription_event', resourceId: eventId, userId: subscription.userId,
            requestId: event.eventId, source: 'api', result: 'success',
            changeSummary: 'Sandbox subscription event ignored as out-of-order',
            after: this.eventSnapshot(event),
          }, tx);
          return { received: true, duplicate: false, ignored: true, reason: 'out_of_order', eventId: event.eventId };
        }

        await tx.update(subscriptions).set({
          status: event.status,
          currentPeriodStart: event.currentPeriodStart,
          currentPeriodEnd: event.currentPeriodEnd,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd ? 1 : 0,
          lastAppliedOccurredAt: event.occurredAt,
          updatedAt: receivedAt,
        }).where(eq(subscriptions.id, subscription.id));
        await this.memberships.applySubscriptionState({
          userId: subscription.userId,
          planKey: event.planKey,
          status: event.status,
          currentPeriodStart: event.currentPeriodStart,
          currentPeriodEnd: event.currentPeriodEnd,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
          provider: this.provider.key,
          externalSubscriptionId: event.subscriptionId,
          eventId: event.eventId,
        }, tx);
        await this.audit.append({
          actorType: 'system', actorUserId: null, action: 'SUBSCRIPTION_WEBHOOK_APPLIED',
          resourceType: 'subscription_event', resourceId: eventId, userId: subscription.userId,
          requestId: event.eventId, source: 'api', result: 'success',
          changeSummary: 'Sandbox subscription event applied once',
          after: this.eventSnapshot(event),
        }, tx);
        return { received: true, duplicate: false, eventId: event.eventId };
      });
    } catch (error) {
      if (!this.hasDatabaseCode(error, 'ER_DUP_ENTRY')) throw error;
      const raced = await this.findEvent(event.eventId);
      if (!raced) throw error;
      return this.duplicateResult(raced.payloadHash, payloadHash, event.eventId);
    }
  }

  private async getOrCreateCustomer(userId: string) {
    const current = await this.db.select().from(subscriptionCustomers)
      .where(and(eq(subscriptionCustomers.userId, userId), eq(subscriptionCustomers.provider, this.provider.key)))
      .limit(1);
    if (current[0]) return current[0];
    const external = await this.provider.createCustomer({ userId });
    const now = new Date();
    await this.db.insert(subscriptionCustomers).values({
      id: newId(), userId, provider: this.provider.key, externalCustomerId: external.externalCustomerId,
      status: 'active', createdAt: now, updatedAt: now,
    }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
    const rows = await this.db.select().from(subscriptionCustomers)
      .where(and(eq(subscriptionCustomers.userId, userId), eq(subscriptionCustomers.provider, this.provider.key)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Subscription customer was not persisted');
    return rows[0];
  }

  private findByCheckoutRequest(userId: string, requestId: string) {
    return this.db.select().from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.checkoutRequestId, requestId)))
      .limit(1).then((rows) => rows[0] ?? null);
  }

  private findLatestSubscriptionRow(userId: string) {
    return this.db.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1).then((rows) => rows[0] ?? null);
  }

  private async reserveCancellation(userId: string, subscriptionId: string, requestId: string, status: string) {
    const now = new Date();
    try {
      await this.db.insert(subscriptionCancellationRequests).values({
        id: newId(), userId, subscriptionId, requestId, provider: this.provider.key, status, createdAt: now,
      });
      return true;
    } catch (error) {
      if (this.hasDatabaseCode(error, 'ER_DUP_ENTRY')) return false;
      throw error;
    }
  }

  private findById(userId: string, id: string) {
    return this.db.select().from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
      .limit(1).then((rows) => rows[0] ?? null);
  }

  private findEvent(externalEventId: string) {
    return this.db.select({ payloadHash: subscriptionEvents.payloadHash }).from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.provider, this.provider.key), eq(subscriptionEvents.externalEventId, externalEventId)))
      .limit(1).then((rows) => rows[0] ?? null);
  }

  private duplicateResult(existingHash: string, nextHash: string, eventId: string) {
    if (existingHash !== nextHash) throw new ConflictException('Duplicate subscription event has a different payload');
    return { received: true, duplicate: true, eventId };
  }

  private eventSnapshot(event: VerifiedSubscriptionEvent) {
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      customerId: event.customerId,
      subscriptionId: event.subscriptionId,
      planKey: event.planKey,
      status: event.status,
      currentPeriodStart: event.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: event.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: event.cancelAtPeriodEnd,
      occurredAt: event.occurredAt.toISOString(),
    };
  }

  private serialize(row: typeof subscriptions.$inferSelect) {
    return {
      id: row.id,
      planKey: row.membershipPlanKey,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
      provider: row.provider,
      checkout: row.status === 'incomplete' ? { id: row.externalCheckoutId, url: row.checkoutUrl } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private hasDatabaseCode(error: unknown, expected: string) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
      if ((current as { code?: unknown }).code === expected) return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }
}
