import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { ActionButton, workspaceColors as colors } from '../../src/design';
import { AuthPage, styles } from './login';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const requestReset = useMutation({
    mutationFn: () => api<{ requested: boolean }>('/auth/forgot-password', undefined, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    }),
  });

  return <AuthPage title="找回密码" subtitle="输入注册邮箱，我们会发送安全重置邮件。">
    {requestReset.isSuccess ? <>
      <Text style={styles.success}>如果该邮箱对应一个账号且重置投递已启用，你将收到一封安全重置邮件。</Text>
      <Link href={'/auth/login' as never} style={styles.textLink}>返回登录</Link>
    </> : <>
      <Text style={styles.fieldLabel}>注册邮箱</Text><TextInput style={styles.input} accessibilityLabel="注册邮箱" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="注册邮箱" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
      {requestReset.isError ? <Text style={styles.error}>请求暂时无法处理，请稍后再试。</Text> : null}
      <View style={styles.action}><ActionButton label={requestReset.isPending ? '提交中…' : '发送重置邮件'} onPress={() => requestReset.mutate()} disabled={requestReset.isPending || !email.trim()} /></View>
      <View style={styles.footer}><Text style={styles.footerText}>想起密码了？</Text><Link href={'/auth/login' as never} style={styles.strongLink}>返回登录</Link></View>
    </>}
  </AuthPage>;
}
