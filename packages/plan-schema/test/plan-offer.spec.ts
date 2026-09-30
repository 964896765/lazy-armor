import { describe, expect, it } from 'vitest';
import { buildDeterministicPlanOffer } from '../src/plan-offer';
import { scenarioByKey, STRATEGY_PROFILES } from '../src/runtime-catalog';

describe('deterministic Plan Offer contract', () => {
  const scenario = scenarioByKey('daily_life.delivery')!;
  const strategy = STRATEGY_PROFILES.find((item) => item.key === scenario.defaultStrategy)!;
  const readiness = {
    contractVersion: 1 as const,
    productReadiness: 'IMPLEMENTED' as const,
    userReadiness: 'READY' as const,
    title: '可以使用',
    reason: '来源、权限和执行链均已就绪。',
    nextAction: '查看今天',
    actionPath: '/today' as const,
  };

  it('builds a selectable closed-loop offer only from registered facts, capabilities and verification', () => {
    const input = {
      request: { scenarioKey: scenario.key, goal: '包裹到件或异常时提醒', subjectKey: 'shipment:SF001' },
      scenario,
      strategy,
      readiness,
      usableCapabilities: [...scenario.sourceRequirements, ...scenario.actionRequirements].map((item) => item.capabilityKey),
      availableFacts: scenario.requiredFacts,
      manualInputAvailable: false,
      generatedAt: '2026-09-25T00:00:00.000Z',
    };
    const first = buildDeterministicPlanOffer(input);
    const second = buildDeterministicPlanOffer({ ...input, generatedAt: '2026-09-25T00:01:00.000Z' });

    expect(first.availability).toBe('AVAILABLE');
    expect(first.selectable).toBe(true);
    expect(first.verification).toEqual(scenario.verificationRequirements);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.offerId).toBe(second.offerId);
  });

  it('does not advertise an unavailable product as selectable', () => {
    const offer = buildDeterministicPlanOffer({
      request: { scenarioKey: scenario.key, goal: '包裹到件或异常时提醒' },
      scenario,
      strategy,
      readiness: { ...readiness, productReadiness: 'NOT_VERIFIED', userReadiness: 'NEEDS_CONNECTION' },
      usableCapabilities: [],
      availableFacts: [],
      manualInputAvailable: false,
      generatedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(offer.availability).toBe('UNAVAILABLE');
    expect(offer.selectable).toBe(false);
    expect(offer.limitations).toContain('PRODUCT_CAPABILITY_NOT_VERIFIED');
  });

  it('does not use manual fact input to hide an unverified or missing action chain', () => {
    const unverified = buildDeterministicPlanOffer({
      request: { scenarioKey: scenario.key, goal: '手工录入运单后提醒' },
      scenario,
      strategy,
      readiness: { ...readiness, productReadiness: 'NOT_VERIFIED', userReadiness: 'NEEDS_CONFIRMATION' },
      usableCapabilities: [],
      availableFacts: [],
      manualInputAvailable: true,
      generatedAt: '2026-09-25T00:00:00.000Z',
    });
    const missingActions = buildDeterministicPlanOffer({
      request: { scenarioKey: scenario.key, goal: '手工录入运单后提醒' },
      scenario,
      strategy,
      readiness: { ...readiness, userReadiness: 'NEEDS_CONFIRMATION' },
      usableCapabilities: [],
      availableFacts: [],
      manualInputAvailable: true,
      generatedAt: '2026-09-25T00:00:00.000Z',
    });

    expect(unverified.availability).toBe('UNAVAILABLE');
    expect(unverified.selectable).toBe(false);
    expect(missingActions.availability).toBe('NEEDS_SETUP');
    expect(missingActions.limitations).toContain('ACTION_CAPABILITY_NOT_READY');
  });
});
