import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../../../src/auth-store';
import { getDeviceTaskEvidence } from '../../../src/device-task-client';
import { deviceTaskStages, deviceTaskStatusLabel, leaseState } from '../../../src/device-task-presenter';
import { ActionButton, colors, radius, spacing, typography } from '../../../src/design';
import { shortEvidenceHash } from '../../../src/evidence-presenter';
import { displayTime } from '../../../src/runtime-details-presenter';
import { LoginRequired, RuntimeCard, RuntimeDetailScreen, RuntimeKeyValue, RuntimeLoadState, RuntimeSection, RuntimeText } from '../../../src/runtime-details-ui';

export default function DeviceTaskDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const [showTechnical, setShowTechnical] = useState(false);
  const detail = useQuery({
    queryKey: ['device-task-evidence', id, token],
    queryFn: () => getDeviceTaskEvidence(token!, id!),
    enabled: Boolean(token && id),
    staleTime: 0,
  });
  const evidence = detail.data;
  const stages = evidence ? deviceTaskStages(evidence) : [];
  return <RuntimeDetailScreen title="手机任务详情" subtitle="只展示服务器已记录的状态与证据" onBack={() => router.back()}>
    {!token ? <LoginRequired /> : null}
    {token ? <RuntimeLoadState loading={detail.isLoading} error={detail.isError} onRetry={() => detail.refetch()} loadingText="正在核对设备任务…" /> : null}
    {evidence ? <>
      <View style={styles.hero}><Text style={styles.eyebrow}>{evidence.task.deviceOnline ? '手机在线' : '手机当前离线'}</Text><Text style={styles.heroTitle}>{deviceTaskStatusLabel(evidence.task.status)}</Text><Text style={styles.heroDetail}>{evidence.task.factKey}</Text></View>
      <RuntimeSection title="任务在手机上做到哪一步"><RuntimeCard>{stages.map((stage, index) => <View key={stage.key} style={[styles.stage, index < stages.length - 1 && styles.divider]}><View style={[styles.dot, stage.state === 'done' ? styles.done : stage.state === 'current' ? styles.current : stage.state === 'failed' ? styles.failed : styles.waiting]} /><View style={styles.stageCopy}><Text style={styles.stageTitle}>{stage.label}</Text><Text style={styles.stageDetail}>{stage.detail}</Text></View></View>)}</RuntimeCard></RuntimeSection>
      <RuntimeSection title="现实数据证据"><RuntimeCard>
        {evidence.observations.length === 0 ? <RuntimeText>尚无已记录的来源观察；不会把待执行任务显示为已验证。</RuntimeText> : evidence.observations.map((item) =>
          <RuntimeCard key={item.id} title="来源观察"><RuntimeKeyValue label="状态" value={item.status} /><RuntimeKeyValue label="观察时间" value={displayTime(item.observedAt)} /><ActionButton label="查看脱敏证据" tone="quiet" onPress={() => router.push(`/evidence/${item.id}` as never)} /></RuntimeCard>)}
        {evidence.readEvidence.map((item) => <RuntimeCard key={item.id} title="读取验证"><RuntimeKeyValue label="状态" value={item.status} />{item.blockedReason ? <RuntimeKeyValue label="阻断原因" value={item.blockedReason} last /> : null}</RuntimeCard>)}
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="事实确认"><RuntimeCard>
        {evidence.candidates.length > 0 ? <RuntimeKeyValue label="候选事实" value={`${evidence.candidates.length} 条`} /> : null}
        {evidence.truths.length === 0 ? <RuntimeText>尚未形成可信事实；任务状态不能替代 Truth 验证。</RuntimeText> : evidence.truths.map((item) =>
          <RuntimeCard key={item.id} title={item.current ? '当前可信事实' : '历史或已撤销事实'}>
            <RuntimeKeyValue label="状态" value={item.status} />
            <ActionButton label="查看事实依据" tone="quiet" onPress={() => router.push(`/truth/${item.id}`)} />
          </RuntimeCard>)}
      </RuntimeCard></RuntimeSection>
      <RuntimeSection title="技术详情"><Pressable accessibilityRole="button" accessibilityState={{ expanded: showTechnical }} onPress={() => setShowTechnical((value) => !value)} style={styles.disclosure}><Text style={styles.disclosureText}>{showTechnical ? '收起租约与标识' : '查看租约与标识'}</Text><Text style={styles.chevron}>{showTechnical ? '⌃' : '⌄'}</Text></Pressable>{showTechnical ? <RuntimeCard>
        <RuntimeKeyValue label="任务类型" value={evidence.task.taskType} />
        <RuntimeKeyValue label="资源类型" value={evidence.task.resourceType} />
        <RuntimeKeyValue label="领取次数" value={evidence.task.attemptCount} />
        <RuntimeKeyValue label="最近领取" value={evidence.task.claimedAt ? displayTime(evidence.task.claimedAt) : '尚未领取'} />
        <RuntimeKeyValue label="租约状态" value={leaseState(evidence.task.leaseExpiresAt)} />
        <RuntimeKeyValue label="租约截止" value={evidence.task.leaseExpiresAt ? displayTime(evidence.task.leaseExpiresAt) : '没有活动租约'} />
        <RuntimeKeyValue label="设备心跳" value={evidence.task.deviceHeartbeatAt ? displayTime(evidence.task.deviceHeartbeatAt) : '尚未记录'} />
        <RuntimeKeyValue label="结果证据" value={evidence.task.resultHash ? shortEvidenceHash(evidence.task.resultHash) : '尚未生成'} />
        <RuntimeKeyValue label="创建时间" value={displayTime(evidence.task.createdAt)} />
        <RuntimeKeyValue label="最近更新" value={displayTime(evidence.task.updatedAt)} />
        <RuntimeKeyValue label="完成时间" value={evidence.task.completedAt ? displayTime(evidence.task.completedAt) : '尚未完成'} last />
      </RuntimeCard> : null}</RuntimeSection>
    </> : null}
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  hero: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '800' }, heroTitle: { ...typography.display, color: colors.text, marginTop: spacing.xs }, heroDetail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  stage: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 12, height: 12, borderRadius: 6 }, done: { backgroundColor: colors.success }, current: { backgroundColor: colors.primary }, failed: { backgroundColor: colors.danger }, waiting: { backgroundColor: colors.border },
  stageCopy: { flex: 1, paddingVertical: spacing.sm }, stageTitle: { ...typography.bodyStrong, color: colors.text }, stageDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  disclosure: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, disclosureText: { ...typography.bodyStrong, color: colors.primary }, chevron: { ...typography.section, color: colors.primary },
});
