import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PermissionsService } from './permissions.service';

@Module({ imports: [AuditModule], providers: [PermissionsService], exports: [PermissionsService] })
export class PermissionsModule {}
