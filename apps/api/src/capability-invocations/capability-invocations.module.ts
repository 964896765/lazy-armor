import {CapabilityResolverModule} from '../capability-resolver/capability-resolver.module';
import {RuntimeResultsService} from './runtime-results.service';
import {RuntimeResultsController} from './runtime-results.controller';
import {RuntimeTasksService} from './runtime-tasks.service';
import {Module} from '@nestjs/common';
import {RuntimeTargetsModule} from '../runtime-targets/runtime-targets.module';
import {CapabilityInvocationsService} from './capability-invocations.service';
import {CapabilityInvocationsController} from './capability-invocations.controller';
@Module({imports:[RuntimeTargetsModule,CapabilityResolverModule],controllers:[CapabilityInvocationsController,RuntimeResultsController],providers:[CapabilityInvocationsService,RuntimeTasksService,RuntimeResultsService],exports:[CapabilityInvocationsService,RuntimeResultsService]})
export class CapabilityInvocationsModule {}
