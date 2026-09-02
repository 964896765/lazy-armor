import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationService } from '../src/notifications/notification.service';
import { UsageService } from '../src/usage/usage.service';
import { auth, bootP2App, oauthConnect, register, type Session } from './p2-test-helpers';

const planDefinition = {
  name: 'Usage execution fixture',
  description: 'Completes without running actions',
  domain: 'life',
  automationLevel: 'L1',
  sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
  conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 100, sortOrder: 0 }],
  actions: [{ actionType: 'notify', config: { channel: 'in_app' }, stepOrder: 0 }],
};

describe.sequential('P5-B usage metering', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let usage: UsageService;
  let notifications: NotificationService;
  let userA: Session;
  let userB: Session;
  let gmailConnectionId: string;
  let fileBytes = 0;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);

  beforeAll(async () => {
    const booted = await bootP2App('p5-usage-' + unique);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    usage = app.get(UsageService);
    notifications = app.get(NotificationService);
    userA = await register(app, 'p5-usage-a-' + unique + '@example.com', 'P5 Usage A');
    userB = await register(app, 'p5-usage-b-' + unique + '@example.com', 'P5 Usage B');
    gmailConnectionId = (await oauthConnect(app, userA.token, 'gmail', 'p5-usage-gmail-' + unique)).connection.id;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('meters one logical connector operation across duplicate request delivery', async () => {
    const body = { capability: 'READ_EMAIL_METADATA', requestId: 'usage-gmail-request-' + unique, input: {} };
    await request(app.getHttpServer()).post('/api/connections/' + gmailConnectionId + '/invoke').set(auth(userA.token)).send(body).expect(201);
    await request(app.getHttpServer()).post('/api/connections/' + gmailConnectionId + '/invoke').set(auth(userA.token)).send(body).expect(201);
    const [rows] = await pool.query<Array<{ count: number }>>(
      'SELECT COUNT(*) count FROM usage_events WHERE user_id = UUID_TO_BIN(?) AND usage_type = ?',
      [userA.userId, 'connector.operation'],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('meters deterministic AI input/output once for the same logical request', async () => {
    const body = { query: '每个月帮我整理账单月报', requestId: 'usage-ai-request-' + unique };
    await request(app.getHttpServer()).post('/api/templates/natural-language/parse').set(auth(userA.token)).send(body).expect(201);
    await request(app.getHttpServer()).post('/api/templates/natural-language/parse').set(auth(userA.token)).send(body).expect(201);
    const [rows] = await pool.query<Array<{ usageType: string; count: number }>>(
      'SELECT usage_type usageType, COUNT(*) count FROM usage_events WHERE user_id = UUID_TO_BIN(?) AND usage_type IN (?, ?) GROUP BY usage_type',
      [userA.userId, 'ai.input', 'ai.output'],
    );
    expect(Object.fromEntries(rows.map((row) => [row.usageType, Number(row.count)]) )).toEqual({
      'ai.input': 1,
      'ai.output': 1,
    });
  });

  it('meters generated and in-app delivered notification once across dedupe', async () => {
    const input = {
      userId: userA.userId,
      priority: 'P1' as const,
      eventType: 'usage_test',
      dedupeKey: 'usage-notification-' + unique,
      title: 'Usage test',
      body: 'One logical notification',
    };
    await notifications.emit(input);
    await notifications.emit(input);
    const [rows] = await pool.query<Array<{ usageType: string; count: number }>>(
      'SELECT usage_type usageType, COUNT(*) count FROM usage_events WHERE user_id = UUID_TO_BIN(?) AND usage_type LIKE ? GROUP BY usage_type',
      [userA.userId, 'notification.%'],
    );
    expect(Object.fromEntries(rows.map((row) => [row.usageType, Number(row.count)]))).toEqual({
      'notification.delivered': 1,
      'notification.generated': 1,
    });
  });

  it('meters imported file bytes once across idempotent replay', async () => {
    const csv = 'provider,category,billingPeriod,amount,currency,occurredAt\nCloud,storage,2026-09,12.5,CNY,2026-09-02T00:00:00.000Z\n';
    fileBytes = Buffer.byteLength(csv);
    const body = {
      fileName: 'usage.csv',
      mimeType: 'text/csv',
      contentBase64: Buffer.from(csv).toString('base64'),
      idempotencyKey: 'usage-file-' + unique,
    };
    await request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(userA.token)).send(body).expect(201);
    const replay = await request(app.getHttpServer()).post('/api/file-imports/billing').set(auth(userA.token)).send(body).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const [rows] = await pool.query<Array<{ count: number; quantity: number }>>(
      'SELECT COUNT(*) count, SUM(quantity) quantity FROM usage_events WHERE user_id = UUID_TO_BIN(?) AND usage_type = ?',
      [userA.userId, 'storage.file_bytes'],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
    expect(Number(rows[0]?.quantity ?? 0)).toBe(fileBytes);
  });

  it('meters a completed Execution once across worker replay/takeover attempts', async () => {
    const plan = await request(app.getHttpServer()).post('/api/plans').set(auth(userA.token)).send(planDefinition).expect(201);
    await request(app.getHttpServer()).post('/api/plans/' + plan.body.id + '/status').set(auth(userA.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post('/api/plans/' + plan.body.id + '/versions/1/apply').set(auth(userA.token)).expect(201);
    await request(app.getHttpServer()).post('/api/plans/' + plan.body.id + '/status').set(auth(userA.token)).send({ status: 'active' }).expect(201);
    const execution = await request(app.getHttpServer())
      .post('/api/plans/' + plan.body.id + '/executions')
      .set(auth(userA.token))
      .send({ requestId: 'usage-execution-' + unique, triggerPayload: { amount: 0 } })
      .expect(201);
    await worker.processExecution(execution.body.id);
    await worker.processExecution(execution.body.id);
    const [rows] = await pool.query<Array<{ count: number }>>(
      'SELECT COUNT(*) count FROM usage_events WHERE execution_id = UUID_TO_BIN(?) AND usage_type = ?',
      [execution.body.id, 'execution.completed'],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('deduplicates concurrent redelivery identities and enforces append-only storage', async () => {
    const input = {
      userId: userA.userId,
      usageType: 'test.side_effect_redelivery',
      quantity: 1,
      unit: 'operation',
      provider: 'mock',
      resourceType: 'side_effect_operation',
      resourceId: 'side-effect-' + unique,
      usageIdentity: 'test.side_effect_redelivery:' + unique,
      billable: false,
    };
    const results = await Promise.all([usage.record(input), usage.record(input)]);
    expect(results.map((item) => item.created).sort()).toEqual([false, true]);
    await expect(pool.query('UPDATE usage_events SET quantity = 2 WHERE usage_identity = ?', [input.usageIdentity])).rejects.toThrow(/append-only/i);
    await expect(pool.query('DELETE FROM usage_events WHERE usage_identity = ?', [input.usageIdentity])).rejects.toThrow(/append-only/i);
  });

  it('returns consumer usage without provider cost/retry internals and preserves user isolation', async () => {
    const mine = await request(app.getHttpServer()).get('/api/me/usage').set(auth(userA.token)).expect(200);
    expect(mine.body).toMatchObject({
      plan: { active: 1, limit: 3 },
      execution: { completed: 1 },
      connector: { operations: 1 },
      notification: { generated: 1, delivered: 1 },
      storage: { fileBytes },
    });
    expect(mine.body.advancedAi.inputUnits).toBeGreaterThan(0);
    expect(mine.body.advancedAi.outputUnits).toBeGreaterThan(0);
    expect(JSON.stringify(mine.body)).not.toContain('providerCost');
    expect(JSON.stringify(mine.body)).not.toContain('retry');

    const other = await request(app.getHttpServer()).get('/api/me/usage').set(auth(userB.token)).expect(200);
    expect(other.body).toMatchObject({
      plan: { active: 0, limit: 3 },
      execution: { completed: 0 },
      connector: { operations: 0 },
      notification: { generated: 0, delivered: 0 },
      storage: { fileBytes: 0 },
    });
  });
});
