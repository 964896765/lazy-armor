import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorRegistry, resolveSideEffectContract } from '@lazy-armor/connector-sdk';

@Injectable()
export class ConnectorsService {
  constructor(private readonly registry: ConnectorRegistry) {}

  list(view: 'public' | 'internal' = 'public') {
    return this.registry.list().map((connector) => this.serialize(connector.metadata().key, view));
  }

  get(key: string, view: 'public' | 'internal' = 'public') {
    try {
      return this.serialize(key, view);
    } catch {
      throw new NotFoundException('Connector not found');
    }
  }

  private serialize(key: string, view: 'public' | 'internal') {
    const connector = this.registry.get(key);
    const metadata = connector.metadata();
    const capabilities = connector.capabilities();
    if (view === 'internal') {
      return {
        ...metadata,
        capabilities: capabilities.map((capability) => ({
          ...capability,
          sideEffectContract: resolveSideEffectContract(capability),
        })),
      };
    }
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
        const contract = resolveSideEffectContract(capability);
        return {
          key: capability.key,
          name: capability.userFacingName ?? capability.name,
          operation: capability.operation,
          connectable: metadata.authentication.type !== 'none',
          draftOnly: capability.providerAvailability === 'draft_only' || metadata.productionStatus === 'DRAFT_ONLY',
          requiresConfirmation: capability.riskLevel === 'R3' || capability.riskLevel === 'R4',
          sideEffect: contract.sideEffect,
        };
      }),
    };
  }
}
