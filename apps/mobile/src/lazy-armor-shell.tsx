import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { RailItem } from './design';
import { discoverLaunchableApps } from './device-app-bridge';
import { buildConnectionRailModel } from './rail-model';

interface RailConnection {
  id: string;
  connectorId: string;
  connectorName: string;
  externalAccountName: string;
  status: string;
}

interface RailDeviceAppConnection {
  id: string;
  packageName: string;
  displayName: string;
  enabled: boolean;
  trustedDeviceId: string | null;
}

interface RailTrustedDevice { id: string; status: 'active' | 'revoked' }
interface RailPendingNotification { id: string; connectionId: string }
const RAIL_WIDTH = 54;
export function ConnectionRail({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((store) => store.token);
  const connections = useQuery({
    queryKey: ['rail-connections', token],
    queryFn: () => api<RailConnection[]>('/connections', token),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const deviceApps = useQuery({
    queryKey: ['rail-device-app-connections', token],
    queryFn: () => api<RailDeviceAppConnection[]>('/device-app-connections', token),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const trustedDevices = useQuery({
    queryKey: ['rail-trusted-devices', token],
    queryFn: () => api<RailTrustedDevice[]>('/trusted-devices', token),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const pendingNotifications = useQuery({
    queryKey: ['rail-pending-notification-receipts', token],
    queryFn: () => api<RailPendingNotification[]>('/device-app-connections/notification-receipts', token),
    enabled: Boolean(token),
    staleTime: 20_000,
  });
  const discoveredApps = useQuery({
    queryKey: ['rail-discovered-device-apps'],
    queryFn: discoverLaunchableApps,
    enabled: Boolean(token && (deviceApps.data?.length ?? 0) > 0),
    staleTime: 5 * 60_000,
  });
  const unreadByConnection = new Map<string, number>();
  for (const receipt of pendingNotifications.data ?? []) unreadByConnection.set(receipt.connectionId, (unreadByConnection.get(receipt.connectionId) ?? 0) + 1);
  const rail = buildConnectionRailModel({
    providers: (connections.data ?? []).map((connection) => ({
      id: connection.id,
      key: connection.connectorId,
      label: connection.connectorName,
      status: connection.status,
    })),
    deviceApps: (deviceApps.data ?? []).map((connection) => ({
      id: connection.id,
      packageName: connection.packageName,
      label: connection.displayName,
      enabled: connection.enabled,
      trustedDeviceId: connection.trustedDeviceId,
      unread: unreadByConnection.get(connection.id) ?? 0,
    })),
    trustedDevices: trustedDevices.data ?? [],
    discoveredApps: (discoveredApps.data ?? []).map((app) => ({ packageName: app.packageName, iconDataUri: app.iconDataUri })),
  });
  const iconByPackage = new Map((discoveredApps.data ?? []).map((app) => [app.packageName, app.iconDataUri]));

  function selectTab(routeName: string) {
    const route = state.routes.find((candidate) => candidate.name === routeName);
    if (!route) return;
    const isFocused = state.routes[state.index]?.key === route.key;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) navigation.navigate(routeName as never);
  }

  const activeRoute = state.routes[state.index]?.name;

  return (
    <View style={[styles.frame, { top: Math.max(insets.top, 5), bottom: Math.max(insets.bottom, 5) }]}>
      <View style={styles.fixedTop}>
        <RailItem label="今天" icon="sunny-outline" badgeCount={pendingNotifications.data?.length ?? 0} selected={activeRoute === 'index'} tone="brand" showLabel onPress={() => selectTab('index')} />
        <RailItem label="计划" icon="list-outline" selected={activeRoute === 'plans'} showLabel onPress={() => selectTab('plans')} />
        <RailItem label="连接" icon="link-outline" selected={activeRoute === 'connections'} showLabel onPress={() => selectTab('connections')} />
        <RailItem label="记录" icon="time-outline" selected={activeRoute === 'records'} showLabel onPress={() => selectTab('records')} />
        <RailItem label="我的" icon="person-outline" selected={activeRoute === 'me'} showLabel onPress={() => selectTab('me')} />
        <View style={styles.divider} />
        <Text style={styles.railLabel}>快捷连接</Text>
      </View>

      <ScrollView style={styles.scroller} contentContainerStyle={styles.connections} showsVerticalScrollIndicator={false}>
        {rail.visible.map((connection) => (
          <RailItem
            key={`${connection.kind}:${connection.id}`}
            label={connection.label}
            icon={connectionIcon(connection.label)}
            imageUri={connection.kind === 'app' ? iconByPackage.get(connection.key) : undefined}
            status={connection.status}
            badgeCount={connection.unread}
            showLabel={false}
            onPress={() => selectTab('connections')}
          />
        ))}
        {rail.overflowCount > 0 ? <RailItem label={`更多 ${rail.overflowCount}`} icon="ellipsis-horizontal" showLabel={false} onPress={() => selectTab('connections')} /> : null}
        <RailItem label="添加连接" icon="add" tone="action" showLabel={false} onPress={() => router.push('/connections/add' as never)} />
      </ScrollView>
    </View>
  );
}

function connectionIcon(label: string): 'logo-github' | 'mail-outline' | 'chatbubbles-outline' | 'wallet-outline' | 'cart-outline' | 'phone-portrait-outline' | 'link-outline' {
  const normalized = label.toLowerCase();
  if (normalized.includes('github')) return 'logo-github';
  if (normalized.includes('gmail') || normalized.includes('mail') || normalized.includes('邮箱')) return 'mail-outline';
  if (normalized.includes('微信')) return 'chatbubbles-outline';
  if (normalized.includes('支付宝')) return 'wallet-outline';
  if (normalized.includes('淘宝')) return 'cart-outline';
  if (normalized.includes('移动') || normalized.includes('mobile')) return 'phone-portrait-outline';
  return 'link-outline';
}

export const shellLayout = { railWidth: RAIL_WIDTH } as const;

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, width: RAIL_WIDTH, zIndex: 10, paddingHorizontal: 5, paddingVertical: 6, backgroundColor: '#EFF8F5', borderRightWidth: 1, borderRightColor: '#DDECE7' },
  fixedTop: { alignItems: 'center', gap: 2 },
  divider: { width: 36, height: 1, backgroundColor: '#EAECF0', marginVertical: 3 },
  railLabel: { width: 44, color: '#788A84', fontSize: 6, lineHeight: 9, textAlign: 'center', fontWeight: '700', marginVertical: 2 },
  scroller: { flex: 1 },
  connections: { alignItems: 'center', gap: 2, paddingVertical: 2 },
});
