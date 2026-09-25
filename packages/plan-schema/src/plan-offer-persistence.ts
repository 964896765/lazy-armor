import { z } from 'zod';
import { catalogHash } from './runtime-catalog';
import { factDemandRequestSchema, type FactDemandProjection, type FactDemandRequest } from './fact-demand';
import type { SourceSelection } from './source-selection';

export const PERSISTENT_PLAN_OFFER_CONTRACT_VERSION = 2 as const;
export const PLAN_OFFER_STATES = ['DRAFT_ELIGIBLE', 'NEEDS_REQUIREMENTS'] as const;
export type PlanOfferState = typeof PLAN_OFFER_STATES[number];
export const persistentPlanOfferRequestSchema = factDemandRequestSchema;
export type PersistentPlanOfferRequest = FactDemandRequest;
export const choosePlanOfferRequestSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(120) }).strict();
export type ChoosePlanOfferRequest = z.infer<typeof choosePlanOfferRequestSchema>;

export const PLAN_AVAILABILITY_STATES = ['CURRENT', 'REFRESH_REQUIRED', 'RECONFIRMATION_REQUIRED'] as const;
export type PlanAvailabilityState = typeof PLAN_AVAILABILITY_STATES[number];

export interface PlanAvailabilityAssessment {
  contractVersion: 1;
  state: PlanAvailabilityState;
  reasonCodes: readonly string[];
  currentPreconditionHash: string;
  evaluatedAt: string;
}

export function assessPlanAvailability(input: {
  expectedContractHash: string;
  currentContractHash: string;
  previousSelections: readonly { demandId: string; selectedSourceId?: string | null; selectedSource?: SourceSelection | null }[];
  currentDemands: readonly FactDemandProjection[];
  evaluatedAt: string;
}): PlanAvailabilityAssessment {
  const required = input.currentDemands.filter((demand) => demand.required);
  const previous = new Map(input.previousSelections.map((selection) => [selection.demandId,
    selection.selectedSource?.sourceId ?? selection.selectedSourceId ?? null]));
  const reasonCodes = new Set<string>();
  let state: PlanAvailabilityState = 'CURRENT';
  if (input.expectedContractHash !== input.currentContractHash) {
    state = 'RECONFIRMATION_REQUIRED';
    reasonCodes.add('SCENARIO_CONTRACT_CHANGED');
  }
  for (const demand of required) {
    const priorSource = previous.get(demand.demandId) ?? null;
    const currentSource = demand.selectedSource?.sourceId ?? demand.selectedSourceId ?? null;
    if (!demand.sourceCurrentlyUsable || !currentSource) {
      state = 'RECONFIRMATION_REQUIRED';
      reasonCodes.add(demand.reasonCodes[0] ?? `FACT_DEMAND_${demand.state}`);
    } else if (priorSource !== currentSource) {
      state = 'RECONFIRMATION_REQUIRED';
      reasonCodes.add('SELECTED_SOURCE_CHANGED');
    } else if (demand.state === 'CONFLICT') {
      state = 'RECONFIRMATION_REQUIRED';
      reasonCodes.add('TRUTH_CONFLICT_REQUIRES_CONFIRMATION');
    } else if (demand.state !== 'SATISFIED' && state === 'CURRENT') {
      state = 'REFRESH_REQUIRED';
      reasonCodes.add(`FACT_DEMAND_${demand.state}`);
    }
  }
  if (state === 'CURRENT') reasonCodes.add('PLAN_PRECONDITIONS_CURRENT');
  return Object.freeze({
    contractVersion: 1,
    state,
    reasonCodes: Object.freeze([...reasonCodes]),
    currentPreconditionHash: planOfferPreconditionHash(input.currentDemands),
    evaluatedAt: input.evaluatedAt,
  });
}

export interface PersistentPlanOffer {
  contractVersion: typeof PERSISTENT_PLAN_OFFER_CONTRACT_VERSION;
  offerKey: string;
  state: PlanOfferState;
  selectable: boolean;
  scenario: Readonly<{ key: string; revision: number; contractHash: string }>;
  goal: FactDemandRequest['goal'];
  subject: FactDemandRequest['subject'];
  strategyKey: string;
  planMode: 'DRAFT';
  factDemandIds: readonly string[];
  sourceSelections: readonly Readonly<{
    demandId: string;
    factKey: string;
    subjectKey: string;
    maximumAgeSeconds: number;
    verificationRequirements: readonly string[];
    selection: SourceSelection | null;
    evidenceRefs: readonly string[];
  }>[];
  sourceSelectionHash: string;
  reasonCodes: readonly string[];
  preconditionHash: string;
  planDefinitionHash: string;
  generatedAt: string;
  expiresAt: string;
}

