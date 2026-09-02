import { create } from 'zustand';
import { api, ApiError } from './api';
import { clearTokens, loadAccessToken, loadRefreshToken, persistTokens, type SessionTokens } from './secure-token-store';

interface AuthState {
  token?: string;
  refreshToken?: string;
  hydrated: boolean;
  setSession: (tokens: SessionTokens) => Promise<void>;
  hydrate: () => Promise<void>;
  clear: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: undefined,
  refreshToken: undefined,
  hydrated: false,
  setSession: async (tokens) => {
    await persistTokens(tokens);
    set({ token: tokens.accessToken, refreshToken: tokens.refreshToken, hydrated: true });
  },
  hydrate: async () => {
    const [token, refreshToken] = await Promise.all([loadAccessToken(), loadRefreshToken()]);
    set({ token, refreshToken, hydrated: true });
    if (!refreshToken) return;
    try {
      const rotated = await api<SessionTokens>('/auth/refresh', undefined, {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      await persistTokens(rotated);
      set({ token: rotated.accessToken, refreshToken: rotated.refreshToken, hydrated: true });
    } catch (error) {
      // Invalid/revoked refresh credentials are terminal; transient network
      // failures keep the locally restored session so the app can retry later.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await clearTokens();
        set({ token: undefined, refreshToken: undefined, hydrated: true });
      }
    }
  },
  clear: async () => {
    const refreshToken = useAuthStore.getState().refreshToken ?? await loadRefreshToken();
    if (refreshToken) {
      await api('/auth/logout', undefined, { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    }
    await clearTokens();
    set({ token: undefined, refreshToken: undefined, hydrated: true });
  },
}));
