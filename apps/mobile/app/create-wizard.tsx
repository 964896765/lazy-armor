import type {
  CreationDraft,
  CreationDraftInput,
  CreationDraftSourceChoiceInput,
  CreationDraftStage,
  FactDemandProjection,
  PersistentPlanOffer,
  ScenarioGoalSpec,
  ScenarioResourceSubject,
} from '@lazy-armor/plan-schema';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { listCreationDrafts, resumeCreationDraft, saveCreationDraft } from '../src/creation-draft-api';
import {
  activeCreationDraftCount,
  buildCreationDraftInput,
  creationDraftSaveLabel,
  creationDraftSummary,
  creationWizardStageLabel,
  isActiveCreationDraft,
  resumeReasonCopy,
  resumeTargetStage,
  type CreationDraftSaveState,
} from '../src/creation-draft-presenter';
import { ActionButton, EmptyState, Surface, WorkspaceHeader, workspaceColors as colors, radius, spacing, typography } from '../src/design';
import { isValidScenarioKey } from '../src/plan-presenter';

interface ScenarioCreationContext {
  scenario: { key: string; revision: number };
  goal: { supportedIntents: string[]; requiredSubjectTypes: string[] };
}

interface FactDemandResolution {
  demands: FactDemandProjection[];
}

interface PlanOfferResponse {
  id: string;
  status: string;
  offer: PersistentPlanOffer;
  expiresAt: string;
  createdAt: string;
}

interface ChooseResult {
  planId: string;
  planVersionId: string;
}

