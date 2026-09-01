import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SECRET_KEYS, redactSecrets } from '@lazy-armor/shared';

const MAX_SNAPSHOT_BYTES = 16 * 1024;
const SENSITIVE_TEXT = /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+|(bearer\s+)[^\s,;]+|((?:password|token|access_token|refresh_token|api_key|authorization|cookie|credential|secret|private_key|session)\s*[=:]\s*)[^\s,;]+/gi;

// 全平台统一敏感信息清洗：Execution / Operation / Outbox / Audit / Notification 共用。
@Injectable()
export class SnapshotSanitizer {
  sanitize(value: unknown): Record<string, unknown> {
    const redacted = this.deepSanitize(redactSecrets(value));
    const serialized = JSON.stringify(redacted);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_SNAPSHOT_BYTES) {
      return (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) ? redacted as Record<string, unknown> : { value: redacted };
    }
    return { truncated: true, originalBytes: Buffer.byteLength(serialized, 'utf8'), preview: this.sanitizeText(serialized.slice(0, 4_000)) };
  }

  sanitizeText(value: unknown): string {
    const text = value instanceof Error ? value.message : String(value ?? 'Unknown error');
    return text.replace(SENSITIVE_TEXT, (_match, authorizationBearerPrefix: string | undefined, bearerPrefix: string | undefined, keyPrefix: string | undefined) => `${authorizationBearerPrefix ?? bearerPrefix ?? keyPrefix ?? ''}[REDACTED]`).slice(0, 1000);
  }

  hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(this.sanitize(value))).digest('hex');
  }

  private deepSanitize(value: unknown): unknown {
    if (typeof value === 'string') return this.sanitizeText(value);
    if (Array.isArray(value)) return value.map((item) => this.deepSanitize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          SECRET_KEYS.test(key) ? '[REDACTED]' : this.deepSanitize(item),
        ]),
      );
    }
    return value;
  }
}
