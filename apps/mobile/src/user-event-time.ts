export function eventLocalInput(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
}

/** Convert a user wall time using the event timezone, rejecting DST gaps/ambiguity. */
export function eventInstant(input: string, timezone: string) {
  input = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) throw Error('请输入日期和时间，例如 2026-10-08 15:00');
  const local = input.replace(' ', 'T');
  const wall = Date.parse(local + ':00Z');
  const matches: number[] = [];
  // IANA civil offsets are minute granular for current and future user events.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    if (eventLocalInput(new Date(wall - offset * 60_000).toISOString(), timezone) === input) matches.push(offset);
  }
  if (matches.length !== 1) throw Error('这个本地时间不存在或有时区歧义，请选择其他时间');
  const offset = matches[0];
  return local + ':00' + (offset >= 0 ? '+' : '-') + String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0');
}
