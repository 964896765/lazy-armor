import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { disconnectRequest, validateConnectionRequest } from '../../src/connection-api-contract';
import { capabilityDescription, capabilityLabel, capabilityRiskHint, connectionStatusLabel } from '../../src/connection-presenter';
import { EmptyState, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

interface Connection { id: string; connectorId: string; connectorName: string; externalAccountName: string; status: string }
interface Permission { capability: string; name: string; riskLevel: string; granted: boolean; expiresAt?: string }
interface PlanUsage { planId: string; planName: string; planStatus: string; requiredCapabilities: string[] }
type DetailTab = '概览' | '可用能力' | '关联计划' | '权限与确认';
const TABS: DetailTab[] = ['概览', '可用能力', '关联计划', '权限与确认'];

export default function ConnectionDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const [tab, setTab] = useState<DetailTab>('概览');
  const connections = useQuery({ queryKey: ['connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const permissions = useQuery({ queryKey: ['connection-permissions', id], queryFn: () => api<Permission[]>(`/connections/${id}/permissions`, token), enabled: Boolean(token && id) });
  const plans = useQuery({ queryKey: ['connection-plans', id], queryFn: () => api<PlanUsage[]>(`/connections/${id}/plans`, token), enabled: Boolean(token && id) });
  const connection = connections.data?.find((item) => item.id === id);
  const refresh = useMutation({
    mutationFn: () => { const request = validateConnectionRequest(id); return api(request.path, token, request.init); },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['connections', token] }); },
  });
  const updatePermission = useMutation({
    mutationFn: (permission: Permission) => api<Permission[]>(`/connections/${id}/permissions`, token, { method: 'PUT', body: JSON.stringify({ permissions: [{ capability: permission.capability, granted: !permission.granted }] }) }),
    onSuccess: async () => { await Promise.all([permissions.refetch(), client.invalidateQueries({ queryKey: ['connections', token] })]); },
  });
  const disconnect = useMutation({
    mutationFn: () => { const request = disconnectRequest(id); return api<void>(request.path, token, request.init); },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['connections', token] }); router.replace('/connections' as never); },
  });

  function changePermission(permission: Permission) {
    const affected = (plans.data ?? []).filter((plan) => plan.requiredCapabilities.includes(permission.capability));
    if (!permission.granted || affected.length === 0) { updatePermission.mutate(permission); return; }
    Alert.alert('关闭这项权限？', `${affected.map((plan) => `“${plan.planName}”`).join('、')}将暂停使用这项信息。`, [{ text: '保留', style: 'cancel' }, { text: '仍要关闭', style: 'destructive', onPress: () => updatePermission.mutate(permission) }]);
  }

  function confirmDisconnect() {
    Alert.alert('断开这个来源？', '相关计划会停止读取新信息，但计划和历史记录会保留。', [{ text: '取消', style: 'cancel' }, { text: '断开来源', style: 'destructive', onPress: () => disconnect.mutate() }]);
  }

  const loading = connections.isLoading || permissions.isLoading || plans.isLoading;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.primary} refreshing={connections.isFetching || permissions.isFetching || plans.isFetching} onRefresh={() => { void connections.refetch(); void permissions.refetch(); void plans.refetch(); }} />}>
        <WorkspaceHeader title="来源详情" subtitle="查看真实来源的能力、用途与授权边界" onBack={() => router.back()} action={<Pressable accessibilityLabel="更多来源" onPress={() => router.replace('/connections' as never)} style={styles.more}><Ionicons name="ellipsis-horizontal" size={21} color={colors.text} /></Pressable>} />
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取来源信息…</Text></View> : null}
        {!loading && !connection ? <EmptyState icon="link-outline" title="没有找到这个来源" description="它可能已经断开或被移除。" action={{ label: '返回连接中心', onPress: () => router.replace('/connections' as never) }} /> : null}
        {connection ? <>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name={providerIcon(connection.connectorId)} size={29} color={colors.primary} /></View><View style={styles.heroCopy}><View style={styles.heroTitleRow}><Text style={styles.heroTitle}>{displayName(connection)}</Text><Text style={[styles.status, connection.status !== 'active' && styles.statusWarning]}>{connectionStatusLabel(connection.status)}</Text></View><Text numberOfLines={1} style={styles.account}>{connection.externalAccountName}</Text><Text style={styles.heroDescription}>只在你授权的范围内为计划读取信息或准备动作。</Text></View></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{TABS.map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabSelected]}><Text style={[styles.tabText, tab === item && styles.tabTextSelected]}>{item}</Text></Pressable>)}</ScrollView>

          {tab === '概览' ? <Overview connection={connection} permissionCount={permissions.data?.filter((item) => item.granted).length ?? 0} planCount={plans.data?.length ?? 0} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} /> : null}
          {tab === '可用能力' ? <CapabilityList connection={connection} permissions={permissions.data ?? []} /> : null}
          {tab === '关联计划' ? <PlanList plans={plans.data ?? []} /> : null}
          {tab === '权限与确认' ? <PermissionList connection={connection} permissions={permissions.data ?? []} pending={updatePermission.isPending} onChange={changePermission} onDisconnect={confirmDisconnect} disconnecting={disconnect.isPending} /> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Overview({ connection, permissionCount, planCount, refreshing, onRefresh }: { connection: Connection; permissionCount: number; planCount: number; refreshing: boolean; onRefresh: () => void }) {
  return <><View style={styles.summary}><SummaryItem icon="shield-checkmark-outline" value={permissionCount} label="已授权能力" /><View style={styles.summaryDivider} /><SummaryItem icon="layers-outline" value={planCount} label="关联计划" /><View style={styles.summaryDivider} /><SummaryItem icon="radio-outline" value={connection.status === 'active' ? '正常' : '关注'} label="连接状态" /></View><SectionTitle title="连接状态" /><View style={styles.card}><InfoRow icon="pulse-outline" title="当前状态" detail={connectionStatusLabel(connection.status)} /><InfoRow icon="person-outline" title="授权账号" detail={connection.externalAccountName} /><InfoRow icon="shield-outline" title="数据边界" detail="只使用已开启的能力" last /></View><SectionTitle title="可以做什么" /><View style={styles.notice}><Ionicons name="information-circle-outline" size={20} color={colors.primary} /><Text style={styles.noticeText}>计划只能使用下方已授权能力；涉及外部写入或高风险动作时仍会单独确认。</Text></View><Pressable disabled={refreshing} onPress={onRefresh} style={styles.primaryButton}><Ionicons name="sync-outline" size={18} color="#FFFFFF" /><Text style={styles.primaryButtonText}>{refreshing ? '正在同步…' : '同步最新状态'}</Text></Pressable></>;
}

function CapabilityList({ connection, permissions }: { connection: Connection; permissions: Permission[] }) {
  return <><SectionTitle title="可用能力" /><View style={styles.card}>{permissions.length > 0 ? permissions.map((permission, index) => <InfoRow key={permission.capability} icon={capabilityIcon(permission.capability)} title={capabilityLabel(connection.connectorId, permission.capability, permission.name)} detail={capabilityDescription(connection.connectorId, permission.capability)} badge={permission.granted ? '已启用' : '未启用'} last={index === permissions.length - 1} />) : <Text style={styles.cardEmpty}>这个来源暂未声明可用能力。</Text>}</View></>;
}

function PlanList({ plans }: { plans: PlanUsage[] }) {
  return <><SectionTitle title="关联计划" /><View style={styles.card}>{plans.length > 0 ? plans.map((plan, index) => <Pressable key={plan.planId} onPress={() => router.push(`/plans/${plan.planId}` as never)} style={[styles.planRow, index < plans.length - 1 && styles.divider]}><View style={styles.rowIcon}><Ionicons name="play-outline" size={18} color={colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{plan.planName}</Text><Text style={styles.rowDetail}>{plan.requiredCapabilities.length} 项能力 · {planStatus(plan.planStatus)}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>) : <Text style={styles.cardEmpty}>目前没有计划使用这个来源。</Text>}</View></>;
}

function PermissionList({ connection, permissions, pending, onChange, onDisconnect, disconnecting }: { connection: Connection; permissions: Permission[]; pending: boolean; onChange: (permission: Permission) => void; onDisconnect: () => void; disconnecting: boolean }) {
  return <><View style={styles.permissionNotice}><Ionicons name="shield-checkmark" size={20} color={colors.accent} /><View style={styles.rowCopy}><Text style={styles.permissionNoticeTitle}>我们只会使用你授权的数据</Text><Text style={styles.rowDetail}>关闭能力前会说明受影响的计划，不会扩大授权范围。</Text></View></View><SectionTitle title="将读取的数据与能力" /><View style={styles.card}>{permissions.map((permission, index) => <View key={permission.capability} style={[styles.permissionRow, index < permissions.length - 1 && styles.divider]}><View style={styles.rowIcon}><Ionicons name={capabilityIcon(permission.capability)} size={18} color={colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{capabilityLabel(connection.connectorId, permission.capability, permission.name)}</Text><Text style={styles.rowDetail}>{capabilityRiskHint(permission.capability, permission.riskLevel)}</Text></View><Pressable disabled={pending || connection.status === 'revoked'} onPress={() => onChange(permission)} style={[styles.switch, permission.granted && styles.switchOn]}><View style={[styles.switchThumb, permission.granted && styles.switchThumbOn]} /></Pressable></View>)}</View><Pressable disabled={disconnecting} onPress={onDisconnect} style={styles.dangerButton}><Ionicons name="unlink-outline" size={18} color={colors.danger} /><Text style={styles.dangerText}>{disconnecting ? '正在断开…' : '断开这个来源'}</Text></Pressable></>;
}

function SummaryItem({ icon, value, label }: { icon: ComponentProps<typeof Ionicons>['name']; value: string | number; label: string }) { return <View style={styles.summaryItem}><Ionicons name={icon} size={18} color={colors.primary} /><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>; }
function SectionTitle({ title }: { title: string }) { return <Text style={styles.sectionTitle}>{title}</Text>; }
function InfoRow({ icon, title, detail, badge, last = false }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; detail: string; badge?: string; last?: boolean }) { return <View style={[styles.infoRow, !last && styles.divider]}><View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text numberOfLines={2} style={styles.rowDetail}>{detail}</Text></View>{badge ? <Text style={styles.badge}>{badge}</Text> : null}</View>; }
function displayName(connection: Connection) { if (connection.connectorId === 'gmail') return 'Google 邮箱'; if (connection.connectorId.includes('calendar')) return 'Google 日历'; return connection.connectorName; }
function providerIcon(key: string): ComponentProps<typeof Ionicons>['name'] { if (key === 'gmail') return 'mail-outline'; if (key.includes('calendar')) return 'calendar-outline'; if (key.includes('github')) return 'logo-github'; if (key.includes('file')) return 'document-text-outline'; return 'link-outline'; }
function capabilityIcon(capability: string): ComponentProps<typeof Ionicons>['name'] { if (capability.includes('EMAIL')) return 'mail-outline'; if (capability.includes('EVENT')) return 'calendar-outline'; if (capability.includes('FILE')) return 'document-text-outline'; if (capability.includes('WRITE') || capability.includes('CREATE')) return 'create-outline'; return 'shield-outline'; }
function planStatus(status: string) { if (status === 'active' || status === 'ready') return '运行中'; if (status === 'paused') return '已暂停'; return '已保存'; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' }, page: { flex: 1, backgroundColor: '#FFFFFF' }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  more: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F4F7' }, loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: spacing.md }, muted: { ...typography.caption, color: colors.textSecondary },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg }, heroIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, heroCopy: { flex: 1, minWidth: 0 }, heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, heroTitle: { ...typography.title, color: colors.text, fontSize: 21 }, status: { ...typography.label, color: colors.success, backgroundColor: colors.successSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }, statusWarning: { color: colors.warning, backgroundColor: colors.warningSoft }, account: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, heroDescription: { ...typography.caption, color: colors.textMuted, marginTop: 3 },
  tabs: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingRight: spacing.md }, tab: { minHeight: 42, justifyContent: 'center', marginRight: spacing.xl, borderBottomWidth: 2, borderBottomColor: 'transparent' }, tabSelected: { borderBottomColor: colors.primary }, tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' }, tabTextSelected: { color: colors.primary },
  summary: { minHeight: 82, flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, summaryItem: { flex: 1, alignItems: 'center', gap: 2 }, summaryDivider: { width: 1, height: 38, backgroundColor: colors.border }, summaryValue: { ...typography.bodyStrong, color: colors.text }, summaryLabel: { fontSize: 9, lineHeight: 13, color: colors.textMuted },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }, card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }, infoRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border }, rowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { ...typography.bodyStrong, color: colors.text }, rowDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, badge: { ...typography.label, color: colors.primary, backgroundColor: colors.successSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }, cardEmpty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft }, noticeText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 }, primaryButton: { minHeight: 46, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, primaryButtonText: { ...typography.bodyStrong, color: '#FFFFFF' },
  planRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, permissionNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft }, permissionNoticeTitle: { ...typography.bodyStrong, color: '#B54708' }, permissionRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, switch: { width: 42, height: 24, borderRadius: 12, backgroundColor: '#D0D5DD', padding: 2 }, switchOn: { backgroundColor: colors.primary }, switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, switchThumbOn: { marginLeft: 18 }, dangerButton: { minHeight: 46, marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerSoft }, dangerText: { ...typography.bodyStrong, color: colors.danger },
});
