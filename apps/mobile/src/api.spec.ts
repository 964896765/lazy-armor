import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, resolveApiUrl, resolveAppEnv } from './api';

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
describe('request deadlines', () => {
 afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
 it('waits for a committed refresh rotation instead of abandoning its response after three seconds', async () => {
  vi.useFakeTimers(); let requestSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init) => { requestSignal = init.signal; return new Promise(resolve => setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' }) }), 5000)); }));
  const result = api('/auth/refresh', undefined, { method: 'POST' });
  await vi.advanceTimersByTimeAsync(4000); expect(requestSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
 });
 it('allows a slow AI response beyond the ordinary request deadline', async () => {
  vi.useFakeTimers(); let requestSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init) => { requestSignal = init.signal; return new Promise(resolve => setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ answer: 'ready' }) }), 5000)); }));
  const result = api('/conversations/test/messages', 'test-token', { method: 'POST' });
  await vi.advanceTimersByTimeAsync(4000); expect(requestSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual({ answer: 'ready' });
 });
 it('still aborts an ordinary stalled request', async () => {
  vi.useFakeTimers(); let requestSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init) => { requestSignal = init.signal; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))); }));
  const result = api('/timeline', 'test-token').catch(error => error.message);
  await vi.advanceTimersByTimeAsync(3000); expect(requestSignal?.aborted).toBe(true); expect(await result).toBe('aborted');
 });
});
