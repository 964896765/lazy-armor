import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PermissionsService } from './permissions.service';
import { ConnectorsModule } from '../connectors/connectors.module';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({ imports: [AuditModule, ConnectorsModule, CredentialsModule], providers: [PermissionsService], exports: [PermissionsService] })
export class PermissionsModule {}
