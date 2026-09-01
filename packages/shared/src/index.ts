import { v7 as uuidv7 } from 'uuid';

export const newId = (): string => uuidv7();

export const SECRET_KEYS = /password|token|secret|api[-_]?key|authorization|credential|cookie|session|private[-_]?key/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEYS.test(key) ? '[REDACTED]' : redactSecrets(item),
      ]),
    );
  }
  return value;
}

export type UserStatus = 'active' | 'disabled';
export type ConnectionStatus = 'connected' | 'degraded' | 'expired' | 'revoked' | 'error';
