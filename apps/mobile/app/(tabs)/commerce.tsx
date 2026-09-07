import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

interface CommercePlan {
  id: string;
  status: string;
  name: string | null;
  templateKey: string | null;
  currentVersion: { name: string; domain: string } | null;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string } | null;
}

const sections = [
  { key: 'recommendations', label: '推荐', description: '根据你的计划、库存与偏好整理' },
  { key: 'supplies', label: '补给', description: '家庭、宠物、车辆与设备耗材' },
  { key: 'frequent', label: '常买', description: '保留你的复购习惯与规格' },
  { key: 'inventory', label: '我的库存', description: '查看数量与预计可用时间' },
  { key: 'services', label: '服务', description: '维修、保养、安装等服务型供给' },
  { key: 'orders', label: '订单', description: '已确认订单与物流进展' },
] as const;

export default function CommerceSpace() {
  const token = useAuthStore((store) => store.token);
  const plans = useQuery({
    queryKey: ['commerce-plans', token],
    queryFn: () => api<CommercePlan[]>('/plans', token),
    enabled: Boolean(token),
  });
  const prepared = (plans.data ?? []).filter((plan) => plan.templateKey === 'family-supply-reminder' || plan.latestExecution?.resultSummary?.includes('待购买'));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <WorkspaceHeader title="懒人商城" subtitle="根据你的计划准备补给建议" />

        {!token ? <Surface><EmptyState icon="bag-handle-outline" title="登录后查看你的补给与待购买事项" description="商城只会使用你允许的计划与资源信息。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理补给事项…</Text></View> : null}
        {token && !plans.isLoading ? (
          <>
            <View style={styles.preparedHeader}>
              <View><Text style={styles.sectionTitle}>待购买</Text><Text style={styles.sectionDescription}>计划已准备，等待你确认</Text></View>
              <Pressable accessibilityRole="button" onPress={() => router.push('/plans' as never)} style={({ pressed }) => pressed && styles.actionPressed}><Text style={styles.textAction}>查看计划</Text></Pressable>
            </View>
            {prepared.length > 0 ? (
              <View style={styles.preparedList}>{prepared.slice(0, 3).map((plan) => <PreparedItem key={plan.id} plan={plan} />)}</View>
            ) : (
              <View style={styles.quiet}><Text style={styles.quietText}>还没有待购买事项。设备或家庭补给计划发现需要采购时，会自然出现在这里。</Text></View>
            )}

            <Text style={styles.sectionTitle}>商城目录</Text>
            <View style={styles.directory}>{sections.map((section) => <DirectoryRow key={section.key} label={section.label} description={section.description} />)}</View>
            <View style={styles.safetyNote}>
              <Text style={styles.safetyTitle}>下单始终需要你的确认</Text>
              <Text style={styles.safetyCopy}>真实商品、价格、支付和物流必须来自已连接且可验证的服务。支付、转账和真实下单属于高风险操作，不能在结果未知时自动重试。</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PreparedItem({ plan }: { plan: CommercePlan }) {
  const name = plan.name ?? plan.currentVersion?.name ?? '补给计划';
  const detail = plan.latestExecution?.resultSummary ?? '已根据你的计划准备，等待你确认。';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/plans/${plan.id}` as never)} style={({ pressed }) => [styles.preparedItem, pressed && styles.pressed]}>
      <View style={styles.itemIcon}><Text style={styles.itemSymbol}>□</Text></View>
      <View style={styles.itemCopy}><Text style={styles.itemName}>{name}</Text><Text numberOfLines={2} style={styles.itemDetail}>{detail}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function DirectoryRow({ label, description }: { label: string; description: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/connections/add' as never)} style={({ pressed }) => [styles.directoryRow, pressed && styles.pressed]}>
      <View style={styles.directoryCopy}><Text style={styles.directoryLabel}>{label}</Text><Text style={styles.directoryDescription}>{description}</Text></View>
      <Text style={styles.directoryState}>准备中</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  loading: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  preparedHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.xs },
  sectionDescription: { ...typography.caption, color: colors.textSecondary },
  textAction: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  actionPressed: { opacity: 0.6 },
  preparedList: { backgroundColor: colors.surface },
  preparedItem: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  itemSymbol: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  itemCopy: { flex: 1, marginLeft: spacing.md },
  itemName: { ...typography.bodyStrong, color: colors.text },
  itemDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  quiet: { paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  quietText: { ...typography.body, color: colors.textSecondary },
  directory: { backgroundColor: colors.surface },
  directoryRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  directoryCopy: { flex: 1 },
  directoryLabel: { ...typography.bodyStrong, color: colors.text },
  directoryDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  directoryState: { ...typography.caption, color: colors.warning },
  chevron: { color: colors.textMuted, fontSize: 26, fontWeight: '300' },
  safetyNote: { marginTop: spacing.xxl, paddingLeft: spacing.md, paddingVertical: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.warning },
  safetyTitle: { ...typography.bodyStrong, color: colors.text },
  safetyCopy: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 19 },
  pressed: { backgroundColor: colors.pressed },
});
