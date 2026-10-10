import { HeaderIconButton } from '../../src/header-icon-button';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SkillRepositoryList } from '../../src/skill-repository-list';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PlanLibraryItem } from '@lazy-armor/plan-schema';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { Button, ui } from '../../src/editor-ui';
import { SegmentedControl, ChipTabs, StatusBadge, EmptyState, LoadingState, ErrorState } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../../src/consumer-presentation';

export default function Plans() {
  const token = useAuthStore(store => store.token);
  const params = useLocalSearchParams<{ view?: string }>();
  const [mode, setMode] = useState(params.view === 'skills' ? 'SKILLS' : 'MINE');
  const [filter, setFilter] = useState('ALL');
  const query = useQuery({ queryKey: ['plan-library', token], queryFn: () => api<{ plans: PlanLibraryItem[] }>('/plan-library', token), enabled: Boolean(token && mode === 'MINE'), refetchInterval: 20000 });
  const plans = (query.data?.plans ?? []).filter(item => filter === 'ALL' || item.status === filter);
  const create = () => router.push('/chat?mode=plan' as never);


  return <SafeAreaView edges={['top']} style={{ flex: 1 }}><ScrollView contentContainerStyle={ui.content}>
    <View style={ui.line}><Text style={[ui.pageTitle, { textAlign: 'left' }]}>计划</Text><HeaderIconButton label={mode === 'SKILLS' ? '接入方法来源' : '新建计划'} icon="add" onPress={() => mode === 'SKILLS' ? router.push('/skill-import' as never) : create()}/></View>
    <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'SKILLS', label: 'Skill仓库' }, { value: 'MINE', label: '我的计划' }]} />
    {mode === 'SKILLS' ? <SkillRepositoryList token={token} /> : <>
      <View style={{height:42,flexShrink:0}}><ChipTabs value={filter} onChange={setFilter} options={[{ value: 'ALL', label: '全部' }, { value: 'RUNNING', label: '运行中' }, { value: 'ATTENTION', label: '待处理' }, { value: 'PAUSED', label: '已暂停' }, { value: 'ENDED', label: '已结束' }]} /></View>
      {!token ? <Button label="登录后查看计划" onPress={() => router.push('/auth/login' as never)} /> : query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : plans.length ? <View style={styles.list}>{plans.map(plan => <Pressable key={plan.planId} accessibilityRole="button" onPress={() => router.push(plan.primaryAction.path as never)} style={styles.row}>
        <View style={styles.copy}><Text style={styles.title}>{p.text(plan.title, '我的计划')}</Text><Text style={styles.detail}>{p.text(plan.summary)}</Text><Text style={styles.detail}>{plan.nextRun ? '下次运行 ' + p.dateTime(plan.nextRun) : p.text(plan.nextStep)}</Text><StatusBadge label={p.reason(plan.status)} /></View><Ionicons name="chevron-forward" size={18} color="#667085" />
      </Pressable>)}</View> : <EmptyState title="没有符合筛选的计划" detail="描述你希望长期完成的目标和周期，确认草案后创建计划。" action="创建计划" onPress={create} />}
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
