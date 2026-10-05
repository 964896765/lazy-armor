import { describe, expect, it } from 'vitest';
import { calendarDateInfo } from './calendar-date-info';
describe('CalendarSheet date labels', () => {
  it('shows the 2026 lunar new year and mid autumn dates', () => {
    expect(calendarDateInfo('2026-02-17')).toMatchObject({ lunar: '正月初一', festivals: expect.arrayContaining(['春节']) });
    expect(calendarDateInfo('2026-09-25')).toMatchObject({ lunar: '八月十五', festivals: expect.arrayContaining(['中秋节']) });
  });
  it('shows solar terms without turning them into holiday or execution states', () => {
    expect(calendarDateInfo('2026-10-08').term).toBe('寒露');
    expect(calendarDateInfo('2026-10-04').lunar).toBe('八月廿四');
  });
  it('keeps Chinese calendar labels without unrelated international observances', () => {
    expect(calendarDateInfo('2026-10-01').festivals).toContain('国庆节');
    expect(calendarDateInfo('2026-10-31').festivals).not.toContain('万圣节前夜');
  });
});
