import { Inject, Injectable } from '@nestjs/common';
import { acquisitionRounds, approvalRequests, auditLogs, capabilityInvocations, consumerConversations, executions, planCreationContracts, reconciliationCases, runtimeResults, runtimeTargets } from '@lazy-armor/database';
import { normalizeLocalSourceId, notificationWatchAuthoringSchema, persistentPlanOfferRequestSchema } from '@lazy-armor/plan-schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { PlansService } from './plans.service';
import { PlanDefinitionAssembler } from './plan-definition.assembler';

/** Owner/version-scoped read model. No dispatch, authorization or Truth writes. */
@Injectable()
export class PlanControlProjectionService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly plans: PlansService, private readonly assembler: PlanDefinitionAssembler,
    private readonly facts: FactDemandResolverService) {}

  async forPlan(userId: string, planId: string) {
    const summary = await this.plans.get(userId, planId); // canonical owner check
    const versionId = (summary.status === 'active' ? summary.activeVersionId : summary.currentVersionId) ?? summary.currentVersionId;
    if (!versionId) return { state: 'NOT_CONFIGURED', planId, information:[],resources:[],records:[],manualRunAllowed:false };
    const version = await this.assembler.assembleById(userId, planId, versionId);
    const [contracts, conversations, runs, activity, approvals, unknowns, invocations] = await Promise.all([
      this.db.select().from(planCreationContracts).where(and(eq(planCreationContracts.userId,userId),eq(planCreationContracts.planVersionId,versionId))).limit(1),
      this.db.select({id:consumerConversations.id}).from(consumerConversations).where(and(eq(consumerConversations.userId,userId),eq(consumerConversations.planId,planId))).limit(1),
      this.db.select({id:executions.id,planVersionId:executions.planVersionId,status:executions.status,createdAt:executions.createdAt,resultSummary:executions.resultSummary})
        .from(executions).where(and(eq(executions.userId,userId),eq(executions.planId,planId))).orderBy(desc(executions.createdAt),desc(executions.id)).limit(10),
      this.db.select({id:executions.id}).from(executions).where(and(eq(executions.userId,userId),eq(executions.planId,planId),inArray(executions.status,['created','queued','running','waiting_approval','waiting_dispatch','retry_wait']))).limit(1),
      this.db.select({id:approvalRequests.id}).from(approvalRequests).innerJoin(executions,eq(approvalRequests.executionId,executions.id))
        .where(and(eq(approvalRequests.userId,userId),eq(executions.userId,userId),eq(executions.planId,planId),eq(approvalRequests.status,'pending'))).limit(1),
      this.db.select({id:reconciliationCases.id}).from(reconciliationCases).innerJoin(executions,eq(reconciliationCases.executionId,executions.id))
        .where(and(eq(reconciliationCases.userId,userId),eq(executions.userId,userId),eq(executions.planId,planId),inArray(reconciliationCases.status,['OPEN','RECONCILING','NEEDS_USER']))).limit(1),
      this.db.select({invocation:capabilityInvocations,target:runtimeTargets,result:runtimeResults}).from(capabilityInvocations)
        .innerJoin(runtimeTargets,and(eq(capabilityInvocations.targetId,runtimeTargets.id),eq(runtimeTargets.userId,userId)))
        .leftJoin(runtimeResults,and(eq(runtimeResults.invocationId,capabilityInvocations.id),eq(runtimeResults.userId,userId)))
        .where(and(eq(capabilityInvocations.userId,userId),eq(capabilityInvocations.planId,planId)))
        .orderBy(desc(capabilityInvocations.createdAt),desc(capabilityInvocations.id)).limit(100),
    ]);
    const contract = contracts[0];
    const parsed = contract && persistentPlanOfferRequestSchema.safeParse({scenarioKey:contract.scenarioKey,scenarioRevision:contract.scenarioRevision,goal:contract.goalJson,subject:contract.subjectJson});
    // A legacy/malformed contract cannot produce invented fact evidence.
    const resolution = parsed?.success ? await this.facts.resolve(userId,parsed.data,Object.fromEntries(contract!.sourceSelectionJson.map(selection=>[
      String(selection.factKey ?? contract!.factDemandsJson.find(d=>d.demandId===selection.demandId)?.factKey ?? selection.demandId),
      typeof selection.selectedSourceId==='string'?selection.selectedSourceId:null,
    ]))) : null;
    const resolved=resolution?.contractHash===contract?.contractHash?resolution:null;
    const currentInvocations = invocations.filter(row=>row.invocation.planVersionId===versionId);
    const rounds: Array<typeof acquisitionRounds.$inferSelect> = [];
    for (const row of currentInvocations.filter(row=>row.invocation.capabilityId==='calendar.event.read' && row.result?.verificationState==='VERIFIED').slice(0,5)) {
      const ref = row.result!.evidenceRefs.find(ref=>ref.startsWith('acquisition:'));
      if (!ref) continue;
      const round = (await this.db.select().from(acquisitionRounds).where(and(eq(acquisitionRounds.userId,userId),eq(acquisitionRounds.id,ref.slice(12)))).limit(1))[0];
      if (round) rounds.push(round);
    }
    const information = resolved?.demands.map(demand=>{
      const truth = demand.truthEvidence.filter(t=>t.verified && !t.conflict).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
      const frozen = contract!.sourceSelectionJson.find(source=>source.factKey===demand.factKey||source.demandId===demand.demandId);
      const selectedId=typeof frozen?.selectedSourceId==='string'?frozen.selectedSourceId:demand.selectedSourceId;
      const candidate=demand.candidateSources.find(source=>source.sourceId===selectedId);
      const round = rounds.find(round=>normalizeLocalSourceId(round.sourceId)===selectedId && round.observedAt?.toISOString()===truth?.observedAt);
      const provider = candidate?.providerKey;
      const local = candidate?.kind==='NATIVE_DEVICE'||candidate?.kind==='TRUSTED_DEVICE'||selectedId?.startsWith('local:');
      return {factKey:demand.factKey,label:demand.factKey.startsWith('calendar_event.')?'日历安排':'计划所需信息',
        sourceLabel:local?(demand.factKey.startsWith('calendar_event.')?'本机日历':'本机信息'):provider==='google_calendar'?'Google Calendar':provider?'已选信息来源':'尚未选择来源',
        state:demand.state,verified:Boolean(truth),observedAt:truth?.observedAt??null,truthVersionId:truth?.truthVersionId??null,
        itemCount:round?.itemCount??null,maximumAgeSeconds:demand.maximumAgeSeconds};
    }) ?? [];
    const resources = [...new Map(currentInvocations.slice().reverse().map(row=>[row.invocation.capabilityId,{
      capabilityId:row.invocation.capabilityId,targetId:row.target.id,
      name:row.target.targetType==='ANDROID_DEVICE'?(row.invocation.capabilityId.startsWith('calendar.event.')?'本机日历':'本机'):typeof row.target.metadata.name==='string'?row.target.metadata.name:row.target.targetType==='PROVIDER_CONNECTION'?'云端资源':'执行资源',
      targetType:row.target.targetType,health:row.target.health,onlineState:row.target.onlineState,
      lastUsedAt:row.invocation.createdAt.toISOString(),executionId:row.invocation.executionId,
      verificationState:row.result?.verificationState??'NOT_VERIFIED',
    }])).values()];
    const records = runs.map(run=>{
      const results = invocations.filter(row=>row.invocation.executionId===run.id).map(row=>row.result);
      const unknown = results.some(result=>result?.verificationState==='OUTCOME_UNKNOWN');
      return {...run,createdAt:run.createdAt.toISOString(),verificationState:unknown?'OUTCOME_UNKNOWN':results.length>0&&results.every(result=>result?.verificationState==='VERIFIED')?'VERIFIED':'NOT_VERIFIED',
        capabilityIds:[...new Set(invocations.filter(row=>row.invocation.executionId===run.id).map(row=>row.invocation.capabilityId))]};
    });
    const capabilities = version.definition.actions.map(action=>action.requiredCapability).filter((c):c is string=>Boolean(c));
    // A new run has a new idempotency key. Do not claim duplicate-free external
    // writes merely because an earlier Invocation was idempotent.
    const hasExternalWrite = capabilities.some(c=>!/(\.read|\.list|\.get)$/.test(c))
      || version.definition.actions.some(a=>!['summarize','compare','classify'].includes(a.actionType));
    const blocked = activity.length>0||approvals.length>0||unknowns.length>0;
    const notificationWatchState = summary.status === 'active'
      ? await this.notificationWatchProjection(userId, versionId, contract) : undefined;
    return {state:'AVAILABLE',planId,planVersionId:versionId,evaluatedAt:new Date().toISOString(),
      origin:{label:version.version.templateKey?'历史模板计划':'自定义计划',detail:conversations.length?'由会话创建':version.version.templateKey?'保留原版本合同':'用户创建',skillVersion:null},
      goalDescription:typeof contract?.goalJson.description==='string'?contract.goalJson.description:version.version.description??version.version.name,
      information,informationState:resolved?'AVAILABLE':contract?'INVALID_CONTRACT':'LEGACY_NOT_BOUND',resources,
      ...(notificationWatchState ? { notificationWatchState } : {}),
      resourcePolicy:'按能力要求选择已授权资源；以下为最近实际使用记录',records,
      manualRunAllowed:summary.status==='active'&&!blocked&&!hasExternalWrite&&(!contract||Boolean(resolved)),
      manualRunReason:blocked?'仍有运行、审批或结果核对待处理':hasExternalWrite?'含外部写入，按计划调度并确认，避免重复副作用':summary.status!=='active'?'计划尚未运行':contract&&!resolved?'计划信息合同未通过校验':'',
    };
  }

  private async notificationWatchProjection(userId: string, versionId: string, contract: typeof planCreationContracts.$inferSelect | undefined) {
    const constraints = contract?.goalJson.constraints as Record<string, unknown> | undefined;
    if (constraints?.recipeKey !== 'notification.shipment-watch.v1') return undefined;
    const wait = (reason: string) => ({ state: 'WAITING_RESOURCE', label: '等待资源恢复', reason, nextStep: `${reason}；恢复后自动继续原计划` });
    let parameters;
    try { parameters = notificationWatchAuthoringSchema.parse(JSON.parse(String(constraints.notificationWatchJson))); }
    catch { return wait('原通知来源需要核对'); }
    // A historical successful read cannot override a current permission loss.
    // Resolve against the frozen source identity, never substitute another phone.
    let availability: Awaited<ReturnType<FactDemandResolverService['resolveNotificationQuery']>>;
    try { availability = await this.facts.resolveNotificationQuery(userId, parameters.sourcePackage); }
    catch { return wait('暂时无法核对通知来源状态'); }
    if (availability.state !== 'RESOLVED' || availability.selected?.connectionId !== parameters.connectionId || availability.selected.trustedDeviceId !== parameters.trustedDeviceId) {
      const labels: Record<string, string> = {
        NOTIFICATION_ACCESS_REQUIRED: '需要开启 Android 通知访问权限',
        NOTIFICATION_GRANT_REQUIRED: '需要允许读取本机通知',
        NOTIFICATION_COLLECTION_UNAVAILABLE: '需要恢复消息获取开关或通知监听器',
        WAITING_DEVICE: '正在等待原手机上线',
        APP_SOURCE_REQUIRED: '需要连接原京东通知来源',
        APP_SOURCE_GRANT_REQUIRED: '需要授权京东通知来源',
        TRUSTED_DEVICE_REQUIRED: '需要恢复原手机连接',
        FRESH_CAPABILITY_EVIDENCE_REQUIRED: '正在等待手机更新通知权限状态',
        FRESH_APP_DISCOVERY_REQUIRED: '正在等待手机更新京东来源状态',
        RUNTIME_TARGET_REQUIRED: '需要恢复原手机连接',
        AMBIGUOUS_NOTIFICATION_DEVICE: '需要核对京东通知来源',
      };
      return wait(availability.reasons.map(reason => labels[reason]).filter(Boolean).join('；') || '原京东通知来源需要恢复');
    }
    const checkpoint = (await this.db.select().from(auditLogs).where(and(
      eq(auditLogs.userId, userId), eq(auditLogs.resourceType, 'plan_version'), eq(auditLogs.resourceId, versionId),
      eq(auditLogs.action, 'PERSISTENT_NOTIFICATION_RESOURCE_STATE'),
    )).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1))[0]?.afterSnapshotJson;
    const valid = checkpoint?.schema === 'plan-notification-gap.v1' && checkpoint.planVersionId === versionId;
    const state = valid ? String(checkpoint.state) : '';
    if (state === 'WAITING_FACT_CONFIRMATION') return { state, label: '需要核实物流线索', reason: '已读取到京东通知候选，尚未核实', nextStep: '核实通知中的物流线索后，再判断是否需要提醒' };
    if (state === 'READ_PENDING') return { state, label: '正在读取通知', reason: '正在只读获取原计划授权的京东通知', nextStep: '读取已授权的京东通知；发现物流候选后先核实' };
    if (state === 'WAITING_FACT_CHANGE') return { state, label: '等待新物流线索', reason: '当前通知读取范围不能证明没有快递', nextStep: '等待新的已核实京东物流通知；当前读取范围不能证明没有快递' };
    if (state === 'READ_FAILED') return { state, label: '本次读取未完成', reason: '本次通知读取未完成，不能判断物流状态', nextStep: '保留原计划，等待下次只读检查；暂不能判断物流状态' };
    return { state: 'WAITING_READ', label: '等待通知检查', reason: '原通知来源已恢复，等待计划自动继续', nextStep: '自动继续原计划，读取已授权的京东通知' };
  }
}
