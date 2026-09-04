import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { ActionButton, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';

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
    <View style={styles.header}><Text style={styles.title}>可信设备</Text><Text style={styles.subtitle}>设备使用本机安全密钥完成证明。我们只显示校验摘要，不读取设备序列号或其他硬件标识。</Text></View>
    {!token ? <Surface><EmptyState icon="▣" title="请先登录" description="登录后才能管理与你账号绑定的可信设备。" action={{ label: '去登录', onPress: () => router.push('/auth/login') }} /></Surface> : null}
    {token && devices.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
    {token && devices.isError ? <Surface><EmptyState icon="!" title="暂时无法读取设备" description="没有修改任何设备或连接。请稍后再试。" action={{ label: '返回连接', onPress: () => router.replace('/connections') }} /></Surface> : null}
    {token && !devices.isLoading && !devices.isError && (devices.data?.length ?? 0) === 0 ? <Surface><EmptyState icon="▣" title="尚未证明设备" description="在这台 Android 设备上确认添加一个真实应用时，会创建安全密钥证明。" action={{ label: '添加连接', onPress: () => router.push('/connections/add') }} /></Surface> : null}
    <View style={styles.list}>{devices.data?.map((device) => <Surface key={device.id}>
      <View style={styles.row}><View style={styles.copy}><Text style={styles.name}>设备密钥</Text><Text style={[styles.status, device.status === 'active' ? styles.active : styles.revoked]}>{device.status === 'active' ? '已验证' : '已撤销'}</Text></View></View>
      <Text style={styles.detail}>最近证明：{formatTime(device.lastProvedAt)}</Text>
      <Text style={styles.detail}>校验摘要：{shortFingerprint(device.publicKeyFingerprint)}</Text>
      <Text style={styles.detail}>{device.status === 'active' ? '可创建本机应用连接；每项通知来源仍须独立授权。' : `已于 ${device.revokedAt ? formatTime(device.revokedAt) : '此前'} 撤销，相关连接已停用。`}</Text>
      {device.status === 'active' ? <View style={styles.action}><ActionButton label={revoke.isPending ? '正在撤销…' : '撤销这台设备'} tone="quiet" onPress={() => confirmRevoke(device)} disabled={revoke.isPending} /></View> : null}
    </Surface>)}</View>
  </ScrollView></SafeAreaView>;
}

function shortFingerprint(value: string) { return value.length === 64 ? `${value.slice(0, 12)}…${value.slice(-8)}` : '不可用'; }
function formatTime(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '不可用' : parsed.toLocaleString('zh-CN'); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.page, paddingBottom: 72 },
  header: { marginBottom: spacing.xxl }, title: { ...typography.display, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  list: { gap: spacing.md }, row: { flexDirection: 'row', justifyContent: 'space-between' }, copy: { gap: 2 }, name: { ...typography.cardTitle, color: colors.text }, status: { ...typography.caption }, active: { color: colors.success }, revoked: { color: colors.textMuted },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }, action: { alignItems: 'flex-start', marginTop: spacing.lg },
});
