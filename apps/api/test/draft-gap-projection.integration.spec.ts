import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_DEFINITIONS } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('unified creation entrances and truthful draft gaps', {timeout:120000},()=>{
 let app:INestApplication;let pool:Pool;let owner:Session;let other:Session;
 beforeAll(async()=>{const boot=await bootP2App(`draft-gaps-${Date.now()}`);app=boot.app;pool=boot.pool;owner=await register(app,`draft-gap-${Date.now()}@example.com`,'Owner');other=await register(app,`draft-gap-other-${Date.now()}@example.com`,'Other');});
 afterAll(async()=>{await app?.close();await pool?.end();});
 it('binds plan + and every published template + to an owned resumable CreationDraft',async()=>{
  const templates=await request(app.getHttpServer()).get('/api/templates').set(auth(owner.token)).expect(200);
  for(const input of [{mode:'PLAN'},...templates.body.map((template:{key:string})=>({mode:'PLAN',templateKey:template.key}))]){
   const created=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send(input).expect(201);
   expect(created.body.creationDraft.conversationId).toBe(created.body.id);
   const restored=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'PLAN',draftId:created.body.creationDraft.draftId}).expect(201);
   expect(restored.body.id).toBe(created.body.id);expect(restored.body.templateKey??null).toBe(input.templateKey??null);
   const gaps=await request(app.getHttpServer()).get(`/api/creation-drafts/${created.body.creationDraft.draftId}/gaps`).set(auth(owner.token)).expect(200);
   expect(gaps.body.state).toBe('NEEDS_SCENARIO');expect(gaps.body.reasons).toContain('SCENARIO_NOT_RESOLVED');
   await request(app.getHttpServer()).get(`/api/creation-drafts/${created.body.creationDraft.draftId}/gaps`).set(auth(other.token)).expect(404);
  }
 });
 it('projects every registered scenario without inventing ready resources or executable services',async()=>{
  for(const scenario of SCENARIO_DEFINITIONS){
   const created=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'PLAN',scenarioKey:scenario.key}).expect(201);
   const gaps=await request(app.getHttpServer()).get(`/api/creation-drafts/${created.body.creationDraft.draftId}/gaps`).set(auth(owner.token)).expect(200);
   expect(gaps.body.draftVersion).toBe(created.body.creationDraft.version);expect(gaps.body.subjectRequired).toBe(true);
   expect(gaps.body.reasons).toContain('SUBJECT_NOT_SELECTED');
   for(const option of gaps.body.serviceOptions)expect(option.satisfiesCapability).toBe(false);
  }
 });
 it('retains the actual temporary requirement when promoted, without reusing its execution proposal',async()=>{
  const created=await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'TEMPORARY'}).expect(201);
  const sent=await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/messages`).set(auth(owner.token)).send({version:0,requestId:'requirement',content:'以后每周整理一次我的补给需求'}).expect(201);
  const promoted=await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/promote`).set(auth(owner.token)).send({version:sent.body.version}).expect(201);
  expect(promoted.body.creationDraft.goal.constraints.userInput).toBe('以后每周整理一次我的补给需求');expect(promoted.body.id).toBe(created.body.id);
 });
});
