const API_URL = resolveApiUrl();

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
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    if (process.env.NODE_ENV === 'production') {
      let url: URL;
      try { url = new URL(configured); }
      catch { throw new Error('EXPO_PUBLIC_API_URL must be a valid production URL'); }
      const local = ['localhost', '127.0.0.1', '::1', '10.0.2.2'].includes(url.hostname.toLowerCase());
      if (local) throw new Error('EXPO_PUBLIC_API_URL must not point to localhost in production builds');
      if (url.protocol !== 'https:') throw new Error('EXPO_PUBLIC_API_URL must use HTTPS in production builds');
    }
    return configured.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EXPO_PUBLIC_API_URL is required in production builds');
  }
  return 'http://127.0.0.1:3001';
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
