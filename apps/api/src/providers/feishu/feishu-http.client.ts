import { ProviderRuntimeError, type ProviderRuntimeErrorCode } from '@lazy-armor/connector-sdk';

export const FEISHU_TRANSPORT = Symbol('FEISHU_TRANSPORT');
export type FeishuTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface FeishuResponse { data: Record<string, unknown> | null; headers: Headers; code: number }
export class FeishuApiError extends ProviderRuntimeError {
  constructor(code: ProviderRuntimeErrorCode, retryAfterMs: number | null, definitiveNoEffect: boolean,
    readonly httpStatus: number, readonly feishuCode: number) { super(code, 'AFTER_DISPATCH', retryAfterMs, definitiveNoEffect); }
}

const EXPIRED = new Set([99991661, 99991663, 99991672, 99991664]);
const REVOKED = new Set([99991668, 99991671, 99991667, 99991670]);
const PERMISSION = new Set([10003, 99991400, 99991669, 99991666, 1254045, 99991401, 99991402]);
const NOT_FOUND = new Set([1254046, 1254047, 1254043, 1254044, 1254001]);
const RATE_LIMITED = new Set([99991403, 99991405, 99991406]);

// Feishu errcode/HTTP is normalized here; provider error codes never leak past
// this boundary into the Runtime or core business logic.
function mapFeishuFailure(status: number, feishuCode: number, retryAfterMs: number | null, definitiveNoEffect: boolean): FeishuApiError {
  const code: ProviderRuntimeErrorCode = status === 401 || EXPIRED.has(feishuCode) ? 'AUTH_EXPIRED'
    : REVOKED.has(feishuCode) ? 'AUTH_REVOKED'
    : status === 429 || RATE_LIMITED.has(feishuCode) ? 'RATE_LIMITED'
    : status === 403 || PERMISSION.has(feishuCode) ? 'PERMISSION_DENIED'
    : status === 404 || NOT_FOUND.has(feishuCode) ? 'RESOURCE_NOT_FOUND'
    : status === 408 ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
  return new FeishuApiError(code, retryAfterMs, definitiveNoEffect, status, feishuCode);
}

// No alternate production origin, redirect, credential logging or implicit retry.
export class FeishuHttpClient {
  constructor(private readonly transport: FeishuTransport = (url, init) => fetch(url, init), private readonly timeoutMs = 10_000) {}
  async object(url: string, init: RequestInit = {}, write = false): Promise<Record<string, unknown>> {
    const result = await this.request(url, init, write);
    if (!result.data || Array.isArray(result.data)) throw new ProviderRuntimeError(write || (init.method && init.method !== 'GET') ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return result.data;
  }
  async request(url: string, init: RequestInit = {}, write = false): Promise<FeishuResponse> {
    let target: URL;
    try { target = new URL(url); } catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    const method = (init.method ?? 'GET').toUpperCase();
    if (target.username || target.password || target.hash || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)
      || target.origin !== 'https://open.feishu.cn' || /%(?:2f|5c|2e)/i.test(target.pathname)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    write = write || method !== 'GET';
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json'); if (method !== 'GET') headers.set('content-type', 'application/json');
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      abort.abort(); reject(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH')); }, this.timeoutMs); });
    try { return await Promise.race([this.receive(url, { ...init, headers, redirect: 'error', signal: abort.signal }, write), deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  private async receive(url: string, init: RequestInit, write: boolean): Promise<FeishuResponse> {
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
      if (!response.ok) throw mapFeishuFailure(response.status, 0, null, false);
      throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    }
    const body = (parsed ?? {}) as Record<string, unknown>;
    const feishuCode = Number.isSafeInteger(body.code) ? (body.code as number) : (response.ok ? 0 : -1);
    const definitiveNoEffect = response.ok && feishuCode !== 0 && (PERMISSION.has(feishuCode) || NOT_FOUND.has(feishuCode) || EXPIRED.has(feishuCode) || REVOKED.has(feishuCode));
    if (!response.ok || feishuCode !== 0) throw mapFeishuFailure(response.status, feishuCode, this.retryAfter(response, feishuCode), definitiveNoEffect);
    if (response.status >= 300) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    const data = body.data !== undefined && body.data !== null ? body.data : body;
    if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return { data: (data as Record<string, unknown>) ?? {}, headers: response.headers, code: feishuCode };
  }
  private retryAfter(response: Response, feishuCode: number): number | null {
    if (response.status !== 429 && !RATE_LIMITED.has(feishuCode)) return null;
    const retry = response.headers.get('retry-after');
    if (retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry))) return Math.max(1000, Number(retry) * 1000);
    return 60_000;
  }
}
