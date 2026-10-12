import { z } from 'zod';

export const GOAL_BRIEF_FIELDS = ['goal', 'motivation', 'currentState', 'resources', 'constraints', 'timeframe', 'budget', 'location', 'successCriteria', 'riskPreference'] as const;
export const requirementSourceRefSchema = z.object({
  kind: z.enum(['USER_MESSAGE', 'CONFIRMED_MEMORY', 'VERIFIED_TRUTH']),
  id: z.string().min(1).max(160),
  version: z.union([z.string().min(1).max(160), z.number().int().positive()]).optional(),
  quote: z.string().min(1).max(12000),
}).strict().superRefine((source, context) => {
  if (source.kind !== 'USER_MESSAGE' && source.version === undefined)
    context.addIssue({ code: 'custom', message: 'Confirmed sources need their exact version' });
  if (source.kind === 'CONFIRMED_MEMORY' && typeof source.version !== 'number')
    context.addIssue({ code: 'custom', message: 'Memory sources require their numeric version' });
  if (source.kind === 'VERIFIED_TRUTH' && typeof source.version !== 'string')
    context.addIssue({ code: 'custom', message: 'Truth sources require their exact version identity' });
});
export const goalBriefFieldSchema = z.object({
  key: z.enum(GOAL_BRIEF_FIELDS),
  value: z.string().trim().min(1).max(12000).nullable(),
  status: z.enum(['USER_STATED', 'CONFIRMED', 'ASSUMPTION', 'UNKNOWN']),
  sourceRefs: z.array(requirementSourceRefSchema).max(8),
}).strict().superRefine((field, context) => {
  if (field.status === 'UNKNOWN' && (field.value !== null || field.sourceRefs.length))
    context.addIssue({ code: 'custom', message: 'Unknown requirements cannot contain facts or sources' });
  if (field.status !== 'UNKNOWN' && field.value === null)
    context.addIssue({ code: 'custom', message: 'Known requirements need a value' });
  if (field.status === 'USER_STATED' && (!field.sourceRefs.length || field.sourceRefs.some(source => source.kind !== 'USER_MESSAGE')))
    context.addIssue({ code: 'custom', message: 'User statements need their exact user message sources' });
  if (field.status === 'CONFIRMED' && !field.sourceRefs.length)
    context.addIssue({ code: 'custom', message: 'Confirmed requirements need reviewed sources' });
  if (field.status === 'ASSUMPTION' && field.sourceRefs.length)
    context.addIssue({ code: 'custom', message: 'Assumptions cannot claim user or verified sources' });
  if (['USER_STATED', 'CONFIRMED'].includes(field.status) && field.value !== null && field.sourceRefs.some(source => !source.quote.includes(field.value!)))
    context.addIssue({ code: 'custom', message: 'A requirement value must be grounded in its exact source excerpt' });
});
export const goalBriefReadinessSchema = z.object({
  state: z.enum(['NEEDS_CLARIFICATION', 'READY_FOR_PROPOSAL']),
  reasonCodes: z.array(z.string().min(1).max(120)).max(10),
  questions: z.array(z.object({ key: z.enum(GOAL_BRIEF_FIELDS), question: z.string().min(1).max(500) }).strict()).max(3),
  executionAuthorized: z.literal(false),
}).strict();
export const goalBriefReportSubjectSchema = z.object({
  kind: z.enum(['CAR_WASH_BUSINESS', 'GENERAL']),
  sourceRefs: z.array(requirementSourceRefSchema).min(1).max(3),
}).strict().superRefine((subject, context) => {
  if (subject.sourceRefs.some(source => source.kind !== 'USER_MESSAGE'))
    context.addIssue({ code: 'custom', message: 'Report scope must come from actual user requests' });
  if (subject.kind === 'CAR_WASH_BUSINESS' && !subject.sourceRefs.some(source => /洗车/.test(source.quote) && /商业|经营|投资|盈亏|评估|报告/.test(source.quote)))
    context.addIssue({ code: 'custom', message: 'Car-wash business scope needs its explicit user request' });
});
/** Requirement evidence and planning readiness, never approval, execution, or Truth authority. */
export const goalBriefSchema = z.object({
  schemaVersion: z.literal('goal-brief.v1'),
  goalId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  statement: z.string().trim().min(1).max(12000),
  domain: z.string().max(120).nullable(),
  lifecycle: z.enum(['TEMPORARY', 'USER_EVENT', 'PERSISTENT']).nullable(),
  outcomeKind: z.enum(['REPORT', 'PLAN', 'ACTION', 'INFORMATION', 'UNSPECIFIED']),
  reportSubject: goalBriefReportSubjectSchema.optional(),
  fields: z.array(goalBriefFieldSchema).min(1).max(GOAL_BRIEF_FIELDS.length),
  readiness: goalBriefReadinessSchema,
  createdAt: z.iso.datetime(),
  executionAuthorized: z.literal(false),
}).strict().superRefine((brief, context) => {
  if (new Set(brief.fields.map(field => field.key)).size !== brief.fields.length)
    context.addIssue({ code: 'custom', message: 'Each requirement field occurs once' });
  const goal = brief.fields.find(field => field.key === 'goal');
  if (!goal || goal.status !== 'USER_STATED' || goal.value !== brief.statement)
    context.addIssue({ code: 'custom', message: 'A GoalBrief must retain its exact user-stated goal' });
  if ((brief.readiness.state === 'NEEDS_CLARIFICATION') !== (brief.readiness.questions.length > 0))
    context.addIssue({ code: 'custom', message: 'Clarification readiness must match its questions' });
});
export const goalBriefRefSchema = z.object({
  goalId: z.string().min(1).max(160), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RequirementSourceRef = z.infer<typeof requirementSourceRefSchema>;
export type GoalBriefField = z.infer<typeof goalBriefFieldSchema>;
export type GoalBrief = z.infer<typeof goalBriefSchema>;
export type GoalBriefRef = z.infer<typeof goalBriefRefSchema>;
export type GoalBriefReadiness = z.infer<typeof goalBriefReadinessSchema>;
