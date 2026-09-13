import { createHash } from 'node:crypto';
import { canonicalStringify, type RiskLevel } from './index';
import { CANONICAL_SCENARIOS, PLAN_STRATEGIES, PRODUCT_DOMAINS, type ProductDomainKey } from './product-model';

export const SCENARIO_READINESS_STATES = ['CATALOG_ONLY', 'MANUAL_READY', 'OBSERVE_READY', 'ASSISTED_READY', 'AUTOMATED_READY', 'BLOCKED_PROVIDER', 'BLOCKED_IMPLEMENTATION', 'DISABLED'] as const;
export type ScenarioReadinessState = typeof SCENARIO_READINESS_STATES[number];
export type StrategyKey = typeof PLAN_STRATEGIES[number]['key'];
export type RealityLevel = 'CLAIMED' | 'OBSERVED' | 'CORROBORATED' | 'VERIFIED';

export interface ResourceDefinition {
  schemaVersion: '1'; key: string; label: string; domain: ProductDomainKey;
  identityFields: readonly string[]; revision: number; status: 'ACTIVE';
}

export interface FactSchemaDefinition {
  schemaVersion: '1'; key: string; resourceType: string; field: string;
  valueType: 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'money' | 'quantity' | 'object_ref';
  unit: string | null; nullable: boolean; enumValues: readonly string[];
  freshnessTtlSeconds: number; semanticIdentity: readonly string[];
  sensitivity: 'PUBLIC' | 'PERSONAL' | 'SENSITIVE' | 'HIGHLY_SENSITIVE';
  minimumReality: RealityLevel; acceptedVerificationMethods: readonly string[];
  revision: number; status: 'ACTIVE';
}

export interface CapabilityRequirement {
  operation: 'READ' | 'EXECUTE' | 'SUBSCRIBE'; resourceType: string;
  capabilityKey: string; optional: boolean;
}

export interface StrategyProfile {
  schemaVersion: '1'; key: StrategyKey; label: string;
  triggerModes: readonly ('MANUAL' | 'SCHEDULE' | 'EVENT' | 'FACT_CHANGED' | 'THRESHOLD')[];
  defaultActionMode: 'OBSERVE' | 'REMIND' | 'PREPARE' | 'EXECUTE';
  attentionPolicy: 'ALWAYS' | 'ON_CHANGE' | 'ON_EXCEPTION' | 'PERIODIC';
  approvalPolicy: 'NEVER_EXTERNAL' | 'RISK_BASED' | 'ALWAYS_FOR_EXTERNAL';
  verificationPolicy: 'RECORD_ONLY' | 'READ_BACK' | 'CALLBACK_OR_READ_BACK';
  allowedAutomationCeiling: RiskLevel; revision: number; status: 'ACTIVE';
}

export interface ScenarioDefinition {
  schemaVersion: '1'; key: string; domain: ProductDomainKey; label: string;
  primaryResourceTypes: readonly string[]; requiredFacts: readonly string[]; optionalFacts: readonly string[];
  supportedStrategies: readonly StrategyKey[]; defaultStrategy: StrategyKey;
  sourceRequirements: readonly CapabilityRequirement[]; actionRequirements: readonly CapabilityRequirement[];
  triggerProfile: { modes: readonly ('MANUAL' | 'SCHEDULE' | 'EVENT' | 'FACT_CHANGED' | 'THRESHOLD')[]; deterministic: true };
  conditionSchema: { factKey: string; operators: readonly ('EXISTS' | 'CHANGED' | 'EQ' | 'GT' | 'LT')[] };
  defaultRiskFloor: RiskLevel; minimumReality: RealityLevel;
  truthPolicy: { minimumConfidence: number; requireEvidence: true };
  freshnessPolicy: { onStale: 'BLOCK' | 'REFRESH'; maximumAgeSeconds: number };
  conflictPolicy: { resolution: 'LATEST_VERIFIED_THEN_OBSERVED'; unresolved: 'BLOCK' };
  verificationRequirements: readonly ('AUDIT_RECORD' | 'READ_BACK_OR_CALLBACK')[];
  fallbackPolicy: { unknown: 'RECONCILE'; conflict: 'BLOCK'; unavailable: 'DEGRADE_TO_REMINDER' };
  templates: readonly string[];
  availabilityPolicy: { initialReadiness: 'CATALOG_ONLY'; executableRequiresRuntimeReadiness: true };
  revision: number; status: 'CATALOG_ONLY';
}

