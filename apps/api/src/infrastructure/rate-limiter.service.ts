import { HttpException, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { connectRequestRedis, createRequestRedis } from './request-redis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// 登录/敏感端点速率限制：IP + account 双维度，Redis 固定窗口计数。
@Injectable()
export class RateLimiterService implements OnApplicationShutdown {
  private redis: IORedis;
  private readonly redisUrl: string;
  private readonly keyPrefix: string;

  constructor(config: ConfigService) {
    this.redisUrl=config.getOrThrow<string>('REDIS_URL');
    this.redis = createRequestRedis(this.redisUrl);
    const prefix = config.get<string>('REDIS_KEY_PREFIX');
    this.keyPrefix = prefix ? `${prefix}:` : '';
  }

  private async guarded<T>(work:(client:IORedis)=>Promise<T>) {
    const client=this.redis;
    try { await connectRequestRedis(client);return await work(client); }
    catch { client.disconnect();if(this.redis===client)this.redis=createRequestRedis(this.redisUrl);throw new HttpException({code:'RATE_LIMIT_SERVICE_UNAVAILABLE',message:'请求限制服务暂不可用，请稍后重试。'},503); }
  }

  async consume(key: string, limit: number, windowSeconds: number, quantity = 1): Promise<RateLimitResult> {
    if (![limit, windowSeconds, quantity].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000)) throw new Error('Invalid rate limit budget');
    return this.guarded(async client=>{
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `${this.keyPrefix}ratelimit:${key}:${Math.floor(now / windowSeconds)}`;
    // Counter and expiry are one atomic operation, including weighted quota units.
    const result = await client.eval("local n=redis.call('INCRBY',KEYS[1],ARGV[1]); if n==tonumber(ARGV[1]) then redis.call('EXPIRE',KEYS[1],ARGV[2]); end; return {n,redis.call('TTL',KEYS[1])}", 1, windowKey, quantity, windowSeconds + 1) as [number,number];
    const count = Number(result[0]);
    if(!Number.isSafeInteger(count)||count<=0||!Number.isSafeInteger(Number(result[1]))||Number(result[1])<0)throw new Error('Invalid limiter response');
    if (count > limit) {
      const ttl = Number(result[1]);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
    });
  }

  async failureCount(key: string, windowSeconds: number): Promise<number> {
    return this.guarded(async client=>{
    const failureKey = `${this.keyPrefix}failures:${key}`;
    return Number(await client.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",1,failureKey,windowSeconds));
    });
  }

  async resetFailures(key: string): Promise<void> {
    await this.guarded(client=>client.del(`${this.keyPrefix}failures:${key}`));
  }

  async onApplicationShutdown() {
    this.redis.disconnect();
  }
}