export default function CreateWizard() {
  const token = useAuthStore((store) => store.token);
  const client = useQueryClient();
  const params = useLocalSearchParams<{ scenarioKey?: string; draftId?: string }>();
  const scenarioKeyParam = isValidScenarioKey(params.scenarioKey) ? params.scenarioKey : null;
  const draftIdParam = typeof params.draftId === 'string' && params.draftId.trim() ? params.draftId : null;

  const [scenarioKey, setScenarioKey] = useState<string | null>(scenarioKeyParam);
  const [scenarioRevision, setScenarioRevision] = useState<number | null>(null);
  const [stage, setStage] = useState<CreationDraftStage>(1);
  const [goal, setGoal] = useState<ScenarioGoalSpec | null>(null);
  const [subject, setSubject] = useState<ScenarioResourceSubject | null>(null);
  const [sourceChoices, setSourceChoices] = useState<CreationDraftSourceChoiceInput[]>([]);
  const [selectedOfferKey, setSelectedOfferKey] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<CreationDraftSaveState>('idle');
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(draftIdParam);

  const versionRef = useRef<number | undefined>(undefined);
  const draftIdRef = useRef<string | null>(null);

  const draftList = useQuery({
    queryKey: ['creation-drafts', token],
    queryFn: () => listCreationDrafts(token!),
    enabled: Boolean(token && !scenarioKey && !resumeDraftId),
  });

  const contract = useQuery({
    queryKey: ['scenario-contract-v2', scenarioKey, token],
    queryFn: () => api<ScenarioCreationContext>(`/scenarios/${scenarioKey}/contract-v2`, token),
    enabled: Boolean(scenarioKey && token),
  });

  const resume = useMutation({
    mutationFn: () => resumeCreationDraft(token!, resumeDraftId!),
    onSuccess: (assessment) => {
      setScenarioKey(assessment.scenario.key);
      setScenarioRevision(assessment.scenario.revision);
      setGoal(assessment.goal);
      setSubject(assessment.subject);
      setSelectedOfferKey(assessment.selectedOfferKey);
      setStage(resumeTargetStage(assessment.state, assessment.currentStage));
      setResumeNotice(assessment.state === 'READY' ? null : resumeReasonCopy(assessment));
    },
  });

  const resolveDemands = useMutation({
    mutationFn: () => api<FactDemandResolution>('/runtime/fact-demands/resolve', token!, {
      method: 'POST',
      body: JSON.stringify({ scenarioKey, scenarioRevision, goal, subject }),
    }),
    onSuccess: (result) => {
      setSourceChoices(result.demands
        .map((demand) => ({ demandId: demand.demandId, sourceId: demand.selectedSourceId ?? demand.candidateSources.find((candidate) => candidate.usable)?.sourceId ?? null }))
        .filter((choice): choice is CreationDraftSourceChoiceInput => Boolean(choice.sourceId)));
    },
  });

  const generateOffer = useMutation({
    mutationFn: () => api<PlanOfferResponse>('/planning/offers/v2', token!, {
      method: 'POST',
      body: JSON.stringify({ scenarioKey, scenarioRevision, goal, subject }),
    }),
    onSuccess: (result) => {
      setSelectedOfferKey(result.id);
    },
  });

  const chooseOffer = useMutation({
    mutationFn: () => api<ChooseResult>(`/planning/offers/${selectedOfferKey}/choose`, token!, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: `confirm-${selectedOfferKey}` }),
    }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['plans', token] });
      await client.invalidateQueries({ queryKey: ['creation-drafts', token] });
      router.replace(`/plans/${result.planId}` as never);
    },
  });

  useEffect(() => {
    if (resumeDraftId && token) resume.mutate();
    // 仅在进入恢复模式时触发一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftId, token]);

  useEffect(() => {
    if (contract.data && scenarioRevision === null) setScenarioRevision(contract.data.scenario.revision);
  }, [contract.data, scenarioRevision]);

  useEffect(() => {
    if (stage === 3 && goal && subject && scenarioRevision && !resolveDemands.data && !resolveDemands.isPending) resolveDemands.mutate();
  }, [stage, goal, subject, scenarioRevision, resolveDemands.data, resolveDemands.isPending, resolveDemands.mutate]);

  useEffect(() => {
    if ((stage === 4 || stage === 5) && goal && subject && scenarioRevision && !generateOffer.data && !generateOffer.isPending) generateOffer.mutate();
  }, [stage, goal, subject, scenarioRevision, generateOffer.data, generateOffer.isPending, generateOffer.mutate]);

  const payload = useMemo(() => buildCreationDraftInput({
    scenarioKey,
    scenarioRevision,
    stage,
    goal,
    subject,
    sourceChoices,
    selectedOfferKey,
    version: versionRef.current,
  }), [scenarioKey, scenarioRevision, stage, goal, subject, sourceChoices, selectedOfferKey]);

  const persist = useCallback(async (input: CreationDraftInput) => {
    if (!token) return;
    setSaveState('saving');
    try {
      const saved = await saveCreationDraft(token, input);
      draftIdRef.current = saved.draftId;
      versionRef.current = saved.version;
      setSaveState('saved');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // 乐观并发冲突：按服务端最新草稿版本重新同步，下一次自动保存据此重试。
        try {
          const drafts = await listCreationDrafts(token);
          const match = drafts.find((draft) => draft.draftId === draftIdRef.current) ?? drafts[0];
          if (match) {
            draftIdRef.current = match.draftId;
            versionRef.current = match.version;
          }
        } catch {
          // 服务端草稿接口不可用时维持错误态，不伪造已保存。
        }
      }
      setSaveState('error');
    }
  }, [token]);

  useEffect(() => {
    if (!token || !payload) return;
    const timer = setTimeout(() => { void persist(payload); }, 800);
    return () => clearTimeout(timer);
  }, [payload, token, persist]);

  if (!token) {
    return <Screen header="创建计划向导"><EmptyState icon="lock-closed-outline" title="登录后开始创建" description="创建进度需要保存到你的账号，请先登录。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Screen>;
  }

  if (resumeDraftId && !scenarioKey) {
    return <Screen header="恢复创建草稿" onBack={() => setResumeDraftId(null)}>
      {resume.isPending ? <LoadingState text="正在复核草稿授权与方案有效期…" /> : null}
      {resume.isError ? <InlineError title="无法恢复这份草稿" detail="服务端复核未通过或暂时不可用，不会用本地数据继续。" action="返回草稿列表" onPress={() => setResumeDraftId(null)} /> : null}
    </Screen>;
  }

  if (!scenarioKey) {
    const drafts = (draftList.data ?? []).filter(isActiveCreationDraft);
    return <Screen header="继续创建" onBack={() => router.back()}>
      {draftList.isLoading ? <LoadingState text="正在读取服务端草稿…" /> : null}
      {draftList.isError ? <InlineError title="暂时无法读取草稿" detail="不会用本地示例冒充服务端草稿。" action="重试" onPress={() => draftList.refetch()} /> : null}
      {draftList.data && drafts.length === 0 ? <EmptyState icon="document-outline" title="没有进行中的草稿" description="开始一个五步创建后，进度会自动保存在这里。" action={{ label: '开始创建', onPress: () => router.push('/create' as never) }} /> : null}
      {drafts.map((draft, index) => <DraftRow key={draft.draftId} draft={draft} last={index === drafts.length - 1} onPress={() => setResumeDraftId(draft.draftId)} />)}
      {drafts.length > 0 ? <Text style={styles.boundary}>只展示服务端返回的 ACTIVE 草稿，共 {activeCreationDraftCount(drafts)} 份。</Text> : null}
    </Screen>;
  }

  return <Screen header="创建计划" onBack={() => router.back()}>
    <WizardProgress stage={stage} />
    {resumeNotice ? <View style={styles.resumeNotice}><Ionicons name="alert-circle-outline" size={17} color="#96622B" /><Text style={styles.resumeNoticeText}>{resumeNotice}</Text></View> : null}
    {stage === 1 ? <StageGoal
      contract={contract.data}
      loading={contract.isLoading}
      error={contract.isError}
      onRetry={() => contract.refetch()}
      goal={goal}
      onNext={(nextGoal) => { setGoal(nextGoal); setStage(2); }}
    /> : null}
    {stage === 2 ? <StageSubject
      subjectTypeOptions={contract.data?.goal.requiredSubjectTypes ?? []}
      subject={subject}
      onNext={(nextSubject) => { setSubject(nextSubject); setStage(3); }}
    /> : null}
    {stage === 3 ? <StageSources
      loading={resolveDemands.isPending}
      error={resolveDemands.isError}
      demands={resolveDemands.data?.demands ?? []}
      sourceChoices={sourceChoices}
      onRetry={() => resolveDemands.reset()}
      onSelect={(demandId, sourceId) => setSourceChoices((current) => {
        const next = current.filter((choice) => choice.demandId !== demandId);
        next.push({ demandId, sourceId });
        return next;
      })}
      onNext={() => setStage(4)}
      onBack={() => setStage(2)}
    /> : null}
    {stage === 4 ? <StageOffer
      loading={generateOffer.isPending}
      error={generateOffer.isError}
      offer={generateOffer.data?.offer ?? null}
      selected={selectedOfferKey !== null}
      onRetry={() => generateOffer.reset()}
      onNext={() => setStage(5)}
      onBack={() => setStage(3)}
    /> : null}
    {stage === 5 ? <StageConfirm
      scenarioKey={scenarioKey}
      goal={goal}
      subject={subject}
      sourceChoices={sourceChoices}
      offer={generateOffer.data?.offer ?? null}
      offerLoading={generateOffer.isPending}
      offerError={generateOffer.isError}
      onOfferRetry={() => generateOffer.reset()}
      pending={chooseOffer.isPending}
      error={chooseOffer.isError}
      onConfirm={() => chooseOffer.mutate()}
      onBack={() => setStage(4)}
    /> : null}
    <SaveStatusBar state={saveState} />
  </Screen>;
}

