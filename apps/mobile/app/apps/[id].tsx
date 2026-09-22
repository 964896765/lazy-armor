import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { discoverLaunchableApps, openDeviceApp, setNotificationSourceEnabled } from '../../src/device-app-bridge';
import { ActionButton, EmptyState, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';
import { ensureTrustedDevice } from '../../src/trusted-device-api';

interface DeviceAppConnection { id: string; trustedDeviceId: string | null; packageName: string; displayName: string; enabled: boolean; modes: string[]; lastSeenAt: string | null }
interface TrustedDeviceSummary { id: string; status: 'active' | 'revoked' }

export default function AppWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const deviceApps = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const trustedDevices = useQuery({ queryKey: ['trusted-devices', token], queryFn: () => api<TrustedDeviceSummary[]>('/trusted-devices', token), enabled: Boolean(token) });
  const discoveredApps = useQuery({ queryKey: ['app-workspace-discovered-apps'], queryFn: discoverLaunchableApps, enabled: Boolean(token && (deviceApps.data?.length ?? 0) > 0), staleTime: 5 * 60_000 });
  const app = deviceApps.data?.find((item) => item.id === id);
  const trustedDeviceStatus = trustedDevices.data?.find((device) => device.id === app?.trustedDeviceId)?.status;
  const iconUri = discoveredApps.data?.find((item) => item.packageName === app?.packageName)?.iconDataUri;

  const update = useMutation({
    mutationFn: async () => {
      setFeedback(null);
      if (app?.enabled) await setNotificationSourceEnabled(app.packageName, false);
      else if (trustedDeviceStatus === 'revoked') await ensureTrustedDevice(token ?? null, { force: true });
      return api<DeviceAppConnection>(`/device-app-connections/${app!.id}`, token, { method: 'PATCH', body: JSON.stringify({ enabled: !app!.enabled, ...(app!.enabled ? { modes: app!.modes.filter((mode) => mode !== 'notification_read') } : {}) }) });
    },
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['device-app-connections', token] }), client.invalidateQueries({ queryKey: ['rail-device-app-connections', token] })]);
      setFeedback(app?.enabled ? '连接已停用。' : '设备已重新验证，连接已启用。');
    },
    onError: () => setFeedback('这台设备暂时无法重新验证，连接仍保持停用。请稍后再试。'),
  });

  async function open() {
    setFeedback(null);
    const opened = await openDeviceApp(app!.packageName);
    setFeedback(opened ? '已打开应用。' : '无法打开该应用：请在 Android 真机确认它仍已安装。');
  }

  function changeEnabled() {
    if (app?.enabled || trustedDeviceStatus !== 'revoked') { update.mutate(); return; }
    Alert.alert('这台设备此前已被撤销', '重新使用此连接前，需要重新验证设备。', [{ text: '取消', style: 'cancel' }, { text: '重新验证并启用', onPress: () => update.mutate() }]);
  }

  if (!token) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><EmptyState icon="phone-portrait-outline" title="登录后查看应用" description="登录后可管理这台手机上的应用来源。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></SafeAreaView>;
  }
  if (deviceApps.isLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取应用信息…</Text></View></SafeAreaView>;
  }
  if (!app) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><EmptyState icon="help-circle-outline" title="没有找到这个应用" description="它可能已经断开或被移除。" action={{ label: '返回连接中心', onPress: () => router.replace('/connections' as never) }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <WorkspaceHeader title="应用" subtitle="这台手机上可交给懒人装甲使用的应用" onBack={() => router.back()} />
        <View style={styles.hero}>
          <View style={styles.heroIcon}>{iconUri ? <Image source={{ uri: iconUri }} style={styles.appIcon} /> : <Ionicons name="apps-outline" size={26} color={colors.primary} />}</View>
          <View style={styles.heroCopy}><View style={styles.heroTitleRow}><Text style={styles.heroTitle}>{app.displayName}</Text><Text style={[styles.status, !app.enabled && styles.statusWarning]}>{app.enabled ? '已连接' : '已停用'}</Text></View><Text style={styles.heroDetail}>{app.packageName}</Text></View>
        </View>

        <View style={styles.openBar}>
          <View style={styles.openCopy}><Text style={styles.openTitle}>直接打开这个应用</Text><Text style={styles.openDetail}>受控读取会话会在你允许的范围内进行。</Text></View>
          <ActionButton label="打开应用" onPress={() => void open()} disabled={!app.enabled} />
        </View>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

        <SectionTitle title="它能提供什么" />
        <View style={styles.card}>{app.modes.length > 0 ? app.modes.map((mode, index) => <InfoRow key={mode} icon={modeIcon(mode)} title={modeLabel(mode)} detail={modeDescription(mode)} last={index === app.modes.length - 1} />) : <Text style={styles.cardEmpty}>这个应用暂未声明可用能力。</Text>}</View>

        <SectionTitle title="隐私边界" />
        <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} /><Text style={styles.noticeText}>只使用你确认过的能力；真实数据必须来自通知、分享或受控读取，不会把“已安装”当成“已授权”。应用离开前台、会话过期或权限撤销时，采集会立即停止。</Text></View>

        <SectionTitle title="管理" />
        <View style={styles.actions}>
          {app.enabled ? <ActionButton label="受控读取" onPress={() => router.push({ pathname: '/connections/app-read-session', params: { connectionId: app.id, packageName: app.packageName, displayName: app.displayName, notificationEnabled: String(app.modes.includes('notification_read')) } } as unknown as Href)} /> : null}
          {app.enabled ? <ActionButton label="通知来源" tone="quiet" onPress={() => router.push('/connections/notification-sources' as Href)} /> : null}
          <ActionButton label={app.enabled ? '停用连接' : trustedDeviceStatus === 'revoked' ? '重新验证并启用' : '重新启用'} tone={app.enabled ? 'danger' : 'primary'} onPress={changeEnabled} disabled={update.isPending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title }: { title: string }) { return <Text style={styles.sectionTitle}>{title}</Text>; }

