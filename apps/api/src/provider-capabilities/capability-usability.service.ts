import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  resolveCapabilityUsability,
  type ConnectionCapabilityGrantStatus,
  type ImplementationStatus,
  type OfficialCapabilityAvailability,
  type ProviderCapabilityHealthStatus,
} from '@lazy-armor/connector-sdk';
import {
  connectionCapabilityGrants,
  connectionPermissions,
  connections,
  connectorCapabilities,
  connectors,
  providerCapabilityHealth,
} from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ProviderCapabilityRegistryService } from './provider-capability-registry.service';

@Injectable()
export class CapabilityUsabilityService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly manifests: ProviderCapabilityRegistryService,
  ) {}

  async resolveConnection(userId: string, connectionId: string) {
    const connection = (await this.db.select({
      id: connections.id,
      providerKey: connectors.key,
      providerName: connectors.name,
      status: connections.status,
      statusReason: connections.statusReason,
      expiresAt: connections.expiresAt,
    }).from(connections).innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .where(and(eq(connections.id, connectionId), eq(connections.userId, userId))).limit(1))[0];
    if (!connection) throw new NotFoundException('Connection not found');

    const legacy = await this.db.select({
      key: connectorCapabilities.key,
      name: connectorCapabilities.name,
      operation: connectorCapabilities.operation,
      riskLevel: connectorCapabilities.riskLevel,
      providerAvailability: connectorCapabilities.providerAvailability,
      permissionGranted: connectionPermissions.granted,
      permissionExpiresAt: connectionPermissions.expiresAt,
      permissionRevokedAt: connectionPermissions.revokedAt,
    }).from(connectorCapabilities)
      .innerJoin(connectors, eq(connectorCapabilities.connectorId, connectors.id))
      .leftJoin(connectionPermissions, and(eq(connectionPermissions.connectorCapabilityId, connectorCapabilities.id), eq(connectionPermissions.connectionId, connectionId)))
      .where(eq(connectors.key, connection.providerKey));

    const manifest = this.manifests.list().find((item) => item.providerKey === connection.providerKey);
    const persistedGrants = await this.db.select().from(connectionCapabilityGrants).where(eq(connectionCapabilityGrants.connectionId, connectionId));
    const healthRows = await this.db.select().from(providerCapabilityHealth).where(eq(providerCapabilityHealth.connectionId, connectionId));
    const manifestByKey = new Map((manifest?.capabilities ?? []).map((item) => [item.key, item]));
    const legacyByKey = new Map(legacy.map((item) => [item.key, item]));
    const keys = new Set([...manifestByKey.keys(), ...legacyByKey.keys()]);
    const now = new Date();

    const capabilities = [...keys].map((key) => {
      const declared = manifestByKey.get(key);
      const old = legacyByKey.get(key);
      const grant = persistedGrants.find((item) => item.capabilityKey === key);
      const health = healthRows.find((item) => item.capabilityKey === key);
      const official = declared?.officialAvailability ?? 'TO_VERIFY_OFFICIAL';
      const implementation = old ? implementationFromLegacy(old.providerAvailability) : declared?.implementationStatus ?? 'NOT_IMPLEMENTED';
      const grantStatus = grant?.status as ConnectionCapabilityGrantStatus | undefined ?? grantFromLegacy(old, now);
      const healthStatus = health?.status as ProviderCapabilityHealthStatus | undefined ?? healthFromConnection(connection.status, connection.expiresAt, now);
      return {
        key,
        name: declared?.userFacingName ?? declared?.name ?? old?.name ?? key,
        operation: declared?.operation ?? old?.operation ?? 'read',
        riskLevel: declared?.riskLevel ?? old?.riskLevel ?? 'R0',
        dataBoundary: declared?.dataBoundary ?? null,
        verificationMethods: declared?.verificationMethods ?? [],
        explicitDenials: declared?.explicitDenials ?? [],
        ...resolveCapabilityUsability({ providerKey: connection.providerKey, capabilityKey: key, providerAvailability: official, implementation, grant: grantStatus, health: healthStatus, explicitlyDenied: (declared?.explicitDenials.length ?? 0) > 0 }),
      };
    });
    return {
      connectionId,
      providerKey: connection.providerKey,
      providerName: connection.providerName,
      manifestRevision: manifest?.revision ?? null,
      manifestHash: manifest?.manifestHash ?? null,
      providerReview: manifest?.providerReview ?? 'TO_VERIFY_OFFICIAL',
      connectionStatus: connection.status,
      connectionStatusReason: connection.statusReason,
      capabilities,
    };
  }
}

function implementationFromLegacy(value: string): ImplementationStatus { if (value === 'available') return 'PRODUCTION'; if (value === 'beta') return 'BETA'; if (value === 'draft_only') return 'PARTIAL'; return 'DISABLED'; }
function grantFromLegacy(value: { permissionGranted: number | null; permissionExpiresAt: Date | null; permissionRevokedAt: Date | null } | undefined, now: Date): ConnectionCapabilityGrantStatus { if (!value) return 'UNKNOWN'; if (value.permissionRevokedAt) return 'REVOKED'; if (value.permissionExpiresAt && value.permissionExpiresAt <= now) return 'EXPIRED'; return value.permissionGranted === 1 ? 'GRANTED' : 'NOT_GRANTED'; }
function healthFromConnection(status: string, expiresAt: Date | null, now: Date): ProviderCapabilityHealthStatus { if (expiresAt && expiresAt <= now) return 'REAUTHORIZATION_REQUIRED'; if (status === 'connected') return 'HEALTHY'; if (status === 'degraded') return 'DEGRADED'; if (status === 'reauthorization_required' || status === 'expired') return 'REAUTHORIZATION_REQUIRED'; if (status === 'provider_error') return 'PROVIDER_UNAVAILABLE'; if (status === 'revoked') return 'PERMISSION_REVOKED'; return 'UNKNOWN'; }
