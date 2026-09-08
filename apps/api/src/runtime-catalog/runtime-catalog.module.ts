import { Module } from '@nestjs/common';
import { ProviderCapabilitiesModule } from '../provider-capabilities/provider-capabilities.module';
import { RuntimeCatalogController } from './runtime-catalog.controller';
import { RuntimeCatalogRegistryService } from './runtime-catalog-registry.service';

@Module({ imports: [ProviderCapabilitiesModule], controllers: [RuntimeCatalogController], providers: [RuntimeCatalogRegistryService], exports: [RuntimeCatalogRegistryService] })
export class RuntimeCatalogModule {}
