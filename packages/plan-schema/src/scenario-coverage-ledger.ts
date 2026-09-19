import { PLAN_STRATEGIES } from './product-model';
import {
  FACT_SCHEMA_CATALOG,
  RESOURCE_CATALOG,
  SCENARIO_DEFINITIONS,
  STRATEGY_PROFILES,
  catalogHash,
  type CapabilityRequirement,
  type FactSchemaDefinition,
  type ResourceDefinition,
  type ScenarioDefinition,
  type StrategyKey,
  type StrategyProfile,
} from './runtime-catalog';
import { STRATEGY_RUNTIME_KEY, type StrategyRuntimeKey } from './strategy-runtime-identity';

/** Immutable schema projection; runtime/user state is always supplied as evidence. */
export const SCENARIO_COVERAGE_LEDGER_REVISION = 1 as const;
export const SCENARIO_COVERAGE_READINESS_STATES = [
  'MANUAL_READY',
  'OBSERVE_READY',
  'ASSISTED_READY',
  'AUTOMATED_READY',
  'BLOCKED_PROVIDER',
  'BLOCKED_IMPLEMENTATION',
] as const;
export type ScenarioCoverageReadinessState = typeof SCENARIO_COVERAGE_READINESS_STATES[number];

export type CoverageProviderStatus = 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
export type CoverageImplementationStatus = 'IMPLEMENTED' | 'NOT_IMPLEMENTED';
export type CoverageAuthorizationStatus = 'NOT_REQUIRED' | 'GRANTED' | 'NOT_GRANTED';

export interface CoverageCapabilityEvidence {
  providerStatus: CoverageProviderStatus;
  implementationStatus: CoverageImplementationStatus;
  authorizationStatus: CoverageAuthorizationStatus;
}

/** Evidence/status inputs only: no caller-provided readiness or availability flag. */
export interface ScenarioCoverageReadinessInput {
  manualCapture: CoverageImplementationStatus;
  observationPipeline: CoverageImplementationStatus;
  executionPipeline: CoverageImplementationStatus;
  sourceCapability: CoverageCapabilityEvidence;
  actionCapability: CoverageCapabilityEvidence;
  observedFactKeys: readonly string[];
}

export interface ScenarioCoverageReadiness {
  state: ScenarioCoverageReadinessState;
  reasons: readonly string[];
  evidence: Readonly<ScenarioCoverageReadinessInput>;
}

type CoverageResource = Readonly<Pick<ResourceDefinition, 'key' | 'label' | 'domain' | 'revision' | 'status'>>;
type CoverageFact = Readonly<Pick<FactSchemaDefinition,
  'key' | 'resourceType' | 'field' | 'valueType' | 'minimumReality' | 'revision' | 'status'> & { required: boolean }>;
type CoverageRequirement = Readonly<CapabilityRequirement>;
type CoverageRuntimeEvidenceStatus = 'NOT_COMPLETED_IN_BATCH_10_WAVE_1' | 'COMPLETED';

