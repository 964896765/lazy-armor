import { describe, expect, it } from 'vitest';
import { scrubTelemetry } from '@lazy-armor/shared';
import { SafeLoggerService } from '../src/common/safe-logger.service';
import { extendRequestContext } from '../src/common/request-context';
import { ObservabilityService } from '../src/observability/observability.service';

describe('P4 observability foundation', () => {
  it('scrubs telemetry secrets and raw payload fields', () => {
    expect(scrubTelemetry({
      correlationId: 'corr-1',
      accessToken: 'secret-token',
      webhookPayload: { raw: 'very secret' },
      emailBody: 'mail body',
      fileContent: 'file bytes',
    })).toEqual({
      correlationId: 'corr-1',
      accessToken: '[REDACTED]',
      webhookPayload: '[REDACTED]',
      emailBody: '[REDACTED]',
      fileContent: '[REDACTED]',
    });
  });

  it('includes merged request context in structured logs without leaking secrets', () => {
    const lines: string[] = [];
    const logger = new SafeLoggerService().useSink({
      log: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    });

    extendRequestContext({
      correlationId: 'corr-123',
      requestId: 'req-123',
      executionId: 'exec-123',
      executionStepId: 'step-1',
      sideEffectOperationId: 'op-1',
      connectorKey: 'gmail',
      workerId: 'outbox-42',
      attempt: 2,
      takeover: true,
      redelivery: true,
      routeTemplate: '/api/plans/:id',
    }, () => {
      logger.event('log', 'provider_call_failed', {
        accessToken: 'token-value',
        webhookPayload: { raw: 'payload' },
      });
    });

    const record = JSON.parse(lines[0] ?? '{}');
    expect(record).toMatchObject({
      correlationId: 'corr-123',
      requestId: 'req-123',
      executionId: 'exec-123',
      executionStepId: 'step-1',
      sideEffectOperationId: 'op-1',
      connectorKey: 'gmail',
      workerId: 'outbox-42',
      attempt: 2,
      takeover: true,
      redelivery: true,
      routeTemplate: '/api/plans/:id',
      event: 'provider_call_failed',
      accessToken: '[REDACTED]',
      webhookPayload: '[REDACTED]',
    });
  });

  it('rejects sensitive and high-cardinality metric tags', () => {
    const logger = new SafeLoggerService().useSink({ log() {}, warn() {}, error() {} });
    const telemetry = new ObservabilityService(logger);

    telemetry.increment('connector.calls', 1, {
      connectorKey: 'gmail',
      capability: 'SEND_EMAIL',
      operation: 'execute',
      userId: 'user-1',
      executionId: '95fd5cfc-0d62-4859-bdf0-f35f9f944122',
      errorCode: 'TIMEOUT',
      rawUrl: 'https://example.com/users/123?token=secret',
    } as Record<string, string>);

    const point = telemetry.snapshot().recent.find((item) => item.name === 'connector.calls');
    expect(point?.tags).toEqual({
      connectorKey: 'gmail',
      capability: 'SEND_EMAIL',
      operation: 'execute',
    });
  });

  it('records counters, gauges, and histograms through the abstraction', () => {
    const logger = new SafeLoggerService().useSink({ log() {}, warn() {}, error() {} });
    const telemetry = new ObservabilityService(logger);

    telemetry.increment('api.request_count', 1, { method: 'GET' });
    telemetry.gauge('queue.waiting', 4, { queue: 'lazy-armor-executions' });
    telemetry.histogram('connector.duration', 120, { connectorKey: 'gmail', capability: 'SEND_EMAIL', operation: 'execute' });
    telemetry.increment('connector.calls', 1, { connectorKey: 'gmail', capability: 'SEND_EMAIL', operation: 'execute' });

    const snapshot = telemetry.snapshot();
    expect(snapshot.counters.some((item) => item.key.includes('api.request_count'))).toBe(true);
    expect(snapshot.counters.some((item) => item.key.includes('connector.calls'))).toBe(true);
    expect(snapshot.gauges.some((item) => item.key.includes('queue.waiting'))).toBe(true);
    expect(snapshot.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'connector.duration', type: 'histogram', value: 120 }),
    ]));
  });
});
