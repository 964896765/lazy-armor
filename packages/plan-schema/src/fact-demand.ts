import { z } from 'zod';
import { catalogHash, type RealityLevel } from './runtime-catalog';
import {
  scenarioContractV2ByKey,
  scenarioGoalSpecSchema,
  scenarioResourceSubjectSchema,
  type ScenarioContractV2,
  type ScenarioGoalSpec,
  type ScenarioResourceSubject,
} from './scenario-contract-v2';
import { buildSourceSelection, sourceIdNamespace, type SourceSelection, type SourceSelectionKind } from './source-selection';

export const FACT_DEMAND_CONTRACT_VERSION = 1 as const;
export const FACT_DEMAND_STATES = [
  'SATISFIED', 'CONFLICT', 'STALE', 'NEEDS_VERIFICATION', 'PENDING_ACQUISITION', 'NEEDS_PERMISSION',
  'DEVICE_OFFLINE', 'PROVIDER_UNHEALTHY', 'SOURCE_NOT_IMPLEMENTED', 'NEEDS_MANUAL_INPUT', 'NEEDS_SOURCE',
] as const;
export type FactDemandState = typeof FACT_DEMAND_STATES[number];

export const factDemandRequestSchema = z.object({
  scenarioKey: z.string().trim().min(1).max(120),
  scenarioRevision: z.number().int().positive(),
  goal: scenarioGoalSpecSchema,
  subject: scenarioResourceSubjectSchema,
}).strict();

export type FactDemandRequest = z.infer<typeof factDemandRequestSchema>;

export interface SourceCandidateEvidence {
  sourceId: string;
  kind: SourceSelectionKind;
  providerKey: string;
  connectionId: string | null;
  sourceMode: string;
  capabilityKey: string | null;
  trustedDeviceId: string | null;
  deviceAppConnectionId: string | null;
  truthRecordId: string | null;
  truthVersionId: string | null;
  discovered: boolean;
  ownedByUser: boolean;
  implemented: boolean;
  authorized: boolean;
  deviceOnline: boolean;
  healthy: boolean;
  contractCompatible: boolean;
  estimatedLatencyMs: number | null;
  costClass: 'FREE' | 'METERED' | 'UNKNOWN';
  evidenceRefs: readonly string[];
  reasonCodes: readonly string[];
}

export interface FactTruthEvidence {
  truthRecordId: string;
  truthVersionId: string;
  factKey: string;
  subjectKey: string;
  sourceProviderKey: string;
  sourceMode: string;
  valueHash: string;
  realityLevel: RealityLevel;
  verified: boolean;
  observedAt: string;
  createdAt: string;
  conflict: boolean;
}

export interface FactDemandProjection {
  contractVersion: typeof FACT_DEMAND_CONTRACT_VERSION;
  demandId: string;
  scenario: Readonly<{ key: string; revision: number; contractHash: string }>;
  goal: ScenarioGoalSpec;
  subject: ScenarioResourceSubject;
  factKey: string;
  subjectType: string;
  required: boolean;
  maximumAgeSeconds: number;
  minimumReality: RealityLevel;
  refreshPolicy: string;
  verificationRequirements: readonly string[];
  conflictPolicy: string;
  missingPolicy: string;
  state: FactDemandState;
  // These dimensions deliberately remain independent.
  capabilityDiscovered: boolean;
  userOwnsSource: boolean;
  sourceCurrentlyUsable: boolean;
  dataActuallyAcquired: boolean;
  dataVerified: boolean;
  selectedSourceId: string | null;
  selectedSource: SourceSelection | null;
  candidateSources: readonly Readonly<SourceCandidateEvidence & { rank: number; usable: boolean; acquired: boolean; verified: boolean }>[];
  truthEvidence: readonly FactTruthEvidence[];
  reasonCodes: readonly string[];
  evaluatedAt: string;
}

const REALITY_RANK: Record<RealityLevel, number> = { CLAIMED: 0, OBSERVED: 1, CORROBORATED: 2, VERIFIED: 3 };

/**
 * 只有这些「独立来源」才允许把已验证 Truth 投影成可被选择的来源候选。
 * 它们不依赖设备/Provider 连接持续在线：文件导入、手动登记、内部事实一旦验证，
 * 其来源即始终可用。设备/Provider 背书的来源（NOTIFICATION / OFFICIAL_API /
 * WEBHOOK / SHARE / APP_READ_SESSION）必须由真实的 device/provider 候选来表达，
 * 保留的已验证 Truth 只能作为证据（truthEvidence），不能冒充一个仍然在线的来源。
 */
const STANDALONE_TRUTH_SOURCE_MODES: ReadonlySet<string> = new Set(['FILE', 'MANUAL', 'INTERNAL']);

