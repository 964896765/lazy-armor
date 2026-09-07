import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { connectionStartRequest, disconnectRequest, reconnectRequest, validateConnectionRequest } from '../../src/connection-api-contract';
import { discoverLaunchableApps, openDeviceApp, setNotificationSourceEnabled } from '../../src/device-app-bridge';
import { ensureTrustedDevice } from '../../src/trusted-device-api';
import {
  capabilityDescription,
  capabilityLabel,
  capabilityRiskHint,
  connectionActionLabel,
  connectionRecoveryAction,
  connectionStatusLabel,
  isConsumerConnector,
  providerReadinessLabel,
} from '../../src/connection-presenter';
import { ActionButton, EmptyState, Surface, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../../src/design';

WebBrowser.maybeCompleteAuthSession();

interface ConnectorCapability { key: string; name: string; requiresConfirmation: boolean }
interface Connector { key: string; name: string; description: string; productionStatus: string; connectable: boolean; draftOnly: boolean; authentication: { type: string }; capabilities: ConnectorCapability[] }
interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string; status: string }
interface Permission { capability: string; name: string; riskLevel: string; granted: boolean; expiresAt?: string }
interface ConnectionPlanUsage { planId: string; planName: string; planStatus: string; requiredCapabilities: string[] }
interface OAuthStartResult { providerKey: string; authorizationUrl: string; expiresAt: string }
interface DeviceAppConnection { id: string; trustedDeviceId: string | null; packageName: string; displayName: string; enabled: boolean; modes: string[]; lastSeenAt: string | null }
interface TrustedDeviceSummary { id: string; status: 'active' | 'revoked' }

