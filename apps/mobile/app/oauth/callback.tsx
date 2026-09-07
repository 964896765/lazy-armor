import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { oauthCallbackRequest, oauthFailureMessage, permissionUpdateRequest } from '../../src/connection-api-contract';
import { capabilityDescription, capabilityLabel } from '../../src/connection-presenter';
import { ActionButton, Surface, colors, radius, spacing, typography } from '../../src/design';

interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string }
interface Permission { capability: string; name: string; riskLevel: string; granted: boolean }

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
  const permissions = useQuery({ queryKey: ['connection-permissions', callback.data?.id], queryFn: () => api<Permission[]>(`/connections/${callback.data!.id}/permissions`, token!), enabled: Boolean(token && callback.data?.id) });
  const updatePermission = useMutation({
    mutationFn: (permission: Permission) => { const request = permissionUpdateRequest(callback.data!.id, permission.capability, !permission.granted); return api<Permission[]>(request.path, token!, request.init); },
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {(callback.isPending || (callback.isIdle && !failure)) ? (
          <View style={styles.centerState}>
            <View style={styles.loadingIcon}><ActivityIndicator color={colors.primary} /></View>
            <Text style={styles.stateTitle}>正在完成连接</Text>
            <Text style={styles.stateDescription}>马上就好，正在安全地确认授权信息。</Text>
          </View>
        ) : null}

        {failure ? (
          <View style={styles.centerState}>
            <View style={[styles.stateIcon, styles.failureIcon]}><Ionicons name="warning" size={30} color={colors.warning} /></View>
            <Text style={styles.stateTitle}>连接没有完成</Text>
            <Text style={styles.stateDescription}>{failure}</Text>
            <View style={styles.stateAction}><ActionButton label="返回我的连接" onPress={() => router.replace('/connections')} /></View>
          </View>
        ) : null}

        {callback.data ? (
          <>
            <View style={styles.successHeader}>
              <View style={[styles.stateIcon, styles.successIcon]}><Ionicons name="checkmark" size={32} color={colors.surface} /></View>
              <Text style={styles.stateTitle}>连接成功</Text>
              <Text style={styles.stateDescription}>{callback.data.connectorName} · {callback.data.externalAccountName}</Text>
            </View>

            <Text style={styles.sectionTitle}>它会使用这些信息</Text>
            <Text style={styles.sectionDescription}>只为你启用的计划使用，你可以随时在权限中心关闭。</Text>
            <View style={styles.permissionList}>
              {permissions.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
              {permissions.data?.map((permission) => (
                <Surface key={permission.capability}>
                  <View style={styles.permissionHeader}>
                    <View style={styles.permissionIcon}><Ionicons name={permissionIcon(permission.capability)} size={20} color={colors.primary} /></View>
                    <View style={styles.permissionCopy}>
                      <Text style={styles.permissionName}>{capabilityLabel(callback.data!.connectorId, permission.capability, permission.name)}</Text>
                      <Text style={styles.permissionDescription}>{capabilityDescription(callback.data!.connectorId, permission.capability)}</Text>
                    </View>
                  </View>
                  <View style={styles.permissionAction}><ActionButton label={permission.granted ? '关闭' : '允许'} tone={permission.granted ? 'quiet' : 'primary'} onPress={() => updatePermission.mutate(permission)} disabled={updatePermission.isPending} /></View>
                </Surface>
              ))}
            </View>
            <View style={styles.done}><ActionButton label="完成" onPress={() => router.replace('/connections')} /></View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function permissionIcon(capability: string): ComponentProps<typeof Ionicons>['name'] {
  if (capability.includes('EMAIL')) return 'mail-outline';
  if (capability.includes('EVENT')) return 'calendar-outline';
  return 'lock-closed-outline';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.page, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl },
  centerState: { flex: 1, minHeight: 480, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  loadingIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  stateIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  successIcon: { backgroundColor: colors.success },
  failureIcon: { backgroundColor: colors.warningSoft },
  stateTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
  stateDescription: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  stateAction: { marginTop: spacing.xl },
  successHeader: { alignItems: 'center', marginBottom: spacing.xxxl },
  sectionTitle: { ...typography.section, color: colors.text },
  sectionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },
  permissionList: { gap: spacing.md },
  permissionHeader: { flexDirection: 'row', gap: spacing.md },
  permissionIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  permissionCopy: { flex: 1 },
  permissionName: { ...typography.bodyStrong, color: colors.text },
  permissionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  permissionAction: { alignItems: 'flex-end', marginTop: spacing.lg },
  done: { marginTop: spacing.xxl },
});
