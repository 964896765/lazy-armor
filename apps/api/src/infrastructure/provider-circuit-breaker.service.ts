import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorError } from '@lazy-armor/connector-sdk';
import IORedis from 'ioredis';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

@Injectable()
export class ProviderCircuitBreakerService implements OnApplicationShutdown {
  private readonly redis: IORedis;
  private readonly keyPrefix: string;

  constructor(config: ConfigService) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    this.keyPrefix = config.get<string>('REDIS_KEY_PREFIX') ? config.get<string>('REDIS_KEY_PREFIX') + ':' : '';
  }

  async beforeRequest(provider: string, cooldownMs = 30_000): Promise<{ state: CircuitState }> {
    await this.ensureConnected();
    const key = this.stateKey(provider);
    const openedAtValue = await this.redis.hget(key, 'openedAt');
    if (!openedAtValue) return { state: 'CLOSED' };
    const remaining = cooldownMs - (Date.now() - Number(openedAtValue));
    if (remaining > 0) throw this.openError(remaining);
    const acquired = await this.redis.set(this.halfOpenKey(provider), '1', 'PX', Math.max(cooldownMs, 1000), 'NX');
    if (acquired !== 'OK') throw this.openError(Math.max(cooldownMs, 1000));
    return { state: 'HALF_OPEN' };
  }

  async recordSuccess(provider: string) {
    await this.ensureConnected();
    await this.redis.del(this.stateKey(provider), this.halfOpenKey(provider));
  }

  async recordFailure(provider: string, threshold = 5) {
    await this.ensureConnected();
    const key = this.stateKey(provider);
    const failures = await this.redis.hincrby(key, 'failures', 1);
    const alreadyOpen = await this.redis.hexists(key, 'openedAt');
    if (failures >= threshold || alreadyOpen === 1) await this.redis.hset(key, 'openedAt', String(Date.now()));
    await this.redis.expire(key, 86_400);
    await this.redis.del(this.halfOpenKey(provider));
    return { state: failures >= threshold || alreadyOpen === 1 ? 'OPEN' as const : 'CLOSED' as const, failures };
  }

  async state(provider: string): Promise<CircuitState> {
    await this.ensureConnected();
    return await this.redis.hexists(this.stateKey(provider), 'openedAt') ? 'OPEN' : 'CLOSED';
  }

  async resetForTest(provider: string) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test hook is disabled');
    await this.recordSuccess(provider);
  }

  async onApplicationShutdown() { if (this.redis.status !== 'end') await this.redis.quit(); }

  private openError(retryAfterMs: number) {
    return new ConnectorError('CIRCUIT_OPEN', 'PROVIDER_UNAVAILABLE', 'Provider circuit is open', {
      retryable: true,
      retryAfterMs,
      operationState: 'pending',
    });
  }

  private stateKey(provider: string) { return this.keyPrefix + 'circuit:' + provider; }
  private halfOpenKey(provider: string) { return this.keyPrefix + 'circuit:' + provider + ':half-open'; }
  private async ensureConnected() { if (this.redis.status === 'wait') await this.redis.connect(); }
}
