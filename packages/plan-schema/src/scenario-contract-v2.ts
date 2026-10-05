import { z } from 'zod';
import { catalogHash, scenarioByKey, scenarioDefinitionByKey, type RealityLevel } from './runtime-catalog';

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
    acceptedSourceModes: readonly ('OFFICIAL_API' | 'WEBHOOK' | 'NOTIFICATION' | 'SHARE' | 'APP_READ_SESSION' | 'FILE' | 'MANUAL' | 'INTERNAL' | 'NATIVE_OS')[];
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
  subjectRequirements:Readonly<{types:readonly string[];required:boolean;ownershipRequired:true}>;
  sourceModes:readonly string[];
  decisionPolicies:readonly Readonly<{kind:'STATE_CHANGE'|'EXPIRY'|'THRESHOLD'|'SEMANTIC_ADVISORY';requiresVerifiedFacts:true;executionAuthority:false}>[];
  trigger:Readonly<{modes:readonly string[];requiresFreshCoverage:true}>;
  risk:Readonly<{floor:string;authority:'RiskEngine';canAutoApprove:false}>;
  verification:Readonly<{authority:'Verification';requirements:readonly string[]}>;
  fallback:Readonly<{unknown:'ASK_USER';conflict:'RECONCILE';unavailable:'REFRESH_SOURCE'}>;
  definitionHash: string;
}

type ExtendedContractKeys='subjectRequirements'|'sourceModes'|'decisionPolicies'|'trigger'|'risk'|'verification'|'fallback';
function defineContract(input: Omit<ScenarioContractV2, 'contractVersion' | 'definitionHash' | ExtendedContractKeys> & Partial<Pick<ScenarioContractV2,ExtendedContractKeys>>): ScenarioContractV2 {
  const scenario=scenarioDefinitionByKey(input.scenario.key);if(!scenario)throw new Error('Unknown scenario');
  const content = { contractVersion: SCENARIO_CONTRACT_VERSION,
    subjectRequirements:{types:input.goal.requiredSubjectTypes,required:true,ownershipRequired:true as const},
    sourceModes:[...new Set(input.factDemands.flatMap(demand=>demand.acceptedSourceModes))],
    decisionPolicies:[{kind:'STATE_CHANGE' as const,requiresVerifiedFacts:true as const,executionAuthority:false as const}],
    trigger:{modes:scenario.triggerProfile.modes,requiresFreshCoverage:true as const},
    risk:{floor:scenario.defaultRiskFloor,authority:'RiskEngine' as const,canAutoApprove:false as const},
    verification:{authority:'Verification' as const,requirements:scenario.verificationRequirements},
    fallback:{unknown:'ASK_USER' as const,conflict:'RECONCILE' as const,unavailable:'REFRESH_SOURCE' as const},
    ...input };
  return Object.freeze({ ...content, definitionHash: catalogHash(content) });
}

const delivery = scenarioByKey('daily_life.delivery');
if (!delivery) throw new Error('Golden scenario daily_life.delivery is not registered');
const deviceConsumables = scenarioByKey('device.consumables');
if (!deviceConsumables) throw new Error('Golden scenario device.consumables is not registered');
const abnormalTransaction = scenarioByKey('finance.abnormal_transaction');
if (!abnormalTransaction) throw new Error('Golden scenario finance.abnormal_transaction is not registered');
const financeAccounting = scenarioDefinitionByKey('finance.accounting');
if (!financeAccounting) throw new Error('Golden scenario finance.accounting is not registered');

/**
 * Contract V2 is an additive sidecar. It references an immutable V1 scenario
 * revision (or a V2-only scenario) and must never change that scenario's
 * definition/hash.
 */

