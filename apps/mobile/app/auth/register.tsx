import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api } from '../../src/api';
import { fetchLoginMethods } from '../../src/auth-methods';
import { useAuthStore } from '../../src/auth-store';
import { ConsumerPresentationMapper as presentation } from '../../src/consumer-presentation';
import type { SessionTokens } from '../../src/secure-token-store';
import { AuthPage, styles } from './login';

export default function RegisterPage() {
  const [email, setEmail] = useState(''), [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const setSession = useAuthStore(state => state.setSession);
  const methods = useQuery({ queryKey: ['login-methods'], queryFn: fetchLoginMethods, staleTime: 60000 });
  const register = useMutation({ mutationFn: () => api<SessionTokens>('/auth/register', undefined, { method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), displayName: displayName.trim(), password }) }),
    onSuccess: async tokens => { await setSession(tokens, { onboardingRequired: true }); router.replace('/onboarding' as never); },
  });
  const disabled = register.isPending || !methods.data?.passwordRegistration || !email.trim() || !displayName.trim() || password.length < 10 || password !== confirmation;
  return <AuthPage title="注册邮箱账号" subtitle="设置账号与密码，完成后选择要连接的资源" backHref="/auth/password-login">
    <TextInput style={styles.input} accessibilityLabel="邮箱地址" placeholder="邮箱地址" value={email} onChangeText={setEmail}
      autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" maxLength={320} editable={!register.isPending} />
    <TextInput style={styles.input} accessibilityLabel="你的称呼" placeholder="你的称呼" value={displayName} onChangeText={setDisplayName} maxLength={120} editable={!register.isPending} />
    <TextInput style={styles.input} accessibilityLabel="设置密码" placeholder="密码，至少 10 个字符" value={password} onChangeText={setPassword}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" maxLength={128} editable={!register.isPending} />
    <TextInput style={styles.input} accessibilityLabel="确认密码" placeholder="再次输入密码" value={confirmation} onChangeText={setConfirmation}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" maxLength={128} editable={!register.isPending} />
    {confirmation && confirmation !== password ? <Text style={styles.notice}>两次输入的密码不一致。</Text> : null}
    {methods.data && !methods.data.passwordRegistration ? <Text style={styles.notice}>当前暂未开放邮箱注册，请登录已有账号。</Text> : null}
    {register.isError || methods.isError ? <Text style={styles.error}>{presentation.error(register.error ?? methods.error)}</Text> : null}
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => register.mutate()} style={[styles.submit, disabled && styles.submitDisabled]}><Text style={styles.submitText}>{register.isPending ? '正在注册…' : '注册并登录'}</Text></Pressable>
    <Link href={'/auth/password-login' as never} style={styles.textLink}>已有账号，去登录</Link>
  </AuthPage>;
}
