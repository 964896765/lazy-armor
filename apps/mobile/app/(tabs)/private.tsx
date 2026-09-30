import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface ResourceEntry { icon: IconName; title: string; detail: string; route: string; status?: string; iconColor: string; iconBackground: string }
interface ResourceConnection { id: string; connectorName: string; externalAccountName: string }
interface ResourceAppConnection { id: string; displayName: string }
interface ResourceFact { id: string; factKey: string; valueSummary?: string | null }

function countLabel(token: string | null | undefined, query: { data?: unknown[]; isLoading: boolean; isError: boolean }, unit: string): string {
  if (!token) return '登录后查看';
  if (query.isLoading) return '读取中';
  if (query.isError) return '待核实';
  return `${query.data?.length ?? 0} ${unit}`;
}

export default function ResourcesPage() {
  const token = useAuthStore((store) => store.token);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const connections = useQuery({ queryKey: ['resource-connections', token], queryFn: () => api<ResourceConnection[]>('/connections', token), enabled: Boolean(token) });
  const appConnections = useQuery({ queryKey: ['resource-app-connections', token], queryFn: () => api<ResourceAppConnection[]>('/device-app-connections', token), enabled: Boolean(token) });
  const devices = useQuery({ queryKey: ['resource-devices', token], queryFn: () => api<unknown[]>('/trusted-devices', token), enabled: Boolean(token) });
  const facts = useQuery({ queryKey: ['resource-facts', token], queryFn: () => api<ResourceFact[]>('/truth-records', token), enabled: Boolean(token) });
  const refreshing = connections.isFetching || appConnections.isFetching || devices.isFetching || facts.isFetching;
  const connectionStatus = !token ? '登录后查看' : connections.isLoading || appConnections.isLoading ? '读取中' : connections.isError || appConnections.isError ? '待核实' : `${(connections.data?.length ?? 0) + (appConnections.data?.length ?? 0)} 项连接`;
  const items: readonly ResourceEntry[] = [
    { icon: 'grid-outline', title: '应用与连接', detail: '应用、平台与外部信息源', route: '/connections', status: connectionStatus, iconColor: '#087BF4', iconBackground: '#E8F3FF' },
    { icon: 'folder-open-outline', title: '数据与文件', detail: '文件、账单、照片与知识', route: '/privacy-center/data', status: countLabel(token, facts, '条数据'), iconColor: '#F49B0B', iconBackground: '#FFF2DD' },
    { icon: 'desktop-outline', title: '设备', detail: '手机、电脑与执行环境', route: '/connections/trusted-devices', status: countLabel(token, devices, '台设备'), iconColor: '#1684FF', iconBackground: '#E9F3FF' },
    { icon: 'flash-outline', title: '能力与扩展', detail: '技能、MCP、API 与执行能力', route: '/capabilities', status: '查看', iconColor: '#187CF2', iconBackground: '#EAF4FF' },
    { icon: 'shield-checkmark-outline', title: '授权与密钥', detail: '权限、令牌与访问范围', route: '/permissions', status: '管理', iconColor: '#F49B0B', iconBackground: '#FFF2DD' },
  ];
  const visibleItems = items.filter((item) => `${item.title} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(search.trim().toLocaleLowerCase('zh-CN')));
  const needle = search.trim().toLocaleLowerCase('zh-CN');
  const matchedResources = needle ? [
    ...(connections.data ?? []).map((item) => ({ key: `connection:${item.id}`, title: item.connectorName, detail: item.externalAccountName, route: `/connections/${item.id}` })),
    ...(appConnections.data ?? []).map((item) => ({ key: `app:${item.id}`, title: item.displayName, detail: '已连接手机应用', route: '/connections' })),
    ...(facts.data ?? []).map((item) => ({ key: `fact:${item.id}`, title: item.valueSummary || item.factKey, detail: '已验证数据', route: `/truth/${item.id}` })),
  ].filter((item) => `${item.title} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(needle)) : [];

  function refresh() {
    void connections.refetch();
    void appConnections.refetch();
    void devices.refetch();
    void facts.refetch();
  }

  return (
    <SafeAreaView edges={[]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={refreshing} onRefresh={refresh} /> : undefined}>
        <View style={styles.header}>
          <View style={styles.headerCopy}><Text style={styles.pageTitle}>资源</Text><Text style={styles.intro}>连接你的应用、设备、数据与能力，让计划具备真实的执行条件。</Text></View>
          <View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="添加资源" onPress={() => router.push('/connections/add' as never)} style={({ pressed }) => [styles.headerAdd, pressed && styles.pressed]}><Ionicons name="add" size={25} color={colors.text} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="资源菜单" onPress={() => setMenuOpen(true)} style={({ pressed }) => [styles.headerAdd, pressed && styles.pressed]}><Ionicons name="menu-outline" size={23} color={colors.text} /></Pressable></View>
        </View>
        <View style={styles.searchBox}><Ionicons name="search-outline" size={19} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} placeholder="搜索应用、文件、设备或能力…" placeholderTextColor={colors.textMuted} style={styles.searchInput} />{search ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}</View>
        <View style={styles.resources}>
          {visibleItems.map((item) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`${item.title}，${item.status}`} onPress={() => router.push(item.route as never)} style={({ pressed }) => [styles.resourceCard, pressed && styles.pressed]}>
          <View style={[styles.icon, { backgroundColor: item.iconBackground }]}><Ionicons name={item.icon} size={23} color={item.iconColor} /></View>
            <View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View>
            <Text style={styles.status}>{item.status}</Text><Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>)}
          {matchedResources.length > 0 ? <Text style={styles.matchTitle}>匹配的资源</Text> : null}
          {matchedResources.map((item) => <Pressable key={item.key} accessibilityRole="button" onPress={() => router.push(item.route as never)} style={({ pressed }) => [styles.matchedRow, pressed && styles.pressed]}><View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></Pressable>)}
          {visibleItems.length === 0 && matchedResources.length === 0 ? <Text style={styles.noResults}>没有匹配的资源</Text> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/connections/add' as never)} style={({ pressed }) => [styles.helperCard, pressed && styles.pressed]}><View style={styles.helperIcon}><Ionicons name="sparkles-outline" size={25} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.title}>连接更多资源，让我帮你做更多事</Text><Text style={styles.detail}>添加应用、平台与设备</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></Pressable>
        <Text style={styles.boundary}>数量来自当前账号，授权与可执行状态会在使用时核对。</Text>
      </ScrollView>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}><Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}><Pressable style={styles.menuPanel} onPress={(event) => event.stopPropagation()}><SafeAreaView edges={['top', 'bottom']}><View style={styles.menuHeading}><Text style={styles.menuTitle}>资源菜单</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭资源菜单" onPress={() => setMenuOpen(false)}><Ionicons name="close" size={22} color={colors.text} /></Pressable></View>{items.map((item) => <Pressable key={item.title} accessibilityRole="button" onPress={() => { setMenuOpen(false); router.push(item.route as never); }} style={styles.menuRow}><Ionicons name={item.icon} size={20} color={colors.text} /><Text style={styles.menuRowText}>{item.title}</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</SafeAreaView></Pressable></Pressable></Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  header: { minHeight: 85, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  headerCopy: { flex: 1 }, pageTitle: { ...typography.pageTitle, color: colors.text },
  intro: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginTop: 3 },
  headerActions: { flexDirection: 'row', gap: spacing.xs },
  headerAdd: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  searchBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface },
  searchInput: { ...typography.body, flex: 1, color: colors.text, paddingVertical: 8 },
  quickActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  quickAction: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  quickLabel: { ...typography.caption, color: colors.text, fontWeight: '700' },
  resources: { gap: spacing.sm },
  noResults: { ...typography.body, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
  matchTitle: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.sm },
  matchedRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  resourceCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  copy: { flex: 1, minWidth: 0 }, title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  status: { ...typography.caption, color: colors.textSecondary },
  helperCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  helperIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.accentSoft },
  menuBackdrop: { flex: 1, alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.38)' },
  menuPanel: { width: '82%', maxWidth: 360, height: '100%', backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  menuHeading: { minHeight: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuTitle: { ...typography.title, color: colors.text },
  menuRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuRowText: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  boundary: { ...typography.caption, color: colors.textMuted, lineHeight: 19, marginTop: spacing.lg },
  pressed: { opacity: 0.62 },
});
