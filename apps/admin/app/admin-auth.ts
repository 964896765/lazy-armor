// Server-only credentials: callers must never serialize tokens into page props.
export type AdminEnvironment = Readonly<Record<string, string | undefined>>;
export type AdminConfig = { apiUrl: URL; publicOrigin: string; secure: boolean; accessCookie: string; refreshCookie: string };
export type AdminUser = { id: string; status: 'active'; role: 'super_admin' | 'operations_readonly' };
export type SessionCheck = { state: 'authenticated'; user: AdminUser } | { state: 'unauthenticated' | 'forbidden' | 'unavailable' };

function safeOrigin(input: string): URL | null {
  try {
    const url = new URL(input);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url;
  } catch { return null; }
}

export function adminConfig(environment: AdminEnvironment = process.env): AdminConfig | null {
  const apiUrl = safeOrigin(environment.ADMIN_API_URL ?? 'http://127.0.0.1:3001');
  const origin = safeOrigin(environment.ADMIN_PUBLIC_ORIGIN ?? (environment.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3002'));
  if (!apiUrl || !origin) return null;
  const secure = origin.protocol === 'https:';
  return { apiUrl, publicOrigin: origin.origin, secure,
    accessCookie: secure ? '__Host-la_admin_access' : 'la_admin_access_local',
    refreshCookie: secure ? '__Host-la_admin_refresh' : 'la_admin_refresh_local' };
}

export function validAccessToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 3800 && /^[A-Za-z0-9_.-]+$/.test(value);
}

export function validRefreshToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 512 && /^[A-Za-z0-9_.-]+$/.test(value);
}

export function backendRequest(config: AdminConfig, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  return fetcher(new URL(path, config.apiUrl), { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
}

export async function verifyAdminSession(accessToken: string | undefined, config: AdminConfig | null, fetcher: typeof fetch = fetch): Promise<SessionCheck> {
  if (!validAccessToken(accessToken)) return { state: 'unauthenticated' };
  if (!config) return { state: 'unavailable' };
  try {
    const response = await backendRequest(config, '/api/admin/session', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } }, fetcher);
    if (response.status === 401) return { state: 'unauthenticated' };
    if (response.status === 403) return { state: 'forbidden' };
    if (!response.ok) return { state: 'unavailable' };
    const user: unknown = await response.json();
    if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !user.id) return { state: 'unavailable' };
    if (!('status' in user) || user.status !== 'active') return { state: 'unauthenticated' };
    if (!('role' in user) || (user.role !== 'super_admin' && user.role !== 'operations_readonly')) return { state: 'forbidden' };
    return { state: 'authenticated', user: { id: user.id, status: 'active', role: user.role } };
  } catch { return { state: 'unavailable' }; }
}

export async function revokeAdminSession(refreshToken: string | undefined, config: AdminConfig, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!validRefreshToken(refreshToken)) return false;
  try {
    const response = await backendRequest(config, '/api/auth/logout', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }),
    }, fetcher);
    return response.ok;
  } catch { return false; }
}

export function sessionCookie(config: AdminConfig, name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${config.secure ? '; Secure' : ''}`;
}

export function requestCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}
