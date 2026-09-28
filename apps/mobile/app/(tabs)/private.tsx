import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Tone = 'green' | 'blue' | 'orange' | 'purple' | 'red';
interface ResourceItem { icon: IconName; title: string; detail: string; route: string; tone: Tone; status?: string }

const DATA_ITEMS: readonly ResourceItem[] = [
  { icon: 'receipt-outline', title: '账单数据', detail: '查看已连接来源与同步状态', route: '/privacy-center/data', tone: 'green' },
  { icon: 'calendar-outline', title: '日历数据', detail: '日程与提醒的真实来源', route: '/connections', tone: 'blue' },
  { icon: 'heart-outline', title: '健康数据', detail: '仅在明确授权后读取', route: '/privacy-center/data', tone: 'red' },
  { icon: 'folder-outline', title: '文件与图片', detail: '用于保存、导入与归档', route: '/privacy-center/data', tone: 'orange' },
  { icon: 'library-outline', title: '知识库', detail: '规则与参考资料', route: '/privacy-center/data', tone: 'purple' },
  { icon: 'lock-closed-outline', title: '私密空间', detail: '敏感资料独立保护，当前为受限入口', route: '/private-space', tone: 'purple', status: '受限' },
];
const EXECUTION_ITEMS: readonly ResourceItem[] = [
  { icon: 'notifications-outline', title: '通知提醒', detail: '按系统权限显示可用状态', route: '/notification-settings', tone: 'orange' },
  { icon: 'cloud-outline', title: '保存与同步', detail: '按连接和授权范围执行', route: '/connections', tone: 'blue' },
  { icon: 'paper-plane-outline', title: '发布与分发', detail: '外部平台接入后才可执行', route: '/connections', tone: 'green' },
  { icon: 'settings-outline', title: '自动化操作', detail: '重要操作仍需审批', route: '/automation-safety', tone: 'orange' },
];
const SECURITY_ITEMS: readonly ResourceItem[] = [
  { icon: 'shield-checkmark-outline', title: '账号安全', detail: '验证、密码与可信设备', route: '/security-center', tone: 'green' },
  { icon: 'lock-closed-outline', title: '数据权限', detail: '按资源分别控制读取范围', route: '/permissions', tone: 'purple' },
  { icon: 'person-outline', title: '授权管理', detail: '查看来源授权与待处理事项', route: '/permissions', tone: 'orange' },
  { icon: 'document-text-outline', title: '操作记录', detail: '最近访问与重要变更', route: '/security-activity', tone: 'blue' },
];

export default function ResourcesPage() {
  const token = useAuthStore((store) => store.token);
  const connections = useQuery({ queryKey: ['resource-connections', token], queryFn: () => api<unknown[]>('/connections', token), enabled: Boolean(token) });
  const devices = useQuery({ queryKey: ['resource-devices', token], queryFn: () => api<unknown[]>('/device-profiles', token), enabled: Boolean(token) });
  const plans = useQuery({ queryKey: ['resource-plans', token], queryFn: () => api<unknown[]>('/plans', token), enabled: Boolean(token) });
  const refreshing = connections.isFetching || devices.isFetching || plans.isFetching;
  const known = Boolean(token) && !connections.isError && !devices.isError && !plans.isError;
  const refresh = () => { void connections.refetch(); void devices.refetch(); void plans.refetch(); };
  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={refreshing} onRefresh={refresh} /> : undefined}>
    <Text style={styles.title}>资源</Text><Text style={styles.subtitle}>管理计划可调用的数据、设备与能力</Text>
    <View style={styles.overview}>
      <Metric icon="link-outline" value={known ? String(connections.data?.length ?? 0) : '—'} label="已连接应用" route="/connections" />
      <Metric icon="layers-outline" value={known ? String(DATA_ITEMS.length) : '—'} label="数据与知识" route="/privacy-center/data" />
      <Metric icon="phone-portrait-outline" value={known ? String(devices.data?.length ?? 0) : '—'} label="设备" route="/devices" />
      <Metric icon="flash-outline" value={String(EXECUTION_ITEMS.length)} label="能力目录" route="/connections" />
      <Metric icon="alert-circle-outline" value={known ? '查看' : '待核实'} label="授权状态" route="/permissions" tone="orange" />
      <Metric icon="warning-outline" value={known ? String(plans.data?.length ?? 0) : '—'} label="使用中计划" route="/plans" tone="red" />
      <Pressable onPress={() => router.push('/permissions' as never)} style={styles.notice}><Ionicons name="megaphone-outline" size={18} color={colors.primary} /><Text style={styles.noticeText}>{known ? '资源状态来自现有连接与计划；可用性仍以执行前校验为准' : '部分资源状态未能核实，请检查连接与授权'}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>
    </View>
    <ResourceSection icon="apps-outline" title="连接应用" count={connections.isError ? '状态未知' : `${connections.data?.length ?? 0} 个连接`} route="/connections" items={[
      { icon: 'apps-outline', title: '应用连接', detail: '通知、订单、内容等授权来源', route: '/connections', tone: 'green', status: connections.isError ? '待核实' : '查看' },
      { icon: 'key-outline', title: '连接授权', detail: '核对每个连接可读写的范围', route: '/permissions', tone: 'orange', status: '管理' },
    ]} />
    <ResourceSection icon="server-outline" title="数据与知识" count={`${DATA_ITEMS.length} 类`} route="/privacy-center/data" items={DATA_ITEMS} />
    <ResourceSection icon="phone-portrait-outline" title="设备资源" count={devices.isError ? '状态未知' : `${devices.data?.length ?? 0} 台设备`} route="/devices" items={[
      { icon: 'phone-portrait-outline', title: '当前手机', detail: '系统权限与在线状态需实时校验', route: '/devices', tone: 'green', status: '查看' },
      { icon: 'desktop-outline', title: '已登记设备', detail: '电脑、车辆与穿戴设备', route: '/devices', tone: 'blue', status: devices.isError ? '待核实' : '管理' },
    ]} />
    <ResourceSection icon="flash-outline" title="执行能力" count={`${EXECUTION_ITEMS.length} 类`} route="/connections" items={EXECUTION_ITEMS} />
    <ResourceSection icon="shield-checkmark-outline" title="安全与权限" count="统一管理" route="/security-center" items={SECURITY_ITEMS} />
    <Text style={styles.boundary}>资源目录只说明计划可能需要什么；已连接、已授权和可执行是三个不同状态，系统会在创建与执行时再次校验。</Text>
  </ScrollView></SafeAreaView>;
}

