import { ArtifactModule } from '../artifacts/artifact.module';
import { CreationDraftsModule } from '../creation-drafts/creation-drafts.module';
import { AuditModule } from '../audit/audit.module';
import { ExecutionModule } from '../execution/execution.module';
import { CapabilityResolverModule } from '../capability-resolver/capability-resolver.module';
import { ConversationOnceService } from './conversation-once.service';
import { Module } from '@nestjs/common';
import { AiAdapterModule } from '../ai-adapter/ai-adapter.module';
import { PlansModule } from '../plans/plans.module';
import { ConnectionsModule } from '../connections/connections.module';
import { TrustedDevicesModule } from '../trusted-devices/trusted-devices.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { TemplatesModule } from '../templates/templates.module';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
@Module({ imports: [ArtifactModule, AuditModule, CreationDraftsModule, ExecutionModule, CapabilityResolverModule, AiAdapterModule, PlansModule, ConnectionsModule, TrustedDevicesModule, ConnectorsModule, TemplatesModule], controllers: [ConsumerController], providers: [ConsumerService, ConversationOnceService] })
export class ConsumerModule {}
