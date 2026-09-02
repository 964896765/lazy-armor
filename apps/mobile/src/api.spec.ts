import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiUrl } from './api';

describe('API environment resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows localhost fallback only outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    expect(resolveApiUrl()).toBe('http://127.0.0.1:3001');
  });

  it('fails closed when production build is missing EXPO_PUBLIC_API_URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    expect(() => resolveApiUrl()).toThrow(/EXPO_PUBLIC_API_URL is required in production builds/);
  });

  it.each(['http://127.0.0.1:3001', 'http://localhost:3001', 'http://api.example.com'])('rejects unsafe production API URL %s', (value) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', value);
    expect(() => resolveApiUrl()).toThrow(/localhost|HTTPS/);
  });

  it('accepts and normalizes a production HTTPS API URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.lazyarmor.example/');
    expect(resolveApiUrl()).toBe('https://api.lazyarmor.example');
  });
});
