import { Injectable } from '@nestjs/common';
import { scrubTelemetry } from '@lazy-armor/shared';
import { extendRequestContext, type RequestContext } from '../common/request-context';
import { SafeLoggerService } from '../common/safe-logger.service';

type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricPoint {
  type: MetricType;
  name: string;
  value: number;
  tags: Record<string, string>;
  recordedAt: string;
}

const TAG_ALLOWLIST: Record<string, string[]> = {
  'api.request_count': ['method', 'statusCode'],
  'api.error_count': ['method', 'statusCode'],
  'api.duration': ['method', 'statusCode'],
  'execution.started': ['status'],
  'execution.succeeded': ['status'],
  'execution.failed': ['mode', 'errorCode', 'status'],
  'execution.duration': ['status'],
  'execution.stuck': ['source'],
  'queue.waiting': ['queue', 'source'],
  'queue.active': ['queue', 'source'],
  'queue.delayed': ['queue', 'source'],
  'queue.failed': ['queue', 'source'],
  'queue.oldest_age': ['queue', 'source'],
  'queue.enqueue_count': ['queue'],
  'queue.resume_count': ['queue'],
  'queue.error_count': ['queue', 'operation'],
  'outbox.pending': ['phase', 'source'],
  'outbox.retry_wait': ['errorCode'],
  'outbox.dead': ['reason'],
  'outbox.outcome_unknown': ['errorCode'],
  'outbox.dispatch_duration': ['connectorKey', 'capability'],
  'outbox.oldest_age': ['source'],
  'connector.calls': ['connectorKey', 'capability', 'operation'],
  'connector.success': ['connectorKey', 'capability', 'operation'],
  'connector.timeout': ['connectorKey', 'capability', 'errorCode'],
  'connector.rate_limit': ['connectorKey', 'capability', 'errorCode'],
  'connector.auth_failure': ['connectorKey', 'capability', 'errorCode'],
  'connector.provider_5xx': ['connectorKey', 'capability', 'errorCode'],
  'connector.duration': ['connectorKey', 'capability', 'operation'],
};

const FORBIDDEN_TAG_KEYS = /userId|planId|planVersionId|executionId|executionStepId|requestId|correlationId|sideEffectOperationId|email|url|path|route|errorMessage/i;
const SECRET_TAG_VALUE = /\[REDACTED\]|token|secret|password|bearer\s+[A-Za-z0-9._-]+/i;
const UUIDISH_TAG_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAILISH_TAG_VALUE = /.+@.+\..+/;
const URLISH_TAG_VALUE = /^https?:\/\//i;
const PATHISH_TAG_VALUE = /[/?#]/;

@Injectable()
export class ObservabilityService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly recent: MetricPoint[] = [];

  constructor(private readonly logger: SafeLoggerService) {}

  runWithContext<T>(patch: Partial<RequestContext>, work: () => T): T {
    return extendRequestContext(patch, work);
  }

  event(level: 'log' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
    this.logger.event(level, event, scrubTelemetry(fields) as Record<string, unknown>);
  }

  increment(name: string, value = 1, tags: Record<string, string> = {}) {
    const safeTags = this.sanitizeTags(name, tags);
    const key = this.metricKey(name, safeTags);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
    this.remember({ type: 'counter', name, value, tags: safeTags, recordedAt: new Date().toISOString() });
  }

  gauge(name: string, value: number, tags: Record<string, string> = {}) {
    const safeTags = this.sanitizeTags(name, tags);
    const key = this.metricKey(name, safeTags);
    this.gauges.set(key, value);
    this.remember({ type: 'gauge', name, value, tags: safeTags, recordedAt: new Date().toISOString() });
  }

  histogram(name: string, value: number, tags: Record<string, string> = {}) {
    const safeTags = this.sanitizeTags(name, tags);
    this.remember({ type: 'histogram', name, value, tags: safeTags, recordedAt: new Date().toISOString() });
  }

  snapshot() {
    return {
      counters: [...this.counters.entries()].map(([key, value]) => ({ key, value })),
      gauges: [...this.gauges.entries()].map(([key, value]) => ({ key, value })),
      recent: [...this.recent],
    };
  }

  private remember(point: MetricPoint) {
    this.recent.push(point);
    if (this.recent.length > 200) this.recent.shift();
  }

  private metricKey(name: string, tags: Record<string, string>) {
    const serialized = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(',');
    return serialized ? `${name}|${serialized}` : name;
  }

  private sanitizeTags(name: string, tags: Record<string, string>) {
    const allowedKeys = new Set(TAG_ALLOWLIST[name] ?? []);
    if (!allowedKeys.size) return {};
    const normalized: Record<string, string> = {};
    for (const [key, raw] of Object.entries(tags).slice(0, 6)) {
      const canonicalKey = key === 'capabilityKey' ? 'capability' : key;
      if (!allowedKeys.has(canonicalKey) || FORBIDDEN_TAG_KEYS.test(canonicalKey)) continue;
      const value = this.normalizeTagValue(canonicalKey, raw);
      if (value) normalized[canonicalKey] = value;
    }
    return normalized;
  }

  private normalizeTagValue(key: string, raw: string | undefined) {
    const value = String(scrubTelemetry(raw ?? '') ?? '').trim();
    if (!value) return null;
    if (SECRET_TAG_VALUE.test(value) || UUIDISH_TAG_VALUE.test(value) || EMAILISH_TAG_VALUE.test(value) || URLISH_TAG_VALUE.test(value)) {
      return 'redacted';
    }
    if (PATHISH_TAG_VALUE.test(value) && !['queue', 'operation', 'phase'].includes(key)) {
      return 'redacted';
    }
    if (key === 'statusCode') return /^\d{3}$/.test(value) ? value : 'unknown';
    if (key === 'method') return /^(GET|POST|PUT|PATCH|DELETE)$/i.test(value) ? value.toUpperCase() : 'UNKNOWN';
    if (key === 'connectorKey' || key === 'capability' || key === 'queue' || key === 'operation' || key === 'phase' || key === 'source' || key === 'mode' || key === 'status') {
      return /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : 'unknown';
    }
    if (key === 'errorCode' || key === 'reason') return /^[A-Z0-9_:-]{1,64}$/i.test(value) ? value : 'unknown';
    return /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : 'unknown';
  }
}
