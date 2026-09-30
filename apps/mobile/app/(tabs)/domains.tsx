import { useQuery } from '@tanstack/react-query';
import { CANONICAL_DOMAIN_CATALOG, DOMAIN_GROUPS, type DomainGroupKey, canonicalPlanDomain, scenariosForDomain } from '@lazy-armor/plan-schema/mobile';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';

interface PlanDomainSummary { id: string; domain: string | null }

const GROUP_ORDER: DomainGroupKey[] = ['money', 'life', 'work', 'things'];

export default function DomainsDirectory() {
  const { group } = useLocalSearchParams<{ group?: string }>();
  const selectedGroup = typeof group === 'string' && GROUP_ORDER.includes(group as DomainGroupKey) ? group as DomainGroupKey : null;
  const token = useAuthStore((store) => store.token);
  const plans = useQuery({
    queryKey: ['domain-directory-plans', token],
    queryFn: () => api<PlanDomainSummary[]>('/plans', token),
    enabled: Boolean(token),
  });
  const countFor = (domain: string) => (plans.data ?? []).filter((plan) => canonicalPlanDomain(plan.domain) === domain).length;

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{selectedGroup ? DOMAIN_GROUPS[selectedGroup].label : '领域'}</Text>
          {selectedGroup ? <Pressable accessibilityRole="button" onPress={() => router.replace('/domains' as never)} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}><Text style={styles.headerActionText}>全部</Text></Pressable> : null}
        </View>
        {plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>正在整理领域…</Text></View> : null}
        {!token ? <InlineState title="目录可以浏览" description="登录后才会读取你的计划、授权与场景可用状态。" action="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
        {GROUP_ORDER.filter((item) => !selectedGroup || item === selectedGroup).map((group) => {
          const definition = DOMAIN_GROUPS[group];
          const domains = CANONICAL_DOMAIN_CATALOG.filter((domain) => domain.group === group);
          return (
            <View key={group} style={styles.group}>
              <Text style={styles.sectionHeader}>{definition.label}</Text>
              <View style={styles.list}>
                {domains.map((domain, index) => <DomainRow key={domain.key} domain={domain} count={countFor(domain.key)} last={index === domains.length - 1} />)}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function InlineState({ title, description, action, onPress }: { title: string; description: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineState}><View style={styles.inlineCopy}><Text style={styles.inlineTitle}>{title}</Text><Text style={styles.inlineDescription}>{description}</Text></View><Pressable onPress={onPress} style={({ pressed }) => [styles.inlineAction, pressed && styles.pressed]}><Text style={styles.inlineActionText}>{action}</Text></Pressable></View>;
}

function DomainRow({ domain, count, last }: { domain: typeof CANONICAL_DOMAIN_CATALOG[number]; count: number; last: boolean }) {
  const scenarios = scenariosForDomain(domain.key);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/domains/${domain.key}` as never)} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}>
      <View style={styles.icon}><Ionicons name={domainIcon(domain.key)} size={20} color={colors.text} /></View>
      <View style={styles.copy}><Text style={styles.label}>{domain.label}</Text><Text numberOfLines={1} style={styles.meta}>{scenarios.length} 个场景{count > 0 ? ` · ${count} 个计划` : ''}</Text></View>
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </Pressable>
  );
}

function domainIcon(key: string): ComponentProps<typeof Ionicons>['name'] {
  const icons: Record<string, ComponentProps<typeof Ionicons>['name']> = {
    finance: 'wallet-outline', life: 'calendar-outline', family: 'people-outline', health: 'heart-outline', social: 'chatbubbles-outline', pet: 'paw-outline', housing: 'home-outline', travel: 'airplane-outline', entertainment: 'game-controller-outline', work: 'briefcase-outline', operations: 'analytics-outline', content: 'create-outline', study: 'school-outline', identity_docs: 'id-card-outline', government: 'business-outline', legal_contract: 'document-text-outline', vehicle: 'car-outline', device: 'hardware-chip-outline', digital_account: 'shield-checkmark-outline',
  };
  return icons[key] ?? 'ellipse-outline';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 32 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.pageTitle, color: colors.text },
  headerAction: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.accentSoft },
  headerActionText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  inlineState: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  inlineCopy: { flex: 1 },
  inlineTitle: { ...typography.bodyStrong, color: colors.text },
  inlineDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  inlineAction: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  inlineActionText: { ...typography.label, color: colors.surface },
  group: { marginTop: spacing.lg },
  sectionHeader: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', marginBottom: spacing.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  copy: { flex: 1, minWidth: 0 },
  label: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  pressed: { opacity: 0.58 },
});
