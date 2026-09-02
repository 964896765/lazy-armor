import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SOURCE_TYPES = ['manual', 'email', 'calendar', 'notification', 'file', 'webhook', 'internal', 'commerce', 'device', 'vehicle', 'billing', 'content_platform'] as const;
export const TRIGGER_TYPES = ['manual', 'schedule', 'event', 'webhook', 'threshold', 'date_before', 'date_after', 'data_changed'] as const;
export const CONDITION_OPERATORS = ['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS', 'CHANGED', 'PERCENT_CHANGE_GT', 'TIME_RANGE', 'EXISTS', 'NOT_EXISTS'] as const;
export const ACTION_TYPES = ['record', 'classify', 'summarize', 'compare', 'notify', 'create_draft', 'create_task', 'archive', 'sync', 'generate_content', 'prepare_publish', 'publish', 'prepare_purchase', 'create_order', 'update_internal_record', 'request_approval'] as const;
export const PLAN_STATES = ['draft', 'ready', 'active', 'paused', 'degraded', 'blocked', 'archived'] as const;
export const AUTOMATION_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export const PLAN_DOMAINS = ['general', 'life', 'family', 'housing', 'travel', 'entertainment', 'finance', 'billing', 'work', 'operations', 'content', 'study', 'vehicle', 'device', 'digital_account', 'shopping'] as const;

export type SourceType = typeof SOURCE_TYPES[number];
export type TriggerType = typeof TRIGGER_TYPES[number];
export type ConditionOperator = typeof CONDITION_OPERATORS[number];
export type ActionType = typeof ACTION_TYPES[number];
export type PlanState = typeof PLAN_STATES[number];
export type AutomationLevel = typeof AUTOMATION_LEVELS[number];
export type RiskLevel = typeof RISK_LEVELS[number];

export const ACTION_DEFINITIONS: Readonly<Record<ActionType, { riskLevel: RiskLevel; externalEffect: boolean; amountField?: string; currencyField?: string }>> = Object.freeze({
  record: { riskLevel: 'R1', externalEffect: false },
  classify: { riskLevel: 'R1', externalEffect: false },
  summarize: { riskLevel: 'R1', externalEffect: false },
  compare: { riskLevel: 'R0', externalEffect: false },
  notify: { riskLevel: 'R1', externalEffect: false },
  create_draft: { riskLevel: 'R2', externalEffect: false },
  create_task: { riskLevel: 'R1', externalEffect: false },
  archive: { riskLevel: 'R1', externalEffect: false },
  sync: { riskLevel: 'R2', externalEffect: true },
  generate_content: { riskLevel: 'R2', externalEffect: false },
  prepare_publish: { riskLevel: 'R2', externalEffect: false },
  publish: { riskLevel: 'R3', externalEffect: true },
  prepare_purchase: { riskLevel: 'R1', externalEffect: false, amountField: 'amount', currencyField: 'currency' },
  create_order: { riskLevel: 'R4', externalEffect: true, amountField: 'amount', currencyField: 'currency' },
  update_internal_record: { riskLevel: 'R1', externalEffect: false },
  request_approval: { riskLevel: 'R1', externalEffect: false },
});

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const strictEmpty = z.object({}).strict();
const shortText = z.string().min(1).max(255);
const fieldPath = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]{0,127}$/);

