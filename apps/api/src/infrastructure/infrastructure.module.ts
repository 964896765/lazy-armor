import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RateLimiterService } from './rate-limiter.service';
import { ConnectorRateLimitCoordinator } from './connector-rate-limit-coordinator.service';
import { ProviderCircuitBreakerService } from './provider-circuit-breaker.service';

export const EXECUTION_QUEUE_SERVICE = 'EXECUTION_QUEUE_SERVICE';

@Global()
@Module({
  providers: [QueueService, RateLimiterService, ConnectorRateLimitCoordinator, ProviderCircuitBreakerService, { provide: EXECUTION_QUEUE_SERVICE, useExisting: QueueService }],
  exports: [QueueService, EXECUTION_QUEUE_SERVICE, RateLimiterService, ConnectorRateLimitCoordinator, ProviderCircuitBreakerService],
})
export class InfrastructureModule {}