function InfoRow({ icon, title, detail, last = false }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; detail: string; last?: boolean }) {
  return <View style={[styles.infoRow, !last && styles.divider]}><View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View></View>;
}

function modeLabel(mode: string) {
  if (mode === 'notification_read') return '读取指定通知';
  if (mode === 'receive_share') return '接收分享内容';
  if (mode === 'open_app') return '打开应用';
  return '额外适配操作';
}

function modeDescription(mode: string) {
  if (mode === 'notification_read') return '只读取你选择的指定通知，用于账目、快递等现实线索。';
  if (mode === 'receive_share') return '接收你主动分享给懒人装甲的内容。';
  if (mode === 'open_app') return '通过受控会话打开应用，进行指定范围内的读取。';
  return '由系统按能力清单提供的操作。';
}

function modeIcon(mode: string): ComponentProps<typeof Ionicons>['name'] {
  if (mode === 'notification_read') return 'notifications-outline';
  if (mode === 'receive_share') return 'share-outline';
  if (mode === 'open_app') return 'open-outline';
  return 'ellipsis-horizontal';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  muted: { ...typography.caption, color: colors.textSecondary },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  heroIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  appIcon: { width: 46, height: 46, borderRadius: 14 },
  heroCopy: { flex: 1, minWidth: 0 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroTitle: { ...typography.title, color: colors.text, fontSize: 21 },
  status: { ...typography.label, color: colors.success, backgroundColor: colors.successSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusWarning: { color: colors.warning, backgroundColor: colors.warningSoft },
  heroDetail: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  openBar: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  openCopy: { flex: 1 },
  openTitle: { ...typography.bodyStrong, color: colors.text },
  openDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  feedback: { ...typography.caption, color: colors.warning, marginTop: spacing.md },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  cardEmpty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
  infoRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  noticeText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
