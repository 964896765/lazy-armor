import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { DatabaseModule } from '../common/database.module';
import {
  ContentProviderConnector,
  FileProviderConnector,
  GmailConnector,
  GoogleCalendarConnector,
  InternalConnector,
  LogisticsProviderConnector,
  ManualConnector,
  WebhookConnector,
} from './base-connectors';
import { ConnectorCatalogSyncService } from './connector-catalog-sync.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';

export const CONNECTOR_REGISTRY = 'CONNECTOR_REGISTRY';

@Module({
  imports: [DatabaseModule],
  controllers: [ConnectorsController],
  providers: [
    {
      provide: ConnectorRegistry,
      useFactory: () => {
        const registry = new ConnectorRegistry();
        registry.register(new ManualConnector());
        registry.register(new InternalConnector());
        registry.register(new WebhookConnector());
        registry.register(new GmailConnector());
        registry.register(new GoogleCalendarConnector());
        registry.register(new FileProviderConnector());
        registry.register(new LogisticsProviderConnector());
        registry.register(new ContentProviderConnector());
        return registry;
      },
    },
    { provide: CONNECTOR_REGISTRY, useExisting: ConnectorRegistry },
    ConnectorCatalogSyncService,
    ConnectorsService,
  ],
  exports: [ConnectorRegistry, CONNECTOR_REGISTRY, ConnectorsService],
})
export class ConnectorsModule {}
