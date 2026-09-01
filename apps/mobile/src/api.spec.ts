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
});