export interface ScenarioCoverageLedgerEntry {
  schemaVersion: '1';
  ledgerRevision: typeof SCENARIO_COVERAGE_LEDGER_REVISION;
  scenarioKey: string;
  definition: Readonly<{
    scenarioRevision: number;
    definitionHash: string;
    label: string;
    domain: ScenarioDefinition['domain'];
    status: ScenarioDefinition['status'];
    immutableRevision: true;
  }>;
  resources: readonly CoverageResource[];
  facts: readonly CoverageFact[];
  sourceRequirements: readonly CoverageRequirement[];
  strategy: Readonly<{
    key: StrategyKey;
    revision: number;
    profileHash: string;
    supported: readonly StrategyKey[];
    runtimeKey: StrategyRuntimeKey;
  }>;
  truthPolicy: Readonly<{
    minimumReality: ScenarioDefinition['minimumReality'];
    candidate: ScenarioDefinition['truthPolicy'];
    freshness: ScenarioDefinition['freshnessPolicy'];
    conflict: ScenarioDefinition['conflictPolicy'];
  }>;
  capabilityRequirements: Readonly<{
    source: readonly CoverageRequirement[];
    action: readonly CoverageRequirement[];
  }>;
  sourceCapability: Readonly<{
    providerKey: string | null;
    capabilityKey: string;
    operation: CoverageRequirement['operation'];
    evidenceReference: string | null;
  }>;
  provider: Readonly<{
    source: Readonly<{ providerKey: string | null; productionStatus: 'UNRESOLVED'; evidenceReference: null }>;
    action: Readonly<{ providerKey: string | null; productionStatus: 'UNRESOLVED'; evidenceReference: null }>;
  }>;
  actionCapability: Readonly<{
    providerKey: string | null;
    capabilityKey: string;
    operation: CoverageRequirement['operation'];
    risk: ScenarioDefinition['defaultRiskFloor'];
    evidenceReference: string | null;
  }>;
  risk: Readonly<{ floor: ScenarioDefinition['defaultRiskFloor']; actionRisk: ScenarioDefinition['defaultRiskFloor'] }>;
  approval: Readonly<{ strategyPolicy: StrategyProfile['approvalPolicy']; requiredForExternalEffects: boolean }>;
  verification: Readonly<{
    strategyPolicy: StrategyProfile['verificationPolicy'];
    requirements: ScenarioDefinition['verificationRequirements'];
  }>;
  fallback: ScenarioDefinition['fallbackPolicy'];
  mobilePresentation: Readonly<{
    title: string;
    domainRoute: string;
    scenarioRoute: string;
    strategyRoute: string;
    readinessSource: 'scenario-coverage-ledger-api';
  }>;
  backendReadiness: ScenarioCoverageReadiness;
  mobileReadiness: ScenarioCoverageReadiness;
  test: Readonly<{
    contractTest: 'packages/plan-schema/test/scenario-coverage-ledger.spec.ts';
    apiProjectionTest: 'apps/api/test/scenario-coverage-ledger.spec.ts';
    fullDatabaseE2e: CoverageRuntimeEvidenceStatus;
    realProviderJourney: CoverageRuntimeEvidenceStatus;
    mobileJourney: CoverageRuntimeEvidenceStatus;
  }>;
  blockReason: Readonly<{ backend: readonly string[]; mobile: readonly string[] }>;
}

const BACKEND_RUNTIME_EVIDENCE: Readonly<ScenarioCoverageReadinessInput> = Object.freeze({
  // The catalog has no per-Scenario Provider binding or real acceptance
  // evidence yet, so the generated baseline must remain blocked.
  manualCapture: 'IMPLEMENTED',
  observationPipeline: 'NOT_IMPLEMENTED',
  executionPipeline: 'IMPLEMENTED',
  sourceCapability: Object.freeze({ providerStatus: 'UNKNOWN', implementationStatus: 'NOT_IMPLEMENTED', authorizationStatus: 'NOT_REQUIRED' }),
  actionCapability: Object.freeze({ providerStatus: 'UNKNOWN', implementationStatus: 'NOT_IMPLEMENTED', authorizationStatus: 'NOT_REQUIRED' }),
  observedFactKeys: Object.freeze([]),
});

const MOBILE_RUNTIME_EVIDENCE: Readonly<ScenarioCoverageReadinessInput> = Object.freeze({
  // Batch 11 owns the mobile ledger client and data-driven presentation path.
  manualCapture: 'NOT_IMPLEMENTED',
  observationPipeline: 'NOT_IMPLEMENTED',
  executionPipeline: 'NOT_IMPLEMENTED',
  sourceCapability: Object.freeze({ providerStatus: 'UNKNOWN', implementationStatus: 'NOT_IMPLEMENTED', authorizationStatus: 'NOT_REQUIRED' }),
  actionCapability: Object.freeze({ providerStatus: 'UNKNOWN', implementationStatus: 'NOT_IMPLEMENTED', authorizationStatus: 'NOT_REQUIRED' }),
  observedFactKeys: Object.freeze([]),
});

