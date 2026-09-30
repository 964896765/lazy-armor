import { describe, expect, it } from 'vitest';
import { normalizeLoginIdentifier } from './login-identifier';

describe('normalize login identifier', () => {
  it('maps the fixed local admin alias only in development', () => {
    expect(normalizeLoginIdentifier(' Admin ', 'development')).toBe('admin@lazyarmor.local');
    expect(normalizeLoginIdentifier('admin', 'staging')).toBe('admin');
    expect(normalizeLoginIdentifier('admin', 'production')).toBe('admin');
  });

  it('normalizes regular email input', () => {
    expect(normalizeLoginIdentifier(' USER@Example.COM ', 'development')).toBe('user@example.com');
  });
});
