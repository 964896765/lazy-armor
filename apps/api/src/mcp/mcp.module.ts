import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConnectionsModule } from '../connections/connections.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { PlansModule } from '../plans/plans.module';
import { ProviderCapabilitiesModule } from '../provider-capabilities/provider-capabilities.module';
import { RealityPipelineModule } from '../reality-pipeline/reality-pipeline.module';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { LazyArmorMcpController } from './lazy-armor-mcp.controller';
import { LazyArmorMcpToolService } from './lazy-armor-mcp-tools';
import { McpActionAdapter } from './mcp-action-adapter.service';
import { McpClientService } from './mcp-client.service';
import { McpServerRegistryService } from './mcp-server-registry.service';

@Module({
  imports: [AuditModule, ConnectionsModule, CredentialsModule, PlansModule, ProviderCapabilitiesModule, RealityPipelineModule, RuntimeCatalogModule],
  controllers: [LazyArmorMcpController],
  providers: [McpServerRegistryService, McpClientService, McpActionAdapter, LazyArmorMcpToolService],
  exports: [McpServerRegistryService, McpClientService, McpActionAdapter, LazyArmorMcpToolService],
})
export class McpModule {}
