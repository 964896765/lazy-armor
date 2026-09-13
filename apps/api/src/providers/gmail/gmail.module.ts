import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';
import { GOOGLE_TRANSPORT } from '../google/google-http.client';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule], controllers: [GmailController],
  providers: [GmailService, { provide: GOOGLE_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }], exports: [GmailService] })
export class GmailModule {}
