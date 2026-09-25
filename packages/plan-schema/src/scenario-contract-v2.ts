import { z } from 'zod';
import { catalogHash, scenarioByKey, type RealityLevel } from './runtime-catalog';

export const SCENARIO_CONTRACT_VERSION = 2 as const;
export const SCENARIO_GOVERNANCE_STATES = [
  'CATALOG_ONLY',
  'CONTRACT_COMPLETE',
  'DETERMINISTIC_SANDBOX',
  'REAL_SOURCE_VERIFIED',
  'REAL_ACTION_VERIFIED',
  'BETA_ELIGIBLE',
  'PRODUCTION_ELIGIBLE',
] as const;
export type ScenarioGovernanceState = typeof SCENARIO_GOVERNANCE_STATES[number];

export const scenarioGoalSpecSchema = z.object({
  intent: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  constraints: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
}).strict();

export const scenarioResourceSubjectSchema = z.object({
  resourceType: z.string().trim().min(1).max(120),
  subjectKey: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255).optional(),
}).strict();

export type ScenarioGoalSpec = z.infer<typeof scenarioGoalSpecSchema>;
export type ScenarioResourceSubject = z.infer<typeof scenarioResourceSubjectSchema>;

export interface ScenarioContractV2 {
  contractVersion: typeof SCENARIO_CONTRACT_VERSION;
  scenario: Readonly<{ key: string; revision: number }>;
  governance: Readonly<{
    state: ScenarioGovernanceState;
    realSourceVerified: boolean;
    realActionVerified: boolean;
    evidenceRefs: readonly string[];
  }>;
  goal: Readonly<{
    supportedIntents: readonly string[];
    requiredSubjectTypes: readonly string[];
  }>;
  factDemands: readonly Readonly<{
    factKey: string;
    subjectType: string;
    required: boolean;
    maximumAgeSeconds: number;
    minimumReality: RealityLevel;
    acceptedSourceCapabilities: readonly string[];
    acceptedSourceModes: readonly ('OFFICIAL_API' | 'WEBHOOK' | 'NOTIFICATION' | 'SHARE' | 'APP_READ_SESSION' | 'FILE' | 'MANUAL' | 'INTERNAL')[];
    refreshPolicy: 'ON_STALE' | 'ON_CHANGE' | 'MANUAL_ONLY';
    verificationRequirements: readonly ('SOURCE_EVIDENCE' | 'USER_CONFIRMATION' | 'READ_BACK')[];
    conflictPolicy: 'LATEST_VERIFIED_THEN_OBSERVED' | 'REQUIRE_CONFIRMATION';
    missingPolicy: 'BLOCK_PLAN_OFFER' | 'ALLOW_MANUAL_ASSISTED';
  }>[];
  actionDemands: readonly Readonly<{
    intentKey: string;
    capabilityKey: string;
    resourceType: string;
    requiresUserConfirmation: boolean;
    verification: readonly ('AUDIT_RECORD' | 'READ_BACK_OR_CALLBACK')[];
  }>[];
  privacy: Readonly<{
    classes: readonly ('PERSONAL' | 'SENSITIVE' | 'HIGHLY_SENSITIVE')[];
    purpose: string;
    rawEvidenceRetention: 'SOURCE_POLICY' | 'EPHEMERAL' | 'NOT_STORED';
  }>;
  unsupportedConditions: readonly string[];
  definitionHash: string;
}

function defineContract(input: Omit<ScenarioContractV2, 'contractVersion' | 'definitionHash'>): ScenarioContractV2 {
  const content = { contractVersion: SCENARIO_CONTRACT_VERSION, ...input };
  return Object.freeze({ ...content, definitionHash: catalogHash(content) });
}

const delivery = scenarioByKey('daily_life.delivery');
if (!delivery) throw new Error('Golden scenario daily_life.delivery is not registered');

/**
 * Contract V2 is an additive sidecar. It references an immutable V1 scenario
 * revision and must never change that scenario's definition/hash.
 */
