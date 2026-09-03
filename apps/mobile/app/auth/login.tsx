import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, Surface, colors, radius, spacing, typography } from '../../src/design';
import type { SessionTokens } from '../../src/secure-token-store';

export default function LoginPage() {
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<SessionTokens>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) }),
    onSuccess: async (tokens) => { await setSession(tokens); router.replace('/' as never); },
  });
  return <AuthPage title="欢迎回来" subtitle="登录后，继续让懒人装甲替你照看事情。">
    <TextInput style={styles.input} accessibilityLabel="邮箱" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="邮箱" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
    <TextInput style={styles.input} accessibilityLabel="密码" autoComplete="current-password" secureTextEntry placeholder="密码" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} />
    {login.isError ? <Text style={styles.error}>没有登录成功，请检查邮箱和密码后重试。</Text> : null}
    <View style={styles.action}><ActionButton label={login.isPending ? '登录中…' : '登录'} onPress={() => login.mutate()} disabled={login.isPending || !email.trim() || !password} /></View>
    <Link href={'/auth/forgot-password' as never} style={styles.textLink}>忘记密码？</Link>
    <View style={styles.footer}><Text style={styles.footerText}>第一次使用？</Text><Link href={'/auth/register' as never} style={styles.strongLink}>创建账号</Link></View>
  </AuthPage>;
}

export function AuthPage({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safeArea}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.brand}><View style={styles.logo}><Text style={styles.logoText}>懒</Text></View><Text style={styles.brandName}>懒人装甲</Text></View>
    <Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>
    <Surface style={styles.form}>{children}</Surface>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 }, content: { flexGrow: 1, justifyContent: 'center', padding: spacing.page, paddingVertical: spacing.xxxl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxxl }, logo: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, logoText: { color: colors.surface, fontWeight: '800', fontSize: 17 }, brandName: { ...typography.bodyStrong, color: colors.primary },
  title: { ...typography.display, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xxl }, form: { gap: spacing.md },
  input: { ...typography.body, color: colors.text, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 13 },
  error: { ...typography.caption, color: colors.danger }, action: { marginTop: spacing.xs }, textLink: { ...typography.bodyStrong, color: colors.primary, textAlign: 'center', marginTop: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.lg }, footerText: { ...typography.body, color: colors.textSecondary }, strongLink: { ...typography.bodyStrong, color: colors.primary },
});
