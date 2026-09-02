import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { WebhookSignatureVerifier } from './webhook-signature-verifier.service';
import { WebhooksService } from './webhooks.service';
import { WebhookRetentionService } from './webhook-retention.service';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ConnectorsModule, CredentialsModule, PermissionsModule, AuditModule, UsageModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, WebhooksService, WebhookSignatureVerifier, WebhookRetentionService, { provide: 'CONNECTOR_INVOCATION_SERVICE', useExisting: ConnectionsService }, { provide: 'WEBHOOK_RETENTION_SERVICE', useExisting: WebhookRetentionService }],
  exports: [ConnectionsService, WebhookRetentionService, 'CONNECTOR_INVOCATION_SERVICE', 'WEBHOOK_RETENTION_SERVICE'],
})
export class ConnectionsModule {}
