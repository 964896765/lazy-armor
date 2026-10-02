export interface AuthRouteState {
  hydrated: boolean;
  token?: string;
  onboardingRequired: boolean;
  segment?: string;
}

export function resolveAuthDestination({ hydrated, token, onboardingRequired, segment }: AuthRouteState): string | null {
  const inAuth = segment === 'auth';
  const inOnboarding = segment === 'onboarding';
  const inOAuthCallback = segment === 'oauth';
  if (!hydrated) return null;
  if (!token && !inAuth) return '/auth/welcome';
  if (token && onboardingRequired && !inOnboarding && !inOAuthCallback) return '/onboarding';
  if (token && !onboardingRequired && (inAuth || inOnboarding)) return '/';
  return null;
}
