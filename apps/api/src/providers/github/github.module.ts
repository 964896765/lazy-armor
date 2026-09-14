import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { GITHUB_TRANSPORT } from './github-http.client';
import { GitHubService } from './github.service';
import { GitHubController } from './github.controller';
import { GitHubWebhookService } from './github-webhook.service';
import { CredentialsModule } from '../../credentials/credentials.module';
import { AuditModule } from '../../audit/audit.module';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule, CredentialsModule, AuditModule], controllers: [GitHubController],
  providers: [GitHubService, GitHubWebhookService, { provide: GITHUB_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }], exports: [GitHubService, GitHubWebhookService, GITHUB_TRANSPORT] })
export class GitHubModule {}
