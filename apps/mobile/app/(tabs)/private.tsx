import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, spacing, typography } from '../../src/design';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface ResourceEntry { icon: IconName; title: string; detail: string; route: string; status: string }

export default function ResourcesPage() {
  const token = useAuthStore((store) => store.token);
  const connections = useQuery({ queryKey: ['resource-connections', token], queryFn: () => api<unknown[]>('/connections', token), enabled: Boolean(token) });
  const devices = useQuery({ queryKey: ['resource-devices', token], queryFn: () => api<unknown[]>('/device-profiles', token), enabled: Boolean(token) });
  const refreshing = connections.isFetching || devices.isFetching;
  const items: readonly ResourceEntry[] = [
    { icon: 'apps-outline', title: '连接资源', detail: '应用、平台与外部信息源', route: '/connections', status: connections.isError ? '待核实' : `${connections.data?.length ?? 0} 项` },
    { icon: 'library-outline', title: '数据与知识', detail: '数据、文件、知识库与私密空间', route: '/privacy-center/data', status: '管理' },
    { icon: 'desktop-outline', title: '设备与环境', detail: '手机、电脑与执行环境', route: '/devices', status: devices.isError ? '待核实' : `${devices.data?.length ?? 0} 台` },
    { icon: 'flash-outline', title: '执行与扩展', detail: '可用能力、依赖与扩展接口', route: '/feature-placeholder?feature=execution-capabilities', status: '查看' },
    { icon: 'shield-checkmark-outline', title: '安全与密钥', detail: '资源授权、访问范围与密钥', route: '/permissions', status: '管理' },
  ];
  const refresh = () => { void connections.refetch(); void devices.refetch(); };

  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={refreshing} onRefresh={refresh} /> : undefined}>
    <Text style={styles.intro}>连接你的应用、设备与数据，让计划具备真实的执行条件。</Text>
    <View style={styles.filters}><Text style={[styles.filter, styles.filterSelected]}>全部</Text><Text style={styles.filter}>应用服务</Text><Text style={styles.filter}>设备环境</Text><Text style={styles.filter}>数据知识</Text></View>
    <View style={styles.list}>{items.map((item, index) => <Pressable key={item.title} accessibilityRole="button" onPress={() => router.push(item.route as never)} style={({ pressed }) => [styles.row, index < items.length - 1 && styles.rowDivider, pressed && styles.pressed]}>
      <View style={styles.icon}><Ionicons name={item.icon} size={21} color={colors.text} /></View><View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text numberOfLines={1} style={styles.detail}>{item.detail}</Text></View><Text style={styles.status}>{item.status}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </Pressable>)}</View>
    <Text style={styles.boundary}>已连接、已授权与当前可执行是不同状态。创建和运行计划时，系统仍会按目标重新校验资源。</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl }, intro: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  filters: { minHeight: 38, flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: 10, backgroundColor: colors.accentSoft, marginBottom: spacing.md }, filter: { flex: 1, textAlign: 'center', paddingVertical: 7, borderRadius: 8, fontSize: 11, color: colors.textSecondary, overflow: 'hidden' }, filterSelected: { color: colors.text, fontWeight: '700', backgroundColor: colors.surface },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, copy: { flex: 1, minWidth: 0 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 1 }, status: { fontSize: 10, lineHeight: 15, color: colors.textSecondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.accentSoft, overflow: 'hidden' }, boundary: { ...typography.caption, color: colors.textMuted, lineHeight: 19, marginTop: spacing.lg }, pressed: { opacity: 0.58 },
});
