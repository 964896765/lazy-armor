import type {AcquisitionCoverage} from './acquisition';
export type NextBestAction='WAIT'|'REFRESH_SOURCE'|'ASK_USER'|'CONNECT_RESOURCE'|'REQUEST_APPROVAL'|'EXECUTE'|'SUGGEST_SERVICE'|'RECONCILE'|'COMPLETE';
export interface StateAssessment {state:'UNKNOWN'|'BLOCKED'|'NEEDS_ATTENTION'|'READY'|'COMPLETE';reason:string;coverage:readonly AcquisitionCoverage[];evidenceRefs:readonly string[];}
export interface AssessmentInput {coverage:readonly AcquisitionCoverage[];verifiedComplete:boolean;hasConflict:boolean;approvalRequired:boolean;approvalGranted:boolean;executionAuthorized:boolean;due:boolean|null;thresholdExceeded:boolean|null;changed:boolean|null;serviceAvailable:boolean;}
export interface NextActionAuthority { executionId:string;executionStatus:string;lifecycle:import('./lifecycle-read-projection').LifecycleReadProjection; }
/** Existing lifecycle records override recommendations; they never grant execution permission. */
export function authorityNextBestAction(input:AssessmentInput,authority:NextActionAuthority|null,recurring=false):NextBestAction {
 if(!authority)return nextBestAction(input);
 const stage=(key:string)=>authority.lifecycle.steps.find(step=>step.key===key);
 if(stage('FALLBACK_RECONCILIATION')?.state==='RUNNING'||stage('FALLBACK_RECONCILIATION')?.state==='OUTCOME_UNKNOWN'||stage('RESULT')?.state==='OUTCOME_UNKNOWN')return 'RECONCILE';
 if(stage('APPROVAL')?.state==='RUNNING')return 'REQUEST_APPROVAL';
 if(stage('APPROVAL')?.state==='BLOCKED'||stage('RISK')?.state==='BLOCKED')return 'ASK_USER';
 if(['queued','running','pending','retry_wait','waiting_dispatch'].includes(authority.executionStatus))return 'WAIT';
 if(stage('RESULT')?.state==='SUCCEEDED'&&stage('VERIFICATION')?.state==='SUCCEEDED')return recurring?nextBestAction(input):'COMPLETE';
 if(authority.executionStatus==='succeeded'&&stage('VERIFICATION')?.state!=='SUCCEEDED')return 'RECONCILE';
 if(authority.executionStatus==='failed')return 'ASK_USER';
 return nextBestAction(input);
}
export function assessState(input:AssessmentInput):StateAssessment {
 const coverage=input.coverage;const evidenceRefs=coverage.flatMap(item=>item.evidenceRefs);
 if(input.hasConflict||coverage.some(c=>c.state==='CONFLICT'))return {state:'BLOCKED',reason:'证据冲突需要核实',coverage,evidenceRefs};
 if(input.verifiedComplete)return {state:'COMPLETE',reason:'已取得完成验证',coverage,evidenceRefs};
 if(!coverage.length||coverage.some(c=>c.state==='UNKNOWN'))return {state:'UNKNOWN',reason:'尚未取得完整来源证据',coverage,evidenceRefs};
 if(coverage.some(c=>!['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(c.state)))return {state:'BLOCKED',reason:'来源需要处理或刷新',coverage,evidenceRefs};
 const attention=input.due===true||input.thresholdExceeded===true||input.changed===true;
 return {state:attention?'NEEDS_ATTENTION':'READY',reason:attention?'已满足处理条件':'等待已定义的触发条件',coverage,evidenceRefs};
}
/** A recommendation only; EXECUTE still requires the canonical execution chain to revalidate. */
export function nextBestAction(input:AssessmentInput):NextBestAction {
 if(input.hasConflict||input.coverage.some(c=>c.state==='CONFLICT'))return 'RECONCILE';
 if(input.verifiedComplete)return 'COMPLETE';
 if(input.coverage.some(c=>c.state==='PERMISSION_REQUIRED'||c.state==='OFFLINE'))return 'CONNECT_RESOURCE';
 if(input.coverage.some(c=>c.state==='STALE'||c.state==='UNAVAILABLE'))return 'REFRESH_SOURCE';
 if(!input.coverage.length||input.coverage.some(c=>c.state==='UNKNOWN'))return 'ASK_USER';
 if(input.due!==true&&input.thresholdExceeded!==true&&input.changed!==true)return 'WAIT';
 if(input.approvalRequired&&!input.approvalGranted)return 'REQUEST_APPROVAL';
 if(input.executionAuthorized)return 'EXECUTE';
 return input.serviceAvailable?'SUGGEST_SERVICE':'ASK_USER';
}
