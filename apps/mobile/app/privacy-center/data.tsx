import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { CONSUMER_DATA_DOMAINS, consumerDataDomainSubtitle, presentTruthDataRow } from '../../src/privacy-presenter';
import { ShellPage } from '../../src/shell';
import { colors, radius, spacing, typography } from '../../src/design';

interface TruthRecordRow {
  id: string;
  factKey: string;
  resourceType?: string | null;
  valueSummary?: string | null;
  sourceLabel?: string | null;
  observedAt?: string | null;
  realityLevel?: string | null;
  usedByPlanNames?: string[];
}

export default function PrivacyDataPage() {
  const token = useAuthStore((state) => state.token);
  const truth = useQuery({ queryKey: ['privacy-truth-records', token], queryFn: () => api<TruthRecordRow[]>('/truth-records', token), enabled: Boolean(token) });
  const presented = (truth.data ?? []).map(presentTruthDataRow);

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="我的数据" subtitle="按领域查看装甲已经验证的事实。这里不展示数据库表，只展示对你有意义的字段与来源。">
        {truth.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {CONSUMER_DATA_DOMAINS.map((domain) => {
          const rows = presented.filter((row) => row.domain === domain);
          if (rows.length === 0) return null;
          return (
            <View key={domain} style={local.group}>
              <Text style={local.groupTitle}>{domain}</Text>
              <Text style={local.groupSubtitle}>{consumerDataDomainSubtitle(domain)}</Text>
              <View style={local.list}>
                {rows.map((row, index) => (
                  <Pressable key={row.id} accessibilityRole="button" onPress={() => router.push(`/truth/${row.id}` as Href)} style={({ pressed }) => [local.row, index < rows.length - 1 && local.divider, pressed && local.pressed]}>
                    <View style={local.icon}><Ionicons name="document-text-outline" size={18} color={colors.primary} /></View>
                    <View style={local.copy}>
                      <Text style={local.title}>{row.factLabel}</Text>
                      <Text style={local.detail}>{row.valueSummary} · {row.sourceLabel} · {row.observedAt}</Text>
                      <Text style={local.usage}>{row.usedByPlans}</Text>
                    </View>
                    <Text style={local.verified}>{row.realityLabel}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
        {(truth.data?.length ?? 0) === 0 && !truth.isLoading ? (
          <Text style={local.empty}>还没有已验证的数据。连接来源并创建计划后，这里会出现你关心的字段。</Text>
        ) : null}
        <Text style={local.footnote}>使用某条数据的计划，会在每条数据下方直接列出。</Text>
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  group: { marginBottom: spacing.lg },
  groupTitle: { ...typography.bodyStrong, color: colors.text, marginBottom: 2 },
  groupSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  list: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E3E7E4', overflow: 'hidden' },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pressed: { backgroundColor: '#F7F8FA' },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  icon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  usage: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  verified: { ...typography.label, color: colors.success },
  empty: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md },
  footnote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg },
});
