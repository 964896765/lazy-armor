import { describe, expect, it } from 'vitest';
import { dueScheduleSlot } from '../src/strategy-runtime/terminal-handoff.service';
describe('Existing worker automatic schedule adapter', () => {
 it('uses the trigger timezone and does not fire outside its scheduled minute', () => {
   expect(dueScheduleSlot('0 8 * * *','Asia/Shanghai',new Date('2026-10-04T00:00:30Z'))?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
   expect(dueScheduleSlot('0 8 * * *','Asia/Shanghai',new Date('2026-10-04T00:01:00Z'))).toBeNull();
   expect(dueScheduleSlot('* * * * *','Asia/Shanghai',new Date('2026-10-04T00:00:00Z'))?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
   expect(dueScheduleSlot('invalid','Asia/Shanghai',new Date())).toBeNull();
 });
});
