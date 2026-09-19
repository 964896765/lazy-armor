import { Module } from '@nestjs/common';
import { ProviderCapabilitiesModule } from '../provider-capabilities/provider-capabilities.module';
import { RuntimeCatalogController } from './runtime-catalog.controller';
import { RuntimeCatalogRegistryService } from './runtime-catalog-registry.service';
import { ReadinessEvidenceService } from './readiness-evidence.service';

@Module({ imports: [ProviderCapabilitiesModule], controllers: [RuntimeCatalogController], providers: [RuntimeCatalogRegistryService, ReadinessEvidenceService], exports: [RuntimeCatalogRegistryService, ReadinessEvidenceService] })
export class RuntimeCatalogModule {}
