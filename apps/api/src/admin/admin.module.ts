import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { ExecutionModule } from '../execution/execution.module';
import { AdminController } from './admin.controller';
import { AdminOperationsService } from './admin-operations.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [AuditModule, DiagnosticsModule, ConnectorsModule, ExecutionModule],
  controllers: [AdminController],
  providers: [AdminOperationsService, RolesGuard, { provide: APP_GUARD, useClass: RolesGuard }],
  exports: [AdminOperationsService],
})
export class AdminModule {}
