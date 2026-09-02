import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

interface CheckoutIds extends RowDataPacket {
  subscriptionId: string;
  customerId: string;
}

describe.sequential('P5-C subscription billing sandbox', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let userA: Session;
  let userB: Session;
  let ids: CheckoutIds;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const secret = 'test-sandbox-subscription-webhook-secret';

  beforeAll(async () => {
    const booted = await bootP2App('p5-subscription-' + unique);
    app = booted.app;
    pool = booted.pool;
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
});
