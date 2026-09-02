import { describe, expect, it, vi } from 'vitest';
import { ConsoleSanitizedCrashReporter, createCrashReporter, sanitizeCrashContext } from './crash-reporter';

describe('crash reporter', () => {
  it('redacts forbidden keys from crash context', () => {
    expect(sanitizeCrashContext({
      correlationId: 'corr-1',
      accessToken: 'secret-token',
      nested: {
        password: 'pw',
        connectorKey: 'gmail',
      },
    })).toEqual({
      correlationId: 'corr-1',
      accessToken: '[REDACTED]',
      nested: {
        password: '[REDACTED]',
        connectorKey: 'gmail',
      },
    });
  });

  it('logs sanitized exceptions without leaking tokens', () => {
    const sink = { error: vi.fn(), log: vi.fn() };
    const reporter = new ConsoleSanitizedCrashReporter(sink);

    reporter.captureException(new Error('network failed'), {
      executionId: 'exec-1',
      refreshToken: 'refresh-secret',
    });

    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.error.mock.calls[0][1])).not.toContain('refresh-secret');
    expect(JSON.stringify(sink.error.mock.calls[0][1])).toContain('[REDACTED]');
  });

  it('creates a noop reporter by default', () => {
    expect(createCrashReporter()).toMatchObject({
      captureException: expect.any(Function),
      captureMessage: expect.any(Function),
    });
  });
});