export interface ScenarioReadinessInput {
  availableFacts?: readonly string[]; usableCapabilities?: readonly string[];
  manualInputAvailable?: boolean; observationPipelineAvailable?: boolean;
  executionPipelineAvailable?: boolean; enabled?: boolean;
  providerBlocked?: boolean; implementationBlocked?: boolean;
}

export interface ScenarioReadiness {
  scenarioKey: string; state: ScenarioReadinessState; missingFacts: string[];
  missingCapabilities: string[]; reasons: string[]; evaluatedAgainstRevision: number;
}

const resourceSeeds: readonly [string, string, ProductDomainKey][] = [
  ['EmailMessage', '邮件', 'work'], ['CalendarEvent', '日历事件', 'work'], ['Task', '任务', 'work'], ['File', '文件', 'work'], ['Contact', '联系人', 'social'], ['Conversation', '会话', 'social'],
  ['Repository', '代码仓库', 'work'], ['Issue', '议题', 'work'], ['PullRequest', '合并请求', 'work'], ['Workflow', '工作流运行', 'work'],
  ['Transaction', '交易', 'finance'], ['AccountBalance', '账户余额', 'finance'], ['Bill', '账单', 'finance'], ['Budget', '预算', 'finance'], ['Subscription', '订阅', 'finance'], ['Refund', '退款', 'finance'], ['Invoice', '发票', 'finance'],
  ['Order', '订单', 'operations'], ['Shipment', '物流', 'daily_life'], ['Product', '商品', 'daily_life'], ['InventoryItem', '库存项', 'operations'], ['AfterSalesCase', '售后事项', 'operations'],
  ['Household', '家庭', 'family'], ['HouseholdMember', '家庭成员', 'family'], ['HouseholdTask', '家庭任务', 'family'], ['SupplyItem', '家庭补给', 'family'], ['UtilityAccount', '生活缴费账户', 'housing'],
  ['Vehicle', '车辆', 'vehicle'], ['VehicleServiceRecord', '车辆保养记录', 'vehicle'], ['VehicleInsurance', '车辆保险', 'vehicle'], ['VehicleInspection', '车辆年检', 'vehicle'], ['VehicleDiagnostic', '车辆诊断', 'vehicle'],
  ['Device', '设备', 'device'], ['DeviceStatus', '设备状态', 'device'], ['Consumable', '耗材', 'device'], ['Warranty', '保修', 'device'], ['DeviceSubscription', '设备订阅', 'device'],
  ['IdentityDocument', '证件', 'identity_docs'], ['DigitalAccount', '数字账户', 'digital_account'], ['OAuthGrant', 'OAuth 授权', 'digital_account'], ['Membership', '会员', 'digital_account'], ['StorageQuota', '存储容量', 'digital_account'],
  ['ContentItem', '内容', 'content'], ['ContentAsset', '内容素材', 'content'], ['ContentDraft', '内容草稿', 'content'], ['Publication', '发布记录', 'content'], ['PublicationTarget', '发布目标', 'content'], ['ContentMetric', '内容指标', 'content'],
  ['Trip', '行程', 'travel'], ['TripSegment', '行程段', 'travel'], ['Ticket', '票务', 'travel'], ['Booking', '预订', 'travel'], ['Place', '地点', 'travel'],
  ['HealthRecord', '健康记录', 'health'], ['PetRecord', '宠物记录', 'pet'], ['Contract', '合同', 'legal_contract'], ['GovernmentCase', '政务事项', 'government'], ['LearningRecord', '学习记录', 'study'], ['EntertainmentItem', '娱乐项目', 'entertainment'],
] as const;

export const RESOURCE_CATALOG: readonly ResourceDefinition[] = Object.freeze(resourceSeeds.map(([key, label, domain]) => Object.freeze({
  schemaVersion: '1' as const, key, label, domain, identityFields: Object.freeze(['subject_key', 'external_key']), revision: 1, status: 'ACTIVE' as const,
})));

const defaultResourceByDomain = Object.freeze(Object.fromEntries(PRODUCT_DOMAINS.map((domain) => [domain.key,
  RESOURCE_CATALOG.find((resource) => resource.domain === domain.key)?.key ?? 'Task',
])) as Record<ProductDomainKey, string>);

