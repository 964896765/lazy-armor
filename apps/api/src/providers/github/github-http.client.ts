import { ProviderRuntimeError, type ProviderRuntimeErrorCode } from '@lazy-armor/connector-sdk';

export type GitHubTransport = (url: string, init: RequestInit) => Promise<Response>;
export const GITHUB_TRANSPORT = Symbol('GITHUB_TRANSPORT');
export const GITHUB_API_VERSION = '2026-03-10';
export interface GitHubResponse { data: Record<string, unknown> | unknown[] | null; headers: Headers }
export class GitHubApiError extends ProviderRuntimeError {
  constructor(code: ProviderRuntimeErrorCode, retryAfterMs: number | null, definitiveNoEffect: boolean,
    readonly httpStatus: number) { super(code, 'AFTER_DISPATCH', retryAfterMs, definitiveNoEffect); }
}

// No alternate production origin, redirect, credential logging or implicit retry.
// Deadline includes reading the body, not merely receiving response headers.
export class GitHubHttpClient {
  constructor(private readonly transport: GitHubTransport = (url, init) => fetch(url, init), private readonly timeoutMs = 10_000) {}
  async request(url: string, init: RequestInit = {}, write = false): Promise<GitHubResponse> {
    let target: URL;
    try { target = new URL(url); } catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    const method = (init.method ?? 'GET').toUpperCase();
    if (target.username || target.password || target.hash || !['GET', 'POST', 'DELETE'].includes(method)
      || (target.origin !== 'https://api.github.com' && target.origin !== 'https://github.com')
      || (target.origin === 'https://github.com' && (target.pathname !== '/login/oauth/access_token' || method !== 'POST' || target.search))
      || /%(?:2f|5c|2e)/i.test(target.pathname)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    // Mutations cannot accidentally opt into a read-only response/error contract.
    write = write || method !== 'GET';
    const headers = new Headers(init.headers);
    headers.set('accept', target.origin === 'https://api.github.com' ? 'application/vnd.github+json' : 'application/json');
    headers.set('user-agent', 'lazy-armor-github-provider/0.2.0');
    if (target.origin === 'https://api.github.com') headers.set('x-github-api-version', GITHUB_API_VERSION);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      abort.abort(); reject(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH'));
    }, this.timeoutMs); });
    try { return await Promise.race([this.receive(url, { ...init, headers, redirect: 'error', signal: abort.signal }, write), deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  private async receive(url: string, init: RequestInit, write: boolean): Promise<GitHubResponse> {
    let response: Response;
    try { response = await this.transport(url, init); }
    catch (error) { throw new ProviderRuntimeError(init.signal?.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      ? 'TIMEOUT' : 'NETWORK_ERROR', 'AFTER_DISPATCH'); }
    let data: GitHubResponse['data'] = null;
    try {
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader?.cancel().catch(() => undefined); };
      init.signal?.addEventListener('abort', cancel, { once: true });
      try { if (reader) while (true) {
        const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 4 * 1024 * 1024) { cancel(); throw new Error('Response limit'); } chunks.push(next.value);
      } } finally { init.signal?.removeEventListener('abort', cancel); }
      if (init.signal?.aborted) throw new Error('Deadline');
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) { const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON shape'); data = parsed as GitHubResponse['data']; }
      else if (response.status !== 204) throw new Error('Empty response');
    } catch {
      if (init.signal?.aborted) throw new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH');
      // Even a malformed error body must respect known status/limit headers.
      if (!response.ok) throw this.error(response, null, false);
      throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    }
    if (!response.ok) throw this.error(response, data, true);
    // Custom test transport cannot manufacture a redirect as a successful read.
    if (response.status >= 300) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return { data, headers: response.headers };
  }
  private error(response: Response, data: GitHubResponse['data'], validBody: boolean) {
    const object = data && !Array.isArray(data) ? data : {};
    const message = typeof object.message === 'string' ? object.message : '';
    const limited = [403, 429].includes(response.status) && (response.status === 429
      || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')
      || /(?:secondary rate limit|API rate limit exceeded|abuse detection)/i.test(message));
    let retryAfterMs: number | null = null;
    if (limited) {
      const waits = [60_000]; // Secondary limit without timing evidence: at least one minute.
      const retry = response.headers.get('retry-after');
      if (retry && /^\d+$/.test(retry)) { const seconds = Number(retry); if (Number.isSafeInteger(seconds)) waits.push(seconds * 1000); }
      else if (retry) { const wait = Date.parse(retry) - Date.now(); if (Number.isFinite(wait) && wait > 0) waits.push(wait); }
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = response.headers.get('x-ratelimit-reset');
        if (reset && /^\d+$/.test(reset)) { const wait = Number(reset) * 1000 - Date.now();
          if (Number.isSafeInteger(wait) && wait > 0) waits.push(wait); }
      }
      retryAfterMs = Math.max(...waits);
    }
    const code: ProviderRuntimeErrorCode = limited ? 'RATE_LIMITED' : response.status === 401 ? 'AUTH_EXPIRED'
      : [400, 403, 409, 412, 422].includes(response.status) ? 'PERMISSION_DENIED' : response.status === 404 ? 'RESOURCE_NOT_FOUND'
      : response.status === 408 ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
    return new GitHubApiError(code, retryAfterMs, validBody && response.status >= 400 && response.status < 500 && response.status !== 408, response.status);
  }
  async object(url: string, init: RequestInit = {}, write = false) {
    const result = await this.request(url, init, write);
    if (!result.data || Array.isArray(result.data)) throw new ProviderRuntimeError(write || (init.method && init.method !== 'GET') ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return { ...result, data: result.data };
  }
}
