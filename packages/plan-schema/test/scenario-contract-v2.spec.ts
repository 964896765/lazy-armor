import { describe, expect, it } from 'vitest';
import {
  SCENARIO_CONTRACT_V2_REGISTRY,
  SCENARIO_DEFINITIONS,
  assertScenarioContractV2,
  catalogHash,
  scenarioContractV2ByKey,
  scenarioGoalSpecSchema,
  scenarioResourceSubjectSchema,
} from '../src';

describe('Scenario Contract V2 compatibility sidecar', () => {
  it('does not modify the immutable 96-scenario V1 catalog', () => {
    expect(SCENARIO_DEFINITIONS).toHaveLength(96);
    expect(catalogHash(SCENARIO_DEFINITIONS)).toBe('3537c87bf154a5d7d779dbdccf2315d7b54a9dd253a6a390d76a855d51f77905');
  });

  it('defines the delivery golden contract without claiming real verification', () => {
    const contract = scenarioContractV2ByKey('daily_life.delivery')!;
    expect(SCENARIO_CONTRACT_V2_REGISTRY).toHaveLength(2);
    expect(() => assertScenarioContractV2(contract)).not.toThrow();
    expect(contract.governance).toMatchObject({
      state: 'DETERMINISTIC_SANDBOX',
      realSourceVerified: false,
      realActionVerified: false,
    });
    expect(contract.factDemands.map((item) => item.factKey)).toContain('shipment.status');
    expect(contract.actionDemands.map((item) => item.capabilityKey)).toContain('SEND_NOTIFICATION');
  });

  it('defines the device.consumables golden contract from manual registration without overclaiming device reads', () => {
    const contract = scenarioContractV2ByKey('device.consumables')!;
    expect(() => assertScenarioContractV2(contract)).not.toThrow();
    expect(contract.scenario).toEqual({ key: 'device.consumables', revision: 2 });
    expect(contract.governance).toMatchObject({
      state: 'DETERMINISTIC_SANDBOX',
      realSourceVerified: false,
      realActionVerified: false,
    });
    expect(contract.goal.requiredSubjectTypes).toContain('device.consumable');
    expect(contract.factDemands.map((item) => item.factKey)).toContain('device.consumable.remaining_days');
    expect(contract.factDemands[0].acceptedSourceModes).toContain('MANUAL');
    expect(contract.factDemands[0].missingPolicy).toBe('ALLOW_MANUAL_ASSISTED');
    expect(contract.actionDemands.map((item) => item.capabilityKey)).toContain('SEND_NOTIFICATION');
    expect(contract.unsupportedConditions.join(' ')).toContain('不宣称设备实时读取能力');
  });

  it('validates GoalSpec and ResourceSubject independently from the legacy Plan definition', () => {
    expect(scenarioGoalSpecSchema.parse({ intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '只在物流变化时提醒' })).toEqual({
      intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '只在物流变化时提醒', constraints: {},
    });
    expect(scenarioResourceSubjectSchema.parse({ resourceType: 'shipment', subjectKey: 'shipment:SF001' })).toEqual({
      resourceType: 'shipment', subjectKey: 'shipment:SF001',
    });
  });
});
