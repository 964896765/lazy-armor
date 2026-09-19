import { ProviderRuntimeError, type ProviderRuntimeErrorCode } from '@lazy-armor/connector-sdk';

export const DINGTALK_TRANSPORT = Symbol('DINGTALK_TRANSPORT');
export type DingTalkTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface DingTalkResponse { data: Record<string, unknown> | null; headers: Headers; code: number }
export class DingTalkApiError extends ProviderRuntimeError {
  constructor(code: ProviderRuntimeErrorCode, retryAfterMs: number | null, definitiveNoEffect: boolean,
    readonly httpStatus: number, readonly dingtalkCode: number) { super(code, 'AFTER_DISPATCH', retryAfterMs, definitiveNoEffect); }
}

// DingTalk classic errcode values; the v1.0 string `code` is folded into the same
// boundary so provider-specific identifiers never leak into the Runtime.
const EXPIRED = new Set([40014, 40001, 40016, 88, 401]);
const PERMISSION = new Set([60011, 60012, 60010, 60020, 40012, 403]);
const NOT_FOUND = new Set([40003, 60008, 404]);
const RATE_LIMITED = new Set([90002, 90018, 90007, 90004, 90019, 429]);

function mapDingTalkFailure(status: number, dingtalkCode: number, stringCode: string | undefined, retryAfterMs: number | null, definitiveNoEffect: boolean): DingTalkApiError {
  const normalized = stringCode?.toLowerCase() ?? '';
  const code: ProviderRuntimeErrorCode = status === 401 || EXPIRED.has(dingtalkCode) || /authentication|expired/.test(normalized) ? 'AUTH_EXPIRED'
    : status === 403 || PERMISSION.has(dingtalkCode) || /forbidden|accessdenied|permission|invalid/.test(normalized) ? 'PERMISSION_DENIED'
    : status === 429 || RATE_LIMITED.has(dingtalkCode) || /limit/.test(normalized) ? 'RATE_LIMITED'
    : status === 404 || NOT_FOUND.has(dingtalkCode) || /notfound/.test(normalized) ? 'RESOURCE_NOT_FOUND'
    : status === 408 ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
  return new DingTalkApiError(code, retryAfterMs, definitiveNoEffect, status, dingtalkCode);
}

// Single production origin; no redirects, no credential logging, no implicit retry.
export class DingTalkHttpClient {
  constructor(private readonly transport: DingTalkTransport = (url, init) => fetch(url, init), private readonly timeoutMs = 10_000) {}
  async object(url: string, init: RequestInit = {}, write = false): Promise<Record<string, unknown>> {
    const result = await this.request(url, init, write);
    if (!result.data || Array.isArray(result.data)) throw new ProviderRuntimeError(write || (init.method && init.method !== 'GET') ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return result.data;
  }
  async request(url: string, init: RequestInit = {}, write = false): Promise<DingTalkResponse> {
    let target: URL;
    try { target = new URL(url); } catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    const method = (init.method ?? 'GET').toUpperCase();
    if (target.username || target.password || target.hash || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)
      || target.origin !== 'https://api.dingtalk.com' || /%(?:2f|5c|2e)/i.test(target.pathname)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    write = write || method !== 'GET';
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json'); if (method !== 'GET') headers.set('content-type', 'application/json');
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      abort.abort(); reject(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH')); }, this.timeoutMs); });
    try { return await Promise.race([this.receive(url, { ...init, headers, redirect: 'error', signal: abort.signal }, write), deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  private async receive(url: string, init: RequestInit, write: boolean): Promise<DingTalkResponse> {
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
      if (!response.ok) throw mapDingTalkFailure(response.status, 0, undefined, null, false);
      throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    }
    const body = (parsed ?? {}) as Record<string, unknown>;
    const numeric = typeof body.errcode === 'number' && Number.isSafeInteger(body.errcode) ? (body.errcode as number) : 0;
    const stringCode = typeof body.code === 'string' && body.code && body.code !== 'OK' ? body.code : undefined;
    const dingtalkCode = numeric !== 0 ? numeric : (stringCode ? -1 : (response.ok ? 0 : -1));
    const definitiveNoEffect = response.ok && dingtalkCode !== 0 && (PERMISSION.has(dingtalkCode) || NOT_FOUND.has(dingtalkCode) || EXPIRED.has(dingtalkCode)
      || /forbidden|accessdenied|permission|notfound|authentication|expired/.test(stringCode?.toLowerCase() ?? ''));
    if (!response.ok || dingtalkCode !== 0) throw mapDingTalkFailure(response.status, dingtalkCode, stringCode, this.retryAfter(response, dingtalkCode, stringCode), definitiveNoEffect);
    if (response.status >= 300) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    const data = body.data !== undefined && body.data !== null ? body.data : body;
    if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return { data: (data as Record<string, unknown>) ?? {}, headers: response.headers, code: dingtalkCode };
  }
  private retryAfter(response: Response, dingtalkCode: number, stringCode?: string): number | null {
    if (response.status !== 429 && !RATE_LIMITED.has(dingtalkCode) && !/limit/.test(stringCode?.toLowerCase() ?? '')) return null;
    const retry = response.headers.get('retry-after');
    if (retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry))) return Math.max(1000, Number(retry) * 1000);
    return 60_000;
  }
}