const sourceConfigSchemas: Record<SourceType, z.ZodTypeAny> = {
  manual: z.object({ inputSchema: z.record(z.string(), z.enum(['string', 'number', 'boolean', 'date'])).optional() }).strict(),
  email: z.object({ folder: shortText.optional(), query: z.string().max(500).optional() }).strict(),
  calendar: z.object({ calendarId: shortText.optional() }).strict(),
  notification: z.object({ category: shortText.optional() }).strict(),
  file: z.object({ pathPrefix: z.string().max(500).optional(), metadataOnly: z.boolean().optional() }).strict(),
  webhook: z.object({ eventType: shortText }).strict(),
  internal: z.object({
    resource: shortText,
    billingPeriod: shortText.optional(),
    trackingNumber: shortText.optional(),
    carrier: shortText.optional(),
    staleHours: z.number().int().min(1).max(24 * 365).optional(),
    notifyOnException: z.boolean().optional(),
    notifyOnDelivered: z.boolean().optional(),
    itemName: shortText.optional(),
    category: shortText.optional(),
    lastPurchasedAt: shortText.optional(),
    purchaseQuantity: z.number().int().min(1).max(1000000).optional(),
    estimatedUsageDays: z.number().int().min(1).max(3650).optional(),
    remindBeforeDays: z.number().int().min(0).max(3650).optional(),
    preparationMode: shortText.optional(),
    masterContentId: z.uuid().optional(),
    targetPlatforms: z.array(shortText).max(10).optional(),
    includedSources: z.array(shortText).max(10).optional(),
    emailConnectionId: z.uuid().optional(),
    calendarConnectionId: z.uuid().optional(),
    lookAheadHours: z.number().int().min(1).max(24 * 14).optional(),
    includeCalendar: z.boolean().optional(),
    includeMessages: z.boolean().optional(),
    maxItems: z.number().int().min(1).max(100).optional(),
    examName: shortText.optional(),
    examDate: shortText.optional(),
    subjects: z.array(shortText).max(20).optional(),
    dailyStudyMinutes: z.number().int().min(1).max(24 * 60).optional(),
    preferredStudyTime: shortText.optional(),
    target: shortText.optional(),
    currentProgress: z.number().int().min(0).max(100).optional(),
    weeklySummaryDay: shortText.optional(),
    missedTaskStrategy: shortText.optional(),
    deviceProfileId: z.uuid().optional(),
    consumableId: z.uuid().optional(),
    profileId: z.uuid().optional(),
    expectedDomain: shortText.optional(),
  }).strict(),
  commerce: z.object({ resource: shortText }).strict(),
  device: z.object({ metric: shortText }).strict(),
  vehicle: z.object({ metric: shortText }).strict(),
  billing: z.object({ billType: shortText }).strict(),
  content_platform: z.object({ contentType: shortText }).strict(),
};

const cronExpression = z.string().trim().refine((value) => value.split(/\s+/).length === 5, 'cronExpression must contain exactly 5 fields');
const triggerConfigSchemas: Record<TriggerType, z.ZodTypeAny> = {
  manual: strictEmpty,
  schedule: z.object({ cronExpression, timezone: z.string().min(1).max(64) }).strict(),
  event: z.object({ eventType: shortText }).strict(),
  webhook: z.object({ eventType: shortText }).strict(),
  threshold: z.object({ fieldPath, direction: z.enum(['above', 'below']), value: z.union([z.string(), z.number().finite()]) }).strict(),
  date_before: z.object({ fieldPath, offsetDays: z.number().int().min(0).max(3650) }).strict(),
  date_after: z.object({ fieldPath, offsetDays: z.number().int().min(0).max(3650) }).strict(),
  data_changed: z.object({ fieldPath }).strict(),
};

const actionConfigSchemas: Record<ActionType, z.ZodTypeAny> = {
  record: z.object({ recordType: shortText.optional() }).strict(),
  classify: z.object({
    taxonomy: shortText.optional(),
    showCategories: z.boolean().optional(),
    billingPeriod: shortText.optional(),
  }).strict(),
  summarize: z.object({
    format: z.enum(['short', 'detailed']).optional(),
    showCategories: z.boolean().optional(),
    showMonthOverMonth: z.boolean().optional(),
    guardType: shortText.optional(),
    domain: shortText.optional(),
    staleHours: z.number().int().min(1).max(24 * 365).optional(),
    notifyOnException: z.boolean().optional(),
    notifyOnDelivered: z.boolean().optional(),
    preparationMode: shortText.optional(),
    maxItems: z.number().int().min(1).max(100).optional(),
    lookAheadHours: z.number().int().min(1).max(24 * 14).optional(),
    notificationPreference: shortText.optional(),
  }).strict(),
  compare: z.object({
    baseline: shortText.optional(),
    enabled: z.boolean().optional(),
    anomalyThresholdPercent: z.number().finite().min(0).max(10000).optional(),
  }).strict(),
  notify: z.object({
    channel: z.enum(['in_app', 'push', 'email']).default('in_app'),
    templateKey: shortText.optional(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
    eventType: shortText.optional(),
  }).strict(),
  create_draft: z.object({
    draftType: shortText.optional(),
    domain: shortText.optional(),
  }).strict(),
  create_task: z.object({
    list: shortText.optional(),
    domain: shortText.optional(),
  }).strict(),
  archive: z.object({ destination: shortText.optional() }).strict(),
  sync: z.object({ resource: shortText }).strict(),
  generate_content: z.object({
    format: shortText,
    targetPlatforms: z.array(shortText).max(10).optional(),
    generateTitle: z.boolean().optional(),
    generateDescription: z.boolean().optional(),
    generateTags: z.boolean().optional(),
    prepareCover: z.boolean().optional(),
  }).strict(),
  prepare_publish: z.object({
    platform: shortText.optional(),
    domain: shortText.optional(),
    targetPlatforms: z.array(shortText).max(10).optional(),
    notificationPreference: shortText.optional(),
    requireApprovalBeforePublish: z.boolean().optional(),
    providerGate: shortText.optional(),
  }).strict(),
  publish: z.object({ visibility: z.enum(['private', 'unlisted', 'public']) }).strict(),
  prepare_purchase: z.object({
    currency: z.string().length(3).optional(),
    domain: shortText.optional(),
    itemName: shortText.optional(),
    preparationMode: shortText.optional(),
  }).strict(),
  create_order: z.object({ currency: z.string().length(3) }).strict(),
  update_internal_record: z.object({ recordType: shortText }).strict(),
  request_approval: z.object({ reason: z.string().min(1).max(500) }).strict(),
};

const sourceSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  connectorKey: z.string().min(1).max(80).optional(),
  connectionId: z.uuid().optional(),
  config: z.record(z.string(), jsonValueSchema),
  sortOrder: z.number().int().min(0).max(10_000),
}).strict();

