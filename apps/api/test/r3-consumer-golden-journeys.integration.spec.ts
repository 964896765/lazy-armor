import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionWorker } from '../src/execution/execution-worker.service';
import { DailySummaryService } from '../src/daily-summary/daily-summary.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';

/**
 * R3 Consumer Golden Journeys —— 端到端闭环验证。
 *
 * 每条 Journey 都从「真实 Observation → Candidate → VERIFIED Truth → Scenario → Strategy
 * → Plan → Risk/Approval → Execution → Action Recipe → Verification → Today/Record」走完整链路，
 * 不通过直接插库伪造 Truth / Execution / Notification 的结果。
 *
 * R3-01 手机账目（ANOMALY_DETECTION / EXISTS）：
 *   billing.enrichContext 显式读取 hydratedFactValue.amountMinor/.currency，classify →
 *   summarize(billing, shouldNotify=true) → notify 落库 → record(recorded=true)。
 *
 * R3-02 快递静默管家（SILENT_FOLLOW_UP / EXISTS）：
 *   logistics.enrichContext 读取 hydratedFactValue.{status}，summarize(logistics, notifyOnDelivered=true)
 *   在 delivered 时 shouldNotify=true，普通 in_transit 时 shouldNotify=false（notify 静默跳过）。
 *
 * R3-03 设备耗材（PREDICTIVE_PREPARE / LTE 30）：
 *   device.enrichContext 读取 hydratedFactValue.{remainingDays,consumableType}，nearReplacement(<=30)
 *   时 prepare_purchase 插入 preparedShoppingItems，随后 notify + record 全闭环。
 *
 * R3-04 家庭补给（PREDICTIVE_PREPARE / LTE 30）：
 *   household.enrichContext 读取 hydratedFactValue.{remainingDays,itemName}，nearRunOut(<=30)
 *   时 prepare_purchase 插入 preparedShoppingItems，随后 notify + record 全闭环。
 *
 * R3-05 每日重要事项摘要（PERIODIC_SUMMARY / SCHEDULE）：
 *   truth change 不产生 FACT_CHANGED wakeup；显式 schedule 触发后走 daily_summary recipe，
 *   summarize(domain=daily_summary) 读取 importantItemCandidates → notify + record。
 */

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

interface JourneySpec {
  id: string;
  scenarioKey: string;
  strategy: string;
  factKey: string;
  resourceType: string;
  parserKey: string;
  normalizerKey: string;
  freshnessPolicyKey: string;
  confidence: number;
  valueJson: Record<string, unknown>;
  compatibilityResourceKey: string | null;
  subjectPrefix: string;
}

const JOURNEYS: readonly JourneySpec[] = Object.freeze([
  Object.freeze({
    id: 'R3-01',
    scenarioKey: 'finance.abnormal_transaction',
    strategy: 'ANOMALY_DETECTION',
    factKey: 'finance.transaction.amount',
    resourceType: 'finance.transaction',
    parserKey: 'mobile-notification-billing.v1',
    normalizerKey: 'money.v1',
    freshnessPolicyKey: 'transaction.default',
    confidence: 80,
    valueJson: { amountMinor: 120000, currency: 'CNY' },
    compatibilityResourceKey: 'mobile.billing.transaction',
    subjectPrefix: 'tx',
  }),
  Object.freeze({
    id: 'R3-02',
    scenarioKey: 'daily_life.delivery',
    strategy: 'SILENT_FOLLOW_UP',
    factKey: 'shipment.status',
    resourceType: 'shipment',
    parserKey: 'generic.shipment-status.v1',
    normalizerKey: 'shipment-status.v1',
    freshnessPolicyKey: 'shipment.status',
    confidence: 100,
    valueJson: { status: 'delivered' },
    compatibilityResourceKey: null,
    subjectPrefix: 'shipment',
  }),
  Object.freeze({
    id: 'R3-03',
    scenarioKey: 'device.consumables',
    strategy: 'PREDICTIVE_PREPARE',
    factKey: 'device.consumable.remaining_days',
    resourceType: 'device.consumable',
    parserKey: 'generic.consumable-remaining.v1',
    normalizerKey: 'consumable-remaining.v1',
    freshnessPolicyKey: 'consumable.remaining',
    confidence: 100,
    valueJson: { remainingDays: 25, consumableType: 'toner' },
    compatibilityResourceKey: null,
    subjectPrefix: 'device',
  }),
  Object.freeze({
    id: 'R3-04',
    scenarioKey: 'family.family_supply',
    strategy: 'PREDICTIVE_PREPARE',
    factKey: 'household.supply.remaining_days',
    resourceType: 'household.supply',
    parserKey: 'generic.household-supply.v1',
    normalizerKey: 'household-supply.v1',
    freshnessPolicyKey: 'household.supply',
    confidence: 100,
    valueJson: { remainingDays: 20, itemName: '洗洁精' },
    compatibilityResourceKey: null,
    subjectPrefix: 'supply',
  }),
  Object.freeze({
    id: 'R3-05',
    scenarioKey: 'daily_life.errands',
    strategy: 'PERIODIC_SUMMARY',
    factKey: 'digital_account.connection.health',
    resourceType: 'digital_account.connection',
    parserKey: 'generic.connection-health.v1',
    normalizerKey: 'connection-health.v1',
    freshnessPolicyKey: 'connection.health',
    confidence: 100,
    valueJson: { status: 'healthy' },
    compatibilityResourceKey: null,
    subjectPrefix: 'connection',
  }),
]);

