import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { GITHUB_TRANSPORT } from './github-http.client';
import { GitHubService } from './github.service';
import { GitHubController } from './github.controller';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule], controllers: [GitHubController],
  providers: [GitHubService, { provide: GITHUB_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }], exports: [GitHubService, GITHUB_TRANSPORT] })
export class GitHubModule {}
