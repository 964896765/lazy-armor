import { Module } from '@nestjs/common';
import { ServicesCatalogController } from './services-catalog.controller';
import { ServicesCatalogService } from './services-catalog.service';
import { AuditModule } from '../audit/audit.module';
import { ServiceMediaService } from './service-media.service';

@Module({ imports: [AuditModule], controllers: [ServicesCatalogController], providers: [ServicesCatalogService, ServiceMediaService] })
export class ServicesCatalogModule {}
