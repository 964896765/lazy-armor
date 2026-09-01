import { create } from 'zustand';
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
  },
  clear: async () => {
    await clearTokens();
    set({ token: undefined, refreshToken: undefined, hydrated: true });
  },
}));
