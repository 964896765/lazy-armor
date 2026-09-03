import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { SafeLoggerService } from '../src/common/safe-logger.service';

describe('RC-1 security log hardening', () => {
  it('never writes raw exception details through the HTTP exception boundary', () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const filter = new AllExceptionsFilter(new SafeLoggerService().useSink(sink));
    const response = {
      statusCode: 0,
      payload: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.payload = body; return this; },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    const leaked = 'SELECT * FROM users; path=C:\\srv\\app token=raw-token password=hunter2 cookie=session-value';

    filter.catch(new Error(leaked), host as never);

    const logs = JSON.stringify(sink.error.mock.calls);
    expect(response.payload).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(logs).toContain('unhandled_http_exception');
    expect(logs).not.toContain('SELECT *');
    expect(logs).not.toContain('srv');
    expect(logs).not.toContain('raw-token');
    expect(logs).not.toContain('hunter2');
    expect(logs).not.toContain('session-value');
  });

  it('redacts secrets embedded in strings written through the safe logger', () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = new SafeLoggerService().useSink(sink);

    logger.error('Bearer abc.def.ghi password=hunter2 mysql://user:db-password@db.internal/app');

    const logs = JSON.stringify(sink.error.mock.calls);
    expect(logs).not.toContain('abc.def.ghi');
    expect(logs).not.toContain('hunter2');
    expect(logs).not.toContain('db-password');
    expect(logs).toContain('[REDACTED]');
  });
});
