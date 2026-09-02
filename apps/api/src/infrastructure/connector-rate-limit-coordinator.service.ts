import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorError } from '@lazy-armor/connector-sdk';
import IORedis from 'ioredis';
import { RateLimiterService } from './rate-limiter.service';

@Injectable()
export class ConnectorRateLimitCoordinator implements OnApplicationShutdown {
  private readonly redis: IORedis;
  private readonly keyPrefix: string;

  constructor(config: ConfigService, private readonly rateLimiter: RateLimiterService) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    this.keyPrefix = config.get<string>('REDIS_KEY_PREFIX') ? config.get<string>('REDIS_KEY_PREFIX') + ':' : '';
  }

  async acquire(input: { provider: string; connectionId: string; providerLimit?: number; connectionLimit?: number; windowSeconds?: number }) {
    await this.ensureConnected();
    const cooldownKey = this.cooldownKey(input.provider, input.connectionId);
    const cooldown = await this.redis.pttl(cooldownKey);
    if (cooldown > 0) throw this.rateLimited(cooldown);
    const windowSeconds = input.windowSeconds ?? 60;
    const provider = await this.rateLimiter.consume('connector:provider:' + input.provider, input.providerLimit ?? 10_000, windowSeconds);
    if (!provider.allowed) throw this.rateLimited(provider.retryAfterSeconds * 1000);
    const connection = await this.rateLimiter.consume('connector:connection:' + input.connectionId, input.connectionLimit ?? 2_000, windowSeconds);
    if (!connection.allowed) throw this.rateLimited(connection.retryAfterSeconds * 1000);
    return { allowed: true as const };
  }

  async honorRetryAfter(provider: string, connectionId: string, retryAfterMs: number) {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return;
    await this.ensureConnected();
    await this.redis.set(this.cooldownKey(provider, connectionId), '1', 'PX', Math.min(Math.ceil(retryAfterMs), 86_400_000));
  }

  backoffMs(attempt: number, retryAfterMs?: number | null, random = Math.random()) {
    const base = Math.min(60_000, 500 * (2 ** Math.max(0, attempt - 1)));
    const jittered = Math.round(base * (0.75 + Math.max(0, Math.min(1, random)) * 0.5));
    return Math.max(jittered, retryAfterMs ?? 0);
  }

  async clearForTest(provider: string, connectionId: string) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test hook is disabled');
    await this.ensureConnected();
    await this.redis.del(this.cooldownKey(provider, connectionId));
  }

  async onApplicationShutdown() { if (this.redis.status !== 'end') await this.redis.quit(); }

  private rateLimited(retryAfterMs: number) {
    return new ConnectorError('RATE_LIMITED', 'RATE_LIMITED', 'Connector rate limit coordinator delayed the operation', {
      retryable: true,
      retryAfterMs,
    });
  }

  private cooldownKey(provider: string, connectionId: string) {
    return this.keyPrefix + 'connector:cooldown:' + provider + ':' + connectionId;
  }

  private async ensureConnected() { if (this.redis.status === 'wait') await this.redis.connect(); }
}