const triggerSchema = z.object({
  triggerType: z.enum(TRIGGER_TYPES),
  config: z.record(z.string(), jsonValueSchema),
  sortOrder: z.number().int().min(0).max(10_000),
}).strict();

const conditionSchema = z.object({
  groupId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).default('root'),
  logicalOperator: z.enum(['AND', 'OR']).default('AND'),
  fieldPath,
  operator: z.enum(CONDITION_OPERATORS),
  comparisonValue: jsonValueSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000),
}).strict().superRefine((condition, context) => {
  const noValue = ['CHANGED', 'EXISTS', 'NOT_EXISTS'].includes(condition.operator);
  if (noValue && condition.comparisonValue !== undefined) context.addIssue({ code: 'custom', path: ['comparisonValue'], message: `${condition.operator} does not accept comparisonValue` });
  if (!noValue && condition.comparisonValue === undefined) context.addIssue({ code: 'custom', path: ['comparisonValue'], message: `${condition.operator} requires comparisonValue` });
  if (!noValue && condition.comparisonValue === null) context.addIssue({ code: 'custom', path: ['comparisonValue'], message: 'Use EXISTS or NOT_EXISTS instead of a null comparison' });
  if (['IN', 'NOT_IN', 'TIME_RANGE'].includes(condition.operator) && !Array.isArray(condition.comparisonValue)) context.addIssue({ code: 'custom', path: ['comparisonValue'], message: `${condition.operator} requires an array` });
  if (condition.operator === 'PERCENT_CHANGE_GT' && typeof condition.comparisonValue !== 'number') context.addIssue({ code: 'custom', path: ['comparisonValue'], message: 'PERCENT_CHANGE_GT requires a number' });
});

const actionSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  connectorKey: z.string().min(1).max(80).optional(),
  connectionId: z.uuid().optional(),
  requiredCapability: z.string().min(1).max(100).optional(),
  config: z.record(z.string(), jsonValueSchema),
  stepOrder: z.number().int().min(0).max(10_000),
}).strict();

export const APPROVAL_POLICY_TYPES = ['never', 'always', 'first_time', 'above_risk_level', 'above_amount', 'per_execution', 'temporary_authorization'] as const;
export type ApprovalPolicyType = typeof APPROVAL_POLICY_TYPES[number];

const approvalPolicySchema = z.object({
  type: z.enum(APPROVAL_POLICY_TYPES),
  config: z.record(z.string(), jsonValueSchema).default({}),
}).strict().superRefine((policy, context) => {
  if (policy.type === 'above_risk_level' && !RISK_LEVELS.includes(policy.config.riskLevel as RiskLevel)) {
    context.addIssue({ code: 'custom', path: ['config', 'riskLevel'], message: 'above_risk_level requires config.riskLevel R0-R4' });
  }
  if (policy.type === 'above_amount') {
    const amountMinor = policy.config.amountMinor;
    const currency = policy.config.currency;
    if (!Number.isInteger(amountMinor) || (amountMinor as number) < 0) {
      context.addIssue({ code: 'custom', path: ['config', 'amountMinor'], message: 'above_amount requires a non-negative integer config.amountMinor' });
    }
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      context.addIssue({ code: 'custom', path: ['config', 'currency'], message: 'above_amount requires an uppercase ISO config.currency' });
    }
  }
});

export interface ApprovalPolicyDefinition {
  type: ApprovalPolicyType;
  config: Record<string, JsonValue>;
}

