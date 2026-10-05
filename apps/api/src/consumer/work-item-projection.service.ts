import {PlanStateAssessmentService} from './plan-state-assessment.service';
import { LifecycleReadService } from '../plans/lifecycle-read.service';
import {DraftGapProjectionService} from '../creation-drafts/draft-gap-projection.service';
import {Inject,Injectable} from '@nestjs/common';
import {conversationOnceRequests,approvalRequests,executions,reconciliationCases,consumerServiceRequests,consumerMessages,consumerConversations,creationDrafts,importantItemCandidates} from '@lazy-armor/database';
import {authorityNextBestAction,workItemNextAction,NEXT_ACTION_LABELS,type WorkItemProjection,type WorkItemKind,type NextBestAction} from '@lazy-armor/plan-schema';
import {and,desc,eq,isNull} from 'drizzle-orm';
import {DATABASE,type InjectedDatabase} from '../common/database.module';
import {ConsumerService} from './consumer.service';
@Injectable()
export class WorkItemProjectionService {
 constructor(@Inject(DATABASE)private readonly db:InjectedDatabase,private readonly consumer:ConsumerService,private readonly planAssessments:PlanStateAssessmentService,private readonly gaps:DraftGapProjectionService,private readonly lifecycleRead:LifecycleReadService){}
 async project(userId:string){
  const [assessments,library,approvals,runs,cases,requests,drafts,reminders,messages,confirmed]=await Promise.all([
   this.planAssessments.project(userId),this.consumer.planLibrary(userId),
   this.db.select().from(approvalRequests).where(eq(approvalRequests.userId,userId)).orderBy(desc(approvalRequests.updatedAt)).limit(100),
   this.db.select().from(executions).where(eq(executions.userId,userId)).orderBy(desc(executions.updatedAt)).limit(100),
   this.db.select().from(reconciliationCases).where(eq(reconciliationCases.userId,userId)).orderBy(desc(reconciliationCases.updatedAt)).limit(100),
   this.consumer.requests(userId),
   this.db.select().from(creationDrafts).where(and(eq(creationDrafts.userId,userId),eq(creationDrafts.state,'ACTIVE'))).orderBy(desc(creationDrafts.updatedAt)).limit(100),
   this.db.select().from(importantItemCandidates).where(eq(importantItemCandidates.userId,userId)).orderBy(desc(importantItemCandidates.createdAt)).limit(100),
   this.db.select({message:consumerMessages,conversation:consumerConversations}).from(consumerMessages).innerJoin(consumerConversations,eq(consumerMessages.conversationId,consumerConversations.id)).where(and(eq(consumerConversations.userId,userId),isNull(consumerConversations.deletedAt),eq(consumerMessages.role,'assistant'))).orderBy(desc(consumerMessages.createdAt)).limit(100),
   this.db.select({messageId:conversationOnceRequests.proposalMessageId}).from(conversationOnceRequests).where(eq(conversationOnceRequests.userId,userId)).limit(1000),
  ]);
  const confirmedIds=new Set(confirmed.map(row=>row.messageId));
  const evaluatedAt=new Date().toISOString();const items:WorkItemProjection[]=[];
  function add(kind:WorkItemKind,id:string,title:string,status:string,date:Date|string,path:string,recommendedAction?:NextBestAction){const nextAction=recommendedAction??workItemNextAction(kind,status);items.push({id:kind+':'+id,kind,title,status,nextAction,nextActionLabel:NEXT_ACTION_LABELS[nextAction],sourceRef:{type:kind,id},evidenceRefs:[kind+':'+id],updatedAt:date instanceof Date?date.toISOString():date,primaryAction:{label:NEXT_ACTION_LABELS[nextAction],path}});}
  const assessmentByPlan=new Map(assessments.map(row=>[row.planId,row]));
  for(const plan of library.plans){const evaluation=assessmentByPlan.get(plan.planId);add('Plan',plan.planId,plan.title,plan.status,plan.updatedAt,plan.primaryAction.path,evaluation?.nextBestAction);if(evaluation)items[items.length-1]={...items[items.length-1]!,assessment:evaluation.assessment,evidenceRefs:[...items[items.length-1]!.evidenceRefs,...evaluation.assessment.evidenceRefs]};}
  for(const row of approvals)add('Approval',row.id,row.actionSummary,row.status,row.updatedAt,'/approvals/'+row.id);
  for(const row of runs){
   try{
    const projection=await this.lifecycleRead.forExecution(userId,row.id);
    const action=authorityNextBestAction({coverage:[],verifiedComplete:false,hasConflict:false,approvalRequired:false,approvalGranted:false,executionAuthorized:false,due:null,thresholdExceeded:null,changed:null,serviceAvailable:false},{executionId:row.id,executionStatus:row.status,lifecycle:projection.lifecycle});
    add('Execution',row.id,row.resultSummary??'计划执行',row.status,row.updatedAt,'/executions/'+row.id,action);
   }catch{
    add('Execution',row.id,row.resultSummary??'计划执行',row.status,row.updatedAt,'/executions/'+row.id,'RECONCILE');
   }
  }
  for(const row of cases)add('Reconciliation',row.id,'执行结果待核实',row.status,row.updatedAt,'/reconciliation/'+row.id);
  for(const {request:row,offering} of requests)add('ServiceRequest',row.id,offering.title,row.status,row.updatedAt,'/service-requests?id='+row.id);
  // Drafts have unmet context, not proof of a provider failure. No inferred capability success.
  const projectionFailures:{sourceRef:{type:string;id:string};state:'UNAVAILABLE'}[]=[];
  for(const row of drafts){try{const gap=await this.gaps.project(userId,row.draftId);if(gap.reasons.length)add('ResourceGap',row.draftId,'继续完善计划',gap.state,row.updatedAt,'/chat?mode=plan&draftId='+row.draftId,'sourceAssessment' in gap ? gap.sourceAssessment?.nextBestAction : undefined);}catch{projectionFailures.push({sourceRef:{type:'CreationDraft',id:row.draftId},state:'UNAVAILABLE'});}}

  for(const row of reminders)if(row.requiresAction===1)add('Reminder',row.id,row.title,'PENDING',row.createdAt,'/schedule');
  for(const {message,conversation} of messages){const result=message.structuredPayload?.result; if(result==='ACTION_PROPOSAL'&&!confirmedIds.has(message.id))add('ActionProposal',message.id,message.content.slice(0,100),'PROPOSED',message.createdAt,'/chat?conversationId='+conversation.id);else if(result==='ANSWER')add('ConversationResult',message.id,conversation.title,'ANSWER_AVAILABLE',message.createdAt,'/chat?conversationId='+conversation.id);}
  return {contractVersion:1,authority:'WorkItemProjection',evaluatedAt,planAssessments:assessments,projectionFailures,items:items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),truncated:approvals.length===100||runs.length===100||cases.length===100||requests.length===100||drafts.length===100||reminders.length===100||messages.length===100};
 }
}
