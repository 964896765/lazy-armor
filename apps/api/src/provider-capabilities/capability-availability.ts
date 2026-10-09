import { CAPABILITY_GRANT_STATUSES, CAPABILITY_HEALTH_STATUSES, type ConnectionCapabilityGrantStatus, type ProviderCapabilityHealthStatus } from '@lazy-armor/connector-sdk';

type ConnectionState = { status: string; expiresAt: Date | null };
type GrantEvidence = { providerKey: string; status: string; revokedAt: Date | null; expiresAt: Date | null; grantedScopesJson: string[] };
type HealthEvidence = { providerKey: string; status: string; checkedAt: Date; validUntil: Date | null };

/** Shared temporal gates for the owner projection and Resolver. No execution authority. */
export function capabilityAvailability(input: { providerKey: string; connection: ConnectionState; scopes: readonly string[];
  grant?: GrantEvidence; health?: HealthEvidence; now: Date }) {
  const { providerKey, connection, scopes, grant, health, now } = input;
  const connectionExpired = !!connection.expiresAt && connection.expiresAt <= now;
  const connectionReady = connection.status === 'connected' && !connectionExpired;
  let grantStatus: ConnectionCapabilityGrantStatus = 'NOT_GRANTED';
  if (grant) {
    if (grant.providerKey !== providerKey) grantStatus = 'UNKNOWN';
    else if (grant.revokedAt || grant.status === 'REVOKED') grantStatus = 'REVOKED';
    else if (grant.expiresAt && grant.expiresAt <= now) grantStatus = 'EXPIRED';
    else if (!CAPABILITY_GRANT_STATUSES.includes(grant.status as ConnectionCapabilityGrantStatus)) grantStatus = 'UNKNOWN';
    else if (grant.status === 'GRANTED' && scopes.some(scope => !grant.grantedScopesJson.includes(scope))) grantStatus = 'PARTIAL';
    else grantStatus = grant.status as ConnectionCapabilityGrantStatus;
  }
  let healthStatus: ProviderCapabilityHealthStatus = 'UNKNOWN';
  const evidenceMatches = !!health && health.providerKey === providerKey && health.checkedAt <= now;
  const healthFresh = evidenceMatches && !!health.validUntil && health.validUntil > now && health.validUntil > health.checkedAt;
  if (evidenceMatches && CAPABILITY_HEALTH_STATUSES.includes(health.status as ProviderCapabilityHealthStatus)) {
    // Old negative evidence cannot become healthy through expiry; explicit successful checking clears it.
    healthStatus = health.status === 'HEALTHY' && !healthFresh ? 'UNKNOWN' : health.status as ProviderCapabilityHealthStatus;
  }
  if (connectionExpired || ['expired', 'reauthorization_required'].includes(connection.status)) healthStatus = 'REAUTHORIZATION_REQUIRED';
  else if (connection.status === 'revoked') healthStatus = 'PERMISSION_REVOKED';
  else if (connection.status === 'offline') healthStatus = 'DEVICE_OFFLINE';
  else if (connection.status === 'provider_error') healthStatus = 'PROVIDER_UNAVAILABLE';
  else if (connection.status === 'degraded' && healthStatus === 'HEALTHY') healthStatus = 'DEGRADED';
  else if (!connectionReady && healthStatus === 'HEALTHY') healthStatus = 'UNKNOWN';
  return { connectionReady, grantSatisfied: grantStatus === 'GRANTED', healthUsable: healthFresh && healthStatus === 'HEALTHY',
    grantStatus, healthStatus, healthFresh };
}
