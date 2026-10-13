import { describe, expect, it, vi } from 'vitest';
import { loadOperationsDashboard } from './operations-data';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const environment = { ADMIN_API_URL: 'https://api.example.test', ADMIN_PUBLIC_ORIGIN: 'https://admin.example.test', ADMIN_ACCESS_TOKEN: 'legacy-shared-token' };
const administrator = { id: 'fixture-admin', status: 'active', role: 'operations_readonly' };
function backend(status = 200, session: unknown = administrator, sectionStatus = 200) {
  return vi.fn(async (input: URL | RequestInfo, _init?: RequestInit) => {
    const path = new URL(input.toString()).pathname;
    return path === '/api/admin/session' ? Response.json(session, { status })
      : Response.json({ marker: 'private-diagnostic', path }, { status: path.endsWith('/alerts') ? sectionStatus : 200 });
  });
}

describe('operations dashboard visitor authentication', () => {
  it('checks the current visitor before all seven protected reads', async () => {
    const fetcher = backend();
    const result = await loadOperationsDashboard('visitor.jwt.signature', fetcher, environment);
    expect(result.state).toBe('ready');
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(new URL(fetcher.mock.calls[0]![0].toString()).pathname).toBe('/api/admin/session');
    expect(fetcher.mock.calls.slice(1).map(([url]) => new URL(url.toString()).pathname).sort()).toEqual([
      '/api/admin/diagnostics', '/api/admin/operations/alerts', '/api/admin/operations/connectors',
      '/api/admin/operations/executions', '/api/admin/operations/outbox', '/api/admin/operations/overview', '/api/admin/operations/workers',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer visitor.jwt.signature' });
      expect(init?.cache).toBe('no-store');
      expect(init?.redirect).toBe('error');
    }
    expect(JSON.stringify(result)).not.toContain('visitor.jwt.signature');
  });

  it.each([undefined, '', 'bad\r\ntoken', 'x'.repeat(3801)])('ignores the legacy shared token when the visitor cookie is %s', async token => {
    const fetcher = backend();
    expect(await loadOperationsDashboard(token, fetcher, environment)).toEqual({ state: 'unauthenticated' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('discards all data for verifier HTTP %s', async status => {
    const fetcher = backend(status);
    const result = await loadOperationsDashboard('forged.or.expired', fetcher, environment);
    expect(result).toEqual({ state: status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...administrator, role: 'user' }, 'forbidden'],
    [{ ...administrator, status: 'disabled' }, 'unauthenticated'],
    [{ role: 'super_admin', status: 'active' }, 'unavailable'],
  ])('rejects invalid current identity %j before diagnostic reads', async (session, state) => {
    const fetcher = backend(200, session);
    expect(await loadOperationsDashboard('visitor.token', fetcher, environment)).toEqual({ state });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('discards healthy sections if authority is lost during reads (HTTP %s)', async status => {
    const fetcher = backend(200, administrator, status);
    const result = await loadOperationsDashboard('visitor.token', fetcher, environment);
    expect(result).toEqual({ state: status === 401 ? 'unauthenticated' : 'forbidden' });
    expect(JSON.stringify(result)).not.toContain('private-diagnostic');
  });

  it('keeps a service failure isolated after successful authorization', async () => {
    const result = await loadOperationsDashboard('visitor.token', backend(200, administrator, 503), environment);
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected authorized snapshot');
    expect(result.snapshot.alerts).toEqual({ data: null, error: 'HTTP 503' });
    expect(result.snapshot.overview.data).toMatchObject({ marker: 'private-diagnostic' });
  });

  it('fails closed on backend outage or redirect rejection', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await loadOperationsDashboard('visitor.token', fetcher, environment)).toEqual({ state: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not follow a real backend redirect or forward credentials to its target', async () => {
    let redirectedRequests = 0;
    const target = createServer((_request, response) => { redirectedRequests++; response.end('{}'); });
    const source = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/leak` });
      response.end();
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
    try {
      const result = await loadOperationsDashboard('fixture.token', fetch, { ...environment, ADMIN_API_URL: `http://127.0.0.1:${(source.address() as AddressInfo).port}` });
      expect(result).toEqual({ state: 'unavailable' });
      expect(redirectedRequests).toBe(0);
    } finally {
      source.closeAllConnections(); target.closeAllConnections();
      await Promise.all([new Promise<void>(resolve => source.close(() => resolve())), new Promise<void>(resolve => target.close(() => resolve()))]);
    }
  });
});
