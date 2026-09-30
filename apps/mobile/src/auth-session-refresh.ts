import { AppState } from 'react-native';
import { useEffect } from 'react';
import { useAuthStore } from './auth-store';

const REFRESH_MARGIN_MS = 120_000;

export function shouldRefreshAccessToken(state: { hydrated: boolean; refreshToken?: string; tokenExpiresAt?: number }, now = Date.now()): boolean {
  return Boolean(state.hydrated && state.refreshToken && (!state.tokenExpiresAt || state.tokenExpiresAt - now <= REFRESH_MARGIN_MS));
}

/** Refresh while foregrounded; never replay the request that encountered a 401. */
export function useAuthSessionRefresh() {
  useEffect(() => {
    const check = () => {
      const state = useAuthStore.getState();
      if (shouldRefreshAccessToken(state)) void state.refreshSession();
    };
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    const interval = setInterval(() => { if (AppState.currentState === 'active') check(); }, 30_000);
    check();
    return () => { subscription.remove(); clearInterval(interval); };
  }, []);
}
