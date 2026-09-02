const API_URL = resolveApiUrl();
type MobileAppEnv = 'development' | 'staging' | 'production';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function resolveApiUrl(): string {
  const appEnv = resolveAppEnv();
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    if (appEnv === 'staging' || appEnv === 'production') {
      let url: URL;
      try { url = new URL(configured); }
      catch { throw new Error(`EXPO_PUBLIC_API_URL must be a valid ${appEnv} URL`); }
      const local = ['localhost', '127.0.0.1', '::1', '10.0.2.2'].includes(url.hostname.toLowerCase());
      if (local) throw new Error(`EXPO_PUBLIC_API_URL must not point to localhost in ${appEnv} builds`);
      if (url.protocol !== 'https:') throw new Error(`EXPO_PUBLIC_API_URL must use HTTPS in ${appEnv} builds`);
    }
    return configured.replace(/\/$/, '');
  }
  if (appEnv === 'staging' || appEnv === 'production') {
    throw new Error(`EXPO_PUBLIC_API_URL is required in ${appEnv} builds`);
  }
  return 'http://127.0.0.1:3001';
}

export function resolveAppEnv(): MobileAppEnv {
  const configured = process.env.EXPO_PUBLIC_APP_ENV?.trim().toLowerCase();
  if (configured === 'development' || configured === 'staging' || configured === 'production') return configured;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new ApiError(response.status, body?.code ?? 'REQUEST_FAILED', body?.message ?? `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
