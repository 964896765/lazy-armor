import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { conversationOnceRequests, consumerConversations, consumerMessages, executions, plans, planVersions, planActions, users } from '@lazy-armor/database';
import { compileActionProposal, canonicalStringify, projectConsumerOutcome } from '@lazy-armor/plan-schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ExecutionDispatchService } from '../execution/execution-dispatch.service';
import { ExecutionsService } from '../execution/executions.service';
import { ReconciliationService } from '../execution/reconciliation.service';
import { CapabilityResolverService } from '../capability-resolver/capability-resolver.service';
import type { RunConversationOnceDto } from './dto';
import { PlansService } from '../plans/plans.service';
import { AuditService } from '../audit/audit.service';

/** Only request identity and immutable references live here. Runtime state belongs to Execution. */
@Injectable()
export class ConversationOnceService {
 constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly dispatch: ExecutionDispatchService, private readonly executionReader: ExecutionsService, private readonly verification: ReconciliationService, private readonly resolver: CapabilityResolverService, private readonly planAuthority: PlansService, private readonly audit: AuditService) {}
 async confirmProposal(userId: string, conversationId: string, input: { messageId: string; version: number; confirmed: boolean }) {
  if (!input.confirmed) throw new BadRequestException('请先确认一次性操作草案');
  const task = await this.db.transaction(async tx => {
   await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.status, 'active'))).for('update');
   const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!conversation) throw new NotFoundException('会话不存在');
   const prior = (await tx.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.userId, userId), eq(conversationOnceRequests.proposalMessageId, input.messageId))))[0];
   if (prior) { if (prior.conversationId !== conversationId) throw new ConflictException('提案不属于当前会话'); return prior; }
   if (conversation.mode !== 'TEMPORARY' || conversation.status !== 'ACTIVE' || conversation.version !== input.version) throw new ConflictException('会话已更新，请重新生成操作草案');
   const latest = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt)).limit(1))[0];
   if (latest?.id !== input.messageId || latest.structuredPayload?.result !== 'ACTION_PROPOSAL') throw new ConflictException('仅可确认当前操作草案');
   const { proposal, definition } = compileActionProposal(latest.structuredPayload.actionProposal);
   const created = await this.planAuthority.createInTransaction(userId, definition, tx, 'ONCE');
   const triggerPayload = !proposal.connectionId ? { humanSummary: proposal.input.title ?? proposal.name, resultSummary: proposal.input.message } : proposal.input;
   const row = { id: newId(), userId, conversationId, proposalMessageId: latest.id, planId: created.planId, planVersionId: created.planVersionId, requestId: `action:${latest.id}`, inputHash: createHash('sha256').update(canonicalStringify(proposal)).digest('hex'), triggerPayload, createdAt: new Date() };
   await tx.insert(conversationOnceRequests).values(row);
   await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'ACTION_PROPOSAL_CONFIRMED', resourceType: 'conversation_once_request', resourceId: row.id, correlationId: row.id, after: { proposalMessageId: latest.id, planVersionId: created.planVersionId, inputHash: row.inputHash }, changeSummary: 'Confirmed one-time proposal; execution approval remains required', source: 'api', result: 'success' }, tx);
   return row;
  });
  return this.dispatchProposal(userId, task.id);
 }
 async dispatchProposal(userId: string, taskId: string) {
  const task = (await this.db.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.id, taskId), eq(conversationOnceRequests.userId, userId))).limit(1))[0];
  if (!task?.proposalMessageId) throw new NotFoundException('一次性操作草案不存在');
  const prior = (await this.db.select({ id: executions.id }).from(executions).where(and(eq(executions.userId, userId), eq(executions.requestId, `once:${task.id}`))).limit(1))[0];
  if (!prior) {
   const actions = await this.db.select().from(planActions).where(eq(planActions.planVersionId, task.planVersionId));
   const decisions: string[] = [];
   for (const action of actions) {
    if (!action.requiredCapability) continue;
    const resolution = await this.resolver.resolve(userId, { planVersionId: task.planVersionId, requestKey: `once:${task.id}:${action.id}`, requirement: { schemaVersion: '1', capabilityKey: action.requiredCapability, resource: typeof action.configJson?.resource === 'string' ? action.configJson.resource : action.actionType, operation: 'execute', fields: [], purpose: 'CONFIRMED_ACTION_PROPOSAL', minimumReality: 'VERIFIED', maxAgeSeconds: 300, maxRisk: 'R4', maxCostMicros: 0, preferredProviders: [], preferredSourceModes: [] } });
    const selected = await this.resolver.revalidate(userId, resolution.id);
    if (selected.candidate.id !== `${action.connectionId}:${action.requiredCapability}`) throw new ConflictException('能力与冻结连接不一致');
    decisions.push(resolution.id);
   }
   await this.dispatch.dispatchActionProposal(userId, task.id, decisions);
  }
  return this.get(userId, task.id);
 }
 async options(userId: string) { return this.db.select({ planId: plans.id, planVersionId: planVersions.id, name: planVersions.name, description: planVersions.description }).from(plans).innerJoin(planVersions, eq(plans.activeVersionId, planVersions.id)).where(and(eq(plans.userId, userId), eq(plans.status, 'active'))); }
 async run(userId: string, conversationId: string, input: RunConversationOnceDto) {
  if (!input.confirmed) throw new BadRequestException('需要明确确认本次运行，后续风险审批仍需单独处理');
  const inputHash = createHash('sha256').update(canonicalStringify({ conversationId, planId: input.planId, planVersionId: input.planVersionId, triggerPayload: input.triggerPayload })).digest('hex');
  const task = await this.db.transaction(async tx => {
   if (!(await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.status, 'active'))).for('update'))[0]) throw new NotFoundException('账号不可用');
   const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
   if (!conversation) throw new NotFoundException('会话不存在');
   const prior = (await tx.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.userId, userId), eq(conversationOnceRequests.requestId, input.requestId))))[0];
   if (prior) { if (prior.inputHash !== inputHash) throw new ConflictException('同一运行请求不能改变计划版本或输入'); return prior; }
   if (conversation.mode !== 'TEMPORARY') throw new BadRequestException('一次性运行请使用临时会话');
   const plan = (await tx.select().from(plans).where(and(eq(plans.id, input.planId), eq(plans.userId, userId))).for('update'))[0];
   if (!plan) throw new NotFoundException('计划不存在');
   if (plan.status !== 'active' || plan.activeVersionId !== input.planVersionId) throw new ConflictException('计划未运行或版本已变化，请重新选择');
   const task = { id: newId(), userId, conversationId, planId: input.planId, planVersionId: input.planVersionId, requestId: input.requestId, inputHash, triggerPayload: input.triggerPayload, createdAt: new Date() };
   await tx.insert(conversationOnceRequests).values(task); return task;
  });
  const dispatched = (await this.db.select({ id: executions.id }).from(executions).where(and(eq(executions.userId, userId), eq(executions.requestId, `once:${task.id}`))).limit(1))[0];
  if (!dispatched) {
   const actions = await this.db.select().from(planActions).where(eq(planActions.planVersionId, task.planVersionId));
   const decisions: string[] = [];
   for (const action of actions) {
    if (!action.requiredCapability) continue;
    if (!action.connectionId) throw new ConflictException('所需能力缺少真实连接');
    const config = action.configJson ?? {};
    const resolution = await this.resolver.resolve(userId, { planVersionId: task.planVersionId, requestKey: `once:${task.id}:${action.id}`, requirement: { schemaVersion: '1', capabilityKey: action.requiredCapability, resource: typeof config.resource === 'string' ? config.resource : action.actionType, operation: 'execute', fields: [], purpose: 'USER_CONFIRMED_ONE_TIME_RUN', minimumReality: 'VERIFIED', maxAgeSeconds: 300, maxRisk: 'R4', maxCostMicros: 0, preferredProviders: [], preferredSourceModes: [] } });
    const selected = await this.resolver.revalidate(userId, resolution.id);
    if (selected.candidate.id !== `${action.connectionId}:${action.requiredCapability}`) throw new ConflictException('能力解析与确认的连接不一致，需要重新选择');
    decisions.push(resolution.id);
   }
   await this.dispatch.dispatchManual(userId, task.planId, `once:${task.id}`, task.triggerPayload, decisions, task.planVersionId);
  }
  return this.get(userId, task.id);
 }
 async list(userId: string, conversationId: string) {
  if (!(await this.db.select({ id: consumerConversations.id }).from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).limit(1))[0]) throw new NotFoundException('会话不存在');
  const rows = await this.db.select({ id: conversationOnceRequests.id }).from(conversationOnceRequests).where(and(eq(conversationOnceRequests.userId, userId), eq(conversationOnceRequests.conversationId, conversationId))).orderBy(desc(conversationOnceRequests.createdAt));
  return Promise.all(rows.map(row => this.get(userId, row.id)));
 }
 async get(userId: string, id: string) {
  const task = (await this.db.select().from(conversationOnceRequests).where(and(eq(conversationOnceRequests.id, id), eq(conversationOnceRequests.userId, userId))).limit(1))[0];
  if (!task) throw new NotFoundException('运行请求不存在');
  const execution = (await this.db.select({ id: executions.id }).from(executions).where(and(eq(executions.userId, userId), eq(executions.requestId, `once:${id}`))).limit(1))[0];
  if (!execution) return { id, conversationId: task.conversationId, planId: task.planId, planVersionId: task.planVersionId, executionId: null, status: '需要检查能力或重新确认', outcome: null };
  const [detail, result] = await Promise.all([this.executionReader.get(userId, execution.id), this.verification.executionResult(userId, execution.id)]);
  const outcome = projectConsumerOutcome({ executionStatus: detail.status, approvalStatus: detail.approvalStatus, resultState: result.resultState, reconciliationOpen: result.reconciliationCases.some(item => ['OPEN', 'RECONCILING'].includes(item.status)), reconciliationNeedsUser: result.reconciliationCases.some(item => item.status === 'NEEDS_USER'), completedSteps: result.completedSteps, failedSteps: result.failedSteps });
  const pendingApproval = detail.approvals.find(item => item.status === 'pending');
  const primaryAction = detail.status === 'waiting_approval' && pendingApproval ? { label: '查看并确认本次操作', path: `/approvals/${pendingApproval.id}` } : { label: '查看运行与验证', path: `/executions/${execution.id}` };
  return { id, conversationId: task.conversationId, planId: task.planId, planVersionId: task.planVersionId, executionId: execution.id, status: outcome.title, outcome, primaryAction };
 }
}
