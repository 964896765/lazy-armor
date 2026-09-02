import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorRegistry, resolveSideEffectContract } from '@lazy-armor/connector-sdk';

@Injectable()
export class ConnectorsService {
  constructor(private readonly registry: ConnectorRegistry) {}

  listPublic() {
    return this.registry.list().map((connector) => this.serializePublic(connector.metadata().key));
  }

  getPublic(key: string) {
    try {
      return this.serializePublic(key);
    } catch {
      throw new NotFoundException('Connector not found');
    }
  }

  listInternal() {
    return this.registry.list().map((connector) => this.serializeInternal(connector.metadata().key));
  }

  private serializeInternal(key: string) {
    const connector = this.registry.get(key);
    const metadata = connector.metadata();
    const capabilities = connector.capabilities();
    return {
      ...metadata,
      capabilities: capabilities.map((capability) => ({
        ...capability,
        sideEffectContract: resolveSideEffectContract(capability),
      })),
    };
  }

  private serializePublic(key: string) {
    const connector = this.registry.get(key);
    const metadata = connector.metadata();
    const capabilities = connector.capabilities();
    return {
      key: metadata.key,
      name: metadata.name,
      description: metadata.description,
      providerType: metadata.providerType,
      productionStatus: metadata.productionStatus,
      authentication: { type: metadata.authentication.type },
      connectable: metadata.authentication.type !== 'none',
      supportsRefresh: metadata.supportsRefresh,
      supportsRevoke: metadata.supportsRevoke,
      draftOnly: metadata.productionStatus === 'DRAFT_ONLY',
      capabilities: capabilities.map((capability) => {
        return {
          key: capability.key,
          name: capability.userFacingName ?? capability.name,
          operation: capability.operation,
          connectable: metadata.authentication.type !== 'none',
          draftOnly: capability.providerAvailability === 'draft_only' || metadata.productionStatus === 'DRAFT_ONLY',
          requiresConfirmation: capability.riskLevel === 'R3' || capability.riskLevel === 'R4',
        };
      }),
    };
  }
}
