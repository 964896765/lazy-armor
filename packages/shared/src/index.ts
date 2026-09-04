import { v7 as uuidv7 } from 'uuid';

export {
  SUPPORTED_DEVICE_APPS,
  supportedDeviceApp,
  type DeviceAppConnectionMode,
  type SupportedDeviceApp,
  type SupportedDeviceAppCapability,
} from './supported-device-apps';

export const newId = (): string => uuidv7();

export const SECRET_KEYS = /password|token|secret|api[-_]?key|authorization|credential|cookie|session|private[-_]?key/i;
export const TELEMETRY_SECRET_KEYS = /password|token|secret|api[-_]?key|authorization|credential|cookie|session|private[-_]?key|payload|email[-_]?body|file[-_]?content|raw[-_]?body/i;

const SECRET_ASSIGNMENT = /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|cookie|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_VALUE = /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;

export function redactSecretText(value: string): string {
  return value
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(URL_PASSWORD, '$1[REDACTED]$3');
}

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
  return typeof value === 'string' ? redactSecretText(value) : value;
}

export function scrubTelemetry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubTelemetry);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        TELEMETRY_SECRET_KEYS.test(key) ? '[REDACTED]' : scrubTelemetry(item),
      ]),
    );
  }
  return typeof value === 'string' ? redactSecretText(value) : value;
}

export type UserStatus = 'active' | 'disabled';
export type ConnectionStatus = 'connected' | 'degraded' | 'expired' | 'revoked' | 'error';
