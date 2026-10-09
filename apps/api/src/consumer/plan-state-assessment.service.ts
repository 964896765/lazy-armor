import { LifecycleReadService } from '../plans/lifecycle-read.service';
import {assessPlanAvailability,authorityNextBestAction,type SourceSelection} from '@lazy-armor/plan-schema';
import {Inject,Injectable} from '@nestjs/common';
import {plans,planCreationContracts,executions,strategyRuntimeWakeups,auditLogs} from '@lazy-armor/database';
import {and,eq,desc,inArray} from 'drizzle-orm';
import {DATABASE,type InjectedDatabase} from '../common/database.module';
import {FactDemandResolverService} from '../fact-demands/fact-demand-resolver.service';
import type {ScenarioGoalSpec,ScenarioResourceSubject,StateAssessment,NextBestAction} from '@lazy-armor/plan-schema';
export interface RunningPlanAssessment {planId:string;planVersionId:string|null;assessment:StateAssessment;nextBestAction:NextBestAction;authority:'PlanCreationContract';evaluatedAt:string;}
/** Read-only projection: missing contracts or evidence remain UNKNOWN, never runtime success. */
@Injectable()
export class PlanStateAssessmentService {
 constructor(@Inject(DATABASE)private readonly db:InjectedDatabase,private readonly resolver:FactDemandResolverService,private readonly lifecycleRead:LifecycleReadService){}
 async project(userId:string):Promise<RunningPlanAssessment[]>{
  const rows=await this.db.select({plan:plans,contract:planCreationContracts}).from(plans).leftJoin(planCreationContracts,and(eq(planCreationContracts.userId,userId),eq(planCreationContracts.planId,plans.id),eq(planCreationContracts.planVersionId,plans.activeVersionId))).where(and(eq(plans.userId,userId),eq(plans.status,'active')));
  const results:RunningPlanAssessment[]=[];
  for(const {plan,contract} of rows){
   const fallback:RunningPlanAssessment={planId:plan.id,planVersionId:plan.activeVersionId,authority:'PlanCreationContract',evaluatedAt:new Date().toISOString(),assessment:{state:'UNKNOWN',reason:contract?'本轮来源评估未完成，不能判断是否有待办':'当前运行版本尚未关联需求与来源合同',coverage:[],evidenceRefs:contract?['plan-contract:'+contract.id]:[]},nextBestAction:contract?'REFRESH_SOURCE':'ASK_USER'};
   if(!contract){results.push(fallback);continue;}
   try{const evaluated=await this.resolver.resolve(userId,{scenarioKey:contract.scenarioKey,scenarioRevision:contract.scenarioRevision,goal:contract.goalJson as unknown as ScenarioGoalSpec,subject:contract.subjectJson as unknown as ScenarioResourceSubject},Object.fromEntries((contract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null}>).map(source=>[source.factKey??(contract.factDemandsJson as Array<{demandId:string;factKey:string}>).find(fact=>fact.demandId===source.demandId)?.factKey??source.demandId,source.selectedSourceId])));const availability=assessPlanAvailability({expectedContractHash:contract.contractHash,currentContractHash:evaluated.contractHash,previousSelections:contract.sourceSelectionJson as unknown as Array<{demandId:string;selectedSourceId:string|null;selectedSource:SourceSelection|null}>,currentDemands:evaluated.demands,evaluatedAt:evaluated.evaluatedAt});if(availability.state!=='CURRENT'){results.push({...fallback,evaluatedAt:evaluated.evaluatedAt,assessment:{...evaluated.stateAssessment,state:'BLOCKED',reason:'计划来源或事实需要重新确认'},nextBestAction:contract.contractHash===evaluated.contractHash?'REFRESH_SOURCE':'ASK_USER'});continue;}const run=(await this.db.select().from(executions).where(and(eq(executions.userId,userId),eq(executions.planId,plan.id),eq(executions.planVersionId,plan.activeVersionId!))).orderBy(desc(executions.createdAt),desc(executions.id)).limit(1))[0];const lifecycle=run?await this.lifecycleRead.forExecution(userId,run.id):null;const approval=lifecycle?.lifecycle.steps.find(step=>step.key==='APPROVAL');const recommendation=authorityNextBestAction({coverage:evaluated.acquisitionCoverage,verifiedComplete:false,hasConflict:evaluated.demands.some(demand=>demand.state==='CONFLICT'),approvalRequired:approval?.state==='RUNNING',approvalGranted:approval?.state==='SUCCEEDED',executionAuthorized:false,due:evaluated.ruleResults.find(rule=>rule.rule.kind==='TIME')?.matched??null,thresholdExceeded:evaluated.ruleResults.find(rule=>rule.rule.kind==='THRESHOLD')?.matched??null,changed:null,serviceAvailable:false},run&&lifecycle?{executionId:run.id,executionStatus:run.status,lifecycle:lifecycle.lifecycle}:null,true);results.push({...fallback,evaluatedAt:evaluated.evaluatedAt,assessment:{...evaluated.stateAssessment,evidenceRefs:[...evaluated.stateAssessment.evidenceRefs,'plan-contract:'+contract.id,...(run?['execution:'+run.id]:[])]},nextBestAction:recommendation});}
   catch{results.push(fallback);}
  }
  // An in-flight approval or reconciliation remains actionable even when a source
  // assessment is blocked. A verified past run never completes a recurring Plan.
  for(const result of results){
   if(!result.planVersionId)continue;
   try{
    const run=(await this.db.select().from(executions).where(and(eq(executions.userId,userId),eq(executions.planId,result.planId),eq(executions.planVersionId,result.planVersionId))).orderBy(desc(executions.createdAt),desc(executions.id)).limit(1))[0];
    if(!run)continue;
    const projection=await this.lifecycleRead.forExecution(userId,run.id);
    const verified=projection.lifecycle.steps.some(step=>step.key==='VERIFICATION'&&step.state==='SUCCEEDED');
    const complete=projection.lifecycle.steps.some(step=>step.key==='RESULT'&&step.state==='SUCCEEDED');
    result.assessment={...result.assessment,evidenceRefs:[...new Set([...result.assessment.evidenceRefs,'execution:'+run.id])]};
    if(verified&&complete)continue;
    result.nextBestAction=authorityNextBestAction({coverage:result.assessment.coverage,verifiedComplete:false,hasConflict:result.assessment.coverage.some(row=>row.state==='CONFLICT'),approvalRequired:false,approvalGranted:false,executionAuthorized:false,due:null,thresholdExceeded:null,changed:null,serviceAvailable:false},{executionId:run.id,executionStatus:run.status,lifecycle:projection.lifecycle},true);
   }catch{result.nextBestAction='RECONCILE';}
  }
  const versionIds=results.flatMap(result=>result.planVersionId?[result.planVersionId]:[]);
  if(versionIds.length){
   const waits=await this.db.select({id:strategyRuntimeWakeups.id,planVersionId:strategyRuntimeWakeups.planVersionId})
     .from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.userId,userId),inArray(strategyRuntimeWakeups.planVersionId,versionIds),eq(strategyRuntimeWakeups.handoffStatus,'PENDING'),eq(strategyRuntimeWakeups.handoffReason,'WAITING_RESOURCE')));
   for(const result of results){
    const wait=waits.find(row=>row.planVersionId===result.planVersionId);
    if(wait&&result.nextBestAction!=='REQUEST_APPROVAL'&&result.nextBestAction!=='RECONCILE'){
     result.assessment={...result.assessment,state:'BLOCKED',reason:'执行资源需要授权或恢复，本次尚未写入',evidenceRefs:[...result.assessment.evidenceRefs,'strategy-wakeup:'+wait.id]};
     result.nextBestAction='CONNECT_RESOURCE';
    }
   }
  }
  // Notification watch checkpoints derive from the same confirmed PlanVersion.
  // Empty acquisition means wait for facts, never a completed logistics goal.
  for(const {plan,contract} of rows){
   if((contract?.goalJson.constraints as Record<string,unknown>|undefined)?.recipeKey!=='notification.shipment-watch.v1')continue;
   const result=results.find(row=>row.planId===plan.id);
   if(!result||!result.planVersionId)continue;
   const checkpoint=(await this.db.select().from(auditLogs).where(and(eq(auditLogs.userId,userId),eq(auditLogs.resourceId,result.planVersionId),eq(auditLogs.action,'PERSISTENT_NOTIFICATION_RESOURCE_STATE'))).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)).limit(1))[0];
   if(!checkpoint?.afterSnapshotJson)continue;
   const state=String(checkpoint.afterSnapshotJson.state),reasons=Array.isArray(checkpoint.afterSnapshotJson.reasons)?checkpoint.afterSnapshotJson.reasons as string[]:[];
   if(state==='WAITING_RESOURCE'){
    const labels:Record<string,string>={NOTIFICATION_ACCESS_REQUIRED:'需要开启 Android 通知访问权限',NOTIFICATION_GRANT_REQUIRED:'需要允许读取本机通知',NOTIFICATION_COLLECTION_UNAVAILABLE:'需要恢复消息获取开关或通知监听器',WAITING_DEVICE:'正在等待原手机上线',APP_SOURCE_GRANT_REQUIRED:'需要授权京东通知来源',FROZEN_SOURCE_CHANGED:'原通知来源已变化，需要恢复原来源',READ_ATTEMPT_LIMIT_REACHED:'读取恢复次数已达上限，需要核对来源'};
    result.assessment={...result.assessment,state:'BLOCKED',reason:reasons.map(reason=>labels[reason]).filter(Boolean).join('；')||'原通知来源需要恢复；计划已保存，恢复后自动继续'};
    result.nextBestAction='CONNECT_RESOURCE';
   }else if(state==='WAITING_FACT_CONFIRMATION'){
    result.assessment={...result.assessment,state:'NEEDS_ATTENTION',reason:'读取到京东通知候选，核实后才判断是否需要提醒'};result.nextBestAction='ASK_USER';
   }else if(state==='READ_FAILED'){
    result.assessment={...result.assessment,state:'UNKNOWN',reason:'本次通知读取未完成，不能判断物流状态'};result.nextBestAction='REFRESH_SOURCE';
   }else if(state==='READ_PENDING'||state==='WAITING_FACT_CHANGE'){
    result.assessment={...result.assessment,state:'UNKNOWN',reason:state==='READ_PENDING'?'正在读取原计划授权的京东通知':'正在等待新的已核实京东物流通知；当前读取范围不能证明没有快递'};result.nextBestAction='WAIT';
   }
   result.assessment={...result.assessment,evidenceRefs:[...result.assessment.evidenceRefs,'notification-checkpoint:'+checkpoint.id]};
  }
  return results;
 }
}