export function buildFactDemandProjections(input: {
  request: FactDemandRequest;
  contract: ScenarioContractV2;
  sources: readonly SourceCandidateEvidence[];
  truths: readonly FactTruthEvidence[];
  evaluatedAt: string;
}): readonly FactDemandProjection[] {
  const request = factDemandRequestSchema.parse(input.request);
  if (request.scenarioKey !== input.contract.scenario.key || request.scenarioRevision !== input.contract.scenario.revision) {
    throw new Error('FactDemand request does not match the immutable Scenario Contract revision');
  }
  if (!input.contract.goal.supportedIntents.includes(request.goal.intent)) throw new Error('Goal intent is not allowed by the Scenario Contract');
  if (!input.contract.goal.requiredSubjectTypes.includes(request.subject.resourceType)) throw new Error('ResourceSubject type is not allowed by the Scenario Contract');

  const now = new Date(input.evaluatedAt);
  if (Number.isNaN(now.getTime())) throw new Error('FactDemand evaluatedAt must be an ISO timestamp');
  return Object.freeze(input.contract.factDemands.map((definition) => {
    const relevantTruths = input.truths.filter((truth) => truth.factKey === definition.factKey
      && truth.subjectKey === request.subject.subjectKey);
    // A confirmed Truth is internally addressable whatever its original evidence
    // mode was. Its original mode is still checked against the Scenario Contract,
    // so a notification can only appear here after it has gone through candidate
    // confirmation; receipt text never becomes a transaction fact by itself.
    const truthSources: SourceCandidateEvidence[] = relevantTruths
      .filter((truth) => STANDALONE_TRUTH_SOURCE_MODES.has(truth.sourceMode))
      .map((truth) => ({
        sourceId: `${truth.sourceMode === 'MANUAL' ? 'manual' : 'internal'}:${truth.truthRecordId}:${truth.truthVersionId}`,
        kind: truth.sourceMode === 'MANUAL' ? 'MANUAL_INPUT' : 'INTERNAL_FACT',
        providerKey: truth.sourceProviderKey,
        connectionId: null,
        sourceMode: truth.sourceMode,
        capabilityKey: null,
        trustedDeviceId: null,
        deviceAppConnectionId: null,
        truthRecordId: truth.truthRecordId,
        truthVersionId: truth.truthVersionId,
        discovered: true,
        ownedByUser: true,
        implemented: true,
        authorized: true,
        deviceOnline: true,
        healthy: !truth.conflict,
        contractCompatible: definition.acceptedSourceModes.includes(truth.sourceMode as never),
        estimatedLatencyMs: 0,
        costClass: 'FREE',
        evidenceRefs: [`truth-record:${truth.truthRecordId}`, `truth-version:${truth.truthVersionId}`],
        reasonCodes: truth.conflict ? ['TRUTH_SOURCE_CONFLICT'] : [],
      }));
    const manualPending: SourceCandidateEvidence[] = definition.acceptedSourceModes.includes('MANUAL')
      && !truthSources.some((source) => source.kind === 'MANUAL_INPUT') ? [{
        sourceId: `manual:pending:${catalogHash({ subjectKey: request.subject.subjectKey, factKey: definition.factKey }).slice(0, 24)}`,
        kind: 'MANUAL_INPUT', providerKey: 'manual', connectionId: null, sourceMode: 'MANUAL', capabilityKey: null,
        trustedDeviceId: null, deviceAppConnectionId: null, truthRecordId: null, truthVersionId: null,
        discovered: false, ownedByUser: true, implemented: true, authorized: true, deviceOnline: true, healthy: true,
        contractCompatible: true, estimatedLatencyMs: null, costClass: 'FREE', evidenceRefs: [], reasonCodes: ['MANUAL_INPUT_REQUIRED'],
      }] : [];
    const compatibleSources = [...input.sources, ...truthSources, ...manualPending].filter((source) => source.contractCompatible
      && (definition.acceptedSourceCapabilities.includes(source.capabilityKey ?? '')
        || definition.acceptedSourceModes.includes(source.sourceMode as never)));
    const freshTruths = relevantTruths.filter((truth) => now.getTime() - new Date(truth.createdAt).getTime() <= definition.maximumAgeSeconds * 1000);
    const verifiedTruths = freshTruths.filter((truth) => truth.verified
      && REALITY_RANK[truth.realityLevel] >= REALITY_RANK[definition.minimumReality]);
    const conflict = relevantTruths.some((truth) => truth.conflict)
      || new Set(verifiedTruths.map((truth) => truth.valueHash)).size > 1;
    const rankedSources = compatibleSources.map((source) => {
      const identityComplete = source.kind === 'PROVIDER_CONNECTION' ? Boolean(source.connectionId && source.capabilityKey)
        : source.kind === 'TRUSTED_DEVICE' ? Boolean(source.trustedDeviceId && source.deviceAppConnectionId && source.capabilityKey)
          : Boolean(source.truthRecordId && source.truthVersionId);
      const usable = identityComplete && source.discovered && source.ownedByUser && source.implemented && source.authorized
        && source.deviceOnline && source.healthy && source.contractCompatible;
      const matchingTruth = relevantTruths.filter((truth) => truth.sourceProviderKey === source.providerKey);
      const acquired = matchingTruth.length > 0;
      const verified = matchingTruth.some((truth) => verifiedTruths.includes(truth));
      const rank = (usable ? 1_000 : 0) + (verified ? 500 : acquired ? 200 : 0)
        + (source.sourceMode === 'OFFICIAL_API' ? 80 : source.sourceMode === 'WEBHOOK' ? 70 : source.sourceMode === 'NOTIFICATION' ? 50 : 30)
        - Math.min(source.estimatedLatencyMs ?? 0, 60_000) / 1_000;
      return Object.freeze({ ...source, rank, usable, acquired, verified });
    }).sort((left, right) => right.rank - left.rank || left.sourceId.localeCompare(right.sourceId));
    const selected = rankedSources.find((source) => source.usable) ?? null;
    const reasonCodes: string[] = [];
    let state: FactDemandState;
    if (conflict) state = 'CONFLICT';
    else if (verifiedTruths.length > 0) state = 'SATISFIED';
    else if (freshTruths.length > 0) state = 'NEEDS_VERIFICATION';
    else if (relevantTruths.length > 0) state = 'STALE';
    else if (selected) state = 'PENDING_ACQUISITION';
    else if (rankedSources.some((source) => !source.authorized)) state = 'NEEDS_PERMISSION';
    else if (rankedSources.some((source) => !source.deviceOnline)) state = 'DEVICE_OFFLINE';
    else if (rankedSources.some((source) => !source.healthy)) state = 'PROVIDER_UNHEALTHY';
    else if (rankedSources.some((source) => !source.implemented)) state = 'SOURCE_NOT_IMPLEMENTED';
    else if (rankedSources.some((source) => source.kind === 'MANUAL_INPUT' && !source.truthVersionId)) state = 'NEEDS_MANUAL_INPUT';
    else state = 'NEEDS_SOURCE';
    reasonCodes.push(`FACT_DEMAND_${state}`);
    if (!compatibleSources.length) reasonCodes.push('NO_CONTRACT_COMPATIBLE_SOURCE');
    if (conflict) reasonCodes.push('TRUTH_SOURCE_CONFLICT_REQUIRES_EXISTING_REALITY_POLICY');
    const identity = {
      scenario: input.contract.scenario,
      contractHash: input.contract.definitionHash,
      goal: request.goal,
      subject: request.subject,
      factKey: definition.factKey,
    };
    return Object.freeze({
      contractVersion: FACT_DEMAND_CONTRACT_VERSION,
      demandId: `fd_${catalogHash(identity).slice(0, 24)}`,
      scenario: Object.freeze({ ...input.contract.scenario, contractHash: input.contract.definitionHash }),
      goal: request.goal,
      subject: request.subject,
      factKey: definition.factKey,
      subjectType: definition.subjectType,
      required: definition.required,
      maximumAgeSeconds: definition.maximumAgeSeconds,
      minimumReality: definition.minimumReality,
      refreshPolicy: definition.refreshPolicy,
      verificationRequirements: definition.verificationRequirements,
      conflictPolicy: definition.conflictPolicy,
      missingPolicy: definition.missingPolicy,
      state,
      capabilityDiscovered: compatibleSources.some((source) => source.discovered),
      userOwnsSource: compatibleSources.some((source) => source.ownedByUser),
      sourceCurrentlyUsable: Boolean(selected),
      dataActuallyAcquired: relevantTruths.length > 0,
      dataVerified: verifiedTruths.length > 0 && !conflict,
      selectedSourceId: selected?.sourceId ?? null,
      selectedSource: selected ? buildSourceSelection({
        kind: selected.kind,
        sourceId: selected.sourceId,
        connectionId: selected.connectionId,
        capabilityKey: selected.capabilityKey,
        trustedDeviceId: selected.trustedDeviceId,
        deviceAppConnectionId: selected.deviceAppConnectionId,
        truthRecordId: selected.truthRecordId,
        truthVersionId: selected.truthVersionId,
      }) : null,
      candidateSources: Object.freeze(rankedSources),
      truthEvidence: Object.freeze(relevantTruths),
      reasonCodes: Object.freeze(reasonCodes),
      evaluatedAt: input.evaluatedAt,
    });
  }));
}

export function factDemandRequestForScenario(input: unknown): { request: FactDemandRequest; contract: ScenarioContractV2 } {
  const request = factDemandRequestSchema.parse(input);
  const contract = scenarioContractV2ByKey(request.scenarioKey);
  if (!contract) throw new Error('Scenario Contract V2 not available');
  return { request, contract };
}
