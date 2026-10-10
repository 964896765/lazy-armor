export const BETA_ROLE_PROBES = [
  { role: 'api', url: 'http://127.0.0.1:3001/api/health' },
  { role: 'execution-worker', url: 'http://127.0.0.1:3011/ready' },
  { role: 'outbox-worker', url: 'http://127.0.0.1:3012/ready' },
];

export function pageObserverSystemEnabled(enabled, services) {
  if (enabled.trim() !== '1') return false;
  return services.trim().split(':').some(component => {
    const [packageName, className, extra] = component.trim().split('/');
    return extra === undefined && packageName === 'com.lazyarmor.app' &&
      ['.ReadOnlyPageObserver', 'com.lazyarmor.app.ReadOnlyPageObserver'].includes(className);
  });
}

/** A 200 or liveness response alone is insufficient; this is not Beta acceptance. */
export function validRoleReadiness(role, status, body) {
  if (status !== 200 || !body || body.mysql !== 'ready' || body.redis !== 'PONG' || body.bullmq !== 'ready') return false;
  return role === 'api' ? body.status === 'ok' : body.role === role && body.status === 'ready' && body.worker?.ready === true;
}

export async function probeRoleReadiness(probe, fetcher = fetch) {
  try {
    const response = await fetcher(probe.url, { signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store' });
    const text = await response.text();
    if (text.length > 32768) return { ...probe, status: response.status, ready: false, reason: 'INVALID_READINESS' };
    const body = JSON.parse(text), ready = validRoleReadiness(probe.role, response.status, body);
    return { ...probe, status: response.status, ready, reason: ready ? null : 'DEPENDENCIES_NOT_READY' };
  } catch { return { ...probe, status: null, ready: false, reason: 'UNREACHABLE_OR_INVALID_RESPONSE' }; }
}