export function planOfferPreconditionHash(demands: readonly FactDemandProjection[]): string {
  return catalogHash(demands.map((demand) => ({
    demandId: demand.demandId, state: demand.state, selectedSourceId: demand.selectedSourceId,
    selectedSource: demand.selectedSource,
    capabilityDiscovered: demand.capabilityDiscovered, userOwnsSource: demand.userOwnsSource,
    sourceCurrentlyUsable: demand.sourceCurrentlyUsable, dataActuallyAcquired: demand.dataActuallyAcquired,
    dataVerified: demand.dataVerified,
    candidates: demand.candidateSources.map((source) => ({ sourceId: source.sourceId, discovered: source.discovered,
      ownedByUser: source.ownedByUser, implemented: source.implemented, authorized: source.authorized,
      deviceOnline: source.deviceOnline, healthy: source.healthy, contractCompatible: source.contractCompatible })),
    truthVersions: demand.truthEvidence.map((truth) => ({ id: truth.truthVersionId, valueHash: truth.valueHash,
      verified: truth.verified, conflict: truth.conflict })),
  })));
}

export function buildPersistentPlanOffer(input: {
  request: PersistentPlanOfferRequest; demands: readonly FactDemandProjection[]; contractHash: string;
  strategyKey: string; planDefinitionHash: string; generatedAt: string; ttlSeconds?: number;
}): PersistentPlanOffer {
  const request = persistentPlanOfferRequestSchema.parse(input.request);
  const generatedAt = new Date(input.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Plan Offer generatedAt must be an ISO timestamp');
  const preconditionHash = planOfferPreconditionHash(input.demands);
  const blocked = input.demands.some((demand) => demand.required && (!demand.sourceCurrentlyUsable
    || ['CONFLICT', 'STALE', 'NEEDS_VERIFICATION'].includes(demand.state)));
  const state: PlanOfferState = blocked ? 'NEEDS_REQUIREMENTS' : 'DRAFT_ELIGIBLE';
  const expiresAt = new Date(generatedAt.getTime() + (input.ttlSeconds ?? 600) * 1_000).toISOString();
  const identity = { scenarioKey: request.scenarioKey, scenarioRevision: request.scenarioRevision,
    contractHash: input.contractHash, goal: request.goal, subject: request.subject, strategyKey: input.strategyKey,
    planDefinitionHash: input.planDefinitionHash, preconditionHash };
  const sourceSelections = input.demands.map((demand) => Object.freeze({
    demandId: demand.demandId,
    factKey: demand.factKey,
    subjectKey: demand.subject.subjectKey,
    maximumAgeSeconds: demand.maximumAgeSeconds,
    verificationRequirements: Object.freeze([...demand.verificationRequirements]),
    selection: demand.selectedSource,
    evidenceRefs: Object.freeze(demand.selectedSource
      ? demand.candidateSources.find((candidate) => candidate.sourceId === demand.selectedSource!.sourceId)?.evidenceRefs ?? [] : []),
  }));
  return Object.freeze({ contractVersion: PERSISTENT_PLAN_OFFER_CONTRACT_VERSION,
    offerKey: `po_${catalogHash(identity).slice(0, 24)}`, state, selectable: state === 'DRAFT_ELIGIBLE',
    scenario: Object.freeze({ key: request.scenarioKey, revision: request.scenarioRevision, contractHash: input.contractHash }),
    goal: request.goal, subject: request.subject, strategyKey: input.strategyKey, planMode: 'DRAFT',
    factDemandIds: Object.freeze(input.demands.map((demand) => demand.demandId)),
    sourceSelections: Object.freeze(sourceSelections),
    sourceSelectionHash: catalogHash(sourceSelections),
    reasonCodes: Object.freeze(blocked ? ['PLAN_OFFER_REQUIREMENTS_NOT_MET'] : ['PLAN_OFFER_DRAFT_ELIGIBLE', 'EXECUTION_CAPABILITY_NOT_YET_PROMISED']),
    preconditionHash, planDefinitionHash: input.planDefinitionHash, generatedAt: generatedAt.toISOString(), expiresAt });
}
