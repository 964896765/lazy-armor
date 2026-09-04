import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { colors, radius, spacing, typography } from './design';

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

interface RailTrustedDevice { id: string; status: 'active' | 'revoked'; }
interface RailPendingNotification { id: string; }

interface RailConnectionSpace {
  id: string;
  key: string;
  label: string;
  status: string;
}

const RAIL_WIDTH = 72;
const tabItems: Readonly<Record<string, { label: string; symbol: string; tone?: 'brand' | 'commerce' }>> = Object.freeze({
  index: { label: '消息', symbol: '◉' },
  plans: { label: '懒人装甲', symbol: '◆', tone: 'brand' },
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
  const activeTrustedDeviceIds = new Set((trustedDevices.data ?? []).filter((device) => device.status === 'active').map((device) => device.id));
  const visibleConnections: RailConnectionSpace[] = [
    ...(connections.data ?? []).filter((connection) => connection.status !== 'revoked').map((connection) => ({ id: connection.id, key: connection.connectorId, label: connection.connectorName, status: connection.status })),
    ...(deviceApps.data ?? []).filter((connection) => connection.enabled).map((connection) => ({ id: connection.id, key: connection.packageName, label: connection.displayName, status: connection.trustedDeviceId && activeTrustedDeviceIds.has(connection.trustedDeviceId) ? 'connected' : 'needs_reauth' })),
  ].slice(0, 7);

  function selectTab(routeName: string) {
    const route = state.routes.find((candidate) => candidate.name === routeName);
    if (!route) return;
    const isFocused = state.routes[state.index]?.key === route.key;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) navigation.navigate(routeName as never);
  }

  return (
    <View style={[styles.rail, { paddingTop: Math.max(insets.top, spacing.sm), paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View style={styles.topArea}>
        {state.routes.filter((route) => tabItems[route.name]).map((route) => {
          const item = tabItems[route.name]!;
          return <RailItem key={route.key} label={item.label} symbol={item.symbol} badgeCount={route.name === 'index' ? (pendingNotifications.data?.length ?? 0) : 0} selected={state.routes[state.index]?.key === route.key} tone={item.tone} onPress={() => selectTab(route.name)} />;
        })}
        <RailItem label="懒人商城" symbol="□" tone="commerce" onPress={() => router.push('/commerce' as never)} />
        <View style={styles.divider} />
        {visibleConnections.map((connection) => (
          <RailItem
            key={connection.id}
            label={connection.label}
            symbol={connectionSymbol(connection.label)}
            status={connection.status}
            onPress={() => router.push('/connections' as never)}
          />
        ))}
        {visibleConnections.length === 7 ? <Text style={styles.more}>更多</Text> : null}
        <RailItem label="添加连接" symbol="＋" action onPress={() => router.push('/connections/add' as never)} />
      </View>
      <RailItem label="我的" symbol="○" account onPress={() => router.push('/me' as never)} />
    </View>
  );
}

function RailItem({ label, symbol, selected = false, tone, status, badgeCount = 0, action = false, account = false, onPress }: {
  label: string;
  symbol: string;
  selected?: boolean;
  tone?: 'brand' | 'commerce';
  status?: string;
  badgeCount?: number;
  action?: boolean;
  account?: boolean;
  onPress: () => void;
}) {
  const offline = status === 'error' || status === 'revoked';
  const expiring = status === 'expired' || status === 'needs_reauth';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.item, selected && styles.itemSelected, pressed && styles.itemPressed]}>
      {selected ? <View style={styles.selectionMark} /> : null}
      <View style={[styles.icon, tone === 'brand' && styles.brandIcon, tone === 'commerce' && styles.commerceIcon, action && styles.addIcon, account && styles.accountIcon, offline && styles.iconOffline]}>
        <Text style={[styles.symbol, tone === 'brand' && styles.brandSymbol, action && styles.addSymbol]}>{symbol}</Text>
        {status ? <View style={[styles.statusDot, offline ? styles.statusOffline : expiring ? styles.statusWarning : styles.statusHealthy]}><Text style={styles.statusText}>{expiring ? '!' : ''}</Text></View> : null}
        {badgeCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text></View> : null}
      </View>
      <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected, offline && styles.labelOffline]}>{label}</Text>
    </Pressable>
  );
}

function connectionSymbol(label: string): string {
  const first = Array.from(label.trim())[0];
  return first && !/[\s\W_]/u.test(first) ? first.toUpperCase() : '连';
}

export const shellLayout = { railWidth: RAIL_WIDTH } as const;

const styles = StyleSheet.create({
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_WIDTH, zIndex: 10, backgroundColor: '#1D2B26', alignItems: 'center', justifyContent: 'space-between', borderRightWidth: 1, borderRightColor: '#304139' },
  topArea: { width: '100%', alignItems: 'center', gap: 7 },
  item: { width: '100%', minHeight: 57, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, position: 'relative' },
  itemSelected: { backgroundColor: '#2C3D35' },
  itemPressed: { opacity: 0.78 },
  selectionMark: { position: 'absolute', left: 0, width: 4, height: 28, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.accent },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: '#405249', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  brandIcon: { backgroundColor: colors.accent },
  commerceIcon: { backgroundColor: '#436578' },
  addIcon: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#84928A', borderStyle: 'dashed' },
  accountIcon: { borderRadius: 19, backgroundColor: '#6B786F' },
  iconOffline: { opacity: 0.5 },
  symbol: { color: '#F7F5EF', fontSize: 15, fontWeight: '800' },
  brandSymbol: { color: colors.primary },
  addSymbol: { fontSize: 24, lineHeight: 26, fontWeight: '300' },
  label: { ...typography.caption, width: 64, color: '#C9D0CA', fontSize: 9, lineHeight: 12, textAlign: 'center', marginTop: 2 },
  labelSelected: { color: '#FFFFFF', fontWeight: '700' },
  labelOffline: { color: '#89958E' },
  statusDot: { position: 'absolute', right: -2, bottom: -2, minWidth: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#1D2B26', alignItems: 'center', justifyContent: 'center' },
  statusHealthy: { backgroundColor: '#4FAE78' },
  statusWarning: { backgroundColor: colors.warning },
  statusOffline: { backgroundColor: '#8A948F' },
  statusText: { color: '#FFFFFF', fontSize: 7, fontWeight: '800', lineHeight: 7 },
  badge: { position: 'absolute', left: -5, top: -5, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.danger, borderWidth: 1, borderColor: '#1D2B26', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '800', lineHeight: 10 },
  divider: { width: 34, height: 1, backgroundColor: '#526359', marginVertical: 1 },
  more: { ...typography.caption, color: '#AAB4AE', fontSize: 9, marginTop: -3 },
});
