import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { capabilityDescription, capabilityLabel, connectionStatusLabel } from '../src/connection-presenter';
import { ActionButton, EmptyState, Surface, colors, radius, spacing, typography } from '../src/design';

interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string; status: string }
interface Permission { capability: string; name: string; granted: boolean }
interface ConnectionPlanUsage { planId: string; planName: string; requiredCapabilities: string[] }

export default function PermissionsPage() {
  const token = useAuthStore((store) => store.token);
  const queryClient = useQueryClient();
  const connections = useQuery({ queryKey: ['permission-connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const detailQueries = useQueries({
    queries: (connections.data ?? []).map((connection) => ({
      queryKey: ['permission-detail', connection.id],
      queryFn: async () => ({ connectionId: connection.id, permissions: await api<Permission[]>(`/connections/${connection.id}/permissions`, token), plans: await api<ConnectionPlanUsage[]>(`/connections/${connection.id}/plans`, token) }),
      enabled: Boolean(token),
    })),
  });
  const update = useMutation({
    mutationFn: (input: { connectionId: string; capability: string; granted: boolean }) => api(`/connections/${input.connectionId}/permissions`, token, { method: 'PUT', body: JSON.stringify({ permissions: [{ capability: input.capability, granted: input.granted }] }) }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['permission-detail', variables.connectionId] });
      void queryClient.invalidateQueries({ queryKey: ['connections', token] });
    },
  });
  const loadingDetails = detailQueries.some((query) => query.isLoading);

  function changePermission(input: { connectionId: string; capability: string; granted: boolean; label: string; plans: string[] }) {
    if (input.granted) { update.mutate(input); return; }
    const impact = input.plans.length > 0 ? `${input.plans.map((plan) => `“${plan}”`).join('、')}会暂停使用这项信息。` : '当前没有计划在使用这项信息。';
    Alert.alert(`关闭“${input.label}”？`, `${impact} 你之后可以随时重新开启。`, [
      { text: '保留', style: 'cancel' },
      { text: '关闭', style: 'destructive', onPress: () => update.mutate(input) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>权限</Text>
          <Text style={styles.subtitle}>清楚知道懒人装甲能看什么、为什么需要，以及哪些计划正在使用。</Text>
        </View>

        {!token ? <Surface><EmptyState icon="🔐" title="登录后管理权限" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : null}
        {connections.isLoading || loadingDetails ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理授权范围…</Text></View> : null}
        {connections.isError ? <Surface><EmptyState icon="☁️" title="权限暂时加载失败" description="请稍后再试。" action={{ label: '重新加载', onPress: () => connections.refetch() }} /></Surface> : null}
        {connections.data?.length === 0 ? <Surface><EmptyState icon="🔐" title="还没有授予任何权限" description="连接服务后，你可以在这里逐项管理。" action={{ label: '去连接', onPress: () => router.push('/connections') }} /></Surface> : null}

        {connections.data?.map((connection) => {
          const detail = detailQueries.find((query) => query.data?.connectionId === connection.id)?.data;
          if (!detail || detail.permissions.length === 0) return null;
          return (
            <View key={connection.id} style={styles.connectionGroup}>
              <View style={styles.connectionHeader}>
                <View><Text style={styles.connectionName}>{connectionDisplayName(connection.connectorId, connection.connectorName)}</Text><Text style={styles.account}>{connection.externalAccountName}</Text></View>
                <Text style={styles.status}>{connectionStatusLabel(connection.status)}</Text>
              </View>
              <View style={styles.permissionList}>
                {detail.permissions.map((permission) => {
                  const plans = detail.plans.filter((plan) => plan.requiredCapabilities.includes(permission.capability)).map((plan) => plan.planName);
                  const label = capabilityLabel(connection.connectorId, permission.capability, permission.name);
                  return (
                    <Surface key={permission.capability}>
                      <Text style={styles.resource}>{permissionResourceLabel(connection.connectorId, permission.capability)}</Text>
                      <Text style={styles.metaLabel}>允许</Text>
                      <Text style={styles.permissionName}>{label}</Text>
                      <Text style={styles.description}>{capabilityDescription(connection.connectorId, permission.capability)}</Text>
                      <Text style={styles.metaLabel}>用途</Text>
                      <Text style={styles.purpose}>{plans.length > 0 ? plans.join('、') : '目前没有计划使用'}</Text>
                      <View style={styles.action}><ActionButton label={permission.granted ? '关闭' : '重新开启'} tone={permission.granted ? 'quiet' : 'primary'} onPress={() => changePermission({ connectionId: connection.id, capability: permission.capability, granted: !permission.granted, label, plans })} disabled={update.isPending} /></View>
                    </Surface>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function permissionResourceLabel(provider: string, capability: string) {
  if (provider === 'gmail' || capability.includes('EMAIL')) return '邮箱';
  if (provider === 'google_calendar' || provider === 'calendar' || capability.includes('EVENT')) return '日历';
  if (capability.includes('FILE')) return '文件';
  if (capability.includes('CONTENT') || capability.includes('PUBLISH')) return '内容平台';
  if (capability.includes('TRACKING')) return '快递信息';
  return '计划信息';
}

function connectionDisplayName(key: string, fallback: string) {
  if (key === 'gmail') return 'Google 邮箱';
  if (key === 'google_calendar' || key === 'calendar') return 'Google 日历';
  return fallback;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 72 },
  header: { marginBottom: spacing.xxl },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, maxWidth: 340 },
  loading: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  connectionGroup: { marginTop: spacing.xxl },
  connectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md, paddingHorizontal: spacing.xs },
  connectionName: { ...typography.section, color: colors.text },
  account: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  status: { ...typography.caption, color: colors.success, backgroundColor: colors.successSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  permissionList: { gap: spacing.md },
  resource: { ...typography.cardTitle, color: colors.text },
  metaLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs },
  permissionName: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  purpose: { ...typography.body, color: colors.primary },
  action: { alignItems: 'flex-end', marginTop: spacing.lg },
});
