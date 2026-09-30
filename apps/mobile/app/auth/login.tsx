import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, resolveAppEnv } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { normalizeLoginIdentifier } from '../../src/login-identifier';
import type { SessionTokens } from '../../src/secure-token-store';

export default function LoginPage() {
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<SessionTokens>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: normalizeLoginIdentifier(email, resolveAppEnv()), password }) }),
    onSuccess: async (tokens) => { await setSession(tokens); router.replace('/' as never); },
  });
  return <AuthPage title="登录与验证" subtitle="输入邮箱和密码，继续使用你的懒人装甲。">
    <Text style={styles.fieldLabel}>邮箱</Text>
    <TextInput style={styles.input} accessibilityLabel="账号或邮箱" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="账号或邮箱" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
    <Text style={styles.fieldLabel}>密码</Text>
    <TextInput style={styles.input} accessibilityLabel="密码" autoComplete="current-password" secureTextEntry placeholder="密码" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} />
    {login.isError ? <Text style={styles.error}>没有登录成功，请检查账号和密码后重试。</Text> : null}
    <View style={styles.action}><ActionButton label={login.isPending ? '登录中…' : '登录'} onPress={() => login.mutate()} disabled={login.isPending || !email.trim() || !password} /></View>
    <Link href={'/auth/forgot-password' as never} style={styles.textLink}>忘记密码？</Link>
    <View style={styles.footer}><Text style={styles.footerText}>第一次使用？</Text><Link href={'/auth/register' as never} style={styles.strongLink}>创建账号</Link></View>
  </AuthPage>;
}

export function AuthPage({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safeArea}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.topbar}>{router.canGoBack() ? <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Ionicons name="chevron-back" size={24} color={colors.text} /></Pressable> : <View style={styles.backPlaceholder} />}<View style={styles.brand}><View style={styles.logo}><Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} /></View><Text style={styles.brandName}>懒人装甲</Text></View><View style={styles.topbarBalance} /></View>
    <View style={styles.intro}><Text style={styles.eyebrow}>账号</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
    <View style={styles.form}>{children}</View>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 }, content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  topbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { width: 42, height: 42, marginLeft: -8, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, backPlaceholder: { width: 42, height: 42 }, topbarBalance: { width: 42 }, pressed: { opacity: 0.64 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, logo: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }, brandName: { ...typography.bodyStrong, color: colors.text, fontWeight: '600' },
  intro: { marginTop: spacing.xxxl }, eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: spacing.xs }, title: { ...typography.pageTitle, color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '600' }, subtitle: { ...typography.body, color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: spacing.sm }, form: { gap: spacing.sm, marginTop: spacing.xxl },
  fieldLabel: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.xs }, input: { ...typography.body, minHeight: 56, color: colors.text, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  error: { ...typography.caption, color: colors.danger, lineHeight: 19 }, success: { ...typography.body, color: colors.textSecondary, lineHeight: 22 }, infoBlock: { gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md }, infoTitle: { ...typography.bodyStrong, color: colors.text }, infoCopy: { ...typography.body, color: colors.textSecondary, lineHeight: 21 }, action: { marginTop: spacing.md }, textLink: { ...typography.bodyStrong, color: colors.primary, textAlign: 'center', marginTop: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xl }, footerText: { ...typography.body, color: colors.textSecondary }, strongLink: { ...typography.bodyStrong, color: colors.primary },
});
