import type { JsonValue } from './index';
import type { ParserKey, SourceMode } from './reality-pipeline';

/**
 * R2 unified mobile observation model.
 *
 * Mobile entry points (Notification queue, Share receiver, AppReadSession) only
 * collect and submit an Observation. They never write Truth directly. The shared
 * Mobile Candidate Registry below is the single source of truth for how a
 * candidate kind maps to a parser / resource hint / fact key; no service keeps a
 * private copy of this mapping.
 */

export type MobileSourceType = 'NOTIFICATION' | 'SHARE';

/**
 * Unified mobile acquisition channel. NOTIFICATION / SHARE are content modes;
 * APP_READ_SESSION is the bounded foreground channel that can capture either.
 * Future channels (SCREENSHOT, ACCESSIBILITY) extend this enum without touching
 * the generic reality pipeline.
 */
export type MobileSourceMode = MobileSourceType | 'APP_READ_SESSION';

export type MobileCandidateKind = 'transaction' | 'shipment' | 'bill' | 'account' | 'device' | 'consumable' | 'household_supply';

export interface MobileCandidateKindSpec {
  candidateKind: MobileCandidateKind;
  parserId: ParserKey;
  resourceHint: string;
  factKey: string;
}

export const MOBILE_CANDIDATE_REGISTRY: readonly MobileCandidateKindSpec[] = Object.freeze([
  Object.freeze({ candidateKind: 'transaction', parserId: 'mobile-notification-billing.v1', resourceHint: 'finance.transaction', factKey: 'finance.transaction.amount' }),
  Object.freeze({ candidateKind: 'shipment', parserId: 'generic.shipment-status.v1', resourceHint: 'shipment', factKey: 'shipment.status' }),
  Object.freeze({ candidateKind: 'bill', parserId: 'generic.bill-reminder.v1', resourceHint: 'Bill', factKey: 'bill.bill.state' }),
  Object.freeze({ candidateKind: 'account', parserId: 'generic.connection-health.v1', resourceHint: 'digital_account.connection', factKey: 'digital_account.connection.health' }),
  Object.freeze({ candidateKind: 'device', parserId: 'generic.device-status.v1', resourceHint: 'DeviceStatus', factKey: 'device_status.status.state' }),
  Object.freeze({ candidateKind: 'consumable', parserId: 'generic.consumable-remaining.v1', resourceHint: 'device.consumable', factKey: 'device.consumable.remaining_days' }),
  Object.freeze({ candidateKind: 'household_supply', parserId: 'generic.household-supply.v1', resourceHint: 'household.supply', factKey: 'household.supply.remaining_days' }),
] as MobileCandidateKindSpec[]);

/**
 * Legacy candidate-kind names must keep routing through the same registry to
 * avoid breaking existing finance flows. They resolve to a canonical kind.
 */
export const MOBILE_CANDIDATE_LEGACY_ALIASES: Readonly<Record<string, MobileCandidateKind>> = Object.freeze({
  billing_transaction_candidate: 'transaction',
  account_notification_candidate: 'account',
  shipment_candidate: 'shipment',
  bill_candidate: 'bill',
  device_candidate: 'device',
});

export function resolveMobileCandidateSpec(candidateKind: string): MobileCandidateKindSpec | null {
  const canonical = MOBILE_CANDIDATE_LEGACY_ALIASES[candidateKind] ?? candidateKind;
  return MOBILE_CANDIDATE_REGISTRY.find((spec) => spec.candidateKind === canonical) ?? null;
}

/** Reverse-looks-up the canonical candidate kind from a registered parser id. */
export function mobileCandidateKindForParser(parserId: string): MobileCandidateKind | null {
  return MOBILE_CANDIDATE_REGISTRY.find((spec) => spec.parserId === parserId)?.candidateKind ?? null;
}

/** All accepted candidate-kind strings (canonical kinds + legacy aliases + unknown). */
export const MOBILE_CANDIDATE_KIND_VALUES: readonly string[] = Object.freeze([
  ...MOBILE_CANDIDATE_REGISTRY.map((spec) => spec.candidateKind),
  ...Object.keys(MOBILE_CANDIDATE_LEGACY_ALIASES),
  'unknown',
]);

/**
 * Unified observation envelope submitted by every mobile data entry point.
 * `userId` is intentionally absent here: the server binds it from the
 * authenticated caller and never trusts a client-supplied identity.
 */
export interface MobileObservationEnvelope {
  sourceType: MobileSourceMode;
  packageName: string;
  candidateKind: string;
  parserId: ParserKey;
  resourceHint: string;
  observedAt: string;
  evidenceHash: string;
  sourceRef: string;
  sessionId?: string | null;
  deviceId?: string | null;
  payload: Record<string, JsonValue>;
}

/** Maps a resolved mobile observation into the generic reality pipeline input. */
export function toSourceObservationInput(envelope: MobileObservationEnvelope, providerKey: string, connectionId: string | null): {
  sourceMode: SourceMode;
  providerKey: string;
  connectionId: string | null;
  externalEventKey: string;
  parserKey: ParserKey;
  resourceHint: string;
  payload: Record<string, JsonValue>;
  evidenceHash: string;
  observedAt: string;
  deviceId: string | null;
} {
  return {
    sourceMode: envelope.sourceType,
    providerKey,
    connectionId,
    externalEventKey: envelope.sourceRef,
    parserKey: envelope.parserId,
    resourceHint: envelope.resourceHint,
    payload: { ...envelope.payload, packageName: envelope.packageName },
    evidenceHash: envelope.evidenceHash,
    observedAt: envelope.observedAt,
    deviceId: envelope.deviceId ?? null,
  };
}
