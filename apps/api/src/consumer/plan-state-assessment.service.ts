import { LifecycleReadService } from '../plans/lifecycle-read.service';
import {assessPlanAvailability,authorityNextBestAction,type SourceSelection} from '@lazy-armor/plan-schema';
import {Inject,Injectable} from '@nestjs/common';
import {plans,planCreationContracts,executions} from '@lazy-armor/database';
import {and,eq,desc} from 'drizzle-orm';
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
  return results;
 }
}
