import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { CredentialsModule } from '../../credentials/credentials.module';
import { AuditModule } from '../../audit/audit.module';
import { FEISHU_TRANSPORT } from './feishu-http.client';
import { FeishuService } from './feishu.service';
import { FeishuController } from './feishu.controller';
import { FeishuWebhookService } from './feishu-webhook.service';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule, CredentialsModule, AuditModule],
  controllers: [FeishuController],
  providers: [FeishuService, FeishuWebhookService, { provide: FEISHU_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }],
  exports: [FeishuService, FeishuWebhookService, FEISHU_TRANSPORT] })
export class FeishuModule {}
