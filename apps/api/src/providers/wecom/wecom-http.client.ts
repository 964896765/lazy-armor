import { ProviderRuntimeError, type ProviderRuntimeErrorCode } from '@lazy-armor/connector-sdk';

export const WECOM_TRANSPORT = Symbol('WECOM_TRANSPORT');
export type WeComTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface WeComResponse { data: Record<string, unknown> | null; headers: Headers; code: number }
export class WeComApiError extends ProviderRuntimeError {
  constructor(code: ProviderRuntimeErrorCode, retryAfterMs: number | null, definitiveNoEffect: boolean,
    readonly httpStatus: number, readonly wecomCode: number) { super(code, 'AFTER_DISPATCH', retryAfterMs, definitiveNoEffect); }
}

const EXPIRED = new Set([40014, 42001, 42007, 40084]);
const REVOKED = new Set([40001, 40002, 40005, 40016]);
const PERMISSION = new Set([48002, 60011, 60020, 48003, 48004]);
const NOT_FOUND = new Set([40003, 46003, 46004]);
const RATE_LIMITED = new Set([45009, 45006, 45011, 45008, 429]);

function mapWeComFailure(status: number, wecomCode: number, retryAfterMs: number | null, definitiveNoEffect: boolean): WeComApiError {
  const code: ProviderRuntimeErrorCode = status === 401 || EXPIRED.has(wecomCode) ? 'AUTH_EXPIRED'
    : REVOKED.has(wecomCode) ? 'AUTH_REVOKED'
    : status === 429 || RATE_LIMITED.has(wecomCode) ? 'RATE_LIMITED'
    : status === 403 || PERMISSION.has(wecomCode) ? 'PERMISSION_DENIED'
    : status === 404 || NOT_FOUND.has(wecomCode) ? 'RESOURCE_NOT_FOUND'
    : status === 408 ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
  return new WeComApiError(code, retryAfterMs, definitiveNoEffect, status, wecomCode);
}

// Single production origin; no redirects, no credential logging, no implicit retry.
export class WeComHttpClient {
  constructor(private readonly transport: WeComTransport = (url, init) => fetch(url, init), private readonly timeoutMs = 10_000) {}
  async object(url: string, init: RequestInit = {}, write = false): Promise<Record<string, unknown>> {
    const result = await this.request(url, init, write);
    if (!result.data || Array.isArray(result.data)) throw new ProviderRuntimeError(write || (init.method && init.method !== 'GET') ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return result.data;
  }
  async request(url: string, init: RequestInit = {}, write = false): Promise<WeComResponse> {
    let target: URL;
    try { target = new URL(url); } catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    const method = (init.method ?? 'GET').toUpperCase();
    if (target.username || target.password || target.hash || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)
      || target.origin !== 'https://qyapi.weixin.qq.com' || /%(?:2f|5c|2e)/i.test(target.pathname)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    write = write || method !== 'GET';
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json'); if (method !== 'GET') headers.set('content-type', 'application/json');
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      abort.abort(); reject(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH')); }, this.timeoutMs); });
    try { return await Promise.race([this.receive(url, { ...init, headers, redirect: 'error', signal: abort.signal }, write), deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  private async receive(url: string, init: RequestInit, write: boolean): Promise<WeComResponse> {
    let response: Response;
    try { response = await this.transport(url, init); }
    catch (error) { throw new ProviderRuntimeError(init.signal?.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      ? 'TIMEOUT' : 'NETWORK_ERROR', 'AFTER_DISPATCH'); }
    let parsed: unknown = null;
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
      if (text) { parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON shape'); }
    } catch {
      if (init.signal?.aborted) throw new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH');
      if (!response.ok) throw mapWeComFailure(response.status, 0, null, false);
      throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    }
    const body = (parsed ?? {}) as Record<string, unknown>;
    const wecomCode = Number.isSafeInteger(body.errcode) ? (body.errcode as number) : (response.ok ? 0 : -1);
    const definitiveNoEffect = response.ok && wecomCode !== 0 && (PERMISSION.has(wecomCode) || NOT_FOUND.has(wecomCode) || EXPIRED.has(wecomCode) || REVOKED.has(wecomCode));
    if (!response.ok || wecomCode !== 0) throw mapWeComFailure(response.status, wecomCode, this.retryAfter(response, wecomCode), definitiveNoEffect);
    if (response.status >= 300) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    const data = body.data !== undefined && body.data !== null ? body.data : body;
    if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return { data: (data as Record<string, unknown>) ?? {}, headers: response.headers, code: wecomCode };
  }
  private retryAfter(response: Response, wecomCode: number): number | null {
    if (response.status !== 429 && !RATE_LIMITED.has(wecomCode)) return null;
    const retry = response.headers.get('retry-after');
    if (retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry))) return Math.max(1000, Number(retry) * 1000);
    return 60_000;
  }
}
