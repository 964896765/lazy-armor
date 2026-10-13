import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { AuditService } from '../src/audit/audit.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = 'correct-horse-battery-staple';
let app: INestApplication, pool: Pool, administrator: Session, readonly: Session, ordinary: Session;
let next: ChildProcess | undefined, origin: string;
let audit: ReturnType<typeof vi.spyOn>;
const email = (kind: string) => `admin-fix02-${kind}-${unique}@example.test`;

async function passwordLogin(kind: string) {
  const response = await request(app.getHttpServer()).post('/api/auth/login').send({ email: email(kind), password }).expect(201);
  return response.body as { accessToken: string; refreshToken: string };
}
async function expiredToken() {
  const payload = app.get(JwtService).decode(administrator.token) as { sub: string; sid: string };
  return app.get(JwtService).signAsync({ sub: payload.sub, sid: payload.sid }, { expiresIn: -1 });
}
function diagnosticsReadCount() {
  return audit.mock.calls.filter(([entry]) => /^ADMIN_.*_VIEWED$/.test((entry as { action: string }).action)).length;
}

beforeAll(async () => {
  ({ app, pool } = await bootP2App(`admin-fix02-${unique}`));
  administrator = await register(app, email('admin'), 'Isolated Admin');
  readonly = await register(app, email('reader'), 'Isolated Reader');
  ordinary = await register(app, email('user'), 'Isolated User');
  await pool.execute('UPDATE users SET role = ? WHERE id = UUID_TO_BIN(?)', ['super_admin', administrator.userId]);
  await pool.execute('UPDATE users SET role = ? WHERE id = UUID_TO_BIN(?)', ['operations_readonly', readonly.userId]);
  audit = vi.spyOn(app.get(AuditService), 'append');
});
beforeEach(async () => {
  await pool.execute('UPDATE users SET status = ?, role = ? WHERE id = UUID_TO_BIN(?)', ['active', 'super_admin', administrator.userId]);
});
afterAll(async () => {
  if (next && next.exitCode === null) {
    const child = next;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
  }
  audit?.mockRestore();
  await app?.close();
  await pool?.end();
});

describe('original API Admin session authority', () => {
  it('rejects missing and forged credentials', async () => {
    await request(app.getHttpServer()).get('/api/admin/session').expect(401);
    await request(app.getHttpServer()).get('/api/admin/session').set(auth('forged.jwt.signature')).expect(401);
  });
  it('rejects an ordinary authenticated user', async () => {
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(ordinary.token)).expect(403);
  });
  it.each(['admin', 'reader'])('returns only current identity for the existing %s role', async kind => {
    const session = kind === 'admin' ? administrator : readonly;
    const response = await request(app.getHttpServer()).get('/api/admin/session').set(auth(session.token)).expect(200);
    expect(response.body).toEqual({ id: session.userId, status: 'active', role: kind === 'admin' ? 'super_admin' : 'operations_readonly' });
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('checks a downgraded role from SQL despite an unchanged signed token', async () => {
    await pool.execute('UPDATE users SET role = ? WHERE id = UUID_TO_BIN(?)', ['user', administrator.userId]);
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(administrator.token)).expect(403);
  });
  it('rejects a disabled account', async () => {
    await pool.execute('UPDATE users SET status = ? WHERE id = UUID_TO_BIN(?)', ['disabled', administrator.userId]);
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(administrator.token)).expect(401);
  });
  it('rejects a correctly signed expired access token', async () => {
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(await expiredToken())).expect(401);
  });
  it('rejects access after the original logout revokes its session', async () => {
    const pair = await passwordLogin('admin');
    await request(app.getHttpServer()).post('/api/auth/logout').send({ refreshToken: pair.refreshToken }).expect(201);
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(pair.accessToken)).expect(401);
  });
});

