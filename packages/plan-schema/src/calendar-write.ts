import { z } from 'zod';

/** Target-neutral approved event fields. Target identity stays in Invocation. */
export const calendarEventTimeSchema = z.object({
  dateTime: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }),
}).strict();

export const calendarEventCreateSchema = z.object({
  calendarId: z.string().min(1).max(254),
  title: z.string().min(1).max(512),
  start: calendarEventTimeSchema,
  end: calendarEventTimeSchema,
  attendees: z.array(z.string().email().max(254).transform(value => value.toLowerCase())).max(20),
  sendUpdates: z.enum(['all', 'externalOnly', 'none']),
}).strict().refine(value => Date.parse(value.end.dateTime) > Date.parse(value.start.dateTime), {
  message: 'Event end must follow start', path: ['end'],
});

export type CalendarEventCreate = z.infer<typeof calendarEventCreateSchema>;
/** Update/delete address exactly one externally verified event, never a query scope. */
const calendarMutationIdentitySchema = z.object({
  calendarId: z.string().regex(/^[1-9][0-9]*$/).refine(value => Number.isSafeInteger(Number(value))),
  eventId: z.string().regex(/^[1-9][0-9]*$/).refine(value => Number.isSafeInteger(Number(value))),
  expectedOperationMarker: z.string().regex(/^lazyarmor-operation:[a-f0-9]{64}$/),
}).strict();
export const calendarEventUpdateSchema = calendarEventCreateSchema.safeExtend(calendarMutationIdentitySchema.shape);
export const calendarEventDeleteSchema = calendarMutationIdentitySchema;
export const NATIVE_CALENDAR_CAPABILITIES = ['calendar.event.create','calendar.event.update','calendar.event.delete'] as const;
export const NATIVE_CALENDAR_TASK_TYPES = ['NATIVE_CALENDAR_CREATE','NATIVE_CALENDAR_WRITE'] as const;
export function nativeCalendarGrant(capability: string) {
  if (!(NATIVE_CALENDAR_CAPABILITIES as readonly string[]).includes(capability)) throw new Error('NATIVE_CALENDAR_CAPABILITY_REQUIRED');
  return 'calendar.' + capability.slice('calendar.event.'.length);
}
export const ANDROID_CALENDAR_WRITE_POLICY: import('./verification-runtime').VerificationPolicy = {
  key:'android-calendar-create.readback',revision:'1',providerKey:'android_calendar',capabilityKey:'calendar.event.create',
  methods:['OPERATION_LOOKUP'],timeoutMs:10000,maxAttempts:5,expiresAfterMs:86400000,
  predicates:[{path:['verificationEvidence','matched'],equals:true,result:'SUCCEEDED'}],
};
export const ANDROID_CALENDAR_UPDATE_POLICY: import('./verification-runtime').VerificationPolicy = {
  ...ANDROID_CALENDAR_WRITE_POLICY,key:'android-calendar-update.readback',capabilityKey:'calendar.event.update',
};
export const ANDROID_CALENDAR_DELETE_POLICY: import('./verification-runtime').VerificationPolicy = {
  ...ANDROID_CALENDAR_WRITE_POLICY,key:'android-calendar-delete.absence',capabilityKey:'calendar.event.delete',
};

/** Android v1 supports local timed events only; never silently drop invitations. */
export function prepareAndroidCalendarCreate(input: unknown): CalendarEventCreate {
  const event = calendarEventCreateSchema.parse(input);
  if (!/^[1-9][0-9]*$/.test(event.calendarId) || !Number.isSafeInteger(Number(event.calendarId))
    || event.attendees.length !== 0 || event.sendUpdates !== 'none') {
    throw new Error('Android calendar create requires a local calendar and no invitations');
  }
  return event;
}

export function prepareAndroidCalendarUpdate(input: unknown) {
  const event = calendarEventUpdateSchema.parse(input);
  const {eventId, expectedOperationMarker, ...fields} = event;
  prepareAndroidCalendarCreate(fields);
  return {...fields, eventId, expectedOperationMarker};
}
export function prepareAndroidCalendarDelete(input: unknown) {
  return calendarEventDeleteSchema.parse(input);
}
