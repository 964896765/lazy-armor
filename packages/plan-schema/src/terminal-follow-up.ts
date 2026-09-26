import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalStringify } from './index';
import { scenarioByKey, scenarioDefinitionByKey, type ScenarioDefinition, type StrategyKey } from './runtime-catalog';
import { buildStrategyRuntime, type CompiledStrategyRuntime } from './strategy-runtime';

export type TerminalHandoffTargetKind = 'NOTION_UPDATE' | 'CALENDAR_EVENT';
export interface TerminalHandoffTarget {
  kind: TerminalHandoffTargetKind;
  connectionId: string;
  action: Record<string, unknown>;
}

type TargetDefinition =
  | { kind: 'NOTION_UPDATE'; providerKey: 'notion'; capabilityKey: 'UPDATE_PAGE' }
  | { kind: 'CALENDAR_EVENT'; providerKey: 'google_calendar'; capabilityKey: 'CREATE_CALENDAR_EVENT' };

type TerminalRule = {
  key: string;
  revision: 1;
  scenarioKey: string;
  scenarioRevision: number;
  providerKey: 'github' | 'gmail';
  resourceType: 'PullRequest' | 'Workflow' | 'EmailMessage';
  factKey: 'pull_request.state' | 'workflow.run_status' | 'email_message.metadata';
  capabilityKey: 'READ_PULL_REQUEST' | 'READ_WORKFLOW_STATUS' | 'READ_EMAIL_BODY';
  field: 'merged' | 'status' | 'subject';
  terminal?: boolean | 'completed';
  condition?: 'EXISTS';
  strategy: StrategyKey;
  target?: TargetDefinition;
};

const uuid = z.string().uuid();
const notionScalar = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), value: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('rich_text'), value: z.string().max(2000) }).strict(),
  z.object({ type: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('checkbox'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('date'), value: z.object({ start: z.string().datetime(), end: z.string().datetime().nullable().optional() }).strict() }).strict(),
  z.object({ type: z.literal('select'), value: z.string().min(1).max(100) }).strict(),
  z.object({ type: z.literal('status'), value: z.string().min(1).max(100) }).strict(),
]);
const notionUpdate = z.object({
  parent: z.object({ type: z.enum(['page_id', 'data_source_id']), id: uuid }).strict(),
  pageId: uuid,
  properties: z.record(z.string().min(1).max(200), notionScalar).refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 32),
  expectedLastEditedTime: z.string().datetime().optional(),
}).strict();
const calendarEndpoint = z.object({
  dateTime: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }),
}).strict();
const calendarEvent = z.object({
  calendarId: z.string().email().max(254).transform((value) => value.toLowerCase()),
  title: z.string().min(1).max(512),
  start: calendarEndpoint,
  end: calendarEndpoint,
  attendees: z.array(z.string().email().max(254).transform((value) => value.toLowerCase())).max(20),
  sendUpdates: z.enum(['all', 'externalOnly', 'none']),
}).strict().refine((value) => Date.parse(value.end.dateTime) > Date.parse(value.start.dateTime), { message: 'Calendar event end must be after start' });

