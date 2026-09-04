import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ActionButton, EmptyState, Surface, colors, spacing, typography } from '../src/design';

interface TruthRecord { id: string; resourceKey: string; status: 'verified'; sourceReceiptId: string; verifiedBy: string; verifiedAt: string; revokedAt: string | null; currentVersionId: string | null }

export default function TruthStorePage() {
  const token = useAuthStore((store) => store.token);
  const facts = useQuery({ queryKey: ['truth-records', token], queryFn: () => api<TruthRecord[]>('/truth-records', token), enabled: Boolean(token) });
  return <SafeAreaView style={styles.safeArea} edges={['top']}><ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.title}>已验证事实</Text><Text style={styles.subtitle}>这里仅显示你明确确认过、可追溯到最小化来源收据的品牌中立资源。未确认线索不会显示为事实。</Text></View>
    {!token ? <Surface><EmptyState icon="▣" title="请先登录" description="登录后可以查看自己的已验证事实。" action={{ label: '去登录', onPress: () => router.push('/auth/login') }} /></Surface> : null}
    {token && facts.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
    {token && facts.isError ? <Surface><EmptyState icon="!" title="暂时无法读取事实" description="没有显示任何示例数据，也没有修改你的记录。" action={{ label: '返回通知来源', onPress: () => router.replace('/connections/notification-sources') }} /></Surface> : null}
    {token && !facts.isLoading && !facts.isError && (facts.data?.length ?? 0) === 0 ? <Surface><EmptyState icon="▣" title="还没有已验证事实" description="先为已添加应用单独启用通知来源；收到的线索需要由你确认后才会显示在这里。" action={{ label: '管理通知来源', onPress: () => router.push('/connections/notification-sources') }} /></Surface> : null}
    <View style={styles.list}>{facts.data?.map((fact) => <Surface key={fact.id}><Text style={styles.name}>{resourceLabel(fact.resourceKey)}</Text><Text style={styles.detail}>状态：已验证</Text><Text style={styles.detail}>确认方式：{fact.verifiedBy === 'user_confirmation' ? '你的明确确认' : '已验证方式'}</Text><Text style={styles.detail}>确认时间：{formatTime(fact.verifiedAt)}</Text><Text style={styles.detail}>事实编号：{fact.id.slice(0, 12)}…</Text></Surface>)}</View>
    {token ? <View style={styles.action}><ActionButton label="返回通知来源" tone="quiet" onPress={() => router.replace('/connections/notification-sources')} /></View> : null}
  </ScrollView></SafeAreaView>;
}

function resourceLabel(resource: string) { return resource === 'mobile.billing.transaction' ? '移动账单交易' : '已验证资源'; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString('zh-CN'); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.page, paddingBottom: 72 }, header: { marginBottom: spacing.xxl }, title: { ...typography.display, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 22 }, list: { gap: spacing.md }, name: { ...typography.cardTitle, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }, action: { alignItems: 'center', marginTop: spacing.xxl },
});
