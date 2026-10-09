import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  resolveCapabilityUsability,
  type ImplementationStatus,
} from '@lazy-armor/connector-sdk';
import {
  connectionCapabilityGrants,
  connections,
  connectorCapabilities,
  connectors,
  credentialRefs,
  providerCapabilityHealth,
} from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ProviderCapabilityRegistryService } from './provider-capability-registry.service';
import { capabilityAvailability } from './capability-availability';
import { canonicalCapabilityId, type ConnectionCapabilityView } from '@lazy-armor/plan-schema';

@Injectable()
export class CapabilityUsabilityService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly manifests: ProviderCapabilityRegistryService,
  ) {}

  async resolveConnection(userId: string, connectionId: string): Promise<ConnectionCapabilityView> {
    const connection = (await this.db.select({
      id: connections.id,
      providerKey: connectors.key,
      providerName: connectors.name,
      status: connections.status,
      statusReason: connections.statusReason,
      expiresAt: connections.expiresAt,
      authenticationType: connectors.authenticationType,
      credentialStatus: credentialRefs.status,
      credentialExpiresAt: credentialRefs.expiresAt,
    }).from(connections).innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .leftJoin(credentialRefs, eq(credentialRefs.id, connections.credentialRefId))
      .where(and(eq(connections.id, connectionId), eq(connections.userId, userId))).limit(1))[0];
    if (!connection) throw new NotFoundException('Connection not found');

    const legacy = await this.db.select({
      key: connectorCapabilities.key,
      name: connectorCapabilities.name,
      operation: connectorCapabilities.operation,
      riskLevel: connectorCapabilities.riskLevel,
      providerAvailability: connectorCapabilities.providerAvailability,
    }).from(connectorCapabilities)
      .innerJoin(connectors, eq(connectorCapabilities.connectorId, connectors.id))
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
      const state = capabilityAvailability({ providerKey: connection.providerKey, connection, scopes: declared?.oauthScopes ?? [], grant, health, now,
        credentialRequired: connection.authenticationType !== 'none' || connection.providerKey === 'public_http_json',
        credential: connection.credentialStatus ? {status:connection.credentialStatus, expiresAt:connection.credentialExpiresAt} : null });
      const usability = resolveCapabilityUsability({ providerKey: connection.providerKey, capabilityKey: key, providerAvailability: official,
        implementation, grant: state.grantStatus, health: state.healthStatus,
        explicitlyDenied: !!manifest?.explicitDenials.includes(key) || (declared?.explicitDenials.length ?? 0) > 0 });
      const reasons = [...usability.reasons, ...(!state.connectionReady ? ['CONNECTION_NOT_READY'] : []),
        ...(health?.status === 'HEALTHY' && !state.healthFresh ? ['CAPABILITY_HEALTH_EVIDENCE_STALE'] : [])];
      return {
        key,
        canonicalKey: canonicalCapabilityId(key),
        name: declared?.userFacingName ?? declared?.name ?? old?.name ?? key,
        operation: declared?.operation ?? (old?.operation === 'execute' ? 'execute' as const : old?.operation === 'subscribe' ? 'subscribe' as const : 'read' as const),
        sourceModes: [...(declared?.sourceModes ?? [])],
        riskLevel: declared?.riskLevel ?? old?.riskLevel ?? 'R0',
        dataBoundary: declared?.dataBoundary ?? null,
        verificationMethods: declared?.verificationMethods ?? [],
        explicitDenials: declared?.explicitDenials ?? [],
        ...usability, usable: reasons.length === 0, reasons,
        evidence: { checkedAt: health?.checkedAt.toISOString() ?? null, validUntil: health?.validUntil?.toISOString() ?? null,
          fresh: state.healthFresh, reasonCode: health?.reasonCode ?? null },
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
      evaluatedAt: now.toISOString(), executionAuthorized: false,
      capabilities,
    };
  }
}

function implementationFromLegacy(value: string): ImplementationStatus { if (value === 'available') return 'PRODUCTION'; if (value === 'beta') return 'BETA'; if (value === 'draft_only') return 'PARTIAL'; return 'DISABLED'; }
