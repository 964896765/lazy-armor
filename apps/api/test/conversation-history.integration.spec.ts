import type {INestApplication} from '@nestjs/common';
import type {Pool} from 'mysql2/promise';
import request from 'supertest';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {auth,bootP2App,register,type Session} from './p2-test-helpers';
describe.sequential('conversation history persistence',{timeout:90000},()=>{
 let app:INestApplication;let pool:Pool;let owner:Session;let other:Session;
 beforeAll(async()=>{const key=`history-${Date.now()}`;({app,pool}=await bootP2App(key));owner=await register(app,`${key}@example.com`,'Owner');other=await register(app,`${key}-other@example.com`,'Other');});
 afterAll(async()=>{await app?.close();await pool?.end();});
 const create=async(mode='TEMPORARY')=>(await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode}).expect(201)).body;
 const list=async()=>(await request(app.getHttpServer()).get('/api/conversations').set(auth(owner.token)).expect(200)).body;
 const update=(id:string,version:number,action:string,title?:string)=>request(app.getHttpServer()).post(`/api/conversations/${id}/history`).set(auth(owner.token)).send({version,action,...(title!==undefined?{title}:{})});
 const speak=async(c:any)=>(await request(app.getHttpServer()).post(`/api/conversations/${c.id}/messages`).set(auth(owner.token)).send({version:c.version,requestId:`msg-${c.id}`,content:'Remember my requirements'}).expect(201)).body;
 it('omits empty temporary and plan conversations, retaining saved requirements',async()=>{
  const temporary=await create();const plan=await create('PLAN');expect((await list()).map((c:any)=>c.id)).not.toContain(temporary.id);expect((await list()).map((c:any)=>c.id)).not.toContain(plan.id);
  await request(app.getHttpServer()).put(`/api/conversations/${plan.id}/draft-input`).set(auth(owner.token)).send({version:0,content:'My saved plan requirement'}).expect(200);expect((await list()).map((c:any)=>c.id)).toContain(plan.id);
  await speak(temporary);expect((await list()).map((c:any)=>c.id)).toContain(temporary.id);
 });
 it('persists pin and rename, rejects stale versions and cross-account writes',async()=>{
  const c=await speak(await create());await update(c.id,c.version,'PIN').expect(201);let history=await list();expect(history[0].id).toBe(c.id);expect(history[0].pinnedAt).toBeTruthy();
  await update(c.id,c.version,'RENAME','stale').expect(409);await request(app.getHttpServer()).post(`/api/conversations/${c.id}/history`).set(auth(other.token)).send({version:c.version+1,action:'DELETE'}).expect(404);
  await update(c.id,c.version+1,'RENAME','Renamed conversation').expect(201);expect((await list()).find((x:any)=>x.id===c.id).title).toBe('Renamed conversation');await update(c.id,c.version+2,'UNPIN').expect(201);await update(c.id,c.version+3,'ARCHIVE').expect(201);expect((await list()).map((x:any)=>x.id)).not.toContain(c.id);
 });
 it('promotes the same conversation into a draft without creating a Plan; deletion preserves a confirmed Plan',async()=>{
  const c=await speak(await create());const promoted=(await request(app.getHttpServer()).post(`/api/conversations/${c.id}/promote`).set(auth(owner.token)).send({version:c.version}).expect(201)).body;
  expect(promoted.id).toBe(c.id);expect(promoted.creationDraft).toBeTruthy();expect(promoted.planId).toBeNull();expect(promoted.creationDraft.goal.constraints.userInput).toBe('Remember my requirements');
  await update(promoted.id,promoted.version,'DELETE').expect(201);
  await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'PLAN',draftId:promoted.creationDraft.draftId}).expect(409);
  const planChat=await create('PLAN');const proposed=(await request(app.getHttpServer()).post(`/api/conversations/${planChat.id}/messages`).set(auth(owner.token)).send({version:0,requestId:'daily',content:'每天帮我总结重要事项'}).expect(201)).body;
  const confirmed=(await request(app.getHttpServer()).post(`/api/conversations/${planChat.id}/confirm-plan`).set(auth(owner.token)).send({version:proposed.version,confirmed:true}).expect(201)).body;
  const current=(await request(app.getHttpServer()).get(`/api/conversations/${planChat.id}`).set(auth(owner.token)).expect(200)).body;
  await update(current.id,current.version,'DELETE').expect(201);await request(app.getHttpServer()).get(`/api/plans/${confirmed.planId}`).set(auth(owner.token)).expect(200);await request(app.getHttpServer()).get(`/api/conversations/${current.id}`).set(auth(owner.token)).expect(404);await request(app.getHttpServer()).post(`/api/conversations/${current.id}/promote`).set(auth(owner.token)).send({version:current.version+1}).expect(404);expect((await list()).map((x:any)=>x.id)).not.toContain(current.id);
 });
});
