import { ProviderRuntimeError, type ProviderRuntimeErrorCode } from '@lazy-armor/connector-sdk';

export const NOTION_API_VERSION = '2026-03-11';
export const NOTION_TRANSPORT = Symbol('NOTION_TRANSPORT');
export type NotionTransport = (url: string, init: RequestInit) => Promise<Response>;
export class NotionApiError extends ProviderRuntimeError {
  constructor(code: ProviderRuntimeErrorCode, retryAfterMs: number | null, definitiveNoEffect: boolean, readonly httpStatus: number) {
    super(code, 'AFTER_DISPATCH', retryAfterMs, definitiveNoEffect);
  }
}

export class NotionHttpClient {
  constructor(private readonly transport: NotionTransport = (url, init) => fetch(url, init), private readonly timeoutMs = 10_000) {}
  async object(url: string, init: RequestInit = {}, write = false): Promise<Record<string, unknown>> {
    let target: URL;
    try { target = new URL(url); } catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    const method = (init.method ?? 'GET').toUpperCase(); const uuid = '[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
    const allowed = method === 'GET' ? new RegExp(`^/v1/(?:users/me|(?:pages|data_sources)/${uuid})$`)
      : method === 'PATCH' ? new RegExp(`^/v1/pages/${uuid}$`)
      : method === 'POST' ? new RegExp(`^/v1/(?:oauth/(?:token|introspect|revoke)|search|pages|data_sources/${uuid}/query)$`) : null;
    if (target.origin !== 'https://api.notion.com' || target.username || target.password || target.hash || target.search
      || !allowed?.test(target.pathname) || /%(?:2f|5c|2e)/i.test(target.pathname)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    if ((method === 'PATCH' || (method === 'POST' && target.pathname === '/v1/pages')) && !write) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const headers = new Headers(init.headers); headers.set('notion-version', NOTION_API_VERSION); headers.set('accept', 'application/json'); headers.set('content-type', 'application/json');
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH')); }, this.timeoutMs); });
    try { return await Promise.race([this.receive(url, { ...init, headers, signal: abort.signal, redirect: 'error' }, write), deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  private async receive(url: string, init: RequestInit, write: boolean): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await this.transport(url, init); }
    catch { throw new ProviderRuntimeError(init.signal?.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 'AFTER_DISPATCH'); }
    let data: Record<string, unknown>;
    try {
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader?.cancel().catch(() => undefined); }; init.signal?.addEventListener('abort', cancel, { once: true });
      try { if (reader) while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 4 * 1024 * 1024) { cancel(); throw new Error('Response limit'); } chunks.push(next.value); } }
      finally { init.signal?.removeEventListener('abort', cancel); }
      if (init.signal?.aborted) throw new Error('Deadline');
      const text = Buffer.concat(chunks).toString('utf8'); const value: unknown = response.status === 204 && !text ? {} : JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object'); data = value as Record<string, unknown>;
    } catch {
      if (init.signal?.aborted) throw new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH');
      if (!response.ok) throw this.error(response, false);
      throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    }
    if (!response.ok) throw this.error(response, data.object === 'error' && data.status === response.status);
    if (response.status >= 300) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH');
    return data;
  }
  private error(response: Response, validBody: boolean) {
    let retryAfterMs: number | null = null;
    if (response.status === 429) { const retry = response.headers.get('retry-after'); const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
      retryAfterMs = Number.isSafeInteger(seconds) && seconds > 0 ? Math.max(1000, seconds * 1000) : 60_000; }
    const code: ProviderRuntimeErrorCode = response.status === 429 ? 'RATE_LIMITED' : response.status === 401 ? 'AUTH_EXPIRED'
      : response.status === 404 ? 'RESOURCE_NOT_FOUND' : [400, 403, 409, 422].includes(response.status) ? 'PERMISSION_DENIED'
      : [408, 504].includes(response.status) ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
    return new NotionApiError(code, retryAfterMs, validBody && response.status >= 400 && response.status < 500 && response.status !== 408, response.status);
  }
}
