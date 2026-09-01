import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RateLimiterService } from './rate-limiter.service';

export const EXECUTION_QUEUE_SERVICE = 'EXECUTION_QUEUE_SERVICE';

@Global()
@Module({
  providers: [QueueService, RateLimiterService, { provide: EXECUTION_QUEUE_SERVICE, useExisting: QueueService }],
  exports: [QueueService, EXECUTION_QUEUE_SERVICE, RateLimiterService],
})
export class InfrastructureModule {}
