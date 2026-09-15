import { describe, expect, it } from 'vitest';
import {
  BATCH_10_WAVE_1_CONCLUSION,
  BATCH_10_WAVE_1_EXPECTED_COUNTS,
  FACT_SCHEMA_CATALOG,
  SCENARIO_COVERAGE_LEDGER,
  SCENARIO_COVERAGE_READINESS_STATES,
  SCENARIO_DEFINITIONS,
  STRATEGY_GOLDEN_DEFINITIONS,
  STRATEGY_PROFILES,
  STRATEGY_RUNTIME_KEY,
  assertScenarioCoverageLedger,
  buildStrategyRuntime,
  evaluateScenarioCoverageReadiness,
  scenarioByKey,
  terminalFollowUpRule,
  terminalFollowUpScenario,
} from '../src';

const requiredFields = [
  'definition', 'resources', 'facts', 'sourceRequirements', 'strategy', 'truthPolicy',
  'capabilityRequirements', 'sourceCapability', 'provider', 'actionCapability', 'risk', 'approval', 'verification', 'fallback',
  'mobilePresentation', 'backendReadiness', 'mobileReadiness', 'test', 'blockReason',
] as const;

function readinessFixture() {
  const scenario = scenarioByKey('finance.bill');
  const strategy = STRATEGY_PROFILES.find((item) => item.key === 'AUTOMATED_ACTION');
  if (!scenario || !strategy) throw new Error('readiness fixture catalog entry missing');
  return {
    scenario,
    strategy,
    evidence: {
      manualCapture: 'IMPLEMENTED' as const,
      observationPipeline: 'IMPLEMENTED' as const,
      executionPipeline: 'IMPLEMENTED' as const,
      sourceCapability: { providerStatus: 'SUPPORTED' as const, implementationStatus: 'IMPLEMENTED' as const, authorizationStatus: 'NOT_REQUIRED' as const },
      actionCapability: { providerStatus: 'SUPPORTED' as const, implementationStatus: 'IMPLEMENTED' as const, authorizationStatus: 'NOT_REQUIRED' as const },
      observedFactKeys: [...scenario.requiredFacts],
    },
  };
}