function stringParam(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

async function openAuthorization(started: OAuthStartResult, redirectUri: string, onCancel: () => void) {
  const result = await WebBrowser.openAuthSessionAsync(started.authorizationUrl, redirectUri);
  if (result.type !== 'success') { onCancel(); return null; }
  const parsed = Linking.parse(result.url);
  return { provider: started.providerKey, redirectUri, code: stringParam(parsed.queryParams?.code), state: stringParam(parsed.queryParams?.state), error: stringParam(parsed.queryParams?.error) };
}

function ConnectedService({ item, connector, token }: { item: Connection; connector?: Connector; token: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const permissions = useQuery({ queryKey: ['connection-permissions', item.id], queryFn: () => api<Permission[]>(`/connections/${item.id}/permissions`, token) });
  const plans = useQuery({ queryKey: ['connection-plans', item.id], queryFn: () => api<ConnectionPlanUsage[]>(`/connections/${item.id}/plans`, token) });
  const updatePermission = useMutation({
    mutationFn: (permission: Permission) => api<Permission[]>(`/connections/${item.id}/permissions`, token, { method: 'PUT', body: JSON.stringify({ permissions: [{ capability: permission.capability, granted: !permission.granted }] }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connection-permissions', item.id] }),
  });
  const disconnect = useMutation({
    mutationFn: () => { const request = disconnectRequest(item.id); return api<void>(request.path, token, request.init); },
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });
  const recovery = connectionRecoveryAction(item.status);

  async function recover() {
    setFeedback(null);
    try {
      if (recovery === '检查权限') { await permissions.refetch(); return; }
      if (recovery === '重新检查' || recovery === '连接有点问题') {
        const request = validateConnectionRequest(item.id);
        await api(request.path, token, request.init);
        await client.invalidateQueries({ queryKey: ['connections'] });
        return;
      }
      if (!connector || connector.authentication.type !== 'oauth2') return;
      const redirectUri = Linking.createURL('/oauth/callback', { queryParams: { provider: connector.key } });
      const request = reconnectRequest(item.id, redirectUri);
      const started = await api<OAuthStartResult>(request.path, token, request.init);
      const callback = await openAuthorization(started, redirectUri, () => setFeedback('连接已取消，没有授予任何权限。'));
      if (callback) router.push({ pathname: '/oauth/callback', params: callback } as unknown as Href);
    } catch { setFeedback('网络暂时不可用，请稍后再试。你的账号没有被修改。'); }
  }

  function confirmDisconnect() {
    Alert.alert('断开账号？', '相关计划会暂停读取信息，但计划和历史记录都会保留。', [
      { text: '取消', style: 'cancel' },
      { text: '断开账号', style: 'destructive', onPress: () => disconnect.mutate() },
    ]);
  }

  function changePermission(permission: Permission) {
    const affected = (plans.data ?? []).filter((plan) => plan.requiredCapabilities.includes(permission.capability));
    if (!permission.granted || affected.length === 0) { updatePermission.mutate(permission); return; }
    Alert.alert(`关闭“${capabilityLabel(item.connectorId, permission.capability, permission.name)}”？`, `${affected.map((plan) => `“${plan.planName}”`).join('、')}将暂时不能使用这项信息。`, [
      { text: '保留', style: 'cancel' },
      { text: '仍要关闭', style: 'destructive', onPress: () => updatePermission.mutate(permission) },
    ]);
  }

  const helpsWith = (plans.data ?? []).map((plan) => plan.planName);
  return (
    <View style={styles.connectionBlock}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={({ pressed }) => [styles.connectionRow, pressed && styles.rowPressed]}>
        <ServiceIcon provider={item.connectorId} size="compact" />
        <View style={styles.compactCopy}><View style={styles.compactTitleRow}><Text numberOfLines={1} style={styles.compactTitle}>{connectionDisplayName(item.connectorId, item.connectorName)}</Text><Text style={[styles.compactStatus, recovery && styles.compactStatusWarning]}>{connectionStatusLabel(item.status)}</Text></View><Text numberOfLines={1} style={styles.compactDetail}>{helpsWith.length > 0 ? `用于：${helpsWith.slice(0, 2).join('、')}` : '尚未用于计划'}</Text></View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.textMuted} />
      </Pressable>
      {expanded ? (
        <Surface style={styles.management}>
          <Text style={styles.account}>{item.externalAccountName}</Text>
          {recovery ? <View style={styles.inlineAction}><ActionButton label={recovery} onPress={() => void recover()} /></View> : null}
          {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
          <Text style={styles.subheading}>允许使用</Text>
          {permissions.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {permissions.data?.map((permission) => (
            <View style={styles.permissionRow} key={permission.capability}>
              <View style={styles.permissionCopy}>
                <Text style={styles.permissionName}>{capabilityLabel(item.connectorId, permission.capability, permission.name)}</Text>
                <Text style={styles.permissionDescription}>{capabilityDescription(item.connectorId, permission.capability)}</Text>
                <Text style={styles.permissionHint}>{capabilityRiskHint(permission.capability, permission.riskLevel)}</Text>
              </View>
              <ActionButton label={connectionActionLabel(permission.granted)} tone={permission.granted ? 'quiet' : 'primary'} onPress={() => changePermission(permission)} disabled={updatePermission.isPending || item.status === 'revoked'} />
            </View>
          ))}
          <View style={styles.disconnect}><ActionButton label="断开账号" tone="danger" onPress={confirmDisconnect} disabled={disconnect.isPending || item.status === 'revoked'} /></View>
        </Surface>
      ) : null}
    </View>
  );
}

function DeviceAppService({ item, token, trustedDeviceStatus, iconUri }: { item: DeviceAppConnection; token: string; trustedDeviceStatus?: TrustedDeviceSummary['status']; iconUri?: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: async () => {
      setFeedback(null);
      if (item.enabled) await setNotificationSourceEnabled(item.packageName, false);
      else if (trustedDeviceStatus === 'revoked') await ensureTrustedDevice(token, { force: true });
      return api<DeviceAppConnection>(`/device-app-connections/${item.id}`, token, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled, ...(item.enabled ? { modes: item.modes.filter((mode) => mode !== 'notification_read') } : {}) }) });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['device-app-connections', token] }),
        client.invalidateQueries({ queryKey: ['rail-device-app-connections', token] }),
      ]);
      setFeedback(item.enabled ? '连接已停用。' : '设备已重新验证，连接已启用。');
    },
    onError: () => setFeedback('这台设备暂时无法重新验证，连接仍保持停用。请稍后再试。'),
  });
  async function open() {
    setFeedback(null);
    const opened = await openDeviceApp(item.packageName);
    setFeedback(opened ? '已打开应用。' : '无法打开该应用：请在 Android 真机确认它仍已安装。');
  }
  function changeEnabled() {
    if (item.enabled || trustedDeviceStatus !== 'revoked') {
      update.mutate();
      return;
    }
    Alert.alert(
      '这台设备此前已被撤销',
      '重新使用此连接前，需要重新验证设备。',
      [
        { text: '取消', style: 'cancel' },
        { text: '重新验证并启用', onPress: () => update.mutate() },
      ],
    );
  }
  return (
    <View style={styles.connectionBlock}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={({ pressed }) => [styles.connectionRow, pressed && styles.rowPressed]}>
        <View style={styles.compactIcon}>{iconUri ? <Image source={{ uri: iconUri }} style={styles.appIcon} /> : <Ionicons name="apps-outline" size={20} color={colors.primary} />}</View>
        <View style={styles.compactCopy}><View style={styles.compactTitleRow}><Text numberOfLines={1} style={styles.compactTitle}>{item.displayName}</Text><Text style={[styles.compactStatus, !item.enabled && styles.compactStatusWarning]}>{item.enabled ? '已连接' : '已停用'}</Text></View><Text numberOfLines={1} style={styles.compactDetail}>{item.enabled ? `用于：${item.modes.map(deviceAppOperationLabel).join('、')}` : '不会被计划使用'}</Text></View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.textMuted} />
      </Pressable>
      {expanded ? <Surface style={styles.management}>
        <Text style={styles.providerDescription}>{item.enabled ? '只使用你确认过的能力。' : '重新启用前会再次确认设备状态。'}</Text>
        <View style={styles.deviceActions}><ActionButton label="打开应用" tone="quiet" onPress={() => void open()} disabled={!item.enabled} />{item.enabled ? <ActionButton label="通知来源" tone="quiet" onPress={() => router.push('/connections/notification-sources' as Href)} /> : null}<ActionButton label={item.enabled ? '停用连接' : trustedDeviceStatus === 'revoked' ? '重新验证并启用' : '重新启用'} tone={item.enabled ? 'quiet' : 'primary'} onPress={changeEnabled} disabled={update.isPending} /></View>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
      </Surface> : null}
    </View>
  );
}

