import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { workspaceColors as colors, radius, spacing, typography } from './design';
import { WorkspaceHeader } from './design/components/WorkspaceHeader';
import { GOAL_CAPABILITY_GROUPS, type GoalCapability } from './goal-capability-catalog';

type IconName = ComponentProps<typeof Ionicons>['name'];
const GROUP_ICONS: readonly IconName[] = ['document-text-outline', 'cube-outline', 'calendar-outline', 'create-outline', 'paper-plane-outline'];
const SCENARIO_LABELS: Record<string, string> = {
  'health.medication': '健康 / 用药管理',
  'family.family_supply': '日常生活 / 家庭补给',
  'finance.monthly_bill': '财务 / 月度账单',
  'logistics.delivery': '日常生活 / 快递',
  'daily_life.delivery': '日常生活 / 快递',
};

export function GoalResourceSelector({ scenarioKey }: { scenarioKey: string }) {
  const token = useAuthStore((store) => store.token);
  const compact = useWindowDimensions().width < 600;
  const [expanded, setExpanded] = useState('');
  const [selected, setSelected] = useState<readonly GoalCapability[]>([]);
  const connections = useQuery({ queryKey: ['create-resources-connections', token], queryFn: () => api<Array<{ id?: string; provider?: string; name?: string }>>('/connections', token), enabled: Boolean(token) });
  const devices = useQuery({ queryKey: ['create-resources-devices', token], queryFn: () => api<Array<{ id?: string; name?: string; model?: string }>>('/device-profiles', token), enabled: Boolean(token) });
  const available = useMemo(() => [...(connections.data ?? []).map((item, index) => ({ resourceKey: item.id ?? `connection-${index}`, icon: 'link-outline' as const, title: item.name ?? item.provider ?? '已连接应用', detail: '连接范围将在下一步核验', state: '待核验' })), ...(devices.data ?? []).map((item, index) => ({ resourceKey: item.id ?? `device-${index}`, icon: 'phone-portrait-outline' as const, title: item.name ?? item.model ?? '已登记设备', detail: '在线与权限需执行前核验', state: '已登记' }))], [connections.data, devices.data]);
  const toggle = (item: GoalCapability) => setSelected((current) => current.some((value) => value.key === item.key) ? current.filter((value) => value.key !== item.key) : [...current, item]);
  const proceed = () => router.push(`/create-wizard?scenarioKey=${encodeURIComponent(scenarioKey)}&capabilities=${encodeURIComponent(selected.map((item) => item.name).join('、'))}` as never);

  return <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content}>
      <WorkspaceHeader title="新建计划" onBack={() => router.back()} />
      <View style={styles.scenarioStrip}><View style={styles.scenarioIcon}><Ionicons name="layers-outline" size={25} color={colors.primary} /></View><View style={styles.scenarioCopy}><Text style={styles.scenarioTitle}>已选场景：{SCENARIO_LABELS[scenarioKey] ?? scenarioKey}</Text><Text style={styles.scenarioDetail}>选择目标后，系统将根据已连接资源继续编排计划。</Text></View><Pressable onPress={() => router.replace('/' as never)} style={styles.change}><Text style={styles.changeText}>更换场景</Text><Ionicons name="chevron-forward" size={16} color={colors.primary} /></Pressable></View>

      <View style={styles.columns}>
        <View style={styles.goalColumn}><Text style={styles.columnTitle}>目标</Text><Text style={styles.columnHint}>选择希望实现的目标（可多选）</Text>
          <View style={styles.groupList}>{GOAL_CAPABILITY_GROUPS.map((group, groupIndex) => { const open = expanded === group.key; const count = selected.filter((item) => group.categories.some((category) => item.key.startsWith(`${category.key}.`))).length; return <View key={group.key} style={styles.groupBlock}>
            <Pressable onPress={() => setExpanded(open ? '' : group.key)} style={[styles.groupRow, open && styles.groupRowOpen]}><Ionicons name={GROUP_ICONS[groupIndex]} size={21} color={colors.primary} /><View style={styles.groupCopy}><Text style={styles.groupTitle}>{group.name}</Text>{open ? <Text style={styles.groupDetail}>{group.description}</Text> : null}</View>{count ? <Text style={styles.count}>{count}</Text> : null}<Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={19} color={colors.textSecondary} /></Pressable>
            {open ? <View style={styles.expanded}>{group.categories.map((category) => <View key={category.key}><Text style={styles.categoryTitle}>{category.name}</Text>{category.capabilities.map((item) => { const active = selected.some((value) => value.key === item.key); return <Pressable key={item.key} onPress={() => toggle(item)} style={styles.capabilityRow}><View style={styles.capabilityCopy}><Text style={styles.capabilityTitle}>{item.name}</Text><Text style={styles.capabilityDetail}>{item.description}</Text></View><Ionicons name={active ? 'checkbox' : 'square-outline'} size={22} color={active ? colors.primary : colors.textMuted} /></Pressable>; })}</View>)}</View> : null}
          </View>; })}</View>
        </View>

        <View style={styles.resourceColumn}><Text style={styles.columnTitle}>资源</Text><Text style={styles.columnHint}>选择目标后核对可用资源</Text>
          <SectionLabel icon="sparkles-outline" title="推荐资源" />
          {connections.isLoading || devices.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
          {connections.isError || devices.isError ? <Text style={styles.error}>资源状态暂时无法核实，不会按“已连接”处理。</Text> : null}
          {!connections.isLoading && !devices.isLoading && available.length === 0 ? <Text style={styles.empty}>还没有可核实的连接或设备。可继续选择目标，系统将在下一步列出缺少的资源。</Text> : null}
          {available.length ? <SectionLabel icon="link-outline" title="已连接" /> : null}
          {available.map((item) => <ResourceRow key={item.resourceKey} {...item} compact={compact} />)}
          <SectionLabel icon="alert-circle-outline" title="缺少" tone="warning" />
          <Pressable onPress={() => router.push('/connections' as never)} style={styles.resourceRow}>{!compact ? <Ionicons name="cloud-outline" size={23} color={colors.text} /> : null}<View style={styles.resourceCopy}><Text style={styles.resourceTitle}>其他资源</Text>{!compact ? <Text style={styles.resourceDetail}>连接后才能确认是否可用</Text> : null}</View><Text style={styles.warningBadge}>去连接</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>
        </View>
      </View>

      <Text style={styles.boundary}>5 大能力组、18 个一级类别、90 个二级能力是目标目录，不代表项目已全部实现；创建时仍会经过来源、授权和执行能力校验。</Text>
      <Pressable disabled={selected.length === 0} onPress={proceed} style={[styles.primary, selected.length === 0 && styles.primaryDisabled]}><Text style={styles.primaryText}>{selected.length ? `继续创建（已选 ${selected.length} 项）` : '请选择目标'}</Text></Pressable>
      <Pressable onPress={() => router.back()} style={styles.later}><Text style={styles.laterText}>稍后再说</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function SectionLabel({ icon, title, tone = 'brand' }: { icon: IconName; title: string; tone?: 'brand' | 'warning' }) { return <View style={styles.sectionLabel}><Ionicons name={icon} size={18} color={tone === 'warning' ? '#C97917' : colors.primary} /><Text style={styles.sectionLabelText}>{title}</Text></View>; }
function ResourceRow({ icon, title, detail, state, compact }: { icon: 'link-outline' | 'phone-portrait-outline'; title: string; detail: string; state: string; compact: boolean }) { return <View style={styles.resourceRow}>{!compact ? <Ionicons name={icon} size={23} color={colors.primary} /> : null}<View style={styles.resourceCopy}><Text numberOfLines={1} style={styles.resourceTitle}>{title}</Text>{!compact ? <Text numberOfLines={2} style={styles.resourceDetail}>{detail}</Text> : null}</View><Text style={styles.stateBadge}>{state}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></View>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingBottom: 44 },
  scenarioStrip: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: '#F2F7F4' }, scenarioIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#FCEAEC' }, scenarioCopy: { flex: 1, minWidth: 0 }, scenarioTitle: { ...typography.bodyStrong, color: colors.text }, scenarioDetail: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 2 }, change: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.sm }, changeText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  columns: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.lg }, goalColumn: { flex: 1.18, minWidth: 0, paddingRight: spacing.sm }, resourceColumn: { flex: 1, minWidth: 0, overflow: 'hidden', paddingLeft: spacing.sm, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }, columnTitle: { ...typography.title, color: colors.text, fontSize: 23 }, columnHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  groupList: { marginTop: spacing.xs }, groupBlock: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, groupRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs }, groupRowOpen: { backgroundColor: '#F2F7F4', borderRadius: radius.md }, groupCopy: { flex: 1, minWidth: 0 }, groupTitle: { ...typography.bodyStrong, color: colors.text }, groupDetail: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 1 }, count: { minWidth: 20, textAlign: 'center', fontSize: 12, color: '#FFFFFF', backgroundColor: colors.primary, borderRadius: 10, overflow: 'hidden' }, expanded: { paddingLeft: spacing.sm }, categoryTitle: { ...typography.caption, color: colors.primary, fontWeight: '700', paddingTop: spacing.sm, paddingBottom: 2 }, capabilityRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, capabilityCopy: { flex: 1, minWidth: 0 }, capabilityTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 14, lineHeight: 20 }, capabilityDetail: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  sectionLabel: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.md, backgroundColor: '#F2F7F4' }, sectionLabelText: { ...typography.bodyStrong, color: colors.text }, loader: { marginVertical: spacing.lg }, error: { ...typography.caption, color: colors.danger, lineHeight: 18, paddingVertical: spacing.sm }, empty: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, paddingVertical: spacing.sm }, resourceRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, resourceCopy: { flex: 1, minWidth: 0 }, resourceTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 13, lineHeight: 19 }, resourceDetail: { fontSize: 12, lineHeight: 18, color: colors.textSecondary }, stateBadge: { fontSize: 12, color: colors.primary, backgroundColor: colors.successSoft, paddingHorizontal: 5, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' }, warningBadge: { fontSize: 12, color: '#C97917', backgroundColor: '#FFF2DE', paddingHorizontal: 5, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  boundary: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginTop: spacing.md }, primary: { minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.primary }, primaryDisabled: { opacity: 0.42 }, primaryText: { ...typography.bodyStrong, color: '#FFFFFF' }, later: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, laterText: { ...typography.body, color: colors.primary },
});
