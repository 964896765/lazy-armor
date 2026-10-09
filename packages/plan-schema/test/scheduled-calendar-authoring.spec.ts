import {describe,it,expect} from 'vitest';
import {compileScheduledCalendarAuthoring,scenarioByKey,scenarioContractV2ByKey} from '../src/index';
const now=Date.parse('2026-10-06T12:00:00Z');
const input={recipeKey:'calendar.scheduled-create.v1',firstRunAt:'2026-10-06T14:47:00+00:00',timezone:'Asia/Shanghai',recurrence:'DAILY',observationSubjectKey:'local:owned-device:calendar:1:42:123',calendarEvent:{calendarId:'1',title:'Isolated authoring contract',start:{dateTime:'2026-10-06T23:00:00+08:00',timeZone:'Asia/Shanghai'},end:{dateTime:'2026-10-06T23:10:00+08:00',timeZone:'Asia/Shanghai'},attendees:[],sendUpdates:'none'}};
describe('Registered scheduled calendar authoring Recipe, no execution authority',()=>{
 it('preserves the existing reminder contract hash and gives the Recipe a separate goal-scoped hash',()=>{
  const base=scenarioContractV2ByKey('work.meetings')!;
  expect(base.definitionHash).toBe('a6f22e1efffac44cd9d55b3caecf53c0b83b29cc96948b6453f6eb7784d0ca42');
  const write=scenarioContractV2ByKey('work.meetings','CREATE_SCHEDULED_CALENDAR_EVENT')!;
  expect(write.definitionHash).not.toBe(base.definitionHash);
  expect(write.actionDemands.map(d=>d.capabilityKey)).toEqual(['calendar.event.create']);
 });
 it('derives capability, approval, verification inputs and local schedule from parameters',()=>{
  const c=compileScheduledCalendarAuthoring('work.meetings',input,'Calendar Plan',now);
  expect(c.scenarioRevision).toBe(scenarioByKey('work.meetings')!.revision);
  expect(c.requiredCapabilities).toContain('calendar.event.create');
  expect(c.definition.approvalPolicy).toMatchObject({type:'always'});
  expect(c.definition.triggers[0].config).toMatchObject({cronExpression:'47 22 * * *',timezone:'Asia/Shanghai',firstRunAt:input.firstRunAt});
  expect(c.definition.actions).toHaveLength(1);
  expect(c.definition.actions[0]).toMatchObject({actionType:'publish',requiredCapability:'calendar.event.create'});
  expect(c.goal.intent).toBe('CREATE_SCHEDULED_CALENDAR_EVENT');
 });
 it.each([null,'invented.scenario','work.email'])('rejects missing or incompatible registered Scenario %s',scenario=>{
  expect(()=>compileScheduledCalendarAuthoring(scenario,input,'Calendar Plan',now)).toThrow();
 });
 it('separates a long Goal summary from the bounded controlled Plan title',()=>{
  const summary='先读取真实日历并经审批创建事项，创建后重新读取核对。'.repeat(8);
  const compiled=compileScheduledCalendarAuthoring('work.meetings',input,summary,now);
  expect(compiled.definition.name).toBe('定时创建日历事项');
  expect(compiled.goal.description).toBe(summary);
  expect(compileScheduledCalendarAuthoring('work.meetings',input,compiled.definition.name,now).definition).toEqual(compiled.definition);
  expect(()=>compileScheduledCalendarAuthoring('work.meetings',{...input,firstRunAt:'2026-10-06T11:00:00Z'},summary,now)).toThrow('FIRST_RUN_NOT_FUTURE');
 });
 it.each([{...input,actionType:'publish'},{...input,firstRunAt:'2026-10-06T11:00:00Z'},{...input,timezone:'invalid'},{...input,recurrence:'ONCE'},{...input,calendarEvent:{...input.calendarEvent,calendarId:'invented'}}])('rejects injected actions, elapsed time and unsupported semantics',parameters=>{
  expect(()=>compileScheduledCalendarAuthoring('work.meetings',parameters,'Calendar Plan',now)).toThrow();
 });
});
