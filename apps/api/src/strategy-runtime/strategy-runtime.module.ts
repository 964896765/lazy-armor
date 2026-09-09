import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StrategyRuntimeController } from './strategy-runtime.controller';
import { StrategyRuntimeService } from './strategy-runtime.service';

@Module({
  imports: [AuditModule],
  controllers: [StrategyRuntimeController],
  providers: [StrategyRuntimeService],
  exports: [StrategyRuntimeService],
})
export class StrategyRuntimeModule {}
