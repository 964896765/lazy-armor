import { adminConfig, backendRequest, verifyAdminSession, type AdminEnvironment, type AdminUser } from './admin-auth';

export type EndpointResult<T> = { data: T | null; error: string | null };

export type OperationsDashboardSnapshot = {
  overview: EndpointResult<unknown>;
  workers: EndpointResult<unknown>;
  outbox: EndpointResult<unknown>;
  executions: EndpointResult<unknown>;
  connectors: EndpointResult<unknown>;
  alerts: EndpointResult<unknown>;
  diagnostics: EndpointResult<unknown>;
};

const endpoints = {
  overview: '/api/admin/operations/overview',
  workers: '/api/admin/operations/workers',
  outbox: '/api/admin/operations/outbox',
  executions: '/api/admin/operations/executions',
  connectors: '/api/admin/operations/connectors',
  alerts: '/api/admin/operations/alerts',
  diagnostics: '/api/admin/diagnostics',
} as const;

export type DashboardResult = { state: 'ready'; user: AdminUser; snapshot: OperationsDashboardSnapshot }
  | { state: 'unauthenticated' | 'forbidden' | 'unavailable' };

export async function loadOperationsDashboard(
  accessToken: string | undefined,
  fetcher: typeof fetch = fetch,
  environment: AdminEnvironment = process.env,
): Promise<DashboardResult> {
  const config = adminConfig(environment);
  const session = await verifyAdminSession(accessToken, config, fetcher);
  if (session.state !== 'authenticated') return session;
  if (!config || !accessToken) return { state: 'unavailable' };

  const entries = await Promise.all(Object.entries(endpoints).map(async ([key, path]) => {
    const result = await fetchEndpoint(fetcher, config, path, accessToken);
    return [key, result] as const;
  }));

  // A role/session can change after verification. Never return a partial sensitive
  // snapshot if any protected read observes loss of authority.
  if (entries.some(([, result]) => result.status === 401)) return { state: 'unauthenticated' };
  if (entries.some(([, result]) => result.status === 403)) return { state: 'forbidden' };
  const snapshot = Object.fromEntries(entries.map(([key, { data, error }]) => [key, { data, error }])) as OperationsDashboardSnapshot;
  return { state: 'ready', user: session.user, snapshot };
}

async function fetchEndpoint(fetcher: typeof fetch, config: NonNullable<ReturnType<typeof adminConfig>>, path: string, accessToken: string): Promise<EndpointResult<unknown> & { status?: number }> {
  try {
    const response = await backendRequest(config, path, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    }, fetcher);
    if (!response.ok) return { data: null, error: `HTTP ${response.status}`, status: response.status };
    return { data: await response.json(), error: null };
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError' ? '请求超时' : 'API 不可达';
    return { data: null, error: message };
  }
}
