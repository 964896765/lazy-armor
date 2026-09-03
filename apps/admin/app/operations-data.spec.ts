import { describe, expect, it, vi } from 'vitest';
import { loadOperationsDashboard } from './operations-data';

describe('operations dashboard data loader', () => {
  it('loads all seven read-only endpoints with the server-side admin token', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input.toString();
      return new Response(JSON.stringify({ path: new URL(url).pathname }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadOperationsDashboard(fetchMock as unknown as typeof fetch, {
      ADMIN_API_URL: 'https://api.example.test',
      ADMIN_ACCESS_TOKEN: 'server-only-token',
    });

    expect(result.configured).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls.map(([input]) => new URL(input.toString()).pathname).sort()).toEqual([
      '/api/admin/diagnostics',
      '/api/admin/operations/alerts',
      '/api/admin/operations/connectors',
      '/api/admin/operations/executions',
      '/api/admin/operations/outbox',
      '/api/admin/operations/overview',
      '/api/admin/operations/workers',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer server-only-token' });
      expect(init?.cache).toBe('no-store');
    }
  });

  it('fails closed without a token and makes no request', async () => {
    const fetchMock = vi.fn();
    const result = await loadOperationsDashboard(fetchMock as unknown as typeof fetch, { ADMIN_API_URL: 'https://api.example.test' });
    expect(result.configured).toBe(false);
    expect(result.overview).toEqual({ data: null, error: 'ADMIN_ACCESS_TOKEN 未配置' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a failed endpoint isolated from healthy sections', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input.toString()).pathname;
      return path.endsWith('/alerts')
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const result = await loadOperationsDashboard(fetchMock as unknown as typeof fetch, {
      ADMIN_API_URL: 'https://api.example.test',
      ADMIN_ACCESS_TOKEN: 'token',
    });
    expect(result.alerts).toEqual({ data: null, error: 'HTTP 503' });
    expect(result.overview).toEqual({ data: { ok: true }, error: null });
  });
});
