import { z } from 'zod';
import { calendarEventCreateSchema, prepareAndroidCalendarCreate } from './calendar-write';
import { scenarioByKey } from './runtime-catalog';
import { compileScenarioPlan } from './scenario-plan-compiler';
import { normalizePlanDefinition } from './index';
import { PARAMETERIZED_ACTION_RECIPES } from './action-recipe';

/** Parameter contract for an existing Action Recipe, never execution authority. */
export const scheduledCalendarAuthoringSchema = z.object({
  recipeKey: z.literal('calendar.scheduled-create.v1'),
  firstRunAt: z.string().datetime({offset:true}),
  timezone: z.string().min(1).max(100),
  recurrence: z.literal('DAILY'),
  observationSubjectKey: z.string().min(1).max(255),
  calendarEvent: calendarEventCreateSchema,
}).strict();
export type ScheduledCalendarAuthoring = z.infer<typeof scheduledCalendarAuthoringSchema>;
export const SCHEDULED_CALENDAR_RECIPE = PARAMETERIZED_ACTION_RECIPES[0];

export function compileScheduledCalendarAuthoring(scenarioKey:string|null,input:unknown,name:string,now=Date.now()) {
  const recipe=SCHEDULED_CALENDAR_RECIPE,scenario=scenarioKey?scenarioByKey(scenarioKey):null;
  if(!scenario||scenario.key!==recipe.scenarioKey||scenario.revision!==recipe.scenarioRevision||!scenario.supportedStrategies.includes(recipe.strategy))throw new Error('Scheduled calendar Recipe requires its registered Scenario');
  const parameters=scheduledCalendarAuthoringSchema.parse(input);
  const event=prepareAndroidCalendarCreate(parameters.calendarEvent);
  const nativeSubject=/^local:[^:]+:calendar:([1-9][0-9]*):[^:]+:([0-9]+)$/.exec(parameters.observationSubjectKey);
  if(!nativeSubject||nativeSubject[1]!==event.calendarId)throw new Error('Calendar observation subject must match the declared native calendar scope');
  const observationStartAt=Number(nativeSubject[2]);
  if(!Number.isSafeInteger(observationStartAt))throw new Error('Invalid calendar observation scope');
  const first=Date.parse(parameters.firstRunAt);
  if(first<=now)throw new Error('FIRST_RUN_NOT_FUTURE');
  if(first%60000!==0)throw new Error('FIRST_RUN_NOT_MINUTE');
  if(Date.parse(event.start.dateTime)<=first)throw new Error('EVENT_START_NOT_AFTER_FIRST_RUN');
  if(event.start.timeZone!==parameters.timezone||event.end.timeZone!==parameters.timezone)throw new Error('Calendar and trigger timezones must agree');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:parameters.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(first));
  const hour=Number(parts.find(p=>p.type==='hour')?.value),minute=Number(parts.find(p=>p.type==='minute')?.value);
  if(!Number.isFinite(hour)||!Number.isFinite(minute))throw new Error('Invalid trigger timezone');
  // The model's goal summary is descriptive input, not an unbounded Plan title.
  // Preserve it in the Goal contract; use the controlled Recipe title when long.
  const planName=name.length>120?'定时创建日历事项':name;
  const base=compileScenarioPlan({scenarioKey:scenario.key,scenarioRevision:scenario.revision,strategy:recipe.strategy,subjectKey:parameters.observationSubjectKey,name:planName,mode:'DRAFT'});
  const definition=normalizePlanDefinition({...base.definitionInput,automationLevel:'L2',approvalPolicy:{type:'always'},conditions:[],
    triggers:[{triggerType:'schedule',config:{cronExpression:`${minute} ${hour} * * *`,timezone:parameters.timezone,firstRunAt:parameters.firstRunAt},sortOrder:0}],
    actions:[{actionType:'publish',requiredCapability:'calendar.event.create',config:{visibility:'private',calendarEvent:event},stepOrder:0}],
  });
  return {parameters,definition,scenarioKey:scenario.key,scenarioRevision:scenario.revision,strategy:recipe.strategy,
    requiredFacts:scenario.requiredFacts,requiredCapabilities:[...recipe.requiredCapabilities],
    goal:{intent:recipe.goalIntent,description:name.slice(0,500),constraints:{recipeKey:recipe.key,calendarAuthoringJson:JSON.stringify(parameters),observationStartAt}},
    subject:{resourceType:'CalendarEvent',subjectKey:parameters.observationSubjectKey},
  };
}
