import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
const RAIL_WIDTH = 66;
const tabItems: Readonly<Record<string, { label: string; symbol: string; tone?: 'brand' }>> = Object.freeze({
  index: { label: '消息', symbol: '▤', tone: 'brand' },
  plans: { label: '懒人装甲', symbol: '' },
});

const bottomItems = [
  { route: 'index', label: '消息', symbol: '⌂' },
  { route: 'plans', label: '计划', symbol: '☷' },
  { route: 'records', label: '记录', symbol: '▤' },
  { route: 'me', label: '我的', symbol: '○' },
] as const;

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
    <>
    <View style={[styles.frame, { top: Math.max(insets.top, 5), bottom: Math.max(insets.bottom, 5) }]}>
      <View style={styles.fixedTop}>
        {state.routes.filter((route) => tabItems[route.name]).map((route) => {
          const item = tabItems[route.name]!;
          return <RailItem key={route.key} label={item.label} symbol={item.symbol} imageSource={route.name === 'plans' ? require('../assets/icon.png') : undefined} imageScale={route.name === 'plans' ? 1.45 : 1} badgeCount={route.name === 'index' ? (pendingNotifications.data?.length ?? 0) : 0} selected={state.routes[state.index]?.key === route.key} tone={item.tone} onPress={() => selectTab(route.name)} />;
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
        {rail.overflowCount > 0 ? <RailItem label={`更多 ${rail.overflowCount}`} symbol="•••" onPress={() => router.push('/connections' as never)} /> : null}
        <RailItem label="添加连接" symbol="＋" tone="action" onPress={() => router.push('/connections/add' as never)} />
      </ScrollView>
    </View>
    <View style={[styles.bottomDock, { bottom: Math.max(insets.bottom, 5) }]}>
      {bottomItems.map((item) => {
        const route = state.routes.find((candidate) => candidate.name === item.route);
        const selected = route ? state.routes[state.index]?.key === route.key : false;
        return <Pressable key={item.route} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => selectTab(item.route)} style={({ pressed }) => [styles.bottomItem, pressed && styles.bottomPressed]}>
          <View style={[styles.bottomIcon, selected && styles.bottomSelected]}><Text style={[styles.bottomSymbol, selected && styles.bottomSelectedSymbol]}>{item.symbol}</Text></View>
          <Text style={[styles.bottomLabel, selected && styles.bottomSelectedLabel]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
    </>
  );
}

function connectionSymbol(label: string): string {
  const first = Array.from(label.trim())[0];
  return first && !/[\s\W_]/u.test(first) ? first.toUpperCase() : '连';
}

export const shellLayout = { railWidth: RAIL_WIDTH } as const;

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, width: RAIL_WIDTH, zIndex: 10, paddingHorizontal: 5, paddingVertical: 6, backgroundColor: '#F2F3F5', borderRightWidth: 1, borderRightColor: '#E3E5E8' },
  fixedTop: { alignItems: 'center', gap: 2 },
  divider: { width: 36, height: 1, backgroundColor: '#EAECF0', marginVertical: 3 },
  scroller: { flex: 1 },
  connections: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  bottomDock: { position: 'absolute', left: RAIL_WIDTH + 5, right: 6, zIndex: 20, minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 4, paddingVertical: 5, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 22, shadowColor: '#101828', shadowOpacity: 0.09, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 7 },
  bottomItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  bottomPressed: { opacity: 0.65 },
  bottomIcon: { width: 30, height: 27, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bottomSelected: { backgroundColor: '#EEF0FF' },
  bottomSymbol: { color: '#667085', fontSize: 17, lineHeight: 20, fontWeight: '700' },
  bottomSelectedSymbol: { color: '#5865F2' },
  bottomLabel: { color: '#667085', fontSize: 9, lineHeight: 11, fontWeight: '600' },
  bottomSelectedLabel: { color: '#5865F2', fontWeight: '800' },
});