describe.sequential('R3 consumer golden journeys', { timeout: 120_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: ExecutionWorker;
  let owner: Session;
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ({ app, pool, worker } = await bootP2App(`r3-golden-${unique}`));
    owner = await register(app, `r3-golden-${unique}@example.com`, 'R3 Consumer');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  async function compileBindAndSeed(spec: JourneySpec, variant: string) {
    const suffix = variant ? `-${variant}` : '';
    const compiled = await request(app.getHttpServer())
      .post(`/api/scenarios/${spec.scenarioKey}/compile`)
      .set(auth(owner.token))
      .send({ strategy: spec.strategy, name: `${spec.id}${suffix}-${unique}` })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/api/plans')
      .set(auth(owner.token))
      .send(compiled.body.definitionInput)
      .expect(201);
    const planId = created.body.id as string;
    const planVersionId = created.body.currentVersion.id as string;
    await activatePlan(app, owner.token, planId);

    const binding = await request(app.getHttpServer())
      .post('/api/strategy-runtime/bindings')
      .set(auth(owner.token))
      .send({ planVersionId, scenarioKey: spec.scenarioKey, strategy: spec.strategy })
      .expect(201);

    const observationId = randomUUID();
    const candidateId = randomUUID();
    const subjectKey = `${spec.subjectPrefix}-${unique}${suffix}`;
    const evidenceHash = digest(`evidence-${spec.id}-${unique}${suffix}`);
    await pool.query(
      `INSERT INTO source_observations
        (id,user_id,connection_id,source_mode,provider_key,external_event_key,source_identity,parser_key,resource_hint,payload_hash,evidence_hash,payload_json,status,observed_at,occurred_at,received_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),NULL,'INTERNAL','r3-golden',?,?,?,?,?,?,CAST(? AS JSON),'NORMALIZED',NOW(6),NULL,NOW(6))`,
      [observationId, owner.userId, `event-${spec.id}-${unique}${suffix}`, digest(`identity-${spec.id}-${unique}${suffix}`), spec.parserKey, spec.resourceType, digest(`payload-${spec.id}-${unique}${suffix}`), evidenceHash, JSON.stringify(spec.valueJson)],
    );
    await pool.query(
      `INSERT INTO candidate_facts
        (id,user_id,observation_id,resource_type,resource_key,subject_key,fact_key,value_json,value_hash,dedupe_key,confidence,normalizer_key,freshness_policy_key,conflict_policy_key,compatibility_resource_key,status,truth_record_id,decided_at,created_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?,?,CAST(? AS JSON),?,?,?,?,?,?,?,'PENDING',NULL,NULL,NOW(6))`,
      [candidateId, owner.userId, observationId, spec.resourceType, subjectKey, subjectKey, spec.factKey, JSON.stringify(spec.valueJson), digest(JSON.stringify(spec.valueJson)), digest(`candidate-${spec.id}-${unique}${suffix}`), spec.confidence, spec.normalizerKey, spec.freshnessPolicyKey, 'latest_verified_then_observed', spec.compatibilityResourceKey],
    );

    const truth = await pipeline.confirmCandidate(owner.userId, candidateId);
    return { compiled, binding, planId, planVersionId, truth, subjectKey, candidateId };
  }

  async function findWakeup(truthRecordVersionId: string, bindingId: string) {
    const wakeups = await request(app.getHttpServer()).get('/api/strategy-runtime/wakeups').set(auth(owner.token)).expect(200);
    return wakeups.body.filter((item: { wakeup: { truthRecordVersionId: string; bindingId: string } }) => item.wakeup.truthRecordVersionId === truthRecordVersionId && item.wakeup.bindingId === bindingId);
  }

  async function executeWakeup(wakeupId: string) {
    const evaluated = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201);
    expect(evaluated.body.result).toBe('READY_FOR_PLAN_ENGINE');
    const handedOff = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/handoff`).set(auth(owner.token)).expect(201);
    expect(handedOff.body.status).toBe('DISPATCHED');
    const executionId = handedOff.body.executionId as string;
    expect(executionId).toBeTruthy();
    await worker.processExecution(executionId);
    const detail = await request(app.getHttpServer()).get(`/api/executions/${executionId}`).set(auth(owner.token)).expect(200);
    expect(detail.body.status).toBe('succeeded');
    return detail;
  }

  it('R3-01 手机账目（finance.abnormal_transaction）完整闭环：Truth → wakeup → 执行 → 通知 + 记录', async () => {
    const spec = JOURNEYS[0];
    const { binding, planVersionId, truth } = await compileBindAndSeed(spec, 'main');
    expect(binding.body).toMatchObject({ planVersionId, scenarioKey: spec.scenarioKey, strategyKey: spec.strategy });

    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const wakeupId = matching[0].wakeup.id as string;

    const detail = await executeWakeup(wakeupId);
    const notifyStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'notify');
    const recordStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'record');
    expect(notifyStep?.outputSnapshotJson).toMatchObject({ notified: true });
    expect(recordStep?.outputSnapshotJson).toMatchObject({ recorded: true, recordType: 'finance.abnormal_transaction' });
    expect(detail.body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'daily_account_summary', priority: 'P2' }),
    ]));
  });

  it('R3-02 快递静默管家（daily_life.delivery）：delivered 通知闭环 + in_transit 静默分支', async () => {
    const spec = JOURNEYS[1];

    const delivered = await compileBindAndSeed(spec, 'delivered');
    const deliveredWakeups = await findWakeup(delivered.truth.currentVersionId, delivered.binding.body.id);
    expect(deliveredWakeups).toHaveLength(1);
    const deliveredDetail = await executeWakeup(deliveredWakeups[0].wakeup.id as string);
    const deliveredNotify = deliveredDetail.body.steps.find((step: { actionType: string }) => step.actionType === 'notify');
    const deliveredRecord = deliveredDetail.body.steps.find((step: { actionType: string }) => step.actionType === 'record');
    expect(deliveredNotify?.outputSnapshotJson).toMatchObject({ notified: true });
    expect(deliveredRecord?.outputSnapshotJson).toMatchObject({ recorded: true, recordType: 'daily_life.delivery' });
    // 共享的 logistics summarize 会产出更细粒度的事件类型，覆盖 recipe 声明的 shipment_follow_up。
    expect(deliveredDetail.body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'logistics_delivered' }),
    ]));

    const inTransit = await compileBindAndSeed({ ...spec, valueJson: { status: 'in_transit' } }, 'in-transit');
    const transitWakeups = await findWakeup(inTransit.truth.currentVersionId, inTransit.binding.body.id);
    expect(transitWakeups).toHaveLength(1);
    const transitDetail = await executeWakeup(transitWakeups[0].wakeup.id as string);
    const transitNotify = transitDetail.body.steps.find((step: { actionType: string }) => step.actionType === 'notify');
    const transitRecord = transitDetail.body.steps.find((step: { actionType: string }) => step.actionType === 'record');
    expect(transitNotify?.outputSnapshotJson).toMatchObject({ notified: false, skipped: true });
    expect(transitRecord?.outputSnapshotJson).toMatchObject({ recorded: true, recordType: 'daily_life.delivery' });
  });

  it('R3-03 设备耗材（device.consumables）完整闭环：prepare_purchase → notify → record', async () => {
    const spec = JOURNEYS[2];
    const { planId, binding, truth } = await compileBindAndSeed(spec, 'main');

    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const detail = await executeWakeup(matching[0].wakeup.id as string);

    const prepareStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'prepare_purchase');
    const notifyStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'notify');
    const recordStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'record');
    expect(prepareStep?.outputSnapshotJson).toMatchObject({ shoppingListPrepared: true });
    expect(notifyStep?.outputSnapshotJson).toMatchObject({ notified: true });
    expect(recordStep?.outputSnapshotJson).toMatchObject({ recorded: true, recordType: 'device.consumables' });

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM prepared_shopping_items WHERE user_id = UUID_TO_BIN(?) AND source_plan_id = UUID_TO_BIN(?)`,
      [owner.userId, planId],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBeGreaterThanOrEqual(1);
  });

  it('R3-03 设备耗材 quiet 分支：remainingDays > 30 → CONDITION_NOT_MET / QUIET', async () => {
    const spec = JOURNEYS[2];
    const { binding, truth } = await compileBindAndSeed({ ...spec, valueJson: { remainingDays: 40 } }, 'quiet');
    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const wakeupId = matching[0].wakeup.id as string;

    const evaluated = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201);
    expect(evaluated.body.result).toBe('CONDITION_NOT_MET');
    const handedOff = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/handoff`).set(auth(owner.token)).expect(201);
    expect(handedOff.body).toMatchObject({ status: 'QUIET', executionId: null });
  });

  it('R3-03 设备耗材 duplicate：重复 confirmCandidate 不产生第二条 VERIFIED Truth', async () => {
    const spec = JOURNEYS[2];
    const { truth, subjectKey, candidateId } = await compileBindAndSeed(spec, 'dup');
    const again = await pipeline.confirmCandidate(owner.userId, candidateId);
    expect(again.currentVersionId).toBe(truth.currentVersionId);

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM truth_records WHERE user_id = UUID_TO_BIN(?) AND resource_key = ? AND subject_key = ? AND status = 'verified'`,
      [owner.userId, spec.resourceType, subjectKey],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBe(1);
  });

  it('R3-03 设备耗材 stale：过期 verifiedAt 被 truth handoff 拒绝，不产生 execution', async () => {
    const spec = JOURNEYS[2];
    const { binding, truth } = await compileBindAndSeed(spec, 'stale');
    // 24h truth-handoff 保鲜截止是当前真实可达的 stale 边界（freshness policy 声明 ttl 86400s + onStale refresh）。
    // 用 UTC_TIMESTAMP 写入，避免 MySQL 会话时区（Asia/Shanghai）把「25h 前」错写成本地时间导致 8h 偏移。
    await pool.query(`UPDATE truth_records SET verified_at = UTC_TIMESTAMP(6) - INTERVAL 25 HOUR WHERE id = UUID_TO_BIN(?)`, [truth.id]);

    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const wakeupId = matching[0].wakeup.id as string;

    const evaluated = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201);
    expect(evaluated.body.result).toBe('READY_FOR_PLAN_ENGINE');

    await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/handoff`).set(auth(owner.token)).expect(403);
    const wakeups = await request(app.getHttpServer()).get('/api/strategy-runtime/wakeups').set(auth(owner.token)).expect(200);
    const wakeup = wakeups.body.find((item: { wakeup: { id: string } }) => item.wakeup.id === wakeupId);
    expect(wakeup.wakeup.handoffStatus).toBe('BLOCKED');
    expect(wakeup.wakeup.handoffExecutionId).toBeNull();
  });

  it('R3-04 家庭补给（family.family_supply）完整闭环：prepare_purchase → notify → record', async () => {
    const spec = JOURNEYS[3];
    const { planId, binding, truth } = await compileBindAndSeed(spec, 'main');

    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const detail = await executeWakeup(matching[0].wakeup.id as string);

    const prepareStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'prepare_purchase');
    const notifyStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'notify');
    const recordStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'record');
    expect(prepareStep?.outputSnapshotJson).toMatchObject({ shoppingListPrepared: true });
    expect(notifyStep?.outputSnapshotJson).toMatchObject({ notified: true });
    expect(recordStep?.outputSnapshotJson).toMatchObject({ recorded: true, recordType: 'family.family_supply' });

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM prepared_shopping_items WHERE user_id = UUID_TO_BIN(?) AND source_plan_id = UUID_TO_BIN(?)`,
      [owner.userId, planId],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBeGreaterThanOrEqual(1);
  });

  it('R3-04 家庭补给 quiet 分支：remainingDays > 30 → CONDITION_NOT_MET / QUIET', async () => {
    const spec = JOURNEYS[3];
    const { binding, truth } = await compileBindAndSeed({ ...spec, valueJson: { remainingDays: 40 } }, 'quiet');
    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const wakeupId = matching[0].wakeup.id as string;

    const evaluated = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201);
    expect(evaluated.body.result).toBe('CONDITION_NOT_MET');
    const handedOff = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/handoff`).set(auth(owner.token)).expect(201);
    expect(handedOff.body).toMatchObject({ status: 'QUIET', executionId: null });
  });

  it('R3-04 家庭补给 duplicate：重复 confirmCandidate 不产生第二条 VERIFIED Truth', async () => {
    const spec = JOURNEYS[3];
    const { truth, subjectKey, candidateId } = await compileBindAndSeed(spec, 'dup');
    const again = await pipeline.confirmCandidate(owner.userId, candidateId);
    expect(again.currentVersionId).toBe(truth.currentVersionId);

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM truth_records WHERE user_id = UUID_TO_BIN(?) AND resource_key = ? AND subject_key = ? AND status = 'verified'`,
      [owner.userId, spec.resourceType, subjectKey],
    );
    expect((rows as Array<{ c: number }>)[0].c).toBe(1);
  });

  it('R3-04 家庭补给 stale：过期 verifiedAt 被 truth handoff 拒绝，不产生 execution', async () => {
    const spec = JOURNEYS[3];
    const { binding, truth } = await compileBindAndSeed(spec, 'stale');
    await pool.query(`UPDATE truth_records SET verified_at = UTC_TIMESTAMP(6) - INTERVAL 25 HOUR WHERE id = UUID_TO_BIN(?)`, [truth.id]);

    const matching = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(matching).toHaveLength(1);
    const wakeupId = matching[0].wakeup.id as string;

    const evaluated = await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/evaluate`).set(auth(owner.token)).expect(201);
    expect(evaluated.body.result).toBe('READY_FOR_PLAN_ENGINE');

    await request(app.getHttpServer()).post(`/api/strategy-runtime/wakeups/${wakeupId}/handoff`).set(auth(owner.token)).expect(403);
    const wakeups = await request(app.getHttpServer()).get('/api/strategy-runtime/wakeups').set(auth(owner.token)).expect(200);
    const wakeup = wakeups.body.find((item: { wakeup: { id: string } }) => item.wakeup.id === wakeupId);
    expect(wakeup.wakeup.handoffStatus).toBe('BLOCKED');
    expect(wakeup.wakeup.handoffExecutionId).toBeNull();
  });

  it('R3-05 每日重要事项摘要（daily_life.errands）：schedule 触发 → 执行 → 通知 + 记录', async () => {
    const spec = JOURNEYS[4];
    const { binding, planVersionId, truth } = await compileBindAndSeed(spec, 'main');
    expect(binding.body).toMatchObject({ planVersionId, scenarioKey: spec.scenarioKey, strategyKey: spec.strategy });

    // truth change 不能直接触发 daily-summary wakeup（PERIODIC_SUMMARY 只接受 SCHEDULE）。
    const truthWakeups = await findWakeup(truth.currentVersionId, binding.body.id);
    expect(truthWakeups).toHaveLength(0);

    const dailySummary = app.get(DailySummaryService);
    const now = new Date();
    await dailySummary.createCandidate(owner.userId, {
      sourceType: 'internal_task',
      sourceId: `task-${unique}`,
      title: '续缴房租',
      summary: '月底前需要续缴房租',
      occurredAt: now.toISOString(),
      dueAt: now.toISOString(),
      category: '家庭',
      requiresAction: true,
    });

    const scheduled = await request(app.getHttpServer())
      .post(`/api/strategy-runtime/bindings/${binding.body.id}/schedule`)
      .set(auth(owner.token))
      .expect(201);
    const wakeupId = scheduled.body.id as string;
    expect(wakeupId).toBeTruthy();

    const detail = await executeWakeup(wakeupId);
    const notifyStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'notify');
    const recordStep = detail.body.steps.find((step: { actionType: string }) => step.actionType === 'record');
    expect(notifyStep?.outputSnapshotJson).toMatchObject({ notified: true });
    expect(recordStep?.outputSnapshotJson).toMatchObject({ recorded: true, recordType: 'daily_life.errands' });
    expect(detail.body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'daily_important_summary' }),
    ]));
  });
});