function freezeEvidence(input: ScenarioCoverageReadinessInput): Readonly<ScenarioCoverageReadinessInput> {
  return Object.freeze({
    ...input,
    sourceCapability: Object.freeze({ ...input.sourceCapability }),
    actionCapability: Object.freeze({ ...input.actionCapability }),
    observedFactKeys: Object.freeze([...input.observedFactKeys]),
  });
}

/** Pure readiness calculation from Fact, Capability, authorization and runtime evidence. */
export function evaluateScenarioCoverageReadiness(
  definition: Pick<ScenarioDefinition, 'requiredFacts' | 'defaultRiskFloor'>,
  strategy: Pick<StrategyProfile, 'defaultActionMode' | 'approvalPolicy'>,
  input: ScenarioCoverageReadinessInput,
): ScenarioCoverageReadiness {
  const evidence = freezeEvidence(input);
  const reasons: string[] = [];
  const capabilities = [evidence.sourceCapability, evidence.actionCapability];

  if (capabilities.some((capability) => capability.providerStatus === 'UNSUPPORTED')) {
    reasons.push('PROVIDER_CAPABILITY_UNSUPPORTED');
    return Object.freeze({ state: 'BLOCKED_PROVIDER', reasons: Object.freeze(reasons), evidence });
  }
  if (capabilities.some((capability) => capability.providerStatus === 'UNKNOWN')) {
    reasons.push('PROVIDER_CAPABILITY_UNKNOWN');
    return Object.freeze({ state: 'BLOCKED_PROVIDER', reasons: Object.freeze(reasons), evidence });
  }
  if (capabilities.some((capability) => capability.authorizationStatus === 'NOT_GRANTED')) {
    reasons.push('CAPABILITY_AUTHORIZATION_NOT_GRANTED');
    return Object.freeze({ state: 'BLOCKED_PROVIDER', reasons: Object.freeze(reasons), evidence });
  }
  if (evidence.manualCapture !== 'IMPLEMENTED'
    || capabilities.some((capability) => capability.implementationStatus !== 'IMPLEMENTED')) {
    reasons.push('MANUAL_OR_CAPABILITY_RUNTIME_NOT_IMPLEMENTED');
    return Object.freeze({ state: 'BLOCKED_IMPLEMENTATION', reasons: Object.freeze(reasons), evidence });
  }

  const missingFacts = definition.requiredFacts.filter((factKey) => !evidence.observedFactKeys.includes(factKey));
  if (missingFacts.length > 0) reasons.push('REQUIRED_FACTS_NOT_OBSERVED');
  if (evidence.observationPipeline !== 'IMPLEMENTED') reasons.push('OBSERVATION_PIPELINE_NOT_IMPLEMENTED');
  if (missingFacts.length > 0 || evidence.observationPipeline !== 'IMPLEMENTED') {
    return Object.freeze({ state: 'MANUAL_READY', reasons: Object.freeze(reasons), evidence });
  }
  if (evidence.executionPipeline !== 'IMPLEMENTED') {
    reasons.push('EXECUTION_PIPELINE_NOT_IMPLEMENTED');
    return Object.freeze({ state: 'OBSERVE_READY', reasons: Object.freeze(reasons), evidence });
  }
  if (strategy.defaultActionMode === 'PREPARE'
    || strategy.approvalPolicy === 'ALWAYS_FOR_EXTERNAL'
    || definition.defaultRiskFloor === 'R3'
    || definition.defaultRiskFloor === 'R4') {
    reasons.push('APPROVAL_REQUIRED_FOR_ACTION');
    return Object.freeze({ state: 'ASSISTED_READY', reasons: Object.freeze(reasons), evidence });
  }
  if (strategy.defaultActionMode === 'EXECUTE') {
    reasons.push('AUTOMATION_BOUNDED_BY_STRATEGY_POLICY');
    return Object.freeze({ state: 'AUTOMATED_READY', reasons: Object.freeze(reasons), evidence });
  }
  reasons.push('OBSERVATION_AND_INTERNAL_ACTION_PATH_READY');
  return Object.freeze({ state: 'OBSERVE_READY', reasons: Object.freeze(reasons), evidence });
}

