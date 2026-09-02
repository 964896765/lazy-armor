import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from '../../src/api';
import { oauthCallbackRequest, oauthFailureMessage, permissionUpdateRequest } from '../../src/connection-api-contract';
import { capabilityDescription, capabilityLabel } from '../../src/connection-presenter';
import { useAuthStore } from '../../src/auth-store';
import { styles } from '../../src/shell';

interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string; }
interface Permission { capability: string; name: string; riskLevel: string; granted: boolean; }

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default function OAuthCallbackPage() {
  const params = useLocalSearchParams<{ provider?: string | string[]; code?: string | string[]; state?: string | string[]; error?: string | string[] }>();
  const provider = first(params.provider);
  const code = first(params.code);
  const state = first(params.state);
  const providerError = first(params.error);
  const token = useAuthStore((store) => store.token);
  const router = useRouter();
  const client = useQueryClient();
  const redirectUri = useMemo(() => provider ? Linking.createURL('/oauth/callback', { queryParams: { provider } }) : '', [provider]);
  const callback = useMutation({
    mutationFn: async () => {
      if (!token || !provider || !code || !state) throw new Error('INVALID_CALLBACK');
      const request = oauthCallbackRequest(provider, code, state, redirectUri);
      return api<Connection>(request.path, token, request.init);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });
  const permissions = useQuery({
    queryKey: ['connection-permissions', callback.data?.id],
    queryFn: () => api<Permission[]>(`/connections/${callback.data!.id}/permissions`, token!),
    enabled: Boolean(token && callback.data?.id),
  });
  const updatePermission = useMutation({
    mutationFn: (permission: Permission) => {
      const request = permissionUpdateRequest(callback.data!.id, permission.capability, !permission.granted);
      return api<Permission[]>(request.path, token!, request.init);
    },
    onSuccess: () => permissions.refetch(),
  });

  useEffect(() => {
    if (token && provider && code && state && !providerError && callback.isIdle) callback.mutate();
  }, [token, provider, code, state, providerError, callback]);

  let failure: string | null = null;
  if (!token) failure = '这个账号需要重新登录。';
  else if (providerError === 'access_denied') failure = oauthFailureMessage('cancelled');
  else if (providerError) failure = oauthFailureMessage('provider_denied');
  else if (!provider || !code || !state) failure = oauthFailureMessage('provider_denied');
  else if (callback.error instanceof ApiError && callback.error.message.includes('expired')) failure = oauthFailureMessage('state_expired');
  else if (callback.isError) failure = oauthFailureMessage(callback.error instanceof TypeError ? 'network' : 'provider_denied');

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <View style={styles.card}>
        {(callback.isPending || (callback.isIdle && !failure)) && <><ActivityIndicator /><Text style={local.center}>正在完成连接…</Text></>}
        {failure && <><Text style={styles.cardTitle}>连接没有完成</Text><Text style={styles.cardText}>{failure}</Text><Button title="返回我的连接" onPress={() => router.replace('/connections')} /></>}
        {callback.data && <>
          <Text style={styles.cardTitle}>连接成功</Text>
          <Text style={styles.cardText}>{callback.data.connectorName} · {callback.data.externalAccountName}</Text>
          <Text style={local.heading}>请确认授权范围</Text>
          {permissions.isLoading && <ActivityIndicator />}
          {permissions.data?.map((permission) => <View key={permission.capability} style={local.permission}>
            <View style={local.permissionCopy}>
              <Text style={local.permissionName}>{capabilityLabel(callback.data!.connectorId, permission.capability, permission.name)}</Text>
              <Text style={local.permissionDescription}>{capabilityDescription(callback.data!.connectorId, permission.capability)}</Text>
            </View>
            <Button title={permission.granted ? '撤销' : '授权'} onPress={() => updatePermission.mutate(permission)} disabled={updatePermission.isPending} />
          </View>)}
          <Button title="完成" onPress={() => router.replace('/connections')} />
        </>}
      </View>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' }, content: { padding: 20 }, center: { textAlign: 'center', color: '#5E6A63', marginTop: 12 },
  heading: { color: '#25362E', fontSize: 18, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  permission: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#EDF0EE' },
  permissionCopy: { flex: 1, paddingRight: 12 }, permissionName: { color: '#25362E', fontWeight: '700' },
  permissionDescription: { color: '#5E6A63', marginTop: 4, lineHeight: 18 },
});
