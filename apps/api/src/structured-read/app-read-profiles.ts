import { assertAppReadProfile, type AppReadProfile } from '@lazy-armor/plan-schema';

/**
 * R6 App Read Profiles. Each profile explicitly declares what a controlled
 * Android structured read may extract; it is never an authorization grant on
 * its own. Wildcard selectors and all-text / entire-screen dumps are forbidden
 * by the shared contract (`assertAppReadProfile`).
 */
export const ANDROID_STRUCTURED_READ_PROFILES: readonly AppReadProfile[] = Object.freeze([
  Object.freeze({
    packageName: 'com.eg.android.AlipayGphone',
    profileKey: 'alipay.wallet',
    resourceType: 'AlipayWallet',
    factKeys: ['wallet.balance', 'transaction.latest.amount', 'transaction.latest.time'],
    allowedSelectors: ['wallet.balance', 'transaction.latest.amount', 'transaction.latest.time'],
    requiredForeground: true,
    sensitiveFields: ['paymentPassword', 'loginPassword'],
    blockedFields: ['paymentPassword', 'loginPassword'],
    parserId: 'generic.structured-read.v1',
    verificationPolicy: 'STRUCTURED_WITH_SCREEN_CAPTURE_FALLBACK',
  } as AppReadProfile),
  Object.freeze({
    packageName: 'com.lazyarmor.fixture.wallet',
    profileKey: 'fixture.wallet',
    resourceType: 'FixtureWallet',
    factKeys: ['wallet.balance', 'transaction.latest.amount', 'transaction.latest.time'],
    allowedSelectors: ['wallet.balance', 'transaction.latest.amount', 'transaction.latest.time'],
    requiredForeground: true,
    sensitiveFields: ['paymentPassword', 'loginPassword'],
    blockedFields: ['paymentPassword', 'loginPassword'],
    parserId: 'generic.structured-read.v1',
    verificationPolicy: 'STRUCTURED_THEN_VISION',
  } as AppReadProfile),
] as AppReadProfile[]);

for (const profile of ANDROID_STRUCTURED_READ_PROFILES) assertAppReadProfile(profile);

export function resolveAppReadProfile(packageName: string): AppReadProfile | null {
  return ANDROID_STRUCTURED_READ_PROFILES.find((profile) => profile.packageName === packageName) ?? null;
}
