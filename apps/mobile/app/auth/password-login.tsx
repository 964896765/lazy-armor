import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api, resolveAppEnv } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { authError } from '../../src/auth-error';
import { normalizeLoginIdentifier } from '../../src/login-identifier';
import type { SessionTokens } from '../../src/secure-token-store';
import { AuthPage, styles } from './login';

export default function PasswordLoginPage() {
  const [identifier, setIdentifier] = useState(''), [password, setPassword] = useState('');
  const setSession = useAuthStore(state => state.setSession);
  const login = useMutation({
    mutationFn: () => api<SessionTokens>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: normalizeLoginIdentifier(identifier, resolveAppEnv()), password }) }),
    onSuccess: async tokens => { await setSession(tokens); router.replace('/schedule' as never); },
  });
  const disabled = login.isPending || !identifier.trim() || !password;
  return <AuthPage title="邮箱密码登录" subtitle="使用已有邮箱账号与密码" backHref="/auth/login">
    <TextInput style={styles.input} accessibilityLabel="邮箱账号" placeholder="邮箱地址" value={identifier} onChangeText={setIdentifier}
      autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" maxLength={320} editable={!login.isPending} />
    <TextInput style={styles.input} accessibilityLabel="密码" placeholder="密码" value={password} onChangeText={setPassword}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" maxLength={128} editable={!login.isPending} />
    {login.isError ? <Text style={styles.error}>{authError(login.error)}</Text> : null}
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => login.mutate()} style={[styles.submit, disabled && styles.submitDisabled]}><Text style={styles.submitText}>{login.isPending ? '登录中…' : '登录'}</Text></Pressable>
    <Link href={'/auth/login' as never} style={styles.textLink}>使用验证码登录</Link>
    <Link href={'/auth/forgot-password' as never} style={styles.textLink}>忘记密码</Link>
    <Text style={styles.notice}>新用户请使用验证码登录。登录后可在账号与验证中设置密码。</Text>
  </AuthPage>;
}
