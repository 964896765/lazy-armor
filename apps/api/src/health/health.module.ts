import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import { HealthController } from './health.controller';

@Module({ imports: [CredentialsModule, DiagnosticsModule], controllers: [HealthController] })
export class HealthModule {}
