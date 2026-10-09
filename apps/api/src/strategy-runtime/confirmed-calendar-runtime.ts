import { catalogHash, prepareAndroidCalendarCreate, type CompiledStrategyRuntime, type PlanDefinition } from '@lazy-armor/plan-schema';
import { CronExpressionParser } from 'cron-parser';
/** A narrow adapter from a confirmed existing Plan to its existing strategy runtime. */
export function confirmedCalendarRuntime(base:CompiledStrategyRuntime,definition:PlanDefinition):CompiledStrategyRuntime {
 if(base.scenarioKey!=='work.meetings'||definition.approvalPolicy?.type!=='always'||definition.actions.length!==1||definition.conditions.length!==0||definition.triggers.length!==1)throw new Error('Unsupported confirmed calendar runtime contract');
 const action=definition.actions[0]!,trigger=definition.triggers[0]!;
 if(action.actionType!=='publish'||action.requiredCapability!=='calendar.event.create'||action.connectionId||action.connectorKey||trigger.triggerType!=='schedule')throw new Error('Canonical scheduled calendar write required');
 prepareAndroidCalendarCreate(action.config.calendarEvent);
 const cronExpression=trigger.config.cronExpression,timezone=trigger.config.timezone;
 if(typeof cronExpression!=='string'||typeof timezone!=='string')throw new Error('Explicit schedule and timezone required');
 CronExpressionParser.parse(cronExpression,{tz:timezone});
 const {runtimeHash,...previous}=base;
 const runtime:Omit<CompiledStrategyRuntime,'runtimeHash'>={...previous,actionMode:'EXECUTE',approvalPolicy:'ALWAYS_FOR_EXTERNAL',verificationPolicy:'READ_BACK',triggerProfile:{...base.triggerProfile,defaultMode:'SCHEDULE',acceptedModes:['SCHEDULE'],schedule:{cronExpression,timezone}}};
 return {...runtime,runtimeHash:catalogHash(runtime)};
}
