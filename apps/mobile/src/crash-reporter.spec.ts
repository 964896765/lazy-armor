import { describe, expect, it, vi } from 'vitest';
import { ConsoleSanitizedCrashReporter, createCrashBoundaryHandler, createCrashReporter, sanitizeCrashContext } from './crash-reporter';

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

  it('creates a crash boundary handler that merges and redacts context', () => {
    const sink = { error: vi.fn(), log: vi.fn() };
    const reporter = new ConsoleSanitizedCrashReporter(sink);
    const boundary = createCrashBoundaryHandler(reporter, { planId: 'plan-1', payload: 'secret-payload' });

    boundary(new Error('boom'), { executionId: 'exec-1', emailBody: 'private mail' });

    const serialized = JSON.stringify(sink.error.mock.calls[0][1]);
    expect(serialized).toContain('plan-1');
    expect(serialized).toContain('exec-1');
    expect(serialized).not.toContain('secret-payload');
    expect(serialized).not.toContain('private mail');
    expect(serialized).toContain('[REDACTED]');
  });
});