function Screen({ header, onBack, children }: { header: string; onBack?: () => void; children: ReactNode }) {
  return <SafeAreaView edges={[]} style={styles.safeArea}>
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <WorkspaceHeader title={header} onBack={onBack} />
      {children}
    </ScrollView>
  </SafeAreaView>;
}

function WizardProgress({ stage }: { stage: CreationDraftStage }) {
  return <View style={styles.steps}>{([1, 2, 3, 4, 5] as const).map((step) => <View key={step} style={styles.stepItem}><View style={styles.stepTop}><View style={[styles.stepCircle, step <= stage && styles.stepCircleActive]}><Text style={[styles.stepNumber, step <= stage && styles.stepNumberActive]}>{step}</Text></View>{step < 5 ? <View style={[styles.stepLine, step < stage && styles.stepLineActive]} /> : null}</View><Text style={[styles.stepLabel, step === stage && styles.stepLabelActive]}>{creationWizardStageLabel(step)}</Text></View>)}</View>;
}

function StageGoal({ contract, loading, error, onRetry, goal, onNext }: {
  contract: ScenarioCreationContext | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  goal: ScenarioGoalSpec | null;
  onNext: (goal: ScenarioGoalSpec) => void;
}) {
  const [intent, setIntent] = useState(goal?.intent ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const intents = contract?.goal.supportedIntents ?? [];
  const canNext = Boolean(intent.trim() && description.trim());
  return <Surface style={styles.stageSurface}>
    <Text style={styles.stageTitle}>第 1 步 · 选择目标</Text>
    <Text style={styles.stageHint}>场景与目标来自服务端场景合同；下面只会列出服务端支持的目标意图。</Text>
    {loading ? <LoadingState text="正在读取场景合同…" /> : null}
    {error ? <InlineError title="场景合同暂时无法读取" detail="无法继续，请稍后重试。" action="重试" onPress={onRetry} /> : null}
    {contract && !loading && !error ? <>
      <Text style={styles.fieldLabel}>场景</Text>
      <View style={styles.scenarioRow}><Ionicons name="layers-outline" size={17} color={colors.primary} /><Text style={styles.scenarioKey}>{contract.scenario.key}</Text></View>
      <Text style={styles.fieldLabel}>目标意图</Text>
      <View style={styles.chipRow}>{intents.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: intent === item }} onPress={() => setIntent(item)} style={[styles.chip, intent === item && styles.chipSelected]}><Text style={[styles.chipText, intent === item && styles.chipTextSelected]}>{item}</Text></Pressable>)}</View>
      <Text style={styles.fieldLabel}>目标描述</Text>
      <TextInput accessibilityLabel="目标描述" style={styles.input} multiline placeholder="例如：快递到件或出现异常时提醒我。" placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} />
      <View style={styles.stageActions}><ActionButton label="下一步" disabled={!canNext} onPress={() => onNext({ intent: intent.trim(), description: description.trim(), constraints: {} })} /></View>
    </> : null}
  </Surface>;
}

