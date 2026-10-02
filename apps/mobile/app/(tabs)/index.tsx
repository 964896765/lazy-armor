import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { presentRunningPlan, type HomeRecentPlan } from '../../src/home-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];
type HomeMode = 'now' | 'history';
interface TodayData { pendingApprovals: Array<{ id: string; summary: string; planName: string | null }>; connectionIssues: Array<{ connectionId: string; providerName: string; planName: string | null }>; alerts: Array<{ id: string; title: string; body: string; priority: string }>; recentPlans: HomeRecentPlan[] }
interface HomeItem { key: string; icon: IconName; title: string; detail: string; route: string; tone: number }

const TONES = ['#2680EB', '#FF8A18', '#8A45E6', '#18B985', '#1995E8'] as const;
const SOFT_TONES = ['#E5F1FF', '#FFF0DF', '#F0E7FF', '#E3F9F0', '#E4F3FF'] as const;

export default function HomePage() {
  const token = useAuthStore((store) => store.token);
  const [mode, setMode] = useState<HomeMode>('now');
  const today = useQuery({ queryKey: ['home', token], queryFn: () => api<TodayData>('/today', token), enabled: Boolean(token), refetchInterval: 15_000 });
  const focus: HomeItem[] = [
    ...(today.data?.pendingApprovals ?? []).map((item, index) => ({ key: `approval:${item.id}`, icon: 'shield-checkmark-outline' as IconName, title: item.planName ?? '计划等待确认', detail: item.summary, route: `/approvals/${item.id}`, tone: index })),
    ...(today.data?.connectionIssues ?? []).map((item, index) => ({ key: `connection:${item.connectionId}`, icon: 'link-outline' as IconName, title: item.planName ?? item.providerName, detail: `${item.providerName} 连接需要处理`, route: `/connections/${item.connectionId}`, tone: index + 1 })),
    ...(today.data?.alerts ?? []).map((item, index) => ({ key: `alert:${item.id}`, icon: 'notifications-outline' as IconName, title: item.title, detail: item.body, route: '/messages', tone: index + 2 })),
  ];
  const plans = today.data?.recentPlans ?? [];
  const running = plans.filter((plan) => ['active', 'ready', 'degraded', 'blocked'].includes(plan.planStatus));
  const refresh = () => { void today.refetch(); };

  return <SafeAreaView edges={['top']} style={styles.safeArea}>
    <View style={styles.top}><RoundButton icon="person-outline" label="个人资料" onPress={() => router.push('/profile' as never)} /><View style={styles.segment}><Segment label="现在" icon="flash" selected={mode === 'now'} onPress={() => setMode('now')} /><Segment label="历史" icon="time-outline" selected={mode === 'history'} onPress={() => setMode('history')} /></View><RoundButton icon="options-outline" label="设置" onPress={() => router.push('/feature-placeholder?feature=preferences' as never)} /></View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={token ? <RefreshControl tintColor="#287CEB" refreshing={today.isFetching} onRefresh={refresh} /> : undefined}>
      {!token ? <Empty title="登录后查看你的今天" detail="首页只展示属于当前账号的真实计划和待处理事项。" action="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
      {token && today.isLoading ? <View style={styles.loading}><ActivityIndicator color="#287CEB" /><Text style={styles.muted}>正在整理今天…</Text></View> : null}
      {token && today.isError ? <Empty title="暂时无法读取首页" detail="网络恢复后可以重新加载。" action="重试" onPress={refresh} /> : null}
      {token && !today.isLoading && !today.isError && mode === 'now' ? <>
        <Text style={styles.sectionTitle}>今天</Text>
        {focus.length > 0 ? <View style={styles.rows}>{focus.slice(0, 5).map((item, index) => <HomeRow key={item.key} item={item} index={index} />)}</View> : <Empty title="今天没有需要处理的事" detail="计划会继续运行，重要变化才会出现在这里。" action="查看计划" onPress={() => router.push('/plans' as never)} />}
        <Text style={styles.sectionTitle}>正在进行</Text>
        {running.length > 0 ? <View style={styles.rows}>{running.slice(0, 5).map((plan, index) => { const view = presentRunningPlan(plan); return <HomeRow key={plan.planId} index={index + 3} item={{ key: plan.planId, icon: 'bar-chart-outline', title: plan.planName ?? '未命名计划', detail: `${view.label} · ${view.summary}`, route: `/plans/${plan.planId}`, tone: index + 3 }} />; })}</View> : <Empty title="暂时没有进行中的计划" detail="从计划页选择模板，或在聊天中描述目标。" action="创建计划" onPress={() => router.push('/plans' as never)} />}
      </> : null}
      {token && !today.isLoading && !today.isError && mode === 'history' ? <><Text style={styles.sectionTitle}>最近记录</Text>{plans.length > 0 ? <View style={styles.rows}>{plans.map((plan, index) => { const view = presentRunningPlan(plan); return <HomeRow key={plan.planId} index={index} item={{ key: plan.planId, icon: 'time-outline', title: plan.planName ?? '未命名计划', detail: `${view.label} · ${view.summary}`, route: `/plans/${plan.planId}`, tone: index }} />; })}</View> : <Empty title="还没有历史记录" detail="计划产生真实进展后会显示在这里。" action="浏览计划" onPress={() => router.push('/plans' as never)} />}</> : null}
    </ScrollView>
  </SafeAreaView>;
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Ionicons name={icon} size={25} color="#111827" /></Pressable>; }
function Segment({ label, icon, selected, onPress }: { label: string; icon: IconName; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.segmentButton, selected && styles.segmentSelected]}><Ionicons name={icon} size={20} color={selected ? '#1475EA' : '#627186'} /><Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text></Pressable>; }
function HomeRow({ item, index }: { item: HomeItem; index: number }) { const i = (item.tone ?? index) % TONES.length; return <Pressable accessibilityRole="button" onPress={() => router.push(item.route as never)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={[styles.rowIcon, { backgroundColor: SOFT_TONES[i] }]}><Ionicons name={item.icon} size={27} color={TONES[i]} /></View><View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text><Text numberOfLines={2} style={styles.rowDetail}>{item.detail}</Text></View><View style={[styles.statusDot, { backgroundColor: TONES[i] }]} /><Ionicons name="chevron-forward" size={23} color="#7C8797" /></Pressable>; }
function Empty({ title, detail, action, onPress }: { title: string; detail: string; action: string; onPress: () => void }) { return <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name="sparkles-outline" size={26} color="#287CEB" /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View><Pressable onPress={onPress} style={styles.emptyAction}><Text style={styles.emptyActionText}>{action}</Text></Pressable></View>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'rgba(248,250,253,0.90)' }, top: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }, roundButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, segment: { width: 182, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DCE3EC' }, segmentButton: { flex: 1, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderBottomWidth: 2, borderBottomColor: 'transparent' }, segmentSelected: { borderBottomColor: '#2F80ED' }, segmentText: { color: '#687588', fontSize: 14 }, segmentTextSelected: { color: '#162033', fontWeight: '600' }, content: { paddingHorizontal: 18, paddingBottom: 26 }, sectionTitle: { marginTop: 18, marginBottom: 9, color: '#172033', fontSize: 20, lineHeight: 28, fontWeight: '700' }, rows: { overflow: 'hidden', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#DEE6EF', backgroundColor: '#FFFFFF' }, row: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7ECF2' }, rowIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: '#162033', fontSize: 16, lineHeight: 22, fontWeight: '600' }, rowDetail: { marginTop: 2, color: '#697688', fontSize: 13, lineHeight: 19 }, statusDot: { width: 8, height: 8, borderRadius: 4 }, pressed: { opacity: 0.64 }, loading: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 }, muted: { color: '#647083', fontSize: 14 }, empty: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#DEE6EF', backgroundColor: '#FFFFFF' }, emptyIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F1FF' }, emptyAction: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 6 }, emptyActionText: { color: '#287CEB', fontSize: 13, fontWeight: '600' },
});
