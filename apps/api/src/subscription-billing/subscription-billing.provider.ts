export type SubscriptionStatus = 'incomplete' | 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface VerifiedSubscriptionEvent {
  eventId: string;
  eventType: 'subscription.updated';
  customerId: string;
  subscriptionId: string;
  planKey: 'plus';
  status: Exclude<SubscriptionStatus, 'incomplete'>;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  occurredAt: Date;
}

export abstract class SubscriptionBillingProvider {
  abstract readonly key: string;
  abstract readonly production: boolean;
  abstract createCustomer(input: { userId: string }): Promise<{ externalCustomerId: string }>;
  abstract createCheckout(input: { externalCustomerId: string; planKey: 'plus'; requestId: string }): Promise<{
    checkoutId: string;
    checkoutUrl: string;
    externalSubscriptionId: string;
  }>;
  abstract getSubscription(externalSubscriptionId: string): Promise<{
    externalSubscriptionId: string;
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
  } | null>;
  abstract cancelSubscription(externalSubscriptionId: string): Promise<{ status: SubscriptionStatus; cancelAtPeriodEnd: boolean }>;
  abstract verifyWebhook(rawBody: string, signature: string, timestamp: string): VerifiedSubscriptionEvent;
}
