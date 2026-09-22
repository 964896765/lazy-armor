import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { RailItem, colors, radius, spacing, typography } from './design';
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
const RAIL_WIDTH = 64;

export function ConnectionRail({ state, navigation }: BottomTabBarProps) {
  const [accountOpen, setAccountOpen] = useState(false);
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
      <RailItem label="懒人装甲" symbol="LA" tone="brand" selected={activeRoute === 'scenarios'} showLabel onPress={() => selectTab('scenarios')} />
      <View style={styles.divider} />

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
            onPress={() => connection.kind === 'app' ? router.push(`/apps/${connection.id}` as never) : router.push(`/connections/${connection.id}` as never)}
          />
        ))}
        {rail.overflowCount > 0 ? <RailItem label={`更多 ${rail.overflowCount}`} icon="ellipsis-horizontal" showLabel={false} onPress={() => selectTab('connections')} /> : null}
        <RailItem label="添加来源" icon="add" tone="action" showLabel={false} onPress={() => router.push('/connections/add' as never)} />
      </ScrollView>

      <View style={styles.divider} />
      <RailItem label="我的" icon="person-outline" tone="account" selected={accountOpen} showLabel onPress={() => setAccountOpen(true)} />
      <AccountMenu visible={accountOpen} onClose={() => setAccountOpen(false)} selectTab={selectTab} />
    </View>
  );
}

function AccountMenu({ visible, onClose, selectTab }: { visible: boolean; onClose: () => void; selectTab: (name: string) => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  function go(action: () => void) {
    onClose();
    action();
  }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="关闭账号菜单" onPress={onClose} style={styles.scrim} />
      <View style={[styles.drawer, { paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.heading}>
          <Text style={styles.title}>我的</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={styles.close}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <MenuItem icon="person-outline" label="我的账号" onPress={() => go(() => selectTab('me'))} />
          <MenuItem icon="list-outline" label="计划" onPress={() => go(() => selectTab('plans'))} />
          <MenuItem icon="link-outline" label="连接中心" onPress={() => go(() => selectTab('connections'))} />
          <MenuItem icon="time-outline" label="记录" onPress={() => go(() => selectTab('records'))} />
          <MenuItem icon="shield-checkmark-outline" label="安全中心" onPress={() => go(() => router.push('/security-center' as never))} />
          <MenuItem icon="lock-closed-outline" label="隐私中心" onPress={() => go(() => router.push('/privacy-center' as never))} />
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

function MenuItem({ icon, label, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.menuItem}><Ionicons name={icon} size={19} color={colors.primary} /><Text style={styles.menuItemText}>{label}</Text></Pressable>;
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
  frame: { position: 'absolute', left: 0, width: RAIL_WIDTH, zIndex: 10, paddingHorizontal: 5, paddingVertical: 6, backgroundColor: '#FFF9F2', borderRightWidth: 1, borderRightColor: '#F2E8DB' },
  divider: { width: 36, height: 1, backgroundColor: '#EAECF0', marginVertical: 3 },
  scroller: { flex: 1 },
  connections: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  overlay: { flex: 1, flexDirection: 'row' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(22, 33, 58, 0.44)' },
  drawer: { width: '82%', maxWidth: 360, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.lg },
  title: { ...typography.title, color: colors.text },
  close: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  menuItem: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm },
  menuItemText: { ...typography.bodyStrong, color: colors.text },
});
