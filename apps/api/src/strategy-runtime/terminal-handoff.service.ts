import { Controller, Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {createHash} from 'node:crypto';
import { plans, planVersions, planTriggers, planCreationContracts, strategyRuntimeBindings, strategyRuntimeWakeups,deviceTasks,auditLogs,executions,capabilityInvocations,runtimeResults,reconciliationCases } from '@lazy-armor/database';
import { CronExpressionParser } from 'cron-parser';
import { persistentPlanOfferRequestSchema } from '@lazy-armor/plan-schema';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { AuditService } from '../audit/audit.service';
import { and, asc, desc,eq,inArray,notExists,exists,or,sql } from 'drizzle-orm';
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
    private readonly dispatch: ExecutionDispatchService, private readonly factDemands:FactDemandResolverService,private readonly audit:AuditService,@Optional() private readonly modules?:ModuleRef) {}
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
      const response=(error as {getResponse?:()=>unknown}).getResponse?.();
      if(typeof response==='object'&&response!==null&&'code' in response&&response.code==='WAITING_RESOURCE') {
        await this.db.update(strategyRuntimeWakeups).set({handoffReason:'WAITING_RESOURCE'}).where(and(eq(strategyRuntimeWakeups.id,wakeupId),eq(strategyRuntimeWakeups.userId,userId),eq(strategyRuntimeWakeups.handoffStatus,'PENDING')));
        return {decision,status:'WAITING_RESOURCE',executionId:null};
      }
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
      if(this.modules){const {PersistentNotificationPlanService}=await import('../consumer/persistent-notification-plan.service');const notifications=this.modules.get(PersistentNotificationPlanService,{strict:false});await notifications.recover(userId);await notifications.continueLocalResults(userId);}
      const minute=new Date().toISOString().slice(0,16);
      if (this.modules) {
        const { GithubDigestScheduleService } = await import('../execution/github-digest-schedule.service');
        const github = this.modules.get(GithubDigestScheduleService, { strict: false });
        if (this.scheduleMinute !== minute) await github.wake(userId);
        await github.complete(userId);
      }
      if(this.scheduleMinute!==minute){await this.wakeScheduledPlans(userId);this.scheduleMinute=minute;}
      await this.resumeScheduledAcquisitions(userId);
      await this.resumeCompletedPlans(userId);
      const rows = await this.db.select().from(strategyRuntimeWakeups).where(and(eq(strategyRuntimeWakeups.handoffStatus, 'PENDING'),
        ...(userId ? [eq(strategyRuntimeWakeups.userId, userId)] : []))).orderBy(asc(strategyRuntimeWakeups.createdAt)).limit(4);
      // No exclusive worker lease is necessary: the existing Execution unique requestId is the durable claim.
      // A crash after dispatch leaves PENDING; a restart replays that same Execution, never sends again.
      await Promise.all(rows.map((row) => this.handoff(row.userId, row.id).catch(() => undefined)));
    } finally { this.running = false; }
  }

  /** Recover terminal write continuations after Worker restart, independently of delivery ACK. */
  async resumeCompletedPlans(userId?:string) {
    await this.resumeReconciledPlans(userId);
    const rows=await this.db.select({execution:executions,wakeup:strategyRuntimeWakeups}).from(executions)
      .innerJoin(strategyRuntimeWakeups,eq(strategyRuntimeWakeups.handoffExecutionId,executions.id))
      .where(and(inArray(executions.status,['succeeded','partially_succeeded','failed','cancelled']),
        or(notExists(this.db.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.userId,executions.userId),eq(auditLogs.action,'PERSISTENT_PLAN_RESULT_REEVALUATED'),eq(auditLogs.resourceId,sql`LOWER(BIN_TO_UUID(${executions.id}))`)))),
          and(eq(executions.status,'succeeded'),
            exists(this.db.select({id:planCreationContracts.id}).from(planCreationContracts).where(and(eq(planCreationContracts.userId,executions.userId),eq(planCreationContracts.planVersionId,executions.planVersionId),sql`JSON_UNQUOTE(JSON_EXTRACT(${planCreationContracts.goalJson}, '$.constraints.recipeKey')) = 'calendar.scheduled-create.v1'`))),
            notExists(this.db.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.userId,executions.userId),eq(auditLogs.action,'PERSISTENT_PLAN_POST_WRITE_ASSESSED'),eq(auditLogs.resourceId,sql`LOWER(BIN_TO_UUID(${executions.id}))`)))))),
        ...(userId?[eq(executions.userId,userId)]:[]))).orderBy(asc(executions.finishedAt)).limit(32);
    for(const {execution,wakeup} of rows) {
      const results=await this.db.select({result:runtimeResults}).from(runtimeResults).innerJoin(capabilityInvocations,and(eq(capabilityInvocations.id,runtimeResults.invocationId),eq(capabilityInvocations.executionId,execution.id))).where(eq(runtimeResults.userId,execution.userId));
      // A successful executor without verified durable results cannot advance a Plan.
      if(execution.status==='succeeded'&&(!results.length||results.some(row=>row.result.verificationState!=='VERIFIED')))continue;
      await this.db.transaction(async tx=>{
        const locked=(await tx.select().from(executions).where(and(eq(executions.id,execution.id),eq(executions.userId,execution.userId))).for('update'))[0];
        if(!locked||locked.status!==execution.status||!execution.planId||!execution.planVersionId)return;
        const done=(await tx.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.userId,execution.userId),eq(auditLogs.action,'PERSISTENT_PLAN_RESULT_REEVALUATED'),eq(auditLogs.resourceId,execution.id))).limit(1))[0];
        const assessed=(await tx.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.userId,execution.userId),eq(auditLogs.action,'PERSISTENT_PLAN_POST_WRITE_ASSESSED'),eq(auditLogs.resourceId,execution.id))).limit(1))[0];
        if(done&&assessed)return;
        const plan=(await tx.select().from(plans).where(and(eq(plans.id,execution.planId),eq(plans.userId,execution.userId))).for('update'))[0];
        if(!plan)return;
        const current=plan.status==='active'&&plan.activeVersionId===execution.planVersionId;
        const unknown=results.some(row=>row.result.verificationState==='OUTCOME_UNKNOWN');
        const triggers=current?await tx.select().from(planTriggers).where(and(eq(planTriggers.planVersionId,execution.planVersionId),eq(planTriggers.triggerType,'schedule'))):[];
        const nextRuns=triggers.flatMap(trigger=>{
          try {return [CronExpressionParser.parse(String(trigger.configJson.cronExpression),{tz:typeof trigger.configJson.timezone==='string'?trigger.configJson.timezone:'UTC',currentDate:new Date()}).next().toDate().toISOString()];}catch{return [];}
        }).sort();
        const state=!current?'INACTIVE_VERSION':unknown?'OUTCOME_UNKNOWN':execution.status==='succeeded'&&nextRuns.length?'WAITING_NEXT_SCHEDULE':execution.status==='succeeded'?'COMPLETED_RUN':'NEEDS_ATTENTION';
        if(!assessed&&current&&execution.status==='succeeded'){
          const reassessment=await this.factDemands.reassessCalendarCompletion(execution.userId,execution.planVersionId,execution.id,nextRuns[0]??null,tx);
          if(reassessment)await this.audit.append({actorType:'system',userId:execution.userId,executionId:execution.id,action:'PERSISTENT_PLAN_POST_WRITE_ASSESSED',resourceType:'execution',resourceId:execution.id,correlationId:plan.id,causationId:wakeup.id,source:'scheduler',result:'success',after:{...reassessment,inputTruthHandoffProof:execution.resolvedRiskSnapshotJson?.truthHandoffProof??null},changeSummary:'Existing Recipe output goal reassessed from committed read-back Truth; occurrence complete, persistent Plan replanned for its next fresh acquisition'},tx);
        }
        if(!assessed&&!current&&execution.status==='succeeded'){
          const contract=(await tx.select().from(planCreationContracts).where(and(eq(planCreationContracts.userId,execution.userId),eq(planCreationContracts.planVersionId,execution.planVersionId))).limit(1))[0];
          if((contract?.goalJson.constraints as {recipeKey?:string}|undefined)?.recipeKey==='calendar.scheduled-create.v1')await this.audit.append({actorType:'system',userId:execution.userId,executionId:execution.id,action:'PERSISTENT_PLAN_POST_WRITE_ASSESSED',resourceType:'execution',resourceId:execution.id,correlationId:plan.id,source:'scheduler',result:'blocked',reasonCode:'PLAN_VERSION_INACTIVE',after:{planVersionId:execution.planVersionId,state:'INACTIVE_VERSION',nextRunAt:null},changeSummary:'Completed old or paused occurrence cannot replan the current PlanVersion'},tx);
        }
        if(done)return; // Retain historical checkpoints; recovery never rewrites them.
        await this.audit.append({actorType:'system',userId:execution.userId,executionId:execution.id,action:'PERSISTENT_PLAN_RESULT_REEVALUATED',resourceType:'execution',resourceId:execution.id,correlationId:plan.id,causationId:wakeup.id,source:'scheduler',result:state==='WAITING_NEXT_SCHEDULE'||state==='COMPLETED_RUN'?'success':'blocked',after:{planId:plan.id,planVersionId:execution.planVersionId,state,nextBestAction:state==='WAITING_NEXT_SCHEDULE'?'WAIT':unknown?'RECONCILE':'ASK_USER',nextRunAt:state==='WAITING_NEXT_SCHEDULE'?nextRuns[0]:null,resultRefs:results.map(row=>row.result.id),evidenceRefs:results.flatMap(row=>row.result.evidenceRefs)},changeSummary:'Verified durable results re-evaluated the existing persistent Plan; ACK delivery does not decide execution or schedule'},tx);
      });
    }
  }

  /** A resolved case adds a new authority checkpoint; the original Ledger and
   * failed/unknown execution remain immutable historical evidence. */
  private async resumeReconciledPlans(userId?:string) {
    const rows=await this.db.select({case:reconciliationCases,execution:executions}).from(reconciliationCases)
      .innerJoin(executions,eq(executions.id,reconciliationCases.executionId))
      .where(and(eq(reconciliationCases.status,'RESOLVED'),eq(reconciliationCases.resultState,'SUCCEEDED'),
        notExists(this.db.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.action,'PERSISTENT_PLAN_RECONCILIATION_REEVALUATED'),sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.state')) IN ('WAITING_NEXT_SCHEDULE','INACTIVE_VERSION')`,eq(auditLogs.resourceId,sql`LOWER(BIN_TO_UUID(${reconciliationCases.id}))`),eq(auditLogs.userId,reconciliationCases.userId)))),
        ...(userId?[eq(reconciliationCases.userId,userId)]:[]))).limit(32);
    for(const row of rows){await this.db.transaction(async tx=>{
      const resolved=(await tx.select().from(reconciliationCases).where(eq(reconciliationCases.id,row.case.id)).for('update'))[0];
      if(!resolved||resolved.status!=='RESOLVED'||resolved.resultState!=='SUCCEEDED'||!row.execution.planId||!row.execution.planVersionId)return;
      const done=(await tx.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.action,'PERSISTENT_PLAN_RECONCILIATION_REEVALUATED'),sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.state')) IN ('WAITING_NEXT_SCHEDULE','INACTIVE_VERSION')`,eq(auditLogs.resourceId,resolved.id),eq(auditLogs.userId,resolved.userId))).limit(1))[0];if(done)return;
      const plan=(await tx.select().from(plans).where(and(eq(plans.id,row.execution.planId),eq(plans.userId,resolved.userId))).for('update'))[0];if(!plan)return;
      const current=plan.status==='active'&&plan.activeVersionId===row.execution.planVersionId;
      const triggers=current?await tx.select().from(planTriggers).where(eq(planTriggers.planVersionId,row.execution.planVersionId)):[];
      const nextRuns=triggers.map(trigger=>{try{return trigger.triggerType==='schedule'?CronExpressionParser.parse(String(trigger.configJson.cronExpression),{currentDate:new Date(),tz:String(trigger.configJson.timezone??'UTC')}).next().toISOString():null;}catch{return null;}}).filter((value):value is string=>!!value).sort();
      const reassessment=current?await this.factDemands.reassessCalendarCompletion(resolved.userId,row.execution.planVersionId,row.execution.id,nextRuns[0]??null,tx,resolved.id):null;
      if(current&&!reassessment)return;
      await this.audit.append({actorType:'system',userId:resolved.userId,executionId:row.execution.id,action:'PERSISTENT_PLAN_RECONCILIATION_REEVALUATED',resourceType:'reconciliation_case',resourceId:resolved.id,correlationId:plan.id,source:'scheduler',result:current?'success':'blocked',after:{planId:plan.id,planVersionId:row.execution.planVersionId,reconciliationCaseId:resolved.id,state:!current?'INACTIVE_VERSION':nextRuns.length?'WAITING_NEXT_SCHEDULE':'COMPLETED_RUN',nextBestAction:current&&nextRuns.length?'WAIT':'COMPLETE',nextRunAt:current?nextRuns[0]??null:null,reassessment},changeSummary:'Resolved read-only reality verification resumed existing Plan assessment without retrying its side effect'},tx);
    });}
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
      const firstRunAt=trigger.configJson.firstRunAt;
      if(firstRunAt!==undefined&&(typeof firstRunAt!=='string'||!Number.isFinite(Date.parse(firstRunAt))||now.getTime()<Date.parse(firstRunAt)))continue;
      const cron=trigger.configJson.cronExpression;
      const runtimeSchedule=(binding?.runtimeJson as {triggerProfile?:{schedule?:{timezone?:string}}}|undefined)?.triggerProfile?.schedule;
      const timezone=typeof trigger.configJson.timezone==='string'?trigger.configJson.timezone:runtimeSchedule?.timezone??'UTC';
      if(typeof cron!=='string')continue;
      let slot=dueScheduleSlot(cron,timezone,now);
      if(!slot){
        // Recover an actually observed trigger that could not yet acquire a source.
        // This receipt supplies only the occurrence identity: the current owned
        // ACTIVE version, frozen contract and SourceResolver still authorize work.
        const recovered = await this.db.select().from(auditLogs).where(and(
          eq(auditLogs.userId,plan.userId),eq(auditLogs.resourceId,plan.activeVersionId!),
          eq(auditLogs.action,'AUTOMATIC_PLAN_ACQUISITION_WAKEUP'),
          eq(auditLogs.actorType,'system'),eq(auditLogs.source,'scheduler'),eq(auditLogs.resourceType,'plan_version'),eq(auditLogs.result,'pending'),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.state')) = 'NO_SUPPORTED_ACQUISITION_DISPATCH'`,
          notExists(this.db.select({id:sql`completed.id`}).from(sql`audit_logs completed`).where(sql`completed.user_id = ${auditLogs.userId} AND completed.action = 'AUTOMATIC_PLAN_ACQUISITION_WAKEUP' AND completed.correlation_id = ${auditLogs.correlationId} AND JSON_UNQUOTE(JSON_EXTRACT(completed.after_snapshot_json, '$.state')) IN ('ACQUISITION_PENDING', 'TRUTH_WAKEUP_ENQUEUED')`))
        )).orderBy(asc(auditLogs.createdAt)).limit(4);
        for(const receipt of recovered){
          const candidate=recoverObservedScheduleSlot(cron,timezone,receipt.createdAt,receipt.correlationId,plan.activeVersionId!,trigger.id,firstRunAt);
          if(candidate){slot=candidate;break;}
        }
      }
      if(!slot)continue;
      let failureStage='CONTRACT_VALIDATION';
      try {
        const request=persistentPlanOfferRequestSchema.parse({scenarioKey:contract.scenarioKey,scenarioRevision:contract.scenarioRevision,goal:contract.goalJson,subject:contract.subjectJson});
        const frozen=contract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null}>;
        const facts=contract.factDemandsJson as Array<{demandId:string;factKey:string}>;
        const pins=Object.fromEntries(frozen.map(source=>[source.factKey??facts.find(fact=>fact.demandId===source.demandId)?.factKey??source.demandId,source.selectedSourceId]));
        const key=`plan-wakeup:${plan.activeVersionId}:${trigger.id}:${slot.toISOString()}`;
        failureStage='ACQUISITION_DISPATCH';
        // The selected observed event can precede the trigger. Re-read its actual
        // scope instead of silently substituting a future-only empty calendar.
        const observedStart=request.goal.constraints.recipeKey==='calendar.scheduled-create.v1'?request.goal.constraints.observationStartAt:undefined;
        const scopeStart=typeof observedStart==='number'?Math.min(slot.getTime(),observedStart):slot.getTime();
        const acquired=await this.factDemands.acquire(plan.userId,{...request,scopeStart,scopeEnd:slot.getTime()+86400000},pins,key,{planVersionId:plan.activeVersionId!,triggerId:trigger.id,scheduledAt:slot.toISOString(),bindingId:binding?.id??null});
        failureStage='ASSESSMENT';
        const assessment=await this.factDemands.resolve(plan.userId,request,pins);
        let state=acquired.state;
        const runtimeProfile=(binding?.runtimeJson as {triggerProfile?:{defaultMode?:string;acceptedModes?:string[]}}|undefined)?.triggerProfile;
        const receipts=[...acquired.tasks,...acquired.acquisitions];
        // Native completion always crosses the committed acquisition/Truth
        // barrier below, including scheduler replay after a Worker restart.
        const verifiedRead=acquired.tasks.length===0&&receipts.length>0&&receipts.every(receipt=>receipt.state==='VERIFIED_PRESENT');
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
    for(const selectedTask of tasks){
      try { await this.db.transaction(async tx => {
        const task=(await tx.select().from(deviceTasks).where(and(eq(deviceTasks.id,selectedTask.id),eq(deviceTasks.userId,selectedTask.userId))).for('update'))[0];
        if(!task)return;
        const origin=task.payloadJson.planWakeup as {planVersionId?:string;triggerId?:string;bindingId?:string|null;scheduledAt?:string}|undefined;
        if(!origin?.planVersionId||!origin.scheduledAt)return;
        const key=`plan-wakeup:${origin.planVersionId}:${origin.triggerId}:${origin.scheduledAt}:${task.payloadJson.sourceId}`;
        const keyHash=createHash('sha256').update(`${task.userId}:${task.trustedDeviceId}:${task.taskType}:${key}`).digest('hex');
        const expectedTaskId=`${keyHash.slice(0,8)}-${keyHash.slice(8,12)}-5${keyHash.slice(13,16)}-8${keyHash.slice(17,20)}-${keyHash.slice(20,32)}`;
        if(task.id!==expectedTaskId){await this.audit.append({actorType:'system',userId:task.userId,action:'AUTOMATIC_PLAN_ACQUISITION_ASSESSED',resourceType:'device_task',resourceId:task.id,source:'scheduler',result:'blocked',reasonCode:'ACQUISITION_ORIGIN_NOT_AUTHORIZED',changeSummary:'Only server-generated automatic acquisition identities can resume a scheduled Plan'},tx);return;}
        const done=(await tx.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.action,'AUTOMATIC_PLAN_ACQUISITION_ASSESSED'),eq(auditLogs.resourceId,task.id),eq(auditLogs.userId,task.userId))).limit(1))[0];
        if(done)return;
        const row=(await tx.select({plan:plans,contract:planCreationContracts}).from(planCreationContracts).innerJoin(plans,and(eq(plans.id,planCreationContracts.planId),eq(plans.activeVersionId,planCreationContracts.planVersionId),eq(plans.status,'active'))).where(and(eq(planCreationContracts.userId,task.userId),eq(planCreationContracts.planVersionId,origin.planVersionId))).limit(1).for('update'))[0];
        if(!row){await this.audit.append({actorType:'system',userId:task.userId,action:'AUTOMATIC_PLAN_ACQUISITION_ASSESSED',resourceType:'device_task',resourceId:task.id,correlationId:origin.planVersionId,source:'scheduler',result:'blocked',reasonCode:'PLAN_VERSION_INACTIVE',changeSummary:'Scheduled acquisition belongs to an inactive or replaced PlanVersion; no execution authorized'},tx);return;}
        const {contract}=row;
        const facts=contract.factDemandsJson as Array<{demandId:string;factKey:string}>;
        const selected=contract.sourceSelectionJson as Array<{demandId:string;factKey?:string;selectedSourceId:string|null}>;
        const pins=Object.fromEntries(selected.map(source=>[source.factKey??facts.find(fact=>fact.demandId===source.demandId)?.factKey??source.demandId,source.selectedSourceId]));
        const request=persistentPlanOfferRequestSchema.parse({scenarioKey:contract.scenarioKey,scenarioRevision:contract.scenarioRevision,goal:contract.goalJson,subject:contract.subjectJson});
        const assessment=await this.factDemands.resolve(task.userId,request,pins,task.status==='SUCCEEDED'?task.id:undefined);
        let wakeupId:string|null=null;
        const binding=origin.bindingId?(await tx.select().from(strategyRuntimeBindings).where(and(eq(strategyRuntimeBindings.id,origin.bindingId),eq(strategyRuntimeBindings.userId,task.userId),eq(strategyRuntimeBindings.planVersionId,origin.planVersionId))).limit(1))[0]:null;
        const runtime=binding?.runtimeJson as {triggerProfile?:{defaultMode?:string;acceptedModes?:string[]};dependencies?:Array<{factKey:string;scope:string}>}|undefined;
        const profile=runtime?.triggerProfile;
        const dependency=runtime?.dependencies?.find(item=>item.scope!=='SCHEDULED')??runtime?.dependencies?.[0];
        const handoffTruthVersionId=assessment.truthHandoffProof?.truths.find(truth=>truth.factKey===dependency?.factKey)?.truthVersionId;
        if(task.status==='SUCCEEDED'&&task.resultJson?.state==='VERIFIED_PRESENT'&&binding&&(profile?.defaultMode==='SCHEDULE'||profile?.acceptedModes?.includes('SCHEDULE'))&&handoffTruthVersionId&&assessment.truthHandoffProof?.coverageConfirmed&&assessment.truthHandoffProof.planVersionId===origin.planVersionId&&assessment.contractHash===contract.contractHash&&assessment.demands.filter(demand=>demand.required).every(demand=>demand.state==='SATISFIED'))wakeupId=(await this.strategy.enqueueScheduleWakeup(task.userId,binding.id,tx,new Date(origin.scheduledAt),handoffTruthVersionId))?.id??null;
        await this.audit.append({actorType:'system',userId:task.userId,action:'AUTOMATIC_PLAN_ACQUISITION_ASSESSED',resourceType:'device_task',resourceId:task.id,correlationId:origin.planVersionId,source:'scheduler',result:wakeupId?'pending':'blocked',after:{acquisition:{taskId:task.id,state:task.resultJson?.state??null,itemCount:task.resultJson?.itemCount??null,contentHash:task.resultJson?.contentHash??null},truthHandoffProof:assessment.truthHandoffProof,assessment:assessment.stateAssessment,acquisitionCoverage:assessment.sourceAcquisitionCoverage,nextBestAction:assessment.nextBestAction,wakeupId},changeSummary:'Signed DeviceTask read resumed frozen-source assessment; empty or missing Truth does not authorize execution'},tx);
      }); } catch { /* Transaction rollback leaves the durable continuation retryable after restart. */ }
    }
  }
}

