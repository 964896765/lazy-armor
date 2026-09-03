export type EndpointResult<T> = { data: T | null; error: string | null };

export type OperationsDashboardSnapshot = {
  configured: boolean;
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

export async function loadOperationsDashboard(
  fetcher: typeof fetch = fetch,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OperationsDashboardSnapshot> {
  const accessToken = environment.ADMIN_ACCESS_TOKEN?.trim();
  const baseUrl = parseBaseUrl(environment.ADMIN_API_URL ?? 'http://127.0.0.1:3001');
  if (!accessToken) return unavailableSnapshot('ADMIN_ACCESS_TOKEN 未配置');
  if (!baseUrl) return unavailableSnapshot('ADMIN_API_URL 无效');

  const entries = await Promise.all(Object.entries(endpoints).map(async ([key, path]) => {
    const result = await fetchEndpoint(fetcher, new URL(path, baseUrl), accessToken);
    return [key, result] as const;
  }));

  return { configured: true, ...Object.fromEntries(entries) } as OperationsDashboardSnapshot;
}

async function fetchEndpoint(fetcher: typeof fetch, url: URL, accessToken: string): Promise<EndpointResult<unknown>> {
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
    return { data: await response.json(), error: null };
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError' ? '请求超时' : 'API 不可达';
    return { data: null, error: message };
  }
}

function parseBaseUrl(input: string) {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function unavailableSnapshot(error: string): OperationsDashboardSnapshot {
  const unavailable = () => ({ data: null, error });
  return {
    configured: false,
    overview: unavailable(),
    workers: unavailable(),
    outbox: unavailable(),
    executions: unavailable(),
    connectors: unavailable(),
    alerts: unavailable(),
    diagnostics: unavailable(),
  };
}
