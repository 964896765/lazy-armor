import { ConsumerPresentationMapper as presentation } from '../../src/consumer-presentation';
import { PlanMethodReferences } from '../../src/plan-method-references';
import {controlActionLabel,controlTitle,controlResultLabel,controlVerificationLabel,informationStatus,type PlanControlProjection} from '../../src/plan-control-presenter';
import {todoRoute,type TodoItem} from '../../src/todo-presenter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { executionStatusLabel } from '../../src/execution-presenter';
import { consumerOutcomeLabel, type ConsumerOutcome } from '../../src/outcome-presenter';
import {
  actionSummary,
  boolLabel,
  conditionSummary,
  formatTime,
  notificationPreferenceLabel,
  planCenterStatusLabel,
  planEvidenceLine,
  planNextStep,
  planStatusLabel,
  sourceHealthHint,
  sourceTypeLabel,
  templateGroupLabel,
  triggerSummary,
} from '../../src/plan-presenter';
import type { TemplateConfigField } from '../../src/template-config-form';
import { planMutationErrorMessage } from '../../src/membership-presenter';
import { ActionButton, AttentionCard, EmptyState, Surface, WorkspaceHeader, colors, radius, spacing, typography } from '../../src/design';

interface PlanSummary {
  id: string;
  status: string;
  name: string | null;
  description: string | null;
  templateKey: string | null;
  templateVersion: string | null;
  nextExpectedRunAt: string | null;
  hasMissingConnection: boolean;
  missingConnections: Array<{ providerKey: string; providerName: string; requiredCapabilities: string[]; usedBy: string[] }>;
  latestExecution: { id: string; status: string; resultSummary: string | null; createdAt: string; outcome: { outcome: ConsumerOutcome | null } | null } | null;
  allowedTransitions: string[];
  currentVersion: { versionNumber: number; name: string; templateKey: string | null; templateVersion: string | null; templateConfig: Record<string, unknown> | null; automationLevel: string } | null;
  activeVersion: { versionNumber: number; name: string } | null;
  planCenterSummary: {
    kind: 'logistics' | 'household' | 'content' | 'daily_summary' | 'study' | 'device';
    currentStatus: string;
    latestCheckAt?: string | null;
    nextCheckAt?: string | null;
    isException?: boolean;
    latestEventSummary?: string | null;
    estimatedRunOutAt?: string | null;
    nextReminderAt?: string | null;
    targetPlatforms?: string[];
    latestPreparedVariantCount?: number;
    waitingConfirmation?: boolean;
    currentStrategy?: string;
    summaryTime?: string | null;
    includedSources?: string[];
    latestSummaryAt?: string | null;
    latestImportantCount?: number;
    expectedReplaceAt?: string | null;
    remainingDays?: number | null;
    nearReplacement?: boolean;
    shoppingListPrepared?: boolean;
    consumableName?: string | null;
    deviceName?: string | null;
  } | null;
}

interface PlanVersionDetail {
  id: string;
  versionNumber: number;
  name: string;
  description: string | null;
  domain: string;
  automationLevel: string;
  templateKey: string | null;
  templateVersion: string | null;
  templateConfig: Record<string, unknown> | null;
  definition: {
    sources: Array<{ sourceType: string; connectorKey?: string | null; connectionId?: string | null; config: Record<string, unknown> }>;
    triggers: Array<{ triggerType: string; config: Record<string, unknown>; sortOrder: number }>;
    conditions: Array<{ fieldPath: string; operator: string; comparisonValue?: unknown; sortOrder: number }>;
    actions: Array<{ actionType: string; requiredCapability?:string|null; config: Record<string, unknown>; stepOrder: number }>;
    approvalPolicy?:{type:string};
  };
}

interface TemplateDetail {
  name: string;
  configFields: TemplateConfigField[];
}

