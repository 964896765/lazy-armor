import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { CredentialsModule } from '../../credentials/credentials.module';
import { AuditModule } from '../../audit/audit.module';
import { DINGTALK_TRANSPORT } from './dingtalk-http.client';
import { DingTalkService } from './dingtalk.service';
import { DingTalkController } from './dingtalk.controller';
import { DingTalkWebhookService } from './dingtalk-webhook.service';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule, CredentialsModule, AuditModule],
  controllers: [DingTalkController],
  providers: [DingTalkService, DingTalkWebhookService, { provide: DINGTALK_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }],
  exports: [DingTalkService, DingTalkWebhookService, DINGTALK_TRANSPORT] })
export class DingTalkModule {}
