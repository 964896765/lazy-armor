import { z } from 'zod';

const instant = z.string().datetime({ offset: true });
export const userEventInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  dueAt: instant,
  reminderAt: instant,
  timezone: z.string().min(1).max(80),
}).strict().superRefine((value, ctx) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
  } catch {
    ctx.addIssue({ code: 'custom', path: ['timezone'], message: 'Invalid IANA timezone' });
    return;
  }
  if (Date.parse(value.reminderAt) > Date.parse(value.dueAt)) {
    ctx.addIssue({ code: 'custom', path: ['reminderAt'], message: 'Reminder must not follow due time' });
  }
  for (const key of ['dueAt', 'reminderAt'] as const) {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value[key]));
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    const local = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
    if (local !== value[key].slice(0, 19)) ctx.addIssue({ code: 'custom', path: [key], message: 'Offset does not match timezone' });
  }
});
export type UserEventInput = z.infer<typeof userEventInputSchema>;
export type UserEventStatus = 'active' | 'completed' | 'cancelled';
export interface UserEventView extends UserEventInput {
  id: string;
  kind: 'USER_EVENT';
  status: UserEventStatus;
  version: number;
  remindedAt: string | null;
  completedAt: string | null;
}
