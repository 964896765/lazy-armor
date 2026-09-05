import { useQuery } from '@tanstack/react-query';
import { CANONICAL_DOMAIN_CATALOG, DOMAIN_GROUPS, type DomainGroupKey, canonicalPlanDomain } from '@lazy-armor/plan-schema/mobile';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { EmptyState, Surface, colors, radius, spacing, typography } from '../src/design';

interface PlanDomainSummary { id: string; domain: string | null }

const GROUP_ORDER: DomainGroupKey[] = ['money', 'life', 'work', 'things'];

export default function DomainsDirectory() {
  const token = useAuthStore((store) => store.token);
  const plans = useQuery({
    queryKey: ['domain-directory-plans', token],
    queryFn: () => api<PlanDomainSummary[]>('/plans', token),
    enabled: Boolean(token),
  });
  const countFor = (domain: string) => (plans.data ?? []).filter((plan) => canonicalPlanDomain(plan.domain) === domain).length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>懒人装甲</Text>
          <Text style={styles.title}>我的领域</Text>
          <Text style={styles.subtitle}>先看你的真实生活对象，再安排需要持续帮你留意的事。</Text>
        </View>
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理领域…</Text></View> : null}
        {!token ? <Surface><EmptyState icon="◆" title="登录后查看你的领域" description="计划、资源与动态只会显示在你的账号内。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {token ? GROUP_ORDER.map((group) => {
          const definition = DOMAIN_GROUPS[group];
          const domains = CANONICAL_DOMAIN_CATALOG.filter((domain) => domain.group === group);
          return (
            <View key={group} style={styles.group}>
              <Text style={styles.groupTitle}>{definition.label}</Text>
              <Text style={styles.groupDescription}>{definition.description}</Text>
              <Surface style={styles.domainList}>
                {domains.map((domain, index) => <DomainRow key={domain.key} domain={domain} count={countFor(domain.key)} last={index === domains.length - 1} />)}
              </Surface>
            </View>
          );
        }) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DomainRow({ domain, count, last }: { domain: typeof CANONICAL_DOMAIN_CATALOG[number]; count: number; last: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/domains/${domain.key}` as never)} style={({ pressed }) => [styles.domainRow, !last && styles.domainDivider, pressed && styles.pressed]}>
      <View style={[styles.domainIcon, groupIconStyle(domain.group)]}><Text style={styles.domainIconText}>{domainSymbol(domain.key)}</Text></View>
      <Text style={styles.domainLabel}>{domain.label}</Text>
      {count > 0 ? <View style={styles.count}><Text style={styles.countText}>{count}</Text></View> : <Text style={styles.emptyCount}>未设置</Text>}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function domainSymbol(key: string) {
  const symbols: Record<string, string> = { finance: '¥', life: '日', family: '家', health: '健', social: '友', pet: '宠', housing: '住', travel: '行', entertainment: '乐', work: '工', operations: '运', content: '内', study: '学', identity_docs: '证', government: '政', legal_contract: '约', vehicle: '车', device: '设', digital_account: '账' };
  return symbols[key] ?? '◆';
}

function groupIconStyle(group: DomainGroupKey) {
  if (group === 'money') return styles.iconMoney;
  if (group === 'work') return styles.iconWork;
  if (group === 'things') return styles.iconThings;
  return styles.iconLife;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.page, paddingTop: spacing.xl, paddingBottom: 48 },
  header: { marginBottom: spacing.xxl },
  eyebrow: { ...typography.label, color: colors.primary, letterSpacing: 1 },
  title: { ...typography.display, color: colors.text, marginTop: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, maxWidth: 335 },
  loading: { alignItems: 'center', paddingVertical: 56, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  group: { marginTop: spacing.xxl },
  groupTitle: { ...typography.section, color: colors.text },
  groupDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  domainList: { padding: 0, overflow: 'hidden' },
  domainRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md },
  domainDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  domainIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconMoney: { backgroundColor: colors.accentSoft },
  iconLife: { backgroundColor: colors.successSoft },
  iconWork: { backgroundColor: '#E8EEF2' },
  iconThings: { backgroundColor: colors.warningSoft },
  domainIconText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  domainLabel: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  count: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  countText: { ...typography.label, color: colors.surface, fontSize: 11 },
  emptyCount: { ...typography.caption, color: colors.textMuted },
  chevron: { color: colors.textMuted, fontSize: 25, fontWeight: '300' },
  pressed: { backgroundColor: colors.pressed },
});
