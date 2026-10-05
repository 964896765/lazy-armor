import type {StateAssessment,NextBestAction} from './state-assessment';
export type WorkItemKind='Plan'|'Execution'|'Approval'|'ActionProposal'|'ServiceRequest'|'Reconciliation'|'ResourceGap'|'Reminder'|'ConversationResult';
export interface WorkItemProjection {assessment?:StateAssessment;id:string;kind:WorkItemKind;title:string;status:string;nextAction:NextBestAction;nextActionLabel:string;sourceRef:{type:string;id:string};evidenceRefs:readonly string[];updatedAt:string;primaryAction:{label:string;path:string};}
export function workItemNextAction(kind:WorkItemKind,status:string):NextBestAction {
 if(kind==='Reconciliation')return ['resolved','closed','completed'].includes(status.toLowerCase())?'COMPLETE':'RECONCILE';
 if(kind==='Approval')return status.toLowerCase()==='pending'?'REQUEST_APPROVAL':'WAIT';
 if(kind==='ResourceGap')return ['NEEDS_SCENARIO','NEEDS_SUBJECT_OR_GOAL','CONTEXT_REQUIRED'].includes(status)?'ASK_USER':'CONNECT_RESOURCE';
 if(kind==='ActionProposal')return 'ASK_USER';
 if(kind==='ServiceRequest')return status==='COMPLETED'?'COMPLETE':status==='PENDING'?'ASK_USER':'WAIT';
 if(kind==='Execution')return status==='succeeded'?'COMPLETE':status==='outcome_unknown'?'RECONCILE':status==='awaiting_approval'?'REQUEST_APPROVAL':'WAIT';
 return 'WAIT';
}
export const NEXT_ACTION_LABELS:Readonly<Record<NextBestAction,string>>={WAIT:'查看进度',REFRESH_SOURCE:'刷新来源',ASK_USER:'补充或确认',CONNECT_RESOURCE:'补充资源',REQUEST_APPROVAL:'查看确认事项',EXECUTE:'查看执行方案',SUGGEST_SERVICE:'查看可选服务',RECONCILE:'核实结果',COMPLETE:'查看结果'};