export function dueScheduleSlot(cron:string,timezone:string,now:Date):Date|null {
  try{const slot=CronExpressionParser.parse(cron,{tz:timezone,currentDate:new Date(now.getTime()+1)}).prev().toDate();return now.getTime()-slot.getTime()>=0&&now.getTime()-slot.getTime()<60000?slot:null;}catch{return null;}
}

export function recoverObservedScheduleSlot(cron:string,timezone:string,recordedAt:Date,correlationId:string|null,versionId:string,triggerId:string,firstRunAt:unknown):Date|null {
  const prefix=`plan-wakeup:${versionId}:${triggerId}:`;
  if(!correlationId?.startsWith(prefix))return null;
  const slot=dueScheduleSlot(cron,timezone,recordedAt);
  if(!slot||correlationId!==prefix+slot.toISOString())return null;
  if(firstRunAt!==undefined&&(typeof firstRunAt!=='string'||!Number.isFinite(Date.parse(firstRunAt))||slot.getTime()<Date.parse(firstRunAt)))return null;
  return slot;
}

@Controller('strategy-runtime')
export class TerminalHandoffController {
  constructor(private readonly handoffService: TerminalHandoffService) {}
  @Post('wakeups/:id/handoff') handoff(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.handoffService.handoff(user.id, id);
  }
}
