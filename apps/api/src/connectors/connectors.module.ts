import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { InternalConnector, ManualConnector, WebhookConnector } from './base-connectors';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';

export const CONNECTOR_REGISTRY = 'CONNECTOR_REGISTRY';

@Module({
  controllers: [ConnectorsController],
  providers: [
    {
      provide: ConnectorRegistry,
      useFactory: () => {
        const registry = new ConnectorRegistry();
        registry.register(new ManualConnector());
        registry.register(new InternalConnector());
        registry.register(new WebhookConnector());
        return registry;
      },
    },
    { provide: CONNECTOR_REGISTRY, useExisting: ConnectorRegistry },
    ConnectorsService,
  ],
  exports: [ConnectorRegistry, CONNECTOR_REGISTRY, ConnectorsService],
})
export class ConnectorsModule {}
