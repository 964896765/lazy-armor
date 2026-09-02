import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { connectionStartRequest, disconnectRequest, reconnectRequest, validateConnectionRequest } from '../src/connection-api-contract';
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
import { useAuthStore } from '../src/auth-store';
import { styles } from '../src/shell';

WebBrowser.maybeCompleteAuthSession();

interface ConnectorCapability {
  key: string;
  name: string;
  requiresConfirmation: boolean;
}

interface Connector {
  key: string;
  name: string;
  description: string;
  productionStatus: string;
  connectable: boolean;
  draftOnly: boolean;
  authentication: { type: string };
  capabilities: ConnectorCapability[];
}

interface Connection {
  id: string;
  connectorId: string;
  connectorName: string;
  externalAccountName: string;
  status: string;
}

interface Permission {
  capability: string;
  name: string;
  riskLevel: string;
  granted: boolean;
  expiresAt?: string;
}

interface ConnectionPlanUsage {
  planId: string;
  planName: string;
  planStatus: string;
  requiredCapabilities: string[];
}

interface OAuthStartResult {
  providerKey: string;
  authorizationUrl: string;
  expiresAt: string;
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function openAuthorization(started: OAuthStartResult, redirectUri: string, onCancel: () => void) {
  const result = await WebBrowser.openAuthSessionAsync(started.authorizationUrl, redirectUri);
  if (result.type !== 'success') {
    onCancel();
    return null;
  }
  const parsed = Linking.parse(result.url);
  return {
    provider: started.providerKey,
    redirectUri,
    code: stringParam(parsed.queryParams?.code),
    state: stringParam(parsed.queryParams?.state),
    error: stringParam(parsed.queryParams?.error),
  };
}

function ConnectionCard({ item, connector, token }: { item: Connection; connector?: Connector; token: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const permissions = useQuery({
    queryKey: ['connection-permissions', item.id],
    queryFn: () => api<Permission[]>(`/connections/${item.id}/permissions`, token),
  });
  const plans = useQuery({
    queryKey: ['connection-plans', item.id],
    queryFn: () => api<ConnectionPlanUsage[]>(`/connections/${item.id}/plans`, token),
  });
  const updatePermission = useMutation({
    mutationFn: (permission: Permission) => api<Permission[]>(`/connections/${item.id}/permissions`, token, {
      method: 'PUT', body: JSON.stringify({ permissions: [{ capability: permission.capability, granted: !permission.granted }] }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connection-permissions', item.id] }),
  });
  const disconnect = useMutation({
    mutationFn: () => {
      const request = disconnectRequest(item.id);
      return api<void>(request.path, token, request.init);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });
  const recovery = connectionRecoveryAction(item.status);

  async function recover() {
    setFeedback(null);
    try {
      if (recovery === '检查权限') {
        await permissions.refetch();
        return;
      }
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
      const callback = await openAuthorization(started, redirectUri, () => setFeedback('你取消了连接，没有任何权限被授予。'));
      // Expo typed-route declarations are generated on the next native/web build.
      if (callback) router.push({ pathname: '/oauth/callback', params: callback } as unknown as Href);
    } catch {
      setFeedback('网络没有连通，你的账号没有被修改。');
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      '断开账号？',
      '断开后，使用这个账号的计划会停止读取相关信息，但计划和历史记录会保留。',
      [{ text: '取消', style: 'cancel' }, { text: '断开账号', style: 'destructive', onPress: () => disconnect.mutate() }],
    );
  }

  function changePermission(permission: Permission) {
    const affected = (plans.data ?? []).filter((plan) => plan.requiredCapabilities.includes(permission.capability));
    if (!permission.granted || affected.length === 0) {
      updatePermission.mutate(permission);
      return;
    }
    Alert.alert(
      `撤销“${capabilityLabel(item.connectorId, permission.capability, permission.name)}”？`,
      `${affected.map((plan) => `“${plan.planName}”`).join('、')}将无法使用这项能力，但计划本身和历史记录不会被删除。`,
      [{ text: '保留权限', style: 'cancel' }, { text: '仍要撤销', style: 'destructive', onPress: () => updatePermission.mutate(permission) }],
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.connectorName}</Text>
      <Text style={styles.cardText}>{item.externalAccountName} · {connectionStatusLabel(item.status)}</Text>
      {recovery && <View style={local.action}><Button title={recovery} onPress={() => void recover()} /></View>}
      {feedback && <Text style={local.feedback}>{feedback}</Text>}
      <Text style={local.permissionHeading}>权限</Text>
      {permissions.isLoading && <ActivityIndicator />}
      {permissions.data?.map((permission) => (
        <View style={local.permissionRow} key={permission.capability}>
          <View style={local.permissionCopy}>
            <Text style={local.permissionName}>{capabilityLabel(item.connectorId, permission.capability, permission.name)}</Text>
            <Text style={local.permissionMeta}>{permission.granted ? '已授权' : '未授权'}</Text>
            <Text style={local.permissionDesc}>{capabilityDescription(item.connectorId, permission.capability)}</Text>
            <Text style={local.permissionHint}>{capabilityRiskHint(permission.capability, permission.riskLevel)}</Text>
          </View>
          <Button title={connectionActionLabel(permission.granted)} onPress={() => changePermission(permission)} disabled={updatePermission.isPending || item.status === 'revoked'} />
        </View>
      ))}
      <Text style={local.permissionHeading}>正在使用这个连接的计划</Text>
      {plans.isLoading && <ActivityIndicator />}
      {plans.data?.length === 0 && <Text style={local.permissionDesc}>目前没有运行中的计划使用它。</Text>}
      {plans.data?.map((plan) => <Text style={local.permissionDesc} key={plan.planId}>· {plan.planName}</Text>)}
      <View style={local.revokeButton}>
        <Button title="断开账号" color="#9A3F3F" onPress={confirmDisconnect} disabled={disconnect.isPending || item.status === 'revoked'} />
      </View>
    </View>
  );
}

function ConnectorCard({ connector, token }: { connector: Connector; token: string }) {
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
      const callback = await openAuthorization(started, redirectUri, () => setFeedback('你取消了连接，没有任何权限被授予。'));
      if (callback) router.push({ pathname: '/oauth/callback', params: callback } as unknown as Href);
    } catch {
      setFeedback('网络没有连通，你的账号没有被修改。');
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={local.providerHeading}>
        <Text style={styles.cardTitle}>{connector.name}</Text>
        <Text style={local.readiness}>{providerReadinessLabel(connector.productionStatus)}</Text>
      </View>
      <Text style={styles.cardText}>{connector.description}</Text>
      {connector.capabilities.map((capability) => (
        <Text style={local.capability} key={capability.key}>· {capabilityLabel(connector.key, capability.key, capability.name)}</Text>
      ))}
      <View style={local.action}>
        {connector.key === 'file_provider'
          ? <Button title="选择账单文件" onPress={() => router.push('/file-import' as Href)} />
          : <Button title={requestAvailable ? (pending ? '连接中…' : '连接') : providerReadinessLabel(connector.productionStatus)} onPress={() => void connect()} disabled={!requestAvailable || pending} />}
      </View>
      {feedback && <Text style={local.feedback}>{feedback}</Text>}
    </View>
  );
}

export default function ConnectionsPage() {
  const token = useAuthStore((state) => state.token);
  const setSession = useAuthStore((state) => state.setSession);
  const clear = useAuthStore((state) => state.clear);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const login = useMutation({
    mutationFn: () => api<{ accessToken: string; refreshToken: string }>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email, password }) }),
    onSuccess: (result) => setSession(result),
  });
  const consumerConnectors = useMemo(() => connectors.data?.filter((connector) => isConsumerConnector(connector.key)) ?? [], [connectors.data]);
  const available = consumerConnectors.filter((connector) => connectionStartRequest(connector, 'placeholder') !== null);
  const upcoming = consumerConnectors.filter((connector) => connectionStartRequest(connector, 'placeholder') === null);
  const connectorByKey = new Map(consumerConnectors.map((connector) => [connector.key, connector]));

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      {!token && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>登录后管理连接</Text>
          <TextInput style={local.input} autoCapitalize="none" placeholder="邮箱" value={email} onChangeText={setEmail} />
          <TextInput style={local.input} secureTextEntry placeholder="密码" value={password} onChangeText={setPassword} />
          <Button title={login.isPending ? '登录中…' : '登录'} onPress={() => login.mutate()} disabled={login.isPending} />
          {login.isError && <Text style={local.error}>登录失败，请检查账号。</Text>}
        </View>
      )}
      {token && (
        <>
          <View style={local.headerRow}><Text style={local.section}>我的连接</Text><Button title="退出登录" onPress={() => clear()} /></View>
          {connections.isLoading && <ActivityIndicator />}
          {connections.data?.length === 0 && <Text style={local.empty}>还没有连接服务。</Text>}
          {connections.data?.map((item) => <ConnectionCard key={item.id} item={item} connector={connectorByKey.get(item.connectorId)} token={token} />)}
          <Text style={local.section}>可以连接</Text>
          {available.map((connector) => <ConnectorCard key={connector.key} connector={connector} token={token} />)}
          <Text style={local.section}>即将支持</Text>
          {upcoming.map((connector) => <ConnectorCard key={connector.key} connector={connector} token={token} />)}
        </>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  providerHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { fontSize: 20, fontWeight: '800', marginVertical: 14, color: '#1F3028' },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 10, padding: 12, marginTop: 12, backgroundColor: '#FAFBFA' },
  error: { color: '#A63D3D', marginTop: 10 }, empty: { color: '#6B7770', marginBottom: 18 },
  feedback: { color: '#7A4C12', marginTop: 10, lineHeight: 19 }, readiness: { color: '#287052', fontWeight: '700' },
  capability: { color: '#5E6A63', marginTop: 5 }, action: { marginTop: 12 },
  permissionHeading: { color: '#25362E', fontWeight: '700', marginTop: 16, marginBottom: 4 },
  permissionRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EDF0EE', paddingVertical: 10 },
  permissionCopy: { flex: 1, paddingRight: 12 }, permissionName: { color: '#25362E', fontWeight: '600' },
  permissionMeta: { color: '#76827B', marginTop: 3, fontSize: 12 }, permissionDesc: { color: '#5E6A63', marginTop: 4, lineHeight: 18 },
  permissionHint: { color: '#287052', marginTop: 4, lineHeight: 18 }, revokeButton: { marginTop: 12 },
});
