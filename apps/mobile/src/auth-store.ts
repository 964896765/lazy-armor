import { create } from 'zustand';
import { api, ApiError } from './api';
import { clearOnboardingState, clearTokens, loadAccessToken, loadOnboardingRequired, loadRefreshToken, persistOnboardingRequired, persistTokens, type SessionTokens } from './secure-token-store';
import { clearTrustedDeviceSession, rotateTrustedDeviceSessionToken } from './trusted-device-api';

interface AuthState {
  token?: string;
  refreshToken?: string;
  userId?: string;
  tokenExpiresAt?: number;
  sessionScope: number;
  hydrated: boolean;
  onboardingRequired: boolean;
  setSession: (tokens: SessionTokens, options?: { onboardingRequired?: boolean }) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  hydrate: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  clear: () => Promise<void>;
}
let generation = 0;
let storageQueue: Promise<unknown> = Promise.resolve();
function writeStorage(work: () => Promise<unknown>) {
  const next = storageQueue.then(work, work);
  storageQueue = next.catch(() => undefined);
  return next;
}
let hydrateInFlight: Promise<void> | null = null;
let refreshInFlight: { generation: number; promise: Promise<boolean> } | null = null;
function tokenExpiresAt(tokens: SessionTokens): number {
  const seconds = tokens.expiresIn;
  return Date.now() + (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 900) * 1000;
}
async function revoke(refreshToken?: string) {
  if (refreshToken) await api('/auth/logout', undefined, { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  sessionScope: 0, hydrated: false, onboardingRequired: false,
  setSession: async (tokens, options) => {
    const current = ++generation;
    const onboardingRequired = options?.onboardingRequired ?? false;
    clearTrustedDeviceSession();
    set({ token: tokens.accessToken, refreshToken: tokens.refreshToken, userId: tokens.userId, tokenExpiresAt: tokenExpiresAt(tokens), hydrated: true, onboardingRequired, sessionScope: get().sessionScope + 1 });
    try {
      await writeStorage(async () => {
        if (generation !== current) return;
        await persistTokens(tokens);
        await persistOnboardingRequired(onboardingRequired);
      });
    } catch (error) {
      if (generation === current) await get().clear();
      throw error;
    }
  },
  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrateInFlight) return hydrateInFlight;
    const current = generation;
    hydrateInFlight = (async () => {
      await storageQueue;
      const [token, refreshToken, onboardingRequired] = await Promise.all([loadAccessToken(), loadRefreshToken(), loadOnboardingRequired()]);
      if (get().hydrated || generation !== current) return;
      set({ token, refreshToken, userId: undefined, tokenExpiresAt: undefined, hydrated: true, onboardingRequired: Boolean(token && onboardingRequired), sessionScope: get().sessionScope + 1 });
      if (refreshToken) await get().refreshSession();
    })();
    try { await hydrateInFlight; } finally { hydrateInFlight = null; }
  },
  refreshSession: async () => {
    const current = generation;
    if (refreshInFlight?.generation === current) return refreshInFlight.promise;
    const refreshToken = get().refreshToken;
    const userId = get().userId;
    if (!refreshToken) return false;
    const promise = (async () => {
      let rotated: SessionTokens | undefined;
      try {
        rotated = await api<SessionTokens>('/auth/refresh', undefined, { method: 'POST', body: JSON.stringify({ refreshToken }) });
        if (generation !== current || get().refreshToken !== refreshToken) { await revoke(rotated.refreshToken); return false; }
        if (userId && rotated.userId && userId !== rotated.userId) { await revoke(rotated.refreshToken); await get().clear(); return false; }
        await writeStorage(async () => { if (generation === current) await persistTokens(rotated!); });
        if (generation !== current) { await revoke(rotated.refreshToken); return false; }
        // Token rotation keeps the account workspace and trusted device intact.
        rotateTrustedDeviceSessionToken(get().token, rotated.accessToken);
        set({ token: rotated.accessToken, refreshToken: rotated.refreshToken, userId: rotated.userId ?? userId, tokenExpiresAt: tokenExpiresAt(rotated), hydrated: true });
        return true;
      } catch (error) {
        if (generation === current && ((error instanceof ApiError && [401,403].includes(error.status)) || rotated)) await get().clear();
        return false;
      }
    })();
    const pending = { generation: current, promise };
    refreshInFlight = pending;
    try { return await promise; } finally { if (refreshInFlight === pending) refreshInFlight = null; }
  },
  completeOnboarding: async () => {
    const current = generation;
    await writeStorage(async () => { if (generation === current) await persistOnboardingRequired(false); });
    if (generation === current) set({ onboardingRequired: false });
  },
  clear: async () => {
    const current = ++generation;
    const refreshToken = get().refreshToken;
    clearTrustedDeviceSession();
    set({ token: undefined, refreshToken: undefined, userId: undefined, tokenExpiresAt: undefined, hydrated: true, onboardingRequired: false, sessionScope: get().sessionScope + 1 });
    const cleanup = writeStorage(async () => {
      if (generation !== current) return;
      await Promise.all([clearTokens(), clearOnboardingState()]);
    });
    await Promise.all([cleanup, revoke(refreshToken)]);
  },
}));
