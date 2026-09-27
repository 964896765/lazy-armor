import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, resolveAppEnv } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, Surface, colors, radius, spacing, typography } from '../../src/design';
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
    <View pointerEvents="none" style={styles.decorLeft} /><View pointerEvents="none" style={styles.decorRight} />
    {router.canGoBack() ? <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Ionicons name="chevron-back" size={30} color={colors.text} /></Pressable> : <View style={styles.backPlaceholder} />}
    <View style={styles.brand}><View style={styles.logo}><Image source={require('../../assets/icon.png')} style={styles.logoImage} /></View></View>
    <Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>
    <Surface style={styles.form}>{children}</Surface>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FBFAF7' }, flex: { flex: 1 }, content: { flexGrow: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, overflow: 'hidden' },
  decorLeft: { position: 'absolute', width: 240, height: 240, left: -170, top: 20, borderRadius: 120, backgroundColor: '#F2EDE4' }, decorRight: { position: 'absolute', width: 260, height: 260, right: -170, bottom: -90, borderRadius: 130, backgroundColor: '#E8EEE5' },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, backPlaceholder: { height: 44 }, pressed: { opacity: 0.64 },
  brand: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg }, logo: { width: 118, height: 96, borderRadius: 36, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#506452', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 3 }, logoImage: { width: 132, height: 132 },
  title: { color: colors.text, fontSize: 32, lineHeight: 42, fontWeight: '700', textAlign: 'center', letterSpacing: -0.5 }, subtitle: { ...typography.body, color: '#718675', fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl }, form: { gap: spacing.sm, borderRadius: 28, padding: spacing.xl, backgroundColor: 'rgba(255,255,255,0.92)' },
  fieldLabel: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.xs }, input: { ...typography.body, minHeight: 54, color: colors.text, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FCFBF8', borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  error: { ...typography.caption, color: colors.danger }, success: { ...typography.body, color: colors.textSecondary, lineHeight: 22 }, infoBlock: { gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md }, infoTitle: { ...typography.bodyStrong, color: colors.text }, infoCopy: { ...typography.body, color: colors.textSecondary, lineHeight: 21 }, action: { marginTop: spacing.xs }, textLink: { ...typography.bodyStrong, color: colors.primary, textAlign: 'center', marginTop: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.lg }, footerText: { ...typography.body, color: colors.textSecondary }, strongLink: { ...typography.bodyStrong, color: colors.primary },
});
