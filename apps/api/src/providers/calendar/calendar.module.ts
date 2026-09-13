import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../../connections/connections.module';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { RealityPipelineModule } from '../../reality-pipeline/reality-pipeline.module';
import { GoogleTransportModule } from '../google/google-transport.module';
import { GoogleCalendarService } from './calendar.service';
import { GoogleCalendarController } from './calendar.controller';
@Module({ imports: [ConnectionsModule, ConnectorsModule, ProviderRuntimeModule, RealityPipelineModule, GoogleTransportModule],
  controllers: [GoogleCalendarController], providers: [GoogleCalendarService], exports: [GoogleCalendarService] })
export class GoogleCalendarModule {}
