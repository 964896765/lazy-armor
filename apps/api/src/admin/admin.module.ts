import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import { AdminController } from './admin.controller';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [AuditModule, DiagnosticsModule],
  controllers: [AdminController],
  providers: [RolesGuard, { provide: APP_GUARD, useClass: RolesGuard }],
})
export class AdminModule {}