interface GoldenContractSpec {key:string;intent:string;decision:'STATE_CHANGE'|'EXPIRY'|'THRESHOLD'|'SEMANTIC_ADVISORY';privacy:'PERSONAL'|'SENSITIVE'|'HIGHLY_SENSITIVE';}
function resourceContract(key:string,spec?:GoldenContractSpec):ScenarioContractV2 {
 const scenario=scenarioByKey(key);if(!scenario)throw new Error('Unknown scenario');
 return defineContract({scenario:{key:scenario.key,revision:scenario.revision},
 governance:{state:'CONTRACT_COMPLETE',realSourceVerified:false,realActionVerified:false,evidenceRefs:[]},
 goal:{supportedIntents:[spec?.intent??'MONITOR_RESOURCE_CHANGES'],requiredSubjectTypes:scenario.primaryResourceTypes},
 factDemands:scenario.requiredFacts.map(factKey=>({factKey,subjectType:scenario.primaryResourceTypes[0],required:true,maximumAgeSeconds:scenario.freshnessPolicy.maximumAgeSeconds,minimumReality:scenario.minimumReality,
 acceptedSourceCapabilities:scenario.sourceRequirements.map(item=>item.capabilityKey),acceptedSourceModes:spec?.key==='work.meetings'?['OFFICIAL_API','NOTIFICATION','FILE','MANUAL','NATIVE_OS']:['OFFICIAL_API','NOTIFICATION','FILE','MANUAL'],refreshPolicy:'ON_STALE',verificationRequirements:['SOURCE_EVIDENCE','USER_CONFIRMATION'],conflictPolicy:'LATEST_VERIFIED_THEN_OBSERVED',missingPolicy:'BLOCK_PLAN_OFFER'})),
 actionDemands:scenario.actionRequirements.map(item=>({intentKey:'NOTIFY_RESOURCE_CHANGE',capabilityKey:item.capabilityKey,resourceType:item.resourceType,requiresUserConfirmation:true,verification:['AUDIT_RECORD','READ_BACK_OR_CALLBACK']})),
 decisionPolicies:[{kind:spec?.decision??'THRESHOLD',requiresVerifiedFacts:true,executionAuthority:false}],
 privacy:{classes:[spec?.privacy??'PERSONAL'],purpose:'仅使用已授权、带证据的资源状态，变化提醒仍经过现有风险、审批与验证链',rawEvidenceRetention:'SOURCE_POLICY'},
 unsupportedConditions:['尚无真实来源验收证据，不宣称自动运行能力','缺少对象、事实、可用能力或授权时阻止激活与执行'],
 });
}

const GOLDEN_CONTRACT_SPECS:readonly GoldenContractSpec[]=[
 {key:'work.meetings',intent:'REMIND_CALENDAR_EVENT',decision:'EXPIRY',privacy:'PERSONAL'},
 {key:'work.email',intent:'SUMMARIZE_WORK_EMAIL',decision:'SEMANTIC_ADVISORY',privacy:'SENSITIVE'},
 {key:'daily_life.appointment',intent:'FOLLOW_SERVICE_APPOINTMENT',decision:'STATE_CHANGE',privacy:'PERSONAL'},
 {key:'finance.bill',intent:'SUMMARIZE_VERIFIED_BILLS',decision:'SEMANTIC_ADVISORY',privacy:'SENSITIVE'},
 {key:'finance.subscription',intent:'REMIND_SUBSCRIPTION_EXPIRY',decision:'EXPIRY',privacy:'SENSITIVE'},
 {key:'finance.refund',intent:'FOLLOW_REFUND_STATUS',decision:'STATE_CHANGE',privacy:'SENSITIVE'},
 {key:'finance.budget',intent:'ASSESS_BUDGET_THRESHOLD',decision:'THRESHOLD',privacy:'SENSITIVE'},
 {key:'health.medication',intent:'REMIND_MEDICATION_SCHEDULE',decision:'EXPIRY',privacy:'HIGHLY_SENSITIVE'},
 {key:'health.follow_up',intent:'PREPARE_FOLLOW_UP_VISIT',decision:'EXPIRY',privacy:'HIGHLY_SENSITIVE'},
 {key:'family.member_affairs',intent:'COORDINATE_FAMILY_SCHEDULE',decision:'EXPIRY',privacy:'PERSONAL'},
 {key:'work.tasks',intent:'FOLLOW_WORK_DEADLINE',decision:'EXPIRY',privacy:'PERSONAL'},
 {key:'travel.itinerary',intent:'FOLLOW_TRAVEL_ITINERARY',decision:'STATE_CHANGE',privacy:'PERSONAL'},
 {key:'identity_docs.validity',intent:'REMIND_DOCUMENT_EXPIRY',decision:'EXPIRY',privacy:'HIGHLY_SENSITIVE'},
 {key:'housing.lease',intent:'REMIND_LEASE_EXPIRY',decision:'EXPIRY',privacy:'SENSITIVE'},
];

