import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceAppCapabilities, deviceAppIntegration, type AppIntegrationCapability, type DeviceAppConnectionMode } from '@lazy-armor/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { createDeviceAppConnectionRequest } from '../../src/device-app-api-contract';
import { deviceDiscoveryStatus, discoverLaunchableApps, type DiscoveredDeviceApp } from '../../src/device-app-bridge';
import { deviceInstallationId } from '../../src/device-installation-id';
import { deviceBoundApi, ensureTrustedDevice } from '../../src/trusted-device-api';
import { ActionButton, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';

interface DeviceAppConnection { id: string; packageName: string; displayName: string; enabled: boolean; modes: DeviceAppConnectionMode[] }
type ConnectionKind = 'mobile_app' | 'online_service' | 'device';

export default function AddConnectionPage() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [kind, setKind] = useState<ConnectionKind>('mobile_app');
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const discovery = useQuery({ queryKey: ['device-launchable-apps'], queryFn: discoverLaunchableApps, enabled: Boolean(token), staleTime: 60_000 });
  const existing = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const selected = useMemo(() => (discovery.data ?? []).find((app) => app.packageName === selectedPackage) ?? null, [discovery.data, selectedPackage]);
  const alreadyAdded = selected ? (existing.data ?? []).some((item) => item.packageName === selected.packageName) : false;
  const add = useMutation({
    mutationFn: async (app: DiscoveredDeviceApp) => {
      if (!token) throw new Error('AUTH_REQUIRED');
      const deviceId = await deviceInstallationId();
      const trustedDevice = await ensureTrustedDevice(token);
      const request = createDeviceAppConnectionRequest(deviceId, trustedDevice.id, app);
      if (!request) throw new Error('当前应用的发现或设备证明信息不完整。');
      return deviceBoundApi<DeviceAppConnection>('/device-app-connections', token, { method: 'POST', body: JSON.stringify(request) });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['device-app-connections', token] }),
        client.invalidateQueries({ queryKey: ['rail-device-app-connections', token] }),
      ]);
      router.replace('/connections' as never);
    },
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.header}><Text style={styles.title}>添加连接</Text><Text style={styles.subtitle}>从这台手机的真实可启动应用中选择。你未选择的应用不会被保存，也不会出现在你的空间导航中。</Text></View>
        {!token ? <Surface><EmptyState icon="＋" title="请先登录" description="添加连接前需要确认这是你的账号与设备。" action={{ label: '去登录', onPress: () => router.push('/auth/login') }} /></Surface> : null}
        {token ? <>
          <View style={styles.kindTabs}>{([['mobile_app', '手机应用'], ['online_service', '在线服务'], ['device', '设备、车辆与家庭']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" onPress={() => setKind(value)} style={[styles.kindTab, kind === value && styles.kindTabSelected]}><Text style={[styles.kindText, kind === value && styles.kindTextSelected]}>{label}</Text></Pressable>)}</View>
          {kind === 'mobile_app' ? <MobileAppDiscovery selected={selected} apps={discovery.data ?? []} discoveryLoading={discovery.isLoading} discoveryError={discovery.isError} alreadyAdded={alreadyAdded} addPending={add.isPending} addError={add.isError} onSelect={setSelectedPackage} onAdd={() => selected && add.mutate(selected)} /> : null}
          {kind === 'online_service' ? <ConnectionTypePlaceholder title="在线服务" description="邮箱、日历和文件服务继续通过已审核的 OAuth 或文件授权流程连接。" actionLabel="查看在线服务" onPress={() => router.replace('/connections' as never)} /> : null}
          {kind === 'device' ? <ConnectionTypePlaceholder title="设备、车辆与家庭" description="设备、车辆和家庭资源会先以你主动添加的资料与授权连接为准；每项读取和操作都会单独验证。" actionLabel="管理我的资料" onPress={() => router.push('/devices' as never)} /> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MobileAppDiscovery({ selected, apps, discoveryLoading, discoveryError, alreadyAdded, addPending, addError, onSelect, onAdd }: {
  selected: DiscoveredDeviceApp | null; apps: DiscoveredDeviceApp[]; discoveryLoading: boolean; discoveryError: boolean; alreadyAdded: boolean; addPending: boolean; addError: boolean; onSelect: (packageName: string) => void; onAdd: () => void;
}) {
  const unavailable = deviceDiscoveryStatus() === 'unavailable';
  return <>
    <Text style={styles.sectionTitle}>这台设备上的可启动应用</Text>
    <Text style={styles.sectionDescription}>应用列表来自 Android 系统。部分应用可以获得额外适配，但所有已发现的可启动应用都能添加基础连接。</Text>
    {discoveryLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在读取这台设备上的应用…</Text></View> : null}
    {unavailable ? <Surface><EmptyState icon="▣" title="暂时无法读取设备应用" description="请在包含原生模块的 Android 构建中打开此页；Web、iOS 或 Expo Go 不会显示虚构的应用列表。" /></Surface> : null}
    {!unavailable && discoveryError ? <Surface><EmptyState icon="☁" title="暂时无法读取应用" description="没有保存任何应用。请稍后重新打开本页。" /></Surface> : null}
    {!unavailable && !discoveryLoading && !discoveryError && apps.length === 0 ? <Surface><EmptyState icon="▣" title="没有可添加的应用" description="系统没有返回其他可启动应用，因此不会显示示例或测试列表。" /></Surface> : null}
    {apps.length > 0 ? <View style={styles.catalog}>{apps.map((app, index) => <AppRow key={app.packageName} app={app} selected={selected?.packageName === app.packageName} last={index === apps.length - 1} onPress={() => onSelect(app.packageName)} />)}</View> : null}
    {selected ? <ConnectionPreview app={selected} alreadyAdded={alreadyAdded} pending={addPending} hasError={addError} onAdd={onAdd} /> : null}
  </>;
}

function AppRow({ app, selected, last, onPress }: { app: DiscoveredDeviceApp; selected: boolean; last: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.appRow, !last && styles.rowDivider, selected && styles.appRowSelected, pressed && styles.pressed]}>
    <View style={styles.appIcon}>{app.iconDataUri ? <Image source={{ uri: app.iconDataUri }} style={styles.appImage} /> : <Text style={styles.appIconText}>{app.displayName.slice(0, 1)}</Text>}</View>
    <View style={styles.appCopy}><Text style={styles.appName}>{app.displayName}</Text><Text style={styles.appMeta}>{app.versionName ? `版本 ${app.versionName}` : '已由设备发现'}</Text></View><Text style={styles.chevron}>›</Text>
  </Pressable>;
}

function ConnectionPreview({ app, alreadyAdded, pending, hasError, onAdd }: { app: DiscoveredDeviceApp; alreadyAdded: boolean; pending: boolean; hasError: boolean; onAdd: () => void }) {
  const integration = deviceAppIntegration(app.packageName);
  const operations = deviceAppCapabilities(app.packageName);
  return <View style={styles.preview}><Text style={styles.sectionTitle}>添加 {app.displayName}</Text><Surface>
    <Text style={styles.previewIntro}>确认前会由这台设备的安全密钥完成一次证明。基础连接只保存你确认的应用快照，并且只能在你主动操作时打开应用。它不会读取该应用内容或通知。</Text>
    {integration ? <Text style={styles.adapterNote}>此应用可在后续获得额外适配；额外读取或操作仍需单独说明与授权。</Text> : <Text style={styles.adapterNote}>这是通用应用连接。即使没有专属适配，也可以安全地加入你的空间导航。</Text>}
    <View style={styles.capabilityList}>{operations.map((operation, index) => <OperationRow key={operation.mode} operation={operation} last={index === operations.length - 1} />)}</View>
    <View style={styles.previewAction}>{alreadyAdded ? <Text style={styles.addedText}>此应用已添加到当前设备。请返回连接中心管理它。</Text> : <ActionButton label={pending ? '正在添加…' : '确认添加'} onPress={onAdd} disabled={pending} />}</View>
    {hasError ? <Text style={styles.error}>暂时无法添加，账号和设备没有被修改。请稍后再试。</Text> : null}
  </Surface><Text style={styles.safetyText}>添加连接不等于授予所有权限。通知读取、页面跳转或任何外部操作都需要单独说明、单独授权并验证结果。</Text></View>;
}

function OperationRow({ operation, last }: { operation: AppIntegrationCapability; last: boolean }) {
  return <View style={[styles.capabilityRow, !last && styles.rowDivider]}><View style={styles.capabilityCopy}><Text style={styles.capabilityName}>{operation.label}</Text><Text style={styles.capabilityDescription}>{operation.description}</Text><Text style={styles.capabilityMeta}>{operation.availability === 'available' ? '当前可用' : '后续支持'}{operation.requiresUserPermission ? ' · 需单独授权' : ''}</Text></View></View>;
}

function ConnectionTypePlaceholder({ title, description, actionLabel, onPress }: { title: string; description: string; actionLabel: string; onPress: () => void }) { return <Surface style={styles.placeholder}><Text style={styles.placeholderTitle}>{title}</Text><Text style={styles.placeholderCopy}>{description}</Text><View style={styles.previewAction}><ActionButton label={actionLabel} onPress={onPress} /></View></Surface>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 48 }, header: { marginBottom: spacing.xl }, title: { ...typography.display, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, maxWidth: 350 },
  kindTabs: { flexDirection: 'row', backgroundColor: '#ECE9E0', padding: 3, borderRadius: radius.md, marginBottom: spacing.xxl }, kindTab: { flex: 1, minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: 4 }, kindTabSelected: { backgroundColor: colors.surface }, kindText: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textAlign: 'center' }, kindTextSelected: { color: colors.primary, fontWeight: '800' },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }, sectionDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md }, loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md }, loadingText: { ...typography.caption, color: colors.textSecondary }, catalog: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
  appRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md }, appRowSelected: { backgroundColor: colors.successSoft }, rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border }, appIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, overflow: 'hidden' }, appImage: { width: 36, height: 36 }, appIconText: { color: colors.primary, fontSize: 15, fontWeight: '800' }, appCopy: { flex: 1 }, appName: { ...typography.bodyStrong, color: colors.text }, appMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, chevron: { color: colors.textMuted, fontSize: 25, fontWeight: '300' },
  preview: { marginTop: spacing.xl }, previewIntro: { ...typography.body, color: colors.textSecondary }, adapterNote: { ...typography.caption, color: colors.primary, marginTop: spacing.md, lineHeight: 18 }, capabilityList: { marginTop: spacing.md }, capabilityRow: { paddingVertical: spacing.md }, capabilityCopy: { flex: 1 }, capabilityName: { ...typography.bodyStrong, color: colors.text }, capabilityDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 }, capabilityMeta: { ...typography.caption, color: colors.warning, marginTop: spacing.xs }, previewAction: { alignItems: 'flex-start', marginTop: spacing.lg }, addedText: { ...typography.bodyStrong, color: colors.success }, error: { ...typography.caption, color: colors.danger, marginTop: spacing.md }, safetyText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginTop: spacing.md }, placeholder: { marginTop: spacing.xl }, placeholderTitle: { ...typography.cardTitle, color: colors.text }, placeholderCopy: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 }, pressed: { backgroundColor: colors.pressed },
});
