import { z } from 'zod';
import type { ConsumerReadinessProjection } from './consumer-projection';
import { catalogHash, type ScenarioDefinition, type StrategyProfile } from './runtime-catalog';

export const PLAN_OFFER_CONTRACT_VERSION = 1 as const;
export const PLAN_OFFER_AVAILABILITY = ['AVAILABLE', 'NEEDS_SETUP', 'MANUAL_ASSISTED', 'UNAVAILABLE'] as const;

export const planOfferRequestSchema = z.object({
  scenarioKey: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500),
  subjectKey: z.string().trim().min(1).max(255).optional(),
}).strict();

export type PlanOfferRequest = z.infer<typeof planOfferRequestSchema>;
export type PlanOfferAvailability = typeof PLAN_OFFER_AVAILABILITY[number];

export interface PlanOffer {
  contractVersion: typeof PLAN_OFFER_CONTRACT_VERSION;
  offerId: string;
  contentHash: string;
  scenario: Readonly<{ key: string; revision: number }>;
  goal: string;
  subjectKey: string | null;
  availability: PlanOfferAvailability;
  selectable: boolean;
  readiness: ConsumerReadinessProjection;
  facts: Readonly<{ required: readonly string[]; missing: readonly string[] }>;
  sources: readonly Readonly<{ capabilityKey: string; operation: string; resourceType: string; optional: boolean; usable: boolean }>[];
  strategy: Readonly<{ key: string; revision: number; actionMode: string; approvalPolicy: string }>;
  actions: readonly Readonly<{ capabilityKey: string; resourceType: string; optional: boolean; usable: boolean }>[];
  verification: readonly string[];
  limitations: readonly string[];
  nextAction: string;
  generatedAt: string;
}

export function buildDeterministicPlanOffer(input: {
  request: PlanOfferRequest;
  scenario: ScenarioDefinition;
  strategy: StrategyProfile;
  readiness: ConsumerReadinessProjection;
  usableCapabilities: readonly string[];
  availableFacts: readonly string[];
  manualInputAvailable: boolean;
  generatedAt: string;
}): PlanOffer {
  const request = planOfferRequestSchema.parse(input.request);
  if (request.scenarioKey !== input.scenario.key) throw new Error('Plan offer scenario does not match its contract');
  if (!input.scenario.supportedStrategies.includes(input.strategy.key)) throw new Error('Plan offer strategy is not supported by the scenario');

  const usable = new Set(input.usableCapabilities);
  const availableFacts = new Set(input.availableFacts);
  const missing = input.scenario.requiredFacts.filter((fact) => !availableFacts.has(fact));
  const sources = input.scenario.sourceRequirements.map((requirement) => Object.freeze({ ...requirement, usable: usable.has(requirement.capabilityKey) }));
  const actions = input.scenario.actionRequirements.map((requirement) => Object.freeze({
    capabilityKey: requirement.capabilityKey,
    resourceType: requirement.resourceType,
    optional: requirement.optional,
    usable: usable.has(requirement.capabilityKey),
  }));
  const requiredSourcesUsable = sources.filter((item) => !item.optional).every((item) => item.usable);
  const requiredActionsUsable = actions.filter((item) => !item.optional).every((item) => item.usable);

  let availability: PlanOfferAvailability;
  if (input.readiness.productReadiness === 'NOT_VERIFIED') availability = 'UNAVAILABLE';
  else if (input.readiness.userReadiness === 'READY' && missing.length === 0 && requiredSourcesUsable && requiredActionsUsable) availability = 'AVAILABLE';
  else if (input.manualInputAvailable && requiredActionsUsable) availability = 'MANUAL_ASSISTED';
  else availability = 'NEEDS_SETUP';

  const limitations = [
    ...(missing.length ? ['REQUIRED_FACTS_MISSING'] : []),
    ...(!requiredSourcesUsable ? ['SOURCE_CAPABILITY_NOT_READY'] : []),
    ...(!requiredActionsUsable ? ['ACTION_CAPABILITY_NOT_READY'] : []),
    ...(input.readiness.productReadiness === 'NOT_VERIFIED' ? ['PRODUCT_CAPABILITY_NOT_VERIFIED'] : []),
  ];
  const content = {
    contractVersion: PLAN_OFFER_CONTRACT_VERSION,
    scenario: { key: input.scenario.key, revision: input.scenario.revision },
    goal: request.goal,
    subjectKey: request.subjectKey ?? null,
    availability,
    facts: { required: [...input.scenario.requiredFacts], missing },
    sources,
    strategy: {
      key: input.strategy.key,
      revision: input.strategy.revision,
      actionMode: input.strategy.defaultActionMode,
      approvalPolicy: input.strategy.approvalPolicy,
    },
    actions,
    verification: [...input.scenario.verificationRequirements],
    limitations,
  };
  const contentHash = catalogHash(content);
  return Object.freeze({
    ...content,
    offerId: `offer_${contentHash.slice(0, 24)}`,
    contentHash,
    selectable: availability !== 'UNAVAILABLE',
    readiness: input.readiness,
    nextAction: availability === 'AVAILABLE' ? '选择此方案并确认授权边界' : input.readiness.nextAction,
    generatedAt: input.generatedAt,
  });
}
