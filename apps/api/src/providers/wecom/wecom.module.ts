import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { CredentialsModule } from '../../credentials/credentials.module';
import { AuditModule } from '../../audit/audit.module';
import { WECOM_TRANSPORT } from './wecom-http.client';
import { WeComService } from './wecom.service';
import { WeComController } from './wecom.controller';
import { WeComWebhookService } from './wecom-webhook.service';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule, CredentialsModule, AuditModule],
  controllers: [WeComController],
  providers: [WeComService, WeComWebhookService, { provide: WECOM_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }],
  exports: [WeComService, WeComWebhookService, WECOM_TRANSPORT] })
export class WeComModule {}
