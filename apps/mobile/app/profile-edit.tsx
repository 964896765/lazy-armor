import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { colors, radius, spacing, typography } from '../src/design';
import { LoginRequired, RuntimeDetailScreen, RuntimeSection } from '../src/runtime-details-ui';

interface Profile {
  displayName: string;
  timezone?: string | null;
  locale?: string | null;
}

export default function ProfilePage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token) });
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.displayName);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api<Profile>('/me/profile', token, { method: 'PATCH', body: JSON.stringify({ displayName: displayName.trim() }) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me', token] });
      router.back();
    },
  });

  const canSave = displayName.trim().length > 0 && displayName.trim().length <= 120 && !save.isPending;

  return <RuntimeDetailScreen title="编辑资料" subtitle="修改账号在懒人装甲中的显示名称。">
    {!token ? <LoginRequired /> : profile.isLoading ? <ActivityIndicator color={colors.primary} /> : <RuntimeSection title="基本资料">
      <View style={styles.card}>
        <Text style={styles.label}>显示名称</Text>
        <TextInput
          accessibilityLabel="显示名称"
          autoCapitalize="words"
          maxLength={120}
          onChangeText={setDisplayName}
          placeholder="请输入显示名称"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={displayName}
        />
        <Text style={styles.hint}>该名称会显示在“我的”页面；不会改变登录凭据。</Text>
        {profile.isError ? <Text style={styles.error}>资料暂时无法读取，请稍后重试。</Text> : null}
        {save.isError ? <Text style={styles.error}>保存失败，原资料没有被修改。</Text> : null}
        <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => save.mutate()} style={({ pressed }) => [styles.save, !canSave && styles.saveDisabled, pressed && styles.pressed]}>
          <Text style={styles.saveText}>{save.isPending ? '保存中…' : '保存'}</Text>
        </Pressable>
      </View>
    </RuntimeSection>}
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  label: { ...typography.body, color: colors.text, marginBottom: spacing.sm },
  input: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, ...typography.body, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  save: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.primary },
  saveDisabled: { opacity: 0.38 },
  saveText: { ...typography.body, color: '#FFFFFF' },
  pressed: { opacity: 0.72 },
});
