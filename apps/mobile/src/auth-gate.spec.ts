import { describe, expect, it } from 'vitest';
import { resolveAuthDestination } from './auth-routing';

describe('resolveAuthDestination', () => {
  it('waits for secure storage hydration before redirecting', () => {
    expect(resolveAuthDestination({ hydrated: false, onboardingRequired: false })).toBeNull();
  });

  it('sends unauthenticated users to login but permits all recovery routes', () => {
    expect(resolveAuthDestination({ hydrated: true, onboardingRequired: false, segment: '(tabs)' })).toBe('/auth/login');
    expect(resolveAuthDestination({ hydrated: true, onboardingRequired: false, segment: 'auth' })).toBeNull();
  });

  it('requires newly registered users to complete onboarding before entering the app', () => {
    expect(resolveAuthDestination({ hydrated: true, token: 'access', onboardingRequired: true, segment: '(tabs)' })).toBe('/onboarding');
    expect(resolveAuthDestination({ hydrated: true, token: 'access', onboardingRequired: true, segment: 'onboarding' })).toBeNull();
  });

  it('keeps completed users out of auth and onboarding routes', () => {
    expect(resolveAuthDestination({ hydrated: true, token: 'access', onboardingRequired: false, segment: 'auth' })).toBe('/');
    expect(resolveAuthDestination({ hydrated: true, token: 'access', onboardingRequired: false, segment: 'onboarding' })).toBe('/');
    expect(resolveAuthDestination({ hydrated: true, token: 'access', onboardingRequired: false, segment: '(tabs)' })).toBeNull();
  });
});
