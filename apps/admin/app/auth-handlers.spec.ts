import { describe, expect, it, vi } from 'vitest';
import { adminConfig, requestCookie } from './admin-auth';
import { login, logout } from './auth-handlers';

const environment = { NODE_ENV: 'production', ADMIN_API_URL: 'https://api.example.test', ADMIN_PUBLIC_ORIGIN: 'https://admin.example.test' };
const tokens = { accessToken: 'fixture.jwt.signature', refreshToken: 'a'.repeat(64), expiresIn: 3600 };
function form(body = new URLSearchParams({ email: 'admin@example.test', password: 'fixture-password' }).toString(), origin: string | null = environment.ADMIN_PUBLIC_ORIGIN, extraHeaders = {}) {
  return new Request(`${environment.ADMIN_PUBLIC_ORIGIN}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}), ...extraHeaders }, body });
}
function backend(role = 'super_admin', failLogout = false) {
  return vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(url.toString()).pathname;
    if (path === '/api/auth/login') return Response.json(tokens);
    if (path === '/api/admin/session') return Response.json({ id: 'fixture', status: 'active', role });
    return Response.json({ revoked: !failLogout }, { status: failLogout ? 503 : 200 });
  });
}

describe('Admin canonical origin and cookies', () => {
  it.each([
    { ADMIN_PUBLIC_ORIGIN: 'http://admin.example.test' },
    { ADMIN_PUBLIC_ORIGIN: 'https://admin.example.test/path' },
    { ADMIN_PUBLIC_ORIGIN: 'https://user:pass@admin.example.test' },
    { ADMIN_PUBLIC_ORIGIN: 'https://admin.example.test?next=evil' },
    { ADMIN_API_URL: 'http://api.example.test' },
    { ADMIN_API_URL: 'https://user:pass@api.example.test' },
    { ADMIN_API_URL: 'https://api.example.test/#fragment' },
    { ADMIN_API_URL: 'https://api.example.test/path' },
    { ADMIN_PUBLIC_ORIGIN: '' },
  ])('rejects unsafe deployment configuration %j', overrides => {
    expect(adminConfig({ ...environment, ...overrides })).toBeNull();
  });
  it('requires an explicit production public origin and supports loopback development', () => {
    expect(adminConfig({ NODE_ENV: 'production' })).toBeNull();
    expect(adminConfig({ NODE_ENV: 'development' })?.secure).toBe(false);
  });
  it('rejects duplicate cookie names', () => {
    expect(requestCookie(new Request('https://admin.example.test', { headers: { cookie: 'x=one; x=two' } }), 'x')).toBeUndefined();
  });
});

describe('Admin login and logout', () => {
  it.each(['super_admin', 'operations_readonly'])('issues only HttpOnly host cookies for %s without serializing credentials', async role => {
    const fetcher = backend(role);
    const response = await login(form(), fetcher, environment);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://admin.example.test/');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain('__Host-la_admin_');
      expect(cookie).toContain('Path=/; Max-Age=900; HttpOnly; SameSite=Strict; Secure');
      expect(cookie).not.toContain('Domain=');
    }
    const body = await response.text();
    expect(body).not.toContain(tokens.accessToken);
    expect(body).not.toContain(tokens.refreshToken);
    expect(body).not.toContain('fixture-password');
    expect(fetcher.mock.calls.map(([url]) => new URL(url.toString()).pathname)).toEqual(['/api/auth/login', '/api/admin/session']);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('uses distinct local cookie names for explicit loopback HTTP', async () => {
    const local = { ...environment, ADMIN_PUBLIC_ORIGIN: 'http://127.0.0.1:3002' };
    const response = await login(form(undefined, local.ADMIN_PUBLIC_ORIGIN), backend(), local);
    expect(response.headers.getSetCookie()[0]).toContain('la_admin_access_local=');
    expect(response.headers.getSetCookie()[0]).not.toContain('Secure');
  });
  it.each([null, 'null', 'https://evil.test', 'https://admin.example.test.evil.test'])('rejects login/logout Origin %s before any backend call', async origin => {
    const fetcher = backend();
    expect((await login(form(undefined, origin), fetcher, environment)).status).toBe(403);
    expect((await logout(form(undefined, origin), fetcher, environment)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('ignores attacker controlled Host and forwarded headers', async () => {
    const fetcher = backend();
    const response = await login(form(undefined, 'https://evil.test', { host: 'admin.example.test', 'x-forwarded-host': 'admin.example.test' }), fetcher, environment);
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'email=admin%40example.test&password=' + 'x'.repeat(4096),
    'email=admin%40example.test&password=' + 'x'.repeat(129),
    'email=not-email&password=fixture',
    'email=admin%40example.test&password=fixture&role=super_admin',
    'email=admin%40example.test&email=second%40example.test&password=fixture',
  ])('rejects oversized, invalid or ambiguous credentials without login', async body => {
    const fetcher = backend();
    expect((await login(form(body), fetcher, environment)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks the streamed limit even if content-length claims a smaller body', async () => {
    const fetcher = backend();
    expect((await login(form('x'.repeat(5000), undefined, { 'content-length': '1' }), fetcher, environment)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies ordinary users and revokes their newly issued session', async () => {
    const fetcher = backend('user');
    const response = await login(form(), fetcher, environment);
    expect(response.headers.get('location')).toBe('https://admin.example.test/login?error=forbidden');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ refreshToken: tokens.refreshToken }));
  });
  it('revokes candidate tokens when role verification becomes unavailable', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new URL(url.toString()).pathname === '/api/admin/session' ? new Response(null, { status: 503 }) : Response.json(tokens));
    const response = await login(form(), fetcher, environment);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('handles API redirect/fetch failure without credential output', async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => { expect(init?.redirect).toBe('error'); throw new TypeError('redirect'); });
    const response = await login(form(), fetcher, environment);
    expect(response.headers.get('location')).toContain('error=unavailable');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toBe('');
  });
  it.each([401, 429, 503])('maps backend login HTTP %s to a fixed safe error', async status => {
    const fetcher = vi.fn(async () => Response.json({ message: 'private-server-error' }, { status }));
    const response = await login(form(), fetcher, environment);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).not.toContain('private-server-error');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('revokes the previous backend session when replacing a browser session', async () => {
    const fetcher = backend();
    const previous = 'b'.repeat(64);
    await login(form(undefined, undefined, { cookie: `__Host-la_admin_refresh=${previous}` }), fetcher, environment);
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ refreshToken: previous }));
  });
  it.each([false, true])('clears both cookies on logout even when backend failure is %s', async failLogout => {
    const fetcher = backend('super_admin', failLogout);
    const request = form(undefined, undefined, { cookie: `__Host-la_admin_refresh=${tokens.refreshToken}` });
    const response = await logout(request, fetcher, environment);
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain('Max-Age=0; HttpOnly; SameSite=Strict; Secure');
    expect(response.headers.get('location')).toBe(`https://admin.example.test/login${failLogout ? '?error=logout-incomplete' : ''}`);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ refreshToken: tokens.refreshToken }));
  });
});