describe('Scenario Coverage Ledger contract', () => {
  it('covers exactly 96/96 immutable canonical Scenarios with every required field', () => {
    expect(SCENARIO_DEFINITIONS).toHaveLength(96);
    expect(SCENARIO_COVERAGE_LEDGER).toHaveLength(96);
    expect(new Set(SCENARIO_COVERAGE_LEDGER.map((entry) => entry.scenarioKey))).toEqual(new Set(SCENARIO_DEFINITIONS.map((entry) => entry.key)));

    for (const entry of SCENARIO_COVERAGE_LEDGER) {
      expect(requiredFields.every((field) => Object.hasOwn(entry, field))).toBe(true);
      expect(entry.definition).toMatchObject({ scenarioRevision: 1, immutableRevision: true, status: 'CATALOG_ONLY' });
      expect(entry.definition.definitionHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.resources.length).toBeGreaterThan(0);
      expect(entry.facts.some((fact) => fact.required)).toBe(true);
      expect(entry.facts.every((fact) => FACT_SCHEMA_CATALOG.some((schema) => schema.key === fact.key))).toBe(true);
      expect(entry.sourceRequirements.length).toBeGreaterThan(0);
      expect(entry.strategy.supported).toHaveLength(8);
      expect(entry.strategy.runtimeKey).toBe(STRATEGY_RUNTIME_KEY);
      expect(entry.truthPolicy).toMatchObject({ minimumReality: 'OBSERVED', candidate: { requireEvidence: true }, conflict: { unresolved: 'BLOCK' } });
      expect(entry.capabilityRequirements.source).toEqual(entry.sourceRequirements);
      expect(entry.capabilityRequirements.action.length).toBeGreaterThan(0);
      expect(entry.sourceCapability).toMatchObject({ providerKey: null, capabilityKey: entry.sourceRequirements[0]?.capabilityKey, operation: entry.sourceRequirements[0]?.operation, evidenceReference: null });
      expect(entry.provider).toMatchObject({ source: { providerKey: null, productionStatus: 'UNRESOLVED' }, action: { providerKey: null, productionStatus: 'UNRESOLVED' } });
      expect(entry.actionCapability).toMatchObject({ providerKey: null, capabilityKey: entry.capabilityRequirements.action[0]?.capabilityKey,
        operation: entry.capabilityRequirements.action[0]?.operation, risk: entry.risk.floor, evidenceReference: null });
      expect(entry.risk.floor).toMatch(/^R[0-4]$/);
      expect(entry.approval.strategyPolicy).toBeTruthy();
      expect(entry.verification.strategyPolicy).toBeTruthy();
      expect(entry.fallback).toMatchObject({ unknown: 'RECONCILE', conflict: 'BLOCK', unavailable: 'DEGRADE_TO_REMINDER' });
      expect(entry.mobilePresentation).toMatchObject({ title: entry.definition.label, readinessSource: 'scenario-coverage-ledger-api' });
      expect(entry.mobilePresentation.scenarioRoute).toContain(entry.scenarioKey);
      expect(SCENARIO_COVERAGE_READINESS_STATES).toContain(entry.backendReadiness.state);
      expect(SCENARIO_COVERAGE_READINESS_STATES).toContain(entry.mobileReadiness.state);
      expect(entry.test).toMatchObject({
        contractTest: 'packages/plan-schema/test/scenario-coverage-ledger.spec.ts',
        apiProjectionTest: 'apps/api/test/scenario-coverage-ledger.spec.ts',
        fullDatabaseE2e: 'NOT_COMPLETED_IN_BATCH_10_WAVE_1',
        realProviderJourney: 'NOT_COMPLETED_IN_BATCH_10_WAVE_1',
        mobileJourney: 'NOT_COMPLETED_IN_BATCH_10_WAVE_1',
      });
      expect(entry.blockReason.backend).toEqual(entry.backendReadiness.reasons);
      expect(entry.blockReason.mobile).toEqual(entry.mobileReadiness.reasons);
    }
    expect(() => assertScenarioCoverageLedger()).not.toThrow();
  });

  it('computes exact Batch 10 Wave 1 46/46 and the required domain grouping', () => {
    expect(BATCH_10_WAVE_1_CONCLUSION).toMatchObject({
      batch: 10,
      wave: 1,
      numerator: 46,
      denominator: 46,
      contractComplete: true,
      runtimeComplete: false,
      complete: false,
      expectedCounts: BATCH_10_WAVE_1_EXPECTED_COUNTS,
      actualCounts: { finance: 6, daily_life: 5, family: 5, work: 6, content: 6, vehicle: 6, device: 6, digital_account: 6 },
    });
    expect(BATCH_10_WAVE_1_CONCLUSION.scenarioKeys).toHaveLength(46);
    expect(new Set(BATCH_10_WAVE_1_CONCLUSION.scenarioKeys)).toHaveLength(46);
  });

  it('derives all six states exclusively from real evidence inputs', () => {
    const { scenario, strategy, evidence } = readinessFixture();
    const evaluate = (overrides: Partial<typeof evidence> = {}) => evaluateScenarioCoverageReadiness(scenario, strategy, { ...evidence, ...overrides });
    expect(evaluate().state).toBe('AUTOMATED_READY');
    expect(evaluate({ sourceCapability: { ...evidence.sourceCapability, providerStatus: 'UNSUPPORTED' } })).toMatchObject({ state: 'BLOCKED_PROVIDER', reasons: ['PROVIDER_CAPABILITY_UNSUPPORTED'] });
    expect(evaluate({ actionCapability: { ...evidence.actionCapability, authorizationStatus: 'NOT_GRANTED' } })).toMatchObject({ state: 'BLOCKED_PROVIDER', reasons: ['CAPABILITY_AUTHORIZATION_NOT_GRANTED'] });
    expect(evaluate({ actionCapability: { ...evidence.actionCapability, implementationStatus: 'NOT_IMPLEMENTED' } })).toMatchObject({ state: 'BLOCKED_IMPLEMENTATION', reasons: ['MANUAL_OR_CAPABILITY_RUNTIME_NOT_IMPLEMENTED'] });
    expect(evaluate({ observedFactKeys: [] })).toMatchObject({ state: 'MANUAL_READY', reasons: ['REQUIRED_FACTS_NOT_OBSERVED'] });
    expect(evaluate({ executionPipeline: 'NOT_IMPLEMENTED' })).toMatchObject({ state: 'OBSERVE_READY', reasons: ['EXECUTION_PIPELINE_NOT_IMPLEMENTED'] });
    const assisted = STRATEGY_PROFILES.find((item) => item.key === 'ASSISTED_ACTION');
    expect(assisted).toBeDefined();
    expect(evaluateScenarioCoverageReadiness(scenario, assisted!, evidence)).toMatchObject({ state: 'ASSISTED_READY', reasons: ['APPROVAL_REQUIRED_FOR_ACTION'] });
    expect(Object.hasOwn(evidence, 'available')).toBe(false);
  });

  it('defines eight real Fact/Capability paths over one shared runtime without copied engines', () => {
    expect(STRATEGY_GOLDEN_DEFINITIONS).toHaveLength(8);
    expect(new Set(STRATEGY_GOLDEN_DEFINITIONS.map((definition) => definition.strategy))).toEqual(new Set(STRATEGY_PROFILES.map((strategy) => strategy.key)));
    expect(new Set(STRATEGY_GOLDEN_DEFINITIONS.map((definition) => definition.runtimeKey))).toEqual(new Set([STRATEGY_RUNTIME_KEY]));
    expect(new Set(STRATEGY_GOLDEN_DEFINITIONS.map((definition) => definition.engineImplementation))).toEqual(new Set(['packages/plan-schema/src/strategy-runtime.ts']));

    for (const definition of STRATEGY_GOLDEN_DEFINITIONS) {
      const canonical = scenarioByKey(definition.scenarioKey);
      expect(canonical).not.toBeNull();
      expect(FACT_SCHEMA_CATALOG.some((fact) => fact.key === definition.factPath.factKey && fact.resourceType === definition.factPath.resourceType)).toBe(true);
      expect(definition.capabilityPath.sourceProvider).toBeTruthy();
      expect(definition.capabilityPath.sourceCapability).toBeTruthy();
      expect(definition.capabilityPath.actionCapability).toBeTruthy();
      expect(definition.capabilityPath.evidenceReference).toMatch(/^apps\/api\/src\//);
      const scenario = definition.scenarioRevision === canonical!.revision
        ? canonical!
        : terminalFollowUpScenario(terminalFollowUpRule(definition.scenarioKey, definition.scenarioRevision)!);
      const runtime = buildStrategyRuntime(scenario, definition.strategy);
      expect(runtime).toMatchObject({ runtimeKey: STRATEGY_RUNTIME_KEY, strategy: definition.strategy });
    }
  });
});
