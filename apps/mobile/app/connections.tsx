import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { connectionStartRequest, disconnectRequest, reconnectRequest, validateConnectionRequest } from '../src/connection-api-contract';
import { openSupportedDeviceApp } from '../src/device-app-bridge';
import {
  capabilityDescription,
  capabilityLabel,
  capabilityRiskHint,
  connectionActionLabel,
  connectionRecoveryAction,
  connectionStatusLabel,
  isConsumerConnector,
  providerReadinessLabel,
} from '../src/connection-presenter';
import { ActionButton, ConnectionCard as ConnectionSummaryCard, EmptyState, Surface, colors, radius, spacing, typography } from '../src/design';

WebBrowser.maybeCompleteAuthSession();

interface ConnectorCapability { key: string; name: string; requiresConfirmation: boolean }
interface Connector { key: string; name: string; description: string; productionStatus: string; connectable: boolean; draftOnly: boolean; authentication: { type: string }; capabilities: ConnectorCapability[] }
interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string; status: string }
interface Permission { capability: string; name: string; riskLevel: string; granted: boolean; expiresAt?: string }
interface ConnectionPlanUsage { planId: string; planName: string; planStatus: string; requiredCapabilities: string[] }
interface OAuthStartResult { providerKey: string; authorizationUrl: string; expiresAt: string }
interface DeviceAppConnection { id: string; packageName: string; displayName: string; enabled: boolean; modes: string[]; lastSeenAt: string | null }

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
      <ConnectionSummaryCard
        name={connectionDisplayName(item.connectorId, item.connectorName)}
        status={connectionStatusLabel(item.status)}
        helpsWith={helpsWith.length > 0 ? helpsWith : ['等待你安排第一个计划']}
        onManage={() => setExpanded((current) => !current)}
      />
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

function DeviceAppService({ item, token }: { item: DeviceAppConnection; token: string }) {
  const client = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: () => api<DeviceAppConnection>(`/device-app-connections/${item.id}`, token, { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled }) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['device-app-connections', token] }),
        client.invalidateQueries({ queryKey: ['rail-device-app-connections', token] }),
      ]);
    },
  });
  async function open() {
    setFeedback(null);
    const opened = await openSupportedDeviceApp(item.packageName);
    setFeedback(opened ? '已打开应用。' : '无法打开该应用：请在 Android 真机确认它仍已安装。');
  }
  return (
    <Surface>
      <View style={styles.providerHeader}>
        <View style={styles.providerIcon}><Text style={styles.providerEmoji}>{item.displayName.slice(0, 1)}</Text></View>
        <View style={styles.providerCopy}><Text style={styles.providerName}>{item.displayName}</Text><Text style={styles.readiness}>{item.enabled ? '已添加到当前设备' : '已停用'}</Text></View>
      </View>
      <Text style={styles.providerDescription}>{item.enabled ? `当前已启用：${item.modes.join('、')}。仅使用你确认的能力。` : '停用后不会在空间导航中显示，也不会被计划使用。'}</Text>
      <View style={styles.deviceActions}><ActionButton label="打开应用" tone="quiet" onPress={() => void open()} disabled={!item.enabled} /><ActionButton label={item.enabled ? '停用连接' : '重新启用'} tone={item.enabled ? 'quiet' : 'primary'} onPress={() => update.mutate()} disabled={update.isPending} /></View>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </Surface>
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
        <View style={styles.providerIcon}><Text style={styles.providerEmoji}>{providerIcon(connector.key)}</Text></View>
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
  const setSession = useAuthStore((store) => store.setSession);
  const clear = useAuthStore((store) => store.clear);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const deviceApps = useQuery({ queryKey: ['device-app-connections', token], queryFn: () => api<DeviceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const login = useMutation({ mutationFn: () => api<{ accessToken: string; refreshToken: string }>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email, password }) }), onSuccess: (result) => setSession(result) });
  const consumerConnectors = useMemo(() => connectors.data?.filter((connector) => isConsumerConnector(connector.key)) ?? [], [connectors.data]);
  const activeProviderKeys = new Set((connections.data ?? []).filter((connection) => connection.status !== 'revoked').map((connection) => connection.connectorId));
  const available = consumerConnectors.filter((connector) => connectionStartRequest(connector, 'placeholder') !== null && !activeProviderKeys.has(connector.key));
  const connectorByKey = new Map(consumerConnectors.map((connector) => [connector.key, connector]));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={connections.isFetching} onRefresh={() => connections.refetch()} /> : undefined}>
        <View style={styles.header}><Text style={styles.title}>我的连接</Text><Text style={styles.subtitle}>把常用服务交给懒人装甲，计划才能替你读取和整理信息。</Text></View>
        {!token ? (
          <Surface>
            <Text style={styles.loginTitle}>先登录你的懒人装甲</Text>
            <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" placeholder="邮箱" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
            <TextInput style={styles.input} secureTextEntry placeholder="密码" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} />
            <View style={styles.loginAction}><ActionButton label={login.isPending ? '登录中…' : '登录'} onPress={() => login.mutate()} disabled={login.isPending || !email.trim() || !password} /></View>
            {login.isError ? <Text style={styles.error}>没有登录成功，请检查邮箱和密码。</Text> : null}
          </Surface>
        ) : (
          <>
            <Text style={styles.sectionTitle}>正在使用</Text>
            {connections.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
            {(connections.data?.length ?? 0) + (deviceApps.data?.length ?? 0) === 0 ? <Surface><EmptyState icon="🔗" title="还没有连接服务" description="可以连接在线服务，或添加已安装的手机应用。" action={{ label: '添加连接', onPress: () => router.push('/connections/add' as Href) }} /></Surface> : null}
            <View style={styles.list}>{connections.data?.map((item) => <ConnectedService key={item.id} item={item} connector={connectorByKey.get(item.connectorId)} token={token} />)}</View>
            {(deviceApps.data?.length ?? 0) > 0 ? <><Text style={styles.sectionTitle}>手机应用</Text><View style={styles.list}>{deviceApps.data?.map((item) => <DeviceAppService key={item.id} item={item} token={token} />)}</View></> : null}

            {available.length > 0 ? <><Text style={styles.sectionTitle}>可以连接</Text><View style={styles.list}>{available.map((connector) => <AvailableService key={connector.key} connector={connector} token={token} />)}</View></> : null}

            <View style={styles.addConnection}><ActionButton label="＋ 添加连接" tone="quiet" onPress={() => router.push('/connections/add' as Href)} /></View>
            <View style={styles.logout}><ActionButton label="退出登录" tone="quiet" onPress={() => void clear()} /></View>
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

function providerIcon(key: string) {
  if (key === 'gmail') return '✉️';
  if (key === 'google_calendar' || key === 'calendar') return '📅';
  if (key === 'file_provider') return '📄';
  return '🔗';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 72 },
  header: { marginBottom: spacing.xxl },
  title: { ...typography.display, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, maxWidth: 340 },
  loginTitle: { ...typography.cardTitle, color: colors.text, marginBottom: spacing.sm },
  input: { ...typography.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingVertical: 12, marginTop: spacing.md },
  loginAction: { marginTop: spacing.lg },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  list: { gap: spacing.md },
  connectionBlock: { gap: spacing.sm },
  management: { marginHorizontal: spacing.sm, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
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
  providerEmoji: { fontSize: 22 },
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
