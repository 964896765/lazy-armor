import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, typography } from '../../src/design';
import { planVisualIcon } from '../../src/plan-presenter';
import { LoginRequired, RuntimeDetailScreen, RuntimeLoadState } from '../../src/runtime-details-ui';

interface TemplateSummary {
  key: string;
  domain: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  templateVersion: string;
  status: 'published';
  automationLevel: string;
  requiredConnectors: string[];
}

export default function TemplatesIndexPage() {
  const token = useAuthStore((store) => store.token);
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<string | null>(null);
  const templates = useQuery({ queryKey: ['templates', token], queryFn: () => api<TemplateSummary[]>('/templates', token), enabled: Boolean(token) });
  const domains = [...new Set((templates.data ?? []).map((item) => item.domain))];
  const shown = (templates.data ?? []).filter((item) => (!domain || item.domain === domain) && `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <RuntimeDetailScreen title="计划方案" subtitle="">
    {!token ? <LoginRequired /> : null}
    {token ? <><View style={styles.search}><Ionicons name="search-outline" size={20} color={colors.textSecondary} /><TextInput accessibilityLabel="搜索计划方案" placeholder="搜索计划方案" placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} style={styles.input} /></View><View style={styles.filters}>{[null, ...domains].map((key) => <Pressable key={key ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: domain === key }} onPress={() => setDomain(key)} style={[styles.filter, domain === key && styles.selected]}><Text style={[styles.filterText, domain === key && styles.selectedText]}>{key ? domainLabel(key) : '全部'}</Text></Pressable>)}</View></> : null}
    {token ? <RuntimeLoadState loading={templates.isLoading} error={templates.isError} empty={!templates.isLoading && !templates.isError && (templates.data?.length ?? 0) === 0} onRetry={() => templates.refetch()} loadingText="正在读取计划方案…" emptyTitle="还没有可用方案" /> : null}
    {token && !templates.isError && !templates.isLoading ? <><Text style={styles.heading}>可选方案 · {shown.length}</Text><View style={styles.grid}>{shown.map((template) => <Pressable key={template.key} accessibilityRole="button" accessibilityLabel={`查看${template.name}`} onPress={() => router.push(`/templates/${template.key}` as never)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}><View style={styles.top}><View style={styles.icon}><Ionicons name={planVisualIcon(template.name)} size={21} color={colors.primary} /></View><View style={styles.cardCopy}><Text style={styles.name}>{template.name}</Text><Text style={styles.tag}>{domainLabel(template.domain)}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.primary} /></View></Pressable>)}</View>{shown.length === 0 && (templates.data?.length ?? 0) > 0 ? <Text style={styles.description}>没有符合当前条件的方案。</Text> : null}</> : null}
  </RuntimeDetailScreen>;
}

function domainLabel(key: string) {
  const labels: Record<string, string> = { billing: '账单', life: '生活', finance: '财务', daily_life: '日常生活', family: '家庭', work: '工作', content: '内容', vehicle: '车辆', device: '设备', digital_account: '数字账户', health: '健康', study: '学习', travel: '出行', housing: '住房', social: '社交', pet: '宠物', entertainment: '娱乐', government: '政务', legal_contract: '合同法律', operations: '运营', identity_docs: '证件事务' };
  return labels[key] ?? key;
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 12 },
  input: { ...typography.body, flex: 1, minWidth: 0, color: colors.text, paddingVertical: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 16 },
  filter: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.caption, color: colors.textSecondary }, selectedText: { color: '#FFFFFF' },
  heading: { ...typography.section, color: colors.text, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { flexGrow: 1, flexBasis: 220, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0 },
  tag: { ...typography.caption, color: colors.primary, flexShrink: 1, marginTop: 1 },
  name: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.body, color: colors.textSecondary, marginTop: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  action: { ...typography.bodyStrong, color: colors.primary },
  note: { flexDirection: 'row', gap: 8, padding: 14, borderRadius: 14, marginTop: 20, backgroundColor: colors.accentSoft },
  noteText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
});