const resourcesByKey = new Map(RESOURCE_CATALOG.map((resource) => [resource.key, resource]));
const factsByKey = new Map(FACT_SCHEMA_CATALOG.map((fact) => [fact.key, fact]));
const strategiesByKey = new Map(STRATEGY_PROFILES.map((strategy) => [strategy.key, strategy]));

function resourceFor(scenario: ScenarioDefinition, key: string): ResourceDefinition {
  const resource = resourcesByKey.get(key);
  if (resource) return resource;
  // Runtime scenarios reference the Reality Pipeline resource type directly; the
  // canonical fact schema is the single source of truth for those resource names.
  const factSchema = FACT_SCHEMA_CATALOG.find((schema) => schema.resourceType === key);
  if (!factSchema) throw new Error(`Coverage ledger references unknown resource: ${key}`);
  return Object.freeze({
    schemaVersion: '1' as const, key, label: key, domain: scenario.domain,
    identityFields: Object.freeze(['subject_key', 'external_key']), revision: 1, status: 'ACTIVE' as const,
  });
}

function factFor(key: string): FactSchemaDefinition {
  const fact = factsByKey.get(key);
  if (!fact) throw new Error(`Coverage ledger references unknown fact: ${key}`);
  return fact;
}

function strategyFor(key: StrategyKey): StrategyProfile {
  const strategy = strategiesByKey.get(key);
  if (!strategy) throw new Error(`Coverage ledger references unknown strategy: ${key}`);
  return strategy;
}

function freezeRequirements(requirements: readonly CapabilityRequirement[]): readonly CoverageRequirement[] {
  return Object.freeze(requirements.map((requirement) => Object.freeze({ ...requirement })));
}