function StageSubject({ subjectTypeOptions, subject, onNext }: {
  subjectTypeOptions: readonly string[];
  subject: ScenarioResourceSubject | null;
  onNext: (subject: ScenarioResourceSubject) => void;
}) {
  const [subjectType, setSubjectType] = useState(subject?.resourceType ?? '');
  const [subjectKey, setSubjectKey] = useState(subject?.subjectKey ?? '');
  const [displayName, setDisplayName] = useState(subject?.displayName ?? '');
  const options = subjectTypeOptions.length > 0 ? subjectTypeOptions : (subjectType ? [subjectType] : []);
  const effectiveType = subjectType || options[0] || '';
  const canNext = Boolean(effectiveType.trim() && subjectKey.trim());
  return <Surface style={styles.stageSurface}>
    <Text style={styles.stageTitle}>第 2 步 · 确定对象</Text>
    <Text style={styles.stageHint}>对象类型由场景合同限定，具体对象需要你来确定。</Text>
    <Text style={styles.fieldLabel}>对象类型</Text>
    <View style={styles.chipRow}>{options.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: effectiveType === item }} onPress={() => setSubjectType(item)} style={[styles.chip, effectiveType === item && styles.chipSelected]}><Text style={[styles.chipText, effectiveType === item && styles.chipTextSelected]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.fieldLabel}>对象标识</Text>
    <TextInput accessibilityLabel="对象标识" style={styles.input} placeholder="例如：运单号、耗材编号" placeholderTextColor={colors.textMuted} value={subjectKey} onChangeText={setSubjectKey} />
    <Text style={styles.fieldLabel}>对象名称（可选）</Text>
    <TextInput accessibilityLabel="对象名称" style={styles.input} placeholder="给这个对象起个名字" placeholderTextColor={colors.textMuted} value={displayName} onChangeText={setDisplayName} />
    <View style={styles.stageActions}><ActionButton label="下一步" disabled={!canNext} onPress={() => onNext({ resourceType: effectiveType, subjectKey: subjectKey.trim(), ...(displayName.trim() ? { displayName: displayName.trim() } : {}) })} /></View>
  </Surface>;
}

