import { ProviderRuntimeError, type ProviderRuntimeErrorCode } from '@lazy-armor/connector-sdk';

export type GoogleTransport = (url: string, init: RequestInit) => Promise<Response>;
export const GOOGLE_TRANSPORT = Symbol('GOOGLE_TRANSPORT');
const allowedOrigins = new Set(['https://oauth2.googleapis.com', 'https://gmail.googleapis.com']);
const codes: Record<string, ProviderRuntimeErrorCode> = {
  invalid_grant: 'AUTH_REVOKED', invalid_token: 'AUTH_EXPIRED', insufficientPermissions: 'SCOPE_MISSING',
  authError: 'AUTH_EXPIRED', rateLimitExceeded: 'RATE_LIMITED', userRateLimitExceeded: 'RATE_LIMITED',
  dailyLimitExceeded: 'QUOTA_EXCEEDED', quotaExceeded: 'QUOTA_EXCEEDED', notFound: 'RESOURCE_NOT_FOUND',
  forbidden: 'PERMISSION_DENIED', backendError: 'PROVIDER_UNAVAILABLE',
};

// Fixed Google origins only. Tests inject transport, never alternate production URLs.
// No implicit retries: especially token exchange, refresh, revoke and Gmail writes.
export class GoogleHttpClient {
  constructor(private readonly transport: GoogleTransport = (url, init) => fetch(url, init), private readonly timeoutMs = 10_000) {}
  async request(url: string, init: RequestInit = {}, write = false): Promise<Record<string, unknown>> {
    const target = new URL(url);
    if (!allowedOrigins.has(target.origin) || target.username || target.password || target.hash) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    let response: Response;
    try { response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch (error) { throw new ProviderRuntimeError(error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK_ERROR', 'AFTER_DISPATCH'); }
    let data: Record<string, unknown> = {};
    try {
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Response limit'); } chunks.push(next.value); } }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) { const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid object'); data = parsed as Record<string, unknown>; }
    } catch { throw new ProviderRuntimeError(write ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', 'AFTER_DISPATCH'); }
    if (!response.ok) {
      const error = data.error; const detail = error && typeof error === 'object' ? error as Record<string, unknown> : {};
      const errors = Array.isArray(detail.errors) ? detail.errors : [];
      const reason = typeof error === 'string' ? error : String((errors[0] as Record<string, unknown> | undefined)?.reason ?? '');
      const code = codes[reason] ?? (response.status === 401 ? 'AUTH_EXPIRED' : response.status === 403 ? 'PERMISSION_DENIED'
        : response.status === 404 ? 'RESOURCE_NOT_FOUND' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE');
      const header = response.headers.get('retry-after'); const seconds = header && /^\d+$/.test(header) ? Number(header) : NaN;
      const date = header ? Date.parse(header) - Date.now() : NaN;
      const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) && date > 0 ? date : null;
      // An authenticated explicit 4xx rejection is definitive; transport/5xx is not.
      throw new ProviderRuntimeError(code, 'AFTER_DISPATCH', retryAfter, response.status >= 400 && response.status < 500 && response.status !== 408);
    }
    return data;
  }
  form(path: 'token' | 'revoke', fields: Record<string, string>) {
    return this.request('https://oauth2.googleapis.com/' + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  }
}
