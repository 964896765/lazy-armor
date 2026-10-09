import { describe,expect,it } from 'vitest';
import { compileScenarioPlan,normalizePlanDefinition,catalogHash } from '@lazy-armor/plan-schema';
import { confirmedCalendarRuntime } from '../src/strategy-runtime/confirmed-calendar-runtime';
const compiled=compileScenarioPlan({scenarioKey:'work.meetings',mode:'DRAFT'});
const calendarEvent={calendarId:'1',title:'Isolated runtime binding contract',start:{dateTime:'2026-10-08T09:00:00+08:00',timeZone:'Asia/Shanghai'},end:{dateTime:'2026-10-08T09:10:00+08:00',timeZone:'Asia/Shanghai'},attendees:[],sendUpdates:'none'};
const definition=normalizePlanDefinition({...compiled.definitionInput,approvalPolicy:{type:'always'},conditions:[],triggers:[{triggerType:'schedule',config:{cronExpression:'0 9 * * *',timezone:'Asia/Shanghai'},sortOrder:0}],actions:[{actionType:'publish',requiredCapability:'calendar.event.create',config:{visibility:'private',calendarEvent},stepOrder:0}]});
describe('Confirmed calendar Plan adapts the existing strategy runtime',()=>{
 it('preserves fact requirements and conditions, freezes schedule and requires approval/read-back',()=>{
  const runtime=confirmedCalendarRuntime(compiled.runtime,definition);
  expect(runtime.dependencies).toEqual(compiled.runtime.dependencies);expect(runtime.conditionAst).toEqual(compiled.runtime.conditionAst);
  expect(runtime).toMatchObject({actionMode:'EXECUTE',approvalPolicy:'ALWAYS_FOR_EXTERNAL',verificationPolicy:'READ_BACK',triggerProfile:{defaultMode:'SCHEDULE',schedule:{cronExpression:'0 9 * * *',timezone:'Asia/Shanghai'}}});
  const {runtimeHash,...content}=runtime;expect(runtimeHash).toBe(catalogHash(content));
 });
 it('rejects bypassed approval, unsupported conditions, alternate actions and malformed schedules',()=>{
  expect(()=>confirmedCalendarRuntime(compiled.runtime,{...definition,approvalPolicy:{type:'never'}} as never)).toThrow();
  expect(()=>confirmedCalendarRuntime(compiled.runtime,{...definition,conditions:[{}]} as never)).toThrow();
  expect(()=>confirmedCalendarRuntime(compiled.runtime,{...definition,actions:[{...definition.actions[0],requiredCapability:'email.send'}]} as never)).toThrow();
  expect(()=>confirmedCalendarRuntime(compiled.runtime,{...definition,triggers:[{...definition.triggers[0],config:{cronExpression:'invalid',timezone:'Asia/Shanghai'}}]} as never)).toThrow();
 });
});
