import { describe, expect, it } from 'vitest';
import { userEventInputSchema } from './user-event';
const input = { title: '去医院', dueAt: '2026-10-08T15:00:00+08:00', reminderAt: '2026-10-08T14:45:00+08:00', timezone: 'Asia/Shanghai' };
describe('internal personal-item contract', () => {
  it('keeps due and reminder instants distinct', () => { expect(userEventInputSchema.parse(input)).toEqual(input); });
  it('rejects offset-free times and an offset inconsistent with its timezone', () => {
    expect(userEventInputSchema.safeParse({ ...input, dueAt: '2026-10-08T15:00:00' }).success).toBe(false);
    expect(userEventInputSchema.safeParse({ ...input, dueAt: '2026-10-08T15:00:00Z' }).success).toBe(false);
  });
  it('rejects invalid zones, late reminders and external action fields', () => {
    for (const patch of [{ timezone: 'bad/zone' }, { reminderAt: '2026-10-08T15:01:00+08:00' }, { capability: 'calendar.event.create' }]) expect(userEventInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('validates actual DST offsets rather than a fixed UTC offset', () => {
    expect(userEventInputSchema.safeParse({ ...input, timezone: 'America/New_York', dueAt: '2026-03-08T02:30:00-05:00', reminderAt: '2026-03-08T01:00:00-05:00' }).success).toBe(false);
    expect(userEventInputSchema.safeParse({ ...input, timezone: 'America/New_York', dueAt: '2026-03-08T03:30:00-04:00', reminderAt: '2026-03-08T01:00:00-05:00' }).success).toBe(true);
  });
});
