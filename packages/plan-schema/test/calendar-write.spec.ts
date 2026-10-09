import { describe, expect, it } from 'vitest';
import { calendarEventCreateSchema, prepareAndroidCalendarCreate, prepareAndroidCalendarUpdate, prepareAndroidCalendarDelete } from '../src/calendar-write';

const event = {
  calendarId: '1', title: 'Approved event',
  start: { dateTime: '2026-10-06T09:00:00+08:00', timeZone: 'Asia/Shanghai' },
  end: { dateTime: '2026-10-06T10:00:00+08:00', timeZone: 'Asia/Shanghai' },
  attendees: [], sendUpdates: 'none',
};
describe('calendar write contract (isolated, not real execution evidence)', () => {
  it('preserves the same event semantics across target calendar identities', () => {
    expect(prepareAndroidCalendarCreate(event)).toEqual(event);
    expect(calendarEventCreateSchema.parse({ ...event, calendarId: 'owner@example.test' })).toEqual({ ...event, calendarId: 'owner@example.test' });
  });
  it.each([
    { calendarId: 'owner@example.test' }, { calendarId: '0' }, { calendarId: '9007199254740992' },
    { attendees: ['guest@example.test'] }, { sendUpdates: 'all' },
  ])('rejects unsupported Android semantics before an effect: %j', patch => {
    expect(() => prepareAndroidCalendarCreate({ ...event, ...patch })).toThrow();
  });
  it.each([
    { end: event.start }, { start: { ...event.start, timeZone: 'invalid-zone' } },
    { title: '' }, { eventId: 'client-injected' }, { approval: true },
  ])('fails closed on invalid or injected event fields: %j', patch => {
    expect(calendarEventCreateSchema.safeParse({ ...event, ...patch }).success).toBe(false);
  });
});

describe('exact Android external mutation scope', () => {
  const identity={calendarId:'1',eventId:'19',expectedOperationMarker:'lazyarmor-operation:'+'a'.repeat(64)};
  it('keeps update distinct from create and preserves its time constraints', () => {
    const update={...event,...identity};
    expect(prepareAndroidCalendarUpdate(update)).toEqual(update);
    expect(()=>prepareAndroidCalendarCreate(update)).toThrow();
    expect(()=>prepareAndroidCalendarUpdate({...update,end:event.start})).toThrow();
    expect(()=>prepareAndroidCalendarUpdate({...update,attendees:['guest@example.test']})).toThrow();
  });
  it('restricts deletion to one identified operation without broad selectors', () => {
    expect(prepareAndroidCalendarDelete(identity)).toEqual(identity);
    for(const patch of [{eventId:'*'},{eventId:'9007199254740992'},{expectedOperationMarker:''},{where:'1=1'},{title:'delete all'},{approval:true}]) {
      expect(()=>prepareAndroidCalendarDelete({...identity,...patch})).toThrow();
    }
    expect(()=>prepareAndroidCalendarDelete({calendarId:'1',eventId:'19'})).toThrow();
  });
});
