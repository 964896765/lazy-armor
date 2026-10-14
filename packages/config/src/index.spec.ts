import { describe, expect, it } from 'vitest';
import { assertProductionSafe, parseEnv, resolvePublicRegistration } from './index';

const key = Buffer.alloc(32, 17).toString('base64');

function deployedEnv(appEnv: 'staging' | 'production') {
  return {
    NODE_ENV: 'production',
    APP_ENV: appEnv,
    APP_ROLE: 'api',
    DATABASE_URL: `mysql://service:secret@${appEnv}-db.internal:3306/lazy_armor_${appEnv}`,
    REDIS_URL: `rediss://${appEnv}-redis.internal:6379/0`,
    REDIS_KEY_PREFIX: `lazy-armor-${appEnv}`,
    JWT_SECRET: `${appEnv}-jwt-secret-${'x'.repeat(40)}`,
    CREDENTIAL_MASTER_KEY: key,
    CREDENTIAL_PROVIDER: 'production',
    ALLOWED_ORIGINS: `https://${appEnv}.lazyarmor.example`,
    PASSWORD_RESET_DELIVERY_ENDPOINT: `https://${appEnv}-notify.lazyarmor.example/v1/messages`,
    PASSWORD_RESET_DELIVERY_TOKEN: `${appEnv}-password-reset-delivery-${'x'.repeat(40)}`,
  } satisfies NodeJS.ProcessEnv;
}

