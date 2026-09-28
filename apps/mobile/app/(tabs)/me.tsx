import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { listCreationDrafts } from '../../src/creation-draft-api';
import { activeCreationDraftCount } from '../../src/creation-draft-presenter';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface Connection { id: string; status: string }
interface Plan { id: string; status: string }
interface Profile { displayName: string; status: string }
interface Execution { id: string; createdAt: string }

export default function Me() {
  const token = useAuthStore((store) => store.token);
  const clearSession = useAuthStore((store) => store.clear);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token) });
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const plans = useQuery({ queryKey: ['plans', token], queryFn: () => api<Plan[]>('/plans', token), enabled: Boolean(token) });
  const drafts = useQuery({ queryKey: ['creation-drafts', token], queryFn: () => listCreationDrafts(token!), enabled: Boolean(token) });
  const executions = useQuery({ queryKey: ['executions', token], queryFn: () => api<Execution[]>('/executions', token), enabled: Boolean(token) });
  const name = profile.data?.displayName ?? (token ? '我的账号' : '还没有登录');
  const activeConnections = (connections.data ?? []).filter((item) => item.status !== 'revoked').length;
  const activePlans = (plans.data ?? []).filter((item) => ['active', 'ready', 'degraded', 'blocked'].includes(item.status)).length;
  const activeDrafts = activeCreationDraftCount(drafts.data ?? []);
  const recentRecords = (executions.data ?? []).filter((item) => Date.now() - new Date(item.createdAt).getTime() <= 30 * 86_400_000).length;
  const loading = [profile, connections, plans, drafts, executions].some((query) => query.isLoading);

  function confirmLogout() { Alert.alert('退出当前账号？', '这只会清除本机登录状态，不会删除计划、事实或记录。', [{ text: '取消', style: 'cancel' }, { text: '退出登录', style: 'destructive', onPress: async () => { await clearSession(); router.replace('/auth/login' as Href); } }]); }

  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>我的</Text>
    <View style={styles.profileTop}><View style={styles.avatar}><Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName}>{name}</Text><Text style={styles.profileMeta}>{token ? '从从容容，游刃有余' : '登录后开始使用'}</Text><Text style={styles.profileSummary}>{token ? `${profile.data?.status || '账号状态正常'} · 已连接 ${activeConnections} 项资源` : '尚未连接服务'}</Text></View>{loading ? <ActivityIndicator color={colors.primary} /> : <Pressable accessibilityRole="button" onPress={() => router.push('/profile' as never)} style={styles.profileState}><Text style={styles.profileStateText}>编辑资料</Text><Ionicons name="chevron-forward" size={16} color={colors.primary} /></Pressable>}</View>
    <View style={styles.metrics}><Metric value={activePlans} icon="play-circle-outline" label="运行中" /><Metric value={activeDrafts} icon="document-text-outline" label="草稿" /><Metric value={activeConnections} icon="folder-outline" label="资源" /><Metric value={recentRecords} icon="stats-chart-outline" label="记录" last /></View>

    <Section title="常用"><MenuRow icon="paper-plane-outline" tone="green" title="我的发布" detail="我发布的内容、动态和分享" onPress={() => router.push('/services?section=publish' as never)} /><MenuRow icon="star" tone="orange" title="关注与收藏" detail="我关注的内容与收藏的资源" onPress={() => router.push('/services?section=following' as never)} /><MenuRow icon="notifications-outline" tone="green" title="消息与通知" detail="系统通知、互动消息等" onPress={() => router.push('/messages' as never)} /><MenuRow icon="time-outline" tone="green" title="最近使用" detail="我最近查看和使用的内容" onPress={() => router.push('/records' as never)} last /></Section>
    <Section title="个人与偏好"><MenuRow icon="person-outline" tone="green" title="账号与验证" detail="登录方式、密码、可信设备与账号安全" onPress={() => router.push('/security-center' as never)} /><MenuRow icon="settings" tone="green" title="偏好设置" detail="内容偏好、个性化推荐等" onPress={() => router.push('/profile' as never)} /><MenuRow icon="moon-outline" tone="green" title="显示与提醒" detail="外观模式、通知与提醒设置" onPress={() => router.push('/notification-settings' as never)} /><MenuRow icon="hardware-chip-outline" tone="green" title="AI 助手习惯" detail="设置你的提问风格与助手偏好" onPress={() => router.push('/search-ai' as never)} last /></Section>
    <Section title="支持"><MenuRow icon="help-circle-outline" tone="green" title="帮助与反馈" detail="常见问题、意见反馈与使用帮助" status="待开放" /><MenuRow icon="information-circle-outline" tone="green" title="关于懒人装甲" detail="版本信息、产品介绍与协议政策" status="开发版" last /></Section>
    {token ? <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}><Ionicons name="log-out-outline" size={18} color={colors.textSecondary} /><Text style={styles.logoutText}>退出登录</Text></Pressable> : null}
  </ScrollView></SafeAreaView>;
}

function Metric({ value, icon, label, last = false }: { value: number; icon: IconName; label: string; last?: boolean }) { return <View style={[styles.metric, !last && styles.metricDivider]}><View style={styles.metricValueRow}><View style={styles.metricIcon}><Ionicons name={icon} size={17} color={colors.primary} /></View><View><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View></View></View>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.menu}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionDivider} />{children}</View>; }
function MenuRow({ icon, tone, title, detail, status, onPress, last = false }: { icon: IconName; tone: 'green' | 'orange' | 'blue' | 'purple'; title: string; detail: string; status?: string; onPress?: () => void; last?: boolean }) { return <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}><View style={[styles.rowIcon, styles[`icon_${tone}`]]}><Ionicons name={icon} size={21} color={tone === 'orange' ? '#C97917' : tone === 'blue' ? '#3474C8' : tone === 'purple' ? '#7754B8' : colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text></View>{status ? <Text style={styles.rowStatus}>{status}</Text> : null}{onPress ? <Ionicons name="chevron-forward" size={17} color={colors.textMuted} /> : null}</Pressable>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 92 }, pressed: { opacity: 0.68 }, title: { ...typography.pageTitle, color: colors.text, marginBottom: spacing.sm }, profileTop: { minHeight: 118, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.md }, avatar: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: '#F3C6A1' }, avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '700' }, profileCopy: { flex: 1, minWidth: 0 }, profileName: { ...typography.title, color: colors.text, fontSize: 20 }, profileMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 }, profileSummary: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 3 }, profileState: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.successSoft }, profileStateText: { fontSize: 12, color: colors.primary }, metrics: { minHeight: 78, flexDirection: 'row', marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, metric: { flex: 1, alignItems: 'center', justifyContent: 'center' }, metricDivider: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }, metricValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, metricIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: colors.successSoft }, metricValue: { fontSize: 18, fontWeight: '700', color: colors.text }, metricLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  sectionTitle: { ...typography.section, color: colors.text, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm }, sectionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.md, backgroundColor: colors.border }, menu: { overflow: 'hidden', marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8 }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 }, icon_green: { backgroundColor: colors.successSoft }, icon_orange: { backgroundColor: '#FFF2DE' }, icon_blue: { backgroundColor: '#EAF2FD' }, icon_purple: { backgroundColor: '#F0EBFA' }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { ...typography.bodyStrong, color: colors.text }, rowDetail: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 1 }, rowStatus: { fontSize: 11, color: colors.textSecondary }, logout: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: spacing.md, borderRadius: radius.pill, backgroundColor: '#EFEEEA' }, logoutText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
});
