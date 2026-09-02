import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CostService } from '../src/cost/cost.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P5-F cost foundation', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let costs: CostService;
  let admin: Session;
  let userA: Session;
  let userB: Session;
  const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
  const providerA = 'cost-ai-' + unique;
  const providerB = 'cost-connector-' + unique;

  beforeAll(async () => {
    const booted = await bootP2App('p5-cost-' + unique);
    app = booted.app;
    pool = booted.pool;
    costs = app.get(CostService);
    admin = await register(app, 'p5-cost-admin-' + unique + '@example.com', 'Cost Admin');
    userA = await register(app, 'p5-cost-a-' + unique + '@example.com', 'Cost A');
    userB = await register(app, 'p5-cost-b-' + unique + '@example.com', 'Cost B');
    await pool.query("UPDATE users SET role='super_admin' WHERE id=UUID_TO_BIN(?)", [admin.userId]);
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('estimates high-cost operations with one centralized catalog', () => {
    expect(costs.estimate({ aiInputUnits: 1200, aiOutputUnits: 100, connectorOperations: 2 })).toBe(14);
    expect(costs.estimate({ storageBytes: 1048577, notificationDeliveries: 2 })).toBe(4);
  });

  it('sets audited user/provider budgets through an admin-only boundary', async () => {
    await request(app.getHttpServer()).post('/api/costs/admin/budgets').set(auth(userA.token)).send({
      scopeType: 'user', userId: userA.userId, monthlyLimitMinor: 12, currency: 'cny',
    }).expect(403);
    await request(app.getHttpServer()).post('/api/costs/admin/budgets').set(auth(admin.token)).send({
      scopeType: 'user', userId: userA.userId, monthlyLimitMinor: 12, currency: 'cny',
    }).expect(201);
    await request(app.getHttpServer()).post('/api/costs/admin/budgets').set(auth(admin.token)).send({
      scopeType: 'provider', provider: providerB, monthlyLimitMinor: 5, currency: 'CNY',
    }).expect(201);
  });

  it('records provider cost exactly once and serializes concurrent premium charges at the budget row', async () => {
    const common = {
      userId: userA.userId, provider: providerA, capability: 'advanced_ai', category: 'ai' as const,
      resourceType: 'ai_request', providerCostMinor: 6,
    };
    expect(await costs.charge({ ...common, resourceId: 'one', identity: 'cost-one-' + unique })).toEqual({ created: true });
    expect(await costs.charge({ ...common, resourceId: 'one', identity: 'cost-one-' + unique })).toEqual({ created: false });
    const concurrent = await Promise.allSettled([
      costs.charge({ ...common, resourceId: 'two', identity: 'cost-two-' + unique }),
      costs.charge({ ...common, resourceId: 'three', identity: 'cost-three-' + unique }),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(String((concurrent.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason?.response?.code)).toBe('COST_BUDGET_EXCEEDED');
  });

  it('never blocks security operations and separates provider cost from billable usage', async () => {
    await expect(costs.charge({
      userId: userA.userId, provider: providerA, capability: 'permission_revoke', category: 'connector',
      resourceType: 'security_operation', resourceId: 'revoke', identity: 'cost-security-' + unique, providerCostMinor: 100,
    })).resolves.toEqual({ created: true });
    const [rows] = await pool.query<Array<RowDataPacket & { cost: number; billable: number }>>(
      "SELECT SUM(provider_cost_minor) cost, SUM(billable) billable FROM usage_events WHERE user_id=UUID_TO_BIN(?) AND usage_type LIKE 'provider_cost.%'",
      [userA.userId],
    );
    expect(Number(rows[0]?.cost)).toBe(112);
    expect(Number(rows[0]?.billable)).toBe(0);
  });

  it('enforces provider budget for premium capability without blocking ordinary operations', async () => {
    const base = {
      userId: userB.userId, provider: providerB, category: 'connector' as const,
      resourceType: 'connector_operation', providerCostMinor: 4,
    };
    await costs.charge({ ...base, capability: 'premium_connector', resourceId: 'premium-one', identity: 'provider-one-' + unique });
    await expect(costs.charge({ ...base, providerCostMinor: 2, capability: 'premium_connector', resourceId: 'premium-two', identity: 'provider-two-' + unique }))
      .rejects.toMatchObject({ response: { code: 'COST_BUDGET_EXCEEDED' } });
    await expect(costs.charge({ ...base, providerCostMinor: 2, capability: 'ordinary_internal', resourceId: 'ordinary', identity: 'provider-ordinary-' + unique }))
      .resolves.toEqual({ created: true });
  });

  it('returns only the requesting user cost summary and preserves the audit trail', async () => {
    const mine = await request(app.getHttpServer()).get('/api/costs/me').set(auth(userA.token)).expect(200);
    expect(mine.body).toMatchObject({ providerCostMinor: 112, billableUsageIsSeparate: true, budget: { monthlyLimitMinor: 12, currency: 'CNY' } });
    expect(mine.body.byProvider[providerA]).toBe(112);
    const other = await request(app.getHttpServer()).get('/api/costs/me').set(auth(userB.token)).expect(200);
    expect(other.body.providerCostMinor).toBe(6);
    expect(other.body.byProvider[providerA]).toBeUndefined();
    const [audits] = await pool.query<RowDataPacket[]>("SELECT id FROM audit_logs WHERE action='COST_BUDGET_SET' AND actor_user_id=UUID_TO_BIN(?)", [admin.userId]);
    expect(audits).toHaveLength(2);
  });
});
