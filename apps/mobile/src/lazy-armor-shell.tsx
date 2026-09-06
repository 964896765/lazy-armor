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
interface RailProfile { displayName: string; status: string }
const RAIL_WIDTH = 66;
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
    <>
    <View style={[styles.frame, { top: Math.max(insets.top, 5), bottom: Math.max(insets.bottom, 5) }]}>
      <View style={styles.fixedTop}>
        <RailItem label="懒人装甲" symbol="" imageSource={require('../assets/icon.png')} imageScale={1.45} selected={state.routes[state.index]?.name === 'plans'} onPress={() => selectTab('plans')} />
        <RailItem label="消息" symbol="▤" badgeCount={pendingNotifications.data?.length ?? 0} selected={state.routes[state.index]?.name === 'index'} tone="brand" onPress={() => selectTab('index')} />
        <RailItem label="领域" symbol="◎" onPress={() => router.push('/domains' as never)} />
        <RailItem label="安全" symbol="⌑" onPress={() => router.push('/permissions' as never)} />
        <RailItem label="懒人商城" symbol="店" tone="commerce" onPress={() => router.push('/commerce' as never)} />
        <View style={styles.divider} />
        <Text style={styles.railLabel}>我的连接</Text>
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
      <Pressable accessibilityRole="button" accessibilityLabel="打开我的" onPress={() => selectTab('me')} style={({ pressed }) => [styles.accountButton, pressed && styles.bottomPressed]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{accountSymbol(profile.data?.displayName)}</Text><View style={styles.onlineDot} /></View>
        <View style={styles.accountCopy}><Text numberOfLines={1} style={styles.accountName}>{profile.data?.displayName || '我的懒人装甲'}</Text><Text style={styles.accountStatus}>{token ? '在线' : '登录后开始使用'}</Text></View>
        <Text style={styles.accountChevron}>⌄</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="活动与记录" onPress={() => selectTab('records')} style={({ pressed }) => [styles.activityButton, pressed && styles.bottomPressed]}>
        <View style={styles.bell}><View style={styles.bellClapper} /></View>
        {(pendingNotifications.data?.length ?? 0) > 0 ? <View style={styles.activityDot} /> : null}
      </Pressable>
    </View>
    </>
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
  frame: { position: 'absolute', left: 0, width: RAIL_WIDTH, zIndex: 10, paddingHorizontal: 5, paddingVertical: 6, backgroundColor: '#F2F3F5', borderRightWidth: 1, borderRightColor: '#E3E5E8' },
  fixedTop: { alignItems: 'center', gap: 2 },
  divider: { width: 36, height: 1, backgroundColor: '#EAECF0', marginVertical: 3 },
  railLabel: { width: 54, color: '#80848E', fontSize: 7, lineHeight: 10, textAlign: 'center', fontWeight: '700', marginVertical: 2 },
  scroller: { flex: 1 },
  connections: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  bottomDock: { position: 'absolute', left: RAIL_WIDTH + 5, right: 6, zIndex: 20, minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5E8', borderRadius: 22, shadowColor: '#101828', shadowOpacity: 0.09, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 7 },
  bottomPressed: { opacity: 0.65 },
  accountButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5865F2' },
  avatarText: { color: '#FFFFFF', fontSize: 15, lineHeight: 18, fontWeight: '800' },
  onlineDot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: '#23A559', borderWidth: 2, borderColor: '#FFFFFF' },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { color: '#1E1F22', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  accountStatus: { color: '#23A559', fontSize: 9, lineHeight: 12, fontWeight: '600' },
  accountChevron: { color: '#667085', fontSize: 14 },
  activityButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  bell: { width: 17, height: 15, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, backgroundColor: '#475467', position: 'relative' },
  bellClapper: { position: 'absolute', left: 6, bottom: -4, width: 5, height: 4, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: '#475467' },
  activityDot: { position: 'absolute', right: 7, top: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#DA373C', borderWidth: 1, borderColor: '#FFFFFF' },
});
