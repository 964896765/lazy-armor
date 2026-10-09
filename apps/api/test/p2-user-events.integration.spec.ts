import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { AgentModelOutput } from '../src/ai-adapter/agent-model-adapter';
import { AGENT_MODEL } from '../src/ai-adapter/agent-planner.service';
import { UserEventsService } from '../src/profiles/user-events.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P2 internal USER_EVENT authority', () => {
  let app: INestApplication, pool: Pool, user: Session, other: Session, events: UserEventsService;
  let event = { title: '去医院', dueAt: new Date(Date.now()+300_000).toISOString(), reminderAt: new Date(Date.now()+180_000).toISOString(), timezone: 'UTC' };
  const unique = `ue-${Date.now()}`;
  let externalSync: AgentModelOutput['externalSync'] = null;
  const model = { modelId: ()=>'fixture-user-event', capability:()=>({modelId:'fixture-user-event',supportsStructuredCompletion:true,supportsToolSelection:false,maxContextTokens:16000}), complete: async (): Promise<AgentModelOutput> => ({ result: 'USER_EVENT_DRAFT', externalSync, userEvent: event, intentSummary: event.title, explanation: '请确认一次性内部事项', domain: null, scenarioKey: null, scenarioRevision: null, strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null, missingRequirements: [], warnings: [], riskHints: [] }) };
  beforeAll(async () => {
    const boot = await bootP2App(unique, [{token:AGENT_MODEL,value:model}]);
    app=boot.app;pool=boot.pool;events=app.get(UserEventsService);
    user=await register(app,`${unique}@example.com`,'Personal item owner');other=await register(app,`${unique}-other@example.com`,'Other owner');
  });
  afterEach(()=>vi.useRealTimers());
  afterAll(async()=>{await pool?.end();await app?.close();});
  async function draft(content='未来时间提醒我去医院') {
    const conversation=(await request(app.getHttpServer()).post('/api/conversations').set(auth(user.token)).send({mode:'TEMPORARY'}).expect(201)).body;
    const result=(await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(user.token)).send({version:conversation.version,requestId:crypto.randomUUID(),content}).expect(201)).body;
    const message=result.messages.filter((m:{role:string})=>m.role==='assistant').at(-1);
    expect(message.structuredPayload).toMatchObject({result:'USER_EVENT_DRAFT',userEvent:event,validationErrors:[]});
    return {conversationId:conversation.id,messageId:message.id,version:result.version,confirmed:true};
  }
  async function create() { const d=await draft();const response=await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send({messageId:d.messageId,version:d.version,confirmed:true}).expect(201);return {d,row:response.body}; }
  it('creates only after confirmation, replays idempotently, isolates owner and projects USER_EVENT', async()=>{
    const d=await draft();
    await request(app.getHttpServer()).get(`/api/user-events/${d.messageId}`).set(auth(user.token)).expect(404);
    const payload={messageId:d.messageId,version:d.version,confirmed:true};
    await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(other.token)).send(payload).expect(404);
    const a=await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send(payload).expect(201);
    const b=await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send(payload).expect(201);
    expect(a.body).toEqual(b.body);expect(a.body).toMatchObject({kind:'USER_EVENT',version:1,status:'active'});
    await request(app.getHttpServer()).get(`/api/user-events/${d.messageId}`).set(auth(other.token)).expect(404);
    await request(app.getHttpServer()).post(`/api/user-events/${d.messageId}/lifecycle`).set(auth(other.token)).send({version:1,action:'CANCEL'}).expect(404);
    const timeline=(await request(app.getHttpServer()).get(`/api/timeline?date=${event.dueAt.slice(0,10)}&timezone=UTC`).set(auth(user.token)).expect(200)).body;
    expect(timeline.find((r:{id:string})=>r.id===`user-event:${d.messageId}`)).toMatchObject({kind:'USER_EVENT',sourceRef:{type:'UserEvent',id:d.messageId},statusGroup:'INCOMPLETE'});
    await request(app.getHttpServer()).post(`/api/user-events/${d.messageId}/lifecycle`).set(auth(user.token)).send({version:1,action:'CANCEL'}).expect(201);
  });
  it('confirms an immutable sync intent without execution authorization or any client Runtime identity', async()=>{
    externalSync={kind:'EXTERNAL_CALENDAR_SYNC',policy:'CONFIRM_CHANGES',destination:'PHONE_CALENDAR',durationMinutes:30};
    try {
      const d=await draft('未来时间提醒我去医院，同时加到手机日历，持续30分钟');
      const payload={messageId:d.messageId,version:d.version,confirmed:true};
      await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send({...payload,authoritySource:{kind:'USER_EVENT_SYNC'}}).expect(400);
      const a=(await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send(payload).expect(201)).body;
      expect(a.externalSync).toMatchObject({status:'CONFIRMED',confirmedVersion:1,executionAuthorized:false});
      await events.change(user.userId,a.id,{version:1,action:'EDIT',event:{...event,title:'用户后续编辑'}});
      const b=(await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send(payload).expect(201)).body;
      expect(b.externalSync).toEqual(a.externalSync);
      const [rows]=await pool.query<RowDataPacket[]>('SELECT contract_json contract FROM user_event_sync_requests WHERE id=UUID_TO_BIN(?)',[a.externalSync.requestId]);
      expect(rows[0].contract.userEvent.title).toBe(event.title);expect(rows[0].contract.userEventVersion).toBe(1);
      const [runs]=await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM executions WHERE user_id=UUID_TO_BIN(?)',[user.userId]);expect(Number(runs[0].n)).toBe(0);
      await events.change(user.userId,a.id,{version:2,action:'CANCEL'});
    } finally { externalSync=null; }
  });
  it('edits and postpones with version fencing; completed items cannot be reopened', async()=>{
    const {row}=await create();
    const edited={...event,title:'去医院复查',dueAt:new Date(Date.parse(event.dueAt)+60_000).toISOString()};
    const a=await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:1,action:'EDIT',event:edited}).expect(201);expect(a.body.version).toBe(2);
    await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:1,action:'CANCEL'}).expect(409);
    const moved={...edited,dueAt:new Date(Date.parse(edited.dueAt)+900_000).toISOString(),reminderAt:new Date(Date.parse(edited.reminderAt)+900_000).toISOString()};
    await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:2,action:'POSTPONE',event:moved}).expect(201);
    const completed=await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:3,action:'COMPLETE'}).expect(201);expect(completed.body.status).toBe('completed');
    await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:4,action:'EDIT',event:moved}).expect(409);
  });
  it('delivers due reminders transactionally once across concurrent worker polls, with zero external execution', async()=>{
    const {row}=await create();
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.parse(event.reminderAt)+1000));
    const delivered=await Promise.all([events.deliverDue(),events.deliverDue()]);expect(delivered.reduce((a,b)=>a+b,0)).toBeGreaterThanOrEqual(1); // Other isolated fixture owners may also have due reminders.
    expect(await events.deliverDue()).toBe(0);
    const [rows]=await pool.query<RowDataPacket[]>('SELECT * FROM notifications WHERE user_id=UUID_TO_BIN(?) AND dedupe_key=?',[user.userId,`user-event:${row.id}:1`]);expect(rows.length).toBe(1);
    expect((await events.get(user.userId,row.id)).remindedAt).not.toBeNull();
    for(const table of ['capability_invocations','executions']) {const [count]=await pool.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM ${table} WHERE user_id=UUID_TO_BIN(?)`,[user.userId]);expect(Number(count[0].total)).toBe(0);}
    await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:1,action:'COMPLETE'}).expect(201);
  });
  it('cancellation before due prevents delivery; expired confirmations fail closed', async()=>{
    const {row}=await create();
    await request(app.getHttpServer()).post(`/api/user-events/${row.id}/lifecycle`).set(auth(user.token)).send({version:1,action:'CANCEL'}).expect(201);
    const d=await draft();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.parse(event.reminderAt)+1000));
    await request(app.getHttpServer()).post(`/api/conversations/${d.conversationId}/confirm-user-event`).set(auth(user.token)).send({messageId:d.messageId,version:d.version,confirmed:true}).expect(400);
    expect(await events.deliverDue()).toBe(0);
    const [rows]=await pool.query<RowDataPacket[]>('SELECT * FROM notifications WHERE dedupe_key=?',[`user-event:${row.id}:1`]);expect(rows.length).toBe(0);
    await request(app.getHttpServer()).get(`/api/user-events/${d.messageId}`).set(auth(user.token)).expect(404);
  });
});
