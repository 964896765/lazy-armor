export const RUNTIME_TASK_STATES=['QUEUED','DISPATCHED','RUNNING','WAITING_USER','WAITING_DEVICE','WAITING_EXTERNAL','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED','OUTCOME_UNKNOWN'] as const;
export type RuntimeTaskState=typeof RUNTIME_TASK_STATES[number];
export interface RuntimeTaskProjection {invocationId:string;targetId:string;runtimeKind:string;state:RuntimeTaskState;activeAttempt:number;attemptCount:number;lastHeartbeatAt:string|null;leaseExpiresAt:string|null;waitingReason:string|null;nextRetryAt:string|null;}
export interface RuntimeTaskInput {invocationId:string;targetId:string;runtimeKind:'EXECUTION'|'DEVICE_TASK'|'SIDE_EFFECT_OPERATION'|'SERVICE_REQUEST'|'OUTBOX';status:string;attemptCount?:number;heartbeatAt?:string|null;leaseExpiresAt?:string|null;nextRetryAt?:string|null;waitingReason?:string|null;targetOnline?:boolean;}
const mappings:Record<RuntimeTaskInput['runtimeKind'],Record<string,RuntimeTaskState>>={
 EXECUTION:{created:'QUEUED',queued:'QUEUED',running:'RUNNING',waiting_approval:'WAITING_USER',waiting_dispatch:'DISPATCHED',waiting_verification:'WAITING_EXTERNAL',waiting_reconciliation:'OUTCOME_UNKNOWN',retry_wait:'RETRY_WAIT',succeeded:'SUCCEEDED',partially_succeeded:'OUTCOME_UNKNOWN',failed:'FAILED',cancelled:'CANCELLED',timed_out:'OUTCOME_UNKNOWN'},
 DEVICE_TASK:{PENDING:'QUEUED',QUEUED:'QUEUED',CLAIMED:'DISPATCHED',RUNNING:'RUNNING',RETRY_WAIT:'RETRY_WAIT',OUTCOME_UNKNOWN:'OUTCOME_UNKNOWN',AWAITING_DEVICE_EVIDENCE:'WAITING_DEVICE',SUCCEEDED:'SUCCEEDED',FAILED:'FAILED',CANCELLED:'CANCELLED'},
 SIDE_EFFECT_OPERATION:{prepared:'QUEUED',queued:'QUEUED',executing:'DISPATCHED',succeeded:'SUCCEEDED',failed:'FAILED',outcome_unknown:'OUTCOME_UNKNOWN',cancelled:'CANCELLED',retry_wait:'RETRY_WAIT',PREPARED:'QUEUED',DISPATCHING:'DISPATCHED',DISPATCHED:'WAITING_EXTERNAL',SUCCEEDED:'SUCCEEDED',FAILED:'FAILED',OUTCOME_UNKNOWN:'OUTCOME_UNKNOWN',CANCELLED:'CANCELLED',RETRY_WAIT:'RETRY_WAIT',AWAITING_VERIFICATION:'WAITING_EXTERNAL'},
 SERVICE_REQUEST:{BOOKED:'WAITING_EXTERNAL',IN_PROGRESS:'RUNNING',COMPLETED:'SUCCEEDED',CANCELLED:'CANCELLED',REJECTED:'FAILED'},
 OUTBOX:{pending:'QUEUED',processing:'DISPATCHED',published:'SUCCEEDED',retry_wait:'RETRY_WAIT',dead:'FAILED',PENDING:'QUEUED',CLAIMED:'DISPATCHED',RUNNING:'RUNNING',RETRY_WAIT:'RETRY_WAIT',DELIVERED:'SUCCEEDED',FAILED:'FAILED',CANCELLED:'CANCELLED'}
};
/** Read-only projection. Unknown adapter state cannot become success or imply retry safety. */
export function projectRuntimeTask(input:RuntimeTaskInput):RuntimeTaskProjection{
 let state=mappings[input.runtimeKind][input.status]??'OUTCOME_UNKNOWN';
 if(input.runtimeKind==='DEVICE_TASK'&&input.targetOnline===false&&['QUEUED','DISPATCHED','RUNNING'].includes(state))state='WAITING_DEVICE';
 const attempts=input.attemptCount??0;if(!Number.isSafeInteger(attempts)||attempts<0)throw new Error('Invalid runtime attempt count');
 return {invocationId:input.invocationId,targetId:input.targetId,runtimeKind:input.runtimeKind,state,activeAttempt:['RUNNING','DISPATCHED'].includes(state)?attempts:0,attemptCount:attempts,lastHeartbeatAt:input.heartbeatAt??null,leaseExpiresAt:input.leaseExpiresAt??null,waitingReason:input.waitingReason??(['WAITING_USER','WAITING_DEVICE','WAITING_EXTERNAL','OUTCOME_UNKNOWN'].includes(state)?input.status:null),nextRetryAt:input.nextRetryAt??null};
}
