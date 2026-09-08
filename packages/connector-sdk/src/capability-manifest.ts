import { createHash } from 'node:crypto';
import type { CapabilityRisk, ConnectorCapability, SideEffectContract } from './index';

export const OFFICIAL_CAPABILITY_AVAILABILITIES = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE', 'TO_VERIFY_OFFICIAL'] as const;
export type OfficialCapabilityAvailability = typeof OFFICIAL_CAPABILITY_AVAILABILITIES[number];

export const IMPLEMENTATION_STATUSES = ['PRODUCTION', 'BETA', 'PARTIAL', 'NOT_IMPLEMENTED', 'DISABLED'] as const;
export type ImplementationStatus = typeof IMPLEMENTATION_STATUSES[number];

export const REVIEW_STATUSES = ['VERIFIED', 'PENDING_REVIEW', 'NOT_REQUIRED', 'TO_VERIFY_OFFICIAL'] as const;
export type ReviewStatus = typeof REVIEW_STATUSES[number];

export const REALTIME_MODES = ['POLL', 'WEBHOOK', 'PUSH', 'DEVICE_EVENT', 'FOREGROUND_SESSION', 'NONE', 'TO_VERIFY_OFFICIAL'] as const;
export type RealtimeMode = typeof REALTIME_MODES[number];

export const SOURCE_MODES = ['OFFICIAL_API', 'WEBHOOK', 'OS_API', 'NOTIFICATION', 'SHARE', 'FILE', 'APP_READ', 'VISION', 'MANUAL'] as const;
export type SourceMode = typeof SOURCE_MODES[number];

export const CAPABILITY_HEALTH_STATUSES = ['HEALTHY', 'DEGRADED', 'REAUTHORIZATION_REQUIRED', 'PERMISSION_REVOKED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'DEVICE_OFFLINE', 'UNHEALTHY', 'UNKNOWN'] as const;
export type ProviderCapabilityHealthStatus = typeof CAPABILITY_HEALTH_STATUSES[number];

export const CAPABILITY_GRANT_STATUSES = ['GRANTED', 'PARTIAL', 'NOT_GRANTED', 'REVOKED', 'EXPIRED', 'UNKNOWN'] as const;
export type ConnectionCapabilityGrantStatus = typeof CAPABILITY_GRANT_STATUSES[number];

export interface EvidenceRef {
  kind: 'OFFICIAL_DOC' | 'PROVIDER_CONSOLE' | 'SANDBOX_TEST' | 'INTEGRATION_TEST' | 'MANUAL_REVIEW';
  status: ReviewStatus;
  uri?: string;
  summary: string;
  verifiedAt?: string;
}

export interface DataBoundary {
  resources: string[];
  readableFields: string[];
  writableFields: string[];
  purpose: string[];
  retentionDays?: number;
  sensitiveFields?: string[];
}

export interface ProviderCapabilityManifestEntry extends ConnectorCapability {
  officialAvailability: OfficialCapabilityAvailability;
  implementationStatus: ImplementationStatus;
  reviewStatus: ReviewStatus;
  resources: string[];
  dataBoundary: DataBoundary;
  oauthScopes: string[];
  androidPermissions: string[];
  accountTypes: string[];
  sourceModes: SourceMode[];
  actionModes: Array<'OBSERVE' | 'REMIND' | 'PREPARE' | 'EXECUTE'>;
  realtimeModes: RealtimeMode[];
  verificationMethods: string[];
  explicitDenials: string[];
  evidence: EvidenceRef[];
  sideEffectContract: SideEffectContract;
}

export interface ProviderCapabilityManifest {
  schemaVersion: '1';
  providerKey: string;
  providerName: string;
  revision: number;
  accountTypes: string[];
  sourceModes: SourceMode[];
  actionModes: Array<'OBSERVE' | 'REMIND' | 'PREPARE' | 'EXECUTE'>;
  providerReview: ReviewStatus;
  rateLimitPolicy: string;
  capabilities: ProviderCapabilityManifestEntry[];
  evidence: EvidenceRef[];
  explicitDenials: string[];
}

export interface VersionedProviderCapabilityManifest extends ProviderCapabilityManifest {
  manifestHash: string;
}

export interface CapabilityUsability {
  providerKey: string;
  capabilityKey: string;
  providerAvailability: OfficialCapabilityAvailability;
  implementation: ImplementationStatus;
  grant: ConnectionCapabilityGrantStatus;
  health: ProviderCapabilityHealthStatus;
  explicitlyDenied?: boolean;
  usable: boolean;
  reasons: string[];
}

export function validateProviderCapabilityManifest(input: ProviderCapabilityManifest): VersionedProviderCapabilityManifest {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(input.providerKey)) errors.push('providerKey is invalid');
  if (!input.providerName.trim()) errors.push('providerName is required');
  if (!Number.isInteger(input.revision) || input.revision < 1) errors.push('revision must be a positive integer');
  if (!input.accountTypes.length) errors.push('accountTypes must not be empty');
  if (!input.sourceModes.length) errors.push('sourceModes must not be empty');
  const keys = new Set<string>();
  for (const capability of input.capabilities) {
    if (!/^[A-Z][A-Z0-9_]{1,95}$/.test(capability.key)) errors.push(`capability key is invalid: ${capability.key}`);
    if (keys.has(capability.key)) errors.push(`duplicate capability: ${capability.key}`);
    keys.add(capability.key);
    if (!capability.resources.length) errors.push(`resources are required: ${capability.key}`);
    if (!capability.dataBoundary.purpose.length) errors.push(`dataBoundary purpose is required: ${capability.key}`);
    if (capability.operation === 'execute' && capability.sideEffectContract.sideEffect && capability.verificationMethods.length === 0) {
      errors.push(`side-effect capability requires verificationMethods: ${capability.key}`);
    }
    if ((capability.riskLevel === 'R3' || capability.riskLevel === 'R4') && !capability.sideEffectContract.sideEffect) {
      errors.push(`high-risk capability must declare sideEffect: ${capability.key}`);
    }
    if (capability.officialAvailability === 'UNAVAILABLE' && capability.implementationStatus === 'PRODUCTION') {
      errors.push(`officially unavailable capability cannot be production: ${capability.key}`);
    }
    if (capability.officialAvailability === 'TO_VERIFY_OFFICIAL' && capability.reviewStatus !== 'TO_VERIFY_OFFICIAL') {
      errors.push(`unknown official capability must remain TO_VERIFY_OFFICIAL: ${capability.key}`);
    }
  }
  if (errors.length) throw new Error(`Invalid provider capability manifest for ${input.providerKey}:\n- ${errors.join('\n- ')}`);
  return { ...input, manifestHash: createHash('sha256').update(canonicalStringify(input)).digest('hex') };
}

