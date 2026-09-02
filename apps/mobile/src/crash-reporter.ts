const FORBIDDEN_KEYS = /token|credential|password|secret|payload|emailBody|fileContent|refresh/i;

export interface CrashContext {
  correlationId?: string;
  userId?: string;
  planId?: string;
  planVersionId?: string;
  executionId?: string;
  executionStepId?: string;
  sideEffectOperationId?: string;
  connectorKey?: string;
  errorCode?: string;
  [key: string]: unknown;
}

export interface CrashReporter {
  captureException(error: unknown, context?: CrashContext): void;
  captureMessage(message: string, context?: CrashContext): void;
}

export type CrashBoundaryHandler = (error: unknown, extraContext?: CrashContext) => void;

export function sanitizeCrashContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeCrashContext);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        FORBIDDEN_KEYS.test(key) ? '[REDACTED]' : sanitizeCrashContext(item),
      ]),
    );
  }
  return value;
}

export class NoopCrashReporter implements CrashReporter {
  captureException(_error: unknown, _context?: CrashContext): void {}
  captureMessage(_message: string, _context?: CrashContext): void {}
}

export class ConsoleSanitizedCrashReporter implements CrashReporter {
  constructor(private readonly sink: Pick<Console, 'error' | 'log'> = console) {}

  captureException(error: unknown, context?: CrashContext): void {
    this.sink.error('[crash]', {
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      context: sanitizeCrashContext(context ?? {}),
    });
  }

  captureMessage(message: string, context?: CrashContext): void {
    this.sink.log('[crash-message]', {
      message,
      context: sanitizeCrashContext(context ?? {}),
    });
  }
}

export function createCrashReporter(mode: 'noop' | 'console' = 'noop'): CrashReporter {
  return mode === 'console' ? new ConsoleSanitizedCrashReporter() : new NoopCrashReporter();
}

export function createCrashBoundaryHandler(reporter: CrashReporter, baseContext: CrashContext = {}): CrashBoundaryHandler {
  return (error: unknown, extraContext: CrashContext = {}) => {
    reporter.captureException(error, {
      boundary: 'mobile-ui',
      ...baseContext,
      ...extraContext,
    });
  };
}
