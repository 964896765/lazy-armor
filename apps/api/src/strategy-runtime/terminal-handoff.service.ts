import { Controller, Inject, Injectable, OnApplicationShutdown, OnModuleInit, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {createHash} from 'node:crypto';
import { plans, planVersions, planTriggers, planCreationContracts, strategyRuntimeBindings, strategyRuntimeWakeups,deviceTasks,auditLogs } from '@lazy-armor/database';
import { CronExpressionParser } from 'cron-parser';
import { persistentPlanOfferRequestSchema } from '@lazy-armor/plan-schema';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { AuditService } from '../audit/audit.service';
import { and, asc, desc,eq,inArray,notExists,sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { workerEnabled } from '../common/app-role';
import { ExecutionDispatchService } from '../execution/execution-dispatch.service';
import { StrategyRuntimeService } from './strategy-runtime.service';

@Injectable()
export class TerminalHandoffService implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private scheduleMinute = '';
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly strategy: StrategyRuntimeService,
    private readonly dispatch: ExecutionDispatchService, private readonly factDemands:FactDemandResolverService,private readonly audit:AuditService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('execution-worker')) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 1000);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
  async handoff(userId: string, wakeupId: string) {
    const row = (await this.db.select({ wakeup: strategyRuntimeWakeups, planId: plans.id }).from(strategyRuntimeWakeups)
      .innerJoin(planVersions, eq(planVersions.id, strategyRuntimeWakeups.planVersionId)).innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId))).limit(1))[0];
    // evaluateWakeup enforces ownership and returns the original immutable Decision on replay.
    let decision;
    try { decision = await this.strategy.evaluateWakeup(userId, wakeupId); }
    catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status && status >= 400 && status < 500) await this.db.update(strategyRuntimeWakeups)
        .set({ handoffStatus: 'BLOCKED', handoffReason: 'STRATEGY_EVALUATION_BLOCKED' })
        .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.userId, userId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      throw error;
    }
    if (!row || !row.wakeup.handoffStatus) return { decision, status: 'NOT_ELIGIBLE', executionId: null };
    if (decision.result !== 'READY_FOR_PLAN_ENGINE') {
      await this.db.update(strategyRuntimeWakeups).set({ handoffStatus: 'QUIET', handoffReason: 'CONDITION_FALSE' })
        .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      return { decision, status: 'QUIET', executionId: null };
    }
    try {
      const execution = await this.dispatch.dispatchStrategy(userId, row.planId, wakeupId);
      await this.db.update(strategyRuntimeWakeups).set({ handoffStatus: 'DISPATCHED', handoffExecutionId: execution.id, handoffReason: null })
        .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      return { decision, status: 'DISPATCHED', executionId: execution.id, executionStatus: execution.status };
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.();
      if (status === 403 || status === 409) {
        await this.db.update(strategyRuntimeWakeups).set({ handoffStatus: 'BLOCKED', handoffReason: 'TERMINAL_HANDOFF_NOT_AUTHORIZED' })
          .where(and(eq(strategyRuntimeWakeups.id, wakeupId), eq(strategyRuntimeWakeups.handoffStatus, 'PENDING')));
      }
      throw error;
    }
  }
  async tick(userId?: string) {
    if (this.running) return;
    this.running = true;
    try {
      const minute=new Date().toISOString().slice(0,16);
      if(this.scheduleMinute!==minute){await this.wakeScheduledPlans(userId);this.scheduleMinute=minute;}
      await this.resumeScheduledAcquisitions(userId);
      const rows = await this.db.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.handoffStatus, 'PENDING'),
        ...(userId ? [eq(strategyRuntimeWakeups.userId, userId)] : []))).orderBy(asc(strategyRuntimeWakeups.createdAt)).limit(4);
      // No exclusive worker lease is necessary: the existing Execution unique requestId is the durable claim.
      // A crash after dispatch leaves PENDING; a restart replays that same Execution, never sends again.
      await Promise.all(rows.map((row) => this.handoff(row.userId, row.id).catch(() => undefined)));
    } finally { this.running = false; }
  }

  /** Trigger adapter only: existing SourceResolver, DeviceTask and terminal handoff own the work. */
  async wakeScheduledPlans(userId?:string,now=new Date()) {
    const rows=await this.db.select({plan:plans,trigger:planTriggers,contract:planCreationContracts,binding:strategyRuntimeBindings}).from(plans)
      .innerJoin(planTriggers,and(eq(planTriggers.planVersionId,plans.activeVersionId),eq(planTriggers.triggerType,'schedule')))
      .innerJoin(planCreationContracts,and(eq(planCreationContracts.planVersionId,plans.activeVersionId),eq(planCreationContracts.userId,plans.userId)))
      .leftJoin(strategyRuntimeBindings,and(eq(strategyRuntimeBindings.planVersionId,plans.activeVersionId),eq(strategyRuntimeBindings.userId,plans.userId)))
      .where(and(eq(plans.status,'active'),...(userId?[eq(plans.userId,userId)]:[])));
    const results:Array<{planId:string;state:string;taskIds:string[];failureStage?:string}>=[];
    for(const {plan,trigger,contract,binding} of rows){
      const cron=trigger.configJson.cronExpression;
      const runtimeSchedule=(binding?.runtimeJson as {triggerProfile?:{schedule?:{timezone?:string}}}|undefined)?.triggerProfile?.schedule;
      const timezone=typeof trigger.configJson.timezone==='string'?trigger.configJson.timezone:runtimeSchedule?.timezone??'UTC';
      if(typeof cron!=='string')continue;
      const slot=dueScheduleSlot(cron,timezone,now);if(!slot)continue;
      let failureStage='CONTRACT_VALIDATION';
      try {
        const request=persistentPlanOfferRequestSchema.parse({scenarioKey:contract.scenarioKey,scenarioRevision:contract.scenarioRevision,goal:contract.goalJson,subject:contract.subjectJson});
        const frozen=contract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null}>;
        const facts=contract.factDemandsJson as Array<{demandId:string;factKey:string}>;
        const pins=Object.fromEntries(frozen.map(source=>[source.factKey??facts.find(fact=>fact.demandId===source.demandId)?.factKey??source.demandId,source.selectedSourceId]));
        const key=`plan-wakeup:${plan.activeVersionId}:${trigger.id}:${slot.toISOString()}`;
        failureStage='ACQUISITION_DISPATCH';
        const acquired=await this.factDemands.acquire(plan.userId,{...request,scopeStart:slot.getTime(),scopeEnd:slot.getTime()+86400000},pins,key,{planVersionId:plan.activeVersionId!,triggerId:trigger.id,scheduledAt:slot.toISOString(),bindingId:binding?.id??null});
        failureStage='ASSESSMENT';
        const assessment=await this.factDemands.resolve(plan.userId,request,pins);
        let state=acquired.state;
        const runtimeProfile=(binding?.runtimeJson as {triggerProfile?:{defaultMode?:string;acceptedModes?:string[]}}|undefined)?.triggerProfile;
        const receipts=[...acquired.tasks,...acquired.acquisitions];
        const verifiedRead=receipts.length>0&&receipts.every(receipt=>receipt.state==='VERIFIED_PRESENT');
        if(verifiedRead&&binding&&(runtimeProfile?.defaultMode==='SCHEDULE'||runtimeProfile?.acceptedModes?.includes('SCHEDULE'))&&assessment.demands.filter(demand=>demand.required).every(demand=>demand.state==='SATISFIED')){
          const wakeup=await this.strategy.enqueueScheduleWakeup(plan.userId,binding.id,undefined,slot);
          if(wakeup)state='TRUTH_WAKEUP_ENQUEUED';
        }
        results.push({planId:plan.id,state,taskIds:acquired.tasks.map(task=>task.taskId)});
        await this.audit.append({actorType:'system',userId:plan.userId,action:'AUTOMATIC_PLAN_ACQUISITION_WAKEUP',resourceType:'plan_version',resourceId:plan.activeVersionId,correlationId:key,source:'scheduler',result:'pending',after:{state,sourcePins:pins,tasks:acquired.tasks,acquisitions:acquired.acquisitions,assessment:assessment.stateAssessment,nextBestAction:assessment.nextBestAction},changeSummary:'Scheduled Plan Trigger resolved frozen FactDemand sources; canonical acquisition dispatched'});
      }catch{results.push({planId:plan.id,state:'ACQUISITION_UNAVAILABLE',taskIds:[],failureStage});await this.audit.append({actorType:'system',userId:plan.userId,action:'AUTOMATIC_PLAN_ACQUISITION_BLOCKED',resourceType:'plan_version',resourceId:plan.activeVersionId,source:'scheduler',result:'blocked',reasonCode:'ACQUISITION_UNAVAILABLE',after:{failureStage},changeSummary:'Scheduled acquisition could not validate its frozen source; no fallback or action dispatched'});}
    }
    return results;
  }

  /** Durable continuation from the existing DeviceTask receipt, including reads finishing after the trigger minute. */
  async resumeScheduledAcquisitions(userId?:string){
    const tasks=await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.taskType,'NATIVE_CALENDAR_READ'),inArray(deviceTasks.status,['SUCCEEDED','FAILED']),sql`JSON_TYPE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.planWakeup.planVersionId')) = 'STRING'`,notExists(this.db.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.action,'AUTOMATIC_PLAN_ACQUISITION_ASSESSED'),eq(auditLogs.resourceId,sql`LOWER(BIN_TO_UUID(${deviceTasks.id}))`),eq(auditLogs.userId,deviceTasks.userId)))),...(userId?[eq(deviceTasks.userId,userId)]:[]))).orderBy(asc(deviceTasks.updatedAt)).limit(100);
    for(const task of tasks){
      const origin=task.payloadJson.planWakeup as {planVersionId?:string;triggerId?:string;bindingId?:string|null;scheduledAt?:string}|undefined;
      if(!origin?.planVersionId||!origin.scheduledAt)continue;
      const key=`plan-wakeup:${origin.planVersionId}:${origin.triggerId}:${origin.scheduledAt}:${task.payloadJson.sourceId}`;
      const keyHash=createHash('sha256').update(`${task.userId}:${task.trustedDeviceId}:${task.taskType}:${key}`).digest('hex');
      const expectedTaskId=`${keyHash.slice(0,8)}-${keyHash.slice(8,12)}-5${keyHash.slice(13,16)}-8${keyHash.slice(17,20)}-${keyHash.slice(20,32)}`;
      if(task.id!==expectedTaskId){await this.audit.append({actorType:'system',userId:task.userId,action:'AUTOMATIC_PLAN_ACQUISITION_ASSESSED',resourceType:'device_task',resourceId:task.id,source:'scheduler',result:'blocked',reasonCode:'ACQUISITION_ORIGIN_NOT_AUTHORIZED',changeSummary:'Only server-generated automatic acquisition identities can resume a scheduled Plan'});continue;}
      const done=(await this.db.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.action,'AUTOMATIC_PLAN_ACQUISITION_ASSESSED'),eq(auditLogs.resourceId,task.id),eq(auditLogs.userId,task.userId))).limit(1))[0];
      if(done)continue;
      const row=(await this.db.select({plan:plans,contract:planCreationContracts}).from(planCreationContracts).innerJoin(plans,and(eq(plans.id,planCreationContracts.planId),eq(plans.activeVersionId,planCreationContracts.planVersionId),eq(plans.status,'active'))).where(and(eq(planCreationContracts.userId,task.userId),eq(planCreationContracts.planVersionId,origin.planVersionId))).limit(1))[0];
      if(!row){await this.audit.append({actorType:'system',userId:task.userId,action:'AUTOMATIC_PLAN_ACQUISITION_ASSESSED',resourceType:'device_task',resourceId:task.id,correlationId:origin.planVersionId,source:'scheduler',result:'blocked',reasonCode:'PLAN_VERSION_INACTIVE',changeSummary:'Scheduled acquisition belongs to an inactive or replaced PlanVersion; no execution authorized'});continue;}
      try{
        const {contract}=row;
        const facts=contract.factDemandsJson as Array<{demandId:string;factKey:string}>;
        const selected=contract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null}>;
        const pins=Object.fromEntries(selected.map(source=>[source.factKey??facts.find(fact=>fact.demandId===source.demandId)?.factKey??source.demandId,source.selectedSourceId]));
        const request=persistentPlanOfferRequestSchema.parse({scenarioKey:contract.scenarioKey,scenarioRevision:contract.scenarioRevision,goal:contract.goalJson,subject:contract.subjectJson});
        const assessment=await this.factDemands.resolve(task.userId,request,pins);
        let wakeupId:string|null=null;
        const binding=origin.bindingId?(await this.db.select().from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.id,origin.bindingId),eq(strategyRuntimeBindings.userId,task.userId),eq(strategyRuntimeBindings.planVersionId,origin.planVersionId))).limit(1))[0]:null;
        const profile=(binding?.runtimeJson as {triggerProfile?:{defaultMode?:string;acceptedModes?:string[]}}|undefined)?.triggerProfile;
        if(task.status==='SUCCEEDED'&&task.resultJson?.state==='VERIFIED_PRESENT'&&binding&&(profile?.defaultMode==='SCHEDULE'||profile?.acceptedModes?.includes('SCHEDULE'))&&assessment.contractHash===contract.contractHash&&assessment.demands.filter(demand=>demand.required).every(demand=>demand.state==='SATISFIED'))wakeupId=(await this.strategy.enqueueScheduleWakeup(task.userId,binding.id,undefined,new Date(origin.scheduledAt)))?.id??null;
        await this.audit.append({actorType:'system',userId:task.userId,action:'AUTOMATIC_PLAN_ACQUISITION_ASSESSED',resourceType:'device_task',resourceId:task.id,correlationId:origin.planVersionId,source:'scheduler',result:wakeupId?'pending':'blocked',after:{acquisition:{taskId:task.id,state:task.resultJson?.state??null,itemCount:task.resultJson?.itemCount??null,contentHash:task.resultJson?.contentHash??null},assessment:assessment.stateAssessment,acquisitionCoverage:assessment.sourceAcquisitionCoverage,nextBestAction:assessment.nextBestAction,wakeupId},changeSummary:'Signed DeviceTask read resumed frozen-source assessment; empty or missing Truth does not authorize execution'});
      }catch{ /* Keep unassessed transport retryable; no action is dispatched on an unavailable source. */ }
    }
  }
}

export function dueScheduleSlot(cron:string,timezone:string,now:Date):Date|null {
  try{const slot=CronExpressionParser.parse(cron,{tz:timezone,currentDate:new Date(now.getTime()+1)}).prev().toDate();return now.getTime()-slot.getTime()>=0&&now.getTime()-slot.getTime()<60000?slot:null;}catch{return null;}
}

@Controller('strategy-runtime')
export class TerminalHandoffController {
  constructor(private readonly handoffService: TerminalHandoffService) {}
  @Post('wakeups/:id/handoff') handoff(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.handoffService.handoff(user.id, id);
  }
}
