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
    const key = this.metricKey(name, tags);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
    this.remember({ type: 'counter', name, value, tags, recordedAt: new Date().toISOString() });
  }

  gauge(name: string, value: number, tags: Record<string, string> = {}) {
    const key = this.metricKey(name, tags);
    this.gauges.set(key, value);
    this.remember({ type: 'gauge', name, value, tags, recordedAt: new Date().toISOString() });
  }

  histogram(name: string, value: number, tags: Record<string, string> = {}) {
    this.remember({ type: 'histogram', name, value, tags, recordedAt: new Date().toISOString() });
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
}
