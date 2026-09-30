import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceAppCapabilities, deviceAppIntegration, type AppIntegrationCapability, type DeviceAppConnectionMode } from '@lazy-armor/shared';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { createDeviceAppConnectionRequest } from '../../src/device-app-api-contract';
import { deviceDiscoveryStatus, discoverLaunchableApps, type DiscoveredDeviceApp } from '../../src/device-app-bridge';
import { deviceInstallationId } from '../../src/device-installation-id';
import { deviceBoundApi, ensureTrustedDevice } from '../../src/trusted-device-api';
import { ActionButton, EmptyState, Surface, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

interface DeviceAppConnection { id: string; packageName: string; displayName: string; enabled: boolean; modes: DeviceAppConnectionMode[] }
type ConnectionKind = '全部' | '应用' | '设备' | '数据' | '能力';
interface Connector { key: string; name: string; description: string; connectable: boolean }

export default function AddConnectionPage() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [kind, setKind] = useState<ConnectionKind>('全部');
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const discovery = useQuery({ queryKey: ['rail-discovered-device-apps'], queryFn: discoverLaunchableApps, enabled: Boolean(token), staleTime: 5 * 60_000 });
  const existing = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: () => api<Connector[]>('/connectors'), enabled: Boolean(token) });
  const selected = useMemo(() => (discovery.data ?? []).find((app) => app.packageName === selectedPackage) ?? null, [discovery.data, selectedPackage]);
  const matchingApps = (discovery.data ?? []).filter((item) => `${item.displayName} ${item.packageName}`.toLocaleLowerCase('zh-CN').includes(search.trim().toLocaleLowerCase('zh-CN')));
  const matchingConnectors = (connectors.data ?? []).filter((item) => item.connectable && `${item.name} ${item.description}`.toLocaleLowerCase('zh-CN').includes(search.trim().toLocaleLowerCase('zh-CN')));
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
      <View style={styles.content}>
        <WorkspaceHeader title="添加资源" subtitle="选择真实可连接的应用、设备、数据或能力" onBack={() => router.back()} />
        {!token ? <Surface><EmptyState icon="log-in-outline" title="请先登录" description="添加连接前需要确认这是你的账号与设备。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {token ? <>
          <View style={styles.searchBox}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} placeholder="搜索应用、设备或能力…" placeholderTextColor={colors.textMuted} style={styles.searchInput} /></View>
          <View style={styles.kindTabs}>{(['全部', '应用', '设备', '数据', '能力'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)} style={[styles.kindTab, kind === value && styles.kindTabSelected]}><Text style={[styles.kindText, kind === value && styles.kindTextSelected]}>{value}</Text></Pressable>)}</View>
          {kind === '全部' || kind === '应用' ? <ScrollView contentContainerStyle={styles.secondaryContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>热门推荐</Text>
            <View style={styles.recommendGrid}>{matchingApps.slice(0, 8).map((item) => <Pressable key={item.packageName} onPress={() => setSelectedPackage(item.packageName)} style={styles.recommendTile}><View style={styles.recommendIcon}>{item.iconDataUri ? <Image source={{ uri: item.iconDataUri }} style={styles.recommendImage} /> : <Ionicons name="apps-outline" size={26} color={colors.brand} />}</View><Text numberOfLines={1} style={styles.recommendLabel}>{item.displayName}</Text></Pressable>)}</View>
            {matchingConnectors.length > 0 ? <Text style={styles.sectionTitle}>在线服务</Text> : null}
            {matchingConnectors.map((item) => <Pressable key={item.key} onPress={() => router.replace('/connections' as never)} style={styles.appRow}><View style={styles.appIcon}><Ionicons name="link-outline" size={19} color={colors.primary} /></View><View style={styles.appCopy}><Text style={styles.appName}>{item.name}</Text><Text numberOfLines={1} style={styles.appMeta}>{item.description}</Text></View><Text style={styles.connectLabel}>连接</Text></Pressable>)}
            {matchingApps.length > 8 ? <Text style={styles.sectionTitle}>更多应用</Text> : null}
            {matchingApps.slice(8, kind === '全部' ? 16 : undefined).map((item) => <AppRow key={item.packageName} app={item} selected={selected?.packageName === item.packageName} last={false} onPress={() => setSelectedPackage(item.packageName)} />)}
            {matchingApps.length === 0 && matchingConnectors.length === 0 && !discovery.isLoading && !discovery.isError ? <Text style={styles.resultMeta}>没有匹配的可连接资源。</Text> : null}
            {discovery.isLoading ? <ActivityIndicator color={colors.primary} /> : null}{discovery.isError ? <Text style={styles.resultMeta}>暂时无法读取这台手机上的应用。</Text> : null}
            {kind === '全部' && matchingApps.length > 16 ? <Pressable onPress={() => setKind('应用')} style={styles.viewMore}><Text style={styles.appName}>查看全部本机应用</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable> : null}
          </ScrollView> : null}
          {kind === '设备' ? <ScrollView contentContainerStyle={styles.secondaryContent}><ConnectionTypePlaceholder title="设备" description="查看已证明的设备；添加手机应用时会完成本机安全证明。" actionLabel="管理设备" onPress={() => router.push('/connections/trusted-devices' as never)} /></ScrollView> : null}
          {kind === '数据' ? <ScrollView contentContainerStyle={styles.secondaryContent}><ConnectionTypePlaceholder title="数据与文件" description="上传文件或查看现有的已验证数据。" actionLabel="上传文件" onPress={() => router.push('/file-import' as never)} /></ScrollView> : null}
          {kind === '能力' ? <ScrollView contentContainerStyle={styles.secondaryContent}><ConnectionTypePlaceholder title="能力与扩展" description="已连接资源提供的能力会在核实后显示。" actionLabel="查看能力" onPress={() => router.push('/capabilities' as never)} /></ScrollView> : null}
        </> : null}
      </View>
      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelectedPackage(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedPackage(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {selected ? <ConnectionPreview app={selected} alreadyAdded={alreadyAdded} pending={add.isPending} hasError={add.isError} onAdd={() => add.mutate(selected)} /> : null}
            <ActionButton label="关闭" tone="quiet" onPress={() => setSelectedPackage(null)} />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MobileAppDiscovery({ selected, search, onSearch, apps, discoveryLoading, discoveryError, onSelect }: {
  selected: DiscoveredDeviceApp | null; search: string; onSearch: (value: string) => void; apps: DiscoveredDeviceApp[]; discoveryLoading: boolean; discoveryError: boolean; onSelect: (packageName: string) => void;
}) {
  const unavailable = deviceDiscoveryStatus() === 'unavailable';
  const normalized = search.trim().toLocaleLowerCase('zh-CN');
  const filtered = normalized ? apps.filter((app) => `${app.displayName} ${app.packageName}`.toLocaleLowerCase('zh-CN').includes(normalized)) : apps;
  return <View style={styles.discovery}>
    <View style={styles.searchBox}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput value={search} onChangeText={onSearch} placeholder="搜索这台手机上的 App" placeholderTextColor={colors.textMuted} style={styles.searchInput} /></View>
    <Text style={styles.resultMeta}>{discoveryLoading ? '正在读取…' : `${filtered.length} 个可启动 App`}</Text>
    {unavailable ? <Surface><EmptyState icon="phone-portrait-outline" title="暂时无法读取设备应用" description="请使用包含原生模块的 Android 构建。" /></Surface> : null}
    {!unavailable && discoveryError ? <Surface><EmptyState icon="cloud-offline-outline" title="暂时无法读取应用" description="没有保存任何应用，请稍后重试。" /></Surface> : null}
    {!unavailable && !discoveryLoading && !discoveryError && filtered.length === 0 ? <Surface><EmptyState icon="apps-outline" title={search ? '没有找到对应 App' : '没有可添加的应用'} description="不会显示示例或测试列表。" /></Surface> : null}
    {!unavailable && !discoveryError ? <FlatList data={filtered} keyExtractor={(app) => app.packageName} style={styles.catalog} contentContainerStyle={styles.catalogContent} keyboardShouldPersistTaps="handled" initialNumToRender={14} maxToRenderPerBatch={18} windowSize={8} renderItem={({ item, index }) => <AppRow app={item} selected={selected?.packageName === item.packageName} last={index === filtered.length - 1} onPress={() => onSelect(item.packageName)} />} /> : null}
  </View>;
}

function AppRow({ app, selected, last, onPress }: { app: DiscoveredDeviceApp; selected: boolean; last: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.appRow, !last && styles.rowDivider, selected && styles.appRowSelected, pressed && styles.pressed]}>
    <View style={styles.appIcon}>{app.iconDataUri ? <Image source={{ uri: app.iconDataUri }} style={styles.appImage} /> : <Ionicons name="apps-outline" size={19} color={colors.primary} />}</View>
    <View style={styles.appCopy}><Text style={styles.appName}>{app.displayName}</Text><Text style={styles.appMeta}>{app.versionName ? `版本 ${app.versionName}` : '已由设备发现'}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
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
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  kindTabs: { flexDirection: 'row', gap: 5, marginTop: spacing.md, marginBottom: spacing.md },
  kindTab: { flex: 1, minHeight: 36, justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: 3 },
  kindTabSelected: { backgroundColor: colors.text },
  kindText: { fontSize: 10, lineHeight: 14, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },
  kindTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  discovery: { flex: 1 },
  searchBox: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: radius.pill },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: spacing.sm },
  resultMeta: { ...typography.caption, color: colors.textMuted, marginVertical: spacing.sm, paddingHorizontal: spacing.xs },
  secondaryContent: { paddingBottom: 48 }, connectLabel: { ...typography.caption, color: colors.primary, backgroundColor: colors.accentSoft, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill },
  recommendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, recommendTile: { width: '23%', minHeight: 80, backgroundColor: colors.surface, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', padding: spacing.xs }, recommendIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accentSoft }, recommendImage: { width: 34, height: 34, borderRadius: 8 }, recommendLabel: { ...typography.caption, color: colors.text, marginTop: 4, textAlign: 'center' }, viewMore: { minHeight: 44, backgroundColor: colors.surface, borderRadius: radius.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, marginTop: spacing.sm },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  catalog: { flex: 1, backgroundColor: colors.surface },
  catalogContent: { paddingBottom: spacing.md },
  appRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  appRowSelected: { backgroundColor: colors.accentSoft },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  appIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, overflow: 'hidden' },
  appImage: { width: 36, height: 36 },
  appCopy: { flex: 1 },
  appName: { ...typography.bodyStrong, color: colors.text },
  appMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  modalBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(16, 24, 40, 0.34)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: spacing.sm },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center' },
  sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: 36 },
  preview: { marginTop: spacing.sm },
  previewIntro: { ...typography.body, color: colors.textSecondary },
  adapterNote: { ...typography.caption, color: colors.primary, marginTop: spacing.md, lineHeight: 18 },
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
  placeholder: { marginTop: spacing.md },
  placeholderTitle: { ...typography.cardTitle, color: colors.text },
  placeholderCopy: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 },
  pressed: { backgroundColor: colors.accentSoft },
});
