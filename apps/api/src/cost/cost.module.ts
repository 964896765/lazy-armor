import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsageModule } from '../usage/usage.module';
import { CostController } from './cost.controller';
import { CostService } from './cost.service';

@Module({
  imports: [AuditModule, UsageModule],
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}
