import { describe, expect, it } from 'vitest';
import { PlansService } from '../src/plans/plans.service';

// Exercise the actual projection method without creating a Plan or schedule.
const next = (cron: string, now: string, timezone?: string): Date | null =>
  (PlansService.prototype as unknown as {
    computeNextRun(cron: string, now: Date, timezone?: string): Date | null;
  }).computeNextRun(cron, new Date(now), timezone);

describe('Plan next-run projection respects frozen trigger timezone', () => {
  it('shows tomorrow 10:38 Shanghai after today\'s scheduled occurrence, not today 18:38', () => {
    expect(next('38 10 * * *', '2026-10-07T05:48:00Z', 'Asia/Shanghai')?.toISOString())
      .toBe('2026-10-08T02:38:00.000Z');
  });
  it('shows today\'s future occurrence before due time', () => {
    expect(next('38 10 * * *', '2026-10-07T02:37:00Z', 'Asia/Shanghai')?.toISOString())
      .toBe('2026-10-07T02:38:00.000Z');
  });
  it('preserves UTC semantics for legacy triggers without a timezone', () => {
    expect(next('38 10 * * *', '2026-10-07T05:48:00Z')?.toISOString())
      .toBe('2026-10-07T10:38:00.000Z');
  });
  it('handles DST with the same cron parser as runtime', () => {
    expect(next('0 9 * * *', '2026-11-01T13:30:00Z', 'America/New_York')?.toISOString())
      .toBe('2026-11-01T14:00:00.000Z');
  });
  it.each([['invalid', 'Asia/Shanghai'], ['38 10 * * *', 'Invalid/Timezone']])
    ('fails closed for invalid cron or timezone: %s', (cron, timezone) => {
      expect(next(cron, '2026-10-07T05:48:00Z', timezone)).toBeNull();
    });
});
