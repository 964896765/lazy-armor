import { create } from 'zustand';
import { api, ApiError } from './api';
import { clearOnboardingState, clearTokens, loadAccessToken, loadOnboardingRequired, loadRefreshToken, persistOnboardingRequired, persistTokens, type SessionTokens } from './secure-token-store';

interface AuthState {
  token?: string;
  refreshToken?: string;
  hydrated: boolean;
  onboardingRequired: boolean;
  setSession: (tokens: SessionTokens, options?: { onboardingRequired?: boolean }) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  hydrate: () => Promise<void>;
  clear: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: undefined,
  refreshToken: undefined,
  hydrated: false,
  onboardingRequired: false,
  setSession: async (tokens, options) => {
    const onboardingRequired = options?.onboardingRequired ?? false;
    await Promise.all([persistTokens(tokens), persistOnboardingRequired(onboardingRequired)]);
    set({ token: tokens.accessToken, refreshToken: tokens.refreshToken, hydrated: true, onboardingRequired });
  },
  hydrate: async () => {
    const [token, refreshToken, onboardingRequired] = await Promise.all([loadAccessToken(), loadRefreshToken(), loadOnboardingRequired()]);
    set({ token, refreshToken, hydrated: true, onboardingRequired: Boolean(token && onboardingRequired) });
    if (!refreshToken) return;
    try {
      const rotated = await api<SessionTokens>('/auth/refresh', undefined, {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      await persistTokens(rotated);
      set({ token: rotated.accessToken, refreshToken: rotated.refreshToken, hydrated: true, onboardingRequired });
    } catch (error) {
      // Invalid/revoked refresh credentials are terminal; transient network
      // failures keep the locally restored session so the app can retry later.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await clearTokens();
        set({ token: undefined, refreshToken: undefined, hydrated: true, onboardingRequired: false });
      }
    }
  },
  completeOnboarding: async () => {
    await persistOnboardingRequired(false);
    set({ onboardingRequired: false });
  },
  clear: async () => {
    const refreshToken = useAuthStore.getState().refreshToken ?? await loadRefreshToken();
    if (refreshToken) {
      await api('/auth/logout', undefined, { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    }
    await Promise.all([clearTokens(), clearOnboardingState()]);
    set({ token: undefined, refreshToken: undefined, hydrated: true, onboardingRequired: false });
  },
}));
