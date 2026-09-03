import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareEntrypointRole } from '../src/entrypoints/prepare-app-role';

describe('prepareEntrypointRole', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('assigns the entrypoint role for local development when no role is configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_ROLE', '');
    prepareEntrypointRole('api');
    expect(process.env.APP_ROLE).toBe('api');
  });

  it('leaves a missing production role untouched for configuration validation to reject', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ROLE', '');
    prepareEntrypointRole('execution-worker');
    expect(process.env.APP_ROLE).toBe('');
  });

  it('rejects a role that does not match the selected entrypoint', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ROLE', 'outbox-worker');
    expect(() => prepareEntrypointRole('execution-worker')).toThrow('Entrypoint for execution-worker cannot run with APP_ROLE=outbox-worker');
  });
});
