import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { CollapsedAppFolder, RailItem } from './design';
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
interface RailProfile { displayName: string }

const RAIL_WIDTH = 66;
const tabItems: Readonly<Record<string, { label: string; symbol: string; tone?: 'brand' }>> = Object.freeze({
  index: { label: '消息', symbol: '▤', tone: 'brand' },
  plans: { label: '懒人装甲', symbol: '懒' },
});

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
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
  });
  const profile = useQuery({
    queryKey: ['me', token],
    queryFn: () => api<RailProfile>('/me', token),
    enabled: Boolean(token),
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

  return (
    <View style={[styles.frame, { top: Math.max(insets.top, 5), bottom: Math.max(insets.bottom, 5) }]}>
      <View style={styles.fixedTop}>
        {state.routes.filter((route) => tabItems[route.name]).map((route) => {
          const item = tabItems[route.name]!;
          return <RailItem key={route.key} label={item.label} symbol={item.symbol} badgeCount={route.name === 'index' ? (pendingNotifications.data?.length ?? 0) : 0} selected={state.routes[state.index]?.key === route.key} tone={item.tone} onPress={() => selectTab(route.name)} />;
        })}
        <RailItem label="懒人商城" symbol="店" tone="commerce" onPress={() => router.push('/commerce' as never)} />
        <View style={styles.divider} />
      </View>

      <ScrollView style={styles.scroller} contentContainerStyle={styles.connections} showsVerticalScrollIndicator={false}>
        {rail.visible.map((connection) => (
          <RailItem
            key={`${connection.kind}:${connection.id}`}
            label={connection.label}
            symbol={connectionSymbol(connection.label)}
            imageUri={connection.kind === 'app' ? iconByPackage.get(connection.key) : undefined}
            status={connection.status}
            badgeCount={connection.unread}
            onPress={() => router.push('/connections' as never)}
          />
        ))}
        {rail.overflowCount > 0 ? <RailItem label={`更多连接 ${rail.overflowCount}`} symbol="•••" onPress={() => router.push('/connections' as never)} /> : null}
        <CollapsedAppFolder count={rail.collapsedAppCount} iconUris={rail.collapsedAppIconUris} onPress={() => router.push('/connections/add?picker=all' as never)} />
        <RailItem label="添加连接" symbol="＋" tone="action" onPress={() => router.push('/connections/add' as never)} />
      </ScrollView>

      <View style={styles.fixedBottom}>
        <RailItem label={profile.data?.displayName || '我的'} symbol={accountSymbol(profile.data?.displayName)} tone="account" onPress={() => router.push('/me' as never)} />
      </View>
    </View>
  );
}

function connectionSymbol(label: string): string {
  const first = Array.from(label.trim())[0];
  return first && !/[\s\W_]/u.test(first) ? first.toUpperCase() : '连';
}

function accountSymbol(displayName?: string) {
  return Array.from(displayName?.trim() || '我')[0] ?? '我';
}

export const shellLayout = { railWidth: RAIL_WIDTH } as const;

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 4, width: RAIL_WIDTH - 7, zIndex: 10, paddingHorizontal: 4, paddingVertical: 6, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 22, shadowColor: '#101828', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  fixedTop: { alignItems: 'center', gap: 2 },
  divider: { width: 36, height: 1, backgroundColor: '#EAECF0', marginVertical: 3 },
  scroller: { flex: 1 },
  connections: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  fixedBottom: { alignItems: 'center', paddingTop: 3, borderTopWidth: 1, borderTopColor: '#EAECF0' },
});
