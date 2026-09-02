import { AsyncLocalStorage } from 'node:async_hooks';
import { newId } from '@lazy-armor/shared';

export interface RequestContext {
  correlationId: string;
  requestId?: string | null;
  userId?: string | null;
  planId?: string | null;
  planVersionId?: string | null;
  executionId?: string | null;
  executionStepId?: string | null;
  sideEffectOperationId?: string | null;
  connectorKey?: string | null;
  errorCode?: string | null;
  method?: string | null;
  routeTemplate?: string | null;
  workerId?: string | null;
  attempt?: number | null;
  takeover?: boolean | null;
  redelivery?: boolean | null;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return requestContext.run(context, work);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function extendRequestContext<T>(patch: Partial<RequestContext>, work: () => T): T {
  const current = requestContext.getStore();
  const next: RequestContext = {
    correlationId: patch.correlationId ?? current?.correlationId ?? newId(),
    requestId: patch.requestId ?? current?.requestId ?? null,
    userId: patch.userId ?? current?.userId ?? null,
    planId: patch.planId ?? current?.planId ?? null,
    planVersionId: patch.planVersionId ?? current?.planVersionId ?? null,
    executionId: patch.executionId ?? current?.executionId ?? null,
    executionStepId: patch.executionStepId ?? current?.executionStepId ?? null,
    sideEffectOperationId: patch.sideEffectOperationId ?? current?.sideEffectOperationId ?? null,
    connectorKey: patch.connectorKey ?? current?.connectorKey ?? null,
    errorCode: patch.errorCode ?? current?.errorCode ?? null,
    method: patch.method ?? current?.method ?? null,
    routeTemplate: patch.routeTemplate ?? current?.routeTemplate ?? null,
    workerId: patch.workerId ?? current?.workerId ?? null,
    attempt: patch.attempt ?? current?.attempt ?? null,
    takeover: patch.takeover ?? current?.takeover ?? null,
    redelivery: patch.redelivery ?? current?.redelivery ?? null,
  };
  return requestContext.run(next, work);
}

export function resolveCorrelationId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate)) return candidate;
  return newId();
}
