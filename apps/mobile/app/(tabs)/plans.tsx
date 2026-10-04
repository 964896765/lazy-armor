import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PlanLibraryItem } from '@lazy-armor/plan-schema';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { Button, ui } from '../../src/editor-ui';
import { SegmentedControl, ChipTabs, StatusBadge, EmptyState, LoadingState, ErrorState } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../../src/consumer-presentation';
import { PLAN_DOMAIN_CATALOG, coreTemplateIntent } from '../../src/plan-domain-catalog';

export default function Plans() {
  const token = useAuthStore(store => store.token);
  const [mode, setMode] = useState('TEMPLATES');
  const [domain, setDomain] = useState(PLAN_DOMAIN_CATALOG[0].key);
  const [filter, setFilter] = useState('ALL');
  const selectedDomain = PLAN_DOMAIN_CATALOG.find(item => item.key === domain) ?? PLAN_DOMAIN_CATALOG[0];
  const query = useQuery({ queryKey: ['plan-library', token], queryFn: () => api<{ plans: PlanLibraryItem[] }>('/plan-library', token), enabled: Boolean(token && mode === 'MINE'), refetchInterval: 20000 });
  const plans = (query.data?.plans ?? []).filter(item => filter === 'ALL' || item.status === filter);
  const create = () => router.push('/chat?mode=plan' as never);
  const useTemplate = (name: string) => router.push({ pathname: '/chat', params: { mode: 'plan', intent: coreTemplateIntent(selectedDomain, name) } } as never);

  return <SafeAreaView edges={['top']} style={{ flex: 1 }}><ScrollView contentContainerStyle={ui.content}>
    <View style={ui.line}><Text style={[ui.pageTitle, { textAlign: 'left' }]}>计划</Text><Pressable accessibilityRole="button" accessibilityLabel="新建计划" style={ui.back} onPress={create}><Ionicons name="add" size={25} color="#2589FF" /></Pressable></View>
    <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'TEMPLATES', label: '模板' }, { value: 'MINE', label: '我的计划' }]} />
    {mode === 'TEMPLATES' ? <>
      <ChipTabs value={domain} onChange={setDomain} options={PLAN_DOMAIN_CATALOG.map(item => ({ value: item.key, label: item.label }))} />
      <Text style={ui.detail}>{selectedDomain.label} · {selectedDomain.groups.flatMap(group => group.templates).length} 个核心模板</Text>
      <Text style={ui.detail}>选择一类问题，进入后再由 AI 细化目标、范围与周期。</Text>
      <View style={styles.list}>{selectedDomain.groups.flatMap(group => group.templates).map(name => <Pressable key={name} accessibilityRole="button" accessibilityLabel={'使用' + name} onPress={() => useTemplate(name)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Ionicons name="sparkles-outline" size={18} color="#2589FF" />
        <View style={styles.copy}><Text style={styles.title}>{name}</Text></View>
        <View style={ui.back}><Ionicons name="add" size={22} color="#2589FF" /></View>
      </Pressable>)}</View>
    </> : <>
      <ChipTabs value={filter} onChange={setFilter} options={[{ value: 'ALL', label: '全部' }, { value: 'RUNNING', label: '运行中' }, { value: 'ATTENTION', label: '待处理' }, { value: 'PAUSED', label: '已暂停' }, { value: 'ENDED', label: '已结束' }]} />
      {!token ? <Button label="登录后查看计划" onPress={() => router.push('/auth/login' as never)} /> : query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : plans.length ? <View style={styles.list}>{plans.map(plan => <Pressable key={plan.planId} accessibilityRole="button" onPress={() => router.push(plan.primaryAction.path as never)} style={styles.row}>
        <View style={styles.copy}><Text style={styles.title}>{p.text(plan.title, '我的计划')}</Text><Text style={styles.detail}>{p.text(plan.summary)}</Text><Text style={styles.detail}>{plan.nextRun ? '下次运行 ' + p.dateTime(plan.nextRun) : p.text(plan.nextStep)}</Text><StatusBadge label={p.reason(plan.status)} /></View><Ionicons name="chevron-forward" size={18} color="#667085" />
      </Pressable>)}</View> : <EmptyState title="没有符合筛选的计划" detail="从模板开始，或描述你希望长期完成的需求。" action="创建计划" onPress={create} />}
    </>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  list: { backgroundColor: 'rgba(255,255,255,0.28)', paddingHorizontal: 12 },
  row: { minHeight: 52, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(100,120,150,0.24)' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#101828' },
  detail: { fontSize: 12, lineHeight: 17, color: '#667085' },
  pressed: { backgroundColor: 'rgba(211,227,247,0.8)' },
});