describe.runIf(process.env.OPTIMIZATION_ADMIN_HTTP_ACCEPTANCE === '1')('built Next Admin with real isolated API/SQL/Redis', () => {
  beforeAll(async () => {
    await app.listen(0, '127.0.0.1');
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    origin = `http://127.0.0.1:${port}`;
    const adminPath = path.resolve(process.cwd(), '../admin');
    const requireAdmin = createRequire(path.join(adminPath, 'package.json'));
    next = spawn(process.execPath, [requireAdmin.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
      cwd: adminPath, windowsHide: true, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
        ADMIN_API_URL: await app.getUrl(), ADMIN_PUBLIC_ORIGIN: origin, ADMIN_ACCESS_TOKEN: administrator.token },
    });
    await vi.waitFor(async () => {
      if (next?.exitCode !== null) throw new Error('Next process exited');
      expect((await fetch(`${origin}/login`)).status).toBe(200);
    }, { timeout: 30_000, interval: 200 });
  });

  async function page(cookie?: string) {
    return fetch(origin, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  }
  async function webLogin(kind: string) {
    return fetch(`${origin}/auth/login`, { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: email(kind), password }) });
  }
  const cookieHeader = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

  it('blocks anonymous access even with a valid legacy shared token configured', async () => {
    const count = diagnosticsReadCount();
    const response = await page();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/login');
    expect(await response.text()).not.toContain('Operations Dashboard');
    expect(diagnosticsReadCount()).toBe(count);
  });
  it.each(['forged.jwt.signature', 'expired'])('blocks %s visitor cookies without diagnostic reads', async value => {
    const count = diagnosticsReadCount();
    const token = value === 'expired' ? await expiredToken() : value;
    const response = await page(`la_admin_access_local=${token}`);
    expect(response.status).toBe(307);
    expect(diagnosticsReadCount()).toBe(count);
  });
  it('blocks ordinary user cookies and rejects ordinary user login', async () => {
    const count = diagnosticsReadCount();
    const denied = await page(`la_admin_access_local=${ordinary.token}`);
    expect(await denied.text()).toContain('没有访问权限');
    const response = await webLogin('user');
    expect(response.headers.get('location')).toBe(`${origin}/login?error=forbidden`);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(diagnosticsReadCount()).toBe(count);
  });
  it.each(['admin', 'reader'])('renders seven audited reads for the %s visitor without tokens in HTML', async kind => {
    const count = diagnosticsReadCount();
    const response = await webLogin(kind);
    expect(response.status).toBe(303);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const value of cookies) expect(value).toContain('HttpOnly; SameSite=Strict');
    const dashboard = await page(cookieHeader(response));
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get('cache-control')).toContain('no-store');
    expect(dashboard.headers.get('x-frame-options')).toBe('DENY');
    expect(dashboard.headers.get('referrer-policy')).toBe('same-origin');
    const html = await dashboard.text();
    expect(html).toContain('Operations Dashboard');
    for (const cookie of cookies) expect(html).not.toContain(cookie.split(';')[0]!.split('=')[1]);
    expect(diagnosticsReadCount()).toBe(count + 7);
  });
  it('blocks role downgrade and disabled account on the next page request', async () => {
    const count = diagnosticsReadCount();
    await pool.execute('UPDATE users SET role = ? WHERE id = UUID_TO_BIN(?)', ['user', administrator.userId]);
    expect(await (await page(`la_admin_access_local=${administrator.token}`)).text()).toContain('没有访问权限');
    await pool.execute('UPDATE users SET status = ? WHERE id = UUID_TO_BIN(?)', ['disabled', administrator.userId]);
    expect((await page(`la_admin_access_local=${administrator.token}`)).status).toBe(307);
    expect(diagnosticsReadCount()).toBe(count);
  });
  it('rejects cross-origin login and logout without changing backend authority', async () => {
    for (const route of ['login', 'logout']) {
      const response = await fetch(`${origin}/auth/${route}`, { method: 'POST', redirect: 'manual', headers: { origin: 'https://evil.test', cookie: `la_admin_access_local=${administrator.token}` }, body: 'ignored' });
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(administrator.token)).expect(200);
  });
  it('clears cookies and invalidates a copied access token through original backend logout', async () => {
    const loggedIn = await webLogin('admin');
    const cookies = cookieHeader(loggedIn);
    const accessToken = loggedIn.headers.getSetCookie()[0]!.split(';')[0]!.split('=')[1]!;
    const response = await fetch(`${origin}/auth/logout`, { method: 'POST', redirect: 'manual', headers: { origin, cookie: cookies } });
    expect(response.status).toBe(303);
    for (const value of response.headers.getSetCookie()) expect(value).toContain('Max-Age=0');
    await request(app.getHttpServer()).get('/api/admin/session').set(auth(accessToken)).expect(401);
    const count = diagnosticsReadCount();
    expect((await page(cookies)).status).toBe(307);
    expect(diagnosticsReadCount()).toBe(count);
  });
  it.runIf(Boolean(process.env.ADMIN_TEST_BROWSER_EXECUTABLE))('verifies real browser login, HttpOnly isolation and logout navigation', async () => {
    const browser = await chromium.launch({ executablePath: process.env.ADMIN_TEST_BROWSER_EXECUTABLE, headless: true, timeout: 10_000 });
    console.info('ADMIN_BROWSER_LAUNCHED');
    try {
      const context = await browser.newContext();
      const tab = await context.newPage();
      tab.setDefaultTimeout(10_000);
      tab.setDefaultNavigationTimeout(10_000);
      await tab.goto(origin);
      expect(new URL(tab.url()).pathname).toBe('/login');
      console.info('ADMIN_BROWSER_ANONYMOUS_REDIRECT_VERIFIED');
      await tab.locator('#email').fill(email('admin'));
      await tab.locator('#password').fill(password);
      await Promise.all([tab.waitForURL(origin + '/'), tab.getByRole('button', { name: '登录', exact: true }).click()]);
      console.info('ADMIN_BROWSER_LOGIN_NAVIGATION_VERIFIED');
      expect(await tab.locator('h1').textContent()).toBe('Operations Dashboard');
      expect(await tab.evaluate(() => document.cookie)).not.toContain('la_admin_');
      expect(await tab.evaluate(() => Object.keys(localStorage))).toEqual([]);
      const cookies = await context.cookies();
      const adminCookies = cookies.filter(cookie => cookie.name.startsWith('la_admin_'));
      expect(adminCookies).toHaveLength(2);
      expect(adminCookies.every(cookie => cookie.httpOnly && cookie.sameSite === 'Strict')).toBe(true);
      if (process.env.ADMIN_TEST_SCREENSHOT) await tab.screenshot({ path: process.env.ADMIN_TEST_SCREENSHOT, fullPage: true });
      await Promise.all([tab.waitForURL(origin + '/login'), tab.getByRole('button', { name: '退出登录' }).click()]);
      await tab.goto(origin);
      expect(new URL(tab.url()).pathname).toBe('/login');
      expect((await context.cookies()).filter(cookie => cookie.name.startsWith('la_admin_'))).toEqual([]);
    } finally { await browser.close(); }
  }, 45_000);
});
