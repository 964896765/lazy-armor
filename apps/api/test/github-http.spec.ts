import { describe, expect, it, vi } from 'vitest';
import { GitHubHttpClient, GitHubApiError, GITHUB_API_VERSION } from '../src/providers/github/github-http.client';
const api = 'https://api.github.com/repos/example/isolated/issues';
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });

describe('GitHub fixed-origin transport and side-effect-safe error mapping', () => {
  it('pins REST version, accepts arrays, disables redirect and supplies a deadline signal', async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('x-github-api-version')).toBe(GITHUB_API_VERSION);
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer isolated');
      expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal); return json([{ id: 42 }]);
    });
    expect((await new GitHubHttpClient(transport).request(api, { headers: { authorization: 'Bearer isolated', 'x-github-api-version': 'untrusted' } })).data).toEqual([{ id: 42 }]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['http://api.github.com/user', 'https://api.github.com.evil/user', 'https://evil.test/user',
    'https://user:password@api.github.com/user', 'https://api.github.com/user#secret',
    'https://github.com/login/oauth/authorize', 'https://api.github.com/repos/a%2fb/r/issues', 'not a url'])('rejects unsafe target %s before sending credentials', async (url) => {
    const transport = vi.fn(); await expect(new GitHubHttpClient(transport).request(url)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', phase: 'BEFORE_DISPATCH' }); expect(transport).not.toHaveBeenCalled();
  });
  it('uses JSON token response and accepts 204 revocation without assuming an object', async () => {
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('https://github.com/')) { expect(new Headers(init.headers).get('accept')).toBe('application/json'); return json({ token_type: 'bearer' }); }
      return new Response(null, { status: 204 });
    });
    const http = new GitHubHttpClient(transport);
    expect((await http.object('https://github.com/login/oauth/access_token', { method: 'POST' })).data.token_type).toBe('bearer');
    expect((await http.request('https://api.github.com/applications/isolated/token', { method: 'DELETE' })).data).toBeNull();
  });
  it('does not implicitly retry writes after a socket failure', async () => {
    const transport = vi.fn(async () => { throw new Error('network includes an isolated token; must not escape'); });
    await expect(new GitHubHttpClient(transport).request(api, { method: 'POST' }, true)).rejects.toMatchObject({ code: 'NETWORK_ERROR', phase: 'AFTER_DISPATCH', definitiveNoEffect: false }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([500, 408])('does not prove no effect for HTTP %i', async (status) => {
    await expect(new GitHubHttpClient(async () => json({ message: 'failure' }, status)).request(api, { method: 'POST' }, true)).rejects.toMatchObject({ definitiveNoEffect: false });
  });
  it('distinguishes ordinary permission failure from a primary rate limit and waits for the later reset', async () => {
    const reset = Math.ceil(Date.now() / 1000) + 120;
    const http = new GitHubHttpClient(async () => json({ message: 'API rate limit exceeded' }, 403,
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset), 'retry-after': '1' }));
    const error = await http.request(api).catch((e: GitHubApiError) => e);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', httpStatus: 403, definitiveNoEffect: true });
    expect((error as GitHubApiError).retryAfterMs).toBeGreaterThan(119000);
    await expect(new GitHubHttpClient(async () => json({ message: 'Resource not accessible' }, 403)).request(api)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', retryAfterMs: null });
  });
  it.each([403, 429])('waits at least one minute for secondary rate limit %i', async (status) => {
    await expect(new GitHubHttpClient(async () => json({ message: 'You have exceeded a secondary rate limit' }, status)).request(api)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 60000 });
  });
  it('preserves rate-limit timing for non-JSON responses without claiming a definitive rejection', async () => {
    await expect(new GitHubHttpClient(async () => new Response('upstream HTML', { status: 429, headers: { 'retry-after': '180' } })).request(api, { method: 'POST' })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 180000, definitiveNoEffect: false });
  });
  it.each(['not json', 'null', '"scalar"', ''])('keeps successful write with malformed body %j unknown', async (body) => {
    await expect(new GitHubHttpClient(async () => new Response(body)).request(api, { method: 'POST' })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', definitiveNoEffect: false });
  });
  it('rejects oversized response after headers without replaying the write', async () => {
    const transport = vi.fn(async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)));
    await expect(new GitHubHttpClient(transport).request(api, { method: 'POST' })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('includes an indefinitely stalled body in the timeout and cancels the stream', async () => {
    const cancel = vi.fn(); const transport = vi.fn(async () => new Response(new ReadableStream({ cancel })));
    await expect(new GitHubHttpClient(transport, 25).request(api, { method: 'POST' })).rejects.toMatchObject({ code: 'TIMEOUT', phase: 'AFTER_DISPATCH', definitiveNoEffect: false });
    expect(cancel).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled request without a response', async () => {
    await expect(new GitHubHttpClient(() => new Promise(() => undefined), 25).request(api)).rejects.toMatchObject({ code: 'TIMEOUT', phase: 'AFTER_DISPATCH' });
  });
  it('object contract does not reinterpret array write reply as successful verification', async () => {
    await expect(new GitHubHttpClient(async () => json([])).object(api, { method: 'POST' })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });
});
