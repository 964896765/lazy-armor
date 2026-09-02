import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRateLimitCoordinator } from '../src/infrastructure/connector-rate-limit-coordinator.service';
import { ProviderCircuitBreakerService } from '../src/infrastructure/provider-circuit-breaker.service';
import { admissionForDepth } from '../src/infrastructure/queue.service';
import { UsageService } from '../src/usage/usage.service';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

const planDefinition = (name: string) => ({
  name,
  description: 'P5 stable pagination fixture',
  domain: 'life',
  automationLevel: 'L1',
  sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
  conditions: [],
  actions: [{ actionType: 'record', config: {}, stepOrder: 0 }],
});

describe.sequential('P5-G scale foundation', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let rateLimits: ConnectorRateLimitCoordinator;
  let circuits: ProviderCircuitBreakerService;
  let usage: UsageService;
  let user: Session;
  let other: Session;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);

  beforeAll(async () => {
    const booted = await bootP2App('p5-scale-' + unique);
    app = booted.app;
    pool = booted.pool;
    rateLimits = app.get(ConnectorRateLimitCoordinator);
    circuits = app.get(ProviderCircuitBreakerService);
    usage = app.get(UsageService);
    user = await register(app, 'p5-scale-' + unique + '@example.com', 'Scale User');
    other = await register(app, 'p5-scale-other-' + unique + '@example.com', 'Scale Other');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('coordinates provider/connection limits, Retry-After and bounded exponential jitter', async () => {
    const provider = 'rate-' + unique;
    const connection = 'connection-' + unique;
    await expect(rateLimits.acquire({ provider, connectionId: connection, providerLimit: 1, connectionLimit: 1 })).resolves.toEqual({ allowed: true });
    await expect(rateLimits.acquire({ provider, connectionId: connection, providerLimit: 1, connectionLimit: 1 }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    const retryProvider = 'retry-after-' + unique;
    const retryConnection = 'retry-connection-' + unique;
    await rateLimits.honorRetryAfter(retryProvider, retryConnection, 5000);
    await expect(rateLimits.acquire({ provider: retryProvider, connectionId: retryConnection }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: expect.any(Number) });
    expect(rateLimits.backoffMs(3, null, 0)).toBe(1500);
    expect(rateLimits.backoffMs(3, 5000, 1)).toBe(5000);
  });

  it('shares CLOSED/OPEN/HALF_OPEN circuit state and never reports OPEN as success', async () => {
    const provider = 'circuit-' + unique;
    await circuits.resetForTest(provider);
    expect(await circuits.beforeRequest(provider)).toEqual({ state: 'CLOSED' });
    expect(await circuits.recordFailure(provider, 2)).toMatchObject({ state: 'CLOSED', failures: 1 });
    expect(await circuits.recordFailure(provider, 2)).toMatchObject({ state: 'OPEN', failures: 2 });
    await expect(circuits.beforeRequest(provider, 30_000)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN', category: 'PROVIDER_UNAVAILABLE' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await circuits.beforeRequest(provider, 1)).toEqual({ state: 'HALF_OPEN' });
    await expect(circuits.beforeRequest(provider, 1)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    await circuits.recordSuccess(provider);
    expect(await circuits.beforeRequest(provider)).toEqual({ state: 'CLOSED' });
  });

  it('defers low-priority load under backpressure but preserves approval/security priority', () => {
    expect(admissionForDepth(100, 100, 'low')).toEqual({ delayMs: 30_000, deferred: true });
    expect(admissionForDepth(100, 100, 'normal')).toEqual({ delayMs: 5_000, deferred: true });
    expect(admissionForDepth(1000, 100, 'high')).toEqual({ delayMs: 0, deferred: false });
    expect(admissionForDepth(1000, 100, 'critical')).toEqual({ delayMs: 0, deferred: false });
  });

  it('provides stable cursor pagination for Plan, Execution, Usage and Audit without cross-user leakage', async () => {
    const planIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await request(app.getHttpServer()).post('/api/plans').set(auth(user.token))
        .send(planDefinition('Scale plan ' + index + ' ' + unique)).expect(201);
      planIds.push(created.body.id);
    }
    await activatePlan(app, user.token, planIds[0]!);
    for (let index = 0; index < 3; index += 1) {
      await request(app.getHttpServer()).post('/api/plans/' + planIds[0] + '/executions').set(auth(user.token))
        .send({ requestId: 'scale-execution-' + unique + '-' + index, triggerPayload: {} }).expect(201);
      await usage.record({
        userId: user.userId, usageType: 'scale.test', quantity: 1, unit: 'operation',
        resourceType: 'scale_test', resourceId: String(index), usageIdentity: 'scale.test:' + unique + ':' + index, billable: false,
      });
    }

    await expectTwoPages('/api/plans/page?limit=2');
    await expectTwoPages('/api/executions/page?limit=2');
    await expectTwoPages('/api/me/usage/events?limit=2');
    await expectTwoPages('/api/audit/page?limit=2');
    await request(app.getHttpServer()).get('/api/plans/page?limit=2&cursor=not-a-cursor').set(auth(user.token)).expect(400);
    const isolated = await request(app.getHttpServer()).get('/api/plans/page?limit=10').set(auth(other.token)).expect(200);
    expect(isolated.body.items).toEqual([]);
  });

  it('keeps the reviewed indexes on the actual high-growth tables', async () => {
    const expected = [
      'executions_user_created_idx',
      'execution_steps_status_retry_idx',
      'audit_logs_user_created_idx',
      'outbox_messages_dispatch_idx',
      'usage_events_user_time_type_idx',
      'notifications_user_priority_created_idx',
    ];
    const [rows] = await pool.query<Array<RowDataPacket & { indexName: string }>>(
      'SELECT DISTINCT INDEX_NAME indexName FROM information_schema.statistics WHERE table_schema=DATABASE() AND INDEX_NAME IN (?)',
      [expected],
    );
    expect(rows.map((row) => row.indexName).sort()).toEqual([...expected].sort());
  });

  async function expectTwoPages(path: string) {
    const first = await request(app.getHttpServer()).get(path).set(auth(user.token)).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const separator = path.includes('?') ? '&' : '?';
    const second = await request(app.getHttpServer()).get(path + separator + 'cursor=' + encodeURIComponent(first.body.nextCursor)).set(auth(user.token)).expect(200);
    const firstIds = first.body.items.map((item: { id: string }) => item.id);
    const secondIds = second.body.items.map((item: { id: string }) => item.id);
    expect(secondIds.length).toBeGreaterThan(0);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
  }
});
