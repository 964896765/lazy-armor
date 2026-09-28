import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ActionButton, colors, radius, spacing, typography } from '../src/design';
import { LoginRequired, RuntimeDetailScreen, RuntimeSection } from '../src/runtime-details-ui';

export default function ChangePasswordPage() {
  const token = useAuthStore((state) => state.token);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const valid = useMemo(() => oldPassword.length > 0 && newPassword.length >= 10 && newPassword === confirmPassword, [confirmPassword, newPassword, oldPassword]);
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', token, { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),
    onSuccess: () => { setOldPassword(''); setNewPassword(''); setConfirmPassword(''); },
  });

  return <RuntimeDetailScreen title="修改密码" subtitle="修改后其他已登录设备会退出，需要重新验证。">
    {!token ? <LoginRequired /> : <RuntimeSection title="登录密码"><View style={styles.card}>
      <Text style={styles.label}>当前密码</Text><TextInput accessibilityLabel="当前密码" secureTextEntry value={oldPassword} onChangeText={setOldPassword} style={styles.input} />
      <Text style={styles.label}>新密码</Text><TextInput accessibilityLabel="新密码" secureTextEntry value={newPassword} onChangeText={setNewPassword} placeholder="至少 10 位" placeholderTextColor={colors.textMuted} style={styles.input} />
      <Text style={styles.label}>确认新密码</Text><TextInput accessibilityLabel="确认新密码" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} style={styles.input} />
      {confirmPassword.length > 0 && confirmPassword !== newPassword ? <Text style={styles.error}>两次输入的新密码不一致。</Text> : null}
      {change.isError ? <Text style={styles.error}>密码修改失败，请确认当前密码是否正确。</Text> : null}
      {change.isSuccess ? <Text style={styles.success}>密码已修改。</Text> : null}
      <View style={styles.action}><ActionButton label={change.isPending ? '保存中…' : '保存新密码'} disabled={!valid || change.isPending} onPress={() => change.mutate()} /></View>
    </View></RuntimeSection>}
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, label: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.xs }, input: { minHeight: 50, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, ...typography.body, color: colors.text }, error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm }, success: { ...typography.caption, color: colors.success, marginTop: spacing.sm }, action: { marginTop: spacing.lg },
});
