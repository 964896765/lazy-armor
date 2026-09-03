import { useRouter, useSegments } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from './auth-store';
import { colors, spacing, typography } from './design';

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const inAuth = segments[0] === 'auth';
  const inOnboarding = segments[0] === 'onboarding';
  const destination = !hydrated
    ? null
    : !token && !inAuth
      ? '/auth/login'
      : token && onboardingRequired && !inOnboarding
        ? '/onboarding'
        : token && !onboardingRequired && (inAuth || inOnboarding)
          ? '/'
          : null;

  useEffect(() => {
    if (destination) router.replace(destination as never);
  }, [destination, router]);

  if (!hydrated || destination) {
    return <View style={styles.loading}><View style={styles.mark}><Text style={styles.markText}>懒</Text></View><ActivityIndicator color={colors.primary} /><Text style={styles.copy}>正在准备你的懒人装甲…</Text></View>;
  }
  return children;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, backgroundColor: colors.background },
  mark: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  markText: { color: colors.surface, fontSize: 26, fontWeight: '800' },
  copy: { ...typography.body, color: colors.textSecondary },
});
