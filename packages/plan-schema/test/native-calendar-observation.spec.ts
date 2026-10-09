import {describe,it,expect} from 'vitest';
import {parseAndNormalizeObservation,type SourceObservationInput} from '../src/reality-pipeline';
describe('native calendar evidence adapter',()=>{
 const input:SourceObservationInput={sourceMode:'NATIVE_OS',providerKey:'android-native',deviceId:'device',externalEventKey:'signed-read:123',parserKey:'native.calendar-event.v1',resourceHint:'CalendarEvent',payload:{id:'42',calendarId:'7',startAt:1000,endAt:2000,title:'真实事件',status:'SCHEDULED'},observedAt:'2026-10-04T00:00:00Z',evidenceHash:'a'.repeat(64)};
 it('keeps native provenance instead of inventing a connection and preserves exact schedule',()=>{
  const facts=parseAndNormalizeObservation(input);expect(facts).toHaveLength(2);expect(facts[0].subjectKey).toBe('local:device:calendar:7:42:1000');expect(facts[0].value.start).toEqual({dateTime:'1970-01-01T00:00:01.000Z'});expect(facts[1].factKey).toBe('calendar_event.meetings.state');
 });
 it('preserves all-day calendar dates without inventing an 08:00 time',()=>{const facts=parseAndNormalizeObservation({...input,payload:{...input.payload,allDay:true,startAt:Date.parse('2026-10-05T00:00:00Z'),endAt:Date.parse('2026-10-06T00:00:00Z')}});expect(facts[0].value).toMatchObject({allDay:true,start:{date:'2026-10-05'},end:{date:'2026-10-06'}});expect(facts[0].value.start).not.toHaveProperty('dateTime');});
 it('fails closed on provider masquerading or invalid time/status',()=>{
  expect(()=>parseAndNormalizeObservation({...input,sourceMode:'OFFICIAL_API'})).toThrow();
  expect(()=>parseAndNormalizeObservation({...input,payload:{...input.payload,endAt:0}})).toThrow();
  expect(()=>parseAndNormalizeObservation({...input,payload:{...input.payload,status:'AI_GUESSED'}})).toThrow();
 });
 it('represents verified absence without inventing an event time or a scheduled event',()=>{
  const absent={...input,parserKey:'native.calendar-event-absence.v1' as const,payload:{id:'42',calendarId:'7',present:false}};
  const facts=parseAndNormalizeObservation(absent);
  expect(facts).toHaveLength(1);expect(facts[0]).toMatchObject({subjectKey:'local:device:calendar:7:42',factKey:'calendar_event.presence',value:{eventId:'42',calendarId:'7',present:false}});
  expect(facts[0].value).not.toHaveProperty('start');
  expect(()=>parseAndNormalizeObservation({...absent,sourceMode:'OFFICIAL_API'})).toThrow();
  expect(()=>parseAndNormalizeObservation({...absent,payload:{...absent.payload,present:true}})).toThrow();
 });
});
