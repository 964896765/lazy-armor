export const CONSUMER_PROJECTION_VERSION = 1 as const;

export const CONSUMER_READINESS_STATES = [
  'READY',
  'NEEDS_CONNECTION',
  'NEEDS_PERMISSION',
  'NEEDS_DATA',
  'DEVICE_OFFLINE',
  'SERVICE_UNAVAILABLE',
  'NEEDS_CONFIRMATION',
  'RESULT_UNKNOWN',
] as const;

export type ConsumerReadinessState = typeof CONSUMER_READINESS_STATES[number];
export type ConsumerProductReadiness = 'IMPLEMENTED' | 'NOT_VERIFIED';
export type ConsumerActionPath = '/connections' | '/today' | '/records' | null;

/**
 * Authoritative server projection consumed by Mobile surfaces.
 *
 * Product readiness answers whether the platform implements the capability.
 * User readiness answers whether this user's current grant, device, health and
 * evidence make it usable. Clients may render this contract but must not
 * promote it to READY themselves.
 */
export interface ConsumerReadinessProjection {
  contractVersion: typeof CONSUMER_PROJECTION_VERSION;
  productReadiness: ConsumerProductReadiness;
  userReadiness: ConsumerReadinessState;
  title: string;
  reason: string;
  nextAction: string;
  actionPath: ConsumerActionPath;
}

export function isConsumerReadinessProjection(value: unknown): value is ConsumerReadinessProjection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConsumerReadinessProjection>;
  return candidate.contractVersion === CONSUMER_PROJECTION_VERSION
    && (candidate.productReadiness === 'IMPLEMENTED' || candidate.productReadiness === 'NOT_VERIFIED')
    && typeof candidate.userReadiness === 'string'
    && CONSUMER_READINESS_STATES.includes(candidate.userReadiness as ConsumerReadinessState)
    && typeof candidate.title === 'string'
    && typeof candidate.reason === 'string'
    && typeof candidate.nextAction === 'string'
    && (candidate.actionPath === null || candidate.actionPath === '/connections'
      || candidate.actionPath === '/today' || candidate.actionPath === '/records');
}
