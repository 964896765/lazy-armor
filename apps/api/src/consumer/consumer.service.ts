import { GoalPageReadService } from './goal-page-read.service';
import { MemoryService } from '../memory/memory.service';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';
import { MemoryCandidatesService } from '../memory/memory-candidates.service';
import { UserEventSyncRequestsService } from '../profiles/user-event-sync-requests.service';
import { ModuleRef } from '@nestjs/core';
import { ResourceGapContinuationService } from './resource-gap-continuation.service';
import { UserEventsService, projectUserEvent } from '../profiles/user-events.service';
import {resourceConnectionStatus} from './resource-projection-policy';
import {RealityPipelineService} from '../reality-pipeline/reality-pipeline.service';
import { parseShareText } from '@lazy-armor/plan-schema';
import type { ExternalReferenceDto } from './dto';
import { AuditService } from '../audit/audit.service';
import { ArtifactService } from '../artifacts/artifact.service';
import { CreationDraftsService } from '../creation-drafts/creation-drafts.service';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { creationDrafts, artifacts, acquisitionRounds, consumerConversations, conversationOnceRequests, consumerAttachments, consumerMessages, consumerServiceRequests, consumerServiceRequestEvents, externalServiceReferences, serviceOfferings, serviceProviderProfiles, executions, planVersions, reconciliationCases, operationalRecords, recurringItemProfiles, truthRecords, truthRecordVersions, userEventSyncRequests } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { coreProductTemplateByKey, PRODUCT_DOMAINS, SCENARIO_DEFINITIONS, productDomain, projectConsumerOutcome, type TimelineItem, type ResourceProjection } from '@lazy-armor/plan-schema';
import { and, desc, eq, gte, lt, inArray, or, sql, isNull, isNotNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AgentPlannerService } from '../ai-adapter/agent-planner.service';
import { PlansService } from '../plans/plans.service';
import { SkillRepositoriesService } from '../portable-skills/skill-repositories.service';
import { ConnectionsService } from '../connections/connections.service';
import { TrustedDevicesService } from '../trusted-devices/trusted-devices.service';
import { ConnectorsService } from '../connectors/connectors.service';
import { TemplatesService } from '../templates/templates.service';
import type { ConversationAttachmentDto, CreateConversationDto, ConversationMessageDto, ExternalServiceDto, ServiceRequestDto, RequestTransitionDto } from './dto';
import { decodeTextAttachment } from './attachment-policy';
import { consumerPlanStatus, dateWindow, safeServiceUrl, requestTransitionAllowed, temporaryConversationOutcome } from './projection-policy';
@Injectable()
export class ConsumerService {
 constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly planner: AgentPlannerService, private readonly plans: PlansService, private readonly connections: ConnectionsService, private readonly devices: TrustedDevicesService, private readonly connectors: ConnectorsService, private readonly templates: TemplatesService, private readonly drafts: CreationDraftsService, private readonly artifacts: ArtifactService, private readonly audit: AuditService,private readonly reality:RealityPipelineService, private readonly userEvents: UserEventsService, private readonly syncRequests: UserEventSyncRequestsService, private readonly modules:ModuleRef, private readonly memoryCandidates:MemoryCandidatesService, private readonly memory:MemoryService, private readonly methods:SkillRepositoriesService) {}
 async planLibrary(userId: string) {
  const [plans, templates] = await Promise.all([this.plans.list(userId), this.templates.list()]);
  return { domains: PRODUCT_DOMAINS.map(domain => ({ key: domain.key, label: domain.label })),
   templates: [...templates.map(template => ({ ...template, templateKey: template.key, productDomain: PRODUCT_DOMAINS.find(domain => domain.storageKey === template.domain)?.key ?? productDomain(template.domain), sourceRef: { type: 'Template', id: template.key }, primaryAction: { label: '使用', path: `/chat?mode=plan&templateKey=${encodeURIComponent(template.key)}` }, detailAction: { path: `/template-detail?templateKey=${encodeURIComponent(template.key)}` } })),
    ...SCENARIO_DEFINITIONS.map(scenario => ({ templateKey: `scenario:${scenario.key}`, name: scenario.label, description: `持续整理${scenario.label}，按需要提醒与跟进`, productDomain: scenario.domain, sourceRef: { type: 'Scenario', id: scenario.key }, primaryAction: { label: '使用', path: `/chat?mode=plan&scenarioKey=${encodeURIComponent(scenario.key)}` }, detailAction: { path: `/template-detail?scenarioKey=${encodeURIComponent(scenario.key)}` } }))],
   plans: plans.map(plan => ({ updatedAt:plan.updatedAt instanceof Date?plan.updatedAt.toISOString():plan.updatedAt, planId: plan.id, title: plan.name ?? plan.currentVersion?.name ?? '未命名计划', summary: plan.description ?? '', productDomain: productDomain(plan.domain), status: consumerPlanStatus(plan.status, plan.hasMissingConnection), nextRun: plan.status === 'active' ? plan.nextExpectedRunAt : null, nextStep: plan.hasMissingConnection ? '需要补充资源' : plan.status === 'paused' ? '已暂停' : '查看计划详情', sourceRef: { type: 'Plan', id: plan.id }, primaryAction: { label: '查看计划', path: `/plans/${plan.id}` } })) };
 }
 async resources(userId: string, currentDeviceId?: string,currentInstallationId?:string): Promise<ResourceProjection[]> {
  const [connections, devices, connectors] = await Promise.all([this.connections.list(userId), this.devices.list(userId), this.connectors.listPublic()]);
  const result: ResourceProjection[] = [];
  for (const connection of connections.filter(item => !['manual','internal','file_provider','logistics_provider','content_provider'].includes(item.connectorId) && connectors.some(c=>c.key===item.connectorId&&c.providerType!=='internal'))) {
   const view = await this.modules.get(CapabilityUsabilityService,{strict:false}).resolveConnection(userId,connection.id);
   const available = view.capabilities.filter(item=>item.usable);
   const kind = (connection.connectorId==='public_http_json'||connectors.find(c=>c.key===connection.connectorId)?.providerType==='webhook') ? 'INTERFACE' : 'CLOUD';
   result.push({resourceId:`connection:${connection.id}`,kind,name:connection.connectorId==='public_http_json'?connection.externalAccountName:connection.connectorName,
    summary:connection.connectorId==='public_http_json'?connection.connectorName:connection.externalAccountName,
    status:resourceConnectionStatus(connection.status,view.capabilities.map(c=>c.health)),
    health:view.capabilities.length&&view.capabilities.every(c=>c.health==='HEALTHY')?'VERIFIED':'UNKNOWN',
    capabilities:available.map(c=>c.key),reasons:[...new Set(view.capabilities.flatMap(c=>c.reasons))],
    capabilitySummary:{total:view.capabilities.length,available:available.length,items:view.capabilities.map(({key,name,operation,usable})=>({key,name,operation,usable}))},
    lastVerifiedAt:connection.lastCheckedAt instanceof Date?connection.lastCheckedAt.toISOString():connection.lastCheckedAt??null,
    sourceRef:{type:'Connection',id:connection.id},primaryAction:{label:'查看能力',path:connection.connectorId==='public_http_json'?`/interface-detail?id=${connection.id}`:`/resource-detail?id=${connection.id}`}});
  }
  for (const connector of connectors.filter(item => !['manual','internal','file_provider','logistics_provider','content_provider'].includes(item.key)&&item.providerType!=='internal' && !connections.some(connection => connection.connectorId === item.key))) result.push({ resourceId: `provider:${connector.key}`, kind: (connector.key==='public_http_json'||connector.providerType==='webhook') ? 'INTERFACE' : 'CLOUD', name: connector.name, summary: connector.description, status: connector.key==='public_http_json'?'需要配置':connector.providerType==='webhook'?'待接入':connector.productionStatus==='DISABLED' && ['gmail','google_calendar','github','notion','feishu','dingtalk','wecom'].includes(connector.key) ? '需要配置' : connector.connectable && !connector.draftOnly ? '需要授权' : '待接入', health: 'UNKNOWN', capabilities: [], reasons: [], lastVerifiedAt: null, sourceRef: { type: 'Connector', id: connector.key }, primaryAction: { label: (connector.key==='public_http_json'||connector.providerType==='webhook') ? '添加' : '连接', path: connector.key === 'public_http_json' ? '/add-interface' : connector.providerType==='webhook'?'/add-interface?protocol=Webhook': `/resource-provider?key=${encodeURIComponent(connector.key)}` } });
  for (const device of devices.filter(d=>d.id!==currentDeviceId&&(!currentInstallationId||d.deviceId!==currentInstallationId))) result.push({ resourceId: `device:${device.id}`, kind: 'DEVICE', name: `已认证设备 · ${device.deviceId.slice(-6)}`, summary: '设备任务、应用与授权读取', status: device.status === 'revoked' ? '需要授权' : device.online ? '已连接' : '设备离线', health: device.online ? 'VERIFIED' : 'UNKNOWN', capabilities: [], reasons: device.online ? [] : ['DEVICE_NOT_ONLINE'], lastVerifiedAt: device.lastHeartbeatAt, sourceRef: { type: 'TrustedDevice', id: device.id }, primaryAction: { label: '查看设备', path: `/devices/${device.id}` } });
  return result;
 }
 async archivedConversations(userId: string) {
  return this.db.select().from(consumerConversations).where(and(eq(consumerConversations.userId,userId),isNotNull(consumerConversations.archivedAt),isNull(consumerConversations.deletedAt))).orderBy(desc(consumerConversations.archivedAt));
 }
 async conversations(userId: string) {
  return this.db.select().from(consumerConversations).where(and(eq(consumerConversations.userId, userId), isNull(consumerConversations.archivedAt), isNull(consumerConversations.deletedAt), sql`(EXISTS (SELECT 1 FROM consumer_messages m WHERE m.conversation_id = ${consumerConversations.id} AND m.role = 'user' AND CHAR_LENGTH(TRIM(m.content)) > 0) OR EXISTS (SELECT 1 FROM consumer_attachments a WHERE a.conversation_id = ${consumerConversations.id}) OR EXISTS (SELECT 1 FROM creation_drafts d WHERE d.draft_id = ${consumerConversations.draftId} AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(d.goal_json, '$.constraints.userInput')))) > 0))`)).orderBy(desc(consumerConversations.pinnedAt), desc(consumerConversations.updatedAt)).limit(100);
 }
 async updateConversationHistory(userId: string, id: string, input: {version: number; action: 'PIN'|'UNPIN'|'RENAME'|'ARCHIVE'|'DELETE'; title?: string}) {
  await this.db.transaction(async tx => {
   const row = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!row) throw new NotFoundException('会话不存在');
   if (row.version !== input.version || row.status === 'PROCESSING') throw new ConflictException('会话已更新或正在处理，请刷新');
   if (input.action === 'RENAME' && !input.title?.trim()) throw new BadRequestException('请输入会话标题');
   const now = new Date();
   await tx.update(consumerConversations).set({version: row.version + 1, updatedAt: now,
    ...(input.action === 'PIN' ? {pinnedAt: now} : {}), ...(input.action === 'UNPIN' ? {pinnedAt: null} : {}),
    ...(input.action === 'RENAME' ? {title: input.title!.trim()} : {}),
    ...(input.action === 'ARCHIVE' ? {archivedAt: now} : {}), ...(input.action === 'DELETE' ? {deletedAt: now} : {})
   }).where(eq(consumerConversations.id, id));
   if (input.action === 'DELETE' && row.draftId && !row.planId) {
    await tx.update(creationDrafts).set({state:'DISCARDED',version:sql`${creationDrafts.version} + 1`,updatedAt:now}).where(and(eq(creationDrafts.draftId,row.draftId),eq(creationDrafts.userId,userId),eq(creationDrafts.state,'ACTIVE')));
   }
  });
  return {updated: true};
 }
 async createConversation(userId: string, input: CreateConversationDto) {
  if(input.productTemplateKey && (input.mode!=='PLAN'||!coreProductTemplateByKey(input.productTemplateKey)))throw new BadRequestException('Unknown product template');
  if (input.mode !== 'PLAN' && (input.draftId || input.scenarioKey)) throw new BadRequestException('CreationDraft requires plan context');
  if (input.planId) await this.plans.get(userId, input.planId); if (input.templateKey) await this.templates.get(input.templateKey);
  const contextRefs: Array<{ type: 'ServiceOffering' | 'ExternalServiceReference' | 'ExternalReference'; id: string }> = [...(input.serviceOfferingId ? [{ type: 'ServiceOffering' as const, id: input.serviceOfferingId }] : []), ...(input.externalServiceId ? [{ type: 'ExternalServiceReference' as const, id: input.externalServiceId }] : []),...(input.externalReferenceId?[{type:'ExternalReference' as const,id:input.externalReferenceId}]:[])];
  await this.serviceContextSources(userId, contextRefs);
  const id = newId(); const now = new Date();
  const actualId = await this.db.transaction(async tx => {
   await tx.insert(consumerConversations).values({ id, userId, mode: input.mode, title: input.title ?? '新会话', status: 'ACTIVE', contextRefs, templateKey: input.templateKey ?? null, planId: input.planId ?? null, version: 0, createdAt: now, updatedAt: now });
   if (input.mode === 'PLAN') {
    const draft = await this.drafts.bindConversation(userId, id, tx, input);
    if (draft.conversationId !== id) { await tx.delete(consumerConversations).where(eq(consumerConversations.id, id)); return draft.conversationId; }
    await tx.update(consumerConversations).set({ draftId: draft.draftId }).where(eq(consumerConversations.id, id));
   }
   return id;
  });
  return this.conversation(userId, actualId);
 }
 async saveDraftInput(userId: string, id: string, input: { version: number; content: string }) {
  if (!input.content.trim()) throw new BadRequestException('请输入计划需求');
  await this.db.transaction(async tx => {
   const row = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!row) throw new NotFoundException('会话不存在');
   if (row.mode !== 'PLAN' || row.status === 'PROCESSING' || row.version !== input.version) throw new ConflictException('计划会话已变化，请刷新');
   const draft = row.draftId ? { draftId: row.draftId } : await this.drafts.bindConversation(userId, id, tx);
   await this.drafts.recordConversationGoal(userId, draft.draftId, input.content, tx);
   await tx.update(consumerConversations).set({ draftId: draft.draftId, title: row.version === 0 ? input.content.slice(0, 100) : row.title, version: row.version + 1, status: 'ACTIVE', updatedAt: new Date() }).where(eq(consumerConversations.id, id));
  });
  return this.conversation(userId, id);
 }
 private async serviceContextSources(userId: string, refs: Array<{ type: string; id: string }>) {
  const sources: Array<{ label: string; content: string }> = [];
  for (const ref of refs) {
   if ((ref.type === 'ExternalServiceReference'||ref.type==='ExternalReference')) {
    const service = await this.externalGet(userId, ref.id);
    if(ref.type==='ExternalServiceReference'&&service.kind!=='SERVICE')throw new BadRequestException('该引用不是服务');
    sources.push({ label: `external_service:${ref.id}`, content: JSON.stringify({ sourceRef: ref, title: service.title, summary: service.summary, sourceUrl: service.sourceUrl, priceSnapshot: service.priceSnapshot, availability: 'NOT_VERIFIED' }) });
   } else if (ref.type === 'ServiceOffering') {
    const row = (await this.db.select({ offering: serviceOfferings }).from(serviceOfferings).innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id)).where(and(eq(serviceOfferings.id, ref.id), eq(serviceOfferings.status, 'PUBLISHED'), eq(serviceProviderProfiles.status, 'ACTIVE'))).limit(1))[0];
    if (!row) throw new NotFoundException('内部服务已不可用');
    sources.push({ label: `internal_service:${ref.id}`, content: JSON.stringify({ sourceRef: ref, title: row.offering.title, summary: row.offering.summary, deliveryMode: row.offering.deliveryMode, serviceArea: row.offering.serviceArea, priceMinMinor: row.offering.priceMinMinor, currency: row.offering.currency, availability: 'PUBLISHED_OFFERING_ONLY', bookingStatus: 'NOT_REQUESTED' }) });
   }
  }
  return sources;
 }
 async conversation(userId: string, id: string) { const row = (await this.db.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).limit(1))[0]; if (!row) throw new NotFoundException('会话不存在'); const messages = await this.db.select().from(consumerMessages).where(eq(consumerMessages.conversationId, id)).orderBy(consumerMessages.createdAt); const attachments = await this.db.select({ id: consumerAttachments.id, artifactId: consumerAttachments.artifactId, fileName: consumerAttachments.fileName, mimeType: consumerAttachments.mimeType, sizeBytes: consumerAttachments.sizeBytes, contentSha256: consumerAttachments.contentSha256 }).from(consumerAttachments).where(eq(consumerAttachments.conversationId, id)); return { ...row, conversationId: id, messages, attachments, pageReads: await this.modules.get(GoalPageReadService,{strict:false}).results(userId, id, messages.filter(m=>m.structuredPayload?.pageRead).map(m=>m.id)), creationDraft: row.draftId ? await this.drafts.get(userId, row.draftId) : null }; }
 async attach(userId: string, id: string, input: ConversationAttachmentDto) {
  const decoded = decodeTextAttachment(input.fileName, input.mimeType, input.contentBase64);
  return this.db.transaction(async tx => {
   const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!conversation) throw new NotFoundException('会话不存在');
   const existing = (await tx.select().from(consumerAttachments).where(and(eq(consumerAttachments.conversationId, id), eq(consumerAttachments.requestId, input.requestId))))[0];
   if (existing) { if (existing.contentSha256 !== decoded.contentSha256 || existing.fileName !== input.fileName || existing.mimeType !== input.mimeType) throw new ConflictException('同一请求标识不能用于不同文件'); return { id: existing.id, fileName: existing.fileName, sizeBytes: existing.sizeBytes }; }
   if (conversation.status === 'PROCESSING') throw new ConflictException('会话正在处理，请稍后添加');
   const count = await tx.select({ id: consumerAttachments.id }).from(consumerAttachments).where(eq(consumerAttachments.conversationId, id));
   if (count.length >= 20) throw new BadRequestException('每个会话最多保存 20 个附件');
   const attachmentId = newId();
   await tx.insert(consumerAttachments).values({ id: attachmentId, conversationId: id, requestId: input.requestId, fileName: input.fileName, mimeType: input.mimeType, ...decoded, createdAt: new Date() });
   return { id: attachmentId, fileName: input.fileName, sizeBytes: decoded.sizeBytes };
  });
 }
 async attachArtifact(userId: string, conversationId: string, input: { artifactId: string; requestId: string }) {
  const artifact = await this.artifacts.owned(userId, input.artifactId);
  if (artifact.extractionStatus !== 'EXTRACTED' || !artifact.extractedText) throw new ConflictException('文档尚未完成文字提取');
  return this.db.transaction(async tx => {
   const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!conversation) throw new NotFoundException('会话不存在');
   const prior = (await tx.select().from(consumerAttachments).where(and(eq(consumerAttachments.conversationId, conversationId), eq(consumerAttachments.requestId, input.requestId))))[0];
   if (prior) { if (prior.artifactId !== input.artifactId) throw new ConflictException('附件请求标识不能用于不同文档'); return { id: prior.id, artifactId: prior.artifactId, fileName: prior.fileName, sizeBytes: prior.sizeBytes }; }
   if (conversation.status === 'PROCESSING') throw new ConflictException('会话正在处理');
   const count = await tx.select({ id: consumerAttachments.id }).from(consumerAttachments).where(eq(consumerAttachments.conversationId, conversationId));
   if (count.length >= 20) throw new BadRequestException('每个会话最多 20 个附件');
   const row = { id: newId(), artifactId: artifact.id, conversationId, requestId: input.requestId, fileName: artifact.fileName, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, contentSha256: artifact.sourceSha256, content: artifact.extractedText!, createdAt: new Date() };
   await tx.insert(consumerAttachments).values(row); return { id: row.id, artifactId: row.artifactId, fileName: row.fileName, sizeBytes: row.sizeBytes };
  });
 }
 async message(userId: string, id: string, input: ConversationMessageDto) {
  if (!input.content.trim()) throw new BadRequestException('请输入会话需求');
  const conversation = await this.conversation(userId, id); const existing = conversation.messages.find(message => message.requestId === input.requestId && message.role === 'assistant'); if (existing) { const original = conversation.messages.find(message => message.requestId === input.requestId && message.role === 'user'); const originalIds = original?.contextRefs.filter(ref => ref.type === 'ConversationAttachment').map(ref => ref.id).sort() ?? []; if (original?.content !== input.content || JSON.stringify(originalIds) !== JSON.stringify([...(input.attachmentIds ?? [])].sort())) throw new ConflictException('同一请求标识不能用于不同消息内容'); return this.conversation(userId, id); }
  const requestedIds = input.attachmentIds ?? [];
  const attachments = requestedIds.length ? await this.db.select().from(consumerAttachments).where(and(eq(consumerAttachments.conversationId, id), inArray(consumerAttachments.id, requestedIds))) : [];
  if (attachments.length !== requestedIds.length) throw new NotFoundException('附件不属于当前会话');
  await this.db.transaction(async tx => { const locked = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0]; if (!locked || locked.version !== input.version || locked.status === 'PROCESSING') throw new ConflictException('会话已更新，请刷新后重试'); if (conversation.messages.some(message => message.requestId === input.requestId)) throw new ConflictException('该请求正在处理'); await tx.insert(consumerMessages).values({ id: newId(), conversationId: id, requestId: input.requestId, role: 'user', content: input.content, structuredPayload: { workContext: conversation.mode }, contextRefs: [{ type: 'Conversation', id }, ...(conversation.contextRefs ?? []), ...attachments.map(file => ({ type: 'ConversationAttachment', id: file.id })), ...(conversation.templateKey ? [{ type: 'Template', id: conversation.templateKey }] : []), ...(conversation.planId ? [{ type: 'Plan', id: conversation.planId }] : [])], createdAt: new Date() }); if (conversation.draftId) await this.drafts.recordConversationGoal(userId, conversation.draftId, input.content, tx); await tx.update(consumerConversations).set({ status: 'PROCESSING', version: locked.version + 1, updatedAt: new Date() }).where(eq(consumerConversations.id, id)); });
  const historicalIds = conversation.messages.slice(-12).reverse().flatMap(message => message.contextRefs.filter(ref => ref.type === 'ConversationAttachment').map(ref => ref.id));
  const contextIds = [...new Set([...requestedIds, ...historicalIds])].slice(0, 3);
  const contextAttachments = contextIds.length ? await this.db.select().from(consumerAttachments).where(and(eq(consumerAttachments.conversationId, id), inArray(consumerAttachments.id, contextIds))) : [];
  let payload: Record<string, unknown>; let content: string; let sourcePlanVersionId: string | null = null; let memoryProposal: import('../ai-adapter/agent-planner.service').PlannerResult['memoryCandidateProposal'];
  try { const history = conversation.messages.slice(-12).map(message => ({ messageId: message.id, role: message.role, content: message.content.slice(0, 1500), truncated: message.content.length > 1500 }));
 const template = conversation.templateKey ? await this.templates.get(conversation.templateKey) : null;
 const linkedPlan = conversation.planId ? await this.plans.get(userId, conversation.planId) : null;
 sourcePlanVersionId = linkedPlan?.currentVersion?.id ?? null;
 const services = await this.serviceContextSources(userId, conversation.contextRefs ?? []);
 const result = await this.planner.plan(userId, input.content, { workContext: conversation.mode === 'PLAN' ? 'PLAN' : 'TEMPORARY', contextSources: [...services, ...contextAttachments.map(file => ({ label: `attachment:${file.id}`, content: JSON.stringify({ artifactRef: file.artifactId ? { type: 'Artifact', id: file.artifactId } : null, fileName: file.fileName, mimeType: file.mimeType, contentSha256: file.contentSha256, provenance: 'USER_UPLOADED_UNVERIFIED', content: file.content.slice(0, 16000), truncated: file.content.length > 16000, originalCharacterCount: file.content.length }) })), { label: 'conversation_history', content: JSON.stringify(history) }, { label: 'conversation_context', content: JSON.stringify({ creationDraft: conversation.creationDraft, conversationId: id, mode: conversation.mode, template, draftId: conversation.draftId, plan: linkedPlan ? { id: linkedPlan.id, name: linkedPlan.name, description: linkedPlan.description, status: linkedPlan.status } : null }) }] }); const { memoryCandidateProposal, ...publicResult } = result; memoryProposal = memoryCandidateProposal; payload = publicResult as unknown as Record<string, unknown>; content = result.answer?.explanation ?? result.proposal?.explanation ?? result.clarification?.missingRequirements.join('\n') ?? '草案未通过安全校验，请补充需求'; }
  catch (error) { if (error instanceof NotFoundException) { payload = { result: 'CONTEXT_UNAVAILABLE', retryable: false }; content = '引用的服务或计划已不可用，需求已保存。请重新选择有效记录后继续。'; } else if (error instanceof Error && error.message === 'AI_PROVIDER_BALANCE_INSUFFICIENT') { payload = { result: 'MODEL_UNAVAILABLE', reasonCode: 'AI_PROVIDER_BALANCE_INSUFFICIENT', retryable: true }; content = 'DeepSeek 账户余额不足，需求已保存。补充模型账户余额后可以继续。'; } else { payload = { result: 'MODEL_UNAVAILABLE', retryable: true }; content = '真实 AI 模型暂不可用，消息已保存。配置模型或恢复连接后可继续。'; } }
  await this.db.transaction(async tx => { if (Array.isArray(payload.methodRefs) && !(await this.methods.refsCurrent(tx,userId,payload.methodRefs as import('@lazy-armor/plan-schema').SkillMethodRef[]))) { payload={result:'PLANNER_OUTPUT_INVALID',validationErrors:['SKILL_CONTEXT_CHANGED'],warnings:[]}; content='参考的方法已变化，请重新生成建议。'; memoryProposal=undefined; } if (Array.isArray(payload.memoryRefs) && !(await this.memory.refsCurrent(tx,userId,payload.memoryRefs as Array<{id:string;version:number;settingsVersion:number}>, (payload.memoryRelationRefs ?? []) as Array<{id:string;version:number}>))) { payload = { result:'PLANNER_OUTPUT_INVALID', validationErrors:['MEMORY_CONTEXT_CHANGED'], warnings:[] }; content='你保存的个人信息已变化，本次结果需要重新核对。'; memoryProposal=undefined; } const messageId = newId(); await tx.insert(consumerMessages).values({ id: messageId, conversationId: id, requestId: input.requestId, role: 'assistant', content, structuredPayload: payload, contextRefs: sourcePlanVersionId ? [{ type: 'PlanVersion', id: sourcePlanVersionId }] : [], createdAt: new Date() }); if (memoryProposal) await this.memoryCandidates.register(tx,userId,id,messageId,input.requestId,memoryProposal); if (conversation.draftId && payload.result === 'PLAN_DRAFT' && payload.proposal) await this.drafts.recordConversationProposal(userId, conversation.draftId, messageId, payload.proposal as { scenarioKey: string; scenarioRevision: number; intentSummary: string }, tx); await tx.update(consumerConversations).set({ status: 'ACTIVE', title: conversation.version === 0 ? input.content.slice(0, 100) : conversation.title, updatedAt: new Date() }).where(eq(consumerConversations.id, id)); }); if(payload.factQuery){const saved=(await this.db.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId,id),eq(consumerMessages.requestId,input.requestId),eq(consumerMessages.role,'assistant'))))[0];await this.modules.get(ResourceGapContinuationService,{strict:false}).register(userId,saved.id);} return this.conversation(userId, id);
 }
 async confirmUserEvent(userId: string, id: string, input: { version: number; messageId: string; confirmed: boolean }) {
  if (!input.confirmed) throw new BadRequestException('请确认内部提醒草稿');
  return this.db.transaction(async tx => {
   const row = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!row) throw new NotFoundException('会话不存在');
   const message = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, input.messageId), eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'assistant'))))[0];
   if (!message || message.structuredPayload?.result !== 'USER_EVENT_DRAFT') throw new BadRequestException('内部事项草稿不存在');
   if (row.status === 'USER_EVENT_CONFIRMED') {
    const event = await this.userEvents.get(userId, message.id, tx);
    const sync = (await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.userId,userId),eq(userEventSyncRequests.proposalMessageId,message.id))))[0];
    return sync ? {...event, externalSync:{requestId:sync.id,confirmedVersion:sync.userEventVersion,status:'CONFIRMED',executionAuthorized:false}} : event;
   }
   if (row.planId || row.status !== 'ACTIVE' || row.version !== input.version) throw new ConflictException('会话已更新，请重新查看事项草稿');
   const latest = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt)).limit(1))[0];
   if (latest?.id !== message.id || (message.structuredPayload.validationErrors as unknown[])?.length) throw new ConflictException('请确认最新事项草稿');
   const created = await this.userEvents.createConfirmed(tx, userId, message.id, id, message.structuredPayload.userEvent);
   const source = message.structuredPayload.externalSync ? await this.syncRequests.createConfirmed(tx,userId,id,message.id,created.id,created.version) : null;
   if (row.draftId) await tx.update(creationDrafts).set({state:'DISCARDED',version:sql`${creationDrafts.version} + 1`,updatedAt:new Date()}).where(and(eq(creationDrafts.draftId,row.draftId),eq(creationDrafts.userId,userId),eq(creationDrafts.state,'ACTIVE')));
   await tx.update(consumerConversations).set({status:'USER_EVENT_CONFIRMED',version:row.version+1,updatedAt:new Date()}).where(eq(consumerConversations.id,id));
   return source?.kind === 'USER_EVENT_SYNC' ? {...created, externalSync:{requestId:source.requestId,confirmedVersion:source.userEventVersion,status:'CONFIRMED',executionAuthorized:false}} : created;
  });
 }
 async confirmPlan(userId: string, id: string, input: { version: number; confirmed: boolean }) {
  if (!input.confirmed) throw new BadRequestException('请确认计划草案');
  return this.db.transaction(async tx => {
   const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!conversation) throw new NotFoundException('会话不存在');
   if (conversation.planId && conversation.status === 'PLAN_CONFIRMED') return { planId: conversation.planId };
   if (conversation.mode !== 'PLAN' || conversation.status !== 'ACTIVE' || conversation.version !== input.version) throw new ConflictException('会话已更新，请重新查看草案');
   const latest = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt)).limit(1))[0];
   const result = latest?.structuredPayload as { methodRefs?: import('@lazy-armor/plan-schema').SkillMethodRef[]; result?: string; validationErrors?: string[]; proposal?: { draftDefinition?: Record<string, unknown> | null; missingRequirements?: string[] } } | undefined;
   if (result?.result !== 'PLAN_DRAFT' || result.validationErrors?.length || !result.proposal?.draftDefinition) throw new BadRequestException('当前草案尚未通过校验，请补充需求');
   // Missing resources are retained as draft gaps; only the existing Plan authority may activate a version.
   if (!conversation.draftId) throw new ConflictException('请恢复计划会话草案后再确认');
   await this.drafts.completeConversation(userId, conversation.draftId, latest.id, tx);
   // Persist a draft through the existing Plan authority. Activation and execution retain their own gates.
   const definition = result.proposal.draftDefinition as import('@lazy-armor/plan-schema').PlanDefinitionInput;
   const sourceVersion = (latest.contextRefs as Array<{ type: string; id: string }> | null)?.find(ref => ref.type === 'PlanVersion');
   if (conversation.planId && !sourceVersion) throw new ConflictException('请重新生成修改草案，以核对当前计划版本');
   const created = conversation.planId
    ? await this.plans.createVersionInTransaction(userId, conversation.planId, definition, tx, sourceVersion!.id)
    : await this.plans.createInTransaction(userId, definition, tx);
   await this.methods.freeze(tx,userId,created.planVersionId,result.methodRefs ?? []);
   const frozen = await this.drafts.freezeConversationSources(userId, conversation.draftId, created, tx);
   if (frozen) await this.audit.append({actorType:"user",actorUserId:userId,userId,action:"PLAN_SOURCES_FROZEN",resourceType:"plan_version",resourceId:created.planVersionId,correlationId:conversation.draftId,source:"api",result:"success",after:{contractId:frozen.contractId,sourceSelections:frozen.sourceSelections},changeSummary:"Confirmed CreationDraft source bindings frozen for this PlanVersion"},tx);
   await tx.update(consumerConversations).set({ planId: created.planId, status: 'PLAN_CONFIRMED', version: conversation.version + 1, updatedAt: new Date() }).where(eq(consumerConversations.id, id));
   return { planId: created.planId };
  });
 }
 async promoteConversation(userId: string, id: string, input: { version: number }) {
  await this.db.transaction(async tx => {
   const row = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, id), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!row) throw new NotFoundException('会话不存在');
   if (row.mode === 'PLAN') return;
   if (row.version !== input.version || row.status !== 'ACTIVE') throw new ConflictException('会话已更新，请刷新');
   const draft = await this.drafts.bindConversation(userId, id, tx);
   const requirement = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'user'))).orderBy(desc(consumerMessages.createdAt)).limit(1))[0];
   if (requirement) await this.drafts.recordConversationGoal(userId, draft.draftId, requirement.content, tx);
   const latest = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, id), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt)).limit(1))[0];
   if (latest?.structuredPayload?.result === 'PLAN_DRAFT' && latest.structuredPayload.proposal) await this.drafts.recordConversationProposal(userId, draft.draftId, latest.id, latest.structuredPayload.proposal as { scenarioKey: string; scenarioRevision: number; intentSummary: string }, tx);
   await tx.update(consumerConversations).set({ mode: 'PLAN', draftId: draft.draftId, version: row.version + 1, updatedAt: new Date() }).where(eq(consumerConversations.id, id));
  });
  return this.conversation(userId, id);
 }
 async externalList(userId: string, allKinds=false) { return this.db.select().from(externalServiceReferences).where(and(eq(externalServiceReferences.userId, userId),allKinds?undefined:eq(externalServiceReferences.kind,'SERVICE'))).orderBy(desc(externalServiceReferences.createdAt)); }
 async externalGet(userId: string, id: string) {
  const row = (await this.db.select().from(externalServiceReferences).where(and(eq(externalServiceReferences.userId, userId), eq(externalServiceReferences.id, id))).limit(1))[0];
  if (!row) throw new NotFoundException('服务引用不存在');
  return { ...row, availability: 'NOT_VERIFIED' as const, primaryAction: { label: row.kind==='SERVICE'?'打开原服务':'打开原链接', url: row.sourceUrl } };
 }
 async externalCreate(userId:string,input:ExternalServiceDto & Partial<ExternalReferenceDto>) {
  const {rawText,mimeType}=input;
  const draft=parseShareText({rawText:rawText??input.sourceUrl,mimeType});
  const sourceUrl=safeServiceUrl(input.sourceUrl);
  if(!sourceUrl||draft.status==='NO_URL'||!draft.urls.includes(input.sourceUrl))throw new BadRequestException('必须选择原始内容中的公开 http/https 链接');
  const chosen=parseShareText({rawText:input.sourceUrl});
  const kind=input.kind??'SERVICE';
  const domain=input.domain??null;
  if(chosen.kindCandidate==='PRODUCT'&&kind==='SERVICE')throw new BadRequestException('商品引用不能保存为服务');
  let evidenceArtifactId:string|null=null;
  if(input.evidenceArtifactId){const artifact=await this.artifacts.owned(userId,input.evidenceArtifactId);if(rawText!==undefined&&Buffer.from(artifact.sourceBase64,'base64').toString('utf8')!==rawText)throw new BadRequestException('原文与来源证据不一致');evidenceArtifactId=artifact.id;}
  if(rawText!==undefined&&!evidenceArtifactId){const artifact=await this.artifacts.import(userId,{fileName:'share-payload.txt',mimeType:'text/plain',contentBase64:Buffer.from(rawText,'utf8').toString('base64'),requestId:`share-payload-${newId()}`});evidenceArtifactId=artifact.id;}
  const artifact=evidenceArtifactId?await this.artifacts.owned(userId,evidenceArtifactId):null;
  const rounds=artifact?await this.db.select().from(acquisitionRounds).where(and(eq(acquisitionRounds.userId,userId),eq(acquisitionRounds.capability,'share.read'),eq(acquisitionRounds.state,'VERIFIED_PRESENT'))):[];
  const signedShare=rounds.find(r=>r.evidenceRefsJson.includes(`artifact:${artifact?.id}`));
  if(input.importMethod==='SHARE'&&!signedShare)throw new BadRequestException('分享导入需要真实签名 Share Receipt');
  let id=newId();const now=new Date();
  await this.db.transaction(async tx=>{
  if(artifact){await tx.select({id:artifacts.id}).from(artifacts).where(and(eq(artifacts.id,artifact.id),eq(artifacts.userId,userId))).for('update');const prior=(await tx.select().from(externalServiceReferences).where(and(eq(externalServiceReferences.userId,userId),eq(externalServiceReferences.evidenceArtifactId,artifact.id),eq(externalServiceReferences.sourceUrl,input.sourceUrl))).limit(1))[0];if(prior){if(prior.kind!==kind||prior.title!==input.title||prior.domain!==domain)throw new ConflictException('同一来源引用已保存，请编辑原引用');id=prior.id;return;}}
  await tx.insert(externalServiceReferences).values({id,userId,title:input.title,summary:input.summary,category:input.category??'其他',domain,importMethod:input.importMethod,providerName:input.providerName,priceSnapshot:input.priceSnapshot,kind,sourceUrl:input.sourceUrl,sourcePlatform:chosen.sourcePlatform??new URL(sourceUrl).hostname,rawText:rawText??null,parserVersion:draft.parserVersion,ruleId:draft.ruleId,shareCode:draft.shareCode,evidenceArtifactId,createdAt:now,updatedAt:now});
  if(artifact)await this.reality.ingest(userId,{sourceMode:signedShare?'SHARE':'MANUAL',providerKey:signedShare?'android-share':'user-paste',deviceId:signedShare?.trustedDeviceId,externalEventKey:`external-reference:${id}`,parserKey:'generic.external-reference.v1',resourceHint:'ExternalReference',payload:{id,sourceSha256:artifact.sourceSha256,sourceUrl:input.sourceUrl,kind,domain,title:input.title,shareCode:draft.shareCode,sourcePlatform:chosen.sourcePlatform,parserVersion:draft.parserVersion,ruleId:draft.ruleId,evidenceRefs:[`artifact:${artifact.id}`,...(signedShare?.evidenceRefsJson??[])]},evidenceHash:artifact.sourceSha256,observedAt:(signedShare?.observedAt??artifact.createdAt).toISOString()},0,tx);
  });
  return this.externalGet(userId,id);
 }
 async externalRemove(userId: string, id: string) { const exists = (await this.externalList(userId,true)).some(row => row.id === id); if (!exists) throw new NotFoundException('服务引用不存在'); await this.db.delete(externalServiceReferences).where(and(eq(externalServiceReferences.id, id), eq(externalServiceReferences.userId, userId))); return { removed: true }; }
 async requests(userId: string, role?: string) {
  if(role && !['consumer','provider'].includes(role)) throw new BadRequestException('请选择服务视图');
  const rows = await this.db.select({ request: consumerServiceRequests, offering: serviceOfferings, providerUserId: serviceProviderProfiles.userId }).from(consumerServiceRequests).innerJoin(serviceOfferings, eq(consumerServiceRequests.offeringId, serviceOfferings.id)).innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id)).where(role === 'consumer' ? eq(consumerServiceRequests.userId,userId) : role === 'provider' ? eq(serviceProviderProfiles.userId,userId) : or(eq(consumerServiceRequests.userId, userId), eq(serviceProviderProfiles.userId, userId))).orderBy(desc(consumerServiceRequests.createdAt));
  return rows.map(({ request, offering, providerUserId }) => ({ request, offering, relationship: {consumer:request.userId===userId,provider:providerUserId===userId}, nextAction: providerUserId === userId ? ({ PENDING: { label: '确认预约', status: 'BOOKED' }, BOOKED: { label: '开始服务', status: 'IN_PROGRESS' }, IN_PROGRESS: { label: '确认完成', status: 'COMPLETED' } } as Record<string, { label: string; status: string }>)[request.status] ?? null : null }));
 }
 async requestCreate(userId: string, input: ServiceRequestDto) { if (!input.confirmed) throw new BadRequestException('需要明确确认发起服务'); if (!input.address.trim() || !input.contact.trim()) throw new BadRequestException('请填写服务地址与联系方式'); const scheduledAt = new Date(input.scheduledAt); if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) throw new BadRequestException('预约时间必须在未来'); const id = newId(); await this.db.transaction(async tx => { const offering = (await tx.select({ offering: serviceOfferings, provider: serviceProviderProfiles }).from(serviceOfferings).innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id)).where(eq(serviceOfferings.id, input.offeringId)).for('update'))[0]; if (!offering || offering.offering.status !== 'PUBLISHED' || offering.provider.status !== 'ACTIVE') throw new NotFoundException('服务不可用'); const existing = (await tx.select().from(consumerServiceRequests).where(and(eq(consumerServiceRequests.userId, userId), eq(consumerServiceRequests.requestId, input.requestId))))[0]; if (existing) { if (existing.offeringId !== input.offeringId || existing.scheduledAt.getTime() !== scheduledAt.getTime() || existing.address !== input.address || existing.requirement !== input.requirement || existing.contact !== input.contact) throw new ConflictException('同一请求标识不能用于不同预约内容'); return; } const now = new Date(); await tx.insert(consumerServiceRequests).values({ id, userId, offeringId: input.offeringId, requestId: input.requestId, scheduledAt, address: input.address, requirement: input.requirement, contact: input.contact, status: 'PENDING', createdAt: now, updatedAt: now }); await tx.insert(consumerServiceRequestEvents).values({ id: newId(), requestId: id, actorUserId: userId, fromStatus: null, toStatus: 'PENDING', createdAt: now }); }); return (await this.requests(userId)).find(row => row.request.requestId === input.requestId); }
 async transitionRequest(userId: string, id: string, input: RequestTransitionDto) { await this.db.transaction(async tx => { const row = (await tx.select({ request: consumerServiceRequests, provider: serviceProviderProfiles }).from(consumerServiceRequests).innerJoin(serviceOfferings, eq(consumerServiceRequests.offeringId, serviceOfferings.id)).innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id)).where(eq(consumerServiceRequests.id, id)).for('update'))[0]; if (!row || (row.request.userId !== userId && row.provider.userId !== userId)) throw new NotFoundException('服务请求不存在'); if (input.status !== 'CANCELLED' && row.provider.userId !== userId) throw new ForbiddenException('仅服务提供方可确认服务状态'); if (row.request.version !== input.version || !requestTransitionAllowed(row.request.status, input.status)) throw new ConflictException('服务状态已变化或不允许该操作'); const now = new Date(); await tx.update(consumerServiceRequests).set({ status: input.status, version: input.version + 1, completedAt: input.status === 'COMPLETED' ? now : null, updatedAt: now }).where(eq(consumerServiceRequests.id, id)); if (input.status === 'COMPLETED') await tx.update(serviceOfferings).set({ useCount: sql`${serviceOfferings.useCount} + 1`, updatedAt: now }).where(eq(serviceOfferings.id, row.request.offeringId)); await tx.insert(consumerServiceRequestEvents).values({ id: newId(), requestId: id, actorUserId: userId, fromStatus: row.request.status, toStatus: input.status, createdAt: now }); await this.audit.append({ actorType: 'user', actorUserId: userId, userId: row.request.userId, action: 'SERVICE_REQUEST_STATUS_CHANGED', resourceType: 'service_request', resourceId: id, correlationId: id, source: 'api', result: 'success', before: { status: row.request.status, version: row.request.version }, after: { status: input.status, version: input.version + 1, evidenceType: 'PARTICIPANT_CONFIRMATION' }, changeSummary: 'Authorized participant confirmed service request progress' }, tx); }); return { updated: true }; }
 async timeline(userId: string, date: string, timezone: string): Promise<TimelineItem[]> { const { start, end } = date === 'all' ? {start:new Date('2000-01-01T00:00:00Z'),end:new Date('2100-01-01T00:00:00Z')} : dateWindow(date, timezone); const runs = await this.db.select({ run: executions, version: planVersions }).from(executions).innerJoin(planVersions, eq(executions.planVersionId, planVersions.id)).where(and(eq(executions.userId, userId), gte(executions.createdAt, start), lt(executions.createdAt, end))); const requests = await this.requests(userId); const cases = runs.length ? await this.db.select().from(reconciliationCases).where(and(eq(reconciliationCases.userId, userId), inArray(reconciliationCases.executionId, runs.map(({run}) => run.id)))) : []; const onceIds = runs.map(({ run }) => run.requestId).filter(value => /^once:[0-9a-f-]{36}$/.test(value)).map(value => value.slice(5)); const once = onceIds.length ? await this.db.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.userId, userId), inArray(conversationOnceRequests.id, onceIds))) : []; const onceRequests = new Set(once.map(row => `once:${row.id}`)); const items: TimelineItem[] = runs.map(({ run, version }) => { const activeCases = cases.filter(item => item.executionId === run.id); const outcome = projectConsumerOutcome({ executionStatus: run.status, approvalStatus: run.approvalStatus, resultState: activeCases.some(item => item.resultState === 'OUTCOME_UNKNOWN') ? 'OUTCOME_UNKNOWN' : run.status === 'succeeded' ? 'SUCCEEDED' : run.status === 'failed' ? 'FAILED' : run.status === 'partially_succeeded' ? 'PARTIALLY_SUCCEEDED' : null, reconciliationOpen: activeCases.some(item => ['OPEN','RECONCILING'].includes(item.status)), reconciliationNeedsUser: activeCases.some(item => item.status === 'NEEDS_USER') }); return ({ id: `execution:${run.id}`, kind: onceRequests.has(run.requestId) ? 'TEMPORARY_TASK' : 'PLAN_RUN', title: version.name, subtitle: run.resultSummary ?? run.errorMessage ?? '', scheduledAt: run.startedAt?.toISOString() ?? run.createdAt.toISOString(), occurredAt: run.createdAt.toISOString(), statusGroup: outcome.outcome === 'SUCCESS' ? 'COMPLETED' : 'INCOMPLETE', status: outcome.title, sourceRef: { type: 'Execution', id: run.id }, primaryAction: { label: '查看运行', path: `/executions/${run.id}` } }); }); for (const { request, offering } of requests.filter(({ request }) => request.scheduledAt >= start && request.scheduledAt < end)) items.push({ id: `service-request:${request.id}`, kind: 'SERVICE_REQUEST', title: offering.title, subtitle: request.requirement, scheduledAt: request.scheduledAt.toISOString(), occurredAt: request.createdAt.toISOString(), statusGroup: ['COMPLETED', 'CANCELLED'].includes(request.status) ? 'COMPLETED' : 'INCOMPLETE', status: ({ PENDING: '待确认', BOOKED: '已预约', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消' } as Record<string, string>)[request.status] ?? '待处理', sourceRef: { type: 'ServiceRequest', id: request.id }, primaryAction: { label: '查看服务请求', path: `/service-requests?id=${request.id}` } }); const calendar = await this.db.select({ record: truthRecords, version: truthRecordVersions }).from(truthRecords).innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id)).where(and(eq(truthRecords.userId, userId), eq(truthRecords.resourceKey, 'CalendarEvent'), eq(truthRecords.status, 'verified'))).orderBy(desc(truthRecords.verifiedAt));
 const seenCalendarSubjects=new Set<string>();
 for (const { record, version } of calendar) {
  if (seenCalendarSubjects.has(record.subjectKey)) continue;
  seenCalendarSubjects.add(record.subjectKey);
  const envelope = version.valueJson as Record<string, unknown>; const value = (envelope.value ?? envelope) as Record<string, unknown>; const eventStart = value.start as { dateTime?: string; date?: string } | undefined;
  const eventDate = eventStart?.dateTime ? new Date(eventStart.dateTime) : eventStart?.date ? dateWindow(eventStart.date, timezone).start : null;
  if (!eventDate || eventDate < start || eventDate >= end || !Number.isFinite(eventDate.getTime())) continue;
  items.push({ id: `calendar:${record.id}`, kind: 'CALENDAR_EVENT', allDay: value.allDay === true || Boolean(eventStart?.date && !eventStart.dateTime), title: typeof value.title === 'string' ? value.title : '日历事件', subtitle: '已确认的日历事实', scheduledAt: eventDate.toISOString(), occurredAt: record.verifiedAt.toISOString(), statusGroup: value.status === 'cancelled' ? 'COMPLETED' : 'INCOMPLETE', status: value.status === 'cancelled' ? '已取消' : '已安排', sourceRef: { type: 'TruthRecord', id: record.id }, primaryAction: { label: '查看日历事实', path: '/records' } });
 }
 const attention = await this.db.select().from(operationalRecords).where(and(eq(operationalRecords.userId, userId), eq(operationalRecords.needsAttention, 1), gte(operationalRecords.occurredAt, start), lt(operationalRecords.occurredAt, end)));
 const scheduledPlans = await this.plans.list(userId);
 for (const plan of scheduledPlans) {
  if (plan.status !== 'active' || !plan.nextExpectedRunAt) continue;
  const scheduledAt = new Date(plan.nextExpectedRunAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt < start || scheduledAt >= end) continue;
  items.push({ id: `plan-scheduled:${plan.id}:${scheduledAt.toISOString()}`, kind: 'PLAN_RUN', title: plan.name ?? '计划运行', subtitle: '计划的下一次预计运行', scheduledAt: scheduledAt.toISOString(), occurredAt: plan.updatedAt.toISOString(), statusGroup: 'INCOMPLETE', status: plan.hasMissingConnection ? '需要补充资源' : '待开始', sourceRef: { type: 'Plan', id: plan.id }, primaryAction: { label: '查看计划', path: `/plans/${plan.id}` } });
 }
 for (const record of attention) items.push({ id: `attention:${record.id}`, kind: 'ATTENTION', title: record.subject, subtitle: '需要你处理', scheduledAt: record.occurredAt.toISOString(), occurredAt: record.createdAt.toISOString(), statusGroup: 'INCOMPLETE', status: '待处理', sourceRef: { type: 'OperationalRecord', id: record.id }, primaryAction: { label: '查看记录', path: '/records' } });
 const reminders = await this.db.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.userId, userId), gte(recurringItemProfiles.nextDueAt, start), lt(recurringItemProfiles.nextDueAt, end)));
 for (const reminder of reminders) {
  if (reminder.sourceType === 'user_event') {
   const event = projectUserEvent(reminder);
   items.push({ id: `user-event:${event.id}`, kind: 'USER_EVENT', title: event.title, subtitle: event.remindedAt ? '提醒已送达，可完成或延后' : '内部事项 · 到点提醒', scheduledAt: event.dueAt, occurredAt: reminder.createdAt.toISOString(), statusGroup: event.status === 'active' ? 'INCOMPLETE' : 'COMPLETED', status: event.status === 'completed' ? '已完成' : event.status === 'cancelled' ? '已取消' : event.remindedAt ? '待处理' : '待提醒', sourceRef: { type: 'UserEvent', id: event.id }, primaryAction: { label: '查看事项', path: `/user-events/${event.id}` } });
  } else items.push({ id: `reminder:${reminder.id}`, kind: 'REMINDER', title: reminder.title, subtitle: reminder.category, scheduledAt: reminder.nextDueAt.toISOString(), occurredAt: reminder.createdAt.toISOString(), statusGroup: reminder.status === 'completed' ? 'COMPLETED' : 'INCOMPLETE', status: reminder.status, sourceRef: { type: 'RecurringItem', id: reminder.id }, primaryAction: { label: '查看提醒', path: '/todo' } });
 }
 // Analysis results reuse Message authority; external operation success is never inferred from AI text.
 const temporaryMessages = await this.db.select({ message: consumerMessages, conversation: consumerConversations }).from(consumerMessages).innerJoin(consumerConversations, eq(consumerMessages.conversationId, consumerConversations.id)).where(and(eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt), eq(consumerMessages.role, 'user'), gte(consumerMessages.createdAt, start), lt(consumerMessages.createdAt, end)));
 const replies = temporaryMessages.length ? await this.db.select().from(consumerMessages).where(and(eq(consumerMessages.role, 'assistant'), inArray(consumerMessages.conversationId, temporaryMessages.map(item => item.conversation.id)), inArray(consumerMessages.requestId, temporaryMessages.map(item => item.message.requestId)))) : [];
 const replyByRequest = new Map(replies.map(message => [`${message.conversationId}:${message.requestId}`, message]));
 const confirmedProposals = replies.length ? await this.db.select({ messageId: conversationOnceRequests.proposalMessageId }).from(conversationOnceRequests).where(and(eq(conversationOnceRequests.userId, userId), inArray(conversationOnceRequests.proposalMessageId, replies.map(message => message.id)))) : [];
 const confirmedProposalIds = new Set(confirmedProposals.map(item => item.messageId));
 for (const { message, conversation } of temporaryMessages) {
  const workContext = message.structuredPayload?.workContext ?? conversation.mode;
  if (workContext !== 'TEMPORARY') continue;
  const reply = replyByRequest.get(`${conversation.id}:${message.requestId}`);
  if (reply?.structuredPayload?.result === 'ACTION_PROPOSAL' && confirmedProposalIds.has(reply.id)) continue;
  const outcome = temporaryConversationOutcome(reply?.structuredPayload?.result as string | undefined);
  items.push({ id: `temporary-task:${message.id}`, kind: 'TEMPORARY_TASK', title: message.content.slice(0, 100), subtitle: reply?.content.slice(0, 300) ?? '会话需求已保存，正在分析', scheduledAt: null, occurredAt: message.createdAt.toISOString(), ...outcome, sourceRef: { type: 'ConversationMessage', id: message.id }, primaryAction: { label: '查看会话结果', path: `/chat?conversationId=${conversation.id}` } });
 }
 return items.sort((a, b) => (a.scheduledAt ?? a.occurredAt).localeCompare(b.scheduledAt ?? b.occurredAt)); }
}


