import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiUrl, resolveAppEnv } from './api';

describe('API environment resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows localhost fallback only outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    expect(resolveApiUrl()).toBe('http://127.0.0.1:3001');
  });

  it('fails closed when staging build is missing EXPO_PUBLIC_API_URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'staging');
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    expect(() => resolveApiUrl()).toThrow(/EXPO_PUBLIC_API_URL is required in staging builds/);
  });

  it.each(['http://127.0.0.1:3001', 'http://localhost:3001', 'http://api.example.com'])('rejects unsafe production API URL %s', (value) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', value);
    expect(() => resolveApiUrl()).toThrow(/localhost|HTTPS/);
  });

  it('accepts and normalizes a production HTTPS API URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.lazyarmor.example/');
    expect(resolveApiUrl()).toBe('https://api.lazyarmor.example');
  });

  it('defaults APP_ENV from NODE_ENV when not explicitly configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', '');
    expect(resolveAppEnv()).toBe('production');
  });

  it('treats staging as a production-mode deployment environment', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'staging');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://staging-api.lazyarmor.example/');
    expect(resolveAppEnv()).toBe('staging');
    expect(resolveApiUrl()).toBe('https://staging-api.lazyarmor.example');
  });
});
