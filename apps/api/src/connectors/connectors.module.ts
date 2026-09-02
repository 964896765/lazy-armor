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
  TrueProcessHarnessConnector,
  trueProcessHarnessEnabled,
  WebhookConnector,
} from './base-connectors';
import { ConnectorCatalogSyncService } from './connector-catalog-sync.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';

export const CONNECTOR_REGISTRY = 'CONNECTOR_REGISTRY';

export function shouldRegisterTrueProcessHarnessConnector(env: NodeJS.ProcessEnv) {
  return trueProcessHarnessEnabled(env);
}

export function createConnectorRegistry(env: NodeJS.ProcessEnv = process.env) {
  const registry = new ConnectorRegistry();
  registry.register(new ManualConnector());
  registry.register(new InternalConnector());
  registry.register(new WebhookConnector());
  registry.register(new GmailConnector());
  registry.register(new GoogleCalendarConnector());
  registry.register(new FileProviderConnector());
  registry.register(new LogisticsProviderConnector());
  registry.register(new ContentProviderConnector());
  if (shouldRegisterTrueProcessHarnessConnector(env)) {
    registry.register(new TrueProcessHarnessConnector());
  }
  return registry;
}

@Module({
  imports: [DatabaseModule],
  controllers: [ConnectorsController],
  providers: [
    {
      provide: ConnectorRegistry,
      useFactory: () => createConnectorRegistry(process.env),
    },
    { provide: CONNECTOR_REGISTRY, useExisting: ConnectorRegistry },
    ConnectorCatalogSyncService,
    ConnectorsService,
  ],
  exports: [ConnectorRegistry, CONNECTOR_REGISTRY, ConnectorsService],
})
export class ConnectorsModule {}
