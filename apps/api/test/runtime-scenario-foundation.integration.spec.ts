import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuntimeCatalogRegistryService } from '../src/runtime-catalog/runtime-catalog-registry.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('runtime productization batch 2 scenario foundation', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`scenario-foundation-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `scenario-owner-${unique}@example.com`, 'Scenario Owner');
  });
  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('persists immutable complete catalogs', async () => {
    const [[scenarioCount], [resourceCount], [factCount], [strategyCount]] = await Promise.all([
      pool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM scenario_definitions WHERE status='CATALOG_ONLY'"),
      pool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM resource_catalog_definitions WHERE status='ACTIVE'"),
      pool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM fact_schema_definitions WHERE status='ACTIVE'"),
      pool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM strategy_profile_definitions WHERE status='ACTIVE'"),
    ]);
    expect(scenarioCount[0].total).toBe(96);
    expect(resourceCount[0].total).toBeGreaterThanOrEqual(50);
    expect(factCount[0].total).toBeGreaterThanOrEqual(96);
    expect(strategyCount[0].total).toBe(8);
  });

  it('serves domains, scenarios, resource facts and strategies from the shared registry', async () => {
    const domains = await request(app.getHttpServer()).get('/api/domains').set(auth(user.token)).expect(200);
    expect(domains.body).toHaveLength(19);
    expect(domains.body.reduce((sum: number, item: { scenarioCount: number }) => sum + item.scenarioCount, 0)).toBe(96);
    const scenarios = await request(app.getHttpServer()).get('/api/domains/finance/scenarios').set(auth(user.token)).expect(200);
    expect(scenarios.body).toHaveLength(6);
    const detail = await request(app.getHttpServer()).get('/api/scenarios/finance.bill').set(auth(user.token)).expect(200);
    expect(detail.body).toMatchObject({ key: 'finance.bill', domain: 'finance', status: 'CATALOG_ONLY' });
    const facts = await request(app.getHttpServer()).get('/api/resources/Bill/facts').set(auth(user.token)).expect(200);
    expect(facts.body.some((item: { key: string }) => item.key === 'bill.bill.state')).toBe(true);
    const strategies = await request(app.getHttpServer()).get('/api/strategies').set(auth(user.token)).expect(200);
    expect(strategies.body).toHaveLength(8);
  });

  it('reports explicit readiness instead of pretending catalog coverage is automation', async () => {
    const response = await request(app.getHttpServer()).get('/api/scenarios/finance.bill/readiness').set(auth(user.token)).expect(200);
    expect(response.body).toMatchObject({ scenarioKey: 'finance.bill', state: 'MANUAL_READY', evaluatedAgainstRevision: 1 });
    expect(response.body.missingFacts).toContain('bill.bill.state');
    expect(response.body.missingCapabilities).toEqual(expect.arrayContaining(['READ_BILL', 'SEND_NOTIFICATION']));
  });

  it('compiles only a deterministic draft through the existing PlanDefinition contract', async () => {
    const first = await request(app.getHttpServer()).post('/api/scenarios/finance.bill/compile').set(auth(user.token)).send({ strategy: 'PERIODIC_SUMMARY', name: '每月账单摘要' }).expect(201);
    const second = await request(app.getHttpServer()).post('/api/scenarios/finance.bill/compile').set(auth(user.token)).send({ strategy: 'PERIODIC_SUMMARY', name: '每月账单摘要' }).expect(201);
    expect(first.body).toEqual(second.body);
    expect(first.body).toMatchObject({ scenarioKey: 'finance.bill', mode: 'DRAFT', definition: { schemaVersion: '1.0', domain: 'finance', automationLevel: 'L0' } });
  });

  it('keeps repeated concurrent registry sync idempotent', async () => {
    const catalog = app.get(RuntimeCatalogRegistryService);
    await Promise.all([catalog.sync(), catalog.sync(), catalog.sync()]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM scenario_definitions');
    expect(rows[0].total).toBe(96);
  });
});
