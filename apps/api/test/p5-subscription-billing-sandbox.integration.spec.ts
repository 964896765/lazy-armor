import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { SandboxSubscriptionBillingProvider } from '../src/subscription-billing/sandbox-subscription-billing.provider';

interface CheckoutIds extends RowDataPacket {
  subscriptionId: string;
  customerId: string;
}

describe.sequential('P5-C subscription billing sandbox', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let sandbox: SandboxSubscriptionBillingProvider;
  let userA: Session;
  let userB: Session;
  let ids: CheckoutIds;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const secret = 'test-sandbox-subscription-webhook-secret';

  beforeAll(async () => {
    const booted = await bootP2App('p5-subscription-' + unique);
    app = booted.app;
    pool = booted.pool;
    sandbox = app.get(SandboxSubscriptionBillingProvider);
    userA = await register(app, 'p5-subscription-a-' + unique + '@example.com', 'P5 Subscription A');
    userB = await register(app, 'p5-subscription-b-' + unique + '@example.com', 'P5 Subscription B');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('creates one sandbox checkout for an idempotent request and preserves user isolation', async () => {
    const body = { planKey: 'plus', requestId: 'checkout-' + unique };
    const first = await request(app.getHttpServer()).post('/api/subscription-billing/checkout').set(auth(userA.token)).send(body).expect(201);
    const replay = await request(app.getHttpServer()).post('/api/subscription-billing/checkout').set(auth(userA.token)).send(body).expect(201);
    expect(first.body).toMatchObject({ planKey: 'plus', status: 'incomplete', duplicate: false, provider: 'sandbox' });
    expect(first.body.checkout.url).toMatch(/^https:\/\/sandbox\.lazy-armor\.invalid\/checkout\//);
    expect(replay.body).toMatchObject({ id: first.body.id, duplicate: true });
    expect(await request(app.getHttpServer()).get('/api/subscription-billing/subscription').set(auth(userB.token)).expect(200).then((res) => res.body)).toEqual({ subscription: null });
    const [rows] = await pool.query<CheckoutIds[]>(
      'SELECT s.external_subscription_id subscriptionId, c.external_customer_id customerId FROM subscriptions s JOIN subscription_customers c ON c.id=s.subscription_customer_id WHERE s.id=UUID_TO_BIN(?)',
      [first.body.id],
    );
    ids = rows[0];
    expect(ids).toBeTruthy();
  });

  it('rejects unsigned, invalid, and expired sandbox webhook requests', async () => {
    const raw = JSON.stringify(eventPayload('bad-signature-' + unique, 'trial'));
    await request(app.getHttpServer()).post('/api/subscription-billing/webhooks/sandbox')
      .set('content-type', 'application/json').set('x-sandbox-timestamp', String(Math.floor(Date.now() / 1000))).send(raw).expect(401);
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    await request(app.getHttpServer()).post('/api/subscription-billing/webhooks/sandbox')
      .set(webhookHeaders(raw, expiredTimestamp)).set('content-type', 'application/json').send(raw).expect(401);
  });

  it('applies each signed event once through MembershipLifecycleService', async () => {
    await sendEvent(eventPayload('trial-' + unique, 'trial'), 201, false);
    let membership = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(membership.body.membership).toMatchObject({ planKey: 'plus', effectivePlanKey: 'plus', status: 'trial', provider: 'sandbox' });

    const active = eventPayload('active-' + unique, 'active');
    const [first, duplicate] = await Promise.all([sendEvent(active), sendEvent(active)]);
    expect([first.body.duplicate, duplicate.body.duplicate].sort()).toEqual([false, true]);
    membership = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(membership.body.membership).toMatchObject({ effectivePlanKey: 'plus', status: 'active' });

    await sendEvent(eventPayload('past-due-' + unique, 'past_due'));
    membership = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(membership.body.membership).toMatchObject({ planKey: 'plus', effectivePlanKey: 'free', status: 'past_due' });
    await sendEvent(eventPayload('recovered-' + unique, 'active'));
  });

  it('rejects an event-id replay with a different signed payload', async () => {
    const eventId = 'conflict-' + unique;
    await sendEvent(eventPayload(eventId, 'active'));
    await sendEvent(eventPayload(eventId, 'expired'), 409);
  });

  it('requests cancellation without directly mutating membership, then applies the signed provider event', async () => {
    const before = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(before.body.membership.effectivePlanKey).toBe('plus');
    const cancellation = await request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel')
      .set(auth(userA.token)).send({ requestId: 'cancel-' + unique }).expect(201);
    expect(cancellation.body).toMatchObject({ cancelAtPeriodEnd: true, cancellationPending: true });
    const pending = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(pending.body.membership.status).toBe('active');

    await sendEvent({ ...eventPayload('cancelled-' + unique, 'cancelled'), cancelAtPeriodEnd: true });
    const cancelled = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(cancelled.body.membership).toMatchObject({ planKey: 'plus', effectivePlanKey: 'free', status: 'cancelled', cancelAtPeriodEnd: true });
    await sendEvent(eventPayload('expired-' + unique, 'expired'));
    const expired = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userA.token)).expect(200);
    expect(expired.body.membership).toMatchObject({ effectivePlanKey: 'free', status: 'expired' });
  });

  it('stores append-only events and an audit trail without touching another user', async () => {
    const [events] = await pool.query<RowDataPacket[]>('SELECT id FROM subscription_events WHERE user_id=UUID_TO_BIN(?)', [userA.userId]);
    expect(events.length).toBe(7);
    await expect(pool.query('UPDATE subscription_events SET event_type=? WHERE user_id=UUID_TO_BIN(?)', ['changed', userA.userId])).rejects.toThrow(/append-only/i);
    await expect(pool.query('DELETE FROM subscription_events WHERE user_id=UUID_TO_BIN(?)', [userA.userId])).rejects.toThrow(/append-only/i);
    const [audits] = await pool.query<Array<RowDataPacket & { action: string }>>(
      "SELECT action FROM audit_logs WHERE user_id=UUID_TO_BIN(?) AND action IN ('SUBSCRIPTION_WEBHOOK_APPLIED','MEMBERSHIP_SUBSCRIPTION_STATE_APPLIED')",
      [userA.userId],
    );
    expect(audits.filter((row) => row.action === 'SUBSCRIPTION_WEBHOOK_APPLIED')).toHaveLength(7);
    expect(audits.filter((row) => row.action === 'MEMBERSHIP_SUBSCRIPTION_STATE_APPLIED')).toHaveLength(7);
    const other = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userB.token)).expect(200);
    expect(other.body.membership).toMatchObject({ planKey: 'free', effectivePlanKey: 'free', status: 'active' });
  });

  it('C1 collapses concurrent checkout into one provider checkout and one subscription row', async () => {
    const userC = await register(app, 'p5-subscription-c-' + unique + '@example.com', 'P5 Subscription C');
    const requestId = 'concurrent-checkout-' + unique;
    const body = { planKey: 'plus', requestId };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app.getHttpServer()).post('/api/subscription-billing/checkout').set(auth(userC.token)).send(body)),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    const duplicates = responses.map((response) => response.body.duplicate).sort();
    expect(duplicates.filter((value) => value === false)).toHaveLength(1);
    expect(duplicates.filter((value) => value === true)).toHaveLength(4);
    const subscriptionIds = new Set(responses.map((response) => response.body.id));
    expect(subscriptionIds.size).toBe(1);

    const [rows] = await pool.query<RowDataPacket[]>('SELECT checkout_request_id, external_subscription_id, external_checkout_id FROM subscriptions WHERE checkout_request_id=?', [requestId]);
    expect(rows).toHaveLength(1);
    expect(new Set(rows.map((row) => row.external_subscription_id)).size).toBe(1);
    expect(new Set(rows.map((row) => row.external_checkout_id)).size).toBe(1);
    expect(sandbox.checkoutCount(requestId)).toBe(1);
  });

  it('C-A cancels once for a replayed requestId and C-C skips provider for a different pending requestId', async () => {
    const userD = await register(app, 'p5-subscription-d-' + unique + '@example.com', 'P5 Subscription D');
    const checkout = await request(app.getHttpServer()).post('/api/subscription-billing/checkout')
      .set(auth(userD.token)).send({ planKey: 'plus', requestId: 'cancel-setup-' + unique }).expect(201);
    const [created] = await pool.query<CheckoutIds[]>(
      'SELECT external_subscription_id subscriptionId FROM subscriptions WHERE id=UUID_TO_BIN(?)', [checkout.body.id],
    );
    const externalSubscriptionId = created[0].subscriptionId;
    await sendEventFor(userD, externalSubscriptionId, 'cancel-active-' + unique, 'active', new Date().toISOString());

    const cancelRequestId = 'cancel-replay-' + unique;
    const first = await request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel')
      .set(auth(userD.token)).send({ requestId: cancelRequestId }).expect(201);
    expect(first.body).toMatchObject({ cancelAtPeriodEnd: true, duplicate: false });
    const replay = await request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel')
      .set(auth(userD.token)).send({ requestId: cancelRequestId }).expect(201);
    expect(replay.body).toMatchObject({ cancelAtPeriodEnd: true, duplicate: true });
    expect(sandbox.cancelCallCount(externalSubscriptionId)).toBe(1);

    const otherRequest = await request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel')
      .set(auth(userD.token)).send({ requestId: 'cancel-other-' + unique }).expect(201);
    expect(otherRequest.body).toMatchObject({ cancelAtPeriodEnd: true, duplicate: true });
    expect(sandbox.cancelCallCount(externalSubscriptionId)).toBe(1);
  });

  it('C-B serializes concurrent cancellation to a single provider side effect', async () => {
    const userE = await register(app, 'p5-subscription-e-' + unique + '@example.com', 'P5 Subscription E');
    const checkout = await request(app.getHttpServer()).post('/api/subscription-billing/checkout')
      .set(auth(userE.token)).send({ planKey: 'plus', requestId: 'cancel-concurrent-setup-' + unique }).expect(201);
    const [created] = await pool.query<CheckoutIds[]>(
      'SELECT external_subscription_id subscriptionId FROM subscriptions WHERE id=UUID_TO_BIN(?)', [checkout.body.id],
    );
    const externalSubscriptionId = created[0].subscriptionId;
    await sendEventFor(userE, externalSubscriptionId, 'cancel-concurrent-active-' + unique, 'active', new Date().toISOString());

    const requestId = 'cancel-concurrent-' + unique;
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel').set(auth(userE.token)).send({ requestId })),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(responses.filter((response) => response.body.duplicate === false)).toHaveLength(1);
    expect(sandbox.cancelCallCount(externalSubscriptionId)).toBe(1);
  });

  it('C-D keeps cancellation request identity scoped per user', async () => {
    const userF = await register(app, 'p5-subscription-f-' + unique + '@example.com', 'P5 Subscription F');
    const userG = await register(app, 'p5-subscription-g-' + unique + '@example.com', 'P5 Subscription G');
    for (const [user, key] of [[userF, 'f'], [userG, 'g']] as const) {
      const checkout = await request(app.getHttpServer()).post('/api/subscription-billing/checkout')
        .set(auth(user.token)).send({ planKey: 'plus', requestId: `cancel-shared-setup-${key}-${unique}` }).expect(201);
      const [created] = await pool.query<CheckoutIds[]>('SELECT external_subscription_id subscriptionId FROM subscriptions WHERE id=UUID_TO_BIN(?)', [checkout.body.id]);
      await sendEventFor(user, created[0].subscriptionId, `cancel-shared-active-${key}-${unique}`, 'active', new Date().toISOString());
    }
    const sharedRequestId = 'shared-cancel-' + unique;
    const first = await request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel')
      .set(auth(userF.token)).send({ requestId: sharedRequestId }).expect(201);
    const second = await request(app.getHttpServer()).post('/api/subscription-billing/subscription/cancel')
      .set(auth(userG.token)).send({ requestId: sharedRequestId }).expect(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(false);
  });

  it('ignores out-of-order webhook events and never rolls an active state back to trial', async () => {
    const userH = await register(app, 'p5-subscription-h-' + unique + '@example.com', 'P5 Subscription H');
    const checkout = await request(app.getHttpServer()).post('/api/subscription-billing/checkout')
      .set(auth(userH.token)).send({ planKey: 'plus', requestId: 'order-setup-' + unique }).expect(201);
    const [created] = await pool.query<CheckoutIds[]>('SELECT external_subscription_id subscriptionId FROM subscriptions WHERE id=UUID_TO_BIN(?)', [checkout.body.id]);
    const externalSubscriptionId = created[0].subscriptionId;
    const t2 = new Date(Date.now() - 60_000).toISOString();
    const t1 = new Date(Date.now() - 120_000).toISOString();

    await sendEventFor(userH, externalSubscriptionId, 'order-active-' + unique, 'active', t2);
    const lateTrial = await sendEventFor(userH, externalSubscriptionId, 'order-trial-' + unique, 'trial', t1);
    expect(lateTrial.body).toMatchObject({ ignored: true, reason: 'out_of_order' });

    const membership = await request(app.getHttpServer()).get('/api/me/membership').set(auth(userH.token)).expect(200);
    expect(membership.body.membership).toMatchObject({ effectivePlanKey: 'plus', status: 'active' });
  });

  function eventPayload(eventId: string, status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired') {
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
      eventId,
      eventType: 'subscription.updated',
      customerId: ids.customerId,
      subscriptionId: ids.subscriptionId,
      planKey: 'plus',
      status,
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: end.toISOString(),
      cancelAtPeriodEnd: false,
      occurredAt: start.toISOString(),
    };
  }

  function webhookHeaders(raw: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    return {
      'x-sandbox-timestamp': timestamp,
      'x-sandbox-signature': createHmac('sha256', secret).update(timestamp + '.' + raw).digest('hex'),
    };
  }

  async function sendEvent(payload: Record<string, unknown>, expectedStatus = 201, expectedDuplicate?: boolean) {
    const raw = JSON.stringify(payload);
    const response = await request(app.getHttpServer()).post('/api/subscription-billing/webhooks/sandbox')
      .set('content-type', 'application/json').set(webhookHeaders(raw)).send(raw).expect(expectedStatus);
    if (expectedDuplicate !== undefined) expect(response.body.duplicate).toBe(expectedDuplicate);
    return response;
  }

  async function sendEventFor(user: Session, externalSubscriptionId: string, eventId: string, status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired', occurredAt: string) {
    const [customerRows] = await pool.query<RowDataPacket[]>(
      'SELECT c.external_customer_id customerId FROM subscriptions s JOIN subscription_customers c ON c.id=s.subscription_customer_id WHERE s.external_subscription_id=?',
      [externalSubscriptionId],
    );
    const customerId = customerRows[0]?.customerId;
    const start = new Date(occurredAt);
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    const payload = {
      eventId,
      eventType: 'subscription.updated',
      customerId,
      subscriptionId: externalSubscriptionId,
      planKey: 'plus',
      status,
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: end.toISOString(),
      cancelAtPeriodEnd: false,
      occurredAt: start.toISOString(),
    };
    return sendEvent(payload);
  }
});