function Metric({ icon, value, label, route, tone = 'green' }: { icon: IconName; value: string; label: string; route: string; tone?: Tone }) { return <Pressable onPress={() => router.push(route as never)} style={({ pressed }) => [styles.metric, pressed && styles.pressed]}><View style={[styles.metricIcon, styles[`tone_${tone}`]]}><Ionicons name={icon} size={21} color={tone === 'orange' ? '#C97917' : tone === 'red' ? '#C54646' : colors.primary} /></View><View style={styles.metricCopy}><Text numberOfLines={1} style={styles.metricValue}>{value}</Text><Text numberOfLines={1} style={styles.metricLabel}>{label}</Text></View><Ionicons name="chevron-forward" size={15} color={colors.textMuted} /></Pressable>; }
function ResourceSection({ icon, title, count, route, items }: { icon: IconName; title: string; count: string; route: string; items: readonly ResourceItem[] }) { return <View style={styles.section}><Pressable onPress={() => router.push(route as never)} style={styles.sectionHeader}><Ionicons name={icon} size={19} color={colors.primary} /><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCount}>{count}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable><View style={styles.grid}>{items.map((item) => <Pressable key={item.title} onPress={() => router.push(item.route as never)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={[styles.rowIcon, styles[`tone_${item.tone}`]]}><Ionicons name={item.icon} size={20} color={item.tone === 'blue' ? '#3474C8' : item.tone === 'orange' ? '#C97917' : item.tone === 'purple' ? '#7754B8' : item.tone === 'red' ? '#C54646' : colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.title}</Text><Text numberOfLines={1} style={styles.rowDetail}>{item.detail}</Text></View>{item.status ? <Text style={styles.status}>{item.status}</Text> : null}<Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</View></View>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 110 }, pressed: { opacity: 0.65 }, title: { ...typography.pageTitle, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md }, overview: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, metric: { width: '48.5%', minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: '#FAFAF8', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, metricIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, metricCopy: { flex: 1, minWidth: 0 }, metricValue: { ...typography.bodyStrong, color: colors.text }, metricLabel: { fontSize: 12, lineHeight: 17, color: colors.textSecondary }, notice: { width: '100%', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft }, noticeText: { ...typography.caption, color: colors.textSecondary, flex: 1 }, section: { marginTop: spacing.md, overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, sectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sectionTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, sectionCount: { ...typography.caption, color: colors.textSecondary }, grid: { flexDirection: 'row', flexWrap: 'wrap' }, row: { width: '100%', minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, rowIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14, lineHeight: 20 }, rowDetail: { fontSize: 12, lineHeight: 17, color: colors.textSecondary }, status: { fontSize: 11, lineHeight: 16, color: colors.primary, backgroundColor: colors.successSoft, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' }, tone_green: { backgroundColor: colors.accentSoft }, tone_blue: { backgroundColor: '#EAF2FD' }, tone_orange: { backgroundColor: '#FFF2DE' }, tone_purple: { backgroundColor: '#F0EBFA' }, tone_red: { backgroundColor: '#FDEBEC' }, boundary: { ...typography.caption, color: colors.textSecondary, lineHeight: 20, marginTop: spacing.lg, paddingHorizontal: spacing.sm },
});
