import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { AiProviderConfigController } from './ai-provider-config.controller';
import { AiProviderConfigService } from './ai-provider-config.service';
@Module({ imports: [CredentialsModule], controllers: [AiProviderConfigController], providers: [AiProviderConfigService], exports: [AiProviderConfigService] })
export class AiProviderConfigModule {}
