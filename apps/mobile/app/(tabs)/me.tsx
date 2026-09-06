import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

interface Connection { id: string }
interface DeviceProfile { id: string }
interface VehicleProfile { id: string }
interface UnreadCount { count: number }
interface Profile { displayName: string; status: string }

export default function Me() {
  const token = useAuthStore((store) => store.token);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token) });
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const devices = useQuery({ queryKey: ['device-profiles', token], queryFn: () => api<DeviceProfile[]>('/device-profiles', token), enabled: Boolean(token) });
  const vehicles = useQuery({ queryKey: ['vehicle-profiles', token], queryFn: () => api<VehicleProfile[]>('/vehicle-profiles', token), enabled: Boolean(token) });
  const unread = useQuery({ queryKey: ['notifications-unread', token], queryFn: () => api<UnreadCount>('/notifications/unread-count', token), enabled: Boolean(token) });
  const loading = profile.isLoading || connections.isLoading || devices.isLoading || vehicles.isLoading || unread.isLoading;
  const name = profile.data?.displayName ?? (token ? '我的账号' : '还没有登录');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <WorkspaceHeader title="我的" subtitle="账号、连接与隐私设置" />
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{token ? name.slice(0, 1) : '你'}</Text></View>
          <View style={styles.profileCopy}><Text style={styles.profileName}>{name}</Text><Text style={styles.profileMeta}>{token ? '懒人装甲正在为你服务' : '登录后开始管理生活'}</Text></View>
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
        </View>

        <Text style={styles.sectionLabel}>我的生活</Text>
        <View style={styles.menu}>
          <MenuRow icon="🔗" title="我的连接" detail={token ? `已连接 ${connections.data?.length ?? 0} 个服务` : '登录与连接服务'} onPress={() => router.push('/connections')} />
          <Divider />
          <MenuRow icon="⌁" title="我的设备" detail={`已记录 ${devices.data?.length ?? 0} 台`} onPress={() => router.push('/devices' as Href)} />
          <Divider />
          <MenuRow icon="🚙" title="我的车辆" detail={`已记录 ${vehicles.data?.length ?? 0} 台`} onPress={() => router.push('/vehicles' as Href)} />
        </View>

        <Text style={styles.sectionLabel}>提醒与控制</Text>
        <View style={styles.menu}>
          <MenuRow icon="◉" title="通知" detail={(unread.data?.count ?? 0) > 0 ? `${unread.data?.count} 条未读` : '按你的偏好提醒'} onPress={() => router.push('/notification-settings' as Href)} />
          <Divider />
          <MenuRow icon="✓" title="权限" detail="管理信息使用范围" onPress={() => router.push('/permissions' as Href)} />
          <Divider />
          <MenuRow icon="🛡️" title="安全" detail="确认与保护方式" onPress={() => router.push('/automation-safety' as Href)} />
          <Divider />
          <MenuRow icon="▤" title="安全记录" detail="查看重要操作" onPress={() => router.push('/security-activity' as Href)} />
        </View>

        <Text style={styles.sectionLabel}>数据</Text>
        <View style={styles.menu}>
          <MenuRow icon="▣" title="数据管理" detail="查看与管理你的数据" onPress={() => router.push('/data-management' as Href)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({ icon, title, detail, onPress }: { icon: string; title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowIcon}><Text style={styles.rowEmoji}>{icon}</Text></View>
      <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 80 },
  profile: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.surface, fontSize: 19, fontWeight: '700' },
  profileCopy: { flex: 1 },
  profileName: { ...typography.cardTitle, color: colors.text },
  profileMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  sectionLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs, paddingLeft: spacing.xs },
  menu: { padding: 0 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pressed: { backgroundColor: '#F7F8FA' },
  rowIcon: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  rowEmoji: { color: colors.primary, fontSize: 16 },
  rowCopy: { flex: 1, marginLeft: spacing.md },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: 26, fontWeight: '300' },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
});
