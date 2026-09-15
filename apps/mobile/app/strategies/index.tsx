import { useQuery } from '@tanstack/react-query';
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
  return <RuntimeDetailScreen title="策略定义" subtitle="版本化产品策略；不代表当前一定可运行">
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={strategies.isLoading} error={strategies.isError} empty={!strategies.isLoading && !strategies.isError && (strategies.data?.length ?? 0) === 0} onRetry={() => strategies.refetch()} loadingText="正在读取策略定义…" emptyTitle="没有发布的策略定义" /> : null}
    <View style={styles.list}>{strategies.data?.map((strategy) => <Pressable accessibilityRole="button" key={strategy.key} onPress={() => router.push(`/strategies/${strategy.key}` as never)} style={styles.row}><View style={styles.copy}><Text style={styles.title}>{strategy.label}</Text><Text style={styles.detail}>{strategy.key} · v{strategy.revision}</Text><Text style={styles.detail}>{strategy.defaultActionMode} · {strategy.triggerModes.join(' / ')}</Text></View><Text style={styles.ceiling}>{strategy.allowedAutomationCeiling}</Text></Pressable>)}</View>
  </RuntimeDetailScreen>;
}
const styles = StyleSheet.create({ list: { marginTop: spacing.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.md, overflow: 'hidden' }, row: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, copy: { flex: 1 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3 }, ceiling: { ...typography.label, color: colors.primary, backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 } });
