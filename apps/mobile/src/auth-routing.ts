export interface AuthRouteState {
  hydrated: boolean;
  token?: string;
  onboardingRequired: boolean;
  segment?: string;
  authPage?: string;
}

export function resolveAuthDestination({ hydrated, token, onboardingRequired, segment, authPage }: AuthRouteState): string | null {
  const inAuth = segment === 'auth';
  const inOnboarding = segment === 'onboarding';
  const inOAuthCallback = segment === 'oauth';
  if (!hydrated) return null;
  // A recovery link must remain usable even when a native session was restored.
  // Only the server's single-use recovery token grants the password change.
  if (inAuth && (authPage === 'reset-password' || authPage === 'forgot-password')) return null;
  if (!token && !inAuth) return '/auth/welcome';
  if (token && onboardingRequired && !inOnboarding && !inOAuthCallback) return '/onboarding';
  if (token && !onboardingRequired && (inAuth || inOnboarding)) return '/';
  return null;
}
