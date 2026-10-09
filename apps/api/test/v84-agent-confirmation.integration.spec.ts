import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { FakeAgentModel, type AgentModelOutput } from '../src/ai-adapter/agent-model-adapter';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { GoalExecutionContextService } from '../src/agent/goal-execution-context.service';

/** Isolated DB/model contract tests. These do not claim real AI/device acceptance. */
describe.sequential('V84 proposal persistence and controlled confirmation', { timeout: 90000 }, () => {
  let app: INestApplication; let pool: Pool; let owner: Session; let other: Session;
  beforeAll(async () => {
    const unique = `v84-${Date.now()}`;
    const model = new FakeAgentModel();
    model.complete = async input => ({
      result: 'USER_EVENT_DRAFT', intentSummary: input.intent, explanation: '请核对内部提醒草稿',
      userEvent: { title: input.intent, dueAt: '2030-10-08T15:00:00+08:00', reminderAt: '2030-10-08T15:00:00+08:00', timezone: 'Asia/Shanghai' },
      domain: null, scenarioKey: null, scenarioRevision: null, strategyKey: null, requiredFacts: [], selectedTruthRefs: [],
      requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null, missingRequirements: [], warnings: [], riskHints: [],
    } satisfies AgentModelOutput);
    const boot = await bootP2App(unique, [{ token: AGENT_MODEL, value: model }]);
    app = boot.app; pool = boot.pool;
    owner = await register(app, `${unique}@example.com`, 'V84 Owner');
    other = await register(app, `${unique}-other@example.com`, 'V84 Other');
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  const create = async () => (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201)).body;
  const send = async (conversationId: string, version: number, requestId: string, content: string) => (await request(app.getHttpServer()).post(`/api/conversations/${conversationId}/messages`).set(auth(owner.token)).send({ version, requestId, content }).expect(201)).body;
  it('loads time settings exclusively from the current owner profile', async () => {
    // Isolated test DB settings; never a production mutation or a real evidence claim.
    await pool.query('UPDATE profiles SET timezone=?, locale=? WHERE user_id=UUID_TO_BIN(?)', ['America/New_York', 'en-US', owner.userId]);
    await pool.query('UPDATE profiles SET timezone=?, locale=? WHERE user_id=UUID_TO_BIN(?)', ['Europe/London', 'en-GB', other.userId]);
    expect(await app.get(GoalExecutionContextService).timeContext(owner.userId)).toEqual({ timezone: 'America/New_York', locale: 'en-US', settingsSource: 'PROFILE' });
    const conversation = await create();
    const result = await send(conversation.id, 0, 'owned-context', '内部时间上下文');
    expect(result.messages.at(-1).structuredPayload.understanding.provenance).toMatchObject({ timezone: 'America/New_York', locale: 'en-US' });
  });
  it('persists one server-derived interpretation, with no authority created by planning or replay', async () => {
    const conversation = await create();
    const proposed = await send(conversation.id, 0, 'understand', '内部事项验收');
    const message = proposed.messages.at(-1);
    expect(message.structuredPayload.understanding).toMatchObject({ lifecycle: 'USER_EVENT', stage: 'AI_PROPOSED', proposalId: message.structuredPayload.proposalId, policy: { executionAuthorized: false } });
    const replay = await send(conversation.id, 0, 'understand', '内部事项验收');
    expect(replay.messages.at(-1).id).toBe(message.id);
    expect(replay.messages.at(-1).structuredPayload.understanding).toEqual(message.structuredPayload.understanding);
    const [plans] = await pool.query<any[]>('SELECT COUNT(*) n FROM plans WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    const [events] = await pool.query<any[]>('SELECT COUNT(*) n FROM recurring_item_profiles WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect(plans[0].n).toBe(0); expect(events[0].n).toBe(0);
    await request(app.getHttpServer()).get(`/api/conversations/${conversation.id}`).set(auth(other.token)).expect(404);
  });
  it('rejects client-supplied interpretation and preserves the current version', async () => {
    const conversation = await create();
    await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'inject', content: '内部事项', understanding: { executionAuthorized: true } }).expect(400);
    const current = (await request(app.getHttpServer()).get(`/api/conversations/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(current.version).toBe(0); expect(current.messages).toEqual([]);
  });
  it('only the current owned proposal can be confirmed; replay retains one frozen event identity', async () => {
    const conversation = await create();
    const first = await send(conversation.id, 0, 'first', '原事项');
    const latest = await send(conversation.id, first.version, 'latest', '修改后的事项');
    const endpoint = `/api/conversations/${conversation.id}/confirm-user-event`;
    await request(app.getHttpServer()).post(endpoint).set(auth(other.token)).send({ version: latest.version, messageId: latest.messages.at(-1).id, confirmed: true }).expect(404);
    await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send({ version: latest.version, messageId: first.messages.at(-1).id, confirmed: true }).expect(409);
    await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send({ version: first.version, messageId: latest.messages.at(-1).id, confirmed: true }).expect(409);
    const input = { version: latest.version, messageId: latest.messages.at(-1).id, confirmed: true };
    const confirmed = (await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send(input).expect(201)).body;
    const replay = (await request(app.getHttpServer()).post(endpoint).set(auth(owner.token)).send(input).expect(201)).body;
    expect(replay.id).toBe(confirmed.id); expect(replay.version).toBe(confirmed.version);
    expect(confirmed.title).toBe('修改后的事项');
    const saved = (await request(app.getHttpServer()).get(`/api/conversations/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(saved.status).toBe('USER_EVENT_CONFIRMED');
    expect(saved.messages.at(-1).structuredPayload.understanding).toEqual(latest.messages.at(-1).structuredPayload.understanding);
    expect(saved.planId).toBeNull();
  });
});
