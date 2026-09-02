import { describe, expect, it } from 'vitest';
import { assertProductionSafe, parseEnv, resolvePublicRegistration } from './index';

const key = Buffer.alloc(32, 17).toString('base64');

function deployedEnv(appEnv: 'staging' | 'production') {
  return {
    NODE_ENV: 'production',
    APP_ENV: appEnv,
    DATABASE_URL: `mysql://service:secret@${appEnv}-db.internal:3306/lazy_armor_${appEnv}`,
    REDIS_URL: `rediss://${appEnv}-redis.internal:6379/0`,
    REDIS_KEY_PREFIX: `lazy-armor-${appEnv}`,
    JWT_SECRET: `${appEnv}-jwt-secret-${'x'.repeat(40)}`,
    CREDENTIAL_MASTER_KEY: key,
    CREDENTIAL_PROVIDER: 'production',
    ALLOWED_ORIGINS: `https://${appEnv}.lazyarmor.example`,
  } satisfies NodeJS.ProcessEnv;
}

describe('deployment environment isolation', () => {
  it.each(['staging', 'production'] as const)('accepts an isolated %s configuration', (appEnv) => {
    expect(() => assertProductionSafe(parseEnv(deployedEnv(appEnv)))).not.toThrow();
  });

  it.each(['staging', 'production'] as const)('requires the exact Redis namespace for %s', (appEnv) => {
    const input = deployedEnv(appEnv);
    input.REDIS_KEY_PREFIX = appEnv === 'staging' ? 'lazy-armor-production' : 'lazy-armor-staging';
    expect(() => assertProductionSafe(parseEnv(input))).toThrow(new RegExp(`REDIS_KEY_PREFIX=lazy-armor-${appEnv}`));
  });

  it.each(['staging', 'production'] as const)('rejects local or plaintext Redis for %s', (appEnv) => {
    expect(() => assertProductionSafe(parseEnv({ ...deployedEnv(appEnv), REDIS_URL: 'redis://127.0.0.1:6379' })))
      .toThrow(/must not point to localhost/);
    expect(() => assertProductionSafe(parseEnv({ ...deployedEnv(appEnv), REDIS_URL: 'redis://remote.internal:6379' })))
      .toThrow(/must use TLS/);
  });

  it.each(['staging', 'production'] as const)('rejects unsafe origins and placeholder secrets for %s', (appEnv) => {
    expect(() => assertProductionSafe(parseEnv({ ...deployedEnv(appEnv), ALLOWED_ORIGINS: 'https://app.example/path' })))
      .toThrow(/valid HTTPS origins without paths/);
    expect(() => assertProductionSafe(parseEnv({ ...deployedEnv(appEnv), JWT_SECRET: `inject-${'x'.repeat(40)}` })))
      .toThrow(/non-placeholder/);
  });

  it('rejects invalid credential key material before application bootstrap', () => {
    expect(() => parseEnv({ ...deployedEnv('production'), CREDENTIAL_MASTER_KEY: 'not-a-32-byte-base64-key' }))
      .toThrow(/base64-encoded 32-byte key/);
  });

  it('keeps public registration disabled by default in deployed environments', () => {
    expect(resolvePublicRegistration(parseEnv(deployedEnv('staging')))).toBe(false);
    expect(resolvePublicRegistration(parseEnv(deployedEnv('production')))).toBe(false);
  });

  it('keeps sandbox subscription billing disabled in production', () => {
    expect(() => assertProductionSafe(parseEnv({
      ...deployedEnv('production'),
      SUBSCRIPTION_BILLING_PROVIDER: 'sandbox',
    }))).toThrow(/SUBSCRIPTION_BILLING_PROVIDER must remain disabled/);
  });
});
