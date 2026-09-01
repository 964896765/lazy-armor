import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry, resolveSideEffectContract } from '@lazy-armor/connector-sdk';
import { connectorCapabilities, connectors } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

@Injectable()
export class ConnectorCatalogSyncService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly registry: ConnectorRegistry,
  ) {}

  async onModuleInit() {
    await this.sync();
  }

  async sync() {
    const now = new Date();
    for (const connector of this.registry.list()) {
      const metadata = connector.metadata();
      await this.db.insert(connectors).values({
        id: newId(),
        key: metadata.key,
        name: metadata.name,
        description: metadata.description,
        status: 'active',
        providerType: metadata.providerType,
        productionStatus: metadata.productionStatus,
        authenticationType: metadata.authentication.type,
        supportsRefresh: metadata.supportsRefresh ? 1 : 0,
        supportsRevoke: metadata.supportsRevoke ? 1 : 0,
        supportsWebhook: metadata.supportsWebhook ? 1 : 0,
        supportsHealthCheck: metadata.supportsHealthCheck ? 1 : 0,
        sandboxSupport: metadata.sandboxSupport,
        rateLimitStrategy: metadata.rateLimitStrategy,
        adapterVersion: metadata.version,
        createdAt: now,
        updatedAt: now,
      }).onDuplicateKeyUpdate({
        set: {
          name: metadata.name,
          description: metadata.description,
          status: 'active',
          providerType: metadata.providerType,
          productionStatus: metadata.productionStatus,
          authenticationType: metadata.authentication.type,
          supportsRefresh: metadata.supportsRefresh ? 1 : 0,
          supportsRevoke: metadata.supportsRevoke ? 1 : 0,
          supportsWebhook: metadata.supportsWebhook ? 1 : 0,
          supportsHealthCheck: metadata.supportsHealthCheck ? 1 : 0,
          sandboxSupport: metadata.sandboxSupport,
          rateLimitStrategy: metadata.rateLimitStrategy,
          adapterVersion: metadata.version,
          updatedAt: now,
        },
      });
      const row = (await this.db.select({ id: connectors.id }).from(connectors).where(eq(connectors.key, metadata.key)).limit(1))[0];
      if (!row) continue;
      for (const capability of connector.capabilities()) {
        const contract = resolveSideEffectContract(capability);
        await this.db.insert(connectorCapabilities).values({
          id: newId(),
          connectorId: row.id,
          key: capability.key,
          name: capability.userFacingName ?? capability.name,
          operation: capability.operation,
          riskLevel: capability.riskLevel,
          requiredPermission: capability.requiredPermission ?? capability.key,
          providerAvailability: capability.providerAvailability ?? availabilityForStatus(metadata.productionStatus),
          sideEffect: contract.sideEffect ? 1 : 0,
          supportsIdempotencyKey: contract.supportsIdempotencyKey ? 1 : 0,
          supportsOperationLookup: contract.supportsOperationLookup ? 1 : 0,
          retrySafety: contract.retrySafety,
          createdAt: now,
        }).onDuplicateKeyUpdate({
          set: {
            name: capability.userFacingName ?? capability.name,
            operation: capability.operation,
            riskLevel: capability.riskLevel,
            requiredPermission: capability.requiredPermission ?? capability.key,
            providerAvailability: capability.providerAvailability ?? availabilityForStatus(metadata.productionStatus),
            sideEffect: contract.sideEffect ? 1 : 0,
            supportsIdempotencyKey: contract.supportsIdempotencyKey ? 1 : 0,
            supportsOperationLookup: contract.supportsOperationLookup ? 1 : 0,
            retrySafety: contract.retrySafety,
          },
        });
      }
    }
  }
}

function availabilityForStatus(status: 'PRODUCTION_READY' | 'BETA' | 'DRAFT_ONLY' | 'DISABLED') {
  switch (status) {
    case 'PRODUCTION_READY':
      return 'available';
    case 'BETA':
      return 'beta';
    case 'DRAFT_ONLY':
      return 'draft_only';
    default:
      return 'disabled';
  }
}
