import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({ imports: [AuditModule], controllers: [OperationsController], providers: [OperationsService], exports: [OperationsService] })
export class OperationsModule {}
