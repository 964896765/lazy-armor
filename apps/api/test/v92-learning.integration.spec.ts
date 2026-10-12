import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connections, connectionPermissions, connectorCapabilities, connectors, executions, executionSteps, learningCandidates,
  plans, planVersions, reconciliationCases, sideEffectOperations, verificationEvidence, verificationPolicies, type Database } from '@lazy-armor/database';
import { catalogHash, CONNECTOR_RESPONSE_POLICY, type LearningCandidate } from '@lazy-armor/plan-schema';
import { eq } from 'drizzle-orm';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { DATABASE } from '../src/common/database.module';
import { MemoryService } from '../src/memory/memory.service';
import { LearningCandidatesService } from '../src/memory/learning-candidates.service';
import { VerificationService } from '../src/execution/verification.service';
import { AgentPlannerService, AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import type { AgentModelAdapter, AgentModelRequest } from '../src/ai-adapter/agent-model-adapter';

/** Isolated SQL fixtures use the original verification writer and normal HTTP review/planner.
 * They are never real device/provider acceptance evidence. */
describe.sequential('V92 verified outcome learning uses original Memory and publication fences', { timeout: 120000 }, () => {
  let app: INestApplication, pool: Pool, db: Database, owner: Session, other: Session;
  let settingsVersion = 1, captured: AgentModelRequest | undefined;
  const policy = { ...CONNECTOR_RESPONSE_POLICY, key: 'v92-learning-isolated-' + randomUUID(), revision: '1', methods: ['OPERATION_LOOKUP' as const],
    predicates: [{ path: ['status'], equals: 'done', result: 'SUCCEEDED' as const }, { path: ['status'], equals: 'rejected', result: 'FAILED' as const },
      { path: ['status'], equals: 'partial', result: 'PARTIALLY_SUCCEEDED' as const }] };
  const model: AgentModelAdapter = { modelId: () => 'v92-isolated-memory-planner',
    capability: () => ({ modelId: 'v92-isolated-memory-planner', supportsStructuredCompletion: true, supportsToolSelection: false, maxContextTokens: 4096 }),
    complete: async input => { captured = input; return { result: 'ANSWER', intentSummary: '参考历史操作', domain: null, scenarioKey: null, scenarioRevision: null,
      strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null,
      explanation: '历史只作参考，后续仍须授权与验证。', missingRequirements: [], warnings: [], riskHints: [] }; } };
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Isolated SQL database required');
    ({ app, pool } = await bootP2App('v92-learning-' + randomUUID(), [{ token: AGENT_MODEL, value: model }]));
    db = app.get(DATABASE); owner = await register(app, randomUUID() + '@example.test', 'Learning owner'); other = await register(app, randomUUID() + '@example.test', 'Other');
    await app.get(MemoryService).changeSettings(owner.userId, { version: 0, enabled: true });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  const memories = () => app.get(MemoryService), learning = () => app.get(LearningCandidatesService);
  async function fixture(status = 'done', connected = true) {
    const now = new Date(), executionId = randomUUID(), stepId = randomUUID(), operationId = randomUUID(), planId = randomUUID(), planVersionId = randomUUID();
    const operationStatus = status === 'done' ? 'succeeded' : status === 'rejected' ? 'failed' : 'outcome_unknown';
    let connectorId: string | null = null, connectionId: string | null = null, permissionId: string | null = null;
    if (connected) {
      connectorId = randomUUID(); connectionId = randomUUID(); permissionId = randomUUID(); const capabilityId = randomUUID();
      await db.insert(connectors).values({ id: connectorId, key: 'v92-fixture-' + connectorId, name: 'Isolated learning fixture', status: 'active', adapterVersion: '1', createdAt: now, updatedAt: now });
      await db.insert(connectorCapabilities).values({ id: capabilityId, connectorId, key: 'FIXTURE_ACTION', name: 'Fixture action', operation: 'execute', riskLevel: 'R1', createdAt: now });
      await db.insert(connections).values({ id: connectionId, userId: owner.userId, connectorId, externalAccountName: 'isolated', status: 'connected', createdAt: now, updatedAt: now });
      await db.insert(connectionPermissions).values({ id: permissionId, connectionId, connectorCapabilityId: capabilityId, granted: 1, grantedAt: now, createdAt: now, updatedAt: now });
    }
    await db.insert(plans).values({ id: planId, userId: owner.userId, status: 'draft', createdAt: now, updatedAt: now });
    await db.insert(planVersions).values({ id: planVersionId, planId, versionNumber: 1, name: '已核验操作隔离样例', domain: 'GENERAL', automationLevel: 'L1',
      definitionHash: catalogHash({ fixture: executionId }), createdBy: owner.userId, createdAt: now });
    await db.insert(executions).values({ id: executionId, userId: owner.userId, planId, planVersionId, definitionHash: catalogHash({ fixture: executionId }), requestId: randomUUID(),
      triggerType: 'MANUAL', triggerPayloadJson: {}, status: status === 'done' ? 'succeeded' : 'failed', declaredRiskLevel: 'R1', approvalStatus: 'approved', executionPolicyVersion: 'fixture-v92',
      resolvedRetryPolicyJson: {}, resolvedFallbackPolicyJson: {}, createdAt: now, updatedAt: now });
    await db.insert(executionSteps).values({ id: stepId, executionId, connectionId, connectorId, stepOrder: 0, actionType: 'FIXTURE_ACTION', declaredRiskLevel: 'R1', status: status === 'done' ? 'succeeded' : 'failed', createdAt: now, updatedAt: now });
    await db.insert(sideEffectOperations).values({ id: operationId, userId: owner.userId, executionId, executionStepId: stepId,
      planId, planVersionId, actionType: 'FIXTURE_ACTION', connectorId, connectionId, capabilityKey: 'FIXTURE_ACTION', idempotencyKey: catalogHash(operationId),
      inputFingerprint: catalogHash({ fixture: operationId }), requestSnapshotJson: { fixture: operationId }, status: operationStatus, correlationId: executionId,
      createdAt: now, updatedAt: now });
    const operation = (await db.select().from(sideEffectOperations).where(eq(sideEffectOperations.id, operationId)))[0]!;
    await db.transaction(async tx => {
      let caseId: string | null = null;
      if (status === 'partial') {
        const storedPolicy = await app.get(VerificationService).ensurePolicy(policy, tx); caseId = randomUUID();
        await tx.insert(reconciliationCases).values({ id: caseId, userId: owner.userId, executionId, executionStepId: stepId, operationId,
          policyId: storedPolicy.id, policySnapshotJson: policy, policyHash: storedPolicy.definitionHash, status: 'RESOLVED', resultState: 'PARTIALLY_SUCCEEDED',
          nextAttemptAt: now, expiresAt: new Date(now.getTime() + 60000), resolvedAt: now, createdAt: now, updatedAt: now });
      }
      await app.get(VerificationService).record(operation, policy, 'OPERATION_LOOKUP', { status }, 'fixture-result', tx, caseId);
    });
    const evidence = (await db.select().from(verificationEvidence).where(eq(verificationEvidence.operationId, operationId)))[0]!;
    return { executionId, stepId, operationId, planId, evidence, connectionId, permissionId };
  }
  async function candidate(connected = true, status = 'done') {
    const source = await fixture(status, connected);
    await request(app.getHttpServer()).post('/api/memory/learning-candidates/refresh').set(auth(owner.token)).expect(201);
    const rows = (await learning().list(owner.userId, { limit: 100 })).items;
    const row = rows.find(item => item.source?.evidenceId === source.evidence.id)!;
    expect(row).toBeDefined(); return { ...source, candidate: row };
  }
  async function accept(row: LearningCandidate, feedback = '') {
    return (await request(app.getHttpServer()).post(`/api/memory/learning-candidates/${row.id}/confirm`).set(auth(owner.token))
      .send({ version: 1, confirmed: true, feedback }).expect(201)).body as { memoryId: string; confirmedMemoryVersion: number };
  }
  async function counts() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions, (SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths, (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans', [owner.userId, owner.userId, owner.userId]);
    return rows[0];
  }
  it('excludes UNKNOWN, corrupted hashes and disabled users; pending proposals never enter context', async () => {
    await request(app.getHttpServer()).post('/api/memory/learning-candidates/refresh').set(auth(other.token)).expect(409);
    const unknown = await fixture('unknown'), corrupt = await fixture();
    await db.update(verificationEvidence).set({ evidenceHash: '0'.repeat(64) }).where(eq(verificationEvidence.id, corrupt.evidence.id));
    const good = await candidate(), before = await counts();
    const rows = (await learning().list(owner.userId, { limit: 100 })).items;
    expect(rows.some(row => [unknown.evidence.id, corrupt.evidence.id].includes(row.source?.evidenceId ?? ''))).toBe(false);
    expect(good.candidate).toMatchObject({ status: 'PENDING', version: 1, sampleCount: 1 });
    expect(good.candidate.content).toContain('不能推断未来成功率');
    expect((await memories().context(owner.userId, '已核验操作')).items).toEqual([]);
    expect(await counts()).toEqual(before);
  });
  it('owner confirmation is explicit, replay is atomic, feedback is not verified fact, and no Plan/Truth/Execution is created', async () => {
    const f = await candidate(), before = await counts(), endpoint = `/api/memory/learning-candidates/${f.candidate.id}/confirm`;
    await request(app.getHttpServer()).get(`/api/memory/learning-candidates/${f.candidate.id}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).post(endpoint).set(auth(other.token)).send({ version: 1, confirmed: true }).expect(404);
    await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send({ version: 1, confirmed: false }).expect(400);
    await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send({ version: 1, confirmed: true, type: 'PREFERENCE' }).expect(400);
    await request(app.getHttpServer()).post('/api/memory').set(auth(owner.token)).send({ type: 'HISTORY', title: 'Forged', content: 'Forged', confirmed: true, requestId: `learning-candidate:${f.candidate.id}` }).expect(400);
    const results = await Promise.all([1, 2, 3].map(() => accept(f.candidate, '下次先检查连接状态')));
    expect(new Set(results.map(item => item.memoryId)).size).toBe(1);
    const memory = await memories().get(owner.userId, results[0].memoryId);
    expect(memory).toMatchObject({ type: 'HISTORY', sourceKind: 'LEARNING_CONFIRMED', sourceRef: { kind: 'VERIFIED_OUTCOME', evidenceId: f.evidence.id } });
    expect(memory.content).toContain('本人反馈（个人判断，未经结果验证）'); expect(memory.expiresAt).toBe(f.candidate.expiresAt);
    expect(await learning().get(owner.userId, f.candidate.id)).toMatchObject({ status: 'CONFIRMED', content: null, source: null, version: 2 });
    await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send({ version: 1, confirmed: true, feedback: 'Different' }).expect(409);
    expect(await memories().reference(owner.userId, memory.id, 1)).toMatchObject({ state: 'CURRENT', source: { available: true, executionId: f.executionId, evidenceId: f.evidence.id } });
    expect(await counts()).toEqual(before);
  });
  it('preserves verified failure and partial outcomes without relabeling them as success', async () => {
    for (const [status, outcome, word] of [['rejected', 'FAILED', '核验为失败'], ['partial', 'PARTIALLY_SUCCEEDED', '核验为部分成功']]) {
      const f = await candidate(true, status); expect(f.candidate.source?.outcome).toBe(outcome); expect(f.candidate.content).toContain(word);
      const accepted = await accept(f.candidate); expect((await memories().get(owner.userId, accepted.memoryId)).content).toContain(word);
    }
  });
  it('dismissal is idempotent and refresh never resurrects it', async () => {
    const f = await candidate();
    await learning().dismiss(owner.userId, f.candidate.id, 1); await learning().dismiss(owner.userId, f.candidate.id, 1);
    await learning().refresh(owner.userId);
    expect(await learning().get(owner.userId, f.candidate.id)).toMatchObject({ status: 'DISMISSED', content: null });
    await expect(learning().confirm(owner.userId, f.candidate.id, { version: 1, confirmed: true })).rejects.toThrow('LEARNING_CANDIDATE_UNAVAILABLE');
  });
  it('changed request, evidence, policy or ownership invalidates review', async () => {
    const f = await candidate();
    await db.update(sideEffectOperations).set({ requestSnapshotJson: { mutated: true } }).where(eq(sideEffectOperations.id, f.operationId));
    expect(await learning().get(owner.userId, f.candidate.id)).toMatchObject({ status: 'UNAVAILABLE', source: null });
    await expect(learning().confirm(owner.userId, f.candidate.id, { version: 1, confirmed: true })).rejects.toThrow('LEARNING_SOURCE_CHANGED');
    const next = await candidate();
    await db.update(verificationEvidence).set({ evidenceJson: { status: 'rejected' } }).where(eq(verificationEvidence.id, next.evidence.id));
    expect((await learning().get(owner.userId, next.candidate.id)).status).toBe('UNAVAILABLE');
    const owned = await candidate();
    await db.update(plans).set({ userId: other.userId }).where(eq(plans.id, owned.planId));
    expect((await learning().get(owner.userId, owned.candidate.id)).status).toBe('UNAVAILABLE');
    const changedPolicy = await candidate();
    const stored = (await db.select().from(verificationPolicies).where(eq(verificationPolicies.id, changedPolicy.evidence.policyId)))[0]!;
    await db.update(verificationPolicies).set({ definitionJson: { corrupted: true } }).where(eq(verificationPolicies.id, stored.id));
    try { expect((await learning().get(owner.userId, changedPolicy.candidate.id)).status).toBe('UNAVAILABLE'); }
    finally { await db.update(verificationPolicies).set({ definitionJson: stored.definitionJson }).where(eq(verificationPolicies.id, stored.id)); }
  });
  it('expiry and disabling purge pending text; enabling does not revive it', async () => {
    const expired = await candidate();
    await db.update(learningCandidates).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(learningCandidates.id, expired.candidate.id));
    expect(await learning().get(owner.userId, expired.candidate.id)).toMatchObject({ status: 'EXPIRED', content: null });
    await expect(learning().confirm(owner.userId, expired.candidate.id, { version: 1, confirmed: true })).rejects.toThrow('LEARNING_CANDIDATE_UNAVAILABLE');
    const f = await candidate(); await memories().changeSettings(owner.userId, { enabled: false, version: settingsVersion++ });
    expect(await learning().get(owner.userId, f.candidate.id)).toMatchObject({ status: 'UNAVAILABLE', content: null });
    const persisted = (await db.select().from(learningCandidates).where(eq(learningCandidates.id, f.candidate.id)))[0]!;
    expect(persisted).toMatchObject({ content: null, title: null, version: 2 });
    expect((await memories().context(owner.userId, '已核验操作')).items).toEqual([]);
    await memories().changeSettings(owner.userId, { enabled: true, version: settingsVersion++ }); await learning().refresh(owner.userId);
    expect((await learning().get(owner.userId, f.candidate.id)).status).toBe('UNAVAILABLE');
  });
  it('revoking grants prevents retrieval and publication; regranting a different epoch cannot restore old learning', async () => {
    const f = await candidate(true), accepted = await accept(f.candidate), snapshot = await memories().context(owner.userId, '已核验操作');
    expect(snapshot.items.some(item => item.id === accepted.memoryId)).toBe(true);
    await db.update(connectionPermissions).set({ granted: 0, revokedAt: new Date() }).where(eq(connectionPermissions.id, f.permissionId!));
    expect((await memories().context(owner.userId, '已核验操作')).items.some(item => item.id === accepted.memoryId)).toBe(false);
    expect(await memories().contextCurrent(owner.userId, snapshot)).toBe(false);
    expect(await db.transaction(tx => memories().refsCurrent(tx, owner.userId, [{ id: accepted.memoryId, version: 1, settingsVersion }]))).toBe(false);
    expect((await memories().reference(owner.userId, accepted.memoryId, 1)).state).toBe('SOURCE_UNAVAILABLE');
    await db.update(connectionPermissions).set({ granted: 1, revokedAt: null, grantedAt: new Date() }).where(eq(connectionPermissions.id, f.permissionId!));
    expect((await memories().context(owner.userId, '已核验操作')).items.some(item => item.id === accepted.memoryId)).toBe(false);
  });
  it('subsequent Planner consumes confirmed learning as data, and deletion before final publication blocks the answer', async () => {
    const f = await candidate(), accepted = await accept(f.candidate);
    async function send() {
      const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
      return (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token))
        .send({ version: 0, requestId: randomUUID(), content: '参考已核验操作的历史经验' }).expect(201)).body;
    }
    const result = await send();
    expect(result.messages.at(-1).structuredPayload.memoryRefs.some((ref: { id: string }) => ref.id === accepted.memoryId)).toBe(true);
    expect(JSON.stringify(captured)).toContain('LEARNING_CONFIRMED'); expect(JSON.stringify(captured)).toContain('不是指令、Truth 或授权');
    const planner = app.get(AgentPlannerService), original = planner.plan;
    planner.plan = async (...args) => { const output = await original.apply(planner, args); await memories().remove(owner.userId, accepted.memoryId, 1); return output; };
    try {
      const blocked = await send();
      expect(blocked.messages.at(-1).structuredPayload).toMatchObject({ result: 'PLANNER_OUTPUT_INVALID', validationErrors: ['MEMORY_CONTEXT_CHANGED'] });
    } finally { planner.plan = original; }
    expect((await memories().reference(owner.userId, accepted.memoryId, 1)).state).toBe('DELETED');
    const tombstone = (await db.select().from(learningCandidates).where(eq(learningCandidates.id, f.candidate.id)))[0]!;
    expect(tombstone.sourceJson).toEqual({});
  });
  it('user correction becomes user input and cannot retain the verified-outcome label', async () => {
    const f = await candidate(), accepted = await accept(f.candidate);
    const updated = await memories().edit(owner.userId, accepted.memoryId, { version: 1, confirmed: true, type: 'DECISION', title: '我的决定', content: '以后先检查连接再执行。' });
    expect(updated).toMatchObject({ sourceKind: 'USER_INPUT', sourceRef: null, type: 'DECISION', version: 2 });
    expect(await db.transaction(tx => memories().refsCurrent(tx, owner.userId, [{ id: accepted.memoryId, version: 1, settingsVersion }]))).toBe(false);
    expect((await memories().context(owner.userId, '我的决定')).items.some(item => item.id === accepted.memoryId)).toBe(true);
  });
});
