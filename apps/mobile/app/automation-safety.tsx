import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ShellPage, styles } from '../src/shell';

interface Settings {
  automationSafety: {
    preferredMode: string;
    requireExtraConfirmationForHighRisk: boolean;
  };
}

const OPTIONS = [
  { key: 'notify_only', title: '只提醒我', description: '系统只告诉你结果，不替你动外部账号。' },
  { key: 'prepare_only', title: '替我准备好', description: '系统把草稿、清单或结果准备好，再交给你决定。' },
  { key: 'confirm_before_execute', title: '确认后执行', description: '会影响外部账号时先问你，再继续。' },
  { key: 'high_risk_extra_confirmation', title: '更高风险动作', description: '对更高风险动作保持更强确认，不会降低服务端风险。' },
] as const;

export default function AutomationSafetyPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['me-settings', token], queryFn: () => api<Settings>('/me/settings', token), enabled: Boolean(token) });
  const update = useMutation({
    mutationFn: (preferredMode: string) => api('/me/settings', token, {
      method: 'PATCH',
      body: JSON.stringify({ automationSafety: { preferredMode, requireExtraConfirmationForHighRisk: preferredMode === 'high_risk_extra_confirmation' } }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['me-settings', token] }),
  });

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="自动化安全等级" subtitle="这里调整的是你的偏好解释，不会降低服务端的 Risk、Approval 或 Permission 安全边界。">
        {settings.isLoading && <ActivityIndicator />}
        {OPTIONS.map((option) => (
          <View style={[styles.card, settings.data?.automationSafety.preferredMode === option.key ? local.active : null]} key={option.key}>
            <Text style={styles.cardTitle}>{option.title}</Text>
            <Text style={styles.cardText}>{option.description}</Text>
            <View style={local.action}>
              <Button title={settings.data?.automationSafety.preferredMode === option.key ? '当前使用中' : '使用这个偏好'} onPress={() => update.mutate(option.key)} disabled={update.isPending || settings.data?.automationSafety.preferredMode === option.key} />
            </View>
          </View>
        ))}
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  active: { borderColor: '#287052', borderWidth: 2 },
  action: { marginTop: 12 },
});