const camelToFact = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const scenarioResource = (domain: ProductDomainKey, scenarioKey: string) => {
  const overrides: Record<string, string> = {
    'finance.bill': 'Bill', 'finance.budget': 'Budget', 'finance.balance': 'AccountBalance', 'finance.subscription': 'Subscription', 'finance.refund': 'Refund', 'finance.abnormal_transaction': 'Transaction',
    'daily_life.delivery': 'Shipment', 'work.email': 'EmailMessage', 'work.meetings': 'CalendarEvent', 'work.files': 'File',
    'vehicle.maintenance': 'VehicleServiceRecord', 'vehicle.insurance': 'VehicleInsurance', 'vehicle.inspection': 'VehicleInspection', 'vehicle.abnormal': 'VehicleDiagnostic',
    'device.status': 'DeviceStatus', 'device.consumables': 'Consumable', 'device.warranty': 'Warranty', 'device.renewal': 'DeviceSubscription',
    'digital_account.oauth': 'OAuthGrant', 'digital_account.memberships': 'Membership', 'digital_account.storage': 'StorageQuota',
    'travel.tickets': 'Ticket', 'travel.accommodation': 'Booking', 'content.assets': 'ContentAsset', 'content.creation': 'ContentDraft', 'content.publishing': 'Publication',
  };
  return overrides[`${domain}.${scenarioKey}`] ?? defaultResourceByDomain[domain];
};

const strategyFor = (key: string): StrategyKey => {
  if (/(validity|renewal|insurance|inspection|warranty|anniversary|exam|vaccination|rent|lease|subscription)/.test(key)) return 'EXPIRY_GUARD';
  if (/(abnormal|risk|diagnostic|security|health|status)/.test(key)) return 'ANOMALY_DETECTION';
  if (/(summary|retrospective|metrics|budget|bill)/.test(key)) return 'PERIODIC_SUMMARY';
  if (/(prepare|supply|inventory|consumable|storage|energy)/.test(key)) return 'PREDICTIVE_PREPARE';
  return 'STATE_GUARD';
};

export const SCENARIO_DEFINITIONS: readonly ScenarioDefinition[] = Object.freeze(CANONICAL_SCENARIOS.map((scenario) => {
  const resourceType = scenarioResource(scenario.domain, scenario.key);
  const prefix = camelToFact(resourceType);
  const factKey = `${prefix}.${scenario.key}.state`;
  return Object.freeze({
    schemaVersion: '1' as const, key: `${scenario.domain}.${scenario.key}`, domain: scenario.domain, label: scenario.label,
    primaryResourceTypes: Object.freeze([resourceType]), requiredFacts: Object.freeze([factKey]), optionalFacts: Object.freeze([`${prefix}.updated_at`]),
    supportedStrategies: Object.freeze(PLAN_STRATEGIES.map((strategy) => strategy.key)), defaultStrategy: strategyFor(scenario.key),
    sourceRequirements: Object.freeze([{ operation: 'READ' as const, resourceType, capabilityKey: `READ_${camelToFact(resourceType).toUpperCase()}`, optional: false }]),
    actionRequirements: Object.freeze([{ operation: 'EXECUTE' as const, resourceType: 'Notification', capabilityKey: 'SEND_NOTIFICATION', optional: false }]),
    triggerProfile: Object.freeze({ modes: Object.freeze(['MANUAL', 'SCHEDULE', 'FACT_CHANGED'] as const), deterministic: true as const }),
    conditionSchema: Object.freeze({ factKey, operators: Object.freeze(['EXISTS', 'CHANGED', 'EQ', 'GT', 'LT'] as const) }),
    defaultRiskFloor: 'R1' as const, minimumReality: 'OBSERVED' as const,
    truthPolicy: Object.freeze({ minimumConfidence: 0.8, requireEvidence: true as const }),
    freshnessPolicy: Object.freeze({ onStale: 'REFRESH' as const, maximumAgeSeconds: 86_400 }),
    conflictPolicy: Object.freeze({ resolution: 'LATEST_VERIFIED_THEN_OBSERVED' as const, unresolved: 'BLOCK' as const }),
    verificationRequirements: Object.freeze(['AUDIT_RECORD'] as const),
    fallbackPolicy: Object.freeze({ unknown: 'RECONCILE' as const, conflict: 'BLOCK' as const, unavailable: 'DEGRADE_TO_REMINDER' as const }),
    templates: Object.freeze([]), availabilityPolicy: Object.freeze({ initialReadiness: 'CATALOG_ONLY' as const, executableRequiresRuntimeReadiness: true as const }),
    revision: 1, status: 'CATALOG_ONLY' as const,
  });
}));

