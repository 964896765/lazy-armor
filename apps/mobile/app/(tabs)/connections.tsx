import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { connectionStartRequest, disconnectRequest, reconnectRequest, validateConnectionRequest } from '../../src/connection-api-contract';
import { discoverLaunchableApps, openDeviceApp, setNotificationSourceEnabled } from '../../src/device-app-bridge';
import type { DiscoveredDeviceApp } from '../../src/device-app-bridge';
import { ensureTrustedDevice } from '../../src/trusted-device-api';
import {
  capabilityDescription,
  capabilityLabel,
  capabilityRealitySummary,
  capabilityRiskHint,
  connectionActionLabel,
  connectionBucket,
  connectionBucketLabel,
  connectionRecoveryAction,
  connectionStatusLabel,
  isConsumerConnector,
  mobileAppStateLabel,
  providerReadinessLabel,
} from '../../src/connection-presenter';
import { ActionButton, CollapsedAppFolder, EmptyState, Surface, WorkspaceHeader, WorkspaceSection, colors, radius, spacing, typography } from '../../src/design';

WebBrowser.maybeCompleteAuthSession();

interface ConnectorCapability { key: string; name: string; requiresConfirmation: boolean }
interface Connector { key: string; name: string; description: string; productionStatus: string; connectable: boolean; draftOnly: boolean; authentication: { type: string }; capabilities: ConnectorCapability[] }
interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string; status: string }
interface Permission { capability: string; name: string; riskLevel: string; granted: boolean; expiresAt?: string }
interface ConnectionPlanUsage { planId: string; planName: string; planStatus: string; requiredCapabilities: string[] }
interface OAuthStartResult { providerKey: string; authorizationUrl: string; expiresAt: string }
interface DeviceAppConnection { id: string; trustedDeviceId: string | null; packageName: string; displayName: string; enabled: boolean; modes: string[]; lastSeenAt: string | null }
interface TrustedDeviceSummary { id: string; status: 'active' | 'revoked' }
interface CapabilityReality { key: string; name: string; providerAvailability: string; implementation: string; grant: string; health: string; usable: boolean; reasons: string[] }
interface CapabilityRealityResponse { manifestRevision: number | null; providerReview: string; capabilities: CapabilityReality[] }

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
  const capabilities = useQuery({ queryKey: ['connection-capabilities', item.id], queryFn: () => api<CapabilityRealityResponse>(`/connections/${item.id}/capabilities`, token) });
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
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/connections/${item.id}` as Href)}
            style={({ pressed }) => [styles.detailLink, pressed && styles.rowPressed]}
          >
            <View style={styles.detailLinkCopy}>
              <Text style={styles.detailLinkTitle}>查看来源详情</Text>
              <Text style={styles.detailLinkDescription}>能力、关联计划与授权边界</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
          <Text style={styles.account}>{item.externalAccountName}</Text>
          <CapabilityRealityLine capabilities={capabilities.data?.capabilities ?? []} loading={capabilities.isLoading} />
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

function CapabilityRealityLine({ capabilities, loading }: { capabilities: CapabilityReality[]; loading: boolean }) {
  const summary = capabilityRealitySummary(capabilities);
  if (loading) return <Text style={styles.realityLineMuted}>正在核对能力状态…</Text>;
  if (summary.total === 0) return null;
  const complete = summary.officialConfirmed && summary.implemented === summary.total && summary.granted === summary.total && summary.healthy === summary.total;
  return (
    <View style={styles.realityLine}>
      <Text style={[styles.realityLineText, !complete && styles.realityLineTextWarning]}>
        官方能力 {summary.officialConfirmed ? '已核实' : '待核实'} · 已实现 {summary.implemented}/{summary.total} · 已授权 {summary.granted}/{summary.total} · 当前健康 {summary.healthy}/{summary.total}
      </Text>
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
        <View style={styles.deviceActions}><ActionButton label="打开应用" tone="quiet" onPress={() => void open()} disabled={!item.enabled} />{item.enabled ? <ActionButton label="受控读取" tone="primary" onPress={() => router.push({ pathname: '/connections/app-read-session', params: { connectionId: item.id, packageName: item.packageName, displayName: item.displayName, notificationEnabled: String(item.modes.includes('notification_read')) } } as unknown as Href)} /> : null}{item.enabled ? <ActionButton label="通知来源" tone="quiet" onPress={() => router.push('/connections/notification-sources' as Href)} /> : null}<ActionButton label={item.enabled ? '停用连接' : trustedDeviceStatus === 'revoked' ? '重新验证并启用' : '重新启用'} tone={item.enabled ? 'quiet' : 'primary'} onPress={changeEnabled} disabled={update.isPending} /></View>
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
    <View style={styles.availableBlock}>
      <View style={styles.availableRow}>
        <ServiceIcon provider={connector.key} size="compact" />
        <View style={styles.compactCopy}><View style={styles.compactTitleRow}><Text numberOfLines={1} style={styles.compactTitle}>{connectionDisplayName(connector.key, connector.name)}</Text><Text style={styles.readiness}>{providerReadinessLabel(connector.productionStatus)}</Text></View><Text numberOfLines={1} style={styles.compactDetail}>{connector.description}</Text></View>
        <Pressable accessibilityRole="button" disabled={!requestAvailable || pending} onPress={connector.key === 'file_provider' ? () => router.push('/file-import' as Href) : () => void connect()} style={({ pressed }) => [styles.connectButton, pressed && styles.rowPressed, (!requestAvailable || pending) && styles.connectDisabled]}><Text style={styles.connectButtonText}>{connector.key === 'file_provider' ? '选择' : pending ? '打开中' : requestAvailable ? '连接' : '暂不可用'}</Text></Pressable>
      </View>
      <View style={styles.capabilityChips}>{connector.capabilities.slice(0, 3).map((capability) => <View style={styles.capabilityChip} key={capability.key}><Ionicons name="information-circle-outline" size={12} color={colors.primary} /><Text numberOfLines={1} style={styles.capabilityChipText}>{capabilityLabel(connector.key, capability.key, capability.name)}</Text></View>)}</View>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </View>
  );
}

export default function ConnectionsPage() {
  const router = useRouter();
  const token = useAuthStore((store) => store.token);
  const [search, setSearch] = useState('');
  const [expandedAppFolder, setExpandedAppFolder] = useState(false);
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const deviceApps = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const trustedDevices = useQuery({ queryKey: ['trusted-devices', token], queryFn: () => api<TrustedDeviceSummary[]>('/trusted-devices', token), enabled: Boolean(token) });
  const discoveredApps = useQuery({ queryKey: ['connection-page-discovered-apps'], queryFn: discoverLaunchableApps, enabled: Boolean(token && (deviceApps.data?.length ?? 0) > 0), staleTime: 5 * 60_000 });
  const consumerConnectors = useMemo(() => connectors.data?.filter((connector) => isConsumerConnector(connector.key)) ?? [], [connectors.data]);
  const connectorByKey = new Map(consumerConnectors.map((connector) => [connector.key, connector]));
  const activeProviderKeys = new Set((connections.data ?? []).filter((connection) => connection.status !== 'revoked').map((connection) => connection.connectorId));
  const isDeveloper = (connection: Connection) => connectionBucket(connection.connectorId, 'provider', connectorByKey.get(connection.connectorId)?.authentication.type) === 'DEVELOPER';
  const onlineConnections = (connections.data ?? []).filter((item) => !isDeveloper(item));
  const developerConnections = (connections.data ?? []).filter((item) => isDeveloper(item));
  const available = consumerConnectors.filter((connector) => connectionBucket(connector.key, 'provider', connector.authentication.type) !== 'DEVELOPER' && connectionStartRequest(connector, 'placeholder') !== null && !activeProviderKeys.has(connector.key));
  const iconByPackage = new Map((discoveredApps.data ?? []).map((app) => [app.packageName, app.iconDataUri]));
  const connectedPackages = new Set((deviceApps.data ?? []).map((item) => item.packageName));
  const unconnectedApps = (discoveredApps.data ?? []).filter((app) => !connectedPackages.has(app.packageName));
  const needle = search.trim().toLocaleLowerCase('zh-CN');
  const visibleOnlineConnections = onlineConnections.filter((item) => !needle || `${item.connectorName} ${item.externalAccountName}`.toLocaleLowerCase('zh-CN').includes(needle));
  const visibleDeveloperConnections = developerConnections.filter((item) => !needle || `${item.connectorName} ${item.externalAccountName}`.toLocaleLowerCase('zh-CN').includes(needle));
  const visibleApps = (deviceApps.data ?? []).filter((item) => !needle || `${item.displayName} ${item.packageName}`.toLocaleLowerCase('zh-CN').includes(needle));
  const visibleUnconnectedApps = unconnectedApps.filter((item) => !needle || `${item.displayName} ${item.packageName}`.toLocaleLowerCase('zh-CN').includes(needle));
  const visibleAvailable = available.filter((item) => !needle || `${item.name} ${item.description}`.toLocaleLowerCase('zh-CN').includes(needle));
  const configuredCount = (connections.data?.filter((item) => item.status !== 'revoked').length ?? 0) + (deviceApps.data?.filter((item) => item.enabled).length ?? 0);
  const attentionCount = (connections.data?.filter((item) => Boolean(connectionRecoveryAction(item.status))).length ?? 0) + (deviceApps.data?.filter((item) => !item.enabled).length ?? 0);
  const hasAny = (connections.data?.length ?? 0) + (deviceApps.data?.length ?? 0) + (trustedDevices.data?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={connections.isFetching} onRefresh={() => connections.refetch()} /> : undefined}>
        <WorkspaceHeader title="连接" subtitle="让计划安全地使用你的服务与手机来源" action={<Pressable accessibilityRole="button" accessibilityLabel="添加连接" onPress={() => router.push('/connections/add' as Href)} style={({ pressed }) => [styles.headerAction, pressed && styles.rowPressed]}><Ionicons name="add" size={22} color={colors.primary} /></Pressable>} />
        {!token ? (
          <Surface style={styles.stateSurface}><EmptyState icon="link-outline" title="登录后管理连接" description="登录和账号安全在“我的”中管理。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as Href) }} /></Surface>
        ) : (
          <>
            <View style={styles.searchBox}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} placeholder="搜索已连接服务或可用来源" placeholderTextColor={colors.textMuted} style={styles.searchInput} />{search ? <Pressable accessibilityLabel="清空搜索" onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}</View>
            <View style={styles.realityHint}><Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} /><Text style={styles.realityHintText}>每项能力分别核对官方开放、已实现、你的授权与当前健康；已安装不等于可用。</Text></View>
            <View style={styles.summaryStrip}><ConnectionStat icon="link-outline" value={configuredCount} label="已添加" tone="success" /><View style={styles.statDivider} /><ConnectionStat icon="alert-circle-outline" value={attentionCount} label="需关注" tone={attentionCount > 0 ? 'warning' : 'muted'} /><View style={styles.statDivider} /><ConnectionStat icon="apps-outline" value={deviceApps.data?.length ?? 0} label="手机应用" tone="brand" /></View>
            {connections.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
            {!hasAny ? <View style={styles.emptyConnection}><Text style={styles.emptyConnectionTitle}>还没有连接服务</Text><Text style={styles.emptyConnectionCopy}>添加在线服务或这台手机上的应用</Text><ActionButton label="添加连接" onPress={() => router.push('/connections/add' as Href)} /></View> : null}

            {(visibleApps.length > 0 || visibleUnconnectedApps.length > 0) ? (
              <WorkspaceSection title={connectionBucketLabel('PHONE_APPS')} count={visibleApps.length + visibleUnconnectedApps.length}>
                {visibleApps.length > 0 ? <View style={styles.connectionList}>{visibleApps.map((item) => <DeviceAppService key={item.id} item={item} token={token} trustedDeviceStatus={trustedDevices.data?.find((device) => device.id === item.trustedDeviceId)?.status} iconUri={iconByPackage.get(item.packageName) ?? undefined} />)}</View> : null}
                {visibleUnconnectedApps.length > 0 ? (expandedAppFolder
                  ? <View style={styles.unconnectedList}>{visibleUnconnectedApps.map((app) => <UnconnectedAppRow key={app.packageName} app={app} />)}</View>
                  : <View style={styles.appFolderWrap}><CollapsedAppFolder count={visibleUnconnectedApps.length} iconUris={visibleUnconnectedApps.slice(0, 4).map((app) => app.iconDataUri ?? '').filter(Boolean)} onPress={() => setExpandedAppFolder(true)} /></View>) : null}
              </WorkspaceSection>
            ) : null}

            {(visibleOnlineConnections.length > 0 || visibleAvailable.length > 0) ? (
              <WorkspaceSection title={connectionBucketLabel('ONLINE_SERVICES')} count={visibleOnlineConnections.length + visibleAvailable.length}>
                {visibleOnlineConnections.length > 0 ? <View style={styles.connectionList}>{visibleOnlineConnections.map((item) => <ConnectedService key={item.id} item={item} connector={connectorByKey.get(item.connectorId)} token={token} />)}</View> : null}
                {visibleAvailable.length > 0 ? <View style={styles.availableList}>{visibleAvailable.map((connector) => <AvailableService key={connector.key} connector={connector} token={token} />)}</View> : null}
              </WorkspaceSection>
            ) : null}

            {(trustedDevices.data?.length ?? 0) > 0 ? (
              <WorkspaceSection title={connectionBucketLabel('DEVICES')} count={trustedDevices.data!.length}>
                <View style={styles.deviceActions}><ActionButton label="查看手机任务与心跳" tone="quiet" onPress={() => router.push('/connections/device-tasks' as Href)} /></View>
                <View style={styles.connectionList}>{trustedDevices.data!.map((device) => <TrustedDeviceRow key={device.id} device={device} />)}</View>
              </WorkspaceSection>
            ) : null}

            {visibleDeveloperConnections.length > 0 ? (
              <WorkspaceSection title={connectionBucketLabel('DEVELOPER')} count={visibleDeveloperConnections.length}>
                <View style={styles.connectionList}>{visibleDeveloperConnections.map((item) => <ConnectedService key={item.id} item={item} connector={connectorByKey.get(item.connectorId)} token={token} />)}</View>
              </WorkspaceSection>
            ) : null}

            {search && visibleOnlineConnections.length + visibleDeveloperConnections.length + visibleApps.length + visibleUnconnectedApps.length + visibleAvailable.length === 0 ? <View style={styles.noResults}><Ionicons name="search-outline" size={21} color={colors.textMuted} /><Text style={styles.emptyConnectionCopy}>没有匹配的连接或来源</Text></View> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function UnconnectedAppRow({ app }: { app: DiscoveredDeviceApp }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  async function open() {
    setFeedback(null);
    const opened = await openDeviceApp(app.packageName);
    setFeedback(opened ? null : '无法打开该应用，请在 Android 真机确认它仍已安装。');
  }
  return (
    <View style={styles.unconnectedRow}>
      <View style={styles.compactIcon}>{app.iconDataUri ? <Image source={{ uri: app.iconDataUri }} style={styles.appIcon} /> : <Ionicons name="apps-outline" size={20} color={colors.primary} />}</View>
      <View style={styles.compactCopy}><Text numberOfLines={1} style={styles.compactTitle}>{app.displayName}</Text><Text style={styles.compactDetail}>{mobileAppStateLabel('INSTALLED')}</Text></View>
      <ActionButton label="打开" tone="quiet" onPress={() => void open()} />
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </View>
  );
}

function TrustedDeviceRow({ device }: { device: TrustedDeviceSummary }) {
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/connections/trusted-devices' as Href)} style={({ pressed }) => [styles.connectionRow, pressed && styles.rowPressed]}>
      <View style={styles.compactIcon}><Ionicons name="phone-portrait-outline" size={20} color={colors.primary} /></View>
      <View style={styles.compactCopy}><Text numberOfLines={1} style={styles.compactTitle}>可信设备</Text><Text style={styles.compactDetail}>{device.status === 'active' ? '已信任，在线状态另行检测' : '已撤销'}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function ConnectionStat({ icon, value, label, tone }: { icon: ComponentProps<typeof Ionicons>['name']; value: number; label: string; tone: 'success' | 'warning' | 'muted' | 'brand' }) {
  const color = tone === 'warning' ? colors.warning : tone === 'muted' ? colors.textMuted : colors.primary;
  return <View style={styles.stat}><Ionicons name={icon} size={18} color={color} /><View><Text style={[styles.statValue, { color }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View></View>;
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
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 72 },
  headerAction: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: '#FFDFBE', alignItems: 'center', justifyContent: 'center' },
  searchBox: { minHeight: 46, marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 0 },
  realityHint: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.accentSoft, borderRadius: radius.md },
  realityHintText: { ...typography.caption, flex: 1, color: colors.textSecondary, lineHeight: 18 },
  summaryStrip: { minHeight: 70, flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  statDivider: { width: 1, height: 30, backgroundColor: colors.border },
  statValue: { ...typography.bodyStrong },
  statLabel: { fontSize: 9, lineHeight: 13, color: colors.textMuted },
  stateSurface: { marginTop: spacing.xl },
  emptyConnection: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md },
  emptyConnectionTitle: { ...typography.bodyStrong, color: colors.text },
  emptyConnectionCopy: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  loginTitle: { ...typography.cardTitle, color: colors.text, marginBottom: spacing.sm },
  input: { ...typography.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: 12, marginTop: spacing.md },
  loginAction: { marginTop: spacing.lg },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  connectionList: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  availableList: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  availableBlock: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  availableRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  connectButton: { minWidth: 52, minHeight: 32, borderRadius: 11, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  connectDisabled: { opacity: 0.45 },
  connectButtonText: { ...typography.label, color: colors.primary },
  capabilityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingLeft: 46, paddingBottom: spacing.xs },
  capabilityChip: { maxWidth: '46%', flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  capabilityChipText: { color: colors.primary, fontSize: 8, lineHeight: 11, flexShrink: 1 },
  noResults: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  appFolderWrap: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  unconnectedList: { borderTopWidth: 1, borderTopColor: '#EAECF0' },
  unconnectedRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
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
  detailLink: { minHeight: 48, marginBottom: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailLinkCopy: { flex: 1 },
  detailLinkTitle: { ...typography.bodyStrong, color: colors.primary },
  detailLinkDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  account: { ...typography.caption, color: colors.textMuted },
  realityLine: { marginTop: spacing.sm },
  realityLineText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  realityLineTextWarning: { color: colors.warning },
  realityLineMuted: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
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
