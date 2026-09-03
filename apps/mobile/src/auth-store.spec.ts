import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  clearTokens: vi.fn(),
  clearOnboardingState: vi.fn(),
  loadAccessToken: vi.fn(),
  loadRefreshToken: vi.fn(),
  loadOnboardingRequired: vi.fn(),
  persistOnboardingRequired: vi.fn(),
  persistTokens: vi.fn(),
}));

vi.mock('./secure-token-store', () => ({
  clearTokens: mocks.clearTokens,
  clearOnboardingState: mocks.clearOnboardingState,
  loadAccessToken: mocks.loadAccessToken,
  loadRefreshToken: mocks.loadRefreshToken,
  loadOnboardingRequired: mocks.loadOnboardingRequired,
  persistOnboardingRequired: mocks.persistOnboardingRequired,
  persistTokens: mocks.persistTokens,
}));

vi.mock('./api', () => {
  class MockApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
      super(message);
    }
  }
  return { api: mocks.api, ApiError: MockApiError };
});

import { ApiError } from './api';
import { useAuthStore } from './auth-store';

describe('native session restart and rotation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loadOnboardingRequired.mockResolvedValue(false);
    useAuthStore.setState({ token: undefined, refreshToken: undefined, hydrated: false, onboardingRequired: false });
  });

  it('rotates persisted tokens after an application restart', async () => {
    mocks.loadAccessToken.mockResolvedValue('old-access');
    mocks.loadRefreshToken.mockResolvedValue('old-refresh');
    mocks.api.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    await useAuthStore.getState().hydrate();

    expect(mocks.api).toHaveBeenCalledWith('/auth/refresh', undefined, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ refreshToken: 'old-refresh' }),
    }));
    expect(mocks.persistTokens).toHaveBeenCalledWith({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(useAuthStore.getState()).toMatchObject({ token: 'new-access', refreshToken: 'new-refresh', hydrated: true });
  });

  it('clears revoked refresh credentials after restart', async () => {
    mocks.loadAccessToken.mockResolvedValue('expired-access');
    mocks.loadRefreshToken.mockResolvedValue('revoked-refresh');
    mocks.api.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'revoked'));

    await useAuthStore.getState().hydrate();

    expect(mocks.clearTokens).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ token: undefined, refreshToken: undefined, hydrated: true });
  });

  it('keeps the restored session on a transient network failure', async () => {
    mocks.loadAccessToken.mockResolvedValue('cached-access');
    mocks.loadRefreshToken.mockResolvedValue('cached-refresh');
    mocks.api.mockRejectedValue(new TypeError('network unavailable'));

    await useAuthStore.getState().hydrate();

    expect(mocks.clearTokens).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ token: 'cached-access', refreshToken: 'cached-refresh', hydrated: true });
  });

  it('attempts server revocation and always clears local credentials on logout', async () => {
    useAuthStore.setState({ token: 'access', refreshToken: 'refresh', hydrated: true });
    mocks.api.mockRejectedValue(new TypeError('offline'));

    await useAuthStore.getState().clear();

    expect(mocks.api).toHaveBeenCalledWith('/auth/logout', undefined, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ refreshToken: 'refresh' }),
    }));
    expect(mocks.clearTokens).toHaveBeenCalledOnce();
    expect(mocks.clearOnboardingState).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ token: undefined, refreshToken: undefined, hydrated: true, onboardingRequired: false });
  });

  it('persists onboarding for a new registration and clears it on completion', async () => {
    await useAuthStore.getState().setSession({ accessToken: 'access', refreshToken: 'refresh' }, { onboardingRequired: true });
    expect(mocks.persistOnboardingRequired).toHaveBeenCalledWith(true);
    expect(useAuthStore.getState().onboardingRequired).toBe(true);

    await useAuthStore.getState().completeOnboarding();
    expect(mocks.persistOnboardingRequired).toHaveBeenCalledWith(false);
    expect(useAuthStore.getState().onboardingRequired).toBe(false);
  });
});
