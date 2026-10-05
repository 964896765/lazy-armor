import {RealityPipelineModule} from '../reality-pipeline/reality-pipeline.module';
import { CalendarProjectionService } from './calendar-projection.service';
import {PlanStateAssessmentService} from './plan-state-assessment.service';
import {FactDemandsModule} from '../fact-demands/fact-demands.module';
import {LocalCapabilitiesService} from './local-capabilities.service';
import {AcquisitionModule} from '../acquisition/acquisition.module';
import {LocalAcquisitionService} from './local-acquisition.service';
import { WorkItemProjectionService } from './work-item-projection.service';
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
@Module({ imports: [RealityPipelineModule,FactDemandsModule,AcquisitionModule, ArtifactModule, AuditModule, CreationDraftsModule, ExecutionModule, CapabilityResolverModule, AiAdapterModule, PlansModule, ConnectionsModule, TrustedDevicesModule, ConnectorsModule, TemplatesModule], controllers: [ConsumerController], providers: [CalendarProjectionService, PlanStateAssessmentService, LocalCapabilitiesService, WorkItemProjectionService, ConsumerService, ConversationOnceService] })
export class ConsumerModule {}
