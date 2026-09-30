import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { colors, radius, spacing, typography } from '../../src/design';
import { displayTime, provenanceMethodLabel, shortHash } from '../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../src/runtime-details-ui';

interface TruthDetail {
  id: string; resourceKey: string; subjectKey: string; status: string; sourceReceiptId: string; verifiedBy: string; verifiedAt: string; currentVersionId: string | null;
  versions: Array<{ id: string; versionNumber: number; valueHash: string; verificationMethod: string; evidenceHash: string; createdAt: string }>;
  provenance: Array<{ truthRecordVersionId: string; providerKey: string; sourceMode: string; evidenceHash: string; observedAt: string; createdAt: string }>;
}
interface TruthPresentation { id: string; valueSummary: string | null; factKey: string; sourceLabel: string | null; observedAt: string | null }
interface EvidenceRow { id: string; evidenceHash: string }

export default function TruthDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((store) => store.token);
  const [showTechnical, setShowTechnical] = useState(false);
  const detail = useQuery({ queryKey: ['truth-record', id, token], queryFn: () => api<TruthDetail>(`/truth-records/${id}`, token), enabled: Boolean(id && token) });
  const presentations = useQuery({ queryKey: ['truth-records', token], queryFn: () => api<TruthPresentation[]>('/truth-records', token), enabled: Boolean(id && token) });
  const evidenceRows = useQuery({ queryKey: ['mobile-evidence', token], queryFn: () => api<EvidenceRow[]>('/mobile-evidence', token), enabled: Boolean(id && token) });
  const fact = detail.data;
  const presentation = presentations.data?.find((item) => item.id === id);
  return <RuntimeDetailScreen title="为什么相信这条信息" subtitle="查看真实来源、确认方式和记录时间" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在读取事实来源…" /> : null}
    {fact ? <>
      <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="shield-checkmark-outline" size={25} color={colors.primary} /></View><View style={styles.heroCopy}><Text style={styles.heroTitle}>{fact.provenance.length > 0 ? '这条信息有可追溯来源' : '这条信息有确认记录'}</Text><Text style={styles.heroDescription}>由 {provenanceMethodLabel(fact.verifiedBy)} 确认 · {displayTime(fact.verifiedAt)}</Text></View></View>
      <RuntimeSection title="信息从哪里来"><RuntimeCard>{fact.provenance.length === 0 ? <RuntimeText>尚无可安全展示的来源链；不会把缺失来源补成已验证。</RuntimeText> : fact.provenance.map((item) => {
        const evidence = evidenceRows.data?.find((row) => row.evidenceHash === item.evidenceHash);
        return <View key={`${item.truthRecordVersionId}-${item.evidenceHash}`} style={styles.source}><Ionicons name="layers-outline" size={19} color={colors.primary} /><View style={styles.sourceCopy}><Text style={styles.sourceTitle}>{item.providerKey}</Text><Text style={styles.sourceMeta}>{item.sourceMode} · {displayTime(item.observedAt)}</Text></View>{evidence ? <Pressable accessibilityRole="button" onPress={() => router.push(`/evidence/${evidence.id}` as never)}><Text style={styles.sourceAction}>查看证据</Text></Pressable> : null}</View>;
      })}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="确认与时效"><RuntimeCard>{presentations.isLoading ? <RuntimeText>正在读取已验证的事实摘要…</RuntimeText> : presentations.isError ? <RuntimeText>事实摘要暂时无法读取。</RuntimeText> : presentation ? <><RuntimeKeyValue label="事实" value={presentation.valueSummary || presentation.factKey} /><RuntimeKeyValue label="来源" value={presentation.sourceLabel || '来源未标注'} /><RuntimeKeyValue label="观察时间" value={presentation.observedAt ? displayTime(presentation.observedAt) : '时间未记录'} /><RuntimeKeyValue label="有效期" value="当前事实未声明有效期" /></> : <RuntimeText>这条记录目前不在已验证事实列表中；不会将历史记录当作当前事实。</RuntimeText>}<RuntimeKeyValue label="资源类型" value={fact.resourceKey} /><RuntimeKeyValue label="主体" value={fact.subjectKey} /><RuntimeKeyValue label="版本选择" value={fact.versions.length > 1 ? '存在历史版本，当前版本由运行时选定' : '只有一个已记录版本'} /><RuntimeKeyValue label="冲突来源" value="接口未提供独立冲突记录" /><RuntimeKeyValue label="确认方式" value={provenanceMethodLabel(fact.verifiedBy)} /><RuntimeKeyValue label="确认时间" value={displayTime(fact.verifiedAt)} last /></RuntimeCard></RuntimeSection>
      <RuntimeSection title="技术证据"><Pressable accessibilityRole="button" accessibilityState={{ expanded: showTechnical }} onPress={() => setShowTechnical(!showTechnical)} style={styles.disclosure}><Text style={styles.disclosureText}>{showTechnical ? '收起版本与哈希' : '查看版本与证据哈希'}</Text><Ionicons name={showTechnical ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} /></Pressable>{showTechnical ? <RuntimeCard>{fact.versions.length === 0 ? <RuntimeText>没有可显示的版本证据。</RuntimeText> : fact.versions.map((version) => <RuntimeCard key={version.id} title={`版本 ${version.versionNumber}`}><RuntimeKeyValue label="验证方式" value={provenanceMethodLabel(version.verificationMethod)} /><RuntimeKeyValue label="值哈希" value={shortHash(version.valueHash)} /><RuntimeKeyValue label="证据哈希" value={shortHash(version.evidenceHash)} /><RuntimeKeyValue label="记录时间" value={displayTime(version.createdAt)} last /></RuntimeCard>)}</RuntimeCard> : null}</RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  hero: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, flexDirection: 'row', gap: spacing.md },
  heroIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1 }, heroTitle: { ...typography.section, color: colors.text }, heroDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  source: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, sourceCopy: { flex: 1 }, sourceTitle: { ...typography.bodyStrong, color: colors.text }, sourceMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 }, sourceAction: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  disclosure: { minHeight: 42, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, disclosureText: { ...typography.bodyStrong, color: colors.primary },
});
