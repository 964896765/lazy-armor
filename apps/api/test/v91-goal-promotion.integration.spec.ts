import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { FixtureAgentModel } from '../src/ai-adapter/agent-model-adapter';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';

/** A temporary checked proposal can enter the original Plan confirmation without losing its requirements. */
describe.sequential('V91 temporary goal promotion compatibility', { timeout: 90_000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, jobs: AuthoringJobsService;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Only an isolated *_test DB may run promotion tests');
    const unique = `v91-promote-${Date.now()}`;
    ({ app, pool } = await bootP2App(unique, [{ token: AGENT_MODEL, value: new FixtureAgentModel() }]));
    owner = await register(app, `${unique}@example.com`, 'Promotion owner');
    other = await register(app, `${unique}-other@example.com`, 'Other owner');
    jobs = app.get(AuthoringJobsService);
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function proposal() {
    const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token))
      .send({ mode: 'TEMPORARY', title: '临时目标' }).expect(201)).body;
    const accepted = (await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token))
      .send({ content: '每天帮我总结重要事项', requestId: `${conversation.id}-message`, version: 0, authoringMode: 'DURABLE' }).expect(201)).body;
    await jobs.process(accepted.authoringJobs.at(-1).jobId);
    const drafted = (await request(app.getHttpServer()).get(`/api/conversations/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
    expect(drafted.messages.at(-1).structuredPayload.result).toBe('PLAN_DRAFT');
    return drafted;
  }
  it('promotes the exact sources with a new context version and freezes one owner-only Plan brief', async () => {
    const drafted = await proposal(), initialBrief = drafted.messages.at(-1).structuredPayload.goalBrief;
    await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/promote`).set(auth(other.token)).send({ version: drafted.version }).expect(404);
    await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/promote`).set(auth(owner.token)).send({ version: drafted.version - 1 }).expect(409);
    const promoted = (await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/promote`).set(auth(owner.token)).send({ version: drafted.version }).expect(201)).body;
    expect(promoted.mode).toBe('PLAN'); expect(promoted.version).toBe(drafted.version + 1);
    expect(promoted.creationDraft.goalBrief).toEqual({ ...initialBrief, version: promoted.version });
    expect(promoted.messages.at(-1).structuredPayload.goalBrief).toEqual(promoted.creationDraft.goalBrief);
    const confirmed = (await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/confirm-plan`).set(auth(owner.token))
      .send({ version: promoted.version, confirmed: true }).expect(201)).body;
    const [briefs] = await pool.query<RowDataPacket[]>('SELECT goal_brief_json brief, LOWER(BIN_TO_UUID(user_id)) owner FROM plan_goal_briefs WHERE plan_id=UUID_TO_BIN(?)', [confirmed.planId]);
    expect(briefs).toHaveLength(1); expect(briefs[0].owner).toBe(owner.userId);
    const frozen = typeof briefs[0].brief === 'string' ? JSON.parse(briefs[0].brief) : briefs[0].brief;
    expect(frozen).toEqual(promoted.creationDraft.goalBrief);
    await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/confirm-plan`).set(auth(owner.token))
      .send({ version: promoted.version, confirmed: true }).expect(201);
    const [runs] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM executions WHERE plan_id=UUID_TO_BIN(?)', [confirmed.planId]);
    expect(runs[0].count).toBe(0);
  });
  it('keeps historical proposals without GoalBrief eligible for the legacy confirmation contract', async () => {
    const drafted = await proposal(), messageId = drafted.messages.at(-1).id;
    await pool.query("UPDATE consumer_messages SET structured_payload=JSON_REMOVE(structured_payload,'$.goalBrief') WHERE id=UUID_TO_BIN(?)", [messageId]);
    const promoted = (await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/promote`).set(auth(owner.token)).send({ version: drafted.version }).expect(201)).body;
    expect(promoted.creationDraft.goalBrief).toBeNull();
    const confirmed = (await request(app.getHttpServer()).post(`/api/conversations/${drafted.id}/confirm-plan`).set(auth(owner.token))
      .send({ version: promoted.version, confirmed: true }).expect(201)).body;
    const [briefs] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM plan_goal_briefs WHERE plan_id=UUID_TO_BIN(?)', [confirmed.planId]);
    expect(briefs[0].count).toBe(0);
  });
  it('rejects stale brief metadata atomically and disallows promotion after archive', async () => {
    const stale = await proposal();
    await pool.query("UPDATE consumer_messages SET structured_payload=JSON_SET(structured_payload,'$.goalBrief.version',999) WHERE id=UUID_TO_BIN(?)", [stale.messages.at(-1).id]);
    await request(app.getHttpServer()).post(`/api/conversations/${stale.id}/promote`).set(auth(owner.token)).send({ version: stale.version }).expect(409);
    const unchanged = (await request(app.getHttpServer()).get(`/api/conversations/${stale.id}`).set(auth(owner.token)).expect(200)).body;
    expect(unchanged.mode).toBe('TEMPORARY'); expect(unchanged.version).toBe(stale.version); expect(unchanged.draftId).toBeNull();
    const archived = await proposal();
    await pool.query('UPDATE consumer_conversations SET archived_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)', [archived.id]);
    await request(app.getHttpServer()).post(`/api/conversations/${archived.id}/promote`).set(auth(owner.token)).send({ version: archived.version }).expect(409);
  });
});
