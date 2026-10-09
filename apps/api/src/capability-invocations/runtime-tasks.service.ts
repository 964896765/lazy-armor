import {Inject,Injectable} from '@nestjs/common';
import {capabilityInvocations,invocationRuntimeLinks,executions,executionSteps,deviceTasks,sideEffectOperations,consumerServiceRequests,outboxMessages} from '@lazy-armor/database';
import {projectRuntimeTask,type RuntimeTaskProjection} from '@lazy-armor/plan-schema';
import {and,eq} from 'drizzle-orm';
import {DATABASE,type InjectedDatabase} from '../common/database.module';
import {CapabilityInvocationsService} from './capability-invocations.service';
import {RuntimeTargetsService} from '../runtime-targets/runtime-targets.service';
@Injectable()
export class RuntimeTasksService {
 constructor(@Inject(DATABASE) private readonly db:InjectedDatabase,private readonly invocations:CapabilityInvocationsService,private readonly targets:RuntimeTargetsService){}
 async list(userId:string,invocationId:string):Promise<RuntimeTaskProjection[]>{
  const invocation=await this.invocations.get(userId,invocationId);const target=await this.targets.get(userId,invocation.targetId);const links=await this.db.select().from(invocationRuntimeLinks).where(eq(invocationRuntimeLinks.invocationId,invocationId));const results:RuntimeTaskProjection[]=[];
  for(const link of links){const base={invocationId,targetId:invocation.targetId};
   if(link.runtimeKind==='EXECUTION'){const row=(await this.db.select().from(executions).where(and(eq(executions.id,link.runtimeRef),eq(executions.userId,userId))))[0];if(!row||row.planVersionId!==invocation.planVersionId)continue;const steps=invocation.actionIntentId?await this.db.select().from(executionSteps).where(and(eq(executionSteps.executionId,row.id),eq(executionSteps.actionIntentId,invocation.actionIntentId))):[];results.push(projectRuntimeTask({...base,runtimeKind:'EXECUTION',status:row.status,attemptCount:Math.max(0,...steps.map(s=>s.attemptCount)),heartbeatAt:row.heartbeatAt?.toISOString(),leaseExpiresAt:row.leaseExpiresAt?.toISOString(),nextRetryAt:steps.find(s=>s.nextRetryAt)?.nextRetryAt?.toISOString()}));}
   else if(link.runtimeKind==='DEVICE_TASK'){const row=(await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.id,link.runtimeRef),eq(deviceTasks.userId,userId))))[0];if(row){const nativeOp=['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'].includes(row.taskType)?(await this.db.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.id,String(row.payloadJson.operationId)),eq(sideEffectOperations.userId,userId))))[0]:null;results.push(projectRuntimeTask({...base,runtimeKind:'DEVICE_TASK',status:row.errorCode==='OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':row.status==='PENDING'&&nativeOp?.status==='retry_wait'?'RETRY_WAIT':row.status,attemptCount:nativeOp?.attemptCount??(row.claimedAt?1:0),heartbeatAt:row.updatedAt?.toISOString(),leaseExpiresAt:row.leaseExpiresAt?.toISOString(),targetOnline:target.onlineState==='ONLINE'}));}}
   else if(link.runtimeKind==='SIDE_EFFECT_OPERATION'){const row=(await this.db.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.id,link.runtimeRef),eq(sideEffectOperations.userId,userId))))[0];if(row)results.push(projectRuntimeTask({...base,runtimeKind:'SIDE_EFFECT_OPERATION',status:row.status,attemptCount:row.attemptCount}));}
   else if(link.runtimeKind==='SERVICE_REQUEST'){const row=(await this.db.select().from(consumerServiceRequests).where(and(eq(consumerServiceRequests.id,link.runtimeRef),eq(consumerServiceRequests.userId,userId))))[0];if(row)results.push(projectRuntimeTask({...base,runtimeKind:'SERVICE_REQUEST',status:row.status,attemptCount:1}));}
   else if(link.runtimeKind==='OUTBOX'){const row=(await this.db.select().from(outboxMessages).where(and(eq(outboxMessages.id,link.runtimeRef),eq(outboxMessages.userId,userId))))[0];if(row)results.push(projectRuntimeTask({...base,runtimeKind:'OUTBOX',status:row.status,attemptCount:row.attemptCount,leaseExpiresAt:row.lockExpiresAt?.toISOString(),nextRetryAt:row.nextAttemptAt?.toISOString()}));}
  }
  return results;
 }
}
