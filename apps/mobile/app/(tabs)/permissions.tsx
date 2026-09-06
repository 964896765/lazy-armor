import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { capabilityDescription, capabilityLabel, connectionStatusLabel } from '../../src/connection-presenter';
import { EmptyState, Surface, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../../src/design';

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
        <WorkspaceHeader title="权限与安全" subtitle="查看每项信息为什么被使用" />

        {!token ? <Surface><EmptyState icon="🔐" title="登录后管理权限" action={{ label: '去登录', onPress: () => router.push('/connections') }} /></Surface> : null}
        {connections.isLoading || loadingDetails ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理授权范围…</Text></View> : null}
        {connections.isError ? <Surface><EmptyState icon="☁️" title="权限暂时加载失败" description="请稍后再试。" action={{ label: '重新加载', onPress: () => connections.refetch() }} /></Surface> : null}
        {connections.data?.length === 0 ? <Surface><EmptyState icon="🔐" title="还没有授予任何权限" description="连接服务后，你可以在这里逐项管理。" action={{ label: '去连接', onPress: () => router.push('/connections') }} /></Surface> : null}

        {connections.data?.map((connection) => {
          const detail = detailQueries.find((query) => query.data?.connectionId === connection.id)?.data;
          if (!detail || detail.permissions.length === 0) return null;
          return (
            <WorkspaceSection key={connection.id} title={connectionDisplayName(connection.connectorId, connection.connectorName)}>
              <View style={styles.connectionHeader}>
                <Text numberOfLines={1} style={styles.account}>{connection.externalAccountName}</Text>
                <Text style={styles.status}>{connectionStatusLabel(connection.status)}</Text>
              </View>
              <View style={styles.permissionList}>
                {detail.permissions.map((permission, index) => {
                  const plans = detail.plans.filter((plan) => plan.requiredCapabilities.includes(permission.capability)).map((plan) => plan.planName);
                  const label = capabilityLabel(connection.connectorId, permission.capability, permission.name);
                  return (
                    <View key={permission.capability} style={[styles.permissionRow, index < detail.permissions.length - 1 && styles.divider]}>
                      <View style={styles.resourceIcon}><Text style={styles.resourceIconText}>{permissionResourceLabel(connection.connectorId, permission.capability).slice(0, 1)}</Text></View>
                      <View style={styles.permissionCopy}>
                        <View style={styles.permissionTitleRow}><Text style={styles.resource}>{permissionResourceLabel(connection.connectorId, permission.capability)}</Text><Text style={styles.permissionState}>{permission.granted ? '已允许' : '已关闭'}</Text></View>
                        <Text style={styles.permissionName}>{label}</Text>
                        <Text numberOfLines={2} style={styles.description}>{capabilityDescription(connection.connectorId, permission.capability)}</Text>
                        <Text numberOfLines={1} style={styles.purpose}>用于：{plans.length > 0 ? plans.join('、') : '目前没有计划使用'}</Text>
                      </View>
                      <Pressable accessibilityRole="button" disabled={update.isPending} onPress={() => changePermission({ connectionId: connection.id, capability: permission.capability, granted: !permission.granted, label, plans })} style={({ pressed }) => [styles.action, permission.granted ? styles.actionQuiet : styles.actionPrimary, pressed && styles.pressed]}><Text style={[styles.actionText, !permission.granted && styles.actionTextPrimary]}>{permission.granted ? '关闭' : '开启'}</Text></Pressable>
                    </View>
                  );
                })}
              </View>
            </WorkspaceSection>
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
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 72 },
  loading: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  connectionHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.xs, paddingHorizontal: spacing.xs },
  account: { ...typography.caption, color: colors.textMuted, flex: 1 },
  status: { color: '#16834A', backgroundColor: '#E8F7EF', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, fontSize: 9, lineHeight: 13, fontWeight: '700' },
  permissionList: { backgroundColor: '#FFFFFF' },
  permissionRow: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  resourceIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  resourceIconText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  permissionCopy: { flex: 1, minWidth: 0 },
  permissionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resource: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  permissionState: { color: colors.textMuted, fontSize: 9, lineHeight: 13 },
  permissionName: { ...typography.caption, color: colors.text, marginTop: 2 },
  description: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 1 },
  purpose: { color: colors.primary, fontSize: 10, lineHeight: 15, marginTop: 2 },
  action: { minHeight: 30, minWidth: 42, paddingHorizontal: spacing.sm, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionQuiet: { backgroundColor: '#F2F4F7' },
  actionPrimary: { backgroundColor: colors.primary },
  actionText: { color: '#475467', fontSize: 10, lineHeight: 14, fontWeight: '700' },
  actionTextPrimary: { color: '#FFFFFF' },
  pressed: { opacity: 0.65 },
});