describe('deployment environment isolation', () => {
  it('keeps phone replacement and external security notices disabled until separately accepted',()=>{
    const env=parseEnv(deployedEnv('staging'));expect(env.AUTH_PHONE_CHANGE_ENABLED).toBe('false');expect(env.AUTH_SECURITY_NOTICE_SEND_ENABLED).toBe('false');
  });
  const phoneChangeEnv=()=>({...deployedEnv('staging'),AUTH_PHONE_CHANGE_ENABLED:'true',AUTH_PASSWORD_CREDENTIAL_MODE:'UNIFIED',AUTH_SECURITY_NOTICE_SEND_ENABLED:'true',AUTH_SECURITY_NOTICE_ENDPOINT:'https://notify.example.test/security',AUTH_SECURITY_NOTICE_TOKEN:'independent-notice-token-xxxxxxxxxxxxxxxxxxxx',AUTH_SECURITY_NOTICE_PHONE_TEMPLATE:'approved-phone-change',AUTH_SECURITY_NOTICE_EMAIL_TEMPLATE:'approved-email-change',SMS_LOGIN_SEND_ENABLED:'true',SMS_LOGIN_DELIVERY_ENDPOINT:'https://notify.example.test/code',LOGIN_CODE_DELIVERY_TOKEN:'independent-code-token-xxxxxxxxxxxxxxxxxxxxxx',SMS_LOGIN_TEMPLATE_ID:'approved-login',SMS_LOGIN_QUOTA_SECRET:'independent-quota-secret-xxxxxxxxxxxxxxxxxxx'});
  it('accepts a complete unified phone replacement rollout',()=>{expect(parseEnv(phoneChangeEnv()).AUTH_PHONE_CHANGE_ENABLED).toBe('true');});
  it.each(['AUTH_PASSWORD_CREDENTIAL_MODE','AUTH_SECURITY_NOTICE_SEND_ENABLED','SMS_LOGIN_SEND_ENABLED','AUTH_SECURITY_NOTICE_PHONE_TEMPLATE','AUTH_SECURITY_NOTICE_EMAIL_TEMPLATE','AUTH_SECURITY_NOTICE_TOKEN'] as const)('refuses incomplete phone replacement configuration: %s',key=>{
    const env=phoneChangeEnv();env[key]=key==='AUTH_PASSWORD_CREDENTIAL_MODE'?'LEGACY':key.endsWith('_ENABLED')?'false':'';expect(()=>parseEnv(env)).toThrow();
  });
  it.each(['http://notify.example.test','https://secret@notify.example.test','https://notify.example.test/#fragment'])('refuses unsafe security notice endpoint %s',endpoint=>{expect(()=>parseEnv({...phoneChangeEnv(),AUTH_SECURITY_NOTICE_ENDPOINT:endpoint})).toThrow();});
  it('keeps password migration opt-in and rejects unknown rollout modes',()=>{
    expect(parseEnv(deployedEnv('staging')).AUTH_PASSWORD_CREDENTIAL_MODE).toBe('LEGACY');
    expect(parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_CREDENTIAL_MODE:'SHADOW'}).AUTH_PASSWORD_CREDENTIAL_MODE).toBe('SHADOW');
    expect(parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_CREDENTIAL_MODE:'UNIFIED'}).AUTH_PASSWORD_CREDENTIAL_MODE).toBe('UNIFIED');
    expect(()=>parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_CREDENTIAL_MODE:'off'})).toThrow();
  });
  it('keeps new email binding disabled by default and validates the rollout flag',()=>{
    expect(parseEnv(deployedEnv('staging')).AUTH_EMAIL_BIND_ENABLED).toBe('false');
    expect(parseEnv({...deployedEnv('staging'),AUTH_EMAIL_BIND_ENABLED:'true'}).AUTH_EMAIL_BIND_ENABLED).toBe('true');
    expect(()=>parseEnv({...deployedEnv('staging'),AUTH_EMAIL_BIND_ENABLED:'yes'})).toThrow();
  });
  it('keeps password recovery compatibility by default and validates the bound rollout',()=>{
    expect(parseEnv(deployedEnv('staging')).AUTH_PASSWORD_RECOVERY_MODE).toBe('LEGACY');
    expect(parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_RECOVERY_MODE:'BOUND'}).AUTH_PASSWORD_RECOVERY_MODE).toBe('BOUND');
    expect(()=>parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_RECOVERY_MODE:'unsafe'})).toThrow();
    expect(parseEnv(deployedEnv('staging')).AUTH_PASSWORD_RECOVERY_REQUEST_ENABLED).toBe('true');
    expect(parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_RECOVERY_REQUEST_ENABLED:'false'}).AUTH_PASSWORD_RECOVERY_REQUEST_ENABLED).toBe('false');
    expect(()=>parseEnv({...deployedEnv('staging'),AUTH_PASSWORD_RECOVERY_REQUEST_ENABLED:'maybe'})).toThrow();
  });
  it('keeps phone binding disabled by default and validates its independent rollout flag',()=>{
    expect(parseEnv(deployedEnv('staging')).AUTH_PHONE_BIND_ENABLED).toBe('false');
    expect(parseEnv({...deployedEnv('staging'),AUTH_PHONE_BIND_ENABLED:'true'}).AUTH_PHONE_BIND_ENABLED).toBe('true');
    expect(()=>parseEnv({...deployedEnv('staging'),AUTH_PHONE_BIND_ENABLED:'yes'})).toThrow();
  });
  it('defaults real SMS off with conservative validated quotas',()=>{
    const env=parseEnv(deployedEnv('staging'));
    expect(env.SMS_LOGIN_SEND_ENABLED).toBe('false');
    expect([env.SMS_LOGIN_PHONE_DAILY_LIMIT,env.SMS_LOGIN_IP_DAILY_LIMIT,env.SMS_LOGIN_GLOBAL_DAILY_LIMIT,env.SMS_LOGIN_MAX_UNIT_COST_FEN,env.SMS_LOGIN_DAILY_BUDGET_FEN]).toEqual([5,20,100,10,1000]);
  });
  it.each(['0','-1','1.5','not-a-number'])('rejects invalid SMS budget %s',value=>{
    expect(()=>parseEnv({...deployedEnv('staging'),SMS_LOGIN_DAILY_BUDGET_FEN:value})).toThrow();
  });
  it('requires approved configuration and a stable independent quota secret for real SMS',()=>{
    const valid={...deployedEnv('staging'),SMS_LOGIN_SEND_ENABLED:'true',SMS_LOGIN_DELIVERY_ENDPOINT:'https://sms.fixture.test',LOGIN_CODE_DELIVERY_TOKEN:'gateway-fixture-token-that-is-longer-than-32',SMS_LOGIN_TEMPLATE_ID:'fixture_login',SMS_LOGIN_QUOTA_SECRET:'quota-fixture-secret-that-is-longer-than-32'};
    expect(parseEnv(valid).SMS_LOGIN_SEND_ENABLED).toBe('true');
    for(const change of [{SMS_LOGIN_DELIVERY_ENDPOINT:'http://sms.fixture.test'},{SMS_LOGIN_DELIVERY_ENDPOINT:'https://user:secret@sms.fixture.test'},{SMS_LOGIN_QUOTA_SECRET:''},{LOGIN_CODE_DELIVERY_TOKEN:'short'},{SMS_LOGIN_TEMPLATE_ID:''},{SMS_LOGIN_DAILY_BUDGET_FEN:'1'}])expect(()=>parseEnv({...valid,...change})).toThrow();
  });
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

  it.each(['staging', 'production'] as const)('requires an explicit process role for %s', (appEnv) => {
    const { APP_ROLE: _role, ...input } = deployedEnv(appEnv);
    expect(() => assertProductionSafe(parseEnv(input))).toThrow(/APP_ROLE must be explicitly set/);
  });

  it.each(['staging', 'production'] as const)('requires a complete HTTPS password reset delivery configuration for %s', (appEnv) => {
    expect(() => assertProductionSafe(parseEnv({ ...deployedEnv(appEnv), PASSWORD_RESET_DELIVERY_ENDPOINT: 'http://notify.internal/reset' })))
      .toThrow(/PASSWORD_RESET_DELIVERY_ENDPOINT must be a valid HTTPS endpoint/);
    expect(() => assertProductionSafe(parseEnv({ ...deployedEnv(appEnv), PASSWORD_RESET_DELIVERY_TOKEN: `inject-${'x'.repeat(40)}` })))
      .toThrow(/PASSWORD_RESET_DELIVERY_TOKEN must be a non-placeholder value/);
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
