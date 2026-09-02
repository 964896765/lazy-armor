import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// 登录/敏感端点速率限制：IP + account 双维度，Redis 固定窗口计数。
@Injectable()
export class RateLimiterService implements OnApplicationShutdown {
  private readonly redis: IORedis;
  private readonly keyPrefix: string;

  constructor(config: ConfigService) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    const prefix = config.get<string>('REDIS_KEY_PREFIX');
    this.keyPrefix = prefix ? `${prefix}:` : '';
  }

  private async ensureConnected() {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    await this.ensureConnected();
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `${this.keyPrefix}ratelimit:${key}:${Math.floor(now / windowSeconds)}`;
    const count = await this.redis.incr(windowKey);
    if (count === 1) await this.redis.expire(windowKey, windowSeconds + 1);
    if (count > limit) {
      const ttl = await this.redis.ttl(windowKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async failureCount(key: string, windowSeconds: number): Promise<number> {
    await this.ensureConnected();
    const failureKey = `${this.keyPrefix}failures:${key}`;
    const count = await this.redis.incr(failureKey);
    if (count === 1) await this.redis.expire(failureKey, windowSeconds);
    return count;
  }

  async resetFailures(key: string): Promise<void> {
    await this.ensureConnected();
    await this.redis.del(`${this.keyPrefix}failures:${key}`);
  }

  async onApplicationShutdown() {
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
