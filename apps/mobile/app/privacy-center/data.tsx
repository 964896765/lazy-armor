import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { CONSUMER_DATA_DOMAINS, consumerDataDomainSubtitle, presentTruthDataRow } from '../../src/privacy-presenter';
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
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'全部' | '文件' | '数据' | '知识'>('全部');
  const truth = useQuery({ queryKey: ['privacy-truth-records', token], queryFn: () => api<TruthRecordRow[]>('/truth-records', token), enabled: Boolean(token) });
  const presented = (truth.data ?? []).map(presentTruthDataRow);
  const normalized = search.trim().toLocaleLowerCase('zh-CN');
  const visible = presented.filter((row) => {
    const source = (truth.data ?? []).find((item) => item.id === row.id);
    const type = source?.resourceType ?? '';
    const matchesCategory = category === '全部' || (category === '文件' ? /file|document|attachment|upload/i.test(type) : category === '知识' ? /knowledge|note|page|repository|learning/i.test(type) : !/file|document|attachment|upload|knowledge|note|page|repository|learning/i.test(type));
    return matchesCategory && (!normalized || `${row.factLabel} ${row.valueSummary} ${row.sourceLabel}`.toLocaleLowerCase('zh-CN').includes(normalized));
  });

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <View style={local.header}><Pressable onPress={() => router.back()} accessibilityLabel="返回" style={local.back}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable><Text style={local.pageTitle}>数据与文件</Text><Pressable onPress={() => router.push('/file-import' as Href)} accessibilityLabel="上传文件" style={local.addButton}><Ionicons name="add" size={23} color={colors.text} /></Pressable></View>
      <Text style={local.subtitle}>管理你的文件、数据与知识，让我更好地理解和使用。</Text>
      <View style={local.searchBox}><Ionicons name="search-outline" size={18} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} placeholder="搜索文件、数据或知识…" placeholderTextColor={colors.textMuted} style={local.searchInput} /></View>
      <View style={local.tabs}>{(['全部', '文件', '数据', '知识'] as const).map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[local.tab, category === item && local.tabSelected]}><Text style={[local.tabText, category === item && local.tabTextSelected]}>{item}</Text></Pressable>)}</View>
        {truth.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {truth.isError ? <View style={local.group}><Text style={local.groupTitle}>暂时无法读取数据</Text><Text style={local.groupSubtitle}>不会把网络错误显示成“没有数据”。请稍后重新进入。</Text></View> : null}
        {!token ? <View style={local.group}><Text style={local.groupTitle}>登录后查看</Text><Text style={local.groupSubtitle}>数据来源和使用计划只会显示给你本人。</Text></View> : null}
        {truth.data ? CONSUMER_DATA_DOMAINS.map((domain) => {
          const rows = visible.filter((row) => row.domain === domain);
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
        }) : null}
        {truth.data && visible.length === 0 && !truth.isLoading && !truth.isError ? (
          <Text style={local.empty}>{search ? '没有匹配的数据。' : '这个分类还没有已验证的数据。连接来源或上传文件后，这里会显示真实内容。'}</Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.push('/file-import' as Href)} style={({ pressed }) => [local.uploadAction, pressed && local.pressed]}><Ionicons name="cloud-upload-outline" size={20} color={colors.text} /><Text style={local.uploadText}>上传文件</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>
        <Text style={local.footnote}>使用某条数据的计划，会在每条数据下方直接列出。</Text>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: 26, alignItems: 'flex-start' }, pageTitle: { ...typography.title, color: colors.text, flex: 1 },
  addButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 5, marginBottom: spacing.md },
  searchBox: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 6 },
  tabs: { flexDirection: 'row', gap: 5, marginTop: spacing.md, marginBottom: spacing.lg },
  tab: { flex: 1, minHeight: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  tabSelected: { backgroundColor: colors.text }, tabText: { ...typography.caption, color: colors.textSecondary }, tabTextSelected: { color: '#FFF' },
  uploadAction: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  uploadText: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  group: { marginBottom: spacing.lg },
  groupTitle: { ...typography.bodyStrong, color: colors.text, marginBottom: 2 },
  groupSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  list: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pressed: { backgroundColor: colors.accentSoft },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  usage: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  verified: { ...typography.label, color: colors.success },
  empty: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md },
  footnote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg },
});
