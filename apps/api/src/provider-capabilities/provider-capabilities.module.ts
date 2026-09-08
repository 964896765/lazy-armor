import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database.module';
import { CapabilityUsabilityService } from './capability-usability.service';
import { ConnectionCapabilityController, ProviderCapabilitiesController } from './provider-capabilities.controller';
import { ProviderCapabilityRegistryService } from './provider-capability-registry.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ProviderCapabilitiesController, ConnectionCapabilityController],
  providers: [ProviderCapabilityRegistryService, CapabilityUsabilityService],
  exports: [ProviderCapabilityRegistryService, CapabilityUsabilityService],
})
export class ProviderCapabilitiesModule {}
