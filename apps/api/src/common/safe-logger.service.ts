import { Injectable, LoggerService } from '@nestjs/common';
import { redactSecrets } from '@lazy-armor/shared';
import { getRequestContext } from './request-context';

type StructuredLogLevel = 'log' | 'warn' | 'error';

@Injectable()
export class SafeLoggerService implements LoggerService {
  constructor(private readonly sink: Pick<Console, 'log' | 'warn' | 'error'> = console) {}

  log(message: unknown, ...optional: unknown[]) {
    this.write('log', 'message', { message: redactSecrets(message), details: optional.map(redactSecrets) });
  }

  warn(message: unknown, ...optional: unknown[]) {
    this.write('warn', 'message', { message: redactSecrets(message), details: optional.map(redactSecrets) });
  }

  error(message: unknown, ...optional: unknown[]) {
    this.write('error', 'message', { message: redactSecrets(message), details: optional.map(redactSecrets) });
  }

  event(level: StructuredLogLevel, event: string, fields: Record<string, unknown> = {}) {
    this.write(level, event, redactSecrets(fields) as Record<string, unknown>);
  }

  private write(level: StructuredLogLevel, event: string, fields: Record<string, unknown>) {
    const context = getRequestContext();
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service: 'lazy-armor-api',
      appRole: process.env.APP_ROLE ?? 'api',
      appEnv: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
      correlationId: context?.correlationId ?? null,
      event,
      ...fields,
    };
    this.sink[level](JSON.stringify(record));
  }
}
