import { describe, expect, it, vi } from 'vitest';
import { CalendarProjectionService } from '../src/consumer/calendar-projection.service';
import type { ConsumerService } from '../src/consumer/consumer.service';
import type { WorkItemProjectionService } from '../src/consumer/work-item-projection.service';
describe('Calendar date grouping of authoritative projections', () => {
  it('preserves unavailable dates and groups work references by scheduled date, never updatedAt', async () => {
    const timeline = vi.fn(async (_user: string, date: string) => {
      if (date === '2026-10-02') throw new Error('source unavailable');
      return date === '2026-10-01' ? [{ statusGroup: 'INCOMPLETE', sourceRef: { type: 'ServiceRequest', id: 'request-1' } }] : [];
    });
    const project = vi.fn(async () => ({ items: [{ updatedAt: '2026-10-03T00:00:00Z', sourceRef: { type: 'ServiceRequest', id: 'request-1' } }] }));
    const service = new CalendarProjectionService({timeline} as unknown as ConsumerService, {project} as unknown as WorkItemProjectionService);
    const result = await service.month('owner', '2026-10', 'Asia/Shanghai');
    expect(result.dates[0]).toMatchObject({ total: 1, incomplete: 1, workItems: 1 });
    expect(result.dates[1]).toMatchObject({ state: 'UNAVAILABLE', total: null });
    expect(result.dates[2]).toMatchObject({ total: 0, workItems: 0 });
    expect(result.weather.forecasts).toEqual([]);
    await expect(service.month('owner', '2026-13', 'Asia/Shanghai')).rejects.toThrow();
    await expect(service.month('owner', '2026-10', 'Invalid/Zone')).rejects.toThrow();
  });
});
