import { describe, expect, it } from 'vitest';
import { redactSecretText, redactSecrets, scrubTelemetry } from './index';

describe('structured log redaction', () => {
  it('redacts secrets embedded in otherwise unstructured strings', () => {
    const input = 'authorization=Bearer abc.def.ghi password="hunter2" token: refresh-token secret=abc123';
    const output = redactSecretText(input);

    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('refresh-token');
    expect(output).not.toContain('abc123');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts URL passwords and nested secret fields', () => {
    const output = redactSecrets({
      database: 'mysql://service:database-password@db.internal/lazy_armor',
      nested: { accessToken: 'token-value', safe: 'visible' },
    });
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain('database-password');
    expect(serialized).not.toContain('token-value');
    expect(serialized).toContain('visible');
  });

  it('applies the same string redaction before telemetry leaves the process', () => {
    const output = JSON.stringify(scrubTelemetry({ message: 'cookie=session-value', rawBody: 'private body' }));
    expect(output).not.toContain('session-value');
    expect(output).not.toContain('private body');
  });
});
