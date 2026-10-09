import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { AgentPlannerService } from '../src/ai-adapter/agent-planner.service';
import sharp from 'sharp';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('consumer surface ownership and security', { timeout: 90000 }, () => {
 let app: INestApplication; let pool: Pool; let owner: Session; let other: Session;
 beforeAll(async () => {
  const unique = `consumer-${Date.now()}`; const boot = await bootP2App(unique); app = boot.app; pool = boot.pool;
  owner = await register(app, `${unique}@example.com`, 'Consumer Owner'); other = await register(app, `${unique}-other@example.com`, 'Other Consumer');
 });
 afterAll(async () => { await app?.close(); await pool?.end(); });
 it('returns an unconfigured masked AI state and rejects HTTP secret submission', async () => {
  const config = await request(app.getHttpServer()).get('/api/ai-service').set(auth(owner.token)).expect(200);
  expect(config.body.configured).toBe(false); expect(config.body.apiKey).toBeUndefined();
  await request(app.getHttpServer()).put('/api/ai-service').set(auth(owner.token)).send({ model: 'deepseek-flash', thinkingMode: 'AUTO', apiKey: 'test-secret-do-not-store' }).expect(400);
 });
 it('persists conversations and preserves their context when promoted', async () => {
  const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', title: '长期需求' }).expect(201);
  await request(app.getHttpServer()).get(`/api/conversations/${created.body.id}`).set(auth(other.token)).expect(404);
  const promoted = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/promote`).set(auth(owner.token)).send({ version: 0 }).expect(201);
  expect(promoted.body.id).toBe(created.body.id); expect(promoted.body.mode).toBe('PLAN'); expect(promoted.body.version).toBe(1);
  await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/confirm-plan`).set(auth(owner.token)).send({ version: 1, confirmed: true }).expect(400);
 });
 it('lists owned archived conversations, excludes active and deleted records', async () => {
  const create=async()=> (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'TEMPORARY',title:'归档验证'}).expect(201)).body;
  const archived=await create(); const active=await create(); const deleted=await create();
  await request(app.getHttpServer()).post(`/api/conversations/${archived.id}/history`).set(auth(owner.token)).send({version:0,action:'ARCHIVE'}).expect(201);
  await request(app.getHttpServer()).post(`/api/conversations/${deleted.id}/history`).set(auth(owner.token)).send({version:0,action:'ARCHIVE'}).expect(201);
  await request(app.getHttpServer()).post(`/api/conversations/${deleted.id}/history`).set(auth(owner.token)).send({version:1,action:'DELETE'}).expect(201);
  const rows=(await request(app.getHttpServer()).get('/api/conversations/archived').set(auth(owner.token)).expect(200)).body;
  expect(rows.map((row:{id:string})=>row.id)).toContain(archived.id);
  expect(rows.map((row:{id:string})=>row.id)).not.toContain(active.id);
  expect(rows.map((row:{id:string})=>row.id)).not.toContain(deleted.id);
  expect((await request(app.getHttpServer()).get('/api/conversations/archived').set(auth(other.token)).expect(200)).body).toEqual([]);
  await request(app.getHttpServer()).get(`/api/conversations/${archived.id}`).set(auth(owner.token)).expect(200);
 });
 it('isolates same-scenario conversation drafts and saves requirements without AI credentials', async () => {
  const create = () => request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN', scenarioKey: 'daily_life.delivery' }).expect(201);
  const first = (await create()).body; const second = (await create()).body;
  expect(first.creationDraft.draftId).not.toBe(second.creationDraft.draftId);
  const saved = await request(app.getHttpServer()).put(`/api/conversations/${first.id}/draft-input`).set(auth(owner.token)).send({ version: 0, content: '保存我的物流提醒需求' }).expect(200);
  expect(saved.body.creationDraft.goal.constraints.userInput).toBe('保存我的物流提醒需求');
  expect(saved.body.messages).toEqual([]);
  await request(app.getHttpServer()).put(`/api/conversations/${first.id}/draft-input`).set(auth(owner.token)).send({ version: 0, content: '旧版本写入' }).expect(409);
  await request(app.getHttpServer()).put(`/api/conversations/${first.id}/draft-input`).set(auth(other.token)).send({ version: 1, content: '越权写入' }).expect(404);
  const untouched = await request(app.getHttpServer()).get(`/api/conversations/${second.id}`).set(auth(owner.token)).expect(200);
  expect(untouched.body.creationDraft.goal.constraints.userInput).toBeUndefined();
  const resumed = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN', draftId: first.creationDraft.draftId }).expect(201);
  expect(resumed.body.id).toBe(first.id);
  expect(resumed.body.creationDraft.goal.constraints.userInput).toBe('保存我的物流提醒需求');
 });
 it('does not revive an expired draft through requirement saving or resume', async () => {
  const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN' }).expect(201);
  await pool.query('UPDATE creation_drafts SET expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY) WHERE draft_id=UUID_TO_BIN(?)', [created.body.creationDraft.draftId]);
  await request(app.getHttpServer()).put(`/api/conversations/${created.body.id}/draft-input`).set(auth(owner.token)).send({ version: 0, content: '过期后写入' }).expect(409);
  await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN', draftId: created.body.creationDraft.draftId }).expect(409);
  const actual = await request(app.getHttpServer()).get(`/api/conversations/${created.body.id}`).set(auth(owner.token)).expect(200);
  expect(actual.body.version).toBe(0);
 });
 it('allows a validated proposal with resource gaps to become an inactive Plan draft', async () => {
  const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'PLAN'}).expect(201);
  const proposed = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/messages`).set(auth(owner.token)).send({version:0,requestId:'resource-gap-draft',content:'每天帮我总结重要事项'}).expect(201);
  expect(proposed.body.messages.at(-1).structuredPayload.result).toBe('PLAN_DRAFT');
  await pool.query("UPDATE consumer_messages SET structured_payload=JSON_SET(structured_payload,'$.proposal.missingRequirements',JSON_ARRAY('需要连接账单来源')) WHERE id=UUID_TO_BIN(?)",[proposed.body.messages.at(-1).id]);
  const confirmed = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/confirm-plan`).set(auth(owner.token)).send({version:proposed.body.version,confirmed:true}).expect(201);
  const plan = await request(app.getHttpServer()).get(`/api/plans/${confirmed.body.planId}`).set(auth(owner.token)).expect(200);
  expect(plan.body.status).toBe('draft');expect(plan.body.activeVersionId).toBeNull();
 });
 it('rolls back calendar Plan confirmation when the CreationDraft has no valid frozen demand contract', async () => {
  // Isolated malformed model-output contract; never real Plan acceptance evidence.
  const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({mode:'PLAN'}).expect(201);
  const proposed = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/messages`).set(auth(owner.token)).send({version:0,requestId:'missing-calendar-contract',content:'每天帮我总结重要事项'}).expect(201);
  const definition={name:'Isolated missing Calendar contract',domain:'general',automationLevel:'L2',approvalPolicy:{type:'always'},sources:[{sourceType:'manual',config:{},sortOrder:0}],triggers:[{triggerType:'schedule',config:{cronExpression:'0 9 * * *',timezone:'Asia/Shanghai'},sortOrder:0}],conditions:[],actions:[{actionType:'publish',requiredCapability:'calendar.event.create',config:{visibility:'private',calendarEvent:{calendarId:'1',title:'Isolated contract only',start:{dateTime:'2026-10-08T09:00:00+08:00',timeZone:'Asia/Shanghai'},end:{dateTime:'2026-10-08T09:10:00+08:00',timeZone:'Asia/Shanghai'},attendees:[],sendUpdates:'none'}},stepOrder:0}]};
  await pool.query("UPDATE consumer_messages SET structured_payload=JSON_SET(structured_payload,'$.proposal.draftDefinition',CAST(? AS JSON)) WHERE id=UUID_TO_BIN(?)",[JSON.stringify(definition),proposed.body.messages.at(-1).id]);
  const [before]=await pool.query<any[]>("SELECT COUNT(*) n FROM plans WHERE user_id=UUID_TO_BIN(?)",[owner.userId]);
  await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/confirm-plan`).set(auth(owner.token)).send({version:proposed.body.version,confirmed:true}).expect(409);
  const current=(await request(app.getHttpServer()).get(`/api/conversations/${created.body.id}`).set(auth(owner.token)).expect(200)).body;
  expect(current.planId).toBeNull();expect(current.status).toBe('ACTIVE');
  const [rows]=await pool.query<any[]>("SELECT COUNT(*) n FROM plans WHERE user_id=UUID_TO_BIN(?)",[owner.userId]);
  expect(rows[0].n).toBe(before[0].n);
 });
 it('stores concrete external references under the owning user', async () => {
  const created = await request(app.getHttpServer()).post('/api/external-services').set(auth(owner.token)).send({ title: '具体服务', summary: '预约服务', sourceUrl: 'https://example.com/service/123', sourcePlatform: 'example.com', category: '生活', importMethod: 'MANUAL' }).expect(201);
  const others = await request(app.getHttpServer()).get('/api/external-services').set(auth(other.token)).expect(200); expect(others.body).toEqual([]);
  const detail = await request(app.getHttpServer()).get(`/api/external-services/${created.body.id}`).set(auth(owner.token)).expect(200);
  expect(detail.body.availability).toBe('NOT_VERIFIED');
  expect(detail.body.primaryAction.url).toBe('https://example.com/service/123');
  await request(app.getHttpServer()).get(`/api/external-services/${created.body.id}`).set(auth(other.token)).expect(404);
  await request(app.getHttpServer()).post('/api/conversations').set(auth(other.token)).send({ mode: 'PLAN', externalServiceId: created.body.id }).expect(404);
  const conversation = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN', externalServiceId: created.body.id }).expect(201);
  const plannerSpy = vi.spyOn(app.get(AgentPlannerService), 'plan');
  await request(app.getHttpServer()).post(`/api/conversations/${conversation.body.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'with-reference', content: '帮我分析服务所需步骤' }).expect(201);
  expect(plannerSpy.mock.calls.at(-1)?.[1]).toBe('帮我分析服务所需步骤');
  const source = plannerSpy.mock.calls.at(-1)?.[2]?.contextSources?.find(item => item.label === `external_service:${created.body.id}`);
  expect(JSON.parse(source!.content).availability).toBe('NOT_VERIFIED'); plannerSpy.mockRestore();
  await request(app.getHttpServer()).delete(`/api/external-services/${created.body.id}`).set(auth(other.token)).expect(404);
  await request(app.getHttpServer()).delete(`/api/external-services/${created.body.id}`).set(auth(owner.token)).expect(200);
  const unavailable = await request(app.getHttpServer()).post(`/api/conversations/${conversation.body.id}/messages`).set(auth(owner.token)).send({ version: 1, requestId: 'deleted-reference', content: '继续' }).expect(201);
  expect(unavailable.body.messages.at(-1).structuredPayload.result).toBe('CONTEXT_UNAVAILABLE');
 });
 it('creates and amends drafts through Plan authority without activation, and rejects stale proposals', async () => {
  async function propose(planId?: string) {
   const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'PLAN', ...(planId ? { planId } : {}) }).expect(201);
   const proposed = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: `proposal-${created.body.id}`, content: '每天帮我总结重要事项' }).expect(201);
   expect(proposed.body.messages.at(-1).structuredPayload.result).toBe('PLAN_DRAFT');
   return proposed.body;
  }
  const conversation = await propose();
  const confirmed = await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/confirm-plan`).set(auth(owner.token)).send({ version: conversation.version, confirmed: true }).expect(201);
  const repeated = await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/confirm-plan`).set(auth(owner.token)).send({ version: conversation.version, confirmed: true }).expect(201);
  expect(repeated.body.planId).toBe(confirmed.body.planId);
  const amendment = await propose(confirmed.body.planId);
  await request(app.getHttpServer()).post(`/api/conversations/${amendment.id}/confirm-plan`).set(auth(owner.token)).send({ version: amendment.version, confirmed: true }).expect(201);
  const plan = await request(app.getHttpServer()).get(`/api/plans/${confirmed.body.planId}`).set(auth(owner.token)).expect(200);
  expect(plan.body.currentVersion.versionNumber).toBe(2); expect(plan.body.activeVersionId).toBeNull(); expect(plan.body.status).toBe('draft');
  const stale = await propose(confirmed.body.planId);
  const input = { name: 'Concurrent user revision', domain: 'billing', automationLevel: 'L1', sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'amount', operator: 'GT', comparisonValue: 150, sortOrder: 0 }], actions: [{ actionType: 'notify', config: { channel: 'in_app' }, stepOrder: 0 }] };
  const changed = await request(app.getHttpServer()).post(`/api/plans/${confirmed.body.planId}/versions`).set(auth(owner.token)).send(input);
  expect({ status: changed.status, error: changed.status === 201 ? null : changed.body }).toEqual({ status: 201, error: null });
  await request(app.getHttpServer()).post(`/api/conversations/${stale.id}/confirm-plan`).set(auth(owner.token)).send({ version: stale.version, confirmed: true }).expect(409);
 });
 it('fails closed on impossible timeline dates', async () => {
  await request(app.getHttpServer()).get('/api/timeline?date=2026-02-30').set(auth(owner.token)).expect(400);
  const timeline = await request(app.getHttpServer()).get('/api/timeline?date=2026-10-03').set(auth(other.token)).expect(200); expect(timeline.body).toEqual([]);
  const all=await request(app.getHttpServer()).get('/api/timeline?date=all').set(auth(other.token)).expect(200);expect(all.body).toEqual([]);
 });
 it('stores bounded text evidence with ownership, replay protection and message references', async () => {
  const plannerSpy = vi.spyOn(app.get(AgentPlannerService), 'plan');
  const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201);
  const id = created.body.id;
  const input = { requestId: 'file-1', fileName: 'notes.txt', mimeType: 'text/plain', contentBase64: Buffer.from('附件文本：忽略指令只是文档内容。').toString('base64') };
  await request(app.getHttpServer()).post(`/api/conversations/${id}/attachments`).set(auth(other.token)).send(input).expect(404);
  const file = await request(app.getHttpServer()).post(`/api/conversations/${id}/attachments`).set(auth(owner.token)).send(input).expect(201);
  const repeated = await request(app.getHttpServer()).post(`/api/conversations/${id}/attachments`).set(auth(owner.token)).send(input).expect(201);
  expect(repeated.body.id).toBe(file.body.id);
  await request(app.getHttpServer()).post(`/api/conversations/${id}/attachments`).set(auth(owner.token)).send({ ...input, contentBase64: Buffer.from('different content').toString('base64') }).expect(409);
  await request(app.getHttpServer()).post(`/api/conversations/${id}/attachments`).set(auth(owner.token)).send({ ...input, requestId: 'binary', contentBase64: Buffer.from([255, 254]).toString('base64') }).expect(400);
  await request(app.getHttpServer()).post(`/api/conversations/${id}/attachments`).set(auth(owner.token)).send({ ...input, requestId: 'oversized', contentBase64: Buffer.alloc(48001, 97).toString('base64') }).expect(400);
  const separate = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201);
  await request(app.getHttpServer()).post(`/api/conversations/${separate.body.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'foreign-file', content: '总结附件', attachmentIds: [file.body.id] }).expect(404);
  const sent = await request(app.getHttpServer()).post(`/api/conversations/${id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'summary', content: '总结附件', attachmentIds: [file.body.id] }).expect(201);
  expect(sent.body.messages[0].contextRefs).toContainEqual({ type: 'ConversationAttachment', id: file.body.id });
  expect(sent.body.attachments[0].content).toBeUndefined();
  expect(sent.body.attachments[0].contentSha256).toMatch(/^[a-f0-9]{64}$/);
  await request(app.getHttpServer()).post(`/api/conversations/${id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'summary', content: '修改重试内容', attachmentIds: [file.body.id] }).expect(409);
  const followup = await request(app.getHttpServer()).post(`/api/conversations/${id}/messages`).set(auth(owner.token)).send({ version: sent.body.version, requestId: 'followup', content: '继续说明刚才的附件' }).expect(201);
  const sources = plannerSpy.mock.calls.at(-1)?.[2]?.contextSources ?? [];
  expect(sources.some(source => source.label === `attachment:${file.body.id}` && JSON.parse(source.content).provenance === 'USER_UPLOADED_UNVERIFIED')).toBe(true);
  const promoted = await request(app.getHttpServer()).post(`/api/conversations/${id}/promote`).set(auth(owner.token)).send({ version: followup.body.version }).expect(201);
  expect(promoted.body.attachments[0].id).toBe(file.body.id);
  plannerSpy.mockRestore();
 });
 it('adds an interface through the existing authority and gates reads on owner consent', async () => {
  const adapter = app.get(ConnectorRegistry).get('public_http_json');
  const fixture = vi.spyOn(adapter, 'read').mockResolvedValue({ ok: true, data: { value: { fixture: true }, retrievedAt: new Date().toISOString(), verification: 'SOURCE_RESPONSE_ONLY' } });
  try {
   const input = { connectorId: 'public_http_json', externalAccountName: 'Isolated public interface', credentials: { endpoint: 'https://example.com/data.json' } };
   await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ ...input, credentials: { endpoint: 'http://127.0.0.1/data' } }).expect(400);
   await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send({ ...input, credentials: { endpoint: input.credentials.endpoint, apiKey: 'not-supported' } }).expect(400);
   const added = await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token)).send(input).expect(201);
   const id = added.body.id; expect(added.body.status).toBe('connected'); expect(added.body.credentials).toBeUndefined();
   const readInput = { capability: 'READ_PUBLIC_HTTP_JSON', requestId: 'fixture-read', input: {} };
   await request(app.getHttpServer()).post(`/api/connections/${id}/invoke`).set(auth(owner.token)).send(readInput).expect(403);
   await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set(auth(other.token)).send({ permissions: [{ capability: readInput.capability, granted: true }] }).expect(404);
   await request(app.getHttpServer()).put(`/api/connections/${id}/permissions`).set(auth(owner.token)).send({ permissions: [{ capability: readInput.capability, granted: true }] }).expect(200);
   const result = await request(app.getHttpServer()).post(`/api/connections/${id}/invoke`).set(auth(owner.token)).send(readInput).expect(201);
   expect(result.body.verification).toBe('SOURCE_RESPONSE_ONLY');
   const resources = await request(app.getHttpServer()).get('/api/consumer/resources').set(auth(owner.token)).expect(200);
   expect(resources.body).toContainEqual(expect.objectContaining({ resourceId: `connection:${id}`, kind: 'INTERFACE' }));
   await request(app.getHttpServer()).delete(`/api/connections/${id}`).set(auth(owner.token)).expect(204);
   await request(app.getHttpServer()).post(`/api/connections/${id}/invoke`).set(auth(owner.token)).send(readInput).expect(403);
  } finally { fixture.mockRestore(); }
 });
 it('projects analysis results without claiming external execution and keeps them after promotion', async () => {
  const fixture = vi.spyOn(app.get(AgentPlannerService), 'plan').mockResolvedValue({ proposalId: 'analysis-fixture', result: 'ANSWER', answer: { explanation: 'An analysis answer; no external operation was performed.' }, validationErrors: [], warnings: [] });
  try {
   const created = await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY' }).expect(201);
   const sent = await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/messages`).set(auth(owner.token)).send({ version: 0, requestId: 'analysis-result', content: '分析这份信息' }).expect(201);
   const message = sent.body.messages.find((item: { role: string }) => item.role === 'user');
   const date = message.createdAt.slice(0, 10);
   async function timeline(token: string) { return (await request(app.getHttpServer()).get(`/api/timeline?date=${date}&timezone=UTC`).set(auth(token)).expect(200)).body; }
   expect(await timeline(owner.token)).toContainEqual(expect.objectContaining({ id: `temporary-task:${message.id}`, kind: 'TEMPORARY_TASK', status: '已生成答复', sourceRef: { type: 'ConversationMessage', id: message.id } }));
   expect((await timeline(other.token)).some((item: { id: string }) => item.id === `temporary-task:${message.id}`)).toBe(false);
   await request(app.getHttpServer()).post(`/api/conversations/${created.body.id}/promote`).set(auth(owner.token)).send({ version: sent.body.version }).expect(201);
   expect(await timeline(owner.token)).toContainEqual(expect.objectContaining({ id: `temporary-task:${message.id}`, status: '已生成答复' }));
  } finally { fixture.mockRestore(); }
 });
 it('publishes a user-confirmed real catalog record and closes a customer request into the timeline', async () => {
  const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#407bff' } }).withExif({ IFD0: { Artist: 'private-test-metadata' } }).png().toBuffer();
  const uploadInput = { requestId: 'isolated-service-image', contentBase64: picture.toString('base64') };
  const uploaded = await request(app.getHttpServer()).post('/api/service-media').set(auth(owner.token)).send(uploadInput).expect(201);
  const duplicate = await request(app.getHttpServer()).post('/api/service-media').set(auth(owner.token)).send(uploadInput).expect(201); expect(duplicate.body.id).toBe(uploaded.body.id);
  await request(app.getHttpServer()).post('/api/service-media').set(auth(owner.token)).send({ requestId: 'not-an-image', contentBase64: Buffer.from('<svg></svg>').toString('base64') }).expect(400);
  await request(app.getHttpServer()).get(`/api/service-media/${uploaded.body.id}`).expect(404);
  const offeringInput = { requestId: `publish-${Date.now()}`, title: 'Test-owned service', summary: 'Isolated integration service', domain: 'life', deliveryMode: 'LOCAL', serviceArea: 'Test service area', contact: 'Test contact', priceMinor: 12000, imageMediaId: uploaded.body.id, confirmed: false };
  await request(app.getHttpServer()).post('/api/service-offerings').set(auth(other.token)).send({ ...offeringInput, confirmed: true }).expect(400);
  await request(app.getHttpServer()).post('/api/service-offerings').set(auth(owner.token)).send(offeringInput).expect(400);
  const published = await request(app.getHttpServer()).post('/api/service-offerings').set(auth(owner.token)).send({ ...offeringInput, confirmed: true }).expect(201);
  expect(published.body.provider.verified).toBe(false); expect(published.body.useCount).toBe(0); expect(published.body.ratingBasisPoints).toBeNull();
  expect(published.body.imageUrl).toBe(`/api/service-media/${uploaded.body.id}`);
  const serviceConversation = await request(app.getHttpServer()).post('/api/conversations').set(auth(other.token)).send({ mode: 'PLAN', serviceOfferingId: published.body.id }).expect(201);
  expect(serviceConversation.body.contextRefs).toContainEqual({ type: 'ServiceOffering', id: published.body.id });
  const image = await request(app.getHttpServer()).get(published.body.imageUrl).expect(200);
  expect(image.headers['content-type']).toMatch(/image\/jpeg/); const metadata = await sharp(image.body).metadata(); expect(metadata.exif).toBeUndefined();
  const repeated = await request(app.getHttpServer()).post('/api/service-offerings').set(auth(owner.token)).send({ ...offeringInput, confirmed: true }).expect(201); expect(repeated.body.id).toBe(published.body.id);
  await request(app.getHttpServer()).post('/api/service-offerings').set(auth(owner.token)).send({ ...offeringInput, title: 'Conflicting retry', confirmed: true }).expect(409);
  const scheduledAt = new Date(Date.now() + 86400000).toISOString();
  const booking = await request(app.getHttpServer()).post('/api/service-requests').set(auth(other.token)).send({ offeringId: published.body.id, requestId: `booking-${Date.now()}`, scheduledAt, address: 'Test delivery address', requirement: 'Test customer requirement', contact: 'Test customer contact', confirmed: true }).expect(201);
  const requestId = booking.body.request.id;
    const incoming = await request(app.getHttpServer()).get('/api/service-requests?role=provider').set(auth(owner.token)).expect(200);
    expect(incoming.body.find((row: {request:{id:string}}) => row.request.id === requestId).relationship).toEqual({consumer:false,provider:true});
    const consumerOnly = await request(app.getHttpServer()).get('/api/service-requests?role=consumer').set(auth(owner.token)).expect(200);
    expect(consumerOnly.body.some((row: {request:{id:string}}) => row.request.id === requestId)).toBe(false);
    const customer = await request(app.getHttpServer()).get('/api/service-requests?role=consumer').set(auth(other.token)).expect(200);
    expect(customer.body.find((row: {request:{id:string}}) => row.request.id === requestId).nextAction).toBeNull();
  await request(app.getHttpServer()).post(`/api/service-requests/${requestId}/status`).set(auth(other.token)).send({ status: 'BOOKED', version: 1 }).expect(403);
  for (const [status, version] of [['BOOKED', 1], ['IN_PROGRESS', 2], ['COMPLETED', 3]]) await request(app.getHttpServer()).post(`/api/service-requests/${requestId}/status`).set(auth(owner.token)).send({ status, version }).expect(201);
  await request(app.getHttpServer()).post(`/api/service-requests/${requestId}/status`).set(auth(owner.token)).send({ status: 'COMPLETED', version: 3 }).expect(409);
  const timeline = await request(app.getHttpServer()).get(`/api/timeline?date=${scheduledAt.slice(0, 10)}&timezone=UTC`).set(auth(other.token)).expect(200);
  expect(timeline.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: `service-request:${requestId}`, status: '已完成', statusGroup: 'COMPLETED' })]));
   const work = await request(app.getHttpServer()).get('/api/consumer/work-items').set(auth(other.token)).expect(200);
   expect(work.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ServiceRequest', status: 'COMPLETED', sourceRef: { type: 'ServiceRequest', id: requestId } })]));
   const [audit] = await pool.query<any[]>("SELECT before_snapshot_json, after_snapshot_json FROM audit_logs WHERE resource_id = ? AND action = 'SERVICE_REQUEST_STATUS_CHANGED' ORDER BY created_at", [requestId]);
   expect(audit).toHaveLength(3);
   expect(audit.map(row => (typeof row.after_snapshot_json === 'string' ? JSON.parse(row.after_snapshot_json) : row.after_snapshot_json).status)).toEqual(['BOOKED', 'IN_PROGRESS', 'COMPLETED']);
  const catalog = await request(app.getHttpServer()).get('/api/service-offerings').set(auth(owner.token)).expect(200); expect(catalog.body.find((item: { id: string }) => item.id === published.body.id).useCount).toBe(1);
   const owned = await request(app.getHttpServer()).get('/api/my-service-offerings').set(auth(owner.token)).expect(200);
   const own = owned.body.find((row:{id:string}) => row.id===published.body.id);
   const update = {expectedUpdatedAt:own.updatedAt,title:own.title,summary:own.summary,serviceArea:own.serviceArea,contact:own.contact,priceMinor:own.priceMinMinor,status:'UNPUBLISHED',confirmed:true};
   await request(app.getHttpServer()).post(`/api/my-service-offerings/${own.id}`).set(auth(other.token)).send(update).expect(403);
   await request(app.getHttpServer()).post(`/api/my-service-offerings/${own.id}`).set(auth(owner.token)).send(update).expect(201);
   await request(app.getHttpServer()).post(`/api/my-service-offerings/${own.id}`).set(auth(owner.token)).send(update).expect(409);
   const hidden = await request(app.getHttpServer()).get('/api/service-offerings').set(auth(other.token)).expect(200);
   expect(hidden.body.some((row:{id:string}) => row.id===own.id)).toBe(false);
   const savedDraft = await request(app.getHttpServer()).post('/api/service-offerings').set(auth(owner.token)).send({...offeringInput,requestId:`draft-${Date.now()}`,status:'DRAFT',confirmed:true}).expect(201);
   expect(savedDraft.body.status).toBe('DRAFT');
 });
});
