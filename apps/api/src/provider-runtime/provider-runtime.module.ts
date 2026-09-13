import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ExecutionModule } from '../execution/execution.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ProviderCapabilitiesModule } from '../provider-capabilities/provider-capabilities.module';
import { ConnectionProviderRuntimeController, ProviderRuntimeController } from './provider-runtime.controller';
import { ProviderRuntimeService } from './provider-runtime.service';
@Module({ imports: [DatabaseModule, CredentialsModule, ExecutionModule, PermissionsModule, ProviderCapabilitiesModule],
  controllers: [ProviderRuntimeController, ConnectionProviderRuntimeController], providers: [ProviderRuntimeService], exports: [ProviderRuntimeService] })
export class ProviderRuntimeModule {}