export const SCENARIO_CONTRACT_V2_REGISTRY: readonly ScenarioContractV2[] = Object.freeze([
 ...GOLDEN_CONTRACT_SPECS.map(spec=>resourceContract(spec.key,spec)),
  resourceContract('family.family_supply'),
  resourceContract('daily_life.errands'),
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
  defineContract({
    scenario: Object.freeze({ key: deviceConsumables.key, revision: deviceConsumables.revision }),
    governance: Object.freeze({
      state: 'DETERMINISTIC_SANDBOX',
      realSourceVerified: false,
      realActionVerified: false,
      evidenceRefs: Object.freeze(['test:p1-device', 'test:p4-consumer-journeys', 'test:p1-canonical-plans']),
    }),
    goal: Object.freeze({
      supportedIntents: Object.freeze(['NOTIFY_ON_CONSUMABLE_DUE', 'PREPARE_CONSUMABLE_REPLACEMENT', 'DETECT_CONSUMABLE_ANOMALY']),
      requiredSubjectTypes: Object.freeze(['device.consumable']),
    }),
    factDemands: Object.freeze([
      Object.freeze({
        factKey: 'device.consumable.remaining_days',
        subjectType: 'device.consumable',
        required: true,
        maximumAgeSeconds: deviceConsumables.freshnessPolicy.maximumAgeSeconds,
        minimumReality: deviceConsumables.minimumReality,
        acceptedSourceCapabilities: Object.freeze(deviceConsumables.sourceRequirements.map((item) => item.capabilityKey)),
        // 用户手动登记是已证明的一等来源；授权设备数据是目标来源但尚未验证。
        acceptedSourceModes: Object.freeze(['MANUAL', 'OFFICIAL_API', 'FILE', 'APP_READ_SESSION'] as const),
        refreshPolicy: 'ON_STALE',
        verificationRequirements: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION'] as const),
        conflictPolicy: 'LATEST_VERIFIED_THEN_OBSERVED',
        missingPolicy: 'ALLOW_MANUAL_ASSISTED',
      }),
    ]),
    actionDemands: Object.freeze([
      Object.freeze({
        intentKey: 'SEND_CONSUMABLE_REMINDER',
        capabilityKey: 'SEND_NOTIFICATION',
        resourceType: 'Notification',
        requiresUserConfirmation: false,
        verification: Object.freeze(deviceConsumables.verificationRequirements),
      }),
    ]),
    privacy: Object.freeze({
      classes: Object.freeze(['PERSONAL'] as const),
      purpose: '根据用户登记的耗材更换周期计算剩余天数并提醒更换，不推断设备实时健康状态',
      rawEvidenceRetention: 'SOURCE_POLICY',
    }),
    unsupportedConditions: Object.freeze([
      '没有可验证来源时不宣称设备实时读取能力',
      '不依据真实登记之外的信息推断耗材剩余寿命',
      '提醒已发送不等于耗材已更换',
      '准备购物清单不代表完成购买',
      '设备离线时不虚构在线状态',
    ]),
  }),
  defineContract({
    scenario: Object.freeze({ key: abnormalTransaction.key, revision: abnormalTransaction.revision }),
    governance: Object.freeze({
      state: 'DETERMINISTIC_SANDBOX',
      realSourceVerified: false,
      realActionVerified: false,
      evidenceRefs: Object.freeze(['test:runtime-reality-pipeline', 'test:r3-consumer-golden-journeys', 'test:vnext-finance-multisource']),
    }),
    goal: Object.freeze({
      supportedIntents: Object.freeze(['DETECT_TRANSACTION_ANOMALY']),
      requiredSubjectTypes: Object.freeze(['finance.transaction']),
    }),
    factDemands: Object.freeze([
      Object.freeze({
        factKey: 'finance.transaction.amount',
        subjectType: 'finance.transaction',
        required: true,
        maximumAgeSeconds: abnormalTransaction.freshnessPolicy.maximumAgeSeconds,
        minimumReality: abnormalTransaction.minimumReality,
        acceptedSourceCapabilities: Object.freeze(abnormalTransaction.sourceRequirements.map((item) => item.capabilityKey)),
        acceptedSourceModes: Object.freeze(['OFFICIAL_API', 'NOTIFICATION', 'FILE', 'MANUAL', 'INTERNAL'] as const),
        refreshPolicy: 'ON_CHANGE',
        verificationRequirements: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK'] as const),
        conflictPolicy: 'REQUIRE_CONFIRMATION',
        missingPolicy: 'ALLOW_MANUAL_ASSISTED',
      }),
    ]),
    actionDemands: Object.freeze([
      Object.freeze({
        intentKey: 'SEND_FINANCE_ATTENTION',
        capabilityKey: 'SEND_NOTIFICATION',
        resourceType: 'Notification',
        requiresUserConfirmation: false,
        verification: Object.freeze(abnormalTransaction.verificationRequirements),
      }),
    ]),
    privacy: Object.freeze({
      classes: Object.freeze(['SENSITIVE'] as const),
      purpose: '依据用户明确授权或确认的交易证据进行分类、周期汇总、异常分析与结果回查，不发起资金操作',
      rawEvidenceRetention: 'SOURCE_POLICY',
    }),
    unsupportedConditions: Object.freeze([
      '通知内容只形成候选，未经确认不得认定为交易事实',
      '没有稳定交易标识时不得按金额、商户或时间猜测合并跨来源记录',
      '退款和冲正必须保留来源证据及关联交易标识',
      '不执行自动转账、自动支付或任何资金划转',
      '真实银行和支付平台接入需要合法授权与独立平台验收',
    ]),
  }),
  defineContract({
    scenario: Object.freeze({ key: financeAccounting.key, revision: financeAccounting.revision }),
    governance: Object.freeze({
      state: 'DETERMINISTIC_SANDBOX',
      realSourceVerified: false,
      realActionVerified: false,
      evidenceRefs: Object.freeze(['test:b7-transaction-file-import', 'test:runtime-reality-pipeline']),
    }),
    goal: Object.freeze({
      supportedIntents: Object.freeze(['SUMMARIZE_ACCOUNT_PERIOD', 'RECONCILE_TRANSACTION_RESULT', 'ANALYZE_BUDGET', 'DETECT_DUPLICATE_TRANSACTION']),
      requiredSubjectTypes: Object.freeze(['finance.transaction']),
    }),
    factDemands: Object.freeze([
      Object.freeze({
        factKey: 'finance.transaction.amount',
        subjectType: 'finance.transaction',
        required: true,
        maximumAgeSeconds: financeAccounting.freshnessPolicy.maximumAgeSeconds,
        minimumReality: financeAccounting.minimumReality,
        acceptedSourceCapabilities: Object.freeze(financeAccounting.sourceRequirements.map((item) => item.capabilityKey)),
        acceptedSourceModes: Object.freeze(['OFFICIAL_API', 'NOTIFICATION', 'FILE', 'MANUAL', 'INTERNAL'] as const),
        refreshPolicy: 'ON_CHANGE',
        verificationRequirements: Object.freeze(['SOURCE_EVIDENCE', 'USER_CONFIRMATION', 'READ_BACK'] as const),
        conflictPolicy: 'REQUIRE_CONFIRMATION',
        missingPolicy: 'ALLOW_MANUAL_ASSISTED',
      }),
    ]),
    actionDemands: Object.freeze([
      Object.freeze({
        intentKey: 'SEND_ACCOUNTING_SUMMARY',
        capabilityKey: 'SEND_NOTIFICATION',
        resourceType: 'Notification',
        requiresUserConfirmation: false,
        verification: Object.freeze(financeAccounting.verificationRequirements),
      }),
    ]),
    privacy: Object.freeze({
      classes: Object.freeze(['SENSITIVE'] as const),
      purpose: '依据用户明确授权或确认的交易证据进行跨来源归类、周期汇总、重复识别与账目核对，不发起资金操作',
      rawEvidenceRetention: 'SOURCE_POLICY',
    }),
    unsupportedConditions: Object.freeze([
      '交易事实只来自用户授权或确认的证据，不自动补造缺失交易',
      '金额、时间与商户名称相同不能作为跨平台合并依据',
      '未验证交易保留独立候选，等待用户核对，不推断合并',
      '汇总结果必须标明数据覆盖范围，不得将未验证交易计入可信汇总',
      '不执行自动转账、自动支付或任何资金划转',
    ]),
  }),
]);

export function scenarioContractV2ByKey(key: string): ScenarioContractV2 | null {
  return SCENARIO_CONTRACT_V2_REGISTRY.find((contract) => contract.scenario.key === key) ?? null;
}

export function assertScenarioContractV2(contract: ScenarioContractV2): void {
  const scenario = scenarioDefinitionByKey(contract.scenario.key);
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
