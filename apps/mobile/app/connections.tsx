import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { capabilityDescription, capabilityLabel, capabilityRiskHint, connectionActionLabel, connectionStatusLabel } from '../src/connection-presenter';
import { styles } from '../src/shell';

interface Connector {
  key: string;
  name: string;
  description: string;
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

function ConnectionCard({ item, token }: { item: Connection; token: string }) {
  const client = useQueryClient();
  const permissions = useQuery({
    queryKey: ['connection-permissions', item.id],
    queryFn: () => api<Permission[]>(`/connections/${item.id}/permissions`, token),
  });
  const updatePermission = useMutation({
    mutationFn: (permission: Permission) => api<Permission[]>(`/connections/${item.id}/permissions`, token, {
      method: 'PUT',
      body: JSON.stringify({ permissions: [{ capability: permission.capability, granted: !permission.granted }] }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connection-permissions', item.id] }),
  });
  const revoke = useMutation({
    mutationFn: () => api<void>(`/connections/${item.id}`, token, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.connectorName}</Text>
      <Text style={styles.cardText}>{item.externalAccountName} · {connectionStatusLabel(item.status)}</Text>
      <Text style={local.permissionHeading}>权限</Text>
      {permissions.isLoading && <ActivityIndicator />}
      {permissions.data?.map((permission) => (
        <View style={local.permissionRow} key={permission.capability}>
          <View style={local.permissionCopy}>
            <Text style={local.permissionName}>{capabilityLabel(permission.capability, permission.name)}</Text>
            <Text style={local.permissionMeta}>{permission.granted ? '已授权' : '未授权'}</Text>
            <Text style={local.permissionDesc}>{capabilityDescription(permission.capability)}</Text>
            <Text style={local.permissionHint}>{capabilityRiskHint(permission.capability, permission.riskLevel)}</Text>
          </View>
          <Button
            title={connectionActionLabel(permission.granted)}
            onPress={() => updatePermission.mutate(permission)}
            disabled={updatePermission.isPending || item.status === 'revoked'}
          />
        </View>
      ))}
      <View style={local.revokeButton}>
        <Button title="撤销连接" color="#9A3F3F" onPress={() => revoke.mutate()} disabled={revoke.isPending} />
      </View>
    </View>
  );
}

export default function ConnectionsPage() {
  const token = useAuthStore((state) => state.token);
  const setSession = useAuthStore((state) => state.setSession);
  const clear = useAuthStore((state) => state.clear);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const client = useQueryClient();
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const connections = useQuery({
    queryKey: ['connections', token],
    queryFn: () => api<Connection[]>('/connections', token),
    enabled: Boolean(token),
  });
  const login = useMutation({
    mutationFn: () => api<{ accessToken: string; refreshToken: string }>('/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
    onSuccess: (result) => setSession(result),
  });
  const connect = useMutation({
    mutationFn: (connector: Connector) => api<Connection>('/connections', token, {
      method: 'POST',
      body: JSON.stringify({ connectorId: connector.key, externalAccountName: connector.name }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });

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
          <View style={local.headerRow}>
            <Text style={local.section}>已连接服务</Text>
            <Button title="退出登录" onPress={() => clear()} />
          </View>
          {connections.isLoading && <ActivityIndicator />}
          {connections.data?.length === 0 && <Text style={local.empty}>还没有连接服务。</Text>}
          {connections.data?.map((item) => <ConnectionCard key={item.id} item={item} token={token} />)}
          <Text style={local.section}>连接服务</Text>
          {connectors.data?.map((item) => (
            <View style={styles.card} key={item.key}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardText}>{item.description}</Text>
              <Button title="连接" onPress={() => connect.mutate(item)} disabled={connect.isPending} />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  section: { fontSize: 20, fontWeight: '800', marginVertical: 14, color: '#1F3028' },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 10, padding: 12, marginTop: 12, backgroundColor: '#FAFBFA' },
  error: { color: '#A63D3D', marginTop: 10 },
  empty: { color: '#6B7770', marginBottom: 18 },
  permissionHeading: { color: '#25362E', fontWeight: '700', marginTop: 16, marginBottom: 4 },
  permissionRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EDF0EE', paddingVertical: 10 },
  permissionCopy: { flex: 1, paddingRight: 12 },
  permissionName: { color: '#25362E', fontWeight: '600' },
  permissionMeta: { color: '#76827B', marginTop: 3, fontSize: 12 },
  permissionDesc: { color: '#5E6A63', marginTop: 4, lineHeight: 18 },
  permissionHint: { color: '#287052', marginTop: 4, lineHeight: 18 },
  revokeButton: { marginTop: 12 },
});