interface DeviceConsumable {
  id: string;
  deviceProfileId: string;
  name: string;
  lastReplacedAt: string;
  replacementIntervalDays: number;
  remindBeforeDays: number;
  expectedReplaceAt: string;
}

type PlanDetailControlProjection = PlanControlProjection & {
  notificationWatchState?: { state: string; label: string; reason: string; nextStep: string };
};

export default function PlanDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const attention=useQuery({queryKey:['plan-attention',id,token],queryFn:()=>api<TodoItem[]>('/attention',token),enabled:Boolean(id&&token)});
  const [replacementDate, setReplacementDate] = useState('');
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [settingsSection,setSettingsSection]=useState('');
  const [menuOpen,setMenuOpen]=useState(false);
  const control=useQuery({queryKey:['plan-control',id,token],queryFn:()=>api<PlanDetailControlProjection>(`/plans/${id}/control-projection`,token),enabled:Boolean(id&&token),refetchInterval:20000});
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const summary = useQuery({
    queryKey: ['plan', id, token],
    queryFn: () => api<PlanSummary>(`/plans/${id}`, token),
    enabled: Boolean(id && token),
  });
  const currentVersionNumber = summary.data?.currentVersion?.versionNumber;
  const displayVersionNumber=summary.data?.status==='active'?summary.data.activeVersion?.versionNumber??currentVersionNumber:currentVersionNumber;
  const version = useQuery({
    queryKey: ['plan-version', id, displayVersionNumber, token],
    queryFn: () => api<PlanVersionDetail>(`/plans/${id}/versions/${displayVersionNumber}`, token),
    enabled: Boolean(id && token && displayVersionNumber),
  });
  const template = useQuery({
    queryKey: ['template-detail', summary.data?.templateKey, token],
    queryFn: () => api<TemplateDetail>(`/templates/${summary.data?.templateKey}`, token),
    enabled: Boolean(token && summary.data?.templateKey),
  });
  const deviceProfileId = typeof version.data?.templateConfig?.deviceProfileId === 'string' ? version.data.templateConfig.deviceProfileId : null;
  const deviceConsumableId = typeof version.data?.templateConfig?.consumableId === 'string' ? version.data.templateConfig.consumableId : null;
  const deviceConsumables = useQuery({
    queryKey: ['device-consumables', token, deviceProfileId],
    queryFn: () => api<DeviceConsumable[]>(
      `/device-consumables${deviceProfileId ? `?deviceProfileId=${encodeURIComponent(deviceProfileId)}` : ''}`,
      token,
    ),
    enabled: Boolean(token && summary.data?.planCenterSummary?.kind === 'device' && deviceProfileId),
  });
  const apply = useMutation({
    mutationFn: () => api(`/plans/${id}/versions/${currentVersionNumber}/apply`, token, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
      ]);
    },
  });
  const resolveConnections = useMutation({
    mutationFn: () => api<PlanSummary>(`/plans/${id}/connections/resolve`, token, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
        client.invalidateQueries({ queryKey: ['plan-version', id] }),
      ]);
    },
  });
  const changeStatus = useMutation({
    mutationFn: (status: string) => api(`/plans/${id}/status`, token, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
      ]);
    },
  });
  const updateReplacement = useMutation({
    mutationFn: () => {
      if (!deviceConsumableId) throw new Error('缺少耗材配置');
      return api(`/device-consumables/${deviceConsumableId}/replacement`, token, {
        method: 'PATCH',
        body: JSON.stringify({ lastReplacedAt: normalizeDateInput(replacementDate) }),
      });
    },
    onSuccess: async () => {
      setReplacementDate('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
        client.invalidateQueries({ queryKey: ['device-consumables', token, deviceProfileId] }),
      ]);
      await refreshAll();
    },
  });
  const refreshAll = async () => {
    await Promise.all([summary.refetch(), version.refetch(), template.refetch(), deviceConsumables.refetch(),control.refetch(),attention.refetch()]);
  };

  if (!token) return (
    <SafeAreaView style={local.safeArea} edges={['top']}>
      <Surface><EmptyState icon="shield-checkmark-outline" title="登录后查看计划详情" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={local.safeArea} edges={['top']}>
      <ScrollView style={local.page} contentContainerStyle={local.content} refreshControl={<RefreshControl tintColor={colors.primary} refreshing={summary.isFetching || version.isFetching} onRefresh={refreshAll} />}>
        <WorkspaceHeader title="计划详情" onBack={() => router.back()} action={<Pressable accessibilityRole="button" accessibilityLabel="计划操作" onPress={()=>setMenuOpen(true)} style={{padding:8}}><Ionicons name="ellipsis-horizontal" size={23} color={colors.textSecondary}/></Pressable>} />
        {(summary.isLoading || version.isLoading) ? <View style={local.loading}><ActivityIndicator color={colors.primary} /><Text style={local.text}>正在看看这条计划…</Text></View> : null}
        {summary.isError ? <Surface><EmptyState icon="cloud-offline-outline" title="计划暂时加载失败" description="请稍后再试。" action={{ label: '重新加载', onPress: refreshAll }} /></Surface> : null}
        {summary.data && version.data ? (
          <>
            <View style={local.hero}>
              <View style={local.heroCopy}><Text style={local.title}>{controlTitle(version.data.name,version.data.definition.actions[0]?.requiredCapability??undefined,version.data.definition.triggers.some(t=>t.triggerType==='schedule'))}</Text><Text style={local.eyebrow}>{planStatusLabel(summary.data.status)}</Text><Text style={local.subtitle}>{controlActionLabel(version.data.definition.actions[0]?.requiredCapability??undefined,'持续完成你确认的目标')}，按确认的时间与规则处理</Text></View>
            </View>

            <View style={local.nowRow}>
              <View style={local.nowBlock}><Text style={local.nowLabel}>当前情况</Text><Text style={local.nowValue}>{summary.data.status==='active'&&control.data?.notificationWatchState ? control.data.notificationWatchState.label : summary.data.planCenterSummary ? planCenterStatusLabel(summary.data.planCenterSummary.kind, summary.data.planCenterSummary.currentStatus) : planStatusLabel(summary.data.status)}</Text></View>
              <View style={local.nowBlock}><Text style={local.nowLabel}>下一步</Text><Text style={local.nowValue}>{summary.data.status==='active'&&control.data?.notificationWatchState ? control.data.notificationWatchState.nextStep : summary.data.status==='active'&&!summary.data.hasMissingConnection&&summary.data.latestExecution?.status!=='waiting_approval'&&summary.data.latestExecution?.status!=='running'&&summary.data.latestExecution?.outcome?.outcome!=='OUTCOME_UNKNOWN'&&summary.data.nextExpectedRunAt?`${formatTime(summary.data.nextExpectedRunAt)}\n${control.data?.information.length?'更新所需信息，再':''}${controlActionLabel(version.data.definition.actions[0]?.requiredCapability??undefined,actionSummary(version.data.definition.actions[0]?.actionType??'',version.data.definition.actions[0]?.config))}`:planNextStep({ status: summary.data.status, hasMissingConnection: summary.data.hasMissingConnection, latestExecutionStatus: summary.data.latestExecution?.status, outcome: summary.data.latestExecution?.outcome?.outcome })}</Text></View>
            </View>

            <Text style={local.sectionTitle}>计划内容</Text>
            <View style={local.sectionBody}>
              <View style={local.helpSteps}>
                {version.data.definition.triggers.map((trigger, index) => <HelpStep key={`${trigger.triggerType}-${index}`} icon="time-outline" text={triggerSummary(trigger.triggerType, trigger.config)} />)}
                {control.data?.information.length?<HelpStep icon="search-outline" text={'判断：更新'+[...new Set(control.data.information.map(info=>info.label))].join('、')+'，按确认的规则判断'}/>:null}
                {version.data.definition.conditions.map((condition,index)=><HelpStep key={'condition:'+index} icon="filter-outline" text={'条件：'+conditionSummary(condition.fieldPath,condition.operator,condition.comparisonValue)}/>)}
                {version.data.definition.actions.map((action, index) => <HelpStep key={`${action.actionType}-${index}`} icon="play-outline" text={'执行：'+controlActionLabel(action.requiredCapability??undefined,actionSummary(action.actionType, action.config))} />)}
                <HelpStep icon="shield-checkmark-outline" text={version.data.definition.approvalPolicy?.type==='always'?'确认：每次执行前需要你确认':'确认：按已确认的自动化与风险规则处理'}/>
                {version.data.definition.actions.some(a=>a.requiredCapability==='calendar.event.create')?<HelpStep icon="checkmark-circle-outline" text="验证：创建后重新读取并核对"/>:null}
              </View>
            </View>

            {attention.isError||attention.data?.some(item=>item.planId===id&&item.status==='OPEN')?<><Text style={local.sectionTitle}>需要你处理</Text><View style={local.sectionBody}>{attention.isError?<ActionButton label="重新读取待处理" onPress={()=>void attention.refetch()}/>:attention.data?.filter(item=>item.planId===id&&item.status==='OPEN').map(item=><ControlRow key={item.id} title={item.summary} detail="需要你的确认或处理" onPress={()=>{const path=todoRoute(item);if(path)router.push(path as never);}}/>)}</View></>:null}
            <Text style={local.sectionTitle}>来源</Text>
            <View style={local.sectionBody}><Text style={local.text}>{control.data?.origin?.label??'正在核对创建来源'}</Text>{control.data?.origin?<Text style={local.settingsHint}>{control.data.origin.detail}</Text>:null}</View>
            <Text style={local.sectionTitle}>使用的信息</Text>
            <View style={local.sectionBody}>
              {control.isLoading?<Text style={local.text}>正在核对信息来源…</Text>:control.isError?<ControlRow title="信息来源暂未读取" detail="点击重试" onPress={()=>void control.refetch()}/>:control.data?.information?.length?control.data.information.map(info=><ControlRow key={info.factKey} title={info.sourceLabel} detail={`${info.itemCount!==null?'最近读取 '+info.itemCount+' 条日程 · ':''}${info.label} · ${informationStatus(info)}${info.observedAt?'\n'+formatTime(info.observedAt)+' 更新':''}`} onPress={()=>router.push(`/plans/${id}/lifecycle` as never)}/>):<Text style={local.text}>{control.data?.informationState==='LEGACY_NOT_BOUND'?'此版本尚无绑定的外部事实证据':'尚未取得可展示的判断信息'}</Text>}
              {version.data.definition.sources.some(source=>source.sourceType==='manual')?<ControlRow title="你提供的信息" detail="创建规则与时间"/>:null}
            </View>
            <Text style={local.sectionTitle}>执行资源</Text>
            <View style={local.sectionBody}><Text style={local.settingsHint}>{control.data?.resourcePolicy??'按能力要求选择已授权资源'}</Text>{control.data?.resources?.map(resource=><ControlRow key={resource.capabilityId} title={controlActionLabel(resource.capabilityId)} detail={`${resource.name} · 最近使用 ${formatTime(resource.lastUsedAt)}\n当次结果：${controlVerificationLabel(resource.verificationState)}`} onPress={()=>router.push(`/runtime-target-detail?id=${resource.targetId}` as never)}/>)}{control.data?.resources?.length===0?<Text style={local.text}>尚无实际使用资源记录</Text>:null}</View>

            <Text style={local.sectionTitle}>最近结果</Text>
            <View style={local.sectionBody}>
              <Text style={local.resultDate}>{summary.data.latestExecution ? formatTime(summary.data.latestExecution.createdAt) : '还没有运行记录'}</Text>
              <Text style={local.resultTitle}>{control.data?.records?.[0]?controlResultLabel(control.data.records[0]):summary.data.latestExecution?consumerOutcomeLabel(summary.data.latestExecution.outcome?.outcome):'第一次运行后，结果会出现在这里。'}</Text>
              {control.data?.records?.[0]?<Text style={local.text}>{controlVerificationLabel(control.data.records[0].verificationState)}</Text>:null}
              {control.data?.records?.[0]?.verificationState==='VERIFIED'&&control.data.records[0].status==='succeeded'&&control.data.records[0].capabilityIds.includes('calendar.event.create')?<Text style={local.settingsHint}>{control.data.information.find(info=>info.itemCount!==null)?.itemCount!==undefined?'最近读取 '+control.data.information.find(info=>info.itemCount!==null)!.itemCount+' 条日程 · ':''}创建结果已回读核对</Text>:null}
              {summary.data.latestExecution ? <ControlRow title="查看完整记录" onPress={() => router.push(`/executions/${summary.data?.latestExecution?.id}` as never)} /> : null}
            </View>
            <Text style={local.sectionTitle}>运行记录</Text>
            <View style={local.sectionBody}><ControlRow title="任务进度" detail="查看每次运行的处理进展" onPress={()=>router.push(`/plans/${id}/tasks` as never)}/></View>
            <View style={local.sectionBody}>{control.data?.records?.slice(0,3).map(record=><ControlRow key={record.id} title={formatTime(record.createdAt)} detail={`${controlResultLabel(record)} · ${controlVerificationLabel(record.verificationState)}`} onPress={()=>router.push(`/executions/${record.id}` as never)}/>)}{control.data?.records?.length===0?<Text style={local.text}>还没有运行记录</Text>:null}<ControlRow title="查看运行记录" onPress={()=>router.push(`/plans/${id}/runs` as never)}/></View>

            {summary.data.missingConnections.length > 0 ? (
              <View style={local.sectionGap}>
                <AttentionCard
                  title={`还需要连接 ${summary.data.missingConnections.map((item) => item.providerName).join('、')}`}
                  description="计划已经替你保留，连接完成后就能继续运行。"
                  actionLabel="去连接"
                  onPress={() => router.push('/resources' as never)}
                  secondaryAction={{ label: resolveConnections.isPending ? '检查中…' : '重新检查', onPress: () => resolveConnections.mutate() }}
                />
                {resolveConnections.isError ? <Text style={local.error}>还没有找到可用连接，请先完成授权。</Text> : null}
              </View>
            ) : null}

            <Pressable accessibilityRole="button" accessibilityState={{ expanded: evidenceExpanded }} onPress={() => setEvidenceExpanded((current) => !current)} style={local.settingsHeader}>
              <View><Text style={local.sectionTitleNoMargin}>判断依据与信息</Text><Text style={local.settingsHint}>确认的目标、所需事实与判断规则</Text></View>
              <Ionicons name={evidenceExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
            </Pressable>
            {evidenceExpanded ? (
              <View style={local.settingsContent}>
                <View style={local.settingsBlock}>
                  <Text style={local.text}>目标：{control.data?.goalDescription??version.data.name}</Text>
                  {control.data?.information?.map(info=><Text key={info.factKey} style={local.text}>需要确认：{info.label}；来源：{info.sourceLabel}；数据要求：执行前按 {info.maximumAgeSeconds} 秒时效合同更新；{informationStatus(info)}</Text>)}
                  {planEvidenceLines(summary.data, version.data).map((line, index) => <Text style={local.text} key={index}>{line}</Text>)}
                  <Text style={local.text}>来源与验证状态请见「完整过程」。</Text>
                  <PlanMethodReferences planId={String(id)} token={token}/>
                  <ControlRow title="持续运行记录" detail="查看原计划的运行、等待和恢复" onPress={()=>router.push(`/plans/${id}/loop` as never)}/>
                </View>
              </View>
            ) : null}

            <Text style={local.sectionTitle}>计划设置</Text>
            {['时间与触发','通知','自动化与确认','计划版本'].map(label=><ControlRow key={label} title={label} onPress={()=>{setSettingsSection(label);setSettingsExpanded(settingsSection!==label||!settingsExpanded);}}/>)}

            {settingsExpanded ? (
              <View style={local.settingsContent}>
                <View style={local.settingsBlock}>
                  <Text style={local.cardTitle}>{settingsSection}</Text>
                  {settingsSection==='通知'?<Text style={local.text}>{notificationText(version.data)}</Text>:null}
                  {settingsSection==='时间与触发'?version.data.definition.triggers.map((trigger,index)=><Text key={index} style={local.text}>{triggerSummary(trigger.triggerType,trigger.config)}{typeof trigger.config.timezone==='string'?' · '+trigger.config.timezone:''}</Text>):null}
                  {settingsSection==='自动化与确认'?<><Text style={local.text}>{version.data.definition.approvalPolicy?.type==='always'?'每次执行前需要你的确认':'按已确认的自动化与风险规则处理'}</Text>{version.data.definition.conditions.map((condition,index)=><Text key={index} style={local.text}>{conditionSummary(condition.fieldPath,condition.operator,condition.comparisonValue)}</Text>)}{renderConfig(version.data.templateConfig,template.data?.configFields)}</>:null}
                  {settingsSection==='计划版本'?<><Text style={local.text}>当前展示版本 v{version.data.versionNumber}；运行版本 v{summary.data.activeVersion?.versionNumber??'尚未启用'}</Text><ControlRow title="查看版本与过程" onPress={()=>router.push(`/plans/${id}/lifecycle` as never)}/></>:null}
                </View>

                {summary.data.planCenterSummary?.kind === 'device' && deviceConsumableId ? (
                  <View style={local.settingsBlock}>
                    <Text style={local.cardTitle}>更新耗材更换时间</Text>
                    <Text style={local.text}>更换后告诉我日期，后续提醒会重新计算。</Text>
                    <TextInput style={local.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={replacementDate} onChangeText={setReplacementDate} />
                    <ActionButton label={updateReplacement.isPending ? '更新中…' : '确认已更换'} onPress={() => updateReplacement.mutate()} disabled={updateReplacement.isPending || !replacementDate.trim()} />
                    {updateReplacement.isError ? <Text style={local.error}>日期没有更新成功，请检查后重试。</Text> : null}
                  </View>
                ) : null}

                {settingsSection==='计划版本'?<View style={local.settingsBlock}><ActionButton label={apply.isPending?'启用中…':'启用当前修改'} onPress={()=>apply.mutate()} disabled={apply.isPending||!currentVersionNumber||summary.data.hasMissingConnection||currentVersionNumber===summary.data.activeVersion?.versionNumber}/>{apply.isError?<Text style={local.error}>{planMutationErrorMessage(apply.error)}</Text>:null}</View>:null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={()=>setMenuOpen(false)}><View style={{flex:1,backgroundColor:'rgba(20,35,60,0.2)'}}><Pressable accessibilityLabel="关闭计划操作" style={StyleSheet.absoluteFill} onPress={()=>setMenuOpen(false)}/><View style={{position:'absolute',top:90,right:20,width:260,padding:16,borderRadius:16,backgroundColor:colors.surface}}>
        <ControlRow title="与计划对话" onPress={()=>{setMenuOpen(false);router.push(`/chat?mode=plan&planId=${id}` as never);}}/>
        <ControlRow title="编辑计划" onPress={()=>{setMenuOpen(false);router.push(summary.data?.templateKey?`/plans/${id}/edit` as never:`/chat?mode=plan&planId=${id}` as never);}}/>
        <ControlRow title="运行一次" detail={control.data?.manualRunAllowed?'不改变持续运行设置':control.data?.manualRunReason??'正在检查是否可以安全运行'} disabled={!control.data?.manualRunAllowed} onPress={()=>{if(control.data?.manualRunAllowed){setMenuOpen(false);router.push(`/run-once?planId=${id}` as never);}}}/>
        <ControlRow title="复制计划" detail="进入新会话，确认后才创建" onPress={()=>{setMenuOpen(false);router.push({pathname:'/chat',params:{mode:'plan',intent:`请根据以下目标和规则提出一个新的计划草案，不直接执行：${control.data?.goalDescription??version.data?.name??''}`}} as never);}}/>
        {summary.data?.allowedTransitions.filter(status=>['ready','active','paused','archived'].includes(status)).map(status=><ControlRow key={status} title={status==='archived'?'结束计划':statusActionLabel(status)} disabled={changeStatus.isPending} onPress={()=>Alert.alert(status==='archived'?'结束这条计划？':status==='paused'?'暂停这条计划？':status==='ready'?'完成准备？':'开始或恢复运行？','将通过现有计划状态权限处理。已开始的执行和结果仍保留。',[{text:'取消'},{text:'确认',onPress:()=>{setMenuOpen(false);changeStatus.mutate(status);}}])}/>)}
        {changeStatus.isError?<Text style={local.error}>{planMutationErrorMessage(changeStatus.error)}</Text>:null}
      </View></View></Modal>
    </SafeAreaView>
  );
}

function ControlRow({title,detail,onPress,disabled=false}:{title:string;detail?:string;onPress?:()=>void;disabled?:boolean}){
 const content=<><View style={{flex:1,minWidth:0,gap:4}}><Text style={[local.text,{color:disabled?colors.textMuted:colors.text,fontWeight:'500'}]}>{title}</Text>{detail?<Text style={local.settingsHint}>{detail}</Text>:null}</View>{onPress?<Ionicons name="chevron-forward" size={17} color={disabled?colors.textMuted:colors.textSecondary}/>:null}</>;
 return onPress?<Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={{flexDirection:'row',gap:10,alignItems:'center',minHeight:48,paddingVertical:10}}>{content}</Pressable>:<View style={{flexDirection:'row',gap:10,alignItems:'center',minHeight:48,paddingVertical:10}}>{content}</View>;
}

function HelpStep({ icon, text }: { icon: ComponentProps<typeof Ionicons>['name']; text: string }) {
  return <View style={local.helpStep}><View style={local.helpIcon}><Ionicons name={icon} size={16} color={colors.success} /></View><Text style={local.helpText}>{text}</Text></View>;
}

function planEvidenceLines(summary: PlanSummary, version: PlanVersionDetail): string[] {
  const condition = version.definition.conditions[0];
  const rule = condition ? conditionSummary(condition.fieldPath, condition.operator, condition.comparisonValue) : '到点就按计划处理';
  const center = summary.planCenterSummary;
  if (center?.kind === 'device' && typeof center.remainingDays === 'number') {
    return [planEvidenceLine({
      factLabel: `${center.consumableName ?? '滤芯'}预计剩余`,
      value: `${center.remainingDays} 天`,
      sourceLabel: '设备信息',
      observedAt: center.latestCheckAt ? formatTime(center.latestCheckAt) : '本次检查',
      realityLabel: '已记录',
      ruleLabel: rule,
    })];
  }
  if (center?.latestEventSummary) {
    return [`检测到：${center.latestEventSummary}`, `计划规则：${rule}`];
  }
  return [`计划规则：${rule}`, `最近状态：${center ? planCenterStatusLabel(center.kind, center.currentStatus) : '等待第一次运行'}`];
}

function planDetailIcon(kind?: string | null): ComponentProps<typeof Ionicons>['name'] {
  return ({ logistics: 'cube-outline', household: 'home-outline', content: 'create-outline', daily_summary: 'mail-outline', study: 'school-outline', device: 'hardware-chip-outline' } as Record<string, ComponentProps<typeof Ionicons>['name']>)[kind ?? ''] ?? 'shield-checkmark-outline';
}

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  return trimmed;
}

function renderConfig(config: Record<string, unknown> | null, fields: TemplateConfigField[] | undefined) {
  if (!config || Object.keys(config).length === 0) return <Text style={local.text}>当前版本没有额外模板配置。</Text>;
  const visibleEntries = Object.entries(config).flatMap(([key, value]) => {
    const field = fields?.find((item) => item.key === key);
    if (!field) {
      return [];
    }
    return [(
      <Text style={local.text} key={key}>
        {field.label}：{formatConfigValue(field, value)}
      </Text>
    )];
  });
  return visibleEntries.length > 0 ? visibleEntries : <Text style={local.text}>当前版本已配置完成。</Text>;
}

function formatConfigValue(field: TemplateConfigField, value: unknown) {
  if (Array.isArray(value)) {
    const labels = value.map((item) => optionLabel(field, item)).filter(Boolean);
    return labels.length > 0 ? labels.join('、') : '已配置';
  }
  if (typeof value === 'boolean') return boolLabel(value);
  if (field.key === 'notificationPreference') return notificationPreferenceLabel(value);
  if (field.key === 'group') return templateGroupLabel(String(value));
  if (field.type === 'select' || field.type === 'multiselect') return optionLabel(field, value);
  if (field.type === 'date' || field.type === 'time') return String(value);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '已配置';
}

function optionLabel(field: TemplateConfigField, value: unknown) {
  const matched = field.options?.find((option) => option.value === String(value));
  return matched?.label ?? '已配置';
}

function notificationText(version: PlanVersionDetail) {
  const notifyAction = version.definition.actions.find((item) => item.actionType === 'notify');
  if (!notifyAction) return '默认静默，结果只进入记录。';
  if (typeof version.templateConfig?.notificationPreference !== 'undefined') {
    return `按“${notificationPreferenceLabel(version.templateConfig.notificationPreference)}”处理。`;
  }
  return actionSummary('notify', notifyAction.config);
}

function statusActionLabel(status: string) {
  switch (status) {
    case 'ready':
      return '标记为已准备';
    case 'active':
      return '开始运行';
    case 'paused':
      return '暂停';
    case 'archived':
      return '归档';
    case 'draft':
      return '回到草稿';
    default:
      return `切换到 ${planStatusLabel(status)}`;
  }
}

const local = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 72 },
  loading: { alignItems: 'center', gap: spacing.md, paddingVertical: 64 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...typography.label, color: colors.success, marginTop: 2 },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  nowRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  nowBlock: { flex: 1, gap: 2 },
  nowLabel: { ...typography.caption, color: colors.textMuted },
  nowValue: { ...typography.bodyStrong, color: colors.text },
  sectionTitle: { ...typography.section, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitleNoMargin: { ...typography.section, color: colors.text },
  sectionBody: { paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  helpSteps: { gap: spacing.lg },
  helpStep: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  helpIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' },
  helpText: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  sourceList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sourceChip: { backgroundColor: colors.accentSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  sourceText: { ...typography.bodyStrong, color: colors.primary },
  permissionText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg },
  resultDate: { ...typography.caption, color: colors.textMuted },
  resultTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.sm },
  inlineAction: { alignItems: 'flex-start', marginTop: spacing.lg },
  sectionGap: { marginTop: spacing.xxxl },
  settingsHeader: { marginTop: spacing.xxxl, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  settingsContent: { gap: 0 },
  settingsBlock: { paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  cardTitle: { ...typography.cardTitle, color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  text: { ...typography.body, color: colors.textSecondary },
  input: { ...typography.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, backgroundColor: colors.background, marginTop: spacing.md, marginBottom: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
});
