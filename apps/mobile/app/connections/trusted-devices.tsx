import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { deviceInstallationId } from '../../src/device-installation-id';
import { ActionButton, EmptyState, Surface, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

interface TrustedDevice {
  id: string;
  deviceId: string;
  keyId: string;
  publicKeyFingerprint: string;
  trustLevel: string;
  status: 'active' | 'revoked';
  lastProvedAt: string;
  revokedAt: string | null;
}

export default function TrustedDevicesPage() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const devices = useQuery({ queryKey: ['trusted-devices', token], queryFn: () => api<TrustedDevice[]>('/trusted-devices', token), enabled: Boolean(token) });
  const thisDevice = useQuery({ queryKey: ['resource-this-device'], queryFn: deviceInstallationId, enabled: Boolean(token) });
  const current = (devices.data ?? []).filter((device) => device.deviceId === thisDevice.data);
  const others = (devices.data ?? []).filter((device) => device.deviceId !== thisDevice.data);
  const revoke = useMutation({
    mutationFn: (device: TrustedDevice) => api<TrustedDevice>(`/trusted-devices/${device.id}/revoke`, token, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['trusted-devices', token] }),
        client.invalidateQueries({ queryKey: ['device-app-connections', token] }),
        client.invalidateQueries({ queryKey: ['rail-device-app-connections', token] }),
      ]);
    },
  });
  function confirmRevoke(device: TrustedDevice) {
    Alert.alert('撤销这台设备？', '它创建的手机应用连接会被停用，通知来源也会立即停止同步。以后可在这台设备上重新完成安全证明。', [
      { text: '取消', style: 'cancel' },
      { text: '撤销设备', style: 'destructive', onPress: () => revoke.mutate(device) },
    ]);
  }
  return <SafeAreaView style={styles.safeArea} edges={['top']}><ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <WorkspaceHeader title="设备" subtitle="管理你的设备与执行环境。" onBack={() => router.back()} action={<Pressable accessibilityRole="button" accessibilityLabel="添加设备连接" onPress={() => router.push('/connections/add' as never)} style={styles.addButton}><Ionicons name="add" size={22} color={colors.text} /></Pressable>} />
    {!token ? <Surface><EmptyState icon="log-in-outline" title="请先登录" description="登录后才能管理与你账号绑定的可信设备。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
    {token && devices.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
    {token && devices.isError ? <Surface><EmptyState icon="alert-circle-outline" title="暂时无法读取设备" description="没有修改任何设备或连接。请稍后再试。" action={{ label: '返回连接', onPress: () => router.replace('/connections') }} /></Surface> : null}
    {token && !devices.isLoading && !devices.isError && (devices.data?.length ?? 0) === 0 ? <Surface><EmptyState icon="phone-portrait-outline" title="尚未证明设备" description="在这台 Android 设备上确认添加一个真实应用时，会创建安全密钥证明。" action={{ label: '添加连接', onPress: () => router.push('/connections/add' as never) }} /></Surface> : null}
    {current.length > 0 ? <Text style={styles.sectionTitle}>当前设备</Text> : null}
    <View style={styles.list}>{current.map((device) => <Surface key={device.id}>
      <View style={styles.row}><View style={styles.deviceIcon}><Ionicons name="phone-portrait-outline" size={22} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.name}>当前手机</Text><Text style={[styles.status, device.status === 'active' ? styles.active : styles.revoked]}>{device.status === 'active' ? '已验证 · 本机执行' : '已撤销'}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></View>
      <Text style={styles.detail}>最近证明：{formatTime(device.lastProvedAt)}</Text>
      <Text style={styles.detail}>校验摘要：{shortFingerprint(device.publicKeyFingerprint)}</Text>
      <Text style={styles.detail}>{device.status === 'active' ? '可创建本机应用连接；每项通知来源仍须独立授权。' : `已于 ${device.revokedAt ? formatTime(device.revokedAt) : '此前'} 撤销，相关连接已停用。`}</Text>
      <View style={styles.action}><ActionButton label="查看手机任务" tone="quiet" onPress={() => router.push('/connections/device-tasks' as never)} />{device.status === 'active' ? <ActionButton label={revoke.isPending ? '正在撤销…' : '撤销这台设备'} tone="quiet" onPress={() => confirmRevoke(device)} disabled={revoke.isPending} /> : null}</View>
    </Surface>)}</View>
    {others.length > 0 ? <Text style={styles.sectionTitle}>其他设备</Text> : null}
    <View style={styles.list}>{others.map((device) => <Surface key={device.id}>
      <View style={styles.row}><View style={styles.deviceIcon}><Ionicons name="desktop-outline" size={22} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.name}>已绑定设备</Text><Text style={[styles.status, device.status === 'active' ? styles.active : styles.revoked]}>{device.status === 'active' ? '已验证' : '已撤销'} · 最近证明 {formatTime(device.lastProvedAt)}</Text></View></View>
      <Text style={styles.detail}>校验摘要：{shortFingerprint(device.publicKeyFingerprint)}</Text>
      {device.status === 'active' ? <View style={styles.action}><ActionButton label={revoke.isPending ? '正在撤销…' : '撤销这台设备'} tone="quiet" onPress={() => confirmRevoke(device)} disabled={revoke.isPending} /></View> : null}
    </Surface>)}</View>
    <Text style={styles.sectionTitle}>添加设备</Text>
    <Pressable onPress={() => router.push('/connections/add' as never)} style={styles.addRow}><Ionicons name="phone-portrait-outline" size={19} color={colors.text} /><View style={styles.copy}><Text style={styles.name}>连接这台手机上的应用</Text><Text style={styles.detail}>添加真实应用并完成本机安全证明</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>
    <Pressable onPress={() => router.push('/connections/device-tasks' as never)} style={styles.addRow}><Ionicons name="pulse-outline" size={19} color={colors.text} /><View style={styles.copy}><Text style={styles.name}>查看设备任务</Text><Text style={styles.detail}>检查本机执行与心跳</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>
  </ScrollView></SafeAreaView>;
}

function shortFingerprint(value: string) { return value.length === 64 ? `${value.slice(0, 12)}…${value.slice(-8)}` : '不可用'; }
function formatTime(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '不可用' : parsed.toLocaleString('zh-CN'); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.page, paddingBottom: 72 },
  addButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xxl },
  sectionTitle: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  list: { gap: spacing.sm }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, deviceIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.accentSoft }, copy: { flex: 1, gap: 2 }, name: { ...typography.bodyStrong, color: colors.text }, status: { ...typography.caption }, active: { color: colors.success }, revoked: { color: colors.textMuted },
  addRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }, action: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.lg },
});
