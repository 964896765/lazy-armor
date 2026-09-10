import type { ProviderCapabilityManifestEntry, SourceMode } from './capability-manifest';

export interface CapabilityRequirement {
  schemaVersion: '1';
  capabilityKey: string;
  resource: string;
  operation: 'read' | 'execute';
  fields: string[];
  purpose: string;
  minimumReality: 'CLAIMED' | 'OBSERVED' | 'CORROBORATED' | 'VERIFIED';
  maxAgeSeconds: number;
  maxRisk: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  maxCostMicros: number;
  preferredProviders: string[];
  preferredSourceModes: SourceMode[];
}

/** Values supplied by trusted adapters, never by the resolving HTTP caller. */
export interface ResolutionCandidate {
  id: string;
  providerKey: string;
  manifestRevision: number;
  manifestHash: string;
  capability: ProviderCapabilityManifestEntry;
  connectionReady: boolean;
  grantSatisfied: boolean;
  healthUsable: boolean;
  accountSatisfied: boolean;
  deviceSatisfied: boolean;
  explicitlyDenied: boolean;
  reality: CapabilityRequirement['minimumReality'];
  observedAt: string | null;
  costMicros: number | null;
  latencyMs: number | null;
  reliability: number | null;
}

const realities = ['CLAIMED', 'OBSERVED', 'CORROBORATED', 'VERIFIED'];
export const CAPABILITY_RESOLVER_REVISION = 1;

export function resolveCapability(requirement: CapabilityRequirement, candidates: ResolutionCandidate[], evaluatedAt: string) {
  const now = Date.parse(evaluatedAt);
  if (!Number.isFinite(now) || !Number.isFinite(requirement.maxAgeSeconds) || requirement.maxAgeSeconds < 0
    || !Number.isSafeInteger(requirement.maxCostMicros) || requirement.maxCostMicros < 0
    || !realities.includes(requirement.minimumReality) || !/^R[0-4]$/.test(requirement.maxRisk)) throw new Error('Invalid resolution requirement');
  const evaluated = candidates.map((candidate) => {
    const c = candidate.capability;
    const reasons: string[] = [];
    const reject = (condition: boolean, reason: string) => { if (condition) reasons.push(reason); };
    reject(c.key !== requirement.capabilityKey || c.operation !== requirement.operation || !c.resources.includes(requirement.resource), 'SEMANTICS_MISMATCH');
    reject(c.officialAvailability !== 'AVAILABLE', 'OFFICIAL_CAPABILITY_UNAVAILABLE_OR_UNVERIFIED');
    reject(c.implementationStatus !== 'PRODUCTION', 'IMPLEMENTATION_NOT_READY');
    reject(!candidate.connectionReady || !candidate.grantSatisfied, 'GRANT_NOT_SATISFIED');
    reject(!candidate.healthUsable, 'HEALTH_NOT_USABLE');
    reject(!candidate.accountSatisfied, 'ACCOUNT_NOT_SATISFIED');
    reject(!candidate.deviceSatisfied, 'DEVICE_NOT_SATISFIED');
    reject(realities.indexOf(candidate.reality) < realities.indexOf(requirement.minimumReality), 'REALITY_INSUFFICIENT');
    const age = candidate.observedAt === null ? Infinity : (now - Date.parse(candidate.observedAt)) / 1000;
    reject(!Number.isFinite(age) || age < 0 || age > requirement.maxAgeSeconds, 'FRESHNESS_UNSATISFIED');
    reject(!/^R[0-4]$/.test(c.riskLevel) || Number(c.riskLevel.slice(1)) > Number(requirement.maxRisk.slice(1)), 'RISK_NOT_ALLOWED');
    const fields = requirement.operation === 'read' ? c.dataBoundary.readableFields : c.dataBoundary.writableFields;
    reject(!c.dataBoundary.resources.includes(requirement.resource) || !c.dataBoundary.purpose.includes(requirement.purpose)
      || requirement.fields.some((field) => !fields.includes(field)), 'DATA_BOUNDARY_NOT_ALLOWED');
    reject(candidate.explicitlyDenied, 'PROVIDER_EXPLICITLY_DENIED');
    reject(candidate.costMicros === null || !Number.isSafeInteger(candidate.costMicros) || candidate.costMicros < 0 || candidate.costMicros > requirement.maxCostMicros, 'COST_UNKNOWN_OR_EXCEEDED');
    reject(requirement.operation === 'execute' && c.sideEffectContract.sideEffect && c.verificationMethods.length === 0, 'VERIFICATION_UNAVAILABLE');
    const preference = (list: string[], value: string) => { const index = list.indexOf(value); return index < 0 ? 0 : list.length - index; };
    const score = {
      reliability: candidate.reliability !== null && Number.isFinite(candidate.reliability) && candidate.reliability >= 0 && candidate.reliability <= 1 ? candidate.reliability : -1,
      verificationStrength: c.verificationMethods.length,
      freshness: Number.isFinite(age) ? -age : -Number.MAX_VALUE,
      latency: candidate.latencyMs !== null && Number.isFinite(candidate.latencyMs) && candidate.latencyMs >= 0 ? -candidate.latencyMs : -Number.MAX_VALUE,
      cost: candidate.costMicros === null ? -Number.MAX_VALUE : -candidate.costMicros,
      providerPreference: preference(requirement.preferredProviders, candidate.providerKey),
      sourceModePreference: Math.max(0, ...c.sourceModes.map((mode) => preference(requirement.preferredSourceModes, mode))),
    };
    return { candidateId: candidate.id, providerKey: candidate.providerKey, manifestRevision: candidate.manifestRevision, manifestHash: candidate.manifestHash, eligible: reasons.length === 0, reasons, score };
  });
  const compare = (a: typeof evaluated[number], b: typeof evaluated[number]) => {
    for (const key of Object.keys(a.score) as Array<keyof typeof a.score>) { const delta = b.score[key] - a.score[key]; if (delta) return delta; }
    return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
  };
  const ranked = evaluated.filter((item) => item.eligible).sort(compare);
  return {
    schemaVersion: '1', resolverRevision: CAPABILITY_RESOLVER_REVISION, evaluatedAt,
    status: ranked.length ? 'RESOLVED' : 'BLOCKED', selectedCandidateId: ranked[0]?.candidateId ?? null,
    fallbackCandidates: ranked.slice(1).map((item) => ({ candidateId: item.candidateId,
      policy: requirement.operation === 'read' ? 'REVALIDATE_BEFORE_READ' : 'REQUIRES_OUTCOME_RECONCILIATION', automatic: false })),
    candidates: evaluated.sort((a, b) => a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0),
    executionAuthorized: false,
  };
}
