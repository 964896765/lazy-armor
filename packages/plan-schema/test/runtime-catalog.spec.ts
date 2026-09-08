import { describe, expect, it } from 'vitest';
import {
  FACT_SCHEMA_CATALOG, RESOURCE_CATALOG, SCENARIO_DEFINITIONS, STRATEGY_PROFILES,
  catalogHash, compileScenarioPlan, evaluateScenarioReadiness,
} from '../src';

describe('runtime scenario catalog', () => {
  it('contains the complete versioned 19-domain, 96-scenario and 8-strategy model', () => {
    expect(new Set(SCENARIO_DEFINITIONS.map((item) => item.domain))).toHaveLength(19);
    expect(SCENARIO_DEFINITIONS).toHaveLength(96);
    expect(new Set(SCENARIO_DEFINITIONS.map((item) => item.key)).size).toBe(96);
    expect(STRATEGY_PROFILES).toHaveLength(8);
    expect(RESOURCE_CATALOG.length).toBeGreaterThanOrEqual(50);
  });

  it('keeps all resource and fact references inside shared catalogs', () => {
    const resources = new Set(RESOURCE_CATALOG.map((item) => item.key));
    const facts = new Set(FACT_SCHEMA_CATALOG.map((item) => item.key));
    for (const scenario of SCENARIO_DEFINITIONS) {
      expect(scenario.primaryResourceTypes.every((item) => resources.has(item))).toBe(true);
      expect(scenario.requiredFacts.every((item) => facts.has(item))).toBe(true);
      expect(scenario.status).toBe('CATALOG_ONLY');
    }
  });

  it('is deterministic and revisions are content-addressable', () => {
    expect(catalogHash(SCENARIO_DEFINITIONS)).toMatch(/^[a-f0-9]{64}$/);
    expect(catalogHash(SCENARIO_DEFINITIONS)).toBe(catalogHash([...SCENARIO_DEFINITIONS]));
  });

  it('fails closed until facts, capabilities and shared pipelines are real', () => {
    const scenario = SCENARIO_DEFINITIONS[0];
    expect(evaluateScenarioReadiness(scenario).state).toBe('CATALOG_ONLY');
    const capabilities = [...scenario.sourceRequirements, ...scenario.actionRequirements].map((item) => item.capabilityKey);
    expect(evaluateScenarioReadiness(scenario, { availableFacts: scenario.requiredFacts, usableCapabilities: capabilities, observationPipelineAvailable: true }).state).toBe('OBSERVE_READY');
    expect(evaluateScenarioReadiness(scenario, { availableFacts: scenario.requiredFacts, usableCapabilities: capabilities, observationPipelineAvailable: true, executionPipelineAvailable: true }).state).toBe('AUTOMATED_READY');
  });

  it('compiles through the existing Plan schema and refuses an unready executable plan', () => {
    const draft = compileScenarioPlan({ scenarioKey: 'finance.bill' });
    expect(draft.definition.schemaVersion).toBe('1.0');
    expect(draft.definition.domain).toBe('finance');
    expect(draft.definition.actions[0].actionType).toBe('notify');
    expect(() => compileScenarioPlan({ scenarioKey: 'finance.bill', mode: 'EXECUTABLE' })).toThrow('not executable');
  });
});
