import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentAppRole, workerEnabled } from '../src/common/app-role';

describe('app role isolation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps the integrated mode available only when APP_ROLE is absent', () => {
    vi.stubEnv('APP_ROLE', '');
    expect(currentAppRole()).toBe('all');
    expect(workerEnabled('execution-worker')).toBe(true);
    expect(workerEnabled('outbox-worker')).toBe(true);
  });

  it('enables only the worker matching an explicit role', () => {
    vi.stubEnv('APP_ROLE', 'api');
    expect(workerEnabled('execution-worker')).toBe(false);
    expect(workerEnabled('outbox-worker')).toBe(false);

    vi.stubEnv('APP_ROLE', 'execution-worker');
    expect(workerEnabled('execution-worker')).toBe(true);
    expect(workerEnabled('outbox-worker')).toBe(false);

    vi.stubEnv('APP_ROLE', 'outbox-worker');
    expect(workerEnabled('execution-worker')).toBe(false);
    expect(workerEnabled('outbox-worker')).toBe(true);
  });

  it('rejects invalid role values instead of silently enabling every worker', () => {
    vi.stubEnv('APP_ROLE', 'all');
    expect(() => currentAppRole()).toThrow('Invalid APP_ROLE: all');
  });
});
