import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { AttentionBell } from '../../src/attention-bell';
import { colors, radius, spacing, typography } from '../../src/design';
import { SPACE_FILTERS, TOTAL_SCENARIO_COUNT, buildScenarioSections, scenarioKeyOf, scenarioStateLabel, type ScenarioRow, type ScenarioSection, type SpaceFilter } from '../../src/scenario-canvas-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ScenarioPlanCount { scenarioKey: string; planCount: number }

export default function ScenarioCanvas() {
  const [query, setQuery] = useState('');
  const [space, setSpace] = useState<SpaceFilter>('all');
  const token = useAuthStore((store) => store.token);
  const sections = useMemo(() => buildScenarioSections({ space, query }), [space, query]);
  const planCounts = useQuery({
    queryKey: ['scenario-plan-counts', token],
    queryFn: () => api<ScenarioPlanCount[]>('/strategy-runtime/scenario-plan-counts', token),
    enabled: Boolean(token),
  });
  const countByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of planCounts.data ?? []) map.set(item.scenarioKey, item.planCount);
    return map;
  }, [planCounts.data]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>全部场景</Text>
          <AttentionBell />
        </View>
        <Text style={styles.subtitle}>懒人装甲能替你管理的 {TOTAL_SCENARIO_COUNT} 件事</Text>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索场景、计划、应用，或直接描述需求" placeholderTextColor={colors.textMuted} style={styles.searchInput} returnKeyType="search" />
        </View>
        <View style={styles.filters}>
          {SPACE_FILTERS.map((item) => (
            <Pressable key={item.key} accessibilityRole="button" onPress={() => setSpace(item.key)} style={[styles.filterChip, space === item.key && styles.filterChipActive]}>
              <Text style={[styles.filterText, space === item.key && styles.filterTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.productDomain}.${item.key}`}
        renderSectionHeader={({ section }) => <SectionHeader section={section} />}
        renderItem={({ item, section }) => <Row item={item} icon={section.icon} planCount={countByKey.get(scenarioKeyOf(item)) ?? 0} />}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>没有匹配的场景。换个关键词试试。</Text>}
      />
    </SafeAreaView>
  );
}

function SectionHeader({ section }: { section: ScenarioSection }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );
}

function Row({ item, icon, planCount }: { item: ScenarioRow; icon: string; planCount: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/domains/${item.productDomain}/${item.key}` as never)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowIcon}><Ionicons name={icon as IconName} size={18} color={colors.primary} /></View>
      <Text style={styles.rowLabel}>{item.label}</Text>
      <Text style={styles.rowState}>{scenarioStateLabel(item, planCount)}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  searchBox: { minHeight: 44, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, ...typography.body, color: colors.text, paddingVertical: 0 },
  filters: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  filterChip: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  filterTextActive: { color: '#FFFFFF', fontWeight: '700' },
  list: { paddingBottom: 48 },
  sectionHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.4 },
  sectionCount: { ...typography.label, color: colors.textMuted, backgroundColor: '#F1F4F3', borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.pressed },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  rowLabel: { flex: 1, ...typography.bodyStrong, color: colors.text },
  rowState: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingVertical: 48 },
});