function AvailableService({ connector, token }: { connector: Connector; token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestAvailable = connectionStartRequest(connector, 'placeholder') !== null;

  async function connect() {
    const redirectUri = Linking.createURL('/oauth/callback', { queryParams: { provider: connector.key } });
    const request = connectionStartRequest(connector, redirectUri);
    if (!request) return;
    setPending(true);
    setFeedback(null);
    try {
      const started = await api<OAuthStartResult>(request.path, token, request.init);
      const callback = await openAuthorization(started, redirectUri, () => setFeedback('连接已取消，没有授予任何权限。'));
      if (callback) router.push({ pathname: '/oauth/callback', params: callback } as unknown as Href);
    } catch { setFeedback('网络暂时不可用，请稍后再试。你的账号没有被修改。'); }
    finally { setPending(false); }
  }

  return (
    <Surface>
      <View style={styles.providerHeader}>
        <ServiceIcon provider={connector.key} size="large" />
        <View style={styles.providerCopy}><Text style={styles.providerName}>{connectionDisplayName(connector.key, connector.name)}</Text><Text style={styles.readiness}>{providerReadinessLabel(connector.productionStatus)}</Text></View>
      </View>
      <Text style={styles.providerDescription}>{connector.description}</Text>
      <View style={styles.capabilities}>{connector.capabilities.slice(0, 3).map((capability) => <Text style={styles.capability} key={capability.key}>✓ {capabilityLabel(connector.key, capability.key, capability.name)}</Text>)}</View>
      <View style={styles.providerAction}>
        {connector.key === 'file_provider'
          ? <ActionButton label="选择账单文件" onPress={() => router.push('/file-import' as Href)} />
          : <ActionButton label={requestAvailable ? (pending ? '正在打开授权…' : '连接') : providerReadinessLabel(connector.productionStatus)} onPress={() => void connect()} disabled={!requestAvailable || pending} />}
      </View>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </Surface>
  );
}

export default function ConnectionsPage() {
  const router = useRouter();
  const token = useAuthStore((store) => store.token);
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const deviceApps = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const trustedDevices = useQuery({ queryKey: ['trusted-devices', token], queryFn: () => api<TrustedDeviceSummary[]>('/trusted-devices', token), enabled: Boolean(token) });
  const discoveredApps = useQuery({ queryKey: ['connection-page-discovered-apps'], queryFn: discoverLaunchableApps, enabled: Boolean(token && (deviceApps.data?.length ?? 0) > 0), staleTime: 5 * 60_000 });
  const consumerConnectors = useMemo(() => connectors.data?.filter((connector) => isConsumerConnector(connector.key)) ?? [], [connectors.data]);
  const activeProviderKeys = new Set((connections.data ?? []).filter((connection) => connection.status !== 'revoked').map((connection) => connection.connectorId));
  const available = consumerConnectors.filter((connector) => connectionStartRequest(connector, 'placeholder') !== null && !activeProviderKeys.has(connector.key));
  const connectorByKey = new Map(consumerConnectors.map((connector) => [connector.key, connector]));
  const iconByPackage = new Map((discoveredApps.data ?? []).map((app) => [app.packageName, app.iconDataUri]));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={connections.isFetching} onRefresh={() => connections.refetch()} /> : undefined}>
        <WorkspaceHeader title="连接中心" subtitle="管理已授权的服务与手机应用" action={<Pressable accessibilityRole="button" accessibilityLabel="添加连接" onPress={() => router.push('/connections/add' as Href)} style={({ pressed }) => [styles.headerAction, pressed && styles.rowPressed]}><Ionicons name="add" size={22} color="#344054" /></Pressable>} />
        {!token ? (
          <Surface style={styles.stateSurface}><EmptyState icon="link-outline" title="登录后管理连接" description="登录和账号安全在“我的”中管理。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as Href) }} /></Surface>
        ) : (
          <>
            {connections.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
            {(connections.data?.length ?? 0) + (deviceApps.data?.length ?? 0) === 0 ? <View style={styles.emptyConnection}><Text style={styles.emptyConnectionTitle}>还没有连接服务</Text><Text style={styles.emptyConnectionCopy}>添加在线服务或这台手机上的应用</Text><ActionButton label="添加连接" onPress={() => router.push('/connections/add' as Href)} /></View> : null}
            {(connections.data?.length ?? 0) > 0 ? <WorkspaceSection title="在线服务" count={connections.data?.length}><View style={styles.connectionList}>{connections.data?.map((item) => <ConnectedService key={item.id} item={item} connector={connectorByKey.get(item.connectorId)} token={token} />)}</View></WorkspaceSection> : null}
            {(deviceApps.data?.length ?? 0) > 0 ? <WorkspaceSection title="手机应用" count={deviceApps.data?.length}><View style={styles.connectionList}>{deviceApps.data?.map((item) => <DeviceAppService key={item.id} item={item} token={token} trustedDeviceStatus={trustedDevices.data?.find((device) => device.id === item.trustedDeviceId)?.status} iconUri={iconByPackage.get(item.packageName) ?? undefined} />)}</View></WorkspaceSection> : null}

            {available.length > 0 ? <WorkspaceSection title="还可以连接"><View style={styles.availableList}>{available.map((connector) => <AvailableService key={connector.key} connector={connector} token={token} />)}</View></WorkspaceSection> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function connectionDisplayName(key: string, fallback: string) {
  if (key === 'gmail') return 'Google 邮箱';
  if (key === 'google_calendar' || key === 'calendar') return 'Google 日历';
  return fallback;
}

function deviceAppOperationLabel(mode: string) {
  if (mode === 'open_app') return '打开应用';
  if (mode === 'receive_share') return '接收分享内容';
  if (mode === 'notification_read') return '读取指定通知';
  return '额外适配操作';
}

function ServiceIcon({ provider, size }: { provider: string; size: 'compact' | 'large' }) {
  const iconSize = size === 'large' ? 24 : 20;
  return <View style={size === 'large' ? styles.providerIcon : styles.compactIcon}><Ionicons name={providerIcon(provider)} size={iconSize} color={colors.primary} /></View>;
}

function providerIcon(key: string): ComponentProps<typeof Ionicons>['name'] {
  if (key === 'gmail') return 'mail-outline';
  if (key === 'google_calendar' || key === 'calendar') return 'calendar-outline';
  if (key === 'file_provider') return 'document-text-outline';
  if (key.toLowerCase().includes('github')) return 'logo-github';
  return 'link-outline';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 72 },
  headerAction: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F2F4F7', borderWidth: 1, borderColor: '#EAECF0', alignItems: 'center', justifyContent: 'center' },
  stateSurface: { marginTop: spacing.xl },
  emptyConnection: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md },
  emptyConnectionTitle: { ...typography.bodyStrong, color: colors.text },
  emptyConnectionCopy: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  loginTitle: { ...typography.cardTitle, color: colors.text, marginBottom: spacing.sm },
  input: { ...typography.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: 12, marginTop: spacing.md },
  loginAction: { marginTop: spacing.lg },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  connectionList: { backgroundColor: '#FFFFFF' },
  availableList: { gap: spacing.sm },
  connectionBlock: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  connectionRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowPressed: { opacity: 0.68 },
  compactIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  appIcon: { width: 30, height: 30, borderRadius: 9 },
  compactCopy: { flex: 1, minWidth: 0 },
  compactTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  compactTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  compactStatus: { color: '#16834A', fontSize: 9, lineHeight: 13, fontWeight: '700' },
  compactStatusWarning: { color: '#B54708' },
  compactDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  management: { marginLeft: 50, padding: spacing.md, backgroundColor: '#F2F3F5', borderRadius: radius.sm },
  account: { ...typography.caption, color: colors.textMuted },
  inlineAction: { alignItems: 'flex-start', marginTop: spacing.md },
  feedback: { ...typography.caption, color: colors.warning, marginTop: spacing.md },
  subheading: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, paddingVertical: spacing.md },
  permissionCopy: { flex: 1 },
  permissionName: { ...typography.bodyStrong, color: colors.text },
  permissionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  permissionHint: { ...typography.caption, color: colors.success, marginTop: spacing.xs },
  disconnect: { alignItems: 'flex-start', marginTop: spacing.xl },
  providerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  providerIcon: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  providerCopy: { flex: 1 },
  providerName: { ...typography.cardTitle, color: colors.text },
  readiness: { ...typography.caption, color: colors.success, marginTop: 2 },
  providerDescription: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  capabilities: { gap: spacing.xs, marginTop: spacing.md },
  capability: { ...typography.caption, color: colors.textSecondary },
  providerAction: { alignItems: 'flex-end', marginTop: spacing.lg },
  deviceActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  addConnection: { alignItems: 'center', marginTop: spacing.xxxl },
  logout: { alignItems: 'center', marginTop: spacing.xxxl },
});
