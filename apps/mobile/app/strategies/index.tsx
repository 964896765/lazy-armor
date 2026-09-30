import { useQuery } from '@tanstack/react-query';
import { PLAN_STRATEGIES } from '@lazy-armor/plan-schema/mobile';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { colors, radius, spacing, typography } from '../../src/design';
import { LoginRequired, RuntimeDetailScreen, RuntimeLoadState } from '../../src/runtime-details-ui';

interface Strategy { key: string; label: string; revision: number; defaultActionMode: string; triggerModes: string[]; allowedAutomationCeiling: string; status: string }
export default function StrategiesPage() {
  const token = useAuthStore((store) => store.token);
  const strategies = useQuery({ queryKey: ['strategies', token], queryFn: () => api<Strategy[]>('/strategies', token), enabled: Boolean(token) });
  return <RuntimeDetailScreen title="策略中心" subtitle="选择管理方式；能否用于你的计划仍取决于场景与授权">
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={strategies.isLoading} error={strategies.isError} empty={!strategies.isLoading && !strategies.isError && (strategies.data?.length ?? 0) === 0} onRetry={() => strategies.refetch()} loadingText="正在读取策略定义…" emptyTitle="没有发布的策略定义" /> : null}
    {strategies.data ? <Text style={styles.intro}>这里展示后端已发布的策略定义，不代表你的账号已经具备执行条件。</Text> : null}
    <View style={styles.list}>{strategies.data?.map((strategy, index) => {
      const copy = PLAN_STRATEGIES.find((item) => item.key === strategy.key);
      return <Pressable accessibilityRole="button" key={strategy.key} onPress={() => router.push(`/strategies/${strategy.key}` as never)} style={styles.row}>
        <View style={styles.icon}><Ionicons name={index % 2 === 0 ? 'shield-checkmark-outline' : 'options-outline'} size={21} color={colors.primary} /></View>
        <View style={styles.copy}><Text style={styles.title}>{strategy.label}</Text><Text style={styles.detail}>{copy?.consumerLabel ?? '按规则帮助管理计划'}</Text><Text style={styles.meta}>定义版本 v{strategy.revision} · {strategy.status === 'ACTIVE' ? '已发布' : '当前未发布'}</Text></View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>;
    })}</View>
  </RuntimeDetailScreen>;
}
const styles = StyleSheet.create({ intro: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, lineHeight: 19 }, list: { marginTop: spacing.md, gap: spacing.sm }, row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.md }, icon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3 }, meta: { ...typography.caption, color: colors.textMuted, marginTop: 4 } });
