import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { activatePlan, auth, bootP2App, register, type Session } from './p2-test-helpers';
import { ExecutionStateService } from '../src/execution/execution-state.service';
import { AuditService } from '../src/audit/audit.service';
const definition = { name: '持续关注合同', domain: 'general', automationLevel: 'L1', sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 10, sortOrder: 0 }],
  actions: [{ actionType: 'compare', config: {}, stepOrder: 0 }] };
describe.sequential('Agent Loop uses existing owned Plan/Runtime', { timeout: 90000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, worker: Awaited<ReturnType<typeof bootP2App>>['worker'];
  let planId: string, runId: string;
  beforeAll(async () => {
    const unique = randomUUID(); ({ app, pool, worker } = await bootP2App('loop-' + unique));
    owner = await register(app, unique + '@example.test', 'Loop owner'); other = await register(app, 'other-' + unique + '@example.test', 'Loop other');
    planId = (await request(app.getHttpServer()).post('/api/plans').set(auth(owner.token)).send(definition).expect(201)).body.id;
    await activatePlan(app, owner.token, planId);
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  const get = () => request(app.getHttpServer()).get(`/api/plans/${planId}/agent-loop`).set(auth(owner.token)).expect(200);
  it('enforces owner, bounded pagination and read-only access', async () => {
    await request(app.getHttpServer()).get(`/api/plans/${planId}/agent-loop`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).get('/api/agent/loops?limit=21').set(auth(owner.token)).expect(400);
    await request(app.getHttpServer()).get('/api/agent/loops?cursor=bad').set(auth(owner.token)).expect(400);
    const list = (await request(app.getHttpServer()).get('/api/agent/loops').set(auth(owner.token)).expect(200)).body;
    expect(list.items).toHaveLength(1); expect(list.items[0]).toMatchObject({ planId, state: 'WAITING', executionAuthorized: false });
    await request(app.getHttpServer()).post(`/api/plans/${planId}/agent-loop`).set(auth(owner.token)).send({ state: 'ACTING' }).expect(404);
  });
  it('does not label executor success as a verified real result or manufacture evidence on reads', async () => {
    const run = (await request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(owner.token)).send({ requestId: randomUUID(), triggerPayload: { amount: 20 } }).expect(201)).body;
    runId = run.id; await worker.processExecution(runId);
    const before = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM runtime_results WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    const view = (await get()).body;
    expect(view).toMatchObject({ state: 'VERIFYING', reflection: { recordedStatus: 'succeeded', outcome: 'UNVERIFIED', verifiedResultCount: 0 } });
    await get();
    const after = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM runtime_results WHERE user_id=UUID_TO_BIN(?)', [owner.userId]);
    expect(after[0][0].n).toBe(before[0][0].n);
  });
  it('preserves UNKNOWN execution history and pause semantics', async () => {
    const pending = (await request(app.getHttpServer()).post(`/api/plans/${planId}/executions`).set(auth(owner.token))
      .send({ requestId: randomUUID(), triggerPayload: { amount: 20 } }).expect(201)).body;
    await app.get(ExecutionStateService).transition(pending.id, 'failed', { errorCode: 'OUTCOME_UNKNOWN' });
    expect((await get()).body).toMatchObject({ state: 'RECONCILING', reflection: { recordedStatus: 'failed', outcome: 'UNKNOWN' } });
    await request(app.getHttpServer()).post(`/api/plans/${planId}/status`).set(auth(owner.token)).send({ status: 'paused' }).expect(201);
    expect((await get()).body).toMatchObject({ state: 'PAUSED', nextRunAt: null, reflection: { outcome: 'UNKNOWN' } });
  });
  it('keeps the applied version and reflection when a newer draft exists', async () => {
    const prior = (await get()).body;
    await request(app.getHttpServer()).post(`/api/plans/${planId}/versions`).set(auth(owner.token)).send({ ...definition, name: '未应用的新草稿' }).expect(201);
    expect((await get()).body).toMatchObject({ planVersionId: prior.planVersionId, title: definition.name, state: 'PAUSED', reflection: { outcome: 'UNKNOWN' } });
  });
  it('paginates current-version run history without leaking owners, new drafts or raw audit payloads', async () => {
    await request(app.getHttpServer()).get(`/api/plans/${planId}/agent-loop/history`).set(auth(other.token)).expect(404);
    const path=`/api/plans/${planId}/agent-loop/history?limit=1`;
    const first=(await request(app.getHttpServer()).get(path).set(auth(owner.token)).expect(200)).body;
    expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    expect(first.items[0]).toMatchObject({kind:'RUN',planVersionId:(await get()).body.planVersionId,state:'failed'});
    const next=(await request(app.getHttpServer()).get(path+'&cursor='+encodeURIComponent(first.nextCursor)).set(auth(owner.token)).expect(200)).body;
    expect(next.items[0].id).toBe(runId); expect(next.items[0]).not.toHaveProperty('inputSnapshotJson'); expect(next.nextCursor).toBeNull();
  });
  it('includes committed WAIT checkpoints and hides unrelated versions and audit content', async () => {
    const versionId=(await get()).body.planVersionId, audit=app.get(AuditService);
    await audit.append({actorType:'system',userId:owner.userId,action:'PERSISTENT_NOTIFICATION_RESOURCE_STATE',resourceType:'plan_version',resourceId:versionId,
      source:'system',result:'pending',after:{planVersionId:versionId,state:'WAITING_FACT_CHANGE',privateContent:'never return this'},changeSummary:'Isolated WAIT fixture'});
    await audit.append({actorType:'system',userId:owner.userId,action:'PERSISTENT_PLAN_RESULT_REEVALUATED',resourceType:'execution',resourceId:randomUUID(),correlationId:planId,
      source:'scheduler',result:'pending',after:{planVersionId:randomUUID(),state:'UNRELATED_VERSION'},changeSummary:'Isolated other version fixture'});
    const history=(await request(app.getHttpServer()).get(`/api/plans/${planId}/agent-loop/history?limit=20`).set(auth(owner.token)).expect(200)).body;
    expect(history.items).toHaveLength(3); expect(history.items.some((item:any)=>item.state==='WAITING_FACT_CHANGE')).toBe(true);
    expect(JSON.stringify(history)).not.toMatch(/UNRELATED_VERSION|privateContent|never return/);
  });
});
