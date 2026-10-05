import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsumerService } from './consumer.service';
import { WorkItemProjectionService } from './work-item-projection.service';

/** Date grouping of existing projections; no calendar task or execution authority. */
@Injectable()
export class CalendarProjectionService {
  constructor(private readonly consumer: ConsumerService, private readonly workItems: WorkItemProjectionService) {}

  async month(userId: string, month: string, timezone: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('请选择有效月份');
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }).format(); }
    catch { throw new BadRequestException('请选择有效时区'); }
    const [year, number] = month.split('-').map(Number);
    if (year! < 1900 || year! > 2100) throw new BadRequestException('日期超出支持范围');
    const count = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
    const work = await this.workItems.project(userId).catch(() => null);
    const refs = new Set(work?.items.map(item => `${item.sourceRef.type}:${item.sourceRef.id}`) ?? []);
    const dates: Array<{ date: string; state: 'AVAILABLE' | 'UNAVAILABLE'; total: number | null; incomplete: number | null; completed: number | null; workItems: number | null }> = [];
    for (let start = 1; start <= count; start += 4) {
      const batch = Array.from({ length: Math.min(4, count - start + 1) }, (_, index) => start + index);
      dates.push(...await Promise.all(batch.map(async day => {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        try {
          const items = await this.consumer.timeline(userId, date, timezone);
          return { date, state: 'AVAILABLE' as const, total: items.length,
            incomplete: items.filter(item => item.statusGroup === 'INCOMPLETE').length,
            completed: items.filter(item => item.statusGroup === 'COMPLETED').length,
            workItems: work ? items.filter(item => refs.has(`${item.sourceRef.type}:${item.sourceRef.id}`)).length : null };
        } catch {
          return { date, state: 'UNAVAILABLE' as const, total: null, incomplete: null, completed: null, workItems: null };
        }
      })));
    }
    return { authority: 'ScheduleProjection', relatedAuthority: 'WorkItemProjection', evaluatedAt: new Date().toISOString(), month, timezone, dates,
      // No configured weather acquisition exists yet. Never infer weather from date or location.
      weather: { state: 'UNAVAILABLE' as const, reason: '天气来源尚未接入', forecasts: [] },
      holidays: { state: 'UNAVAILABLE' as const, reason: '法定节假日与调休安排尚未同步' } };
  }
}
