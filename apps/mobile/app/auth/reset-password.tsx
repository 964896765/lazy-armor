import { useMutation } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { ActionButton, colors } from '../../src/design';
import { AuthPage, styles } from './login';

export default function ResetPasswordPage() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const deepLinkToken = typeof params.token === 'string' ? params.token : '';
  const [token, setToken] = useState(deepLinkToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordValid = newPassword.length >= 10;
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = useMemo(
    () => Boolean(token.trim() && passwordValid && passwordsMatch),
    [token, passwordValid, passwordsMatch],
  );
  const reset = useMutation({
    mutationFn: () => api<{ reset: boolean }>('/auth/reset-password', undefined, {
      method: 'POST',
      body: JSON.stringify({ token: token.trim(), newPassword }),
    }),
    onSuccess: () => router.replace('/auth/login' as never),
  });

  return <AuthPage title="设置新密码" subtitle="重置成功后，所有已登录设备都会退出。">
    <TextInput style={styles.input} accessibilityLabel="重置令牌" autoCapitalize="none" autoCorrect={false} placeholder="重置令牌" placeholderTextColor={colors.textMuted} value={token} onChangeText={setToken} />
    <TextInput style={styles.input} accessibilityLabel="新密码" autoComplete="new-password" secureTextEntry placeholder="至少 10 位新密码" placeholderTextColor={colors.textMuted} value={newPassword} onChangeText={setNewPassword} />
    <TextInput style={styles.input} accessibilityLabel="确认新密码" autoComplete="new-password" secureTextEntry placeholder="再次输入新密码" placeholderTextColor={colors.textMuted} value={confirmPassword} onChangeText={setConfirmPassword} />
    {newPassword.length > 0 && !passwordValid ? <Text style={styles.error}>新密码至少需要 10 位。</Text> : null}
    {confirmPassword.length > 0 && !passwordsMatch ? <Text style={styles.error}>两次输入的新密码不一致。</Text> : null}
    {reset.isError ? <Text style={styles.error}>重置令牌无效、已过期，或请求暂时无法处理。</Text> : null}
    <View style={styles.action}><ActionButton label={reset.isPending ? '重置中…' : '重置密码'} onPress={() => reset.mutate()} disabled={reset.isPending || !canSubmit} /></View>
    <View style={styles.footer}><Text style={styles.footerText}>没有收到邮件？</Text><Link href={'/auth/forgot-password' as never} style={styles.strongLink}>重新请求</Link></View>
  </AuthPage>;
}
