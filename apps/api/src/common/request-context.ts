import { AsyncLocalStorage } from 'node:async_hooks';
import { newId } from '@lazy-armor/shared';

export interface RequestContext {
  correlationId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return requestContext.run(context, work);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function resolveCorrelationId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate)) return candidate;
  return newId();
}
