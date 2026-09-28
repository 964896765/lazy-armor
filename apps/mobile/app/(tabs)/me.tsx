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
    <View style={styles.profileCard}><View style={styles.profileTop}><View style={styles.avatar}><Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName}>{name}</Text><Text style={styles.profileMeta}>{token ? '懒人装甲账号' : '登录后开始使用'}</Text><Text style={styles.profileSummary}>{token ? `已连接 ${activeConnections} 项能力 · 运行中 ${activePlans} 个计划` : '尚未连接服务'}</Text></View>{loading ? <ActivityIndicator color={colors.primary} /> : <Pressable accessibilityRole="button" onPress={() => router.push('/profile' as never)} style={styles.profileState}><Text style={styles.profileStateText}>编辑资料</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>}</View><View style={styles.metrics}><Metric value={plans.data?.length ?? 0} icon="layers-outline" label="计划" detail={`运行中 ${activePlans} 个`} /><Metric value={activeDrafts} icon="document-text-outline" label="草稿" detail={`待完善 ${activeDrafts} 个`} /><Metric value={activeConnections} icon="link-outline" label="连接" detail={`已授权 ${activeConnections} 项`} /><Metric value={recentRecords} icon="time-outline" label="记录" detail="近 30 天" last /></View></View>

    <Section title="应用管理"><MenuRow icon="link-outline" tone="blue" title="连接管理" detail="管理已授权的数据来源与服务能力" onPress={() => router.push('/connections' as never)} /><MenuRow icon="desktop-outline" tone="orange" title="设备管理" detail="手机、电脑与已连接设备" onPress={() => router.push('/devices' as never)} /><MenuRow icon="reader-outline" tone="purple" title="记录管理" detail="查看历史执行结果与操作记录" onPress={() => router.push('/records' as never)} last /></Section>
    <Section title="账号与偏好"><MenuRow icon="person-outline" tone="green" title="账号安全" detail="邮箱、密码、可信设备与登录记录" status={token ? '已验证' : '未登录'} onPress={() => router.push('/security-center' as never)} /><MenuRow icon="notifications-outline" tone="orange" title="通知设置" detail="计划提醒、消息与系统通知" onPress={() => router.push('/notification-settings' as never)} last /></Section>
    <Section title="服务与支持"><MenuRow icon="help-circle-outline" tone="orange" title="帮助与反馈" detail="常见问题、使用指南与意见反馈" status="待开放" /><MenuRow icon="information-circle-outline" tone="purple" title="关于懒人装甲" detail="版本信息、服务协议与隐私政策" status="开发版" last /></Section>
    {token ? <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}><Ionicons name="log-out-outline" size={18} color={colors.textSecondary} /><Text style={styles.logoutText}>退出登录</Text></Pressable> : null}
  </ScrollView></SafeAreaView>;
}

function Metric({ value, icon, label, detail, last = false }: { value: number; icon: IconName; label: string; detail: string; last?: boolean }) { return <View style={[styles.metric, !last && styles.metricDivider]}><View style={styles.metricValueRow}><Text style={styles.metricValue}>{value}</Text><Ionicons name={icon} size={15} color={colors.primary} /></View><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricDetail}>{detail}</Text></View>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <><Text style={styles.sectionTitle}>{title}</Text><View style={styles.menu}>{children}</View></>; }
function MenuRow({ icon, tone, title, detail, status, onPress, last = false }: { icon: IconName; tone: 'green' | 'orange' | 'blue' | 'purple'; title: string; detail: string; status?: string; onPress?: () => void; last?: boolean }) { return <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}><View style={[styles.rowIcon, styles[`icon_${tone}`]]}><Ionicons name={icon} size={21} color={tone === 'orange' ? '#C97917' : tone === 'blue' ? '#3474C8' : tone === 'purple' ? '#7754B8' : colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text></View>{status ? <Text style={styles.rowStatus}>{status}</Text> : null}{onPress ? <Ionicons name="chevron-forward" size={17} color={colors.textMuted} /> : null}</Pressable>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 92 }, pressed: { opacity: 0.68 }, title: { ...typography.pageTitle, color: colors.text, marginBottom: spacing.sm }, profileCard: { overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, profileTop: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }, avatar: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 31, backgroundColor: '#79A897' }, avatarText: { color: '#FFFFFF', fontSize: 25, fontWeight: '800' }, profileCopy: { flex: 1, minWidth: 0 }, profileName: { ...typography.title, color: colors.text, fontSize: 20 }, profileMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, profileSummary: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 3 }, profileState: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: '#F2F1ED' }, profileStateText: { fontSize: 12, color: colors.text }, metrics: { minHeight: 82, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, metric: { flex: 1, alignItems: 'center', justifyContent: 'center' }, metricDivider: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }, metricValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, metricValue: { fontSize: 19, fontWeight: '800', color: colors.text }, metricLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginTop: 2 }, metricDetail: { fontSize: 11, lineHeight: 16, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { ...typography.section, fontSize: 18, lineHeight: 24, color: colors.text, marginTop: spacing.md, marginBottom: 6 }, menu: { overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 9 }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, icon_green: { backgroundColor: colors.accentSoft }, icon_orange: { backgroundColor: '#FFF2DE' }, icon_blue: { backgroundColor: '#EAF2FD' }, icon_purple: { backgroundColor: '#F0EBFA' }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { ...typography.bodyStrong, color: colors.text }, rowDetail: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 2 }, rowStatus: { fontSize: 12, color: colors.textSecondary }, logout: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: spacing.md, borderRadius: radius.pill, backgroundColor: '#EFEEEA' }, logoutText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
});
