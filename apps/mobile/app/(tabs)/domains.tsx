import { useQuery } from '@tanstack/react-query';
import { CANONICAL_DOMAIN_CATALOG, CANONICAL_SCENARIOS, DOMAIN_GROUPS, PLAN_STRATEGIES, type DomainGroupKey, canonicalPlanDomain, scenariosForDomain } from '@lazy-armor/plan-schema/mobile';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

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
        <WorkspaceHeader title="领域与计划" subtitle="19 个领域 · 96 个标准场景" />
        <View style={styles.summary}>
          <SummaryStat icon="grid-outline" value={CANONICAL_DOMAIN_CATALOG.length} label="领域" tone="orange" />
          <SummaryStat icon="layers-outline" value={CANONICAL_SCENARIOS.length} label="场景" tone="green" />
          <SummaryStat icon="options-outline" value={PLAN_STRATEGIES.length} label="管理方式" tone="violet" />
        </View>
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理领域…</Text></View> : null}
        {!token ? <InlineState title="登录后查看领域" description="计划与生活资料只会显示在你的账号内。" action="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
        {token ? GROUP_ORDER.map((group) => {
          const definition = DOMAIN_GROUPS[group];
          const domains = CANONICAL_DOMAIN_CATALOG.filter((domain) => domain.group === group);
          return (
            <View key={group} style={styles.group}>
              <Text style={styles.groupTitle}>{definition.label}</Text>
              <Text style={styles.groupDescription}>{definition.description}</Text>
              <View style={styles.domainList}>
                {domains.map((domain, index) => <DomainRow key={domain.key} domain={domain} count={countFor(domain.key)} last={index === domains.length - 1} />)}
              </View>
            </View>
          );
        }) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InlineState({ title, description, action, onPress }: { title: string; description: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineState}><View style={styles.inlineCopy}><Text style={styles.inlineTitle}>{title}</Text><Text style={styles.inlineDescription}>{description}</Text></View><Pressable onPress={onPress} style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}><Text style={styles.inlineActionText}>{action}</Text></Pressable></View>;
}

function SummaryStat({ icon, value, label, tone }: { icon: ComponentProps<typeof Ionicons>['name']; value: number; label: string; tone: 'orange' | 'green' | 'violet' }) {
  return <View style={styles.summaryItem}><View style={[styles.summaryIcon, styles[`${tone}Icon`]]}><Ionicons name={icon} size={17} color={styles[`${tone}Text`].color} /></View><View><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View></View>;
}

function DomainRow({ domain, count }: { domain: typeof CANONICAL_DOMAIN_CATALOG[number]; count: number; last: boolean }) {
  const scenarios = scenariosForDomain(domain.key);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/domains/${domain.key}` as never)} style={({ pressed }) => [styles.domainRow, pressed && styles.pressed]}>
      <View style={[styles.domainIcon, groupIconStyle(domain.group)]}><Ionicons name={domainIcon(domain.key)} size={18} color={colors.primary} /></View>
      <View style={styles.domainCopy}><Text style={styles.domainLabel}>{domain.label}</Text><Text style={styles.domainMeta}>{scenarios.length} 个场景{count > 0 ? ` · ${count} 个计划` : ''}</Text></View>
      <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
    </Pressable>
  );
}

function domainIcon(key: string): ComponentProps<typeof Ionicons>['name'] {
  const icons: Record<string, ComponentProps<typeof Ionicons>['name']> = {
    finance: 'wallet-outline', life: 'calendar-outline', family: 'people-outline', health: 'heart-outline', social: 'chatbubbles-outline', pet: 'paw-outline', housing: 'home-outline', travel: 'airplane-outline', entertainment: 'game-controller-outline', work: 'briefcase-outline', operations: 'analytics-outline', content: 'create-outline', study: 'school-outline', identity_docs: 'id-card-outline', government: 'business-outline', legal_contract: 'document-text-outline', vehicle: 'car-outline', device: 'hardware-chip-outline', digital_account: 'shield-checkmark-outline',
  };
  return icons[key] ?? 'ellipse-outline';
}

function groupIconStyle(group: DomainGroupKey) {
  if (group === 'money') return styles.iconMoney;
  if (group === 'work') return styles.iconWork;
  if (group === 'things') return styles.iconThings;
  return styles.iconLife;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 32 },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  summaryIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  orangeIcon: { backgroundColor: '#FFF0E7' }, greenIcon: { backgroundColor: colors.successSoft }, violetIcon: { backgroundColor: '#F0EBFF' },
  orangeText: { color: '#F47B32' }, greenText: { color: colors.primary }, violetText: { color: '#7A5AF8' },
  summaryValue: { ...typography.bodyStrong, color: colors.text, lineHeight: 16 }, summaryLabel: { fontSize: 8, lineHeight: 10, color: colors.textMuted },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  inlineState: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineCopy: { flex: 1 },
  inlineTitle: { ...typography.bodyStrong, color: colors.text },
  inlineDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  inlineAction: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  inlineActionText: { ...typography.label, color: colors.surface },
  group: { marginTop: spacing.lg },
  groupTitle: { ...typography.section, color: colors.text },
  groupDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  domainList: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderLeftWidth: 1, borderColor: colors.border },
  domainRow: { width: '50%', minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.sm, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  domainIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  iconMoney: { backgroundColor: colors.accentSoft },
  iconLife: { backgroundColor: colors.successSoft },
  iconWork: { backgroundColor: '#E8EEF2' },
  iconThings: { backgroundColor: colors.warningSoft },
  domainCopy: { flex: 1, minWidth: 0 }, domainLabel: { ...typography.bodyStrong, color: colors.text }, domainMeta: { fontSize: 8, lineHeight: 11, color: colors.textMuted, marginTop: 2 },
  pressed: { backgroundColor: colors.pressed },
});
