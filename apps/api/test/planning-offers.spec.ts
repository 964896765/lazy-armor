import { describe, expect, it, vi } from 'vitest';
import { SCENARIO_DEFINITIONS, STRATEGY_PROFILES } from '@lazy-armor/plan-schema';
import { PlanningOffersService } from '../src/planning-offers/planning-offers.service';

describe('PlanningOffersService', () => {
  it('uses current user-scoped readiness and never creates a plan as a side effect', async () => {
    const scenario = SCENARIO_DEFINITIONS.find((item) => item.key === 'daily_life.delivery')!;
    const strategy = STRATEGY_PROFILES.find((item) => item.key === scenario.defaultStrategy)!;
    const catalog = { getScenario: vi.fn(() => scenario), getStrategy: vi.fn(() => strategy) };
    const readiness = { projectScenarioRuntimeEvidence: vi.fn(async () => ({
      evaluatedAt: '2026-09-25T00:00:00.000Z',
      availableFacts: [],
      manualInputAvailable: false,
      capabilities: [],
      product: {
        contractVersion: 1,
        productReadiness: 'NOT_VERIFIED',
        userReadiness: 'NEEDS_CONNECTION',
        title: '等待连接', reason: '没有可用来源。', nextAction: '前往连接中心', actionPath: '/connections',
      },
    })) };
    const service = new PlanningOffersService(catalog as never, readiness as never);

    const offer = await service.create('user-1', { scenarioKey: scenario.key, goal: '只在到件或异常时提醒' });

    expect(readiness.projectScenarioRuntimeEvidence).toHaveBeenCalledWith('user-1', scenario);
    expect(offer.availability).toBe('UNAVAILABLE');
    expect(offer.selectable).toBe(false);
    expect(offer.facts.required).toEqual(scenario.requiredFacts);
    expect(offer.actions.map((item) => item.capabilityKey)).toEqual(scenario.actionRequirements.map((item) => item.capabilityKey));
  });
});
