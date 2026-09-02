import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PermissionsService } from './permissions.service';
import { ConnectorsModule } from '../connectors/connectors.module';

@Module({ imports: [AuditModule, ConnectorsModule], providers: [PermissionsService], exports: [PermissionsService] })
export class PermissionsModule {}
