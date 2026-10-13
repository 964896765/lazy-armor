import { adminConfig, backendRequest, requestCookie, revokeAdminSession, sessionCookie, validAccessToken, validRefreshToken, verifyAdminSession, type AdminConfig, type AdminEnvironment } from './admin-auth';

// no-referrer turns native HTML form POST Origin into "null" in Chromium.
// same-origin preserves our canonical-origin CSRF check and hides cross-site referrers.
const noStore = { 'cache-control': 'no-store, max-age=0', 'referrer-policy': 'same-origin' };
function failure(status: number) { return new Response('请求无法完成，请重新打开管理员登录页。', { status, headers: noStore }); }
function redirect(config: AdminConfig, path: string) {
  return new Response(null, { status: 303, headers: { ...noStore, location: new URL(path, config.publicOrigin).href } });
}
function clearCookies(response: Response, config: AdminConfig) {
  response.headers.append('set-cookie', sessionCookie(config, config.accessCookie, '', 0));
  response.headers.append('set-cookie', sessionCookie(config, config.refreshCookie, '', 0));
  return response;
}
function allowedOrigin(request: Request, config: AdminConfig) {
  return request.method === 'POST' && request.headers.get('origin') === config.publicOrigin;
}

// Read incrementally; formData()/text() would buffer an unbounded body first.
async function credentials(request: Request): Promise<{ email: string; password: string } | null> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') return null;
  const size = request.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > 4096)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); return null; }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if ([...form.keys()].some(key => key !== 'email' && key !== 'password') || form.getAll('email').length !== 1 || form.getAll('password').length !== 1) return null;
    const email = form.get('email')!.trim();
    const password = form.get('password')!;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 128) return null;
    return { email, password };
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function login(request: Request, fetcher: typeof fetch = fetch, environment: AdminEnvironment = process.env): Promise<Response> {
  const config = adminConfig(environment);
  if (!config) return failure(503);
  if (!allowedOrigin(request, config)) return failure(403);
  const input = await credentials(request);
  if (!input) return failure(400);
  let pair: { accessToken: string; refreshToken: string; expiresIn: number };
  try {
    const response = await backendRequest(config, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, fetcher);
    if (!response.ok) return redirect(config, response.status === 429 ? '/login?error=rate-limit' : response.status === 401 ? '/login?error=credentials' : '/login?error=unavailable');
    pair = await response.json();
    if (!pair || !validRefreshToken(pair.refreshToken)) return redirect(config, '/login?error=unavailable');
    if (!validAccessToken(pair.accessToken) || !Number.isFinite(pair.expiresIn) || pair.expiresIn < 1) {
      await revokeAdminSession(pair.refreshToken, config, fetcher);
      return redirect(config, '/login?error=unavailable');
    }
  } catch { return redirect(config, '/login?error=unavailable'); }
  const session = await verifyAdminSession(pair.accessToken, config, fetcher);
  if (session.state !== 'authenticated') {
    await revokeAdminSession(pair.refreshToken, config, fetcher);
    return redirect(config, session.state === 'forbidden' ? '/login?error=forbidden' : '/login?error=unavailable');
  }
  // Replacing a browser session also revokes its previous backend session.
  await revokeAdminSession(requestCookie(request, config.refreshCookie), config, fetcher);
  const response = redirect(config, '/');
  const maxAge = Math.min(900, Math.floor(pair.expiresIn));
  response.headers.append('set-cookie', sessionCookie(config, config.accessCookie, pair.accessToken, maxAge));
  response.headers.append('set-cookie', sessionCookie(config, config.refreshCookie, pair.refreshToken, maxAge));
  return response;
}

export async function logout(request: Request, fetcher: typeof fetch = fetch, environment: AdminEnvironment = process.env): Promise<Response> {
  const config = adminConfig(environment);
  if (!config) return failure(503);
  if (!allowedOrigin(request, config)) return failure(403);
  const refreshToken = requestCookie(request, config.refreshCookie);
  const revoked = !refreshToken || await revokeAdminSession(refreshToken, config, fetcher);
  return clearCookies(redirect(config, revoked ? '/login' : '/login?error=logout-incomplete'), config);
}