function StageSources({ loading, error, demands, sourceChoices, onRetry, onSelect, onNext, onBack }: {
  loading: boolean;
  error: boolean;
  demands: readonly FactDemandProjection[];
  sourceChoices: readonly CreationDraftSourceChoiceInput[];
  onRetry: () => void;
  onSelect: (demandId: string, sourceId: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const required = demands.filter((demand) => demand.required);
  const chosenFor = (demandId: string) => sourceChoices.find((choice) => choice.demandId === demandId)?.sourceId ?? null;
  const allRequiredChosen = required.every((demand) => chosenFor(demand.demandId) !== null);
  return <Surface style={styles.stageSurface}>
    <Text style={styles.stageTitle}>第 3 步 · 检查来源</Text>
    <Text style={styles.stageHint}>来源候选与状态由服务端解析，这里只做检查与选择，不自行判断已授权或已在线。</Text>
    {loading ? <LoadingState text="正在解析来源候选…" /> : null}
    {error ? <InlineError title="来源解析暂时不可用" detail="不会用本地来源冒充服务端结果。" action="重试" onPress={onRetry} /> : null}
    {!loading && !error && demands.length === 0 ? <EmptyState icon="git-network-outline" title="暂无来源候选" description="服务端没有返回该场景的来源候选，请稍后重试。" /> : null}
    {!loading && !error ? demands.map((demand) => <View key={demand.demandId} style={styles.demandBlock}>
      <View style={styles.demandHeader}><Text style={styles.demandFact}>{demand.factKey}</Text>{demand.required ? <Text style={styles.requiredBadge}>必需</Text> : null}</View>
      <Text style={styles.demandState}>服务端状态：{demand.state}</Text>
      {demand.candidateSources.map((candidate) => {
        const selected = chosenFor(demand.demandId) === candidate.sourceId;
        return <Pressable key={candidate.sourceId} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onSelect(demand.demandId, candidate.sourceId)} style={[styles.candidate, selected && styles.candidateSelected]}>
          <View style={styles.candidateMain}><Text style={styles.candidateTitle}>{candidate.providerKey || candidate.kind}</Text><Text numberOfLines={1} style={styles.candidateSub}>{candidate.sourceId}</Text></View>
          <View style={styles.candidateMeta}><Text style={[styles.candidateBadge, candidate.usable ? styles.badgeOk : styles.badgeWait]}>{candidate.usable ? '可用' : '待验收'}</Text><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={selected ? colors.primary : colors.textMuted} /></View>
        </Pressable>;
      })}
    </View>) : null}
    {!loading && !error ? <View style={styles.stageActions}><ActionButton label="上一步" tone="quiet" onPress={onBack} /><ActionButton label="下一步" disabled={!allRequiredChosen} onPress={onNext} /></View> : null}
  </Surface>;
}

function StageOffer({ loading, error, offer, selected, onRetry, onNext, onBack }: {
  loading: boolean;
  error: boolean;
  offer: PersistentPlanOffer | null;
  selected: boolean;
  onRetry: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const selectable = offer?.selectable === true;
  return <Surface style={styles.stageSurface}>
    <Text style={styles.stageTitle}>第 4 步 · 选择方案</Text>
    <Text style={styles.stageHint}>方案由服务端按当前来源与授权生成；过期或条件变化时会要求重新生成，不沿用旧审批。</Text>
    {loading ? <LoadingState text="正在生成方案…" /> : null}
    {error ? <InlineError title="方案生成暂时不可用" detail="无法生成方案，请稍后重试。" action="重试" onPress={onRetry} /> : null}
    {!loading && !error && !offer ? <EmptyState icon="construct-outline" title="没有可用方案" description="服务端没有返回方案，请返回上一步检查来源。" /> : null}
    {!loading && !error && offer ? <>
      <View style={styles.offerRow}><Text style={styles.offerLabel}>方案状态</Text><Text style={[styles.offerBadge, selectable ? styles.badgeOk : styles.badgeWait]}>{offer.state}</Text></View>
      <View style={styles.offerRow}><Text style={styles.offerLabel}>策略</Text><Text style={styles.offerValue}>{offer.strategyKey}</Text></View>
      <View style={styles.offerRow}><Text style={styles.offerLabel}>已选来源</Text><Text style={styles.offerValue}>{offer.sourceSelections.length} 项</Text></View>
      {offer.reasonCodes.length > 0 ? <Text style={styles.offerReasons}>服务端说明：{offer.reasonCodes.join('、')}</Text> : null}
      {!selectable ? <Text style={styles.offerWarning}>该方案当前不可执行，需要返回上一步补齐来源或授权。</Text> : null}
      <View style={styles.stageActions}><ActionButton label="上一步" tone="quiet" onPress={onBack} /><ActionButton label={selected ? '下一步' : '选择此方案'} disabled={!selectable} onPress={onNext} /></View>
    </> : null}
  </Surface>;
}

function StageConfirm({ scenarioKey, goal, subject, sourceChoices, offer, offerLoading, offerError, onOfferRetry, pending, error, onConfirm, onBack }: {
  scenarioKey: string;
  goal: ScenarioGoalSpec | null;
  subject: ScenarioResourceSubject | null;
  sourceChoices: readonly CreationDraftSourceChoiceInput[];
  offer: PersistentPlanOffer | null;
  offerLoading: boolean;
  offerError: boolean;
  onOfferRetry: () => void;
  pending: boolean;
  error: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return <Surface style={styles.stageSurface}>
    <Text style={styles.stageTitle}>第 5 步 · 确认创建</Text>
    <Text style={styles.stageHint}>确认后由服务端创建正式计划；本页只汇总你已选择的内容。</Text>
    {offerLoading ? <LoadingState text="正在重新核对方案…" /> : null}
    {offerError ? <InlineError title="方案暂时无法核对" detail="不会沿用旧审批继续创建。" action="重试" onPress={onOfferRetry} /> : null}
    {!offerLoading && !offerError ? <>
      <SummaryRow label="场景" value={scenarioKey} />
      <SummaryRow label="目标" value={goal ? `${goal.intent} · ${goal.description}` : '未确定'} />
      <SummaryRow label="对象" value={subject?.displayName ?? subject?.subjectKey ?? '未确定'} />
      <SummaryRow label="来源" value={`${sourceChoices.length} 项`} />
      <SummaryRow label="方案" value={offer?.offerKey ?? '未选择'} last />
      {error ? <Text style={styles.confirmError}>这次创建没有成功，请返回检查来源与方案后再试。</Text> : null}
      <View style={styles.stageActions}><ActionButton label="上一步" tone="quiet" onPress={onBack} /><ActionButton label={pending ? '创建中…' : '确认创建'} disabled={pending || !offer?.selectable} onPress={onConfirm} /></View>
    </> : null}
  </Surface>;
}

function SummaryRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <View style={[styles.summaryRow, !last && styles.summaryDivider]}><Text style={styles.summaryLabel}>{label}</Text><Text numberOfLines={2} style={styles.summaryValue}>{value}</Text></View>;
}

function DraftRow({ draft, last, onPress }: { draft: CreationDraft; last: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.draftRow, !last && styles.draftDivider, pressed && styles.rowPressed]}>
    <View style={styles.draftIcon}><Ionicons name="document-text-outline" size={19} color={colors.primary} /></View>
    <View style={styles.draftCopy}><Text style={styles.draftTitle}>{creationDraftSummary(draft)}</Text><Text style={styles.draftMeta}>场景 {draft.scenarioKey} · 更新于 {draft.updatedAt}</Text></View>
    <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
  </Pressable>;
}

function SaveStatusBar({ state }: { state: CreationDraftSaveState }) {
  const label = creationDraftSaveLabel(state);
  const icon = state === 'saved' ? 'checkmark-circle-outline' : state === 'error' ? 'alert-circle-outline' : state === 'saving' ? 'time-outline' : 'remove-circle-outline';
  return <View style={[styles.saveBar, state === 'error' && styles.saveBarError]}><Ionicons name={icon} size={16} color={state === 'error' ? colors.danger : state === 'saved' ? colors.success : colors.textMuted} /><Text style={[styles.saveText, state === 'error' && styles.saveTextError]}>{label}</Text><Text style={styles.saveHint}>进度会自动保存到服务端草稿</Text></View>;
}

function LoadingState({ text }: { text: string }) {
  return <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>{text}</Text></View>;
}

function InlineError({ title, detail, action, onPress }: { title: string; detail: string; action: string; onPress: () => void }) {
  return <View style={styles.inlineError}><View style={styles.inlineCopy}><Text style={styles.inlineTitle}>{title}</Text><Text style={styles.inlineDetail}>{detail}</Text></View><Pressable accessibilityRole="button" onPress={onPress} style={styles.inlineAction}><Text style={styles.inlineActionText}>{action}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  steps: { flexDirection: 'row', marginTop: spacing.md, paddingHorizontal: spacing.xs },
  stepItem: { flex: 1, alignItems: 'center' },
  stepTop: { width: '100%', flexDirection: 'row', alignItems: 'center' },
  stepCircle: { width: 28, height: 28, marginLeft: 'auto', borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9EDF2' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepNumber: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  stepNumberActive: { color: '#FFFFFF' },
  stepLine: { height: 1, flex: 1, backgroundColor: '#D8DEE7', marginRight: -1 },
  stepLineActive: { backgroundColor: colors.primary },
  stepLabel: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  stepLabelActive: { color: colors.primary, fontWeight: '800' },
  resumeNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#F7ECD9' },
  resumeNoticeText: { ...typography.caption, color: '#96622B', flex: 1 },
  stageSurface: { marginTop: spacing.lg },
  stageTitle: { ...typography.section, color: colors.text },
  stageHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  scenarioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  scenarioKey: { ...typography.bodyStrong, color: colors.primary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextSelected: { color: '#FFFFFF' },
  input: { ...typography.body, color: colors.text, minHeight: 88, maxHeight: 128, textAlignVertical: 'top', padding: spacing.md, backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  stageActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  demandBlock: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  demandHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  demandFact: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  requiredBadge: { ...typography.caption, color: '#A35B15', backgroundColor: colors.warningSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  demandState: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  candidate: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  candidateSelected: { borderColor: colors.primary, backgroundColor: colors.accentSoft },
  candidateMain: { flex: 1, minWidth: 0 },
  candidateTitle: { ...typography.bodyStrong, color: colors.text },
  candidateSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  candidateMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  candidateBadge: { ...typography.caption, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontWeight: '700' },
  badgeOk: { color: colors.primary, backgroundColor: colors.successSoft },
  badgeWait: { color: '#A35B15', backgroundColor: colors.warningSoft },
  offerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  offerLabel: { ...typography.caption, color: colors.textSecondary },
  offerValue: { ...typography.bodyStrong, color: colors.text },
  offerBadge: { ...typography.caption, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontWeight: '700' },
  offerReasons: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md },
  offerWarning: { ...typography.caption, color: '#A35B15', backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  summaryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  summaryDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryLabel: { ...typography.caption, color: colors.textSecondary, width: 52 },
  summaryValue: { ...typography.bodyStrong, color: colors.text, flex: 1, textAlign: 'right' },
  confirmError: { ...typography.caption, color: colors.danger, marginTop: spacing.md },
  draftRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  draftDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowPressed: { backgroundColor: colors.pressed },
  draftIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  draftCopy: { flex: 1, minWidth: 0 },
  draftTitle: { ...typography.bodyStrong, color: colors.text },
  draftMeta: { ...typography.caption, color: colors.textMuted, marginTop: 3 },
  boundary: { fontSize: 10, lineHeight: 15, color: colors.textMuted, marginTop: spacing.md },
  saveBar: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  saveBarError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  saveText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  saveTextError: { color: colors.danger },
  saveHint: { ...typography.caption, color: colors.textMuted, flex: 1, textAlign: 'right' },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  inlineError: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  inlineCopy: { flex: 1 },
  inlineTitle: { ...typography.bodyStrong, color: colors.text },
  inlineDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  inlineAction: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  inlineActionText: { ...typography.caption, color: '#FFFFFF', fontWeight: '800' },
});
