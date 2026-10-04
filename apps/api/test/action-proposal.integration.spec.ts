import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { ExecutionWorker } from '../src/execution/execution-worker.service';

describe.sequential('new AI ActionProposal canonical runtime', { timeout: 90000 }, () => {
 let app: INestApplication; let pool: Pool; let owner: Session; let stranger: Session; let worker: ExecutionWorker;
 const proposal = { name: '一次性站内通知', domain: 'life', actionType: 'notify', config: { channel: 'in_app' }, input: { title: '真实运行测试', message: '本次通知已经写入站内通知记录' } };
 beforeAll(async () => {
  const model = { modelId: () => 'explicit-test-model', complete: async () => ({ result: 'ACTION_PROPOSAL', actionProposal: proposal, intentSummary: '一次性通知', domain: 'life', scenarioKey: null, scenarioRevision: null, strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null, explanation: '请确认本次操作，随后仍需执行审批。', missingRequirements: [], warnings: [], riskHints: [] }) };
  const boot = await bootP2App(`action-proposal-${Date.now()}`, [{ token: AGENT_MODEL, value: model }]); app = boot.app; pool = boot.pool; worker = boot.worker;
  owner = await register(app, `action-owner-${Date.now()}@example.com`, 'Owner'); stranger = await register(app, `action-stranger-${Date.now()}@example.com`, 'Stranger');
 });
 afterAll(async () => { await app?.close(); await pool?.end(); });
 it('requires separate approval, verifies persisted effect and never activates a recurring Plan', async () => {
  const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201);
  const proposed = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'new-action', content: '给我发一条站内通知' }).expect(201);
  const message = proposed.body.messages.at(-1); expect(message.structuredPayload.result).toBe('ACTION_PROPOSAL');
  const path = `/api/conversations/${created.body.id}/confirm-action`; const input = { messageId: message.id, version: proposed.body.version, confirmed: true };
  await request(app.getHttpServer()).post(path).set(auth(stranger.token)).send(input).expect(404);
  await request(app.getHttpServer()).post(path).set(auth(owner.token)).send({ ...input, confirmed: false }).expect(400);
  const run = await request(app.getHttpServer()).post(path).set(auth(owner.token)).send(input).expect(201);
  expect(run.body.executionId).toBeTruthy();
  await worker.processExecution(run.body.executionId);
  const waiting = await request(app.getHttpServer()).get(`/api/executions/${run.body.executionId}`).set(auth(owner.token)).expect(200);
  expect(waiting.body.status).toBe('waiting_approval');
  const pendingProjection = await request(app.getHttpServer()).get(`/api/once-requests/${run.body.id}`).set(auth(owner.token)).expect(200);
  expect(pendingProjection.body.primaryAction.path).toBe(`/approvals/${waiting.body.approvals[0].id}`);
  await request(app.getHttpServer()).post(`/api/approvals/${waiting.body.approvals[0].id}/approve`).set(auth(owner.token)).send({}).expect(201);
  await worker.processExecution(run.body.executionId);
  const finished = await request(app.getHttpServer()).get(`/api/executions/${run.body.executionId}`).set(auth(owner.token)).expect(200);
  expect(finished.body.status).toBe('succeeded'); expect(finished.body.steps[0].outputSnapshotJson.localVerification.resultState).toBe('SUCCEEDED');
  const notifications = await request(app.getHttpServer()).get('/api/notifications').set(auth(owner.token)).expect(200);
  expect(notifications.body).toContainEqual(expect.objectContaining({ executionId: run.body.executionId, title: proposal.input.title, body: proposal.input.message }));
  const library = await request(app.getHttpServer()).get('/api/plan-library').set(auth(owner.token)).expect(200); expect(library.body.plans).toEqual([]);
  const replay = await request(app.getHttpServer()).post(path).set(auth(owner.token)).send(input).expect(201); expect(replay.body.executionId).toBe(run.body.executionId);
  await request(app.getHttpServer()).post(`/api/plans/${run.body.planId}/executions`).set(auth(owner.token)).send({ requestId: 'bypass-once', triggerPayload: {} }).expect(409);
  await request(app.getHttpServer()).post(`/api/plans/${run.body.planId}/status`).set(auth(owner.token)).send({ status: 'ready' }).expect(409);
  const timeline = await request(app.getHttpServer()).get(`/api/timeline?date=${finished.body.createdAt.slice(0,10)}&timezone=UTC`).set(auth(owner.token)).expect(200);
  expect(timeline.body).toContainEqual(expect.objectContaining({ id: `execution:${run.body.executionId}`, kind: 'TEMPORARY_TASK', statusGroup: 'COMPLETED' }));
  expect(timeline.body.some((item: { id: string }) => item.id === `temporary-task:${proposed.body.messages.find((item: { role: string }) => item.role === 'user').id}`)).toBe(false);
 });
 it('rejects an old ActionProposal after another conversation turn', async () => {
  const c = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201);
  const one = await request(app.getHttpServer()).post(`/api/conversations/${c.body.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'one', content: '通知' }).expect(201);
  const two = await request(app.getHttpServer()).post(`/api/conversations/${c.body.id}/messages`).set(auth(owner.token)).send({ version: one.body.version, requestId: 'two', content: '更改需求' }).expect(201);
  await request(app.getHttpServer()).post(`/api/conversations/${c.body.id}/confirm-action`).set(auth(owner.token)).send({ messageId: one.body.messages.at(-1).id, version: two.body.version, confirmed: true }).expect(409);
 });
});
