import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SUPPORTED_DEVICE_APPS, type DeviceAppConnectionMode, type SupportedDeviceApp } from '@lazy-armor/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { createDeviceAppConnectionRequest } from '../../src/device-app-api-contract';
import { detectSupportedDeviceApps, type DeviceAppDetection } from '../../src/device-app-bridge';
import { deviceInstallationId } from '../../src/device-installation-id';
import { ActionButton, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';

interface DeviceAppConnection { id: string; packageName: string; displayName: string; enabled: boolean; modes: DeviceAppConnectionMode[] }

type ConnectionKind = 'mobile_app' | 'online_service' | 'device';

export default function AddConnectionPage() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [kind, setKind] = useState<ConnectionKind>('mobile_app');
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const detected = useQuery({
    queryKey: ['supported-device-app-detection'],
    queryFn: () => detectSupportedDeviceApps(SUPPORTED_DEVICE_APPS.map((app) => app.packageName)),
    staleTime: 60_000,
  });
  const existing = useQuery({
    queryKey: ['device-app-connections', token],
    queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token),
    enabled: Boolean(token),
  });
  const detectionByPackage = useMemo(() => new Map((detected.data ?? []).map((item) => [item.packageName, item])), [detected.data]);
  const selected = SUPPORTED_DEVICE_APPS.find((app) => app.packageName === selectedPackage) ?? null;
  const selectedDetection = selected ? detectionByPackage.get(selected.packageName) : undefined;
  const alreadyAdded = selected ? (existing.data ?? []).some((item) => item.packageName === selected.packageName && item.enabled) : false;
  const add = useMutation({
    mutationFn: async (app: SupportedDeviceApp) => {
      const deviceId = await deviceInstallationId();
      const request = createDeviceAppConnectionRequest(deviceId, app.packageName, ['open_app']);
      if (!request) throw new Error('该应用当前没有可添加的操作。');
      return api<DeviceAppConnection>('/device-app-connections', token, { method: 'POST', body: JSON.stringify(request) });
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
        <View style={styles.header}><Text style={styles.title}>添加连接</Text><Text style={styles.subtitle}>先选择一种真实世界端点，再决定允许懒人装甲做什么。不会扫描或显示你未选择的应用。</Text></View>
        {!token ? <Surface><EmptyState icon="＋" title="请先登录" description="添加连接前需要确认这是你的账号与设备。" action={{ label: '去登录', onPress: () => router.push('/auth/login') }} /></Surface> : null}
        {token ? <>
          <View style={styles.kindTabs}>{([['mobile_app', '手机应用'], ['online_service', '在线服务'], ['device', '设备、车辆与家庭']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" onPress={() => setKind(value)} style={[styles.kindTab, kind === value && styles.kindTabSelected]}><Text style={[styles.kindText, kind === value && styles.kindTextSelected]}>{label}</Text></Pressable>)}</View>
          {kind === 'mobile_app' ? <MobileAppCatalog selected={selected} detection={selectedDetection} detectionLoading={detected.isLoading} alreadyAdded={alreadyAdded} addPending={add.isPending} addError={add.error} onSelect={setSelectedPackage} onAdd={() => selected && add.mutate(selected)} /> : null}
          {kind === 'online_service' ? <ConnectionTypePlaceholder title="在线服务" description="Gmail、日历和文件服务继续通过已审核的 OAuth 或文件授权流程连接。" actionLabel="查看在线服务" onPress={() => router.replace('/connections' as never)} /> : null}
          {kind === 'device' ? <ConnectionTypePlaceholder title="设备、车辆与家庭" description="设备、车辆和家庭资源会先以你主动添加的资料与授权连接为准；真实 Bridge 会逐项验证能力、权限和结果。" actionLabel="管理我的资料" onPress={() => router.push('/devices' as never)} /> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MobileAppCatalog({ selected, detection, detectionLoading, alreadyAdded, addPending, addError, onSelect, onAdd }: {
  selected: SupportedDeviceApp | null;
  detection: DeviceAppDetection | undefined;
  detectionLoading: boolean;
  alreadyAdded: boolean;
  addPending: boolean;
  addError: Error | null;
  onSelect: (packageName: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>已支持的手机应用</Text>
      <Text style={styles.sectionDescription}>只检测目录中的应用安装状态。当前 Web、iOS 或未包含 Android Bridge 的开发环境会明确标记为“无法检测”。</Text>
      {detectionLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在检查已支持的应用…</Text></View> : null}
      <View style={styles.catalog}>{SUPPORTED_DEVICE_APPS.map((app, index) => <AppRow key={app.packageName} app={app} detection={detectionFor(app, detection)} selected={selected?.packageName === app.packageName} last={index === SUPPORTED_DEVICE_APPS.length - 1} onPress={() => onSelect(app.packageName)} />)}</View>
      {selected ? <CapabilityPreview app={selected} detection={detection} alreadyAdded={alreadyAdded} pending={addPending} error={addError} onAdd={onAdd} /> : null}
    </>
  );
}

function AppRow({ app, detection, selected, last, onPress }: { app: SupportedDeviceApp; detection: DeviceAppDetection; selected: boolean; last: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.appRow, !last && styles.rowDivider, selected && styles.appRowSelected, pressed && styles.pressed]}><View style={styles.appIcon}><Text style={styles.appIconText}>{app.displayName.slice(0, 1)}</Text></View><View style={styles.appCopy}><Text style={styles.appName}>{app.displayName}</Text><Text style={styles.appMeta}>{categoryLabel(app.category)}</Text></View><Text style={[styles.installState, detection.installStatus === 'installed' && styles.installStateInstalled, detection.installStatus === 'unavailable' && styles.installStateUnavailable]}>{installStatusLabel(detection.installStatus)}</Text><Text style={styles.chevron}>›</Text></Pressable>;
}

function CapabilityPreview({ app, detection, alreadyAdded, pending, error, onAdd }: { app: SupportedDeviceApp; detection: DeviceAppDetection | undefined; alreadyAdded: boolean; pending: boolean; error: Error | null; onAdd: () => void }) {
  const canAdd = detection?.installStatus === 'installed' && !alreadyAdded;
  return <View style={styles.preview}><Text style={styles.sectionTitle}>添加 {app.displayName}</Text><Surface><Text style={styles.previewIntro}>添加后只会启用下列已实现操作。尚未支持的操作不会被提前开启。</Text><View style={styles.capabilityList}>{app.capabilities.map((capability, index) => <View key={capability.mode} style={[styles.capabilityRow, index < app.capabilities.length - 1 && styles.rowDivider]}><View style={styles.capabilityCopy}><Text style={styles.capabilityName}>{capability.label}</Text><Text style={styles.capabilityDescription}>{capability.description}</Text><Text style={styles.capabilityMeta}>{capability.availability === 'available' ? '当前可用' : '后续支持'}{capability.requiresUserPermission ? ' · 需单独授权' : ''}</Text></View></View>)}</View><View style={styles.previewAction}>{alreadyAdded ? <Text style={styles.addedText}>此应用已添加到当前设备。</Text> : <ActionButton label={pending ? '正在添加…' : canAdd ? '确认添加' : detection?.installStatus === 'not_installed' ? '请先安装应用' : '需要 Android 真机检测'} onPress={onAdd} disabled={!canAdd || pending} />}</View>{error ? <Text style={styles.error}>暂时无法添加，账号和设备没有被修改。请稍后再试。</Text> : null}</Surface><Text style={styles.safetyText}>添加连接不等于授予所有权限。通知读取、页面跳转或任何外部操作都需要单独说明、单独授权并验证结果。</Text></View>;
}

function ConnectionTypePlaceholder({ title, description, actionLabel, onPress }: { title: string; description: string; actionLabel: string; onPress: () => void }) {
  return <Surface style={styles.placeholder}><Text style={styles.placeholderTitle}>{title}</Text><Text style={styles.placeholderCopy}>{description}</Text><View style={styles.previewAction}><ActionButton label={actionLabel} onPress={onPress} /></View></Surface>;
}

function detectionFor(app: SupportedDeviceApp, detection: DeviceAppDetection | undefined): DeviceAppDetection {
  return detection ?? { packageName: app.packageName, displayName: app.displayName, installStatus: 'unavailable' };
}
function categoryLabel(category: SupportedDeviceApp['category']) { return ({ communication: '通信', payment: '支付', commerce: '购物', telecom: '通信服务', productivity: '效率工具' } as const)[category]; }
function installStatusLabel(status: DeviceAppDetection['installStatus']) { return status === 'installed' ? '已安装' : status === 'not_installed' ? '未安装' : '无法检测'; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 48 },
  header: { marginBottom: spacing.xl },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, maxWidth: 350 },
  kindTabs: { flexDirection: 'row', backgroundColor: '#ECE9E0', padding: 3, borderRadius: radius.md, marginBottom: spacing.xxl },
  kindTab: { flex: 1, minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: 4 },
  kindTabSelected: { backgroundColor: colors.surface },
  kindText: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },
  kindTextSelected: { color: colors.primary, fontWeight: '800' },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  catalog: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
  appRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  appRowSelected: { backgroundColor: colors.successSoft },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  appIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  appIconText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  appCopy: { flex: 1 },
  appName: { ...typography.bodyStrong, color: colors.text },
  appMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  installState: { ...typography.caption, color: colors.textMuted },
  installStateInstalled: { color: colors.success, fontWeight: '700' },
  installStateUnavailable: { color: colors.warning },
  chevron: { color: colors.textMuted, fontSize: 25, fontWeight: '300' },
  preview: { marginTop: spacing.xl },
  previewIntro: { ...typography.body, color: colors.textSecondary },
  capabilityList: { marginTop: spacing.md },
  capabilityRow: { paddingVertical: spacing.md },
  capabilityCopy: { flex: 1 },
  capabilityName: { ...typography.bodyStrong, color: colors.text },
  capabilityDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  capabilityMeta: { ...typography.caption, color: colors.warning, marginTop: spacing.xs },
  previewAction: { alignItems: 'flex-start', marginTop: spacing.lg },
  addedText: { ...typography.bodyStrong, color: colors.success },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  safetyText: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginTop: spacing.md },
  placeholder: { marginTop: spacing.xl },
  placeholderTitle: { ...typography.cardTitle, color: colors.text },
  placeholderCopy: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 },
  pressed: { backgroundColor: colors.pressed },
});