export function resolveCapabilityUsability(input: Omit<CapabilityUsability, 'usable' | 'reasons'>): CapabilityUsability {
  const reasons: string[] = [];
  if (input.explicitlyDenied) reasons.push('CAPABILITY_EXPLICITLY_DENIED');
  if (input.providerAvailability !== 'AVAILABLE') reasons.push(providerAvailabilityReason(input.providerAvailability));
  if (input.implementation !== 'PRODUCTION' && input.implementation !== 'BETA') reasons.push(implementationReason(input.implementation));
  if (input.grant !== 'GRANTED') reasons.push(grantReason(input.grant));
  if (input.health !== 'HEALTHY') reasons.push(healthReason(input.health));
  return { ...input, usable: reasons.length === 0, reasons };
}

export function conservativeSideEffectContract(): SideEffectContract {
  return { sideEffect: false, supportsIdempotencyKey: false, supportsOperationLookup: false, retrySafety: 'unsafe', idempotencyKeyMaxLength: 128, idempotencySemantics: 'header' };
}

export function candidateCapability(input: { key: string; name: string; resource: string; riskLevel?: CapabilityRisk; operation?: ConnectorCapability['operation']; sourceModes: SourceMode[] }): ProviderCapabilityManifestEntry {
  const operation = input.operation ?? 'read';
  return {
    key: input.key,
    name: input.name,
    riskLevel: input.riskLevel ?? 'R0',
    operation,
    requiredPermission: input.key,
    providerAvailability: 'disabled',
    officialAvailability: 'TO_VERIFY_OFFICIAL',
    implementationStatus: 'NOT_IMPLEMENTED',
    reviewStatus: 'TO_VERIFY_OFFICIAL',
    resources: [input.resource],
    dataBoundary: { resources: [input.resource], readableFields: [], writableFields: [], purpose: ['scenario_runtime'], sensitiveFields: [] },
    oauthScopes: [],
    androidPermissions: [],
    accountTypes: ['consumer'],
    sourceModes: input.sourceModes,
    actionModes: operation === 'read' ? ['OBSERVE'] : ['PREPARE'],
    realtimeModes: ['TO_VERIFY_OFFICIAL'],
    verificationMethods: [],
    explicitDenials: [],
    evidence: [{ kind: 'MANUAL_REVIEW', status: 'TO_VERIFY_OFFICIAL', summary: '候选能力尚未完成官方证据核实。' }],
    sideEffectContract: conservativeSideEffectContract(),
  };
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function providerAvailabilityReason(value: OfficialCapabilityAvailability) { if (value === 'TO_VERIFY_OFFICIAL') return 'PROVIDER_OFFICIAL_STATUS_UNVERIFIED'; if (value === 'LIMITED') return 'PROVIDER_CAPABILITY_LIMITED'; return 'PROVIDER_CAPABILITY_UNAVAILABLE'; }
function implementationReason(value: ImplementationStatus) { if (value === 'NOT_IMPLEMENTED') return 'CAPABILITY_NOT_IMPLEMENTED'; if (value === 'PARTIAL') return 'CAPABILITY_IMPLEMENTATION_PARTIAL'; return 'CAPABILITY_DISABLED'; }
function grantReason(value: ConnectionCapabilityGrantStatus) { if (value === 'REVOKED') return 'CAPABILITY_GRANT_REVOKED'; if (value === 'EXPIRED') return 'CAPABILITY_GRANT_EXPIRED'; if (value === 'PARTIAL') return 'CAPABILITY_SCOPE_PARTIAL'; if (value === 'UNKNOWN') return 'CAPABILITY_GRANT_UNKNOWN'; return 'CAPABILITY_NOT_GRANTED'; }
function healthReason(value: ProviderCapabilityHealthStatus) { return `CAPABILITY_HEALTH_${value}`; }
