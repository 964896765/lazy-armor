import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('runtime productization batch 5 strategy runtime', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let stranger: Session;
  let pipeline: RealityPipelineService;
  let planId: string;
  let planVersionId: string;
  let runtimeHash: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`strategy-runtime-${unique}`));
    owner = await register(app, `strategy-owner-${unique}@example.com`, 'Strategy Owner');
    stranger = await register(app, `strategy-stranger-${unique}@example.com`, 'Strategy Stranger');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('applies the additive strategy runtime migration', async () => {
    const [tables] = await pool.query<RowDataPacket[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema=DATABASE()
          AND table_name IN ('strategy_runtime_bindings','truth_fact_dependencies','strategy_runtime_wakeups','strategy_runtime_decisions')`,
    );
    expect(tables).toHaveLength(4);
  });

  it('publishes the complete versioned deterministic operator registry', async () => {
    const response = await request(app.getHttpServer()).get('/api/strategy-runtime/operators').set(auth(owner.token)).expect(200);
    expect(response.body).toMatchObject({ schemaVersion: '1', revision: 1 });
    expect(response.body.operators.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining([
      'EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS', 'EXISTS',
      'CHANGED', 'CHANGED_BY', 'COUNT', 'WITHIN_WINDOW', 'ALL', 'ANY', 'NOT',
    ]));
  });

  it('binds one immutable PlanVersion and materializes its dependency index idempotently', async () => {
    const compiled = await request(app.getHttpServer()).post('/api/scenarios/device.status/compile')
      .set(auth(owner.token)).send({ strategy: 'AUTOMATED_ACTION', name: `设备状态-${unique}` }).expect(201);
    runtimeHash = compiled.body.runtime.runtimeHash as string;
    const created = await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(compiled.body.definitionInput);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    planId = created.body.id as string;
    planVersionId = created.body.currentVersion.id as string;
    await activatePlan(app, owner.token, planId);

    const body = { planVersionId, scenarioKey: 'device.status', strategy: 'AUTOMATED_ACTION' };
    const bindings = await Promise.all([
      request(app.getHttpServer()).post('/api/strategy-runtime/bindings').set(auth(owner.token)).send(body).expect(201),
           request(app.getHttpServer()).post('/api/strategy-runtime/bindings').set(auth(owner.token)).send(body).expect(201),
    ]);
    expect(new Set(bindings.map((item) => item.body.id))).toHaveLength(1);
    expect(bindings[0].body).toMatchObject({ planVersionId, scenarioKey: 'device.status', strategyKey: 'AUTOMATED_ACTION', runtimeHash });
    expect(bindings[0].body.dependencies).toHaveLength(1);
    expect(bindings[0].body.dependencies[0]).toMatchObject({ scope: 'RESOURCE_WIDE' });

    await request(app.getHttpServer()).post('/api/strategy-runtime/bindings').set(auth(stranger.token)).send(body).expect(404);
    const dependencies = await request(app.getHttpServer()).get('/api/strategy-runtime/dependencies')
      .query({ factKey: 'device_status.status.state' }).set(auth(owner.token)).expect(200);
    expect(dependencies.body).toHaveLength(1);
    expect(dependencies.body.every((item: { planStatus: string }) => item.planStatus === 'active')).toBe(true);
  });

  it('indexes a draft version without making it eligible for Truth wakeups', async () => {
    const compiled = await request(app.getHttpServer()).post('/api/scenarios/device.status/compile')
      .set(auth(owner.token)).send({ strategy: 'AUTOMATED_ACTION', name: `未启用设备状态-${unique}` }).expect(201);
    const created = await request(app.getHttpServer()).post('/api/plans')
      .set(auth(owner.token)).send(compiled.body.definitionInput).expect(201);
    const binding = await request(app.getHttpServer()).post('/api/strategy-runtime/bindings').set(auth(owner.token)).send({
      planVersionId: created.body.currentVersion.id,
      scenarioKey: 'device.status',
      strategy: 'AUTOMATED_ACTION',
    }).expect(201);
    expect(binding.body.dependencies).toHaveLength(1);
    expect(created.body.status).toBe('draft');
  });

  it('atomically turns a matching TruthVersion into one active-plan wakeup', async () => {
    const observationId = randomUUID();
    const candidateId = randomUUID();
    const subjectKey = `device-${unique}`;
    const evidenceHash = digest(`evidence-${unique}`);
    await pool.query(
      `INSERT INTO source_observations
        (id,user_id,connection_id,source_mode,provider_key,external_event_key,source_identity,parser_key,resource_hint,payload_hash,evidence_hash,payload_json,status,observed_at,occurred_at,received_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),NULL,'INTERNAL','strategy-test',?,?,?,?,?,?,CAST(? AS JSON),'NORMALIZED',NOW(6),NULL,NOW(6))`,
      [observationId, owner.userId, `event-${unique}`, digest(`identity-${unique}`), 'strategy-test.v1', 'DeviceStatus', digest('payload'), evidenceHash, JSON.stringify({ subjectKey, value: 'HEALTHY' })],
    );
    await pool.query(
      `INSERT INTO candidate_facts
        (id,user_id,observation_id,resource_type,resource_key,subject_key,fact_key,value_json,value_hash,dedupe_key,confidence,normalizer_key,freshness_policy_key,conflict_policy_key,compatibility_resource_key,status,truth_record_id,decided_at,created_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'DeviceStatus',?,?, 'device_status.status.state',CAST(? AS JSON),?,?,100,'strategy-test.v1','device.default','latest_verified_then_observed',NULL,'PENDING',NULL,NULL,NOW(6))`,
      [candidateId, owner.userId, observationId, subjectKey, subjectKey, JSON.stringify({ value: 'HEALTHY' }), digest('HEALTHY'), digest(`candidate-${unique}`)],
    );

    const truth = await pipeline.confirmCandidate(owner.userId, candidateId);
    const wakeups = await request(app.getHttpServer()).get('/api/strategy-runtime/wakeups').set(auth(owner.token)).expect(200);
    const matching = wakeups.body.filter((item: { wakeup: { truthRecordVersionId: string } }) => item.wakeup.truthRecordVersionId === truth.currentVersionId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ wakeup: { factKey: 'device_status.status.state', resourceType: 'DeviceStatus', status: 'PENDING' } });
  });

  it('persists exactly one deterministic decision under concurrent evaluation', async () => {
    const wakeups = await request(app.getHttpServer()).get('/api/strategy-runtime/wakeups').set(auth(owner.token)).expect(200);
    const wakeupId = wakeups.body[0].wakeup.id as string;
    await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(stranger.token)).expect(404);
    const evaluated = await Promise.all([
      request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201),
      request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201),
    ]);
    expect(new Set(evaluated.map((item) => item.body.id))).toHaveLength(1);
    expect(evaluated[0].body).toMatchObject({ result: 'READY_FOR_PLAN_ENGINE', conditionDecision: { result: true } });
    expect(evaluated[0].body.conditionDecision.truthVersionIds).toHaveLength(1);
    expect(evaluated[0].body.lifecycleTrace).toHaveLength(15);
    expect(evaluated[0].body.lifecycleTrace[6]).toMatchObject({ step: 7, key: 'CONDITION', state: 'SUCCEEDED' });
    expect(evaluated[0].body.lifecycleTrace[7]).toMatchObject({ step: 8, state: 'NOT_STARTED', reason: 'HANDOFF_TO_EXISTING_PLAN_ENGINE' });

    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM strategy_runtime_decisions WHERE wakeup_id=UUID_TO_BIN(?)', [wakeupId]);
    expect(rows[0].total).toBe(1);
  });
});
