import { describe, expect, it } from 'vitest';
import { eventInstant, eventLocalInput } from './user-event-time';
describe('personal-item wall time editing', () => {
  it('preserves the selected timezone independently of device timezone', () => {
    expect(eventInstant('2026-10-08 15:00', 'Asia/Shanghai')).toBe('2026-10-08T15:00:00+08:00');
    expect(eventLocalInput('2026-10-08T07:00:00Z', 'Asia/Shanghai')).toBe('2026-10-08 15:00');
  });
  it('accepts fullwidth punctuation from a Chinese keyboard', () => {
    expect(eventInstant('２０２６－１０－０８　１５：３０', 'Asia/Shanghai')).toBe('2026-10-08T15:30:00+08:00');
  });
  it('rejects invalid dates and DST ambiguity/gaps', () => {
    for (const time of ['2026-02-30 15:00', '2026-03-08 02:30', '2026-11-01 01:30']) expect(()=>eventInstant(time,'America/New_York')).toThrow();
  });
});