export const planDefinitionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000).nullable().optional(),
  domain: z.enum(PLAN_DOMAINS),
  automationLevel: z.enum(AUTOMATION_LEVELS),
  approvalPolicy: approvalPolicySchema.optional(),
  sources: z.array(sourceSchema).min(1).max(20),
  triggers: z.array(triggerSchema).min(1).max(20),
  conditions: z.array(conditionSchema).max(100).default([]),
  actions: z.array(actionSchema).min(1).max(100),
}).strict().superRefine((definition, context) => {
  for (const [key, rows] of Object.entries({ sources: definition.sources, triggers: definition.triggers, conditions: definition.conditions, actions: definition.actions })) {
    const positions = rows.map((row) => 'stepOrder' in row ? row.stepOrder : row.sortOrder);
    if (new Set(positions).size !== positions.length) context.addIssue({ code: 'custom', path: [key], message: `${key} order values must be unique` });
  }
});

export type PlanDefinitionInput = z.input<typeof planDefinitionInputSchema>;

export interface NormalizedSource {
  sourceType: SourceType;
  connectorKey: string | null;
  connectionId: string | null;
  config: Record<string, JsonValue>;
  sortOrder: number;
}

export interface NormalizedTrigger {
  triggerType: TriggerType;
  config: Record<string, JsonValue>;
  sortOrder: number;
}

export interface NormalizedCondition {
  groupId: string;
  logicalOperator: 'AND' | 'OR';
  fieldPath: string;
  operator: ConditionOperator;
  comparisonValue: JsonValue | null;
  sortOrder: number;
}

export interface NormalizedAction {
  actionType: ActionType;
  connectorKey: string | null;
  connectionId: string | null;
  requiredCapability: string | null;
  riskLevel: RiskLevel;
  config: Record<string, JsonValue>;
  stepOrder: number;
}

export interface PlanDefinition {
  schemaVersion: '1.0';
  name: string;
  description: string | null;
  domain: typeof PLAN_DOMAINS[number];
  automationLevel: AutomationLevel;
  approvalPolicy?: ApprovalPolicyDefinition;
  sources: NormalizedSource[];
  triggers: NormalizedTrigger[];
  conditions: NormalizedCondition[];
  actions: NormalizedAction[];
}

export interface PolicyReferences {
  riskPolicyRef?: string;
  approvalPolicyRef?: string;
  notificationPolicyRef?: string;
  retryPolicyRef?: string;
  fallbackPolicyRef?: string;
  resultPolicyRef?: string;
}

export function normalizePlanDefinition(input: PlanDefinitionInput): PlanDefinition {
  const parsed = planDefinitionInputSchema.parse(input);
  const sources = parsed.sources.map((source) => ({
    ...source,
    connectorKey: source.connectorKey ?? null,
    connectionId: source.connectionId ?? null,
    config: sourceConfigSchemas[source.sourceType].parse(source.config) as Record<string, JsonValue>,
  })).sort((a, b) => a.sortOrder - b.sortOrder);
  const triggers = parsed.triggers.map((trigger) => ({
    ...trigger,
    config: triggerConfigSchemas[trigger.triggerType].parse(trigger.config) as Record<string, JsonValue>,
  })).sort((a, b) => a.sortOrder - b.sortOrder);
  const conditions = parsed.conditions.map((condition) => ({
    ...condition,
    comparisonValue: condition.comparisonValue ?? null,
  })).sort((a, b) => a.sortOrder - b.sortOrder);
  const actions = parsed.actions.map((action) => ({
    ...action,
    connectorKey: action.connectorKey ?? null,
    connectionId: action.connectionId ?? null,
    requiredCapability: action.requiredCapability ?? null,
    riskLevel: ACTION_DEFINITIONS[action.actionType].riskLevel,
    config: actionConfigSchemas[action.actionType].parse(action.config) as Record<string, JsonValue>,
  })).sort((a, b) => a.stepOrder - b.stepOrder);
  return {
    schemaVersion: '1.0',
    name: parsed.name,
    description: parsed.description ?? null,
    domain: parsed.domain,
    automationLevel: parsed.automationLevel,
    ...(parsed.approvalPolicy ? { approvalPolicy: parsed.approvalPolicy as ApprovalPolicyDefinition } : {}),
    sources,
    triggers,
    conditions,
    actions,
  };
}

export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function definitionHash(definition: PlanDefinition): string {
  return createHash('sha256').update(canonicalStringify(definition)).digest('hex');
}