// Additive revisions only. Cross-provider targets remain ordinary immutable Plan
// actions and use the existing Risk/Approval/Outbox/Verification pipeline.
export const TERMINAL_FOLLOW_UP_RULES: readonly TerminalRule[] = Object.freeze([
  Object.freeze({ key: 'github.pull-request.merged', revision: 1, scenarioKey: 'work.tasks', scenarioRevision: 2, providerKey: 'github', resourceType: 'PullRequest', factKey: 'pull_request.state', capabilityKey: 'READ_PULL_REQUEST', field: 'merged', terminal: true, strategy: 'SILENT_FOLLOW_UP' }),
  Object.freeze({ key: 'github.workflow.completed', revision: 1, scenarioKey: 'work.recurring_work', scenarioRevision: 2, providerKey: 'github', resourceType: 'Workflow', factKey: 'workflow.run_status', capabilityKey: 'READ_WORKFLOW_STATUS', field: 'status', terminal: 'completed', strategy: 'SILENT_FOLLOW_UP' }),
  Object.freeze({ key: 'github.pull-request.merged.notion-update', revision: 1, scenarioKey: 'work.tasks', scenarioRevision: 3, providerKey: 'github', resourceType: 'PullRequest', factKey: 'pull_request.state', capabilityKey: 'READ_PULL_REQUEST', field: 'merged', terminal: true, strategy: 'SILENT_FOLLOW_UP', target: Object.freeze({ kind: 'NOTION_UPDATE', providerKey: 'notion', capabilityKey: 'UPDATE_PAGE' }) }),
  Object.freeze({ key: 'github.workflow.completed.notion-update', revision: 1, scenarioKey: 'work.recurring_work', scenarioRevision: 3, providerKey: 'github', resourceType: 'Workflow', factKey: 'workflow.run_status', capabilityKey: 'READ_WORKFLOW_STATUS', field: 'status', terminal: 'completed', strategy: 'SILENT_FOLLOW_UP', target: Object.freeze({ kind: 'NOTION_UPDATE', providerKey: 'notion', capabilityKey: 'UPDATE_PAGE' }) }),
  Object.freeze({ key: 'gmail.email.calendar-event', revision: 1, scenarioKey: 'work.email', scenarioRevision: 2, providerKey: 'gmail', resourceType: 'EmailMessage', factKey: 'email_message.metadata', capabilityKey: 'READ_EMAIL_BODY', field: 'subject', condition: 'EXISTS', strategy: 'ASSISTED_ACTION', target: Object.freeze({ kind: 'CALENDAR_EVENT', providerKey: 'google_calendar', capabilityKey: 'CREATE_CALENDAR_EVENT' }) }),
]);
export type TerminalFollowUpRule = TerminalRule;

export function terminalFollowUpRule(scenarioKey: string, revision: number): TerminalFollowUpRule | undefined {
  return TERMINAL_FOLLOW_UP_RULES.find((rule) => rule.scenarioKey === scenarioKey && rule.scenarioRevision === revision);
}

export function scenarioByRevision(key: string, revision: number): ScenarioDefinition | undefined {
  const canonical = scenarioDefinitionByKey(key);
  if (canonical?.revision === revision) return canonical;
  const rule = terminalFollowUpRule(key, revision);
  return rule ? terminalFollowUpScenario(rule) : undefined;
}

export function terminalFollowUpScenario(rule: TerminalFollowUpRule): ScenarioDefinition {
  const original = scenarioByKey(rule.scenarioKey);
  if (!original) throw new Error('Terminal scenario is outside the canonical catalog');
  return {
    ...original,
    revision: rule.scenarioRevision,
    primaryResourceTypes: [rule.resourceType],
    requiredFacts: [rule.factKey],
    optionalFacts: [],
    defaultStrategy: rule.strategy,
    supportedStrategies: [rule.strategy],
    sourceRequirements: [{ operation: 'READ', resourceType: rule.resourceType, capabilityKey: rule.capabilityKey, optional: false }],
    actionRequirements: rule.target ? [{ operation: 'EXECUTE', resourceType: rule.target.kind === 'NOTION_UPDATE' ? 'Page' : 'CalendarEvent', capabilityKey: rule.target.capabilityKey, optional: false }] : [],
    conditionSchema: { factKey: rule.factKey, operators: rule.condition === 'EXISTS' ? ['EXISTS'] : ['EQ', 'CHANGED'] },
    minimumReality: 'VERIFIED',
    defaultRiskFloor: rule.target ? 'R3' : 'R1',
    freshnessPolicy: { onStale: 'BLOCK', maximumAgeSeconds: 300 },
  };
}

export function buildTerminalFollowUpRuntime(rule: TerminalFollowUpRule, subjectKey?: string): CompiledStrategyRuntime {
  const uuidPattern = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
  const sourcePattern = rule.providerKey === 'github'
    ? `${uuidPattern}:[1-9][0-9]*:${rule.resourceType}:[1-9][0-9]*`
    : `${uuidPattern}:[A-Za-z0-9_-]{1,200}`;
  if (!subjectKey || !new RegExp(`^${sourcePattern}$`, 'i').test(subjectKey)) {
    throw new Error('Terminal follow-up requires an exact authenticated source subject');
  }
  const { runtimeHash: _oldHash, ...original } = buildStrategyRuntime(terminalFollowUpScenario(rule), rule.strategy, subjectKey);
  const conditionAst = rule.condition === 'EXISTS'
    ? { kind: 'PREDICATE' as const, operator: 'EXISTS' as const, factKey: rule.factKey }
    : { kind: 'GROUP' as const, operator: 'ALL' as const, children: [
      { kind: 'PREDICATE' as const, operator: 'CHANGED' as const, factKey: rule.factKey },
      { kind: 'PREDICATE' as const, operator: 'EQ' as const, factKey: rule.factKey, comparisonValue: rule.terminal },
    ] };
  const runtime = {
    ...original,
    actionMode: rule.target ? (rule.strategy === 'ASSISTED_ACTION' ? 'PREPARE' as const : 'EXECUTE' as const) : 'REMIND' as const,
    approvalPolicy: rule.target ? 'ALWAYS_FOR_EXTERNAL' as const : 'NEVER_EXTERNAL' as const,
    verificationPolicy: rule.target ? 'CALLBACK_OR_READ_BACK' as const : 'RECORD_ONLY' as const,
    conditionAst,
    dependencies: [{ factKey: rule.factKey, resourceType: rule.resourceType, field: rule.field, scope: 'EXACT_SUBJECT' as const, subjectKey }],
  };
  return { ...runtime, runtimeHash: createHash('sha256').update(canonicalStringify(runtime)).digest('hex') };
}