function coverageEntry(scenario: ScenarioDefinition): ScenarioCoverageLedgerEntry {
  const strategy = strategyFor(scenario.defaultStrategy);
  const backendReadiness = evaluateScenarioCoverageReadiness(scenario, strategy, BACKEND_RUNTIME_EVIDENCE);
  const mobileReadiness = evaluateScenarioCoverageReadiness(scenario, strategy, MOBILE_RUNTIME_EVIDENCE);
  const sourceRequirements = freezeRequirements(scenario.sourceRequirements);
  const actionRequirements = freezeRequirements(scenario.actionRequirements);
  const sourceRequirement = sourceRequirements.find((item) => !item.optional) ?? sourceRequirements[0];
  const actionRequirement = actionRequirements.find((item) => !item.optional) ?? actionRequirements[0];
  if (!sourceRequirement || !actionRequirement) throw new Error(`Coverage ledger requires source and action capability contracts: ${scenario.key}`);
  return Object.freeze({
    schemaVersion: '1' as const,
    ledgerRevision: SCENARIO_COVERAGE_LEDGER_REVISION,
    scenarioKey: scenario.key,
    definition: Object.freeze({ scenarioRevision: scenario.revision, definitionHash: catalogHash(scenario), label: scenario.label,
      domain: scenario.domain, status: scenario.status, immutableRevision: true as const }),
    resources: Object.freeze(scenario.primaryResourceTypes.map((key) => {
      const resource = resourceFor(scenario, key);
      return Object.freeze({ key: resource.key, label: resource.label, domain: resource.domain, revision: resource.revision, status: resource.status });
    })),
    facts: Object.freeze([...scenario.requiredFacts, ...scenario.optionalFacts].map((key) => {
      const fact = factFor(key);
      return Object.freeze({ key: fact.key, resourceType: fact.resourceType, field: fact.field, valueType: fact.valueType,
        minimumReality: fact.minimumReality, revision: fact.revision, status: fact.status, required: scenario.requiredFacts.includes(key) });
    })),
    sourceRequirements,
    strategy: Object.freeze({ key: strategy.key, revision: strategy.revision, profileHash: catalogHash(strategy),
      supported: Object.freeze([...scenario.supportedStrategies]), runtimeKey: STRATEGY_RUNTIME_KEY }),
    truthPolicy: Object.freeze({ minimumReality: scenario.minimumReality, candidate: scenario.truthPolicy,
      freshness: scenario.freshnessPolicy, conflict: scenario.conflictPolicy }),
    capabilityRequirements: Object.freeze({ source: sourceRequirements, action: actionRequirements }),
    sourceCapability: Object.freeze({ providerKey: null, capabilityKey: sourceRequirement.capabilityKey,
      operation: sourceRequirement.operation, evidenceReference: null }),
    provider: Object.freeze({
      source: Object.freeze({ providerKey: null, productionStatus: 'UNRESOLVED' as const, evidenceReference: null }),
      action: Object.freeze({ providerKey: null, productionStatus: 'UNRESOLVED' as const, evidenceReference: null }),
    }),
    actionCapability: Object.freeze({ providerKey: null, capabilityKey: actionRequirement.capabilityKey,
      operation: actionRequirement.operation, risk: scenario.defaultRiskFloor, evidenceReference: null }),
    risk: Object.freeze({ floor: scenario.defaultRiskFloor, actionRisk: scenario.defaultRiskFloor }),
    approval: Object.freeze({ strategyPolicy: strategy.approvalPolicy, requiredForExternalEffects: strategy.approvalPolicy !== 'NEVER_EXTERNAL' }),
    verification: Object.freeze({ strategyPolicy: strategy.verificationPolicy, requirements: scenario.verificationRequirements }),
    fallback: scenario.fallbackPolicy,
    mobilePresentation: Object.freeze({ title: scenario.label, domainRoute: `/domains/${scenario.domain}`,
      scenarioRoute: `/domains/${scenario.domain}/${scenario.key}`, strategyRoute: `/strategies/${strategy.key}`,
      readinessSource: 'scenario-coverage-ledger-api' as const }),
    backendReadiness,
    mobileReadiness,
    test: Object.freeze({
      contractTest: 'packages/plan-schema/test/scenario-coverage-ledger.spec.ts' as const,
      apiProjectionTest: 'apps/api/test/scenario-coverage-ledger.spec.ts' as const,
      fullDatabaseE2e: 'NOT_COMPLETED_IN_BATCH_10_WAVE_1' as const,
      realProviderJourney: 'NOT_COMPLETED_IN_BATCH_10_WAVE_1' as const,
      mobileJourney: 'NOT_COMPLETED_IN_BATCH_10_WAVE_1' as const,
    }),
    blockReason: Object.freeze({ backend: backendReadiness.reasons, mobile: mobileReadiness.reasons }),
  });
}

/** Exactly one entry for each of the immutable 96 canonical Scenarios. */
export const SCENARIO_COVERAGE_LEDGER: readonly ScenarioCoverageLedgerEntry[] = Object.freeze(SCENARIO_DEFINITIONS.map(coverageEntry));

export function scenarioCoverageByKey(key: string, ledgerRevision = SCENARIO_COVERAGE_LEDGER_REVISION): ScenarioCoverageLedgerEntry | null {
  if (ledgerRevision !== SCENARIO_COVERAGE_LEDGER_REVISION) return null;
  return SCENARIO_COVERAGE_LEDGER.find((entry) => entry.scenarioKey === key) ?? null;
}

export const BATCH_10_WAVE_1_EXPECTED_COUNTS = Object.freeze({
  finance: 6,
  daily_life: 5,
  family: 5,
  work: 6,
  content: 6,
  vehicle: 6,
  device: 6,
  digital_account: 6,
} as const);
export type Batch10Wave1Domain = keyof typeof BATCH_10_WAVE_1_EXPECTED_COUNTS;

export interface Batch10Wave1Conclusion {
  batch: 10;
  wave: 1;
  numerator: number;
  denominator: number;
  contractComplete: boolean;
  runtimeComplete: boolean;
  complete: boolean;
  expectedCounts: typeof BATCH_10_WAVE_1_EXPECTED_COUNTS;
  actualCounts: Readonly<Record<Batch10Wave1Domain, number>>;
  scenarioKeys: readonly string[];
  backendReadinessCounts: Readonly<Partial<Record<ScenarioCoverageReadinessState, number>>>;
  mobileReadinessCounts: Readonly<Partial<Record<ScenarioCoverageReadinessState, number>>>;
  conclusion: string;
}

