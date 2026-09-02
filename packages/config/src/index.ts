import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().trim().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  CREDENTIAL_MASTER_KEY: z.string().refine((value) => {
    try {
      return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'CREDENTIAL_MASTER_KEY must be a base64-encoded 32-byte key'),
  CREDENTIAL_STORE_PATH: z.string().default('.data/credentials'),
  // Auth production hardening
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  PASSWORD_RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  PUBLIC_REGISTRATION: z.enum(['true', 'false']).optional(),
  // Production credential provider selection
  CREDENTIAL_PROVIDER: z.enum(['local', 'production']).optional(),
  // CORS allowed origins (comma separated)
  ALLOWED_ORIGINS: z.string().optional(),
  WEBHOOK_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  WEBHOOK_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  WORKER_PROBE_HOST: z.string().default('127.0.0.1'),
  EXECUTION_WORKER_PROBE_PORT: z.coerce.number().int().positive().default(3011),
  OUTBOX_WORKER_PROBE_PORT: z.coerce.number().int().positive().default(3012),
  WORKER_READINESS_TIMEOUT_MS: z.coerce.number().int().min(200).max(10_000).default(3_000),
});

export type DeployEnv = 'development' | 'staging' | 'production';
export type AppEnv = Omit<z.infer<typeof envSchema>, 'APP_ENV'> & { APP_ENV: DeployEnv };

export const parseEnv = (input: NodeJS.ProcessEnv): AppEnv => {
  const parsed = envSchema.parse(input);
  return {
    ...parsed,
    APP_ENV: parsed.APP_ENV ?? (parsed.NODE_ENV === 'production' ? 'production' : 'development'),
  };
};

// 部署环境 fail-closed 配置校验：production/staging 缺少关键配置直接启动失败。
export function assertProductionSafe(env: AppEnv): void {
  const blockers: string[] = [];
  if (env.APP_ENV === 'staging' && env.NODE_ENV !== 'production') blockers.push('APP_ENV=staging requires NODE_ENV=production');
  if (env.APP_ENV === 'production' && env.NODE_ENV !== 'production') blockers.push('APP_ENV=production requires NODE_ENV=production');
  if (env.NODE_ENV === 'production' && env.APP_ENV === 'development') blockers.push('NODE_ENV=production requires APP_ENV=staging or APP_ENV=production');

  if (env.APP_ENV === 'staging' || env.APP_ENV === 'production') {
    if (isLocalTarget(env.DATABASE_URL)) blockers.push(`DATABASE_URL must not point to localhost in ${env.APP_ENV}`);
    if (isLocalTarget(env.REDIS_URL)) blockers.push(`REDIS_URL must not point to localhost in ${env.APP_ENV}`);
    if (!env.REDIS_URL.startsWith('rediss://')) blockers.push(`REDIS_URL must use TLS (rediss://) in ${env.APP_ENV}`);
    const expectedRedisPrefix = `lazy-armor-${env.APP_ENV}`;
    if (env.REDIS_KEY_PREFIX !== expectedRedisPrefix) blockers.push(`REDIS_KEY_PREFIX=${expectedRedisPrefix} is required in ${env.APP_ENV}`);
    if (env.CREDENTIAL_PROVIDER !== 'production') blockers.push(`CREDENTIAL_PROVIDER=production is required in ${env.APP_ENV}`);
    const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (origins.length === 0) blockers.push(`ALLOWED_ORIGINS must declare the ${env.APP_ENV} CORS allowlist`);
    if (origins.some((origin) => origin === '*')) blockers.push(`ALLOWED_ORIGINS must not contain "*" in ${env.APP_ENV}`);
    if (origins.some((origin) => !isHttpsOrigin(origin))) blockers.push(`ALLOWED_ORIGINS must contain valid HTTPS origins without paths in ${env.APP_ENV}`);
    if (env.JWT_SECRET.includes('replace-with') || env.JWT_SECRET.includes('inject-')) blockers.push(`JWT_SECRET must be a non-placeholder value in ${env.APP_ENV}`);
  }

  if (env.APP_ENV === 'production') {
    if (env.CREDENTIAL_MASTER_KEY.includes('replace-with')) blockers.push('CREDENTIAL_MASTER_KEY must be a non-default base64-encoded 32-byte key');
  }

  if (blockers.length) {
    throw new Error(`Environment validation failed (${env.APP_ENV}):\n- ${blockers.join('\n- ')}`);
  }
}

// 生产默认关闭公开注册；development/test 默认开启，便于本地与测试。
export function resolvePublicRegistration(env: AppEnv): boolean {
  if (env.PUBLIC_REGISTRATION !== undefined) return env.PUBLIC_REGISTRATION === 'true';
  return env.NODE_ENV !== 'production';
}

function isLocalTarget(value: string) {
  return value.includes('127.0.0.1')
    || value.includes('localhost')
    || value.includes('::1')
    || value.includes('10.0.2.2');
}

function isHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && url.hostname.length > 0;
  } catch {
    return false;
  }
}
