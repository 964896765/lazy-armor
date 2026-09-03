import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, colors } from '../../src/design';
import type { SessionTokens } from '../../src/secure-token-store';
import { AuthPage, styles } from './login';

export default function RegisterPage() {
  const setSession = useAuthStore((state) => state.setSession);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordValid = password.length >= 10;
  const passwordsMatch = password === confirmPassword;
  const canSubmit = useMemo(
    () => Boolean(displayName.trim() && email.trim() && passwordValid && passwordsMatch),
    [displayName, email, passwordValid, passwordsMatch],
  );
  const register = useMutation({
    mutationFn: () => api<SessionTokens>('/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ displayName: displayName.trim(), email: email.trim(), password }),
    }),
    onSuccess: async (tokens) => {
      await setSession(tokens, { onboardingRequired: true });
      router.replace('/onboarding' as never);
    },
  });

  return <AuthPage title="创建你的装甲" subtitle="先建立账号；自动化始终由你授权、可查看、可停止。">
    <TextInput style={styles.input} accessibilityLabel="称呼" autoComplete="name" placeholder="怎么称呼你" placeholderTextColor={colors.textMuted} value={displayName} onChangeText={setDisplayName} maxLength={120} />
    <TextInput style={styles.input} accessibilityLabel="邮箱" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="邮箱" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
    <TextInput style={styles.input} accessibilityLabel="密码" autoComplete="new-password" secureTextEntry placeholder="至少 10 位密码" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} />
    <TextInput style={styles.input} accessibilityLabel="确认密码" autoComplete="new-password" secureTextEntry placeholder="再次输入密码" placeholderTextColor={colors.textMuted} value={confirmPassword} onChangeText={setConfirmPassword} />
    {password.length > 0 && !passwordValid ? <Text style={styles.error}>密码至少需要 10 位。</Text> : null}
    {confirmPassword.length > 0 && !passwordsMatch ? <Text style={styles.error}>两次输入的密码不一致。</Text> : null}
    {register.isError ? <Text style={styles.error}>账号暂时无法创建，请稍后再试或换用其他邮箱。</Text> : null}
    <View style={styles.action}><ActionButton label={register.isPending ? '创建中…' : '创建账号'} onPress={() => register.mutate()} disabled={register.isPending || !canSubmit} /></View>
    <View style={styles.footer}><Text style={styles.footerText}>已经有账号？</Text><Link href={'/auth/login' as never} style={styles.strongLink}>去登录</Link></View>
  </AuthPage>;
}