function readinessCounts(entries: readonly ScenarioCoverageLedgerEntry[], field: 'backendReadiness' | 'mobileReadiness') {
  return Object.freeze(entries.reduce<Partial<Record<ScenarioCoverageReadinessState, number>>>((counts, entry) => {
    const state = entry[field].state;
    counts[state] = (counts[state] ?? 0) + 1;
    return counts;
  }, {}));
}

const REQUIRED_FIELDS: readonly (keyof ScenarioCoverageLedgerEntry)[] = Object.freeze([
  'definition', 'resources', 'facts', 'sourceRequirements', 'strategy', 'truthPolicy', 'capabilityRequirements',
  'sourceCapability', 'provider', 'actionCapability', 'risk', 'approval', 'verification', 'fallback',
  'mobilePresentation', 'backendReadiness', 'mobileReadiness', 'test', 'blockReason',
]);

function isCoverageComplete(entry: ScenarioCoverageLedgerEntry) {
  return REQUIRED_FIELDS.every((field) => entry[field] !== undefined)
    && entry.definition.immutableRevision
    && entry.resources.length > 0
    && entry.facts.some((fact) => fact.required)
    && entry.sourceRequirements.length > 0
    && entry.strategy.supported.length === PLAN_STRATEGIES.length
    && entry.capabilityRequirements.source.length > 0
    && entry.capabilityRequirements.action.length > 0
    && SCENARIO_COVERAGE_READINESS_STATES.includes(entry.backendReadiness.state)
    && SCENARIO_COVERAGE_READINESS_STATES.includes(entry.mobileReadiness.state)
    && Array.isArray(entry.blockReason.backend)
    && Array.isArray(entry.blockReason.mobile);
}

/** Computes, rather than declares, the exact Wave 1 46/46 result. */
export function batch10Wave1Conclusion(entries: readonly ScenarioCoverageLedgerEntry[] = SCENARIO_COVERAGE_LEDGER): Batch10Wave1Conclusion {
  const domains = Object.keys(BATCH_10_WAVE_1_EXPECTED_COUNTS) as Batch10Wave1Domain[];
  const selected = entries.filter((entry) => domains.includes(entry.definition.domain as Batch10Wave1Domain));
  const actualCounts = Object.freeze(Object.fromEntries(domains.map((domain) => [domain,
    selected.filter((entry) => entry.definition.domain === domain).length])) as Record<Batch10Wave1Domain, number>);
  const numerator = selected.filter(isCoverageComplete).length;
  const denominator = Object.values(BATCH_10_WAVE_1_EXPECTED_COUNTS).reduce((sum, count) => sum + count, 0);
  const contractComplete = selected.length === denominator && numerator === denominator
    && domains.every((domain) => actualCounts[domain] === BATCH_10_WAVE_1_EXPECTED_COUNTS[domain]);
  const runtimeComplete = selected.every((entry) => entry.test.fullDatabaseE2e !== 'NOT_COMPLETED_IN_BATCH_10_WAVE_1'
    && entry.test.realProviderJourney !== 'NOT_COMPLETED_IN_BATCH_10_WAVE_1'
    && entry.test.mobileJourney !== 'NOT_COMPLETED_IN_BATCH_10_WAVE_1'
    && !entry.backendReadiness.state.startsWith('BLOCKED_')
    && !entry.mobileReadiness.state.startsWith('BLOCKED_'));
  const complete = contractComplete && runtimeComplete;
  return Object.freeze({
    batch: 10 as const,
    wave: 1 as const,
    numerator,
    denominator,
    contractComplete,
    runtimeComplete,
    complete,
    expectedCounts: BATCH_10_WAVE_1_EXPECTED_COUNTS,
    actualCounts,
    scenarioKeys: Object.freeze(selected.map((entry) => entry.scenarioKey).sort()),
    backendReadinessCounts: readinessCounts(selected, 'backendReadiness'),
    mobileReadinessCounts: readinessCounts(selected, 'mobileReadiness'),
    conclusion: `${numerator}/${denominator} Scenario Coverage Ledger contracts ${contractComplete ? 'complete' : 'incomplete'}; runtime evidence ${runtimeComplete ? 'complete' : 'incomplete'}`,
  });
}