const factMap = new Map<string, FactSchemaDefinition>();
for (const scenario of SCENARIO_DEFINITIONS) {
  const resourceType = scenario.primaryResourceTypes[0];
  for (const [key, field, valueType] of [[scenario.requiredFacts[0], `${scenario.key.split('.')[1]}.state`, 'string'], [scenario.optionalFacts[0], 'updated_at', 'datetime']] as const) {
    if (!factMap.has(key)) factMap.set(key, Object.freeze({
      schemaVersion: '1', key, resourceType, field, valueType, unit: null, nullable: false, enumValues: Object.freeze([]),
      freshnessTtlSeconds: 86_400, semanticIdentity: Object.freeze(['subject_key', 'resource_key', 'field']), sensitivity: 'PERSONAL',
      minimumReality: 'OBSERVED', acceptedVerificationMethods: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK']), revision: 1, status: 'ACTIVE',
    }));
  }
}
export const FACT_SCHEMA_CATALOG: readonly FactSchemaDefinition[] = Object.freeze([...factMap.values(),
  ...[['Repository', 'repository.metadata'], ['Issue', 'issue.state'], ['PullRequest', 'pull_request.state'], ['Workflow', 'workflow.run_status']].map(([resourceType, key]): FactSchemaDefinition => Object.freeze({
    schemaVersion: '1', key, resourceType, field: key.split('.').slice(1).join('.'), valueType: 'object_ref', unit: null, nullable: false, enumValues: Object.freeze([]),
    freshnessTtlSeconds: 300, semanticIdentity: Object.freeze(['connection_id', 'repository_id', 'resource_id']), sensitivity: 'SENSITIVE', minimumReality: 'OBSERVED',
    acceptedVerificationMethods: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK']), revision: 1, status: 'ACTIVE' })),
  Object.freeze({ schemaVersion: '1' as const, key: 'calendar_event.schedule', resourceType: 'CalendarEvent', field: 'schedule', valueType: 'object_ref' as const,
    unit: null, nullable: false, enumValues: Object.freeze([]), freshnessTtlSeconds: 300,
    semanticIdentity: Object.freeze(['connection_id', 'calendar_id', 'event_id']), sensitivity: 'SENSITIVE' as const, minimumReality: 'OBSERVED' as const,
    acceptedVerificationMethods: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK']), revision: 1, status: 'ACTIVE' as const }),
  ...['metadata', 'body', 'labels'].map((field): FactSchemaDefinition => Object.freeze({ schemaVersion: '1', key: `email_message.${field}`,
    resourceType: 'EmailMessage', field, valueType: 'object_ref', unit: null, nullable: false, enumValues: Object.freeze([]),
    freshnessTtlSeconds: 86400, semanticIdentity: Object.freeze(['connection_id', 'message_id', 'field']), sensitivity: 'SENSITIVE',
    minimumReality: 'OBSERVED', acceptedVerificationMethods: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK']), revision: 1, status: 'ACTIVE' })),
]);

const strategyDefaults: Record<StrategyKey, Omit<StrategyProfile, 'schemaVersion' | 'key' | 'label' | 'revision' | 'status'>> = {
  STATE_GUARD: { triggerModes: ['EVENT', 'FACT_CHANGED', 'THRESHOLD'], defaultActionMode: 'REMIND', attentionPolicy: 'ON_CHANGE', approvalPolicy: 'RISK_BASED', verificationPolicy: 'READ_BACK', allowedAutomationCeiling: 'R2' },
  EXPIRY_GUARD: { triggerModes: ['SCHEDULE', 'FACT_CHANGED'], defaultActionMode: 'REMIND', attentionPolicy: 'ON_EXCEPTION', approvalPolicy: 'RISK_BASED', verificationPolicy: 'READ_BACK', allowedAutomationCeiling: 'R2' },
  ANOMALY_DETECTION: { triggerModes: ['EVENT', 'FACT_CHANGED', 'THRESHOLD'], defaultActionMode: 'REMIND', attentionPolicy: 'ON_EXCEPTION', approvalPolicy: 'RISK_BASED', verificationPolicy: 'READ_BACK', allowedAutomationCeiling: 'R2' },
  SILENT_FOLLOW_UP: { triggerModes: ['SCHEDULE', 'EVENT', 'FACT_CHANGED'], defaultActionMode: 'OBSERVE', attentionPolicy: 'ON_CHANGE', approvalPolicy: 'NEVER_EXTERNAL', verificationPolicy: 'READ_BACK', allowedAutomationCeiling: 'R1' },
  PERIODIC_SUMMARY: { triggerModes: ['SCHEDULE'], defaultActionMode: 'REMIND', attentionPolicy: 'PERIODIC', approvalPolicy: 'NEVER_EXTERNAL', verificationPolicy: 'RECORD_ONLY', allowedAutomationCeiling: 'R1' },
  PREDICTIVE_PREPARE: { triggerModes: ['SCHEDULE', 'FACT_CHANGED', 'THRESHOLD'], defaultActionMode: 'PREPARE', attentionPolicy: 'ON_CHANGE', approvalPolicy: 'ALWAYS_FOR_EXTERNAL', verificationPolicy: 'CALLBACK_OR_READ_BACK', allowedAutomationCeiling: 'R2' },
  ASSISTED_ACTION: { triggerModes: ['MANUAL', 'EVENT', 'FACT_CHANGED'], defaultActionMode: 'PREPARE', attentionPolicy: 'ALWAYS', approvalPolicy: 'ALWAYS_FOR_EXTERNAL', verificationPolicy: 'CALLBACK_OR_READ_BACK', allowedAutomationCeiling: 'R3' },
  AUTOMATED_ACTION: { triggerModes: ['SCHEDULE', 'EVENT', 'FACT_CHANGED'], defaultActionMode: 'EXECUTE', attentionPolicy: 'ON_EXCEPTION', approvalPolicy: 'RISK_BASED', verificationPolicy: 'CALLBACK_OR_READ_BACK', allowedAutomationCeiling: 'R2' },
};

export const STRATEGY_PROFILES: readonly StrategyProfile[] = Object.freeze(PLAN_STRATEGIES.map((strategy) => Object.freeze({
  schemaVersion: '1' as const, key: strategy.key, label: strategy.label, ...strategyDefaults[strategy.key], revision: 1, status: 'ACTIVE' as const,
})));

export function catalogHash(value: unknown): string { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }

export function scenarioByKey(key: string): ScenarioDefinition | null { return SCENARIO_DEFINITIONS.find((scenario) => scenario.key === key) ?? null; }

export function evaluateScenarioReadiness(definition: ScenarioDefinition, input: ScenarioReadinessInput = {}): ScenarioReadiness {
  const facts = new Set(input.availableFacts ?? []);
  const capabilities = new Set(input.usableCapabilities ?? []);
  const missingFacts = definition.requiredFacts.filter((fact) => !facts.has(fact));
  const missingCapabilities = [...definition.sourceRequirements, ...definition.actionRequirements].filter((item) => !item.optional && !capabilities.has(item.capabilityKey)).map((item) => item.capabilityKey);
  const reasons: string[] = [];
  let state: ScenarioReadinessState = 'CATALOG_ONLY';
  if (input.enabled === false) state = 'DISABLED';
  else if (input.providerBlocked) state = 'BLOCKED_PROVIDER';
  else if (input.implementationBlocked) state = 'BLOCKED_IMPLEMENTATION';
  else if (missingFacts.length || missingCapabilities.length) state = input.manualInputAvailable ? 'MANUAL_READY' : 'CATALOG_ONLY';
  else if (!input.observationPipelineAvailable) state = 'MANUAL_READY';
  else if (!input.executionPipelineAvailable) state = 'OBSERVE_READY';
  else if (definition.defaultRiskFloor >= 'R3') state = 'ASSISTED_READY';
  else state = 'AUTOMATED_READY';
  if (missingFacts.length) reasons.push('REQUIRED_FACTS_UNAVAILABLE');
  if (missingCapabilities.length) reasons.push('REQUIRED_CAPABILITIES_UNUSABLE');
  if (!input.observationPipelineAvailable) reasons.push('OBSERVATION_PIPELINE_UNAVAILABLE');
  if (!input.executionPipelineAvailable) reasons.push('EXECUTION_PIPELINE_UNAVAILABLE');
  return { scenarioKey: definition.key, state, missingFacts, missingCapabilities: [...new Set(missingCapabilities)], reasons, evaluatedAgainstRevision: definition.revision };
}

for (const scenario of SCENARIO_DEFINITIONS) {
  if (!RESOURCE_CATALOG.some((resource) => scenario.primaryResourceTypes.includes(resource.key))) throw new Error(`Unknown resource in ${scenario.key}`);
  if (!scenario.requiredFacts.every((fact) => FACT_SCHEMA_CATALOG.some((schema) => schema.key === fact))) throw new Error(`Unknown fact in ${scenario.key}`);
}
