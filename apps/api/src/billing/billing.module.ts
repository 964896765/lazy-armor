import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FileImportService } from './file-import.service';
import { AuditModule } from '../audit/audit.module';
import { FileImportController } from './file-import.controller';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [AuditModule, UsageModule],
  controllers: [BillingController, FileImportController],
  providers: [BillingService, FileImportService],
  exports: [BillingService, FileImportService],
})
export class BillingModule {}