export const BATCH_10_WAVE_1_CONCLUSION = batch10Wave1Conclusion();

export interface StrategyGoldenDefinition {
  strategy: StrategyKey;
  scenarioKey: string;
  scenarioRevision: number;
  factPath: Readonly<{ resourceType: string; factKey: string; field: string }>;
  capabilityPath: Readonly<{
    sourceProvider: string;
    sourceCapability: string;
    actionProvider: string;
    actionCapability: string;
    evidenceReference: string;
  }>;
  runtimeKey: StrategyRuntimeKey;
  runtimeFactory: 'buildStrategyRuntime';
  engineImplementation: 'packages/plan-schema/src/strategy-runtime.ts';
  purpose: string;
}

function goldenDefinition(input: Omit<StrategyGoldenDefinition,
  'scenarioRevision' | 'factPath' | 'runtimeKey' | 'runtimeFactory' | 'engineImplementation'> & { factKey?: string }): StrategyGoldenDefinition {
  const scenario = SCENARIO_DEFINITIONS.find((candidate) => candidate.key === input.scenarioKey);
  if (!scenario) throw new Error(`Golden definition references unknown Scenario: ${input.scenarioKey}`);
  const fact = factFor(input.factKey ?? scenario.requiredFacts[0] ?? '');
  return Object.freeze({
    strategy: input.strategy,
    scenarioKey: input.scenarioKey,
    scenarioRevision: input.scenarioKey === 'work.tasks' && fact.key === 'pull_request.state' ? 2 : scenario.revision,
    factPath: Object.freeze({ resourceType: fact.resourceType, factKey: fact.key, field: fact.field }),
    capabilityPath: Object.freeze({ ...input.capabilityPath }),
    runtimeKey: STRATEGY_RUNTIME_KEY,
    runtimeFactory: 'buildStrategyRuntime' as const,
    engineImplementation: 'packages/plan-schema/src/strategy-runtime.ts' as const,
    purpose: input.purpose,
  });
}

