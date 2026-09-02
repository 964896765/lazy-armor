import { Global, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SafeLoggerService } from '../common/safe-logger.service';
import { ObservabilityService } from './observability.service';
import { OperationalAlertsService } from './operational-alerts.service';

@Global()
@Module({
  imports: [AdminModule],
  providers: [SafeLoggerService, ObservabilityService, OperationalAlertsService],
  exports: [SafeLoggerService, ObservabilityService, OperationalAlertsService],
})
export class ObservabilityModule {}
