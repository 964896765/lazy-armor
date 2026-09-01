import { Injectable, LoggerService } from '@nestjs/common';
import { redactSecrets } from '@lazy-armor/shared';

@Injectable()
export class SafeLoggerService implements LoggerService {
  constructor(private readonly sink: Pick<Console, 'log' | 'warn' | 'error'> = console) {}
  log(message: unknown, ...optional: unknown[]) { this.sink.log(redactSecrets(message), ...optional.map(redactSecrets)); }
  warn(message: unknown, ...optional: unknown[]) { this.sink.warn(redactSecrets(message), ...optional.map(redactSecrets)); }
  error(message: unknown, ...optional: unknown[]) { this.sink.error(redactSecrets(message), ...optional.map(redactSecrets)); }
}