export const SCENARIO_CONTRACT_V2_REGISTRY: readonly ScenarioContractV2[] = Object.freeze([
  defineContract({
    scenario: Object.freeze({ key: delivery.key, revision: delivery.revision }),
    governance: Object.freeze({
      state: 'DETERMINISTIC_SANDBOX',
      realSourceVerified: false,
      realActionVerified: false,
      evidenceRefs: Object.freeze(['test:runtime-reality-pipeline', 'test:action-recipe:daily_life.delivery.silent']),
    }),
    goal: Object.freeze({
      supportedIntents: Object.freeze(['NOTIFY_ON_DELIVERY_CHANGE', 'NOTIFY_ON_DELIVERY_EXCEPTION']),
      requiredSubjectTypes: Object.freeze(['shipment']),
    }),
    factDemands: Object.freeze([
      Object.freeze({
        factKey: 'shipment.status',
        subjectType: 'shipment',
        required: true,
        maximumAgeSeconds: delivery.freshnessPolicy.maximumAgeSeconds,
        minimumReality: delivery.minimumReality,
        acceptedSourceCapabilities: Object.freeze(delivery.sourceRequirements.map((item) => item.capabilityKey)),
        acceptedSourceModes: Object.freeze(['OFFICIAL_API', 'WEBHOOK', 'NOTIFICATION', 'SHARE', 'APP_READ_SESSION'] as const),
        refreshPolicy: 'ON_STALE',
        verificationRequirements: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK'] as const),
        conflictPolicy: 'LATEST_VERIFIED_THEN_OBSERVED',
        missingPolicy: 'BLOCK_PLAN_OFFER',
      }),
    ]),
    actionDemands: Object.freeze([
      Object.freeze({
        intentKey: 'SEND_DELIVERY_NOTIFICATION',
        capabilityKey: 'SEND_NOTIFICATION',
        resourceType: 'Notification',
        requiresUserConfirmation: false,
        verification: Object.freeze(delivery.verificationRequirements),
      }),
    ]),
    privacy: Object.freeze({
      classes: Object.freeze(['PERSONAL'] as const),
      purpose: '识别用户明确管理的运单状态变化，并在到件或异常时提醒',
      rawEvidenceRetention: 'SOURCE_POLICY',
    }),
    unsupportedConditions: Object.freeze([
      '无法建立稳定运单身份时不跟踪',
      '营销通知不进入候选事实',
      '没有可验证来源时不宣称实时物流能力',
      '提醒已发送不等于包裹业务终态已完成',
    ]),
  }),
]);

export function scenarioContractV2ByKey(key: string): ScenarioContractV2 | null {
  return SCENARIO_CONTRACT_V2_REGISTRY.find((contract) => contract.scenario.key === key) ?? null;
}

export function assertScenarioContractV2(contract: ScenarioContractV2): void {
  const scenario = scenarioByKey(contract.scenario.key);
  if (!scenario || scenario.revision !== contract.scenario.revision) throw new Error('Scenario Contract V2 references an unknown immutable scenario revision');
  if (!contract.factDemands.length) throw new Error('Scenario Contract V2 requires at least one FactDemand');
  if (!contract.factDemands.filter((item) => item.required).every((item) => scenario.requiredFacts.includes(item.factKey))) {
    throw new Error('Scenario Contract V2 required FactDemand must exist in the V1 scenario contract');
  }
  if (!contract.factDemands.every((item) => contract.goal.requiredSubjectTypes.includes(item.subjectType))) {
    throw new Error('Scenario Contract V2 FactDemand subject type must be allowed by the goal contract');
  }
  if (!contract.actionDemands.every((item) => scenario.actionRequirements.some((requirement) => requirement.capabilityKey === item.capabilityKey))) {
    throw new Error('Scenario Contract V2 ActionDemand must exist in the V1 scenario contract');
  }
  const { definitionHash: _definitionHash, ...content } = contract;
  if (catalogHash(content) !== contract.definitionHash) throw new Error('Scenario Contract V2 definition hash mismatch');
  if ((contract.governance.state === 'REAL_SOURCE_VERIFIED' || contract.governance.state === 'REAL_ACTION_VERIFIED'
    || contract.governance.state === 'BETA_ELIGIBLE' || contract.governance.state === 'PRODUCTION_ELIGIBLE')
    && !contract.governance.realSourceVerified) throw new Error('Scenario Contract V2 governance overclaims source verification');
  if ((contract.governance.state === 'REAL_ACTION_VERIFIED' || contract.governance.state === 'BETA_ELIGIBLE'
    || contract.governance.state === 'PRODUCTION_ELIGIBLE') && !contract.governance.realActionVerified) {
    throw new Error('Scenario Contract V2 governance overclaims action verification');
  }
}

for (const contract of SCENARIO_CONTRACT_V2_REGISTRY) assertScenarioContractV2(contract);