/** Eight real Fact/Capability configurations over one shared Strategy Runtime. */
export const STRATEGY_GOLDEN_DEFINITIONS: readonly StrategyGoldenDefinition[] = Object.freeze([
  goldenDefinition({ strategy: 'STATE_GUARD', scenarioKey: 'device.status', capabilityPath: {
    sourceProvider: 'manual', sourceCapability: 'MANUAL_INPUT', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/connectors/base-connectors.ts#ManualConnector/InternalConnector' }, purpose: 'Guard a confirmed device-status change.' }),
  goldenDefinition({ strategy: 'EXPIRY_GUARD', scenarioKey: 'vehicle.insurance', capabilityPath: {
    sourceProvider: 'manual', sourceCapability: 'MANUAL_INPUT', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/connectors/base-connectors.ts#ManualConnector/InternalConnector' }, purpose: 'Check insurance fact inside its expiry window.' }),
  goldenDefinition({ strategy: 'ANOMALY_DETECTION', scenarioKey: 'finance.abnormal_transaction', capabilityPath: {
    sourceProvider: 'manual', sourceCapability: 'MANUAL_INPUT', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/connectors/base-connectors.ts#ManualConnector/InternalConnector' }, purpose: 'Detect a material transaction-state change.' }),
  goldenDefinition({ strategy: 'SILENT_FOLLOW_UP', scenarioKey: 'work.tasks', factKey: 'pull_request.state', capabilityPath: {
    sourceProvider: 'github', sourceCapability: 'READ_PULL_REQUEST', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/providers/github/github-manifest.ts#READ_PULL_REQUEST' }, purpose: 'Follow a Pull Request and notify only on terminal transition.' }),
  goldenDefinition({ strategy: 'PERIODIC_SUMMARY', scenarioKey: 'work.work_summary', capabilityPath: {
    sourceProvider: 'gmail', sourceCapability: 'READ_EMAIL_METADATA', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/providers/gmail/gmail-manifest.ts#READ_EMAIL_METADATA' }, purpose: 'Summarize Gmail work facts on a schedule.' }),
  goldenDefinition({ strategy: 'PREDICTIVE_PREPARE', scenarioKey: 'vehicle.maintenance', capabilityPath: {
    sourceProvider: 'manual', sourceCapability: 'MANUAL_INPUT', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/connectors/base-connectors.ts#ManualConnector/InternalConnector' }, purpose: 'Prepare vehicle maintenance before its threshold.' }),
  goldenDefinition({ strategy: 'ASSISTED_ACTION', scenarioKey: 'work.meetings', capabilityPath: {
    sourceProvider: 'google_calendar', sourceCapability: 'READ_CALENDAR_EVENT', actionProvider: 'google_calendar', actionCapability: 'CREATE_CALENDAR_EVENT',
    evidenceReference: 'apps/api/src/providers/calendar/calendar-manifest.ts#READ_CALENDAR_EVENT/CREATE_CALENDAR_EVENT' }, purpose: 'Prepare Calendar creation for explicit approval and read-back.' }),
  goldenDefinition({ strategy: 'AUTOMATED_ACTION', scenarioKey: 'content.creation', capabilityPath: {
    sourceProvider: 'internal', sourceCapability: 'READ_INTERNAL', actionProvider: 'internal', actionCapability: 'WRITE_INTERNAL',
    evidenceReference: 'apps/api/src/connectors/base-connectors.ts#InternalConnector.READ_INTERNAL/WRITE_INTERNAL' }, purpose: 'Execute a bounded pre-authorized internal draft update.' }),
]);

/** @deprecated Prefer STRATEGY_GOLDEN_DEFINITIONS. */
export const STRATEGY_GOLDEN_JOURNEYS = STRATEGY_GOLDEN_DEFINITIONS;

export function assertScenarioCoverageLedger(entries: readonly ScenarioCoverageLedgerEntry[] = SCENARIO_COVERAGE_LEDGER): void {
  if (entries.length !== 96 || SCENARIO_DEFINITIONS.length !== 96 || new Set(entries.map((entry) => entry.scenarioKey)).size !== 96) {
    throw new Error('Scenario Coverage Ledger must contain exactly one entry for each of the 96 canonical Scenarios');
  }
  for (const scenario of SCENARIO_DEFINITIONS) {
    const entry = entries.find((item) => item.scenarioKey === scenario.key);
    if (!entry || entry.definition.scenarioRevision !== scenario.revision || entry.definition.definitionHash !== catalogHash(scenario)) {
      throw new Error(`Scenario Coverage Ledger does not preserve immutable Scenario revision: ${scenario.key}@${scenario.revision}`);
    }
    if (!isCoverageComplete(entry)) throw new Error(`Scenario Coverage Ledger is incomplete: ${scenario.key}`);
  }
  if (STRATEGY_GOLDEN_DEFINITIONS.length !== 8
    || new Set(STRATEGY_GOLDEN_DEFINITIONS.map((definition) => definition.strategy)).size !== STRATEGY_PROFILES.length
    || new Set(STRATEGY_GOLDEN_DEFINITIONS.map((definition) => definition.runtimeKey)).size !== 1
    || new Set(STRATEGY_GOLDEN_DEFINITIONS.map((definition) => definition.engineImplementation)).size !== 1) {
    throw new Error('Eight strategies must configure one shared Strategy Runtime without copied engines');
  }
  const conclusion = batch10Wave1Conclusion(entries);
  if (!conclusion.contractComplete || conclusion.numerator !== 46 || conclusion.denominator !== 46) {
    throw new Error('Batch 10 Wave 1 must be an exact 46/46 contract coverage conclusion');
  }
}

assertScenarioCoverageLedger();
