import { create } from 'zustand';
import { api, ApiError } from './api';
import { clearOnboardingState, clearTokens, loadAccessToken, loadOnboardingRequired, loadRefreshToken, persistOnboardingRequired, persistTokens, type SessionTokens } from './secure-token-store';
import { clearTrustedDeviceSession } from './trusted-device-api';

interface AuthState {
  token?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  hydrated: boolean;
  onboardingRequired: boolean;
  setSession: (tokens: SessionTokens, options?: { onboardingRequired?: boolean }) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  hydrate: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  clear: () => Promise<void>;
}

const REFRESH_FALLBACK_SECONDS = 900;
let refreshInFlight: Promise<boolean> | null = null;
function tokenExpiresAt(tokens: SessionTokens): number {
  const seconds = tokens.expiresIn;
  return Date.now() + (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : REFRESH_FALLBACK_SECONDS) * 1000;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: undefined,
  refreshToken: undefined,
  hydrated: false,
  onboardingRequired: false,
  setSession: async (tokens, options) => {
    const onboardingRequired = options?.onboardingRequired ?? false;
    await Promise.all([persistTokens(tokens), persistOnboardingRequired(onboardingRequired)]);
    clearTrustedDeviceSession();
    set({ token: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokenExpiresAt(tokens), hydrated: true, onboardingRequired });
  },
  hydrate: async () => {
    const [token, refreshToken, onboardingRequired] = await Promise.all([loadAccessToken(), loadRefreshToken(), loadOnboardingRequired()]);
    set({ token, refreshToken, tokenExpiresAt: undefined, hydrated: true, onboardingRequired: Boolean(token && onboardingRequired) });
    if (!refreshToken) return;
    await get().refreshSession();
  },
  refreshSession: async () => {
    if (refreshInFlight) return refreshInFlight;
    const refreshToken = get().refreshToken;
    if (!refreshToken) return false;
    refreshInFlight = (async () => {
      try {
        const rotated = await api<SessionTokens>('/auth/refresh', undefined, {
          method: 'POST', body: JSON.stringify({ refreshToken }),
        });
        // A logout or another login during the request must not resurrect the old account.
        if (get().refreshToken !== refreshToken) {
          if (rotated.refreshToken) await api('/auth/logout', undefined, { method: 'POST', body: JSON.stringify({ refreshToken: rotated.refreshToken }) }).catch(() => undefined);
          return false;
        }
        await persistTokens(rotated);
        clearTrustedDeviceSession();
        set({ token: rotated.accessToken, refreshToken: rotated.refreshToken, tokenExpiresAt: tokenExpiresAt(rotated), hydrated: true });
        return true;
      } catch (error) {
        // Invalid/revoked refresh credentials are terminal; transient network
        // failures keep the locally restored session so the app can retry later.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403) && get().refreshToken === refreshToken) {
          await clearTokens();
          clearTrustedDeviceSession();
          set({ token: undefined, refreshToken: undefined, tokenExpiresAt: undefined, hydrated: true, onboardingRequired: false });
        }
        return false;
      }
    })();
    try { return await refreshInFlight; }
    finally { refreshInFlight = null; }
  },
  completeOnboarding: async () => {
    await persistOnboardingRequired(false);
    set({ onboardingRequired: false });
  },
  clear: async () => {
    await refreshInFlight?.catch(() => undefined);
    const refreshToken = useAuthStore.getState().refreshToken ?? await loadRefreshToken();
    if (refreshToken) {
      await api('/auth/logout', undefined, { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    }
    await Promise.all([clearTokens(), clearOnboardingState()]);
    clearTrustedDeviceSession();
    set({ token: undefined, refreshToken: undefined, tokenExpiresAt: undefined, hydrated: true, onboardingRequired: false });
  },
}));