export function validateTerminalTarget(rule: TerminalFollowUpRule, target: TerminalHandoffTarget | undefined): TerminalHandoffTarget | undefined {
  if (!rule.target) {
    if (target) throw new Error('This terminal rule does not accept an external target');
    return undefined;
  }
  if (!target || target.kind !== rule.target.kind || !uuid.safeParse(target.connectionId).success || !target.action || typeof target.action !== 'object' || Array.isArray(target.action)) {
    throw new Error('Terminal follow-up requires an exact approved target');
  }
  const parsed = rule.target.kind === 'NOTION_UPDATE' ? notionUpdate.safeParse(target.action) : calendarEvent.safeParse(target.action);
  if (!parsed.success) throw new Error(`Terminal follow-up target action is invalid: ${parsed.error.issues[0]?.message ?? 'invalid action'}`);
  return { kind: target.kind, connectionId: target.connectionId, action: parsed.data };
}

export function terminalTargetConfig(rule: TerminalFollowUpRule, target: TerminalHandoffTarget | undefined) {
  const value = validateTerminalTarget(rule, target);
  return value && rule.target ? {
    ruleKey: rule.key,
    ruleRevision: rule.revision,
    kind: value.kind,
    providerKey: rule.target.providerKey,
    capabilityKey: rule.target.capabilityKey,
    action: value.action,
  } : undefined;
}

export function terminalTargetContext(target: TerminalHandoffTarget | undefined) {
  return !target ? {} : target.kind === 'NOTION_UPDATE' ? { notionAction: target.action } : { calendarEvent: target.action };
}

/**
 * A stored Plan action carrying this marker is server-owned: it may only be
 * dispatched from an authenticated Strategy wakeup. Treat even a malformed
 * marker as protected so callers cannot bypass the handoff by corrupting it.
 */
export function requiresTerminalHandoffProof(config: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(config, 'handoffTarget');
}

export function terminalTargetFromPlanAction(rule: TerminalFollowUpRule, action: {
  connectorKey: string | null;
  connectionId: string | null;
  requiredCapability: string | null;
  configJson: Record<string, unknown>;
}): TerminalHandoffTarget | undefined {
  if (!rule.target) return undefined;
  const value = action.configJson.handoffTarget;
  if (action.connectorKey !== rule.target.providerKey || !action.connectionId || action.requiredCapability !== rule.target.capabilityKey
    || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Terminal target action is unavailable');
  const target = value as Record<string, unknown>;
  if (target.ruleKey !== rule.key || target.ruleRevision !== rule.revision || target.kind !== rule.target.kind
    || target.providerKey !== rule.target.providerKey || target.capabilityKey !== rule.target.capabilityKey
    || !target.action || typeof target.action !== 'object' || Array.isArray(target.action)) throw new Error('Terminal target action is invalid');
  return validateTerminalTarget(rule, { kind: target.kind as TerminalHandoffTargetKind, connectionId: action.connectionId, action: target.action as Record<string, unknown> });
}

export function terminalRuleSummary(rule: TerminalFollowUpRule, payload: Record<string, unknown>) {
  if (rule.providerKey === 'gmail') return `邮件“${payload.subject ?? '无主题'}”已通过验证，等待已批准的日历处理`;
  if (rule.resourceType === 'PullRequest') return `PR #${payload.number} 已合并，等待已批准的后续处理`;
  return `Workflow ${payload.resourceId ?? '未知'} 已完成：${payload.conclusion ?? '未知结论'}，等待已批准的后续处理`;
}
